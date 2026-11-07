import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createDeviceSession, validateSession } from '../electron/device-session.mjs'

const deviceId = 'zhanlv:desktop-12345678-1234-1234-1234-123456789abc'
const profile = { agentId: 'agent-a', voiceId: 'longanqian', language: 'zh' }

test('the Windows session endpoint preserves the server insufficient-balance rejection', async () => {
  await assert.rejects(createDeviceSession({deviceId,profile,requestId:'depleted',fetchImpl:async url => {
    assert.equal(new URL(url).pathname,'/jwt/client/desktop/metered-realtime/sessions')
    return Response.json({code:402,msg:'SCORE_DEPLETED'},{status:402})
  }}),{code:'SCORE_DEPLETED'})
})
const grant = (overrides = {}) => ({
  sessionId: 'session-fixture', relayTicket: 'a'.repeat(64),
  provider: 'control-realtime', modelId: 'qwen-audio-3.0-realtime-flash',
  wsUrl: '/ws/desktop-metered-realtime',
  voiceId: 'longanqian', expiresAt: Date.now() + 600000,
  instructions: 'Fixture character', outputSampleRate: 24000, anonymous: false,
  ...overrides,
})

test('guest bootstrap rejects grants for the bound relay and surfaces trial depletion', async () => {
  await assert.rejects(createDeviceSession({ deviceId, profile: { ...profile, publicAvatar: true }, anonymous: true, requestId: 'guest-1',
    fetchImpl: async () => new Response(JSON.stringify({ code: 200, data: grant({ anonymous: true, anonymousRemainingScore: 800 }) })) }), { code: 'INVALID_SESSION' })
  await assert.rejects(createDeviceSession({ deviceId, profile: { ...profile, publicAvatar: true }, anonymous: true, requestId: 'guest-2',
    fetchImpl: async () => new Response(JSON.stringify({ code: 429, message: 'ANONYMOUS_SCORE_LIMIT_REACHED' })) }), { code: 'SCORE_DEPLETED' })
})

test('bound-device bootstrap hashes the entire identity and preserves role, voice and intent', async () => {
  let request, url
  const session = await createDeviceSession({ deviceId, profile, requestId: 'intent-1',
    fetchImpl: async (target, options) => {
      url = target; request = options
      return new Response(JSON.stringify({ code: 0, data: grant() }))
    } })
  assert.equal(url, 'https://scrm.ieasysell.com/jwt/client/desktop/metered-realtime/sessions')
  assert.equal(request.redirect, 'error')
  assert.equal(request.headers.Authorization, undefined)
  assert.deepEqual(JSON.parse(request.body), {
    agentId: 'agent-a', voiceId: 'longanqian', languageCode: 'zh', uiLocale: 'zh-CN',
    provider: 'qwen-realtime', outputMode: 'audio', speechFilterEnabled: false, clientRequestId: 'intent-1',
    deviceId: createHash('sha256').update(deviceId).digest('hex'),
  })
  assert.equal(session.deviceId, JSON.parse(request.body).deviceId)
  assert.equal(session.voiceId, 'longanqian')
  assert.equal(session.providerUrl, 'wss://scrm.ieasysell.com/ws/desktop-metered-realtime')
  assert.equal(session.authoritativeUsage, true)
})

test('the bound tenant travels with the request so a role keeps its conversation memory', async () => {
  let body
  await createDeviceSession({ deviceId, profile, tenantId: 'tenant-42', requestId: 'intent-1',
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body)
      return new Response(JSON.stringify({ code: 0, data: grant() })) } })
  assert.equal(body.tenantId, 'tenant-42')
  assert.equal(body.agentId, 'agent-a')
})

