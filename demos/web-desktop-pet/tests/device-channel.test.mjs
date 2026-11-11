import assert from 'node:assert/strict'
import test from 'node:test'
import { DeviceChannel, normalizeProfile, controlEndpoint } from '../electron/device-channel.mjs'

class Socket extends EventTarget {
  readyState = 0
  sent = []
  send(data) { this.sent.push(JSON.parse(data)) }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')) }
  message(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })) }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')) }
}
function fixture(t, options = {}) {
  const sockets = []
  const channel = new DeviceChannel({
    deviceId: 'zhanlv:desktop-test', endpoint: 'wss://scrm.ieasysell.com/ws/control',
    socketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket },
    qr: async text => `qr:${text}`,
    ...options,
  })
  t.after(() => channel.stop())
  channel.start()
  const socket = sockets[0]
  socket.open()
  return { channel, socket, sockets }
}
const bind = socket => socket.message({
  type: 'bind_success', deviceId: 'zhanlv:desktop-test', tenantId: 'tenant-a', controllerUserId: 'user-a',
})
const profile = { type: 'switch_avatar', deviceId: 'zhanlv:desktop-test',
  agentId: 'role-a', agentName: 'Role A', voiceId: 'cosyvoice-custom-a',
  zipUrl: 'https://qn.ieasysell.com/role-a.zip', profileVersion: 2 }

test('phone target metadata is allowlisted and cannot authorize itself', t => {
  const { channel, socket } = fixture(t)
  socket.message({ type: 'bind_success', deviceId: channel.state.deviceId, tenantId: 'tenant-a',
    controllerUserId: 'user-a', capabilities: { directTransferV1: true } })
  const received = []; channel.on('text', (...args) => received.push(args))
  for (const remoteTarget of ['codex', 'deepseek', 'harness', 'workbuddy']) {
    socket.message({ type: 'send_text', text: '普通问题', remoteTarget, requestId: remoteTarget })
    assert.equal(received.at(-1)[2].remoteTarget, remoteTarget)
    assert.equal(received.at(-1)[2].computerAuthorized, false)
  }
  socket.message({ type: 'send_text', text: '普通问题', remoteTarget: 'shell', requestId: 'invalid-tool' })
  assert.equal(received.length, 4)
  assert.equal(socket.sent.at(-1).code, 'INVALID_TOOL')
})

test('remote profiles cannot declare themselves local or bypass platform billing', t => {
  assert.equal(normalizeProfile({ ...profile, source: 'local' }).source, 'online')
  const { channel, socket } = fixture(t); bind(socket)
  const received = []; channel.on('profile', value => received.push(value))
  socket.message({ ...profile, source: 'local' })
  assert.equal(received[0].source, 'online')
})

test('refresh keeps a valid QR on its live socket and coalesces repeated clicks and duplicate offers', async t => {
  let renders = 0
  const { channel, socket, sockets } = fixture(t, { qr: async value => { renders++; return `qr:${value}` } })
  const offer = { type:'bind_offer',deviceId:channel.state.deviceId,bindToken:'fixture-qr-token',expireAt:Date.now()+60000,bound:false }
  socket.message(offer);socket.message(offer)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(renders,1);const previous = channel.state.qr
  assert.ok(previous)
  assert.equal(channel.refresh(),true);assert.equal(channel.refresh(),false)
  assert.equal(channel.state.qr,previous);assert.equal(sockets.length,1)
  socket.message(offer)
  assert.equal(channel.state.refreshing,false);assert.equal(channel.state.qr,previous);assert.equal(renders,1)
})

test('expired QR refresh has a registration deadline even if only heartbeat replies arrive', async t => {
  let now = Date.now()
  const { channel,socket,sockets } = fixture(t,{now:()=>now})
  socket.message({type:'bind_offer',deviceId:channel.state.deviceId,bindToken:'fixture-token',expireAt:now+1000,bound:false})
  await new Promise(resolve => setImmediate(resolve))
  now+=1001;channel.tick();assert.equal(channel.state.qr,'')
  now+=10000;socket.message({type:'pong'});channel.tick()
  now+=10000;socket.message({type:'pong'});channel.tick()
  assert.equal(sockets.length,2,'A stale QR service must not be kept alive forever by pongs')
})

