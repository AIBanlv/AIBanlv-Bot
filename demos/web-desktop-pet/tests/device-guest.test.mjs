import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DeviceHttpAuth, isGuestDevice } from '../electron/device-http-auth.mjs'
import { getGuestScore, billingDeviceId } from '../electron/device-score.mjs'
import { createDeviceSession, validateSession } from '../electron/device-session.mjs'
import { modelRoute } from '../electron/device-model-settings.mjs'

const origin = 'https://scrm.ieasysell.com'
const deviceId = 'zhanlv:desktop-12345678-1234-1234-1234-123456789abc'
const profile = { agentId: 'public-role', source: 'online', publicAvatar: true, voiceId: 'stored-cosyvoice', language: 'zh' }
const grant = overrides => ({ provider: 'control-realtime', sessionId: 'guest-fixture', relayTicket: 'a'.repeat(64),
  anonymous: true, modelId: 'qwen-audio-3.0-realtime-flash', voiceId: 'longanlingxi', outputSampleRate: 24000,
  wsUrl: '/ws/control/desktop/guest-realtime', instructions: 'fixture', expiresAt: Date.now() + 60000, ...overrides })
function fixture(t, respond) {
  const channel = new EventEmitter()
  channel.state = { deviceId, binding: 'unbound', connection: 'connected' }
  channel.tenantId = ''; channel.controllerUserId = ''
  channel.bindingOffer = () => channel.state.binding === 'unbound' ? { bindToken: 'fixture-offer' } : null
  const calls = []
  const auth = new DeviceHttpAuth({ channel, proof: () => assert.fail('Guests must not obtain an account JWT'),
    hardware: async () => 'c'.repeat(64),
    fetchImpl: async (url, options) => { calls.push({ url, options }); return url.endsWith('/identity') ? Response.json({ code: 0, data: { registered: true } }) : respond(url, options) } })
  t.after(() => auth.dispose())
  return { auth, channel, calls }
}