test('session credentials cannot be sent to injected, redirecting or non-provider endpoints', () => {
  for (const wsUrl of [
    'ws://dashscope.aliyuncs.com/api-ws/v1/realtime',
    'wss://dashscope.aliyuncs.com.evil.test/api-ws/v1/realtime',
    'wss://other.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime',
    'wss://dashscope.aliyuncs.com:8443/api-ws/v1/realtime',
    'wss://user:pass@dashscope.aliyuncs.com/api-ws/v1/realtime',
    'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?key=exfiltrate',
    'wss://dashscope.aliyuncs.com/redirect',
  ]) assert.throws(() => validateSession(grant({ wsUrl }), profile), { code: 'INVALID_SESSION' })
  assert.throws(() => validateSession(grant({
    wsUrl: 'wss://fixture.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime',
  }), profile), { code: 'INVALID_SESSION' })
  assert.doesNotThrow(() => validateSession(grant(), profile))
})

test('session validates expiry, native voice, model, relay grant and authenticated binding', () => {
  for (const overrides of [
    { apiKey: '' }, { billingTicket: '' }, { expiresAt: 1 }, { relayTicket: '' },
    { voiceId: 'longanlingxi' }, { voiceId: 'cosyvoice-v3.5-flash-fixture' },
    { modelId: 'another-model' }, { provider: 'ali-multimodal' },
    { anonymous: true }, { outputSampleRate: 48000 }, { speechFilterEnabled: true },
  ]) assert.throws(() => validateSession(grant(overrides), profile))
  assert.equal(validateSession(grant(), { ...profile, voiceId: 'opaque-db-id' }).voiceId, 'longanqian')
})

test('missing voices fail before minting credentials, errors do not leak secrets', async () => {
  for (const voiceId of ['', undefined]) {
    let calls = 0
    await assert.rejects(createDeviceSession({ deviceId, profile: { ...profile, voiceId }, requestId: 'intent',
      fetchImpl: () => { calls++; throw new Error('must not fetch') } }), { code: 'VOICE_INCOMPATIBLE' })
    assert.equal(calls, 0)
  }
  await assert.rejects(createDeviceSession({ deviceId, profile, requestId: 'intent',
    fetchImpl: async () => new Response(JSON.stringify({ code: 500, msg: 'secret-fixture-token' })) }),
  error => error.code === 'SESSION_UNAVAILABLE' && !error.message.includes('secret'))
})

test('bootstrap rejects oversized bodies, aborts and non-success envelopes', async () => {
  for (const response of [
    new Response('x'.repeat(70000)), new Response('{}'),
    new Response(JSON.stringify({ code: 401 }), { status: 401 }),
  ]) await assert.rejects(createDeviceSession({ deviceId, profile, requestId: 'intent', fetchImpl: async () => response }))
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(createDeviceSession({ deviceId, profile, requestId: 'intent', signal: abort.signal }))
})

const tenantId = 'bound-tenant'
const permittedScopes = [tenantId, '1508290699769155584', '24', '1']
const cosy = { id: 'cosy-row', elevenId: 'cosyvoice-v3.5-flash-fixture',
  voiceName: 'Companion · CosyVoice', tenantId, azureLanguage: 'cosyvoice-v3.5-flash' }
const realtime = { id: 'realtime-row', voice: 'qwen-audio-3.0-realtime-flash-fixture',
  voiceName: 'companion · Realtime', tenantId, azureLanguage: 'qwen-audio-3.0-realtime-flash' }
const envelope = data => new Response(JSON.stringify({ code: 200, data }))
const metadataPath = '/jwt/client/Voice/aliyun/listClientVoices'
const sessionPath = '/jwt/client/desktop/metered-realtime/sessions'
function mappingFixture(rows = [cosy, realtime], overrides = {}) {
  const requests = [], scopes = [], pages = []
  return { requests, scopes, pages, fetchImpl: async (target, options) => {
    const url = new URL(target)
    assert.equal(url.origin, 'https://scrm.ieasysell.com')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, undefined)
    if (url.pathname === metadataPath) {
      assert.equal(options.method, 'POST')
      assert.equal(options.headers['Content-Type'], 'application/json')
      assert.equal(url.search, '')
      const { tenantId: scope, pageIndex, pageSize } = JSON.parse(options.body)
      assert.deepEqual(JSON.parse(options.body), { tenantId: scope, pageIndex, pageSize: 100 })
      assert.ok(Number.isInteger(pageIndex) && pageIndex >= 0)
      if (pageIndex === 0) scopes.push(scope)
      pages.push({ tenantId: scope, pageIndex })
      const ownedRows = rows.filter(row => String(row.tenantId || row.tenant_id) === scope)
      return envelope({ localVoices: ownedRows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize) })
    }
    assert.equal(url.pathname, sessionPath)
    requests.push(JSON.parse(options.body))
    return envelope(grant({ voiceId: realtime.voice, ...overrides }))
  } }
}

