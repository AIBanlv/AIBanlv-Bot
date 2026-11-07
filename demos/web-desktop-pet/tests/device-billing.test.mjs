import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { DeviceBilling } from '../electron/device-billing.mjs'
import { BILLING_URL } from '../electron/device-session.mjs'

class Socket extends EventTarget {
  readyState = 0
  bufferedAmount = 0
  sent = []
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')) }
  send(raw) {
    if (this.readyState !== 1) throw new Error('socket unavailable')
    this.sent.push(JSON.parse(raw))
  }
  message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })) }
  close(code = 1000) {
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event('close'), { code }))
  }
}

function fixture(t, options = {}) {
  const socket = new Socket(), failures = [], connections = []
  const session = { sessionId: 'billing-fixture', billingTicket: 'fixture-ticket',
    deviceId: 'a'.repeat(64), agentId: 'agent-a', expiresAt: Date.now() + 600000 }
  const billing = new DeviceBilling({ session, timeoutMs: 100,
    socketFactory: (url, opts) => { connections.push({ url, opts }); return socket },
    onFailure: error => failures.push(error), ...options })
  t.after(() => socket.close(1001))
  const ready = () => socket.message({ type: 'session_ready', sessionId: session.sessionId, role: 'producer' })
  const ack = (sequence, duplicate = false) => socket.message({
    type: 'event_ack', sessionId: session.sessionId, sequence, duplicate,
  })
  return { billing, socket, failures, connections, session, ready, ack }
}

test('start requires authenticated producer readiness and registration contains no provider credential', async t => {
  const h = fixture(t)
  const started = h.billing.start()
  let ready = false
  started.then(() => { ready = true })
  h.socket.open()
  await Promise.resolve()
  assert.equal(ready, false)
  assert.equal(h.connections[0].url, BILLING_URL + h.session.sessionId)
  assert.deepEqual(h.socket.sent, [{ type: 'session_register', role: 'producer',
    sessionId: h.session.sessionId, deviceId: h.session.deviceId,
    agentId: h.session.agentId, billingTicket: h.session.billingTicket }])
  h.ready()
  await started
  assert.equal(ready, true)
})

test('events are FIFO, immutable, and ACKed before session_closed completes close', async t => {
  const h = fixture(t), started = h.billing.start()
  h.socket.open(); h.ready(); await started
  const fields = { finished: true, tokenCount: 42, responseId: 'response-a' }
  assert.equal(h.billing.report('session_started'), true)
  assert.equal(h.billing.report('output_started'), true)
  assert.equal(h.billing.report('usage', fields), true)
  fields.tokenCount = 999
  assert.equal(h.billing.report('output_completed', { finished: true }), true)
  const closed = h.billing.close()
  assert.equal(h.billing.report('output_started'), false)
  for (let sequence = 1; sequence <= 5; sequence++) {
    const message = h.socket.sent.at(-1)
    assert.equal(message.sequence, sequence)
    assert.equal(message.type, 'session_event')
    assert.equal(message.sessionId, h.session.sessionId)
    if (sequence === 3) assert.equal(message.tokenCount, 42)
    if (sequence === 5) {
      assert.equal(message.eventType, 'session_closed')
      assert.equal(message.finished, true)
    }
    h.ack(sequence)
  }
  assert.equal(await closed, true)
  assert.equal(h.socket.readyState, 3)
  assert.deepEqual(h.failures, [])
  assert.equal(await h.billing.close(), true)
})

test('wrong-session and listener ready messages cannot open the billing gate', async t => {
  for (const message of [
    { type: 'session_ready', sessionId: 'other', role: 'producer' },
    { type: 'session_ready', sessionId: 'billing-fixture', role: 'listener' },
  ]) {
    const h = fixture(t), rejected = assert.rejects(h.billing.start(), { code: 'BILLING_PROTOCOL_ERROR' })
    h.socket.open(); h.socket.message(message)
    await rejected
    assert.equal(h.failures.length, 1)
    assert.equal(h.billing.report('session_started'), false)
  }
})

test('server error without sessionId is fatal and never exposes its payload', async t => {
  const h = fixture(t), rejected = assert.rejects(h.billing.start(), { code: 'BILLING_REJECTED' })
  h.socket.open()
  h.socket.message({ type: 'error', code: 'SESSION_FORBIDDEN', message: 'fixture-secret', requestId: 'x' })
  await rejected
  assert.equal(h.failures.length, 1)
  assert.equal(h.failures[0].message.includes('fixture-secret'), false)
  assert.equal(await h.billing.close(), false)
})