test('guest status and session use only dedicated public paths and no account credentials or voice lookup', async t => {
  const f = fixture(t, async url => Response.json({ code: 0, data: url.endsWith('/status') ? { score: 800, anonymous: true } : grant() }))
  assert.equal(isGuestDevice(f.channel), true)
  assert.deepEqual(await getGuestScore({ deviceId, fetchImpl: f.auth.fetch }), { score: 800, anonymous: true })
  const session = await createDeviceSession({ deviceId, profile, anonymous: true, requestId: 'one', fetchImpl: f.auth.fetch })
  assert.equal(session.anonymous, true); assert.equal(session.authoritativeUsage, true)
  assert.equal(session.providerUrl, 'wss://scrm.ieasysell.com/ws/control/desktop/guest-realtime')
  assert.equal(f.calls.length, 3)
  assert.equal(f.calls[0].url, `${origin}/jwt/client/desktop-public/guest/identity`)
  assert.equal(f.calls[1].url, `${origin}/jwt/client/desktop-public/guest/status`)
  assert.equal(f.calls[2].url, `${origin}/jwt/client/desktop-public/guest/sessions`)
  for (const { options } of f.calls.slice(1)) {
    assert.equal(options.credentials, 'omit'); assert.equal(new Headers(options.headers).has('Authorization'), false)
    assert.equal(JSON.parse(options.body).deviceId, billingDeviceId(deviceId))
    assert.equal(Object.hasOwn(JSON.parse(options.body), 'tenantId'), false)
    assert.equal(Object.hasOwn(JSON.parse(options.body), 'voiceId'), false)
  }
})
test('unknown binding, offline or bound accounts never fall back to guest requests', async t => {
  const f = fixture(t, () => assert.fail('must not request'))
  for (const [binding, connection] of [['bound', 'connected'], ['unknown', 'connected'], ['unbound', 'offline']]) {
    Object.assign(f.channel.state, { binding, connection })
    assert.equal(isGuestDevice(f.channel), false)
    await assert.rejects(getGuestScore({ deviceId, fetchImpl: f.auth.fetch }))
  }
  Object.assign(f.channel.state, { binding: 'unbound', connection: 'connected' }); f.channel.tenantId = 'previous-account'
  assert.equal(isGuestDevice(f.channel), false)
  await assert.rejects(getGuestScore({ deviceId, fetchImpl: f.auth.fetch }))
  assert.equal(f.calls.length, 0)
})
test('a response arriving after binding is discarded instead of becoming a guest session', async t => {
  const f = fixture(t, () => { f.channel.state.binding = 'bound'; return Response.json({ code: 0, data: grant() }) })
  await assert.rejects(createDeviceSession({ deviceId, profile, anonymous: true, requestId: 'one', fetchImpl: f.auth.fetch }))
})
test('registered public guests use hardware quota while failed hardware registration requires binding', () => {
  const state = { profile, guest: true, connected: true, score: 800 }
  assert.equal(modelRoute({}, false, state).route, 'platform')
  assert.equal(modelRoute({}, false, { ...state, profile: { ...profile, publicAvatar: false } }).code, 'BIND_REQUIRED')
  assert.equal(modelRoute({}, false, { ...state, guest: false }).code, 'BIND_REQUIRED')
  assert.equal(modelRoute({}, false, { ...state, connected: false }).code, 'BIND_REQUIRED')
  assert.equal(modelRoute({}, false, { ...state, score: null }).code, 'SCORE_PENDING')
  assert.equal(modelRoute({}, false, { ...state, score: 29 }).code, 'SCORE_DEPLETED')
  assert.equal(modelRoute({}, false, { ...state, score: 30 }).route, 'platform')
  assert.equal(modelRoute({}, false, { ...state, scoreError: 'HARDWARE_ID_UNAVAILABLE' }).code, 'HARDWARE_ID_UNAVAILABLE')
  assert.equal(modelRoute({}, false, { ...state, scoreError: 'GUEST_LOGIN_REQUIRED' }).code, 'GUEST_LOGIN_REQUIRED')
  assert.equal(modelRoute({}, false, { ...state, bound: true, guest: false }).route, 'platform')
  assert.equal(modelRoute({ configured: true }, false, { ...state, profile: { agentId: 'local', source: 'local' } }).route, 'realtime')
})
test('guest grants cannot use bound relay routes, supplier keys, expired tickets or account identities', () => {
  assert.doesNotThrow(() => validateSession(grant(), {}, true))
  for (const overrides of [{ anonymous: false }, { wsUrl: '/ws/desktop-metered-realtime' }, { expiresAt: 1 },
    { apiKey: 'fixture' }, { billingTicket: 'fixture' }, { relayTicket: '' }]) {
    assert.throws(() => validateSession(grant(overrides), {}, true))
  }
  assert.throws(() => validateSession(grant(), {}))
})
test('guest quota failures do not invent a balance and instruct previously signed-in devices to bind', async () => {
  for (const data of [{ score: 800, anonymous: false }, { score: null, anonymous: true }, { score: -1, anonymous: true }]) {
    await assert.rejects(getGuestScore({ deviceId, fetchImpl: async () => Response.json({ code: 0, data }) }))
  }
  await assert.rejects(getGuestScore({ deviceId, fetchImpl: async () => Response.json({ code: 403, msg: 'GUEST_LOGIN_REQUIRED' }, { status: 403 }) }), { code: 'GUEST_LOGIN_REQUIRED' })
  await assert.rejects(createDeviceSession({ deviceId, profile, anonymous: true, requestId: 'empty',
    fetchImpl: async () => Response.json({ code: 402, msg: 'SCORE_DEPLETED' }, { status: 402 }) }),
  error => error.code === 'SCORE_DEPLETED' && /游客试用.*绑定/.test(error.message))
})