test('CosyVoice provider and database aliases map to the paired Realtime row without changing the profile', async () => {
  for (const voiceId of [cosy.elevenId, cosy.id, 'legacy-alias', 'other-alias']) {
    const source = Object.freeze({ ...profile, voiceId })
    const f = mappingFixture([{ ...cosy, voice: 'legacy-alias', voiceId: 'other-alias' }, realtime])
    const result = await createDeviceSession({ deviceId, profile: source, tenantId, requestId: 'mapped', fetchImpl: f.fetchImpl })
    assert.equal(f.requests[0].voiceId, realtime.id)
    assert.equal(result.voiceId, realtime.voice)
    assert.equal(source.voiceId, voiceId)
    assert.deepEqual(f.scopes, permittedScopes)
  }
})

test('an opaque Realtime row is verified while native Realtime IDs skip metadata', async () => {
  const f = mappingFixture()
  await createDeviceSession({ deviceId, profile: { ...profile, voiceId: realtime.id },
    tenantId, requestId: 'native-row', fetchImpl: f.fetchImpl })
  assert.equal(f.requests[0].voiceId, realtime.id)
  assert.deepEqual(f.scopes, permittedScopes)
  const native = mappingFixture()
  await createDeviceSession({ deviceId, profile: { ...profile, voiceId: realtime.voice },
    tenantId, requestId: 'native-provider', fetchImpl: native.fetchImpl })
  assert.deepEqual(native.scopes, [])
  assert.equal(native.requests[0].voiceId, realtime.voice)
})

test('a shared training recording pairs renamed voices while preserving the Realtime engine', async () => {
  const localUrl = 'https://example.com/voices/paired-training.wav'
  const f = mappingFixture([
    { ...cosy, localUrl },
    { ...realtime, localUrl, voiceName: 'Renamed companion' },
  ])
  const savedProfile = Object.freeze({ ...profile, voiceId: cosy.id })
  const session = await createDeviceSession({ deviceId, profile: savedProfile,
    tenantId, requestId: 'recording-pair', fetchImpl: f.fetchImpl })
  assert.equal(f.requests[0].provider, 'qwen-realtime')
  assert.equal(f.requests[0].voiceId, realtime.id)
  assert.equal(session.voiceId, realtime.voice)
  assert.equal(savedProfile.voiceId, cosy.id)
})

test('recording identity rejects same-name unrelated clones, cross-owner pairs and ambiguous recordings', async () => {
  const localUrl = 'https://example.com/voices/paired-training.wav'
  for (const rows of [
    [{ ...cosy, localUrl }, { ...realtime, localUrl: localUrl + '.other' }],
    [{ ...cosy, localUrl }, { ...realtime, localUrl, tenantId: '1', voiceName: 'Renamed companion' }],
    [{ ...cosy, localUrl }, { ...realtime, localUrl },
      { ...realtime, localUrl, id: 'duplicate-recording', voiceName: 'Renamed companion' }],
  ]) {
    const f = mappingFixture(rows)
    await assert.rejects(createDeviceSession({ deviceId, profile: { ...profile, voiceId: cosy.id },
      tenantId, requestId: 'invalid-recording-pair', fetchImpl: f.fetchImpl }), { code: 'VOICE_INCOMPATIBLE' })
    assert.equal(f.requests.length, 0, 'An unresolved pairing must fail before minting session credentials')
  }
})