test('disconnect immediately fails once, rejects further reports and does not retry the provider or transport', async t => {
  const h = fixture(t), started = h.billing.start()
  h.socket.open(); h.ready(); await started
  h.billing.report('usage', { tokenCount: 10, responseId: 'r1', finished: true })
  h.socket.close(1006)
  h.socket.dispatchEvent(new Event('error'))
  assert.equal(h.failures.length, 1)
  assert.equal(h.failures[0].code, 'BILLING_DISCONNECTED')
  assert.equal(h.billing.report('output_completed', { finished: true }), false)
  assert.equal(await h.billing.close(), false)
  assert.equal(h.connections.length, 1)
})

test('startup and missing ACK time out without hanging close', async t => {
  const h = fixture(t, { timeoutMs: 15 })
  await assert.rejects(h.billing.start(), { code: 'BILLING_TIMEOUT' })
  assert.equal(h.failures.length, 1)
  assert.equal(await h.billing.close(), false)
  const active = fixture(t, { timeoutMs: 15 }), started = active.billing.start()
  active.socket.open(); active.ready(); await started
  active.billing.report('session_started')
  assert.equal(await active.billing.close(), false)
  assert.equal(active.failures.length, 1)
})

test('duplicate response usage cannot be charged again under a new sequence', async t => {
  const h = fixture(t), started = h.billing.start()
  h.socket.open(); h.ready(); await started
  const usage = { tokenCount: 42, responseId: 'r1', finished: true }
  assert.equal(h.billing.report('usage', usage), true)
  h.ack(1)
  assert.equal(h.billing.report('usage', usage), true)
  assert.equal(h.socket.sent.filter(message => message.eventType === 'usage').length, 1)
  assert.equal(h.billing.report('usage', { ...usage, tokenCount: 43 }), false)
  assert.equal(h.failures[0].code, 'BILLING_INVALID_EVENT')
})

test('late duplicate ACKs are harmless but unknown sequence, wrong session and malformed messages fail closed', async t => {
  const h = fixture(t), started = h.billing.start()
  h.socket.open(); h.ready(); await started
  h.billing.report('session_started'); h.ack(1)
  h.billing.report('output_started'); h.ack(1, true)
  assert.equal(h.socket.sent.at(-1).sequence, 2)
  assert.deepEqual(h.failures, [])
  h.ack(2)
  for (const message of [
    { type: 'event_ack', sessionId: 'billing-fixture', sequence: 99, duplicate: false },
    { type: 'event_ack', sessionId: 'other', sequence: 1, duplicate: false },
    { type: 'event_ack', sessionId: 'billing-fixture', sequence: 1 },
    { type: 'pong', sessionId: 'other' },
    { type: 'session_ready', sessionId: 'billing-fixture', role: 'listener' },
    [], null,
  ]) {
    const f = fixture(t), ready = f.billing.start()
    f.socket.open(); f.ready(); await ready
    f.billing.report('session_started')
    f.socket.message(message)
    assert.equal(f.failures[0].code, 'BILLING_PROTOCOL_ERROR')
  }
})

test('bounded queue reserves the final close event instead of dropping prior events', async t => {
  const h = fixture(t, { timeoutMs: 1000 }), started = h.billing.start()
  h.socket.open(); h.ready(); await started
  for (let i = 0; i < 128; i++) assert.equal(h.billing.report('output_started'), true)
  const closed = h.billing.close()
  for (let sequence = 1; sequence <= 129; sequence++) {
    assert.equal(h.socket.sent.at(-1).sequence, sequence)
    h.ack(sequence)
  }
  assert.equal(await closed, true)
  assert.equal(h.failures.length, 0)
})

test('queue count and byte overflow stop the provider with a failure, never silently evict usage', async t => {
  for (const fields of [{}, { text: '\u4f60'.repeat(16384) }]) {
    const h = fixture(t, { timeoutMs: 1000 }), started = h.billing.start()
    h.socket.open(); h.ready(); await started
    let accepted = 0
    while (h.billing.report('assistant_transcript', fields)) accepted++
    assert.ok(accepted > 0 && accepted <= 128)
    assert.equal(h.failures.length, 1)
    assert.equal(h.failures[0].code, 'BILLING_QUEUE_FULL')
    assert.equal(await h.billing.close(), false)
  }
})

test('event fields cannot override identity or leak credentials and counts must be safe integers', async t => {
  for (const fields of [
    { sessionId: 'other' }, { sequence: 99 }, { apiKey: 'fixture-secret' },
    { usage: { total_tokens: 20 } }, { tokenCount: -1 }, { tokenCount: 1.5 },
    { tokenCount: Number.MAX_SAFE_INTEGER + 1 }, { tokenCount: 1 },
    { finished: 'true' }, { text: 'x'.repeat(16385) },
  ]) {
    const h = fixture(t), started = h.billing.start()
    h.socket.open(); h.ready(); await started
    assert.equal(h.billing.report('usage', fields), false)
    assert.equal(h.failures[0].code, 'BILLING_INVALID_EVENT')
    assert.equal(h.socket.sent.length, 1)
  }
})

