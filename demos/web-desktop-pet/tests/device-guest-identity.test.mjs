import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { GuestIdentity } from '../electron/device-guest-identity.mjs'

const deviceId = 'zhanlv:desktop-12345678-1234-1234-1234-123456789abc'
const hardwareId = 'a'.repeat(64), bindToken = 'synthetic-pairing-token'
test('guest registration proves the install and is reused across quota and session requests', async () => {
  let calls = 0
  const channel = { state: { deviceId }, bindingOffer: () => ({ bindToken }) }
  const identity = new GuestIdentity({ channel, origin: 'http://127.0.0.1:9000', hardware: async () => hardwareId,
    fetchImpl: async (url, options) => {
      calls++; assert.equal(url, 'http://127.0.0.1:9000/client/desktop-public/guest/identity')
      assert.equal(options.credentials, 'omit')
      assert.deepEqual(JSON.parse(options.body), { deviceId, hardwareId,
        deviceProof: createHmac('sha256', bindToken).update(`desktop-guest-hardware-v1\n${deviceId}\n${hardwareId}`).digest('hex') })
      return Response.json({ code: 0, data: { registered: true } })
    } })
  await Promise.all([identity.ensure(), identity.ensure()]); await identity.ensure()
  assert.equal(calls, 1)
  channel.bindingOffer = () => null
  await assert.rejects(identity.ensure())
})
test('hardware failures never register a random identity and server rejection does not permit guest use', async () => {
  const channel = { state: { deviceId }, bindingOffer: () => ({ bindToken }) }
  const failed = new GuestIdentity({ channel, origin: 'http://127.0.0.1:9000',
    hardware: async () => { throw Object.assign(new Error('fixture'), { code: 'HARDWARE_ID_UNAVAILABLE' }) },
    fetchImpl: () => assert.fail('Hardware failure cannot register') })
  await assert.rejects(failed.ensure(), { code: 'HARDWARE_ID_UNAVAILABLE' })
  const denied = new GuestIdentity({ channel, origin: 'http://127.0.0.1:9000', hardware: async () => hardwareId,
    fetchImpl: async () => Response.json({ code: 409, msg: 'GUEST_HARDWARE_CONFLICT' }, { status: 409 }) })
  await assert.rejects(denied.ensure(), { code: 'GUEST_HARDWARE_CONFLICT' })
})
