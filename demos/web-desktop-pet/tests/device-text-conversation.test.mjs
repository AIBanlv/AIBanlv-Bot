import test from 'node:test'
import assert from 'node:assert/strict'
import { DeviceTextConversation } from '../electron/device-text-conversation.mjs'

test('text tasks retain the initiating phone session and the original user request', async () => {
  let options
  const chat = new DeviceTextConversation({ settings: { key: () => 'fixture-key' },
    context: () => ({ agentId: 'local', persona: '本地伙伴' }), onEvent() {},
    assistant: { enabled: () => true, planTask: async () => ({ decision: 'task', task: '发送指定文件', provider: 'desktop', operation: 'create' }),
      dispatch: async (_args, value) => { options = value; return { ok: true, result: '已发送' } } } })
  assert.equal((await chat.chat('把桌面的报告发到我这台手机', { remoteSessionId: 'origin-phone-session' })).ok, true)
  assert.equal(options.targetSession, 'origin-phone-session')
  assert.equal(options.originalTask, '把桌面的报告发到我这台手机')
  assert.equal(options.signal.aborted, false)
})

test('own-key text can execute a semantic local assistant task without Realtime or platform billing', async () => {
  const events = [], calls = []
  const chat = new DeviceTextConversation({ settings: { key: () => 'fixture-key' },
    context: () => ({ agentId: 'local', persona: '本地伙伴' }), onEvent: event => events.push(event),
    assistant: { enabled: () => true, planTask: async () => ({ decision: 'task', task: '打开计算器', provider: 'desktop', operation: 'create' }),
      dispatch: async args => { calls.push(args); return { ok: true, result: '已打开计算器' } } },
    fetchImpl: () => assert.fail('tool result must not trigger another model or paid speech request') })
  assert.equal((await chat.chat('打开计算器')).ok, true)
  assert.equal(calls.length, 1)
  assert.equal(events.find(row => row.type === 'assistant').text, '已打开计算器')
  assert.equal(events[0].spoken, false)
})

test('text fallback sends persona first and bounded conversational history, without audio or tools', async () => {
  const events = []; let request
  const chat = new DeviceTextConversation({ settings: { key: () => 'private-key' },
    context: () => ({ agentId: 'waner', persona: '你是上官婉儿' }),
    getHistory: () => [{ role: 'system', text: 'untrusted' }, { role: 'user', text: '以前' }],
    onEvent: event => events.push(event), fetchImpl: async (url, options) => {
      request = { url, ...options }; return Response.json({ choices: [{ message: { content: '你好' } }] })
    } })
  assert.equal((await chat.chat('现在')).ok, true)
  const body = JSON.parse(request.body)
  assert.equal(body.messages[0].role,'system')
  assert.ok(body.messages[0].content.startsWith('你是上官婉儿\n'))
  assert.match(body.messages[0].content,/\[msg_end\]/)
  assert.deepEqual(body.messages.slice(1),[{role:'user',content:'以前'},{role:'user',content:'现在'}])
  assert.equal(body.tools, undefined)
  assert.equal(events[0].spoken, false)
  assert.deepEqual(events.map(e => e.type), ['preparing', 'user', 'assistant', 'done', 'complete'])
})

test('missing key or persona fails visibly without a request', async () => {
  let calls = 0
  const chat = new DeviceTextConversation({ settings: { key: () => '' }, context: () => ({}), onEvent() {}, fetchImpl: () => { calls++ } })
  assert.equal((await chat.chat('你好')).code, 'KEY_REQUIRED')
  chat.settings = { key: () => 'key' }
  assert.equal((await chat.chat('你好')).code, 'PERSONA_REQUIRED')
  assert.equal(calls, 0)
})

test('stop and role changes suppress late model replies', async () => {
  for (const cancel of ['stop', 'role']) {
    let release; const events = []; let context = { agentId: 'a', persona: 'A' }
    const chat = new DeviceTextConversation({ settings: { key: () => 'key' }, context: () => context,
      onEvent: e => events.push(e), fetchImpl: () => new Promise(resolve => { release = resolve }) })
    const pending = chat.chat('hi')
    await new Promise(resolve => setImmediate(resolve))
    if (cancel === 'stop') chat.stop(); else context = { agentId: 'b', persona: 'B' }
    release(Response.json({ choices: [{ message: { content: 'late' } }] }))
    await pending
    assert.equal(events.some(e => e.type === 'assistant'), false)
  }
})

test('a question waits for durable local storage and cancellation prevents the provider request', async () => {
  let release
  const chat = new DeviceTextConversation({ settings: { key: () => 'fixture' }, context: () => ({ agentId: 'local', persona: '本地' }),
    onEvent() {}, beforeSend: () => new Promise(resolve => { release = resolve }), fetchImpl: () => assert.fail('must wait for storage') })
  const pending = chat.chat('先保存')
  chat.stop(); release()
  assert.equal((await pending).code, 'CANCELLED')
})

test('task dispatch errors expose a safe actionable reason instead of a model-key error', async () => {
  const events = []
  const chat = new DeviceTextConversation({ settings: { key: () => 'fixture-key' },
    context: () => ({ agentId: 'role', persona: '测试角色' }), onEvent: value => events.push(value),
    assistant: { enabled: () => true, planTask: async () => ({ decision: 'task', provider: 'codex', operation: 'continue', task: '继续' }),
      dispatch: async () => { throw Object.assign(new Error('该 Codex 任务仍在执行，请等待本轮结束。'), { code: 'TASK_DISPATCH_FAILED' }) } } })
  const result = await chat.chat('继续')
  assert.equal(result.ok, false)
  assert.match(result.message, /仍在执行/)
  assert.match(events.find(row => row.type === 'error').message, /仍在执行/)
})

test('oversized provider response fails without displaying partial content', async () => {
  const events = []
  const chat = new DeviceTextConversation({ settings: { key: () => 'key' },
    context: () => ({ agentId: 'a', persona: 'A' }), onEvent: event => events.push(event),
    fetchImpl: async () => new Response('x'.repeat(256 * 1024 + 1)) })
  assert.equal((await chat.chat('hi')).ok, false)
  assert.equal(events.some(event => event.type === 'assistant'), false)
})

test('fresh process waits for restored MAX history before its first DeepSeek request', async () => {
  let release, request
  const chat = new DeviceTextConversation({ settings: { key: () => 'key' },
    context: () => ({ agentId: 'waner', persona: '婉儿' }), onEvent() {},
    getHistory: () => new Promise(resolve => { release = resolve }), fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body)
      return Response.json({ choices: [{ message: { content: '你的金毛叫 MAX。' } }] })
    } })
  const turn = chat.chat('我的狗叫什么？')
  assert.equal(request, undefined)
  release([{ role: 'user', text: '我的狗叫 MAX，是金毛犬' }])
  assert.equal((await turn).ok, true)
  assert.equal(request.messages[1].content, '我的狗叫 MAX，是金毛犬')
})

test('failed history restoration never sends a question with empty memory', async () => {
  const chat = new DeviceTextConversation({ settings: { key: () => 'key' },
    context: () => ({ agentId: 'waner', persona: '婉儿' }), onEvent() {},
    getHistory: async () => { throw Object.assign(new Error('failed'), { code: 'HISTORY_TIMEOUT' }) },
    fetchImpl: () => assert.fail('must not generate without restored history') })
  const result = await chat.chat('我的狗叫什么？')
  assert.equal(result.ok, false)
  assert.match(result.message, /历史记忆恢复失败/)
})