test('normal server close substitutes for the final ACK only after all prior ACKs', async t => {
  const h = fixture(t), started = h.billing.start()
  h.socket.open(); h.ready(); await started
  h.billing.report('session_started'); h.ack(1)
  const closed = h.billing.close()
  h.socket.close(1000)
  assert.equal(await closed, true)
  assert.equal(h.failures.length, 0)
  const pending = fixture(t), ready = pending.billing.start()
  pending.socket.open(); pending.ready(); await ready
  pending.billing.report('session_started')
  const incomplete = pending.billing.close()
  pending.socket.close(1000)
  assert.equal(await incomplete, false)
  assert.equal(pending.failures[0].code, 'BILLING_DISCONNECTED')
})

test('heartbeat checks exact-session pong and stops after liveness timeout', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1800000000000 })
  const h = fixture(t), started = h.billing.start()
  h.socket.open(); h.ready(); await started
  t.mock.timers.tick(10000)
  assert.deepEqual(h.socket.sent.at(-1), { type: 'heartbeat', sessionId: h.session.sessionId })
  h.socket.message({ type: 'pong', sessionId: h.session.sessionId })
  t.mock.timers.tick(20000)
  assert.equal(h.failures.length, 0)
  t.mock.timers.tick(10000)
  assert.equal(h.failures[0].code, 'BILLING_TIMEOUT')
  const sent = h.socket.sent.length
  t.mock.timers.tick(60000)
  assert.equal(h.socket.sent.length, sent)
  assert.equal(h.failures.length, 1)
})

test('grant expiry stops an idle session and clears timers', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1800000000000 })
  const h = fixture(t, { session: { sessionId: 'billing-fixture', billingTicket: 'fixture-ticket',
    deviceId: 'a'.repeat(64), agentId: 'agent-a', expiresAt: Date.now() + 1000 } })
  const started = h.billing.start()
  h.socket.open(); h.ready(); await started
  t.mock.timers.tick(1000)
  assert.equal(h.failures[0].code, 'BILLING_EXPIRED')
  assert.equal(h.billing.report('session_started'), false)
  assert.equal(await h.billing.close(), false)
  t.mock.timers.tick(60000)
  assert.equal(h.failures.length, 1)
})

test('canceling startup rejects start without enabling reports or reconnecting', async t => {
  const h = fixture(t), rejected = assert.rejects(h.billing.start(), { code: 'BILLING_CLOSED' })
  assert.equal(await h.billing.close(), true)
  await rejected
  h.socket.open(); h.ready()
  assert.equal(h.billing.report('session_started'), false)
  assert.equal(h.socket.sent.length, 0)
  assert.equal(h.connections.length, 1)
})

test('native WebSocket exchanges registration, ACKs and close over localhost only', async t => {
  const require = createRequire(import.meta.url)
  const { Server: WebSocketServer } = require('ws')
  const httpServer = createServer()
  const server = new WebSocketServer({ server: httpServer })
  httpServer.listen(0, '127.0.0.1')
  await once(httpServer, 'listening')
  t.after(async () => {
    for (const socket of server.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
    await new Promise(resolve => httpServer.close(resolve))
  })
  const received = [], failures = []
  server.on('connection', socket => socket.on('message', raw => {
    const message = JSON.parse(raw.toString())
    received.push(message)
    socket.send(JSON.stringify(message.type === 'session_register'
      ? { type: 'session_ready', sessionId: message.sessionId, role: 'producer' }
      : { type: 'event_ack', sessionId: message.sessionId, sequence: message.sequence, duplicate: false }))
    if (message.eventType === 'session_closed') socket.close(1000)
  }))
  const billing = new DeviceBilling({
    session: { sessionId: 'local-fixture', billingTicket: 'fixture-ticket',
      deviceId: 'b'.repeat(64), agentId: 'agent-a', expiresAt: Date.now() + 60000 },
    socketFactory: (url, opts) => {
      assert.equal(url, BILLING_URL + 'local-fixture')
      return new WebSocket(`ws://127.0.0.1:${httpServer.address().port}`, opts)
    },
    onFailure: error => failures.push(error),
  })
  await billing.start()
  assert.equal(billing.report('session_started'), true)
  assert.equal(billing.report('usage', { tokenCount: 1200, responseId: 'r1', finished: true }), true)
  assert.equal(await billing.close(), true)
  assert.deepEqual(received.map(message => message.eventType || message.type),
    ['session_register', 'session_started', 'usage', 'session_closed'])
  assert.deepEqual(failures, [])
})
