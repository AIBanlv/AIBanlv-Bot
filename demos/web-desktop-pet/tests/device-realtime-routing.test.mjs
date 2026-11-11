import test from 'node:test'
import assert from 'node:assert/strict'
import { DeviceRealtime } from '../electron/device-realtime.mjs'
import { AssistantService } from '../electron/device-assistant-service.mjs'
import { HarnessTaskDispatcher } from '../electron/device-task-dispatcher.mjs'

const flush = () => new Promise(resolve => setImmediate(resolve))
class Socket extends EventTarget {
  readyState = 0; bufferedAmount = 0; sent = []
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')) }
  message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })) }
  send(value) { this.sent.push(JSON.parse(value)) }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')) }
}
function fixture(t, overrides = {}) {
  const socket = new Socket(), dispatched = [], planned = [], events = [], logs = [], receipts = [], billing = []
  const assistant = { enabled: () => true, reset: async () => {},
    planTask: async (text, options) => { planned.push({ text, options }); return { decision: 'task', task: text, provider: 'desktop', operation: 'create' } },
    dispatch: async (args, options) => { dispatched.push({ args, options }); return { ok: true, result: { status: 'received', message: '手机已校验接收截图' } } },
    ...overrides }
  const client = new DeviceRealtime({ assistant, socketFactory: () => socket,
    bootstrap: async () => ({ apiKey: 'fixture', providerUrl: 'ws://127.0.0.1', voiceId: 'fixture', sampleRate: 24000, expiresAt: Date.now() + 600000 }),
    billingFactory: () => ({ start: async () => {}, report: (type, value) => { billing.push({ type, ...value }); return true }, close: async () => {} }),
    receipt: async options => { receipts.push(options); return { status: 'received' } },
    log: { event: (type, fields) => logs.push({ type, ...fields }) }, drainMs: 1 })
  client.on('event', event => events.push(event))
  t.after(() => client.dispose())
  async function start(text, options) {
    const sending = text instanceof Uint8Array ? client.sendVoice(text) : client.send(text, options)
    await flush(); socket.open(); socket.message({ type: 'session.updated' })
    const result = await sending; await flush()
    return result
  }
  return { client, socket, dispatched, planned, events, logs, receipts, billing, start }
}
function finish(f, id = 'narration') {
  f.socket.message({ type: 'response.created', response: { id } })
  f.socket.message({ type: 'response.text.done', response_id: id, text: '已根据实际结果汇报' })
  f.socket.message({ type: 'response.done', response: { id, status: 'completed', usage: { total_tokens: 1 } } })
}

test('explicit screenshots execute through Harness without waiting for Realtime to emit a tool call', async t => {
  const f = fixture(t)
  const started = await f.start('截图发我', { remoteSessionId: 'authorized-phone' })
  assert.equal(started.ok, true)
  assert.equal(f.planned.length, 0, 'screenshot fast path incurs no routing model request')
  assert.equal(f.dispatched.length, 1)
  assert.equal(f.dispatched[0].options.targetSession, 'authorized-phone')
  assert.equal(f.dispatched[0].options.originalTask, '截图发我')
  assert.equal(f.receipts.length, 0, 'do not replace the delivered file with a second receipt')
  const items = f.socket.sent.filter(row => row.type === 'conversation.item.create')
  const call = items.find(row => row.item.type === 'function_call').item
  const output = items.find(row => row.item.type === 'function_call_output').item
  assert.equal(call.call_id, output.call_id)
  assert.equal(JSON.parse(output.output).result.status, 'received')
  assert.equal(f.socket.sent.filter(row => row.type === 'session.update').at(-1).session.tools.length, 0)
  finish(f); f.client.played(started.requestId)
  assert.ok(f.logs.some(row => row.type === 'task.complete'))
  assert.deepEqual(f.billing.map(row => row.type), ['session_started', 'output_started', 'usage', 'output_completed'])
})

test('Harness semantically routes a question and preserves original text and phone scope', async t => {
  const f = fixture(t)
  await f.start('有没有新邮件？', { remoteSessionId: 'phone-one' })
  assert.equal(f.planned.length, 1); assert.equal(f.dispatched.length, 1)
  assert.equal(f.dispatched[0].options.originalTask, '有没有新邮件？')
  assert.equal(f.dispatched[0].options.targetSession, 'phone-one')
})

test('ordinary chat and negated commands remain chat even if narration tries to invoke a tool', async t => {
  const f = fixture(t, { planTask: async () => ({ decision: 'chat' }) })
  await f.start('不要截图，我只想聊聊', { remoteSessionId: 'phone-no-action' })
  assert.equal(f.dispatched.length, 0)
  f.socket.message({ type: 'response.created', response: { id: 'rogue' } })
  f.socket.message({ type: 'response.done', response: { id: 'rogue', status: 'completed', usage: { total_tokens: 1 },
    output: [{ type: 'function_call', name: 'computer_task', call_id: 'not-authorized', arguments: '{"task":"截图发我"}' }] } })
  await flush()
  assert.equal(f.dispatched.length, 0)
  assert.equal(f.receipts.length, 0, 'a rejected hallucinated call is not permission to take a receipt screenshot')
})