test('public voice pairs are resolved in their own owner scope, never across tenant boundaries', async () => {
  for (const publicTenant of ['1508290699769155584', '24', '1']) {
    const f = mappingFixture([cosy, realtime].map(row => ({ ...row, tenantId: publicTenant })))
    await createDeviceSession({ deviceId, profile: { ...profile, voiceId: cosy.id },
      tenantId, requestId: 'public-pair', fetchImpl: f.fetchImpl })
    assert.equal(f.requests[0].voiceId, realtime.id)
    assert.equal(f.scopes[0], tenantId)
    assert.ok(f.scopes.includes(publicTenant))
  }
})

test('the read-only client list paginates type-four island clones before minting a Realtime session', async () => {
  const localUrl = 'https://example.com/island-training.wav'
  const source = { ...cosy, voiceName: 'island · CosyVoice', vociceType: 4, localUrl }
  const target = { ...realtime, voiceName: 'island · Realtime', vociceType: 4, localUrl }
  const filler = Array.from({ length: 99 }, (_, i) => ({ ...cosy,
    id: `filler-${i}`, elevenId: `cosyvoice-filler-${i}`, voiceName: `Other ${i}` }))
  const f = mappingFixture([source, ...filler, target])
  const result = await createDeviceSession({ deviceId, profile: { ...profile, voiceId: source.id },
    tenantId, requestId: 'paginated-island', fetchImpl: f.fetchImpl })
  assert.deepEqual(f.pages.filter(page => page.tenantId === tenantId), [
    { tenantId, pageIndex: 0 }, { tenantId, pageIndex: 1 },
  ])
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].voiceId, target.id)
  assert.equal(f.requests[0].provider, 'qwen-realtime')
  assert.equal(result.voiceId, target.voice)
})

test('a missing, malformed or failed later metadata page cannot create a session from partial results', async () => {
  for (const laterPage of [
    () => envelope({}), () => envelope({ localVoices: null }),
    () => envelope({ localVoices: {} }),
    () => new Response(JSON.stringify({ code: 500, message: 'private-detail' })),
    () => new Response('{}', { status: 503 }),
  ]) {
    let sessions = 0, pageTwo = false
    const firstPage = [cosy, realtime, ...Array.from({ length: 98 }, (_, i) => ({
      ...cosy, id: `other-${i}`, elevenId: `cosyvoice-other-${i}`, voiceName: `Other ${i}`,
    }))]
    await assert.rejects(createDeviceSession({ deviceId, profile: { ...profile, voiceId: cosy.id },
      tenantId, requestId: 'partial-catalog', fetchImpl: async (target, options) => {
        const path = new URL(target).pathname
        if (path === sessionPath) { sessions++; return envelope(grant({ voiceId: realtime.voice })) }
        assert.equal(path, metadataPath)
        const body = JSON.parse(options.body)
        if (body.pageIndex === 0) return envelope({ localVoices: firstPage })
        assert.equal(body.pageIndex, 1)
        pageTwo = true
        return laterPage()
      } }), { code: 'SESSION_UNAVAILABLE' })
    assert.equal(pageTwo, true)
    assert.equal(sessions, 0)
  }
})

test('missing, ambiguous, foreign and incompatible pairs never mint credentials or choose a default', async () => {
  for (const rows of [
    [], [cosy], [cosy, realtime, { ...realtime, id: 'duplicate-row' }],
    [cosy, realtime, { ...cosy, id: 'duplicate-cosy-row', elevenId: 'cosyvoice-duplicate' }],
    [cosy, { ...realtime, tenantId: 'foreign' }],
    [cosy, { ...realtime, tenantId: '1508290699769155584' }],
    [cosy, { ...realtime, voice: 'longanyang' }],
    [cosy, { ...realtime, azureLanguage: 'qwen-tts' }],
  ]) {
    const f = mappingFixture(rows)
    await assert.rejects(createDeviceSession({ deviceId, profile: { ...profile, voiceId: cosy.elevenId },
      tenantId, requestId: 'no-pair', fetchImpl: f.fetchImpl }), { code: 'VOICE_INCOMPATIBLE' })
    assert.equal(f.requests.length, 0)
    assert.ok(!f.scopes.includes('foreign'))
  }
})

