import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { MailService } from '../electron/device-mail-service.mjs'

const require = createRequire(import.meta.url)
const { searchCompiler } = require(path.join(path.dirname(require.resolve('imapflow')), 'search-compiler.js'))
const account = { provider: 'qq', user: 'fixture@qq.com', password: 'fixture-code' }
const context = () => ({ signal: new AbortController().signal })

async function fixture(t, inbox) {
  await mkdir('artifacts', { recursive: true })
  const root = await mkdtemp(path.resolve('artifacts/mail-regression-'))
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(`${path.resolve('artifacts')}${path.sep}`))
    await rm(root, { recursive: true, force: true })
  })
  const notifications = []
  const options = { checkpoint: path.join(root, 'checkpoint.json'), settings: {
    snapshot: () => ({ enabled: true, notifications: true }), credentials: () => account,
  }, approve: async () => true, notify: count => notifications.push(count),
  withInbox: async (_account, { signal }, work) => { signal.throwIfAborted(); return work(inbox) },
  now: () => new Date('2026-10-22T10:00:00+08:00') }
  return { service: new MailService(options), options, notifications }
}

test('today filters exact local calendar boundaries before issuing paginated mail', async t => {
  const previousTimezone = process.env.TZ
  process.env.TZ = 'Asia/Shanghai'
  t.after(() => { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone })
  const compiled = []
  const messages = Array.from({ length: 47 }, (_, index) => {
    const uid = index + 1
    return { uid, envelope: { subject: `fixture ${uid}` },
      internalDate: new Date(uid <= 25 ? '2026-10-21T03:00:00Z'
        : uid <= 46 ? '2026-10-22T00:00:00Z' : '2026-10-23T00:00:00Z') }
  })
  const inbox = { mailbox: { uidValidity: 7n, uidNext: 48, exists: 47 },
    search: async query => {
      // Use the pinned driver's real serializer: local midnight is the prior
      // UTC date, and a server calendar search needs exact client filtering.
      compiled.push(searchCompiler({ enabled: new Set(), capabilities: new Map() }, query))
      return messages.map(message => message.uid)
    },
    fetchAll: async uids => messages.filter(message => uids.includes(message.uid)),
  }
  const f = await fixture(t, inbox)
  const first = await f.service.list('today', context())
  assert.equal(first.total, 21, 'yesterday and future mail must not inflate today coverage')
  assert.equal(first.items.length, 20)
  assert.deepEqual(first.items.map(message => message.source.uid), Array.from({ length: 20 }, (_, index) => 46 - index))
  assert.ok(first.next)
  const last = await f.service.list(first.next, context())
  assert.deepEqual(last.items.map(message => message.source.uid), [26])
  assert.equal(last.next, null)
  assert.ok(compiled.length > 0)
})

test('more than a thousand arrivals advance notification checkpoint instead of permanently failing', async t => {
  const inbox = { mailbox: { uidValidity: 9n, uidNext: 3, exists: 2 },
    search: async query => {
      const [start, end] = query.uid.split(':').map(Number)
      return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index)
    },
  }
  const f = await fixture(t, inbox)
  await f.service.check()
  assert.deepEqual(f.notifications, [])
  inbox.mailbox.uidNext = 1005
  inbox.mailbox.exists = 1004
  await f.service.check()
  assert.equal(f.service.snapshot().status, 'ready')
  assert.equal(f.notifications.reduce((sum, count) => sum + count, 0), 1002)
  assert.equal(JSON.parse(await readFile(f.options.checkpoint, 'utf8')).highest, 1004)
  await f.service.check()
  await new MailService(f.options).check()
  assert.equal(f.notifications.reduce((sum, count) => sum + count, 0), 1002, 'checks and restart must not redeliver the same arrivals')
})
