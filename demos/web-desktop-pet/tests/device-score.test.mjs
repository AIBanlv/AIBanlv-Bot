import test from 'node:test'
import assert from 'node:assert/strict'
import { billingDeviceId, getDeviceScore } from '../electron/device-score.mjs'

const deviceId = 'zhanlv:desktop-12345678-1234-1234-1234-123456789abc'
const reply = data => new Response(JSON.stringify({ code: 200, data }))
test('unbound desktops never query anonymous credits or gain an account identity', async () => {
  let requests = 0
  await assert.rejects(getDeviceScore({ deviceId, fetchImpl: async () => {
    requests++; return reply({ anonymousRemainingScore: 800 })
  } }), { code: 'SCORE_UNAVAILABLE' })
  assert.equal(requests, 0)
})
test('account balance ignores guest placeholder and preserves depleted balance', async () => {
  assert.deepEqual(await getDeviceScore({ deviceId, tenantId: 'tenant-a', fetchImpl: async url => {
    assert.equal(new URL(url).searchParams.get('tenantId'), 'tenant-a')
    return reply({ score: -3, anonymousRemainingScore: 0 })
  } }), { score: -3, anonymous: false })
})

test('billing subject remains the stable hash of the installation id', () => {
  assert.match(billingDeviceId(deviceId), /^[a-f0-9]{64}$/)
  assert.equal(billingDeviceId(deviceId), billingDeviceId(deviceId))
  assert.throws(() => billingDeviceId('forged'), { code: 'SCORE_UNAVAILABLE' })
})
test('unknown balance fails closed rather than granting local credits', async () => {
  for (const data of [{}, { score: '' }, { score: false }, { score: 'bad' }]) {
    await assert.rejects(getDeviceScore({ deviceId, tenantId: 'tenant-a', fetchImpl: async () => reply(data) }), { code: 'SCORE_UNAVAILABLE' })
  }
})
test('a bound desktop uses proven account metadata without issuing an unauthenticated tenant HTTP request', async () => {
  let reads = 0
  const options = { deviceId, tenantId: 'bound-tenant', fetchImpl: () => assert.fail('Must not call protected HTTP without a mobile JWT'),
    readAccount: async () => { reads++; return { ok: true, points: 0 } } }
  assert.deepEqual(await getDeviceScore(options), { score: 0, anonymous: false })
  assert.equal(reads, 1)
  await assert.rejects(getDeviceScore({ ...options, readAccount: async () => ({ ok: false, points: 999 }) }), { code: 'SCORE_UNAVAILABLE' })
})
test('account HTTP lookup is read only and failures stay sanitized', async () => {
  const result = await getDeviceScore({ tenantId: 'tenant-a', fetchImpl: async (url, options) => {
    assert.match(url, /reception\/getReception\?tenantId=tenant-a$/)
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit')
    assert.equal(options.headers.Authorization, undefined)
    return reply({ score: 1050 })
  } })
  assert.equal(result.score, 1050)
  await assert.rejects(getDeviceScore({ tenantId: 'tenant-a', fetchImpl: async () => {
    throw new Error('private upstream diagnostic')
  } }), { code: 'SCORE_UNAVAILABLE', message: '无法核实积分，请检查网络后重试' })
})