test('ambiguous instructions and malformed routing results produce explicit non-execution results', async t => {
  for (const decision of [{ decision: 'clarify', message: '需要发送哪个文件？' }, { decision: 'task', task: 'run', provider: 'shell' }]) {
    const f = fixture(t, { planTask: async () => decision })
    await f.start('把文件发给我')
    assert.equal(f.dispatched.length, 0)
    assert.equal(f.receipts.length, 0)
    const output = JSON.parse(f.socket.sent.find(row => row.item?.type === 'function_call_output').item.output)
    assert.equal(output.ok, false); assert.equal(output.executed, false)
    assert.ok(['needs_clarification', 'routing_failed'].includes(output.status))
  }
})

test('stopping during semantic routing discards late decisions and never replays the operation', async t => {
  let resolve
  const f = fixture(t, { planTask: async () => new Promise(done => { resolve = done }) })
  await f.start('邮箱有新邮件吗？')
  f.client.interrupt()
  resolve({ decision: 'task', task: '查询邮箱', provider: 'desktop', operation: 'create' }); await flush()
  assert.equal(f.dispatched.length, 0)
  assert.equal(f.socket.sent.some(row => row.type === 'response.create'), false)
})

test('voice screenshot requests enter the same fast path only after a committed ASR transcript', async t => {
  const f = fixture(t)
  await f.start(new Uint8Array(16000))
  assert.equal(f.dispatched.length, 0)
  f.socket.message({ type: 'input_audio_buffer.committed', item_id: 'spoken-request' })
  f.socket.message({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'spoken-request', transcript: '截图发我' })
  await flush()
  assert.equal(f.dispatched.length, 1); assert.equal(f.planned.length, 0)
})

test('notifications and unauthorized remote input cannot reach the Harness semantic router or executor', async t => {
  for (const options of [{ notificationEventId: 'reminder' }, { allowComputer: false, remoteSessionId: 'old-phone' }]) {
    const f = fixture(t)
    await f.start('截图发我', options)
    assert.equal(f.planned.length, 0); assert.equal(f.dispatched.length, 0)
    assert.deepEqual(f.socket.sent[0].session.tools, [])
  }
})

test('an actual screenshot delivery error is retained for narration and logged, not retried', async t => {
  let calls = 0
  const f = fixture(t, { dispatch: async () => { calls++; throw Object.assign(new Error('截图已保存到本机，但发送未完成：Cloudflare 凭证申请超时'), { code: 'FILE_TRANSFER_FAILED' }) } })
  await f.start('截图发我')
  const output = JSON.parse(f.socket.sent.find(row => row.item?.type === 'function_call_output').item.output)
  assert.equal(output.ok, false); assert.match(output.message, /Cloudflare 凭证申请超时/)
  finish(f); assert.equal(calls, 1)
  assert.ok(f.logs.some(row => row.type === 'task.dispatch-failed' && row.code === 'FILE_TRANSFER_FAILED'))
})

test('semantic screenshot paraphrases do not trigger a second capture after a failed send', async t => {
  const f = fixture(t, { planTask: async () => ({ decision: 'task', task: '截图发我', provider: 'desktop', operation: 'create' }),
    dispatch: async () => { throw Object.assign(new Error('手机未应答，未送达'), { code: 'FILE_TRANSFER_FAILED' }) } })
  await f.start('来张当前桌面的照片给我看看', { remoteSessionId: 'phone-one' })
  assert.equal(f.receipts.length, 0)
  const output = JSON.parse(f.socket.sent.find(row => row.item?.type === 'function_call_output').item.output)
  assert.equal(output.ok, false); assert.match(output.message, /手机未应答/)
})

test('later turns restore routing and get only recent same-connection context', async t => {
  const f = fixture(t)
  const first = await f.start('截图发我')
  finish(f); f.client.played(first.requestId)
  await f.client.send('看看邮箱有没有新邮件'); await flush()
  assert.equal(f.planned.length, 1)
  assert.equal(f.planned[0].options.context[0].text, '截图发我')
  assert.equal(f.planned[0].options.context.at(-1).role, 'assistant')
  assert.equal(f.dispatched.length, 2)
  const updates = f.socket.sent.filter(row => row.type === 'session.update')
  assert.equal(updates.at(-2).session.tools.length, 1)
  assert.equal(updates.at(-1).session.tools.length, 0)
})

test('bound phone continuation reaches the same Codex task through the real Harness router and Realtime tool path', async t => {
  const scope = { owner: 'owner', tenantId: 'tenant', deviceId: 'device', agentId: 'role', bound: true }
  const calls = [], task = { id: 'reported', title: '原任务', status: 'completed', lastTurnId: 'old' }
  const codex = { tasks: new Map([[task.id, task]]), connect: async () => {},
    continue: async (id, text) => { calls.push({ id, text }); return { ok: true, taskId: id, turnId: 'new', status: 'accepted' } } }
  const service = new AssistantService({ settings: { snapshot: () => ({ enabled: true }) }, root: 'fixture' })
  const router = new HarnessTaskDispatcher({ assistant: service, codex, context: () => scope })
  service.taskRouter = router
  router.rememberReport('codex', { id: task.id, turnId: 'old', scope })
  const f = fixture(t, { planTask: service.planTask.bind(service), dispatch: service.dispatch.bind(service) })
  await f.start('继续', { remoteSessionId: 'phone-owner' })
  assert.deepEqual(calls, [{ id: task.id, text: '继续' }])
  const output = JSON.parse(f.socket.sent.find(row => row.item?.type === 'function_call_output').item.output)
  assert.equal(output.taskId, task.id)
  assert.equal(output.status, 'accepted')
})
