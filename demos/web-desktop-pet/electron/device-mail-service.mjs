import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { simpleParser } from 'mailparser'
import { withReadOnlyInbox } from './device-mail-client.mjs'

const failure = code => Object.assign(new Error(code), { code })
const clean = (value, limit = 512) => String(value ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, limit)
const accountId = account => createHash('sha256').update(`${account.provider}\0${account.user.toLowerCase()}`).digest('hex')
const uidList = value => {
  if (!Array.isArray(value) || value.some(uid => !Number.isSafeInteger(uid) || uid <= 0)) throw failure('MAIL_CONNECTION_FAILED')
  if (value.length > 1000) throw failure('MAIL_TOO_MANY')
  return [...new Set(value)].sort((a, b) => b - a)
}
const mailboxIdentity = client => {
  const box = client.mailbox
  const value = { validity: String(box?.uidValidity), highest: Number(box?.uidNext) - 1 }
  if (!/^\d{1,24}$/.test(value.validity) || !Number.isSafeInteger(value.highest) || value.highest < 0) throw failure('MAIL_CONNECTION_FAILED')
  return value
}

export function mailAnnouncement(count, detail) {
  if (!detail?.items?.length) return detail?.failed ? `收到 ${count} 封新邮件，但正文读取失败，尚未汇报邮件内容；可稍后在对话中重试。` : `收到 ${count} 封新邮件，可在对话中查看。`
  const rows = detail.items.slice(0, 3).map((item, index) =>
    `第${index + 1}封，发件人：${clean(item.from, 40) || '未提供'}。主题：${clean(item.subject, 64) || '无主题'}。正文节选：${clean(clean(item.text,4096).replace(/\[?https?:\/\/[^\s\]]+\]?/gi,'').replace(/\s+/g,' '),180) || '没有可朗读的正文'}。`)
  return [`收到 ${count} 封新邮件。以下为${rows.length}封邮件的正文节选，不是全文。`, ...rows,
    count > rows.length ? `其余 ${count - rows.length} 封尚未读取，可在对话中继续查看。` : '',
    detail.failed ? '部分邮件读取失败，可稍后在对话中重试。' : ''].filter(Boolean).join('\n').slice(0, 1100)
}

export const mailMessage = code => ({
  MAIL_DISABLED: '邮箱尚未启用，请在设置中配置邮箱和客户端授权码',
  MAIL_SETTINGS_INVALID: '请检查邮箱类型、完整邮箱地址和客户端授权码',
  MAIL_STORAGE_UNAVAILABLE: '无法安全保存邮箱，请关闭加密记住后重试',
  MAIL_CONNECTION_FAILED: '邮箱连接失败，请检查网络、IMAP 服务和客户端授权码',
  MAIL_TIMEOUT: '邮箱连接超时，请稍后重试', MAIL_BUSY: '邮箱正在检查来信，请稍后重试',
  MAIL_TOKEN_EXPIRED: '邮件列表已失效，请重新列出邮件', MAIL_CHANGED: '邮箱内容已变化，请重新列出邮件',
  MAIL_TOO_LARGE: '这封邮件超过 2 MiB，请在邮箱客户端查看',
  MAIL_TOO_MANY: '匹配邮件超过单次上限 1000 封，请在邮箱客户端缩小范围',
}[code] || '邮箱操作未完成，请重试')

