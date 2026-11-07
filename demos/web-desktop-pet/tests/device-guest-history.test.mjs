import test from 'node:test'
import assert from 'node:assert/strict'
import { DeviceGuestHistory } from '../electron/device-guest-history.mjs'

test('guest turns stay local then upload once to confirmed owner with stable ids', () => {
  const history = new DeviceGuestHistory(), sent = []
  const guest = { deviceId: 'device', agentId: 'waner', bound: false }
  for (const event of [{ type: 'preparing' }, { type: 'user', text: '你好' },
    { type: 'assistant', text: '你好呀' }, { type: 'done' }]) history.accept({ ...event, requestId: 'one' }, guest)
  history.claim(guest, (...args) => sent.push(args))
  assert.equal(sent.length, 0)
  const bound = { ...guest, bound: true, owner: 'owner', tenantId: 'tenant' }
  history.claim(bound, (...args) => sent.push(args))
  assert.deepEqual(sent.map(([p]) => p.messageRole), ['user', 'assistant'])
  assert.equal(sent[0][0].agentId, 'waner')
  assert.equal(sent[0][0].finished, true)
  history.claim({ ...bound, owner: 'other' }, (...args) => sent.push(args))
  assert.equal(sent.length, 2)
})

test('late responses after role change are discarded and failed replies are not saved', () => {
  const history = new DeviceGuestHistory(), sent = []
  const guest = { deviceId: 'device', agentId: 'a' }
  history.accept({ type: 'preparing', requestId: 'one' }, guest)
  history.accept({ type: 'assistant', requestId: 'one', text: 'private' }, { ...guest, agentId: 'b' })
  history.accept({ type: 'done', requestId: 'one' }, guest)
  history.claim({ ...guest, bound: true, owner: 'o', tenantId: 't' }, (...args) => sent.push(args))
  assert.equal(sent.length, 0)
})