test('bounded large desktop results still require the current binding; oversized commands remain rejected', t => {
  const { channel, socket } = fixture(t)
  socket.message({ type: 'bind_success', deviceId: channel.state.deviceId, tenantId: 'tenant-a', controllerUserId: 'user-a',
    capabilities: { desktopMomentsV1: true } })
  assert.equal(channel.state.desktopMomentsSupported, true)
  const received = []; channel.on('desktop-result', row => received.push(row))
  const row = { type: 'desktop_result', deviceId: channel.state.deviceId, tenantId: 'tenant-a', controllerUserId: 'user-a', data: 'x'.repeat(70000) }
  socket.message({ ...row, tenantId: 'other' }); assert.equal(received.length, 0)
  socket.message(row); assert.equal(received.length, 1)
  socket.message({ ...row, data: 'x'.repeat(4 * 1024 * 1024) }); assert.equal(received.length, 1)
  socket.message({ ...row, type: 'bind_success', controllerUserId: 'other' }); assert.equal(channel.state.owner, 'user-a')
})

test('startup registration retries even while the socket keeps receiving heartbeats', t => {
  let now = 1000
  const { channel, socket, sockets } = fixture(t, { now: () => now })
  const diagnostics = []
  channel.on('control-diagnostic', value => diagnostics.push(value))
  now += 10000
  socket.message({ type: 'pong' })
  channel.tick()
  assert.equal(socket.sent.filter(item => item.type === 'device_online').length, 2)
  assert.equal(sockets.length, 1, 'Retry registration on the existing socket first')
  now += 10000
  socket.message({ type: 'pong' })
  channel.tick()
  assert.equal(sockets.length, 2, 'A socket without a binding response must not stay healthy forever')
  assert.ok(diagnostics.some(value => value.code === 'REGISTRATION_TIMEOUT'))
})

test('confirmed bindings do not replay online registration or role configuration on every heartbeat', t => {
  let now = 1000
  const { channel, socket, sockets } = fixture(t, { now: () => now })
  const diagnostics = []
  channel.on('control-diagnostic', value => diagnostics.push(value))
  socket.message({ type: 'bind_success', deviceId: channel.state.deviceId,
    tenantId: 'tenant-a', controllerUserId: 'user-a', online: true })
  for (let n = 0; n < 5; n++) {
    now += 15000
    socket.message({ type: 'pong' })
    channel.tick()
  }
  assert.equal(sockets.length, 1)
  assert.equal(socket.sent.filter(item => item.type === 'device_online').length, 1)
  assert.deepEqual(diagnostics.find(value => value.code === 'BIND_CONFIRMED'), { code: 'BIND_CONFIRMED', online: true })
  assert.equal(JSON.stringify(diagnostics).includes('tenant-a'), false)
})

test('the heartbeat timer respects reconnect backoff and never reconnects a stopped channel', t => {
  let now = 1000
  const { channel, socket, sockets } = fixture(t, { now: () => now })
  socket.close()
  now += 60000
  channel.tick()
  assert.equal(sockets.length, 1)
  channel.stop()
  channel.tick()
  assert.equal(sockets.length, 1)
})

test('registers as a device, never a controller; binding gates profile application', t => {
  const { channel, socket } = fixture(t)
  assert.deepEqual(socket.sent[0], { type: 'device_online', role: 'device', deviceId: 'zhanlv:desktop-test' })
  const received = []
  channel.on('profile', item => received.push(item))
  socket.message(profile)
  assert.equal(received.length, 0)
  bind(socket)
  socket.message({ ...profile, deviceId: 'another-device' })
  assert.equal(received.length, 0)
  socket.message(profile)
  assert.equal(received[0].voiceId, profile.voiceId)
  assert.equal(channel.state.binding, 'bound')
  assert.equal(channel.controllerUserId, 'user-a')
})

test('catalog identity never infers a user from a tenant and is revoked on unbind', t => {
  const { channel, socket } = fixture(t)
  socket.message({ type: 'bind_success', deviceId: channel.state.deviceId, tenantId: 'tenant-only' })
  assert.equal(channel.controllerUserId, '')
  bind(socket)
  socket.message({ type: 'unbind', deviceId: channel.state.deviceId })
  assert.equal(channel.controllerUserId, '')
})