export class MailService {
  constructor({ settings, checkpoint, approve, notify = () => {}, onStatus = () => {},
    withInbox = withReadOnlyInbox, now = () => new Date() }) {
    Object.assign(this, { settings, checkpoint, approve, notify, onStatus, withInbox, now })
    this.tokens = new Map()
    this.controller = new AbortController()
    this.state = { status: 'idle', lastCheck: null }
  }
  snapshot() { return { ...this.settings.snapshot(), ...this.state } }
  publish(value) { this.state = { ...this.state, ...value }; this.onStatus(this.snapshot()) }
  reset() {
    this.tokens.clear()
    this.controller.abort()
    this.controller = new AbortController()
  }
  token(value) {
    const time = this.now().getTime()
    for (const [key, entry] of this.tokens) if (entry.expires <= time) this.tokens.delete(key)
    if (this.tokens.size >= 2048) throw failure('MAIL_TOO_MANY')
    const key = `mail:${randomBytes(16).toString('hex')}`
    this.tokens.set(key, { ...value, expires: time + 10 * 60 * 1000 })
    return key
  }
  lookup(key, kind, account) {
    const value = this.tokens.get(key)
    if (!value || value.kind !== kind || value.account !== accountId(account) ||
        value.expires <= this.now().getTime()) throw failure('MAIL_TOKEN_EXPIRED')
    return value
  }
  async run(work, signal = new AbortController().signal) {
    signal.throwIfAborted()
    if (this.inFlight) throw failure('MAIL_BUSY')
    const account = this.settings.credentials()
    const abort = AbortSignal.any([signal, this.controller.signal])
    this.inFlight = this.withInbox(account, { signal: abort }, client => work(client, account, abort))
    try { return await this.inFlight } finally { this.inFlight = null }
  }
  async consent(action, signal) {
    signal.throwIfAborted()
    if (!await this.approve(action, signal)) throw failure('ACTION_DENIED')
    signal.throwIfAborted()
  }
  async list(target, { signal }) {
    const account = this.settings.credentials()
    const page = ['recent', 'today'].includes(target) ? null : this.lookup(target, 'page', account)
    await this.consent({ name: 'mail_list', target: `${account.user}\nINBOX · ${page?.scope || target}` }, signal)
    return this.run(async (client, current) => {
      if (accountId(current) !== accountId(account)) throw failure('MAIL_CHANGED')
      const box = mailboxIdentity(client)
      if (page && page.validity !== box.validity) throw failure('MAIL_CHANGED')
      let uids = page?.uids
      if (!uids) {
        const start = new Date(this.now()); start.setHours(0, 0, 0, 0)
        const end = new Date(start); end.setDate(end.getDate() + 1)
        // IMAP compares server calendar dates. Search conservatively, then
        // apply the user's actual local time interval before pagination.
        const since = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate() - 1))
        const before = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate() + 2))
        uids = client.mailbox.exists === 0 ? [] : uidList(await client.search(target === 'today'
          ? { since, before } : { seq: `${Math.max(1, client.mailbox.exists - 199)}:*` }, { uid: true }))
        if (target === 'today' && uids.length) {
          const dates = await client.fetchAll(uids, { uid: true, internalDate: true }, { uid: true })
          if (!Array.isArray(dates) || dates.length > uids.length || dates.some(value =>
            !uids.includes(value.uid) || !Number.isFinite(new Date(value.internalDate).getTime()))) throw failure('MAIL_CONNECTION_FAILED')
          uids = uidList(dates.filter(value => new Date(value.internalDate) >= start && new Date(value.internalDate) < end).map(value => value.uid))
        }
      }
      const selected = uids.slice(0, 20), remaining = uids.slice(20)
      const messages = selected.length ? await client.fetchAll(selected, { uid: true, envelope: true, internalDate: true }, { uid: true }) : []
      if (!Array.isArray(messages) || messages.length > 20 || messages.some(value => !selected.includes(value.uid))) throw failure('MAIL_CONNECTION_FAILED')
      const items = messages.sort((a, b) => b.uid - a.uid).map(message => {
        const source = { mailbox: 'INBOX', uidValidity: box.validity, uid: message.uid }
        const subject = clean(message.envelope?.subject) || '（无主题）'
        return { subject, from: clean(message.envelope?.from?.map(from => from.address || from.name).join(', ')),
          date: clean(message.internalDate?.toISOString?.() || '', 64), source,
          token: this.token({ kind: 'read', account: accountId(current), validity: box.validity, uid: message.uid, subject }) }
      })
      const total = page?.total ?? uids.length
      return { status: 'listed', untrusted: true, scope: page?.scope || target, total, items,
        missing: selected.length - items.length,
        next: remaining.length ? this.token({ kind: 'page', account: accountId(current), validity: box.validity,
          uids: remaining, total, scope: page?.scope || target }) : null }
    }, signal)
  }
  async read(target, { signal }) {
    const account = this.settings.credentials()
    const entry = this.lookup(target, 'read', account)
    await this.consent({ name: 'mail_read', target: `${account.user}\nINBOX / UID ${entry.uid}\n${entry.subject}` }, signal)
    return this.run(async (client, current, abort) => {
      if (accountId(current) !== accountId(account)) throw failure('MAIL_CHANGED')
      if (mailboxIdentity(client).validity !== entry.validity) throw failure('MAIL_CHANGED')
      return this.readMessage(client, entry.uid, entry.validity, entry.subject, abort)
    }, signal)
  }
  async readMessage(client, uid, validity, subject = '', signal) {
    signal?.throwIfAborted()
    if (mailboxIdentity(client).validity !== validity) throw failure('MAIL_CHANGED')
    const message = await client.fetchOne(String(uid), { size: true }, { uid: true })
    if (!message || !Number.isSafeInteger(message.size) || message.size < 0) throw failure('MAIL_CHANGED')
    if (message.size > 2 * 1024 * 1024) throw failure('MAIL_TOO_LARGE')
    const result = await client.fetchOne(String(uid), { source: true }, { uid: true })
    if (!Buffer.isBuffer(result?.source)) throw failure('MAIL_CHANGED')
    if (result.source.length > 2 * 1024 * 1024) throw failure('MAIL_TOO_LARGE')
    const mail = await simpleParser(result.source, { skipTextToHtml: true, skipImageLinks: true, maxHtmlLengthToParse: 2 * 1024 * 1024 })
    signal?.throwIfAborted()
    const bytes = Buffer.from(clean(mail.text || '', 2 * 1024 * 1024))
    const text = new TextDecoder().decode(bytes.subarray(0, 65536), { stream: true })
    return { status: 'read', untrusted: true, subject: clean(mail.subject) || subject,
      from: clean(mail.from?.value?.map(from => from.address || from.name).join(', ')),
      text, truncated: bytes.length > 65536, attachmentsOmitted: mail.attachments.length,
      source: { mailbox: 'INBOX', uidValidity: validity, uid } }
  }
  announcementCurrent(identity) {
    try { return this.settings.snapshot().contentAnnouncements === true && accountId(this.settings.credentials()) === identity }
    catch { return false }
  }
  async check(manual = false) {
    const state = this.settings.snapshot()
    if (!state.enabled || this.inFlight) return
    try {
      await this.run(async (client, account, signal) => {
        const box = mailboxIdentity(client), identity = accountId(account)
        let previous
        try {
          const raw = await readFile(this.checkpoint, 'utf8')
          if (raw.length <= 2048) previous = JSON.parse(raw)
        } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
        const same = previous?.account === identity && previous?.validity === box.validity &&
          Number.isSafeInteger(previous?.highest) && previous.highest >= 0 && previous.highest <= box.highest
        // A UID span contains at most 1000 messages. Process up to ten spans
        // per check and persist that cursor, so large bursts keep progressing.
        const highest = same ? Math.min(box.highest, previous.highest + 10000) : box.highest
        let arrived = 0
        const latest = []
        if (same) for (let start = previous.highest + 1; start <= highest; start += 1000) {
          const end = Math.min(highest, start + 999)
          const added = uidList(await client.search({ uid: `${start}:${end}` }, { uid: true })).filter(uid => uid >= start && uid <= end)
          arrived += added.length
          latest.push(...added.slice(0, 3)); latest.sort((a, b) => b - a); latest.length = Math.min(latest.length, 3)
        }
        signal.throwIfAborted()
        await writeFile(`${this.checkpoint}.tmp`, JSON.stringify({ account: identity, validity: box.validity, highest }), { mode: 0o600 })
        await rename(`${this.checkpoint}.tmp`, this.checkpoint)
        signal.throwIfAborted()
        if (arrived && (state.notifications || state.contentAnnouncements)) {
          let detail
          if (state.contentAnnouncements && this.announcementCurrent(identity)) {
            detail = { account: identity, items: [], failed: 0 }
            for (const uid of latest) {
              signal.throwIfAborted()
              try { detail.items.push(await this.readMessage(client, uid, box.validity, '', signal)) }
              catch (error) { signal.throwIfAborted(); if (error.code === 'MAIL_CHANGED') throw error; detail.failed++ }
            }
            signal.throwIfAborted()
            if (!this.announcementCurrent(identity)) return
          }
          await this.notify(arrived, detail)
        }
      })
      this.publish({ status: 'ready', lastCheck: this.now().toISOString(), message: '邮箱连接正常' })
    } catch (error) {
      if (this.controller.signal.aborted || error.name === 'AbortError') return
      this.publish({ status: 'error', message: mailMessage(error.code) })
    }
  }
  start() {
    clearInterval(this.timer)
    if (!this.settings.snapshot().enabled) return
    void this.check()
    this.timer = setInterval(() => { void this.check() }, 120000)
    this.timer.unref?.()
  }
  async stop() {
    clearInterval(this.timer)
    this.reset()
    await this.inFlight?.catch(() => {})
  }
  async forget() {
    await this.stop()
    await unlink(this.checkpoint).catch(error => { if (error.code !== 'ENOENT') throw error })
    this.publish({ status: 'idle', lastCheck: null, message: '未启用邮箱' })
  }
}