test('foreign and ownerless metadata cannot impersonate an accessible pair', async () => {
  for (const owner of ['foreign', undefined]) {
    let posts = 0
    await assert.rejects(createDeviceSession({ deviceId, profile: { ...profile, voiceId: cosy.id },
      tenantId, requestId: 'wrong-owner', fetchImpl: async (url, options) => {
        if (new URL(url).pathname === sessionPath) posts++
        return envelope({ localVoices: [cosy, realtime].map(row => ({ ...row, tenantId: owner })) })
      } }), { code: 'VOICE_INCOMPATIBLE' })
    assert.equal(posts, 0)
  }
})

test('the same selected alias in private and public catalogs cannot select a voice by lookup order', async () => {
  const f = mappingFixture([cosy, realtime,
    { ...cosy, id: 'public-cosy', tenantId: '1508290699769155584' },
    { ...realtime, id: 'public-realtime', tenantId: '1508290699769155584',
      voice: 'qwen-audio-3.0-realtime-flash-public' },
  ])
  await assert.rejects(createDeviceSession({ deviceId, profile: { ...profile, voiceId: cosy.elevenId },
    tenantId, requestId: 'ambiguous-owner', fetchImpl: f.fetchImpl }), { code: 'VOICE_INCOMPATIBLE' })
  assert.equal(f.requests.length, 0)
})

test('mapping requires a server-confirmed tenant and validates the granted voice exactly', async () => {
  let fetched = false
  await assert.rejects(createDeviceSession({ deviceId, profile: { ...profile, voiceId: cosy.id },
    requestId: 'missing-tenant', fetchImpl: async () => { fetched = true } }), { code: 'INVALID_SESSION' })
  assert.equal(fetched, false)
  const f = mappingFixture(undefined, { voiceId: 'longanqian' })
  await assert.rejects(createDeviceSession({ deviceId, profile: { ...profile, voiceId: cosy.id },
    tenantId, requestId: 'wrong-grant', fetchImpl: f.fetchImpl }), { code: 'INVALID_SESSION' })
})

test('failed or oversized voice metadata stops bootstrap with a sanitized retryable error', async () => {
  for (const response of [
    new Response('secret-fixture-token', { status: 401 }), envelope({ rows: [] }),
    new Response('secret-fixture-token'), new Response('x'.repeat(4 * 1024 * 1024 + 1)),
    new Response(JSON.stringify({ code: 500, msg: 'secret-fixture-token' })),
  ]) {
    let posts = 0
    await assert.rejects(createDeviceSession({ deviceId, profile: { ...profile, voiceId: cosy.elevenId },
      tenantId, requestId: 'lookup-failure', fetchImpl: async (url, options) => {
        if (new URL(url).pathname === sessionPath) posts++
        return response
      } }), error => error.code === 'SESSION_UNAVAILABLE' && !error.message.includes('secret'))
    assert.equal(posts, 0)
  }
})

test('cancelling metadata lookup cannot mint a session after a late response', async () => {
  const abort = new AbortController()
  let posts = 0
  await assert.rejects(createDeviceSession({ deviceId, profile: { ...profile, voiceId: cosy.id },
    tenantId, requestId: 'cancelled-pair', signal: abort.signal, fetchImpl: async (url, options) => {
      if (new URL(url).pathname === sessionPath) posts++
      abort.abort()
      return envelope({ localVoices: [cosy, realtime] })
    } }), { code: 'SESSION_CANCELLED' })
  assert.equal(posts, 0)
})