test('profile events distinguish desired-state replays from explicit phone selections', t => {
  const { channel, socket } = fixture(t)
  const received = []
  channel.on('profile', (value, requestId, type) => received.push({ value, requestId, type }))
  bind(socket)
  for (const type of ['agent_state_desired', 'switch_avatar', 'apply_agent_config', 'distribute_agent']) {
    socket.message({ ...profile, type, requestId: 'selection-request' })
    assert.deepEqual(received.at(-1), {
      value: normalizeProfile(profile), requestId: 'selection-request', type,
    })
  }
})

test('QR is server-issued, seconds/milliseconds normalize and late QR never revives after binding', async t => {
  const { channel, socket } = fixture(t)
  const expiry = Math.floor(Date.now() / 1000) + 900
  socket.message({ type: 'bind_offer', deviceId: 'zhanlv:desktop-test', bindToken: 'server-token', expireAt: expiry })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(channel.state.expiresAt, expiry * 1000)
  assert.equal(new URLSearchParams(new URL(channel.state.qr.slice(3)).hash.slice(1)).get('bindToken'), 'server-token')
  socket.message({ type: 'bind_offer', deviceId: 'zhanlv:desktop-test', bindToken: 'late-token', expireAt: expiry })
  bind(socket)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(channel.state.qr, '')
  assert.equal(channel.state.binding, 'bound')
  assert.equal(JSON.stringify(channel.state).includes('server-token'), false)
})

test('unbind clears private state and requests a fresh offer; disconnect is not a successful binding', t => {
  const { channel, socket } = fixture(t)
  bind(socket)
  socket.message({ type: 'bind_lost', deviceId: 'zhanlv:desktop-test' })
  assert.equal(channel.state.binding, 'unbound')
  assert.equal(channel.state.owner, '')
  assert.equal(socket.sent.at(-1).type, 'device_online')
  socket.close()
  assert.equal(channel.state.connection, 'offline')
  assert.equal(channel.state.qr, '')
})

test('answers heartbeat and reports real application status with the delivered voice', t => {
  const { channel, socket } = fixture(t)
  socket.message({ type: 'ping' })
  assert.deepEqual(socket.sent.at(-1), { type: 'pong', deviceId: 'zhanlv:desktop-test' })
  assert.equal(channel.report(profile, 'applied'), false)
  bind(socket)
  assert.equal(channel.report(normalizeProfile(profile), 'applied'), true)
  assert.equal(socket.sent.at(-1).type, 'agent_state_report')
  assert.equal(socket.sent.at(-1).voiceId, profile.voiceId)
})

test('agent reports accept only the server applyStatus contract and preserve failure details', t => {
  const { channel, socket } = fixture(t)
  assert.equal(channel.report(profile, 'unknown'), false)
  bind(socket)
  for (const status of ['unknown', 'applied', 'failed']) {
    const lastError = status === 'failed' ? 'avatar download failed' : ''
    assert.equal(channel.report(profile, status, lastError), true)
    assert.deepEqual(socket.sent.at(-1), {
      ...normalizeProfile(profile), type: 'agent_state_report', deviceId: channel.state.deviceId,
      applyStatus: status, ...(lastError ? { lastError } : {}),
    })
  }
  const sent = socket.sent.length
  for (const status of ['loading', 'downloading', 'rendering', '', null, undefined, {}]) {
    assert.equal(channel.report(profile, status), false)
  }
  assert.equal(socket.sent.length, sent)
})

test('invalid profile and insecure/credential-bearing endpoints are rejected', () => {
  assert.throws(() => normalizeProfile({ ...profile, voiceId: {} }))
  assert.throws(() => normalizeProfile({ ...profile, agentId: '', avatarId: '' }))
  assert.throws(() => normalizeProfile({ ...profile, profileVersion: -1 }))
  assert.equal(normalizeProfile({ ...profile, zipUrl: undefined, zip_path: profile.zipUrl }).zipUrl, profile.zipUrl)
  assert.throws(() => controlEndpoint('ws://remote.example/ws/control'))
  assert.throws(() => controlEndpoint('wss://user:password@example.com/ws/control'))
  assert.equal(controlEndpoint('ws://127.0.0.1:1234/ws/control'), 'ws://127.0.0.1:1234/ws/control/desktop')
})

