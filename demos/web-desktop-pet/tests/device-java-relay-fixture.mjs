import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import { DeviceHttpAuth } from '../electron/device-http-auth.mjs'
import { createDeviceSession } from '../electron/device-session.mjs'
import { DeviceRealtime } from '../electron/device-realtime.mjs'

// Invoked only by DesktopRealtimeLocalIntegrationTest, never by the Node suite.
const origin = new URL(process.argv[2])
const interrupt = process.argv[3] === 'interrupt'
const budget = process.argv[3] === 'budget'
const recovery = process.argv[3] === 'recovery'
let connections = 0, firstResponse
const started = new Promise(resolve => { firstResponse = resolve })
assert.equal(origin.protocol, 'http:')
assert.equal(origin.hostname, '127.0.0.1')
const localFetch = async (target, options) => {
  assert.equal(new URL(target).origin, origin.origin, 'Fixture must never access a remote HTTP service')
  const response = await fetch(target, { ...options, redirect: 'error' })
  if (new URL(target).pathname === '/client/desktop/metered-realtime/sessions' && response.ok) {
    const grant = await response.clone().json()
    assert.equal(grant.data.provider, 'control-realtime')
    assert.equal('apiKey' in grant.data, false, 'HTTP grant must never expose the provider key')
    assert.equal('billingTicket' in grant.data, false, 'HTTP grant must never expose a billing ticket')
    assert.equal(JSON.stringify(grant).includes('synthetic-provider-key'), false)
  }
  return response
}
const channel = new EventEmitter()
channel.state = { deviceId: 'zhanlv:desktop-12345678-1234-1234-1234-123456789abc',
  binding: 'bound', connection: 'connected', accountAuthReady: true }
channel.tenantId = '7'; channel.controllerUserId = '42'
const auth = new DeviceHttpAuth({ channel, proof: () => 'f'.repeat(64), origin: origin.origin, fetchImpl: localFetch })
const client = new DeviceRealtime({
  bootstrap: async (requestId, signal) => {
    const session = await createDeviceSession({ deviceId: channel.state.deviceId,
      profile: { agentId: 'agent-a', voiceId: 'longanqian', language: 'zh' }, tenantId: '7', requestId, signal,
      fetchImpl: auth.fetch, baseOrigin: auth.origin })
    assert.equal(session.authoritativeUsage, true)
    assert.equal('apiKey' in session, false)
    assert.equal('billingTicket' in session, false)
    return session
  },
  billingFactory: () => { assert.fail('Authoritative usage must never open client billing') },
  socketFactory: (target, options) => {
    connections++
    const url = new URL(target)
    assert.equal(url.protocol, 'ws:')
    assert.equal(url.host, origin.host, 'Fixture must never access a remote WebSocket service')
    assert.equal(url.pathname, '/ws/desktop-metered-realtime')
    assert.equal(options.headers.Authorization, undefined)
    assert.match(options.headers['X-Desktop-Session'], /^[a-f0-9]{64}$/)
    const socket = new WebSocket(target, options)
    socket.on('message', raw => {
      if (JSON.parse(raw).type === 'response.created') firstResponse()
    })
    return socket
  },
})

try {
  let text = ''
  const completed = new Promise((resolve, reject) => {
    client.on('event', row => {
      if (row.type === 'assistant') text = row.text
      if (row.type === 'complete') resolve()
      if (row.type === 'error') reject(new Error(`Java relay reply failed: ${row.code}`))
    })
  })
  const sent = await client.send('hello local relay', { textOnly: true })
  assert.equal(sent.ok, true, JSON.stringify(sent))
  if (interrupt) {
    await started
    assert.equal(client.interrupt().ok, true)
    const next = await client.send('continue after interrupt', { textOnly: true })
    assert.equal(next.ok, true, JSON.stringify(next))
  }
  await completed
  assert.equal(text, 'fixture relay reply')
  assert.equal(connections, 1, 'Interrupted conversation must reuse its relay connection')
  if (budget) {
    const rejected = new Promise(resolve => client.on('event', row => {
      if (row.type === 'error') resolve(row)
    }))
    assert.equal((await client.send('must not reach provider', { textOnly: true })).ok, true)
    assert.equal((await rejected).code, 'SCORE_DEPLETED')
  }
  await client.dispose()
  const deadline = Date.now() + 8000
  let receipts
  while (Date.now() < deadline) {
    receipts = await (await localFetch(`${origin.origin}/fixture/receipts`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))),
    })).json()
    if (receipts.usageEvents === (recovery ? 2 : 1)) break
    await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))))
  }
  assert.equal(receipts.tokenCount, recovery ? 2430 : 1230)
  assert.equal(receipts.usageEvents, recovery ? 2 : 1)
  console.log(JSON.stringify({ ok: true, tokenCount: receipts.tokenCount, text }))
} finally {
  await client.dispose()
  auth.dispose()
}
