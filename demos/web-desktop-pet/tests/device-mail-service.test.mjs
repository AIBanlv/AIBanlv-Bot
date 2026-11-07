import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { MailService, mailAnnouncement } from '../electron/device-mail-service.mjs'

async function fixture(t) {
  await mkdir('artifacts', { recursive: true })
  const root = await mkdtemp(path.resolve('artifacts/mail-service-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const inbox = { mailbox: { uidValidity: 9n, uidNext: 26, exists: 25 },
    search: async () => Array.from({ length: 25 }, (_, i) => i + 1),
    fetchAll: async ids => ids.map(uid => ({ uid, envelope: { subject: `邮件 ${uid}`, from: [{ address: 'sender@example.com' }] }, internalDate: new Date('2026-10-22T00:00:00Z') })),
    fetchOne: async (_uid, query) => query.source ? { source: Buffer.from('From: sender@example.com\r\nSubject: =?UTF-8?B?5rWL6K+V?=\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>待办：确认合同</p><img src="https://tracking.invalid/x">') } : { size: 200 },
  }
  const state = { enabled: true, notifications: true }
  const approvals = [], notifications = []
  const options = { checkpoint: path.join(root, 'checkpoint.json'), settings: {
    snapshot: () => state, credentials: () => ({ provider: 'qq', user: 'fixture@qq.com', password: 'fixture-code' }),
  }, approve: async action => { approvals.push(action); return true },
  withInbox: async (_account, { signal }, work) => { signal.throwIfAborted(); return work(inbox) },
  notify: count => notifications.push(count), now: () => new Date('2026-10-22T10:00:00+08:00') }
  return { service: new MailService(options), options, inbox, state, approvals, notifications }
}
const context = () => ({ signal: new AbortController().signal })

test('startup checks an enabled mailbox even when notifications are off, without announcing history', async t => {
  const f = await fixture(t)
  f.state.notifications = false
  t.after(() => f.service.stop())
  f.service.start()
  const deadline = Date.now() + 3000
  while (!f.service.state.lastCheck) {
    assert.ok(Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(f.service.state.status, 'ready')
  assert.deepEqual(f.notifications, [])
})

test('confirmed mail pages issue bound read tokens and include sources without automatic body access', async t => {
  const f = await fixture(t)
  const first = await f.service.list('today', context())
  assert.equal(first.items.length, 20)
  assert.equal(first.total, 25)
  assert.ok(first.next)
  assert.equal(first.untrusted, true)
  assert.equal(first.items[0].source.mailbox, 'INBOX')
  assert.equal(first.items[0].source.uidValidity, '9')
  const second = await f.service.list(first.next, context())
  assert.equal(second.items.length, 5)
  assert.equal(second.next, null)
  assert.equal(f.approvals.length, 2)
  const body = await f.service.read(first.items[0].token, context())
  assert.match(body.text, /确认合同/)
  assert.equal(body.subject, '测试')
  assert.equal(body.untrusted, true)
  assert.equal(body.html, undefined)
  assert.equal(body.source.uid, 25)
  assert.doesNotMatch(JSON.stringify(body), /fixture-code|<img/)
})

test('mail denial, forged/stale tokens, changed UIDVALIDITY and cancellation fail closed', async t => {
  const f = await fixture(t)
  f.service.approve = async () => false
  await assert.rejects(f.service.list('recent', context()), /ACTION_DENIED/)
  await assert.rejects(f.service.read('mail:forged', context()), /MAIL_TOKEN_EXPIRED/)
  f.service.approve = async () => true
  const page = await f.service.list('recent', context())
  f.inbox.mailbox.uidValidity = 10n
  await assert.rejects(f.service.read(page.items[0].token, context()), /MAIL_CHANGED/)
  f.service.reset()
  await assert.rejects(f.service.read(page.items[0].token, context()), /MAIL_TOKEN_EXPIRED/)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(f.service.list('today', { signal: abort.signal }), /abort/i)
})

test('mail body size limits refuse large messages and flag truncated text', async t => {
  const f = await fixture(t)
  const page = await f.service.list('recent', context())
  f.inbox.fetchOne = async () => ({ size: 3 * 1024 * 1024 })
  await assert.rejects(f.service.read(page.items[0].token, context()), /MAIL_TOO_LARGE/)
  f.inbox.fetchOne = async (_uid, query) => query.source ? { source: Buffer.from(`Content-Type: text/plain; charset=utf-8\r\n\r\n${'很长的正文'.repeat(20000)}`) } : { size: 300000 }
  const body = await f.service.read(page.items[0].token, context())
  assert.equal(body.truncated, true)
  assert.ok(Buffer.byteLength(body.text) <= 65536)
})

test('notifications baseline, count only new UIDs, survive restart and reset on mailbox identity changes', async t => {
  const f = await fixture(t)
  await f.service.check()
  assert.deepEqual(f.notifications, [])
  f.inbox.mailbox.uidNext = 28
  f.inbox.search = async () => [26, 27]
  await f.service.check()
  assert.deepEqual(f.notifications, [2])
  await new MailService(f.options).check()
  assert.deepEqual(f.notifications, [2])
  f.inbox.mailbox.uidValidity = 10n
  f.inbox.mailbox.uidNext = 40
  await f.service.check()
  assert.deepEqual(f.notifications, [2])
  f.state.enabled = false
  await f.service.check()
  assert.deepEqual(f.notifications, [2])
})

test('content announcements require explicit opt-in, read at most three new bodies and do not replay history', async t => {
  const f = await fixture(t), details = [], reads = []
  f.state.contentAnnouncements = true; f.state.notifications = false
  const fetch = f.inbox.fetchOne
  f.inbox.fetchOne = async (uid,query,...rest) => { if(query.source)reads.push(Number(uid)); return fetch(uid,query,...rest) }
  f.service.notify = (count,detail) => details.push({count,detail})
  await f.service.check(); assert.deepEqual(reads,[])
  f.inbox.mailbox.uidNext = 31; f.inbox.search = async () => [26,27,28,29,30]
  await f.service.check()
  assert.deepEqual(reads,[30,29,28]); assert.equal(details[0].count,5)
  const spoken = mailAnnouncement(5,details[0].detail)
  assert.match(spoken,/确认合同/);assert.match(spoken,/正文节选，不是全文/);assert.match(spoken,/其余 2 封尚未读取/)
  assert.doesNotMatch(spoken,/<img|tracking.invalid|fixture-code/)
  assert.ok(f.service.announcementCurrent(details[0].detail.account))
  await f.service.check();assert.equal(details.length,1)
  f.state.contentAnnouncements=false
  assert.equal(f.service.announcementCurrent(details[0].detail.account),false)
})

test('count-only notifications never fetch bodies and opted-in read failures are explicit', async t => {
  const f = await fixture(t)
  f.inbox.fetchOne = async () => { throw new Error('should not read a body') }
  await f.service.check();f.inbox.mailbox.uidNext=27;f.inbox.search=async()=>[26]
  await f.service.check();assert.deepEqual(f.notifications,[1])
  f.state.contentAnnouncements=true
  const details=[];f.service.notify=(count,detail)=>details.push({count,detail})
  f.inbox.mailbox.uidNext=28;f.inbox.search=async()=>[27]
  await f.service.check()
  assert.equal(details[0].detail.failed,1)
  assert.match(mailAnnouncement(1,details[0].detail),/正文读取失败，尚未汇报/)
})

test('revoking content opt-in during body access prevents the pending body announcement', async t => {
  const f=await fixture(t);f.state.contentAnnouncements=true
  await f.service.check();f.inbox.mailbox.uidNext=27;f.inbox.search=async()=>[26]
  const fetch=f.inbox.fetchOne
  f.inbox.fetchOne=async(uid,query,...rest)=>{const result=await fetch(uid,query,...rest);if(query.source)f.state.contentAnnouncements=false;return result}
  await f.service.check();assert.deepEqual(f.notifications,[])
})

test('mail access rejects changed accounts after approval and remembers notification failures without leaking server errors', async t => {
  const f = await fixture(t)
  const previous = f.options.settings.credentials
  f.service.approve = async () => {
    f.options.settings.credentials = () => ({ provider: '163', user: 'other@163.com', password: 'other-fixture-code' })
    return true
  }
  await assert.rejects(f.service.list('today', context()), /MAIL_CHANGED/)
  f.options.settings.credentials = previous
  f.service.withInbox = async () => { throw new Error('server response includes secret-code') }
  await f.service.check()
  assert.equal(f.service.snapshot().status, 'error')
  assert.doesNotMatch(JSON.stringify(f.service.snapshot()), /secret-code|server response/)
})

test('pausing cancels in-flight mailbox work and forgetting removes issued tokens and the checkpoint', async t => {
  const f = await fixture(t)
  const page = await f.service.list('recent', context())
  await f.service.check()
  let entered
  const started = new Promise(resolve => { entered = resolve })
  f.service.withInbox = async (_account, { signal }) => {
    entered()
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    signal.throwIfAborted()
  }
  const checking = f.service.check()
  await started
  await f.service.stop()
  await checking
  await assert.rejects(f.service.read(page.items[0].token, context()), /MAIL_TOKEN_EXPIRED/)
  await f.service.forget()
  const { readFile } = await import('node:fs/promises')
  await assert.rejects(readFile(f.options.checkpoint), { code: 'ENOENT' })
})
