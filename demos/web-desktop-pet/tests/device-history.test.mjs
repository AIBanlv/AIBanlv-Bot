import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DeviceHistory } from '../electron/device-history.mjs'

function fixture(t, timeoutMs = 1000) {
  const channel = new EventEmitter()
  channel.state = { binding: 'bound', connection: 'connected', deviceId: 'device', owner: 'owner' }
  channel.tenantId = 'tenant'; channel.controllerUserId = 'owner'
  const sent = []
  channel.send = message => { sent.push(message); return true }
  const history = new DeviceHistory({ channel, timeoutMs })
  t.after(() => history.dispose())
  const reply = (rows = [], extra = {}) => channel.emit('device-history', {
    ...sent.at(-1), tenantId: 'tenant', controllerUserId: 'owner', history: rows, ...extra,
  })
  return { channel, sent, history, reply }
}

test('loads maximum history in server order and requests exact bound scope', async t => {
  const f = fixture(t)
  const rows = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: String(i).padEnd(400, 'x') }))
  const pending = f.history.load('role')
  assert.equal(f.sent[0].type, 'device_history_request')
  assert.equal(f.sent[0].deviceId, 'device'); assert.equal(f.sent[0].agentId, 'role')
  assert.match(f.sent[0].requestId, /^[0-9a-f-]{36}$/)
  f.reply(rows)
  assert.deepEqual(await pending, rows)
  assert.equal(f.channel.listenerCount('device-history'), 0)
})

test('guest returns empty without a request; confirmed empty bound history is valid', async t => {
  const f = fixture(t)
  f.channel.state.guest = true
  assert.deepEqual(await f.history.load('role'), []); assert.equal(f.sent.length, 0)
  f.channel.state.guest = false
  const pending = f.history.load('role'); f.reply()
  assert.deepEqual(await pending, [])
})

test('unrelated replies are ignored and correlated wrong identities are rejected', async t => {
  const f = fixture(t)
  for (const field of ['deviceId', 'agentId', 'tenantId', 'controllerUserId']) {
    const pending = f.history.load('role')
    f.reply([{ role: 'user', text: 'unrelated' }], { requestId: 'unrelated' })
    f.reply([], { [field]: 'other' })
    await assert.rejects(pending, { code: 'HISTORY_SCOPE_CHANGED' })
  }
})

test('binding changes reject pending requests and late results cannot repopulate history', async t => {
  const f = fixture(t)
  const pending = f.history.load('role')
  f.channel.controllerUserId = 'other'; f.channel.state.owner = 'other'
  f.channel.emit('state', f.channel.state)
  await assert.rejects(pending, { code: 'HISTORY_SCOPE_CHANGED' })
  f.reply([{ role: 'assistant', text: 'private old account' }])
  assert.equal(f.channel.listenerCount('device-history'), 0)
})

test('abort, timeout, disconnect and send failures produce explicit errors', async t => {
  const f = fixture(t, 10)
  const controller = new AbortController()
  const aborted = f.history.load('role', controller.signal); controller.abort()
  await assert.rejects(aborted, { code: 'HISTORY_CANCELLED' })
  await assert.rejects(f.history.load('role'), { code: 'HISTORY_TIMEOUT' })
  const offline = f.history.load('role'); f.channel.state.connection = 'offline'; f.channel.emit('state', f.channel.state)
  await assert.rejects(offline, { code: 'HISTORY_SCOPE_CHANGED' })
  await assert.rejects(f.history.load('role'), { code: 'HISTORY_UNAVAILABLE' })
  f.channel.state.connection = 'connected'; f.channel.send = () => false
  await assert.rejects(f.history.load('role'), { code: 'HISTORY_UNAVAILABLE' })
})

test('malformed, oversized and explicit error responses never become empty history', async t => {
  const f = fixture(t)
  for (const rows of [null, [{ role: 'system', text: 'unsafe' }], [{ role: 'user', text: '' }],
    Array(21).fill({ role: 'user', text: 'x' }), [{ role: 'user', text: 'x'.repeat(8001) }]]) {
    const pending = f.history.load('role'); f.reply(rows)
    await assert.rejects(pending, { code: 'HISTORY_INVALID' })
  }
  const pending = f.history.load('role'); f.reply([], { error: 'private details' })
  await assert.rejects(pending, error => error.code === 'HISTORY_UNAVAILABLE' && !error.message.includes('private details'))
})
