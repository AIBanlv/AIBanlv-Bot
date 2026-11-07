import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { WebSocketServer } from 'ws'
import { DeviceHttpAuth } from '../electron/device-http-auth.mjs'
import { createDeviceSession, validateSession } from '../electron/device-session.mjs'
import { DeviceRealtime } from '../electron/device-realtime.mjs'

const production = 'https://scrm.ieasysell.com'
const profile = { agentId: 'agent-a', voiceId: 'longanqian' }
const grant = overrides => ({ provider: 'control-realtime', modelId: 'qwen-audio-3.0-realtime-flash',
  sessionId: 'session-fixture', relayTicket: 'a'.repeat(64), wsUrl: '/ws/desktop-metered-realtime',
  voiceId: profile.voiceId, instructions: 'fixture', expiresAt: Date.now() + 60000,
  outputSampleRate: 24000, anonymous: false, ...overrides })

test('desktop recovery errors retain actionable messages over HTTP and the relay', async t => {
  for (const [status, code] of [[409, 'DESKTOP_USAGE_UNRESOLVED'], [409, 'DESKTOP_SESSION_BUSY'], [503, 'DESKTOP_USAGE_UNAVAILABLE']]) {
    await assert.rejects(createDeviceSession({ deviceId: 'zhanlv:desktop-12345678-1234-1234-1234-123456789abc',
      profile, requestId: 'recovery', fetchImpl: async () => Response.json({ code: status, msg: code }, { status }) }),
    error => error.code === code && /用量|等待/.test(error.message))
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise(resolve => server.once('listening', resolve))
    server.on('connection', socket => socket.send(JSON.stringify({ type: 'error', error: { code } })))
    const client = new DeviceRealtime({ bootstrap: async () => validateSession(grant(), profile, false, `http://127.0.0.1:${server.address().port}`) })
    t.after(async () => { await client.dispose(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)) })
    const result = await client.send('hello', { textOnly: true })
    assert.equal(result.code, code); assert.equal(result.ok, false); assert.match(result.message, /用量|等待/)
  }
})

test('authoritative balance rejection stays SCORE_DEPLETED instead of becoming a network error', async t => {
  const server=new WebSocketServer({host:'127.0.0.1',port:0})
  await new Promise(resolve => server.once('listening',resolve))
  server.on('connection',socket => socket.send(JSON.stringify({type:'error',error:{code:'SCORE_DEPLETED'}})))
  const client=new DeviceRealtime({bootstrap:async () => validateSession(grant(),profile,false,`http://127.0.0.1:${server.address().port}`)})
  t.after(async () => {await client.dispose();for(const socket of server.clients) socket.terminate();await new Promise(resolve => server.close(resolve))})
  const result=await client.send('hello',{textOnly:true})
  assert.equal(result.code,'SCORE_DEPLETED');assert.equal(result.ok,false)
})

test('platform grants expose a same-origin relay without provider or client billing credentials', async () => {
  for (const [baseOrigin, expected] of [[production, 'wss://scrm.ieasysell.com/ws/desktop-metered-realtime'],
    ['http://127.0.0.1:8087', 'ws://127.0.0.1:8087/ws/desktop-metered-realtime'],
    ['http://[::1]:8087', 'ws://[::1]:8087/ws/desktop-metered-realtime'],
    ['https://localhost:8087', 'wss://localhost:8087/ws/desktop-metered-realtime']]) {
    const session = await createDeviceSession({ deviceId: 'zhanlv:desktop-12345678-1234-1234-1234-123456789abc',
      profile, requestId: 'fixture', baseOrigin, fetchImpl: async () => Response.json({ code: 200, data: grant() }) })
    assert.equal(session.providerUrl, expected)
    assert.equal(session.authoritativeUsage, true)
    assert.equal(session.relayTicket, 'a'.repeat(64))
    assert.equal('apiKey' in session, false)
    assert.equal('billingTicket' in session, false)
  }
})

