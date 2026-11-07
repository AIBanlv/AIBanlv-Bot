import { EventEmitter } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { providerJson } from './device-local-workspace.mjs'

const fail = (code, message) => Object.assign(new Error(message), { code })
const messages = {
  SERVER_UPDATE_REQUIRED: '当前服务暂不支持电脑创建角色，请稍后更新', BIND_REQUIRED: '请先扫码绑定并确认设备授权',
  FORBIDDEN: '文件或角色的账号归属不符，请重新选择', BUSY: '角色创建繁忙，请稍后重试', MEDIA_CONSENT_REQUIRED: '请先确认照片与声音的处理说明',
  ROLE_RESULT_UNKNOWN: '创建结果暂未确认，请刷新角色列表核对，不要重复提交', ROLE_TRAINING_UNCONFIRMED: '形象训练结果待确认，请先核对角色列表',
  PAID_PLAN_REQUIRED: '当前账号需要有效的付费套餐才能创建线上角色，请先开通或续费',
  PAID_STATUS_UNAVAILABLE: '暂时无法查询套餐状态，请稍后重试',
}
export class OnlineRoles extends EventEmitter {
  constructor({ channel, httpFetch, file, encryption, fetcher = fetch, pollMs = 4000 }) {
    super(); Object.assign(this, { channel, httpFetch, file, encryption, fetcher, pollMs }); this.jobs = []; this.writes = Promise.resolve()
    this.stateChanged = () => { if (this.pending && this.pending.scope !== this.scope()) this.abort?.abort() }
    channel.on('state', this.stateChanged); channel.on('revoked', this.stateChanged)
  }
  scope() { const { state, tenantId } = this.channel; return state.binding === 'bound' && state.connection === 'connected' && state.accountAuthReady
    ? JSON.stringify([state.deviceId, tenantId, state.owner]) : '' }
  snapshot() { const scope = this.scope(); return this.jobs.filter(job => job.scope === scope).map(({ scope, ...job }) => job) }
  publish() { this.emit('state', this.snapshot()) }
  async load() {
    try { const raw = await readFile(this.file, 'utf8'); if (raw.length > 100000 || !this.encryption.isEncryptionAvailable()) return
      const rows = JSON.parse(this.encryption.decryptString(Buffer.from(raw, 'base64')))
      if (Array.isArray(rows)) this.jobs = rows.filter(row => typeof row.scope === 'string' && /^[a-f0-9-]{36}$/.test(row.requestId)).slice(-30)
    } catch {}
  }
  save() {
    const rows = JSON.stringify(this.jobs.slice(-30))
    this.writes = this.writes.then(async () => {
      if (!this.encryption.isEncryptionAvailable()) return
      await writeFile(`${this.file}.tmp`, this.encryption.encryptString(rows).toString('base64'), { mode: 0o600 }); await rename(`${this.file}.tmp`, this.file)
    }).catch(() => {})
    return this.writes
  }
  async request(operation, payload, signal) {
    signal?.throwIfAborted()
    const scope = this.scope(); if (!scope) throw fail('BIND_REQUIRED', messages.BIND_REQUIRED)
    const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)])
    const response = await this.httpFetch('https://scrm.ieasysell.com/jwt/client/desktop/role-creation', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ operation, payload }), signal: requestSignal,
    })
    let result
    try { result = await providerJson({ ok: true, body: response.body }, 16384) }
    catch { throw fail('ROLE_UNAVAILABLE', '角色服务响应异常，请检查连接后核对结果') }
    requestSignal.throwIfAborted()
    if (scope !== this.scope()) throw fail('BIND_REQUIRED', messages.BIND_REQUIRED)
    if (!response.ok || ![0, 200].includes(result?.code)) throw fail(result?.msg || 'ROLE_UNAVAILABLE', messages[result?.msg] || '角色创建未完成，请检查连接后核对结果')
    if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw fail('ROLE_UNAVAILABLE', '角色服务响应异常，请检查连接后核对结果')
    return result.data
  }
  async upload(kind, media, signal) {
    const extension = kind === 'photo' ? 'png' : media.extension
    const ticket = await this.request('role_upload', { type: kind, size: media.bytes.length, extension }, signal)
    if (!ticket || typeof ticket.token !== 'string' || ticket.token.length > 8192 ||
        !/^desktop-roles\/[a-f0-9-]{36}\.(png|jpg|webp|wav|mp3|m4a|ogg)$/.test(ticket.key) || ticket.url !== `https://zhanlvgpt.ieasysell.com/${ticket.key}`) throw fail('ROLE_UPLOAD', '上传凭据无效，请重试')
    const body = new FormData(); body.set('token', ticket.token); body.set('key', ticket.key); body.set('file', new Blob([media.bytes]), `sample.${extension}`)
    const response = await this.fetcher('https://up-cn-east-2.qiniup.com', { method: 'POST', redirect: 'error', signal, body })
    let result
    try { result = await providerJson(response) }
    catch { throw fail('ROLE_UPLOAD', '角色素材上传失败，请检查网络后重试；本次尚未提交训练') }
    signal.throwIfAborted()
    if (result.key !== ticket.key) throw fail('ROLE_UPLOAD', '上传结果未确认，请重新选择文件')
    return ticket.key
  }
  async create(value, media) {
    if (!this.scope()) throw fail('BIND_REQUIRED', messages.BIND_REQUIRED)
    if (this.pending) throw fail('BUSY', messages.BUSY)
    if (!value.consent) throw fail('MEDIA_CONSENT_REQUIRED', messages.MEDIA_CONSENT_REQUIRED)
    if (!media.photo || !media.voice || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 ||
      typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 5000 || !/^[a-f0-9-]{36}$/.test(value.requestId)) throw fail('INVALID_ROLE', '请检查照片、声音、名称与提示词（线上最多 5000 字）')
    let job = this.jobs.find(job => job.scope === this.scope() && job.requestId === value.requestId)
    const abort = this.abort = new AbortController(), signal = AbortSignal.any([abort.signal, AbortSignal.timeout(6 * 60000)])
    this.pending = { scope: this.scope() }
    try {
      if (!job) {
        const photoKey = await this.upload('photo', media.photo, signal), voiceKey = await this.upload('voice', media.voice, signal)
        job = { scope: this.scope(), requestId: value.requestId, name: value.name.trim(), status: 'processing' }
        this.jobs.push(job); await this.save(); this.publish()
        try {
          const result = await this.request('role_create', { requestId: value.requestId, name: value.name.trim(), description: String(value.description || '').slice(0, 500), prompt: value.prompt.trim(), photoKey, voiceKey, consent: true }, signal)
          Object.assign(job, result)
        } catch (error) {
          // These rejections happen before server admission. Unknown outcomes must retain the job.
          if (['PAID_PLAN_REQUIRED', 'PAID_STATUS_UNAVAILABLE'].includes(error.code)) this.jobs = this.jobs.filter(row => row !== job)
          throw error
        }
      }
      while (job.status === 'processing') {
        this.publish(); await delay(this.pollMs, undefined, { signal })
        Object.assign(job, await this.request('role_create_status', { requestId: job.requestId }, signal)); await this.save()
      }
      if (job.status !== 'completed' || !job.agentId) throw fail(job.code || 'ROLE_CREATE_FAILED', messages[job.code] || '角色创建未完成，请核对形象与声音后重试')
      return { ok: true, agentId: job.agentId, message: '线上角色已创建，可在电脑和手机查看' }
    } finally { this.pending = null; this.abort = null; await this.save(); this.publish() }
  }
  async refresh() {
    for (const job of this.jobs.filter(job => job.scope === this.scope() && job.status === 'processing')) {
      try { Object.assign(job, await this.request('role_create_status', { requestId: job.requestId })) } catch {}
    }
    await this.save(); this.publish()
  }
  async dispose() { this.abort?.abort(); this.channel.removeListener('state', this.stateChanged); this.channel.removeListener('revoked', this.stateChanged); await this.writes }
}