test('desktop connects to its dedicated route including existing environment overrides', t => {
  assert.equal(controlEndpoint(), 'wss://scrm.ieasysell.com/ws/control/desktop')
  assert.equal(controlEndpoint('wss://crm.ieasysell.com/ws/control'), 'wss://crm.ieasysell.com/ws/control/desktop')
  assert.equal(controlEndpoint('wss://crm.ieasysell.com/ws/control/desktop'), 'wss://crm.ieasysell.com/ws/control/desktop')
  assert.throws(() => controlEndpoint('wss://crm.ieasysell.com/ws/control/other'))
  assert.throws(() => controlEndpoint('wss://crm.ieasysell.com/ws/control/desktop?token=secret'))
  let connected
  const channel = new DeviceChannel({ deviceId: 'zhanlv:desktop-test',
    endpoint: 'wss://scrm.ieasysell.com/ws/control', qr: async text => text,
    socketFactory: url => { connected = url; return new Socket() } })
  t.after(() => channel.stop())
  channel.start()
  assert.equal(connected, 'wss://scrm.ieasysell.com/ws/control/desktop')
})

test('profiles and text from an explicitly different owner or tenant are rejected', t => {
  const { channel, socket } = fixture(t)
  const received = []
  channel.on('profile', value => received.push(value))
  channel.on('text', value => received.push(value))
  bind(socket)
  socket.message({ ...profile, controllerUserId: 'user-b' })
  socket.message({ ...profile, tenantId: 'tenant-b' })
  socket.message({ type: 'send_text', text: 'old owner text', controllerUserId: 'user-b' })
  assert.equal(received.length, 0)
  socket.message({ ...profile, controllerUserId: 'user-a', tenantId: 'tenant-a' })
  assert.equal(received.length, 1)
})

test('the same controller binding under a different tenant revokes previous profiles', t => {
  const { channel, socket } = fixture(t)
  let revoked = 0
  channel.on('revoked', () => revoked++)
  bind(socket)
  bind(socket)
  assert.equal(revoked, 0)
  socket.message({ type: 'bind_success', deviceId: 'zhanlv:desktop-test',
    controllerUserId: 'user-a', tenantId: 'tenant-b' })
  assert.equal(revoked, 1)
  assert.equal(channel.tenantId, 'tenant-b')
  assert.equal(channel.state.binding, 'bound')
})

test('controller text carries the durable transcript fields the backend resolves', t => {
  const { channel, socket } = fixture(t)
  const received = []
  channel.on('text', (value, requestId, metadata) => received.push({ value, requestId, metadata }))
  bind(socket)
  socket.message({ type: 'send_text', deviceId: 'zhanlv:desktop-test', text: '你在吗', requestId: 'ask',
    agentId: 'role-1', websocketSessionId: 'session-1', historyUserMessageId: 'a'.repeat(32), originSessionId: 'phone-socket-1' })
  assert.equal(received.length, 1)
  assert.equal(received[0].value, '你在吗')
  assert.equal(received[0].requestId, 'ask')
  assert.deepEqual(received[0].metadata,
    { agentId: 'role-1', websocketSessionId: 'session-1', historyUserMessageId: 'a'.repeat(32), originSessionId: 'phone-socket-1', computerAuthorized: false })
})

test('a history request only asks for a snapshot and never reaches the pet', t => {
  const { channel, socket } = fixture(t)
  const texts = [], histories = []
  channel.on('text', value => texts.push(value))
  channel.on('history', (agentId, requestId) => histories.push({ agentId, requestId }))
  bind(socket)
  socket.message({ type: 'send_text', deviceId: 'zhanlv:desktop-test', operation: 'sync_history',
    requestId: 'sync', agentId: 'role-1' })
  assert.equal(texts.length, 0)
  assert.deepEqual(histories, [{ agentId: 'role-1', requestId: 'sync' }])
})

test('tool readiness refresh asks for a tools-only snapshot without starting a chat', t => {
  const { channel, socket } = fixture(t)
  const received = []
  channel.on('text', () => assert.fail('readiness must not reach a model'))
  channel.on('history', (...args) => received.push(args))
  bind(socket)
  socket.message({ type: 'send_text', deviceId: 'zhanlv:desktop-test', operation: 'sync_tools',
    requestId: 'tools-sync', agentId: 'role-1' })
  assert.deepEqual(received, [['role-1', 'tools-sync', { toolsOnly: true }]])
})

