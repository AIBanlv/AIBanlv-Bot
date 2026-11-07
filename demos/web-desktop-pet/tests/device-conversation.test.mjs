import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DeviceConversation } from '../electron/device-conversation.mjs'
import { DeviceActivity } from '../electron/device-activity.mjs'

test('text-only context replacement clears private dialogue without erasing it on a same-owner quota change', t => {
  const realtime = new EventEmitter(), activity = new DeviceActivity()
  Object.assign(realtime, { setContext() {}, stop() {} })
  const text = { stop() {}, close() {} }
  let route = 'deepseek'
  const conversation = new DeviceConversation({ realtime, text, routing: () => ({ route, textOnly: route === 'deepseek' }) })
  conversation.on('event', event => activity.conversation(event, '角色'))
  t.after(() => activity.clear())
  conversation.setContext('owner-a:role')
  conversation.emit('event', { type: 'preparing', requestId: 'private-turn', textOnly: true })
  conversation.emit('event', { type: 'assistant', requestId: 'private-turn', text: '上个账号的私密对话', textOnly: true })
  assert.equal(activity.snapshot().rows.length, 1)
  route = 'platform'; conversation.setContext('owner-a:role')
  assert.equal(activity.snapshot().rows.length, 1)
  route = 'deepseek'; conversation.setContext('owner-b:role')
  assert.equal(activity.snapshot().rows.length, 0)
})

test('explicit own text route never opens paid speech, switching requires a changed selection', async () => {
  const realtime = new EventEmitter(), contexts = [], calls = []
  Object.assign(realtime, { setContext: key => contexts.push(key), send: () => calls.push('paid'),
    stop() {}, dispose: async () => {} })
  const text = { chat: value => ({ ok: true, text: value }), stop() {}, close() {} }
  let route = 'deepseek'
  const conversation = new DeviceConversation({ realtime, text, routing: () => ({ route, textOnly: route === 'deepseek' }) })
  conversation.setContext('role')
  assert.deepEqual(contexts, [''])
  assert.equal((await conversation.send('hi')).text, 'hi')
  assert.equal((await conversation.sendVoice(new Uint8Array())).ok, false)
  assert.equal((await conversation.send('welcome', { greeting: true })).code, 'TEXT_ONLY')
  assert.deepEqual(calls, [])
  route = 'platform'
  conversation.setContext('role')
  assert.equal(contexts.at(-1), 'role:platform')
  await conversation.send('hi')
  assert.deepEqual(calls, ['paid'])
})

test('unavailable selected source closes its link and refuses input instead of silently falling back', async () => {
  const realtime = new EventEmitter(), contexts = []
  Object.assign(realtime, { setContext: key => contexts.push(key), send: () => assert.fail('paid request'), stop() {} })
  const text = { chat: () => ({ ok: true }), stop() {}, close() {} }
  let routing = { route: 'platform' }
  const conversation = new DeviceConversation({ realtime, text, routing: () => routing })
  conversation.setContext('role')
  routing = { route: '', code: 'SCORE_DEPLETED' }
  conversation.setContext('role')
  assert.deepEqual(contexts, ['role:platform', ''])
  routing = { route: '', code: 'SCORE_PENDING' }
  conversation.setContext('role')
  assert.equal((await conversation.send('hi')).code, 'SCORE_PENDING')
  assert.equal((await conversation.sendVoice(new Uint8Array())).code, 'SCORE_PENDING')
})
