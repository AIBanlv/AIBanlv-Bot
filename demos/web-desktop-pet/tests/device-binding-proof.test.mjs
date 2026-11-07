import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { DeviceChannel } from '../electron/device-channel.mjs'
import { DeviceBindingProof } from '../electron/device-binding-proof.mjs'

test('registration proof does not unlock business APIs before the post-binding challenge', () => {
  const channel = new DeviceChannel({ deviceId: 'zhanlv:desktop-fixture', qr: async () => '' }), sent = []
  channel.socket = { readyState: 1, send: value => sent.push(JSON.parse(value)) }
  channel.state.connection = 'connected'
  const proof = new DeviceBindingProof({ channel, file: 'unused-fixture', encryption: { isEncryptionAvailable: () => false } })
  proof.key = 'fixture-pairing-secret'
  const registration = '11111111-1111-1111-1111-111111111111', business = '22222222-2222-2222-2222-222222222222'
  channel.receive({ type: 'device_challenge', phase: 'registration', deviceId: channel.state.deviceId, nonce: registration })
  assert.equal(channel.state.accountAuthReady, false)
  assert.equal(sent[0].type, 'device_online')
  assert.equal(sent[0].deviceProof, createHmac('sha256', proof.key).update(`${channel.state.deviceId}\n${registration}`).digest('hex'))
  channel.receive({ type: 'bind_success', deviceId: channel.state.deviceId, tenantId: 'tenant', controllerUserId: 'owner', capabilities: { deviceProofRequired: true } })
  assert.equal(channel.state.accountAuthReady, false)
  channel.receive({ type: 'device_challenge', deviceId: channel.state.deviceId, nonce: business })
  assert.equal(channel.state.accountAuthReady, true)
  for (const type of ['device_history_request', 'desktop_action', 'assistant_reply', 'agent_state_report']) {
    channel.send({ type, deviceId: channel.state.deviceId })
    assert.equal(sent.at(-1).deviceProof, createHmac('sha256', proof.key).update(`${channel.state.deviceId}\n${business}`).digest('hex'))
  }
  channel.receive({ type: 'bind_success', deviceId: channel.state.deviceId, tenantId: 'tenant', controllerUserId: 'owner', capabilities: { deviceProofRequired: true } })
  assert.equal(channel.state.accountAuthReady, false, 'A repeated binding confirmation must wait for its fresh challenge')
  assert.doesNotMatch(JSON.stringify(channel.snapshot?.() || channel.state), /fixture-pairing-secret/)
})