test('a stored history receipt is forwarded once the transcript row is durable', t => {
  const { channel, socket } = fixture(t)
  const received = []
  channel.on('reply-saved', (id, metadata) => received.push({ id, metadata }))
  bind(socket)
  socket.message({ type: 'reply_saved', deviceId: 'zhanlv:desktop-test', messageId: 'remote-1',
    historyMessageId: 'b'.repeat(32), timestamp: 1700000000000 })
  assert.equal(received.length, 1)
  assert.equal(received[0].id, 'remote-1')
  assert.equal(received[0].metadata.historyMessageId, 'b'.repeat(32))
  assert.equal(received[0].metadata.timestamp, 1700000000000)
})

test('control rejection exposes the server code, reason and request ID without the raw payload', t => {
  const { channel, socket } = fixture(t)
  socket.message({ type: 'error', code: 'INVALID_MESSAGE', message: 'unsupported message type',
    requestId: 'req-control-1', bindToken: 'private-token', detail: { secret: 'private-detail' } })
  assert.equal(channel.state.error,
    '控制服务拒绝了请求 [INVALID_MESSAGE]：unsupported message type（requestId: req-control-1）')
  assert.equal(JSON.stringify(channel.state).includes('private-'), false)
})

test('control rejection handles missing, numeric and malformed diagnostic fields independently', t => {
  const { channel, socket } = fixture(t)
  for (const fields of [{}, { code: {}, message: [], requestId: true }, { code: ' ', message: ' ' }]) {
    socket.message({ type: 'error', ...fields })
    assert.equal(channel.state.error, '控制服务拒绝了请求 [UNKNOWN]，请刷新连接后重试')
  }
  socket.message({ type: 'error', code: 403, message: 'request denied' })
  assert.equal(channel.state.error, '控制服务拒绝了请求 [403]：request denied')
  socket.message({ type: 'error', code: 'INTERNAL_ERROR', message: {}, requestId: 'req-control-2' })
  assert.equal(channel.state.error,
    '控制服务拒绝了请求 [INTERNAL_ERROR]，请刷新连接后重试（requestId: req-control-2）')
  socket.message({ type: 'error', code: null, message: 'request failed', requestId: [] })
  assert.equal(channel.state.error, '控制服务拒绝了请求 [UNKNOWN]：request failed')
})

test('control diagnostics are bounded single-line text even with control characters', t => {
  const { channel, socket } = fixture(t)
  socket.message({ type: 'error', code: ' INVALID_MESSAGE\n', message: 'invalid\r\nmessage\u0000\u202e',
    requestId: '\treq-control-3\u007f' })
  assert.equal(channel.state.error,
    '控制服务拒绝了请求 [INVALID_MESSAGE]：invalid message（requestId: req-control-3）')
  socket.message({ type: 'error', code: 'C'.repeat(100), message: 'M'.repeat(1000), requestId: 'R'.repeat(1000) })
  assert.equal(channel.state.error,
    `控制服务拒绝了请求 [${'C'.repeat(64)}]：${'M'.repeat(300)}（requestId: ${'R'.repeat(128)}）`)
})

test('binding rejection keeps its diagnostics and the existing recovery behavior', t => {
  const { channel, socket } = fixture(t)
  let revoked = 0
  channel.on('revoked', () => revoked++)
  for (const code of ['DEVICE_NOT_BOUND', 'BIND_REQUIRED']) {
    bind(socket)
    socket.message({ type: 'error', code, message: 'device is not bound' })
    assert.equal(channel.state.error, `控制服务拒绝了请求 [${code}]：device is not bound`)
    assert.equal(channel.state.binding, 'unbound')
    assert.equal(channel.state.owner, '')
    assert.equal(socket.sent.at(-1).type, 'device_online')
    bind(socket)
    assert.equal(channel.state.error, '')
  }
  assert.equal(revoked, 2)
})

test('unrelated control errors do not change binding and stale errors cannot cross a reconnect', t => {
  const { channel, socket, sockets } = fixture(t)
  bind(socket)
  socket.message({ type: 'error', code: 'INTERNAL_ERROR', message: 'message could not be processed' })
  const rejection = channel.state.error
  assert.equal(rejection, '控制服务拒绝了请求 [INTERNAL_ERROR]：message could not be processed')
  assert.equal(channel.state.binding, 'bound')
  socket.message({ type: 'error', deviceId: 'another-device', code: 'OTHER_DEVICE' })
  assert.equal(channel.state.error, rejection)
  channel.connect()
  assert.equal(channel.state.error, '')
  sockets[1].open()
  socket.message({ type: 'error', code: 'OLD_CONNECTION' })
  assert.equal(channel.state.error, '')
})
