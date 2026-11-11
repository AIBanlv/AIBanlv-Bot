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

test('a context change cancels an in-flight direct task and suppresses its late answer', async () => {
  const realtime = new EventEmitter(), events = []
  Object.assign(realtime, { setContext() {}, stop() {} })
  let release, signal
  const tasks = { directRoute: () => ({ decision: 'task', task: '继续', provider: 'codex', operation: 'continue' }),
    execute: async (_args, options) => { signal = options.signal; return new Promise(resolve => { release = resolve }) } }
  const conversation = new DeviceConversation({ realtime, text: { stop() {}, close() {} },
    routing: () => ({ route: 'platform' }), tasks: () => tasks })
  conversation.setContext('owner-one')
  conversation.on('event', event => events.push(event))
  const pending = conversation.send('继续', { allowComputer: true })
  assert.equal((await conversation.send('继续')).code, 'CHAT_BUSY')
  conversation.setContext('owner-two')
  assert.equal(signal.aborted, true)
  release({ ok: true, message: '上个账号的发送结果' })
  assert.equal((await pending).code, 'CANCELLED')
  assert.equal(events.some(event => event.type === 'assistant'), false)
  assert.equal(conversation.turn, undefined)
})

test('a direct executor failure returns its concrete error without asking a model for a success claim', async () => {
  const realtime = new EventEmitter(), events = []
  Object.assign(realtime, { setContext() {}, stop() {}, send: () => assert.fail('must not invent success') })
  const tasks = { directRoute: () => ({ decision: 'task', task: '继续', provider: 'codex', operation: 'continue' }),
    execute: async () => { throw new Error('这个任务仍在执行，消息尚未发送') } }
  const conversation = new DeviceConversation({ realtime, text: { stop() {}, close() {} },
    routing: () => ({ route: 'platform' }), tasks: () => tasks })
  conversation.setContext('owner')
  conversation.on('event', event => events.push(event))
  const result = await conversation.send('继续', { allowComputer: true })
  assert.equal(result.ok, false)
  assert.match(result.message, /消息尚未发送/)
  assert.equal(events.some(event => event.type === 'assistant'), false)
})

test('authenticated phone messages need no avatar or companion quota while local chat and file transfer retain their routes', async () => {
  const events = [], sent = [], ordinary = [], realtime = new EventEmitter()
  Object.assign(realtime, { setContext() {}, stop() {}, send: text => { ordinary.push(text); return { ok: true } } })
  const tasks = { directRoute: () => null, sendRemote: async (text, options) => {
    sent.push({ text, options }); return { ok: true, status: 'queued', message: '已排队到原会话' }
  } }
  let route = ''
  const conversation = new DeviceConversation({ realtime, text: { stop() {}, close() {} },
    routing: () => ({ route, code: 'SCORE_DEPLETED' }), tasks: () => tasks })
  conversation.setContext('')
  conversation.on('event', event => events.push(event))
  const options = { remoteCodex: true, allowComputer: true, remoteSessionId: 'phone' }
  assert.equal((await conversation.send('先别执行，说明你的方案', options)).ok, true)
  assert.equal(sent[0].options.sessionId, 'phone')
  assert.match(events.find(event => event.type === 'assistant').text, /已排队/)
  assert.equal((await conversation.send('本地普通聊天')).code, 'SCORE_DEPLETED')
  assert.equal((await conversation.send('新建任务：检查测试', { ...options, allowComputer: false })).code, 'REMOTE_AUTH_REQUIRED')
  route = 'platform'; conversation.setContext('owner-role')
  await conversation.send('本地普通聊天')
  await conversation.send('把桌面上的报价.pdf发给我', options)
  await conversation.send('定时通知', { ...options, notificationEventId: 'reminder' })
  assert.deepEqual(ordinary, ['本地普通聊天', '把桌面上的报价.pdf发给我', '定时通知'])
  assert.equal(sent.length, 1)
})