test('platform grant validation rejects direct provider credentials and URL injection', () => {
  for (const overrides of [{ provider: 'qwen-realtime', apiKey: 'old-key', billingTicket: 'old-ticket' },
    { apiKey: 'leaked-key' }, { billingTicket: 'old-ticket' }, { relayTicket: '' },
    { relayTicket: 'a'.repeat(63) + '\n' }, { anonymous: true },
    ...['wss://evil.test/ws/desktop-metered-realtime', 'wss://scrm.ieasysell.com/ws/desktop-metered-realtime',
      '//evil.test/ws/desktop-metered-realtime', '/ws/desktop-metered-realtime?ticket=leak', '/ws/desktop-metered-realtime#fragment',
      '/ws/desktop-metered-realtime/other'].map(wsUrl => ({ wsUrl }))]) {
    assert.throws(() => validateSession(grant(overrides), profile), { code: 'INVALID_SESSION' })
  }
  for (const baseOrigin of ['https://evil.test', 'http://scrm.ieasysell.com',
    'http://192.168.1.2:8087', 'http://localhost:8087/redirect', 'http://user:pass@localhost:8087']) {
    assert.throws(() => validateSession(grant(), profile, false, baseOrigin), { code: 'INVALID_SESSION' })
  }
})

test('HTTP debug origin rewrites token, private and public routes without allowing caller cross-origin requests', async t => {
  const channel = new EventEmitter()
  channel.state = { deviceId: 'device-fixture', binding: 'bound', connection: 'connected', accountAuthReady: true }
  channel.tenantId = '7'; channel.controllerUserId = '42'
  const origin = 'http://127.0.0.1:8087', calls = []
  const options = { channel, proof: () => 'f'.repeat(64), origin, fetchImpl: async (url, init) => {
    calls.push({ url, init })
    return Response.json({ code: 200, data: new URL(url).pathname.endsWith('/token')
      ? { deviceId: channel.state.deviceId, tenantId: '7', controllerUserId: '42',
        accessToken: 'fixture-jwt', expiresAt: Date.now() + 60000 } : [] })
  } }
  const auth = new DeviceHttpAuth(options)
  t.after(() => auth.dispose())
  assert.equal(auth.origin, origin)
  await auth.fetch(`${production}/jwt/client/aliBot/getBotListTWithPublic?tenantId=7`)
  await auth.fetch(`${production}/jwt/client/desktop-public/roles?tenantId=7`)
  assert.deepEqual(calls.map(row => row.url), [
    `${origin}/client/desktop-auth/token`, `${origin}/client/desktop/roles?tenantId=7`,
    `${origin}/client/desktop-public/roles`,
  ])
  assert.equal(calls[1].init.headers.authorization, 'Bearer fixture-jwt')
  assert.equal(calls[2].init.headers.authorization, undefined)
  await assert.rejects(auth.fetch('https://evil.test/jwt/client/desktop-public/roles'))
  assert.equal(calls.length, 3)
  for (const invalid of ['https://evil.test', 'http://192.168.1.2', `${origin}/path`, `${origin}?token=x`]) {
    assert.throws(() => new DeviceHttpAuth({ ...options, origin: invalid }))
  }
})

test('authoritative relay transport sends only its session ticket and never depends on client usage or billing', { timeout: 3000 }, async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => server.once('listening', resolve))
  let headers, received = [], billingCalls = 0, replies = 0
  server.on('connection', (socket, request) => {
    headers = request.headers
    socket.on('message', raw => {
      const value = JSON.parse(raw); received.push(value)
      if (value.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }))
      if (value.type === 'response.create') {
        const id = `reply-${++replies}`
        socket.send(JSON.stringify({ type: 'response.created', response: { id } }))
        socket.send(JSON.stringify({ type: 'response.text.delta', response_id: id, delta: '你好' }))
        socket.send(JSON.stringify({ type: 'response.done', response: { id, status: 'completed',
          output: [], ...(replies === 1 ? { usage: { total_tokens: 123 } } : {}) } }))
      }
    })
  })
  const client = new DeviceRealtime({
    bootstrap: async () => validateSession(grant(), profile, false, `http://127.0.0.1:${server.address().port}`),
    billingFactory: () => { billingCalls++; throw new Error('Client billing must stay disabled') },
  })
  t.after(async () => { await client.dispose(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)) })
  for (let i = 0; i < 2; i++) {
    const completed = new Promise((resolve, reject) => {
      const listener = row => {
        if (!['complete', 'error'].includes(row.type)) return
        client.off('event', listener)
        row.type === 'complete' ? resolve(row) : reject(new Error(`Reply failed: ${row.code}`))
      }
      client.on('event', listener)
    })
    assert.equal((await client.send('你好', { textOnly: true })).ok, true)
    await completed
  }
  assert.equal(headers['x-desktop-session'], 'a'.repeat(64))
  assert.equal(headers.authorization, undefined)
  assert.equal(billingCalls, 0)
  assert.equal(received.some(row => row.type === 'usage' || 'tokenCount' in row), false)
})
