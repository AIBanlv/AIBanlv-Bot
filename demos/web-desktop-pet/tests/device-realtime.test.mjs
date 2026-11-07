import test from 'node:test'
import assert from 'node:assert/strict'
import { DeviceRealtime } from '../electron/device-realtime.mjs'
import { WebSocketServer } from 'ws'
import { DeviceChannel } from '../electron/device-channel.mjs'
import { DeviceRemoteReplies } from '../electron/device-remote-replies.mjs'
import { DeviceNotifications } from '../electron/device-notifications.mjs'
import { localBilling } from '../electron/device-local-workspace.mjs'
import { firstGreetingPrompt } from '../electron/device-first-greeting.mjs'

test('local character text replies skip LAM and cloud billing and complete without audio playback', async t => {
  const f = fixture({ prepare: async () => assert.fail('Text chat must not start LAM'), billingFactory: localBilling })
  t.after(() => f.client.dispose())
  const pending = f.client.send('你好', { textOnly: true })
  await flush(); const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' })
  assert.equal((await pending).ok, true)
  assert.deepEqual(socket.sent.find(row => row.type === 'response.create').response.modalities, ['text'])
  socket.message({ type: 'response.created', response: { id: 'local-text' } })
  socket.message({ type: 'response.text.delta', response_id: 'local-text', delta: '你好呀' })
  socket.message({ type: 'response.done', response: { id: 'local-text', status: 'completed', output: [], usage: { total_tokens: 1 } } })
  await flush()
  assert.ok(f.events.some(row => row.type === 'assistant' && row.text === '你好呀' && row.textOnly))
  assert.ok(f.events.some(row => row.type === 'complete' && row.textOnly))
  assert.equal(f.starts, 0); assert.deepEqual(f.reports, [])
})

test('restarted conversation restores MAX history before accepting the first question without generating a reply', async t => {
  const f = fixture({ bootstrap: async () => ({ expiresAt: Date.now() + 600000,
    history: [{ role: 'user', text: '我的狗叫 MAX，是金毛犬' }, { role: 'assistant', text: '记住了，MAX 是金毛犬。' }] }) })
  t.after(() => f.client.dispose())
  const warm = f.client.preconnect()
  await flush()
  const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' }); await flush()
  const history = socket.sent.filter(row => row.type === 'conversation.item.create')
  assert.equal(history.length, 2)
  assert.equal(history[0].item.content[0].text, '我的狗叫 MAX，是金毛犬')
  assert.equal(history[1].item.content[0].type, 'output_text')
  assert.notEqual(f.client.connectionState, 'ready')
  assert.equal(socket.sent.some(row => row.type === 'response.create'), false)
  for (const row of history) socket.message({ type: 'conversation.item.created', item: { id: row.item.id } })
  assert.equal((await warm).ok, true)
  await f.client.send('我的狗叫什么？')
  const items = socket.sent.filter(row => row.type === 'conversation.item.create')
  assert.equal(items[2].item.content[0].text, '我的狗叫什么？')
  assert.equal(socket.sent.filter(row => row.type === 'response.create').length, 1)
})

test('large restored guest history stays within the replay budget', async t => {
  const f = fixture({ bootstrap: async () => ({ expiresAt: Date.now() + 600000,
    history: Array.from({ length: 40 }, () => ({ role: 'assistant', text: '记'.repeat(16000) })) }) })
  t.after(() => f.client.dispose())
  const warm = f.client.preconnect(); await flush()
  const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' }); await flush()
  const items = socket.sent.filter(row => row.type === 'conversation.item.create')
  assert.equal(items.reduce((sum, row) => sum + row.item.content[0].text.length, 0), 8000)
  for (const row of items) socket.message({ type: 'conversation.item.created', item: { id: row.item.id } })
  assert.equal((await warm).ok, true)
})

test('restored history is acknowledged before a remote Harness task runs and returns its evidence', async t => {
  const calls = [], receipts = []
  const f = fixture({ bootstrap: async () => ({ expiresAt: Date.now() + 600000,
    history: [{ role: 'user', text: '保留当前任务上下文' }] }),
    assistant: { enabled: () => true, reset: async () => {}, dispatch: async task => { calls.push(task); return { ok: true, result: '已提交启动请求' } } },
    receipt: async options => { receipts.push(options.targetSession); return { status: 'received', message: '手机已接收截图' } } })
  t.after(() => f.client.dispose())
  const pending = f.client.send('打开微信', { remoteSessionId: 'phone-after-restart' })
  await flush(); const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' }); await flush()
  assert.equal(calls.length, 0)
  assert.equal(socket.sent.some(row => row.type === 'response.create'), false)
  const history = socket.sent.find(row => row.item?.id?.startsWith('history-'))
  socket.message({ type: 'conversation.item.created', item: { id: history.item.id } })
  assert.equal((await pending).ok, true); await flush()
  assert.equal(calls.length, 0, 'Realtime must decide the operation before any side effect')
  invokeTask(socket, { task: '打开微信', provider: 'desktop' })
  await flush()
  assert.equal(calls.length, 1); assert.deepEqual(receipts, ['phone-after-restart'])
  const result = JSON.parse(socket.sent.find(row => row.item?.type === 'function_call_output').item.output)
  assert.equal(result.screenshotReceipt.status, 'received')
})

class Socket extends EventTarget {
  readyState = 0
  bufferedAmount = 0
  sent = []
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')) }
  message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })) }
  send(value) { this.sent.push(JSON.parse(value)) }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')) }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
test('own-key Realtime connects without platform billing and uses the own session dialect', async t => {
  const f = fixture({ bootstrap: async () => ({ funding: 'own', apiKey: 'own-fixture',
    providerUrl: 'wss://test.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime',
    voiceId: 'Tina', expiresAt: Date.now() + 60000 }),
    billingFactory: () => { assert.fail('own key must not create platform billing') } })
  t.after(() => f.client.dispose())
  const pending = f.client.preconnect(); await flush()
  const socket = f.sockets[0].socket; socket.open()
  assert.equal(socket.sent[0].session.tts_filters, undefined)
  socket.message({ type: 'session.updated' })
  assert.equal((await pending).ok, true)
  assert.equal((await f.client.send('你好')).ok, true)
  assert.equal(f.sockets[0].options.headers.Authorization, 'Bearer own-fixture')
  assert.equal(f.reports.length, 0)
})
function invokeTask(socket, args, id = 'semantic-tool') {
  socket.message({ type: 'response.created', response: { id } })
  socket.message({ type: 'response.done', response: { id, status: 'completed', usage: { total_tokens: 1 },
    output: [{ type: 'function_call', call_id: `${id}-call`, name: 'computer_task', arguments: JSON.stringify(args) }] } })
}

test('production websocket transport sends authorization headers using the local ws implementation', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => server.once('listening', resolve))
  let authorization
  server.on('connection', (socket, request) => {
    authorization = request.headers.authorization
    socket.on('message', raw => {
      const value = JSON.parse(raw)
      if (value.type === 'session.update') socket.send('{"type":"session.updated"}')
    })
  })
  const client = new DeviceRealtime({
    bootstrap: async () => ({ apiKey: 'fixture-only', providerUrl: `ws://127.0.0.1:${server.address().port}`, expiresAt: Date.now() + 60000 }),
    billingFactory: () => ({ start: async () => {}, report: () => true, close: async () => {} }),
  })
  t.after(async () => { await client.dispose(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)) })
  assert.equal((await client.preconnect()).ok, true)
  assert.equal(authorization, 'Bearer fixture-only')
})
function fixture(overrides = {}) {
  const sockets = [], events = [], reports = []
  let starts = 0, closes = 0
  const client = new DeviceRealtime({
    bootstrap: async () => ({ sessionId: 's', apiKey: 'fixture-secret', billingTicket: 'fixture-ticket',
      providerUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=fixture',
      voiceId: 'longanqian', sampleRate: 24000, expiresAt: Date.now() + 600000, instructions: 'fixture' }),
    billingFactory: () => ({ start: async () => { starts++ }, report: (type, data) => { reports.push({ type, ...data }); return true },
      close: async () => { closes++ } }),
    socketFactory: (url, options) => { const socket = new Socket(); sockets.push({ socket, url, options }); return socket },
    drainMs: 10, ...overrides,
  })
  client.on('event', event => events.push(event))
  return { client, sockets, events, reports, get starts() { return starts }, get closes() { return closes } }
}
async function begin(f) {
  const pending = f.client.send('你好')
  await flush()
  const socket = f.sockets.at(-1).socket
  socket.open()
  assert.equal(socket.sent[0].type, 'session.update')
  assert.equal(socket.sent[0].session.voice, 'longanqian')
  assert.equal(socket.sent.some(event => event.type === 'response.create'), false)
  socket.message({ type: 'session.updated' })
  const result = await pending
  return { socket, result }
}

test('successful file delivery is not overwritten by a second automatic screenshot receipt', async t => {
  const receipts = []
  const f = fixture({ receipt: async () => { receipts.push('unexpected'); return {} } })
  t.after(() => f.client.dispose())
  const output = { ok: true, result: { status: 'received', name: '报价.pdf' } }
  const turn = { remoteSessionId: 'origin-phone' }
  assert.equal(await f.client.attachReceipt(turn, output, new AbortController().signal), output)
  assert.deepEqual(receipts, [])
  assert.equal(turn.receiptSent, true)
})
test('a failed explicit screenshot send does not capture and send another image automatically', async t => {
  let receipts = 0
  const f = fixture({ receipt: async () => { receipts++; return {} } })
  t.after(() => f.client.dispose())
  const output = { ok: false, message: '电脑未获得直连地址' }
  const result = await f.client.attachReceipt({ remoteSessionId: 'phone', originalTask: '截图发给我' }, output, new AbortController().signal)
  assert.equal(result, output)
  assert.equal(receipts, 0)
})

test('remote task evidence targets its initiating session once and preserves the actual failure result', async t => {
  const receipts = []
  const f = fixture({ receipt: async options => { receipts.push(options.targetSession); return { status: 'failed', message: '截图未送达' } },
    assistant: { enabled: () => true, reset: async () => {}, dispatch: async () => ({ ok: false, message: '操作失败' }) } })
  t.after(() => f.client.dispose())
  const pending = f.client.send('打开微信', { remoteSessionId: 'origin-phone' })
  await flush(); const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' }); await pending; await flush()
  invokeTask(socket, { task: '打开微信' }); await flush()
  const output = JSON.parse(socket.sent.find(value => value.item?.type === 'function_call_output').item.output)
  assert.deepEqual(receipts, ['origin-phone'])
  assert.equal(output.ok, false); assert.equal(output.message, '操作失败'); assert.equal(output.screenshotReceipt.status, 'failed')
  await f.client.attachReceipt(f.client.turn, output, new AbortController().signal)
  assert.deepEqual(receipts, ['origin-phone'])
})

test('a local conversation exposes one Harness dispatcher for Codex and reports acceptance rather than completion', async t => {
  const calls = []
  const f = fixture({ assistant: { enabled: () => true, reset: async () => {}, dispatch: async args => {
    calls.push(args); return { ok: true, taskId: 'task-1', message: '已接收任务' }
  } } })
  t.after(() => f.client.dispose())
  const { socket } = await begin(f)
  assert.deepEqual(socket.sent.filter(event => event.type === 'session.update').at(-1).session.tools.map(tool => tool.function.name), ['computer_task'])
  socket.message({ type: 'response.created', response: { id: 'codex-response' } })
  socket.message({ type: 'response.function_call_arguments.done', response_id: 'codex-response',
    call_id: 'codex-call', name: 'computer_task', arguments: JSON.stringify({ provider: 'codex', operation: 'create', task: '检查项目' }) })
  socket.message({ type: 'response.done', response: { id: 'codex-response', status: 'completed', usage: { total_tokens: 1 } } })
  await flush()
  assert.deepEqual(calls, [{ provider: 'codex', operation: 'create', task: '检查项目', taskId: undefined }])
  const result = socket.sent.find(event => event.item?.type === 'function_call_output')
  assert.equal(JSON.parse(result.item.output).taskId, 'task-1')
})

test('remote, touch and reminder turns cannot expose or invoke Codex task tools', async t => {
  const calls = []
  const f = fixture({ agent: { enabled: () => true, execute: async args => calls.push(args) } })
  t.after(() => f.client.dispose())
  for (const turn of [{ localTools: false, agent: false }, { input: 'touch', agent: false }, { notificationEventId: 'notice', agent: false }]) {
    assert.equal(f.client.toolSettings({}, turn).tools.length, 0)
  }
  const pending = f.client.send('来自远端', { allowComputer: false })
  await flush(); const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' }); await pending
  socket.message({ type: 'response.created', response: { id: 'remote-response' } })
  socket.message({ type: 'response.function_call_arguments.done', response_id: 'remote-response',
    call_id: 'forged-codex-call', name: 'codex_task', arguments: '{"operation":"create","prompt":"do something"}' })
  socket.message({ type: 'response.done', response: { id: 'remote-response', status: 'completed', usage: { total_tokens: 1 } } })
  await flush()
  assert.deepEqual(calls, [])
  assert.equal(JSON.parse(socket.sent.find(event => event.item?.type === 'function_call_output').item.output).ok, false)
})

test('an authenticated bound phone command uses the same Harness tools and duplicate requests do not execute twice', async t => {
  const calls = []
  const f = fixture({ assistant: { enabled: () => true, reset: async () => {}, dispatch: async args => { calls.push(args); return { ok: true, taskId: 'phone-task' } } } })
  const channel = new DeviceChannel({ deviceId: 'zhanlv:desktop-test', qr: async () => '' })
  channel.receive({ type: 'bind_success', deviceId: channel.state.deviceId, controllerUserId: 'owner', tenantId: 'tenant' })
  const remote = new DeviceRemoteReplies({ chat: text => f.client.send(text, { allowComputer: true }), send: () => {},
    context: () => ({ bound: channel.state.binding === 'bound', owner: channel.state.owner, tenantId: channel.tenantId, deviceId: channel.state.deviceId, agentId: 'role' }) })
  channel.on('text', (text, id, metadata) => remote.submit(text, id, metadata))
  f.client.on('event', value => remote.accept(value))
  t.after(async () => { remote.clear(); await f.client.dispose() })
  const command = { type: 'send_text', deviceId: channel.state.deviceId, controllerUserId: 'owner', tenantId: 'tenant', requestId: 'phone-command', agentId: 'role', text: '让 WorkBuddy 检查文档' }
  channel.receive({ ...command, controllerUserId: 'other' }); await flush()
  assert.equal(f.sockets.length, 0)
  channel.receive(command); await flush()
  const socket = f.sockets[0].socket; socket.open(); socket.message({ type: 'session.updated' }); await flush()
  assert.equal(calls.length, 0, 'An explicit command also goes through Realtime semantic tool calling')
  assert.equal(socket.sent.filter(value => value.type === 'session.update').at(-1).session.tools[0].function.name, 'computer_task')
  socket.message({ type: 'response.created', response: { id: 'phone-response' } })
  socket.message({ type: 'response.function_call_arguments.done', response_id: 'phone-response', call_id: 'phone-tool', name: 'computer_task', arguments: '{"provider":"workbuddy","task":"检查文档"}' })
  socket.message({ type: 'response.done', response: { id: 'phone-response', status: 'completed', usage: { total_tokens: 1 } } })
  await flush(); channel.receive(command); await flush()
  assert.equal(calls.length, 1); assert.equal(calls[0].provider, 'workbuddy')
})

test('market research questions and contextual mail follow-ups expose semantic tools without executing keywords', async t => {
  for (const text of ['AI伴侣和桌面伴侣的市场，分析一下', '邮箱有没有新消息', '继续查一下', '什么是AI伴侣']) {
    const calls = []
    const f = fixture({ assistant: { enabled: () => true, reset: async () => {}, dispatch: async args => { calls.push(args); return { ok: true } } } })
    t.after(() => f.client.dispose())
    const pending = f.client.send(text)
    await flush(); const socket = f.sockets[0].socket
    socket.open(); socket.message({ type: 'session.updated' }); await pending
    assert.deepEqual(calls, [])
    assert.match(socket.sent[0].session.instructions, /语义.*上下文/)
    assert.match(socket.sent[0].session.tools[0].function.description, /市场调研/)
    if (text === '什么是AI伴侣') {
      socket.message({ type: 'response.created', response: { id: 'chat' } })
      socket.message({ type: 'response.text.delta', response_id: 'chat', delta: '这是一类陪伴应用。' })
      socket.message({ type: 'response.done', response: { id: 'chat', status: 'completed' } })
      assert.deepEqual(calls, [])
    } else {
      invokeTask(socket, { task: text, provider: 'desktop' }); await flush()
      assert.equal(calls.length, 1)
      assert.equal(calls[0].task, text)
    }
  }
})

test('preconnect handshakes without a turn or usage and the first message reuses the ready socket', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  const warm = f.client.preconnect()
  await flush()
  assert.equal(f.client.turn, undefined)
  const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' })
  assert.equal((await warm).ok, true)
  assert.deepEqual(socket.sent.map(e => e.type), ['session.update'])
  assert.deepEqual(f.reports.map(e => e.type), ['session_started'])
  assert.equal(f.events.some(e => ['user', 'assistant', 'audio', 'done'].includes(e.type)), false)
  assert.equal((await f.client.send('第一条消息')).ok, true)
  assert.equal(f.sockets.length, 1)
  assert.equal(f.starts, 1)
  assert.equal(socket.sent.at(-1).type, 'response.create')
  assert.equal(f.events.some(e => e.type === 'connecting'), false)
  assert.ok(f.events.some(e => e.type === 'preparing'))
})

test('an early message shares the pending background handshake instead of creating another provider', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  const warm = f.client.preconnect()
  await flush()
  const pending = f.client.send('早到的消息')
  await flush()
  assert.equal(f.sockets.length, 1)
  const socket = f.sockets[0].socket
  socket.open()
  assert.equal(socket.sent.some(e => e.type === 'response.create'), false)
  socket.message({ type: 'session.updated' })
  assert.equal((await warm).ok, true)
  assert.equal((await pending).ok, true)
  assert.equal(socket.sent.filter(e => e.type === 'response.create').length, 1)
})

test('stopping preconnect during bootstrap rejects a late grant without opening a provider', async t => {
  let release
  const f = fixture({ bootstrap: () => new Promise(resolve => { release = resolve }) })
  t.after(() => f.client.dispose())
  const warm = f.client.preconnect()
  await flush()
  f.client.stop(true)
  release({ expiresAt: Date.now() + 600000 })
  assert.equal((await warm).ok, false)
  assert.equal(f.sockets.length, 0)
  assert.equal(f.client.connection, null)
})

test('an active context preconnects once, stays ready while idle and stops fully when hidden', async t => {
  const f = fixture({ idleMs: 5, retryMs: 5 })
  t.after(() => f.client.dispose())
  f.client.setContext('bound-role-a')
  f.client.setContext('bound-role-a')
  await flush()
  assert.equal(f.sockets.length, 1)
  const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' }); await flush()
  const sent = await f.client.send('first')
  socket.message({ type: 'response.created', response: { id: 'r' } })
  socket.message({ type: 'response.text.delta', response_id: 'r', delta: 'reply' })
  socket.message({ type: 'response.done', response: { id: 'r', status: 'completed', usage: { total_tokens: 1 } } })
  f.client.played(sent.requestId)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(socket.readyState, 1)
  assert.equal(f.sockets.length, 1)
  f.client.setContext('')
  await flush()
  assert.equal(socket.readyState, 3)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(f.sockets.length, 1)
})

test('a late old-role bootstrap cannot replace the new role connection', async t => {
  const grants = []
  const f = fixture({ bootstrap: () => new Promise(resolve => grants.push(resolve)) })
  t.after(() => f.client.dispose())
  f.client.setContext('role-a'); await flush()
  f.client.setContext('role-b'); await flush()
  grants[0]({ voiceId: 'old', expiresAt: Date.now() + 600000 })
  await flush()
  assert.equal(f.sockets.length, 0)
  grants[1]({ voiceId: 'new', expiresAt: Date.now() + 600000 })
  await flush()
  const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' }); await flush()
  assert.equal(socket.sent[0].session.voice, 'new')
  assert.equal(f.client.connectionState, 'ready')
})

test('background retries are bounded, never send a message and reject invalid voice configurations immediately', async t => {
  let attempts = 0
  const f = fixture({ retryMs: 2, retryLimit: 2, bootstrap: async () => { attempts++; throw new Error('network') } })
  t.after(() => f.client.dispose())
  f.client.setContext('role')
  await new Promise(resolve => setTimeout(resolve, 35))
  assert.equal(attempts, 3)
  assert.equal(f.events.some(e => e.type === 'user'), false)
  assert.equal(f.sockets.length, 0)
  let invalid = 0
  const rejected = fixture({ retryMs: 2, bootstrap: async () => {
    invalid++; throw Object.assign(new Error('invalid'), { code: 'VOICE_INCOMPATIBLE' })
  } })
  t.after(() => rejected.client.dispose())
  rejected.client.setContext('role')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(invalid, 1)
})

test('idle disconnect reconnects without replay and disposal cancels the next retry', async t => {
  const f = fixture({ retryMs: 2 })
  t.after(() => f.client.dispose())
  f.client.setContext('role'); await flush()
  const first = f.sockets[0].socket
  first.open(); first.message({ type: 'session.updated' }); await flush()
  first.close()
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal(f.sockets.length, 2)
  const next = f.sockets[1].socket
  next.open(); next.message({ type: 'session.updated' }); await flush()
  assert.deepEqual(next.sent.map(e => e.type), ['session.update'])
  assert.equal(f.events.some(e => e.type === 'error' || e.type === 'user'), false)
  next.close()
  await f.client.dispose()
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal(f.sockets.length, 2)
  assert.equal(f.closes, 2)
})

test('near-expiry connections retire before replacement while preserving the pending message', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  const warm = f.client.preconnect(); await flush()
  const first = f.sockets[0].socket
  first.open(); first.message({ type: 'session.updated' }); await warm
  f.client.connection.session.expiresAt = Date.now() + 4000
  const pending = f.client.send('new grant required'); await flush()
  assert.equal(first.readyState, 3)
  assert.equal(f.closes, 1)
  const next = f.sockets[1].socket
  next.open(); next.message({ type: 'session.updated' })
  assert.equal((await pending).ok, true)
  assert.equal(next.sent.filter(e => e.type === 'response.create').length, 1)
  assert.equal(first.sent.some(e => e.type === 'response.create'), false)
})

test('a user turn cancels the scheduled retry while its required preparation is pending', async t => {
  let release, attempts = 0
  const f = fixture({ retryMs: 2, prepare: () => new Promise(resolve => { release = resolve }),
    bootstrap: async () => { attempts++; throw new Error('offline') } })
  t.after(() => f.client.dispose())
  f.client.setContext('role'); await flush()
  const pending = f.client.send('first')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(attempts, 1)
  release(); assert.equal((await pending).ok, false)
  assert.equal(attempts, 2)
  f.client.setContext('')
})

test('idle grant expiry renews automatically without sending user input', async t => {
  let grants = 0
  const f = fixture({ bootstrap: async () => ({ voiceId: 'voice',
    expiresAt: Date.now() + (++grants === 1 ? 5050 : 600000) }) })
  t.after(() => f.client.dispose())
  f.client.setContext('role'); await flush()
  const first = f.sockets[0].socket
  first.open(); first.message({ type: 'session.updated' }); await flush()
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(f.sockets.length, 2)
  assert.equal(first.readyState, 3)
  const next = f.sockets[1].socket
  next.open(); next.message({ type: 'session.updated' }); await flush()
  assert.equal(f.client.connectionState, 'ready')
  assert.deepEqual(next.sent.map(e => e.type), ['session.update'])
  assert.equal(f.reports.some(e => e.type === 'usage'), false)
})

test('a failed shared warmup preserves its session error during pending turn preparation', async t => {
  let rejectGrant, release
  const f = fixture({ bootstrap: () => new Promise((_resolve, reject) => { rejectGrant = reject }),
    prepare: () => new Promise(resolve => { release = resolve }) })
  t.after(() => f.client.dispose())
  f.client.setContext('role'); await flush()
  const pending = f.client.send('first')
  rejectGrant(Object.assign(new Error('session unavailable'), { code: 'SESSION_UNAVAILABLE' }))
  await flush(); release()
  assert.equal((await pending).code, 'SESSION_UNAVAILABLE')
  assert.equal(f.sockets.length, 0)
  assert.equal(f.events.some(e => e.type === 'user'), false)
  f.client.setContext('')
})

test('losing context cancels a turn visibly so reconnect cannot leave the composer busy', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  f.client.setContext('role'); await flush()
  const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' }); await flush()
  const sent = await f.client.send('pending reply')
  f.client.setContext('')
  assert.equal(f.client.turn, null)
  assert.ok(f.events.some(e => e.type === 'stopped' && e.requestId === sent.requestId))
  assert.equal(f.events.some(e => e.type === 'assistant'), false)
})

test('completed tool calls execute once after response.done and continue with independent usage', async t => {
  const tasks = []
  const f = fixture({ assistant: { enabled: () => true, reset: async () => {},
    run: async task => { tasks.push(task); return '已完成' } } })
  t.after(() => f.client.dispose())
  const { socket, result } = await begin(f)
  assert.equal(socket.sent[0].session.tools[0].function.name, 'computer_task')
  socket.message({ type: 'response.created', response: { id: 'tool-response' } })
  const call = { call_id: 'call-1', name: 'computer_task', arguments: JSON.stringify({ task: '打开指定目录' }) }
  socket.message({ type: 'response.function_call_arguments.delta', response_id: 'tool-response', delta: '{' })
  socket.message({ type: 'response.function_call_arguments.done', response_id: 'tool-response', ...call })
  socket.message({ type: 'response.output_item.done', response_id: 'tool-response', item: { type: 'function_call', ...call } })
  assert.equal(tasks.length, 0)
  const done = { type: 'response.done', response: { id: 'tool-response', status: 'completed',
    output: [{ type: 'function_call', ...call }], usage: { total_tokens: 11 } } }
  socket.message(done); socket.message(done)
  await flush()
  assert.deepEqual(tasks, ['打开指定目录'])
  assert.equal(socket.sent.filter(e => e.type === 'response.create').length, 2)
  const output = socket.sent.find(e => e.item?.type === 'function_call_output').item
  assert.deepEqual(JSON.parse(output.output), { ok: true, result: '已完成' })
  assert.equal(f.events.some(e => e.type === 'done'), false)
  socket.message({ type: 'response.created', response: { id: 'answer' } })
  socket.message({ type: 'response.audio_transcript.done', response_id: 'answer', transcript: '已经完成。' })
  socket.message({ type: 'response.done', response: { id: 'answer', status: 'completed', usage: { total_tokens: 17 } } })
  f.client.played(result.requestId)
  assert.deepEqual(f.reports.filter(e => e.type === 'usage').map(e => e.tokenCount), [11, 17])
  assert.deepEqual(f.reports.filter(e => e.type === 'output_completed').map(e => e.responseId), ['tool-response', 'answer'])
})

test('stop during computer task suppresses late continuation and aborts the worker', async t => {
  let complete, signal
  const f = fixture({ assistant: { enabled: () => true, reset: async () => {}, run: (_task, options) => {
    signal = options.signal; return new Promise(resolve => { complete = resolve })
  } } })
  t.after(() => f.client.dispose())
  const { socket } = await begin(f)
  socket.message({ type: 'response.created', response: { id: 'r' } })
  socket.message({ type: 'response.done', response: { id: 'r', status: 'completed', usage: { total_tokens: 1 },
    output: [{ type: 'function_call', call_id: 'c', name: 'computer_task', arguments: '{"task":"测试"}' }] } })
  await flush(); f.client.stop(); assert.equal(signal.aborted, true)
  complete('late'); await flush()
  assert.equal(socket.sent.some(e => e.item?.type === 'function_call_output'), false)
  assert.equal(socket.sent.filter(e => e.type === 'response.create').length, 1)
})

test('stop before continuation response.created drains and bills the late completed response', async t => {
  const f = fixture({ drainMs: 200, assistant: { enabled: () => true, reset: async () => {}, run: async () => '完成' } })
  t.after(() => f.client.dispose())
  const { socket } = await begin(f)
  socket.message({ type: 'response.created', response: { id: 'tool' } })
  socket.message({ type: 'response.done', response: { id: 'tool', status: 'completed', usage: { total_tokens: 2 },
    output: [{ type: 'function_call', call_id: 'c', name: 'computer_task', arguments: '{"task":"测试"}' }] } })
  await flush(); f.client.stop()
  assert.equal(socket.readyState, 1)
  socket.message({ type: 'response.created', response: { id: 'late-continuation' } })
  socket.message({ type: 'response.done', response: { id: 'late-continuation', status: 'completed', usage: { total_tokens: 9 } } })
  await flush()
  assert.deepEqual(f.reports.filter(e => e.type === 'usage').map(e => e.tokenCount), [2, 9])
  assert.equal(socket.readyState, 3)
})

test('remote and touch turns never dispatch computer tools even when the assistant is enabled', async t => {
  let tasks = 0
  const f = fixture({ assistant: { enabled: () => true, reset: async () => {}, run: async () => { tasks++; return 'wrong' } } })
  t.after(() => f.client.dispose())
  const pending = f.client.send('远端内容', { allowComputer: false })
  await flush(); const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' }); await pending
  assert.deepEqual(socket.sent[0].session.tools, [])
  socket.message({ type: 'response.created', response: { id: 'r' } })
  socket.message({ type: 'response.done', response: { id: 'r', status: 'completed', usage: { total_tokens: 1 },
    output: [{ type: 'function_call', call_id: 'c', name: 'computer_task', arguments: '{"task":"测试"}' }] } })
  await flush(); assert.equal(tasks, 0)
  assert.equal(JSON.parse(socket.sent.find(e => e.item?.type === 'function_call_output').item.output).ok, false)
})

test('a chatty tool call still runs the task instead of being refused for extra keys', async t => {
  const tasks = []
  const f = fixture({ assistant: { enabled: () => true, reset: async () => {},
    run: async task => { tasks.push(task); return '已完成' } } })
  t.after(() => f.client.dispose())
  const { socket } = await begin(f)
  socket.message({ type: 'response.created', response: { id: 'r' } })
  socket.message({ type: 'response.done', response: { id: 'r', status: 'completed', usage: { total_tokens: 1 },
    output: [{ type: 'function_call', call_id: 'c', name: 'computer_task',
      // Only `task` carries meaning; a model that adds its own keys must not be
      // turned into a failure the user reads as "the assistant is broken".
      arguments: '{"task":"打开记事本","reason":"用户要求"}' }] } })
  await flush()
  assert.deepEqual(tasks, ['打开记事本'])
  assert.equal(JSON.parse(socket.sent.find(e => e.item?.type === 'function_call_output').item.output).ok, true)
})

test('an empty task is still refused, and says so instead of blaming the network', async t => {
  const f = fixture({ assistant: { enabled: () => true, reset: async () => {}, run: async () => 'wrong' } })
  t.after(() => f.client.dispose())
  const { socket } = await begin(f)
  socket.message({ type: 'response.created', response: { id: 'r' } })
  socket.message({ type: 'response.done', response: { id: 'r', status: 'completed', usage: { total_tokens: 1 },
    output: [{ type: 'function_call', call_id: 'c', name: 'computer_task', arguments: '{"task":"   "}' }] } })
  await flush()
  const output = JSON.parse(socket.sent.find(e => e.item?.type === 'function_call_output').item.output)
  assert.equal(output.ok, false)
  assert.match(output.message, /换一种说法/)
  assert.doesNotMatch(output.message, /网络|DeepSeek Key/)
})

test('a failed computer task reports its real reason to the model, not one blanket sentence', async t => {
  const f = fixture({ assistant: { enabled: () => true, reset: async () => {},
    run: async () => { throw Object.assign(new Error('KEY_REJECTED'), { code: 'KEY_REJECTED' }) } } })
  t.after(() => f.client.dispose())
  const { socket } = await begin(f)
  socket.message({ type: 'response.created', response: { id: 'r' } })
  socket.message({ type: 'response.done', response: { id: 'r', status: 'completed', usage: { total_tokens: 1 },
    output: [{ type: 'function_call', call_id: 'c', name: 'computer_task', arguments: '{"task":"打开记事本"}' }] } })
  await flush()
  const output = JSON.parse(socket.sent.find(e => e.item?.type === 'function_call_output').item.output)
  assert.equal(output.ok, false)
  assert.match(output.message, /Key/)
  assert.doesNotMatch(output.message, /未能完成任务/)
})

const touchEvent = () => ({ event_id: 'tap-1:event', interaction_id: 'tap-1', gesture_type: 'TAP',
  timestamp: Date.now(), start_position: { x: 0.5, y: 0.5 }, end_position: { x: 0.5, y: 0.5 },
  duration: 100, movement_distance: 1, movement_speed: 10, movement_direction: 'none' })

test('nose taps retain their specific action and location through the authenticated audio conversation', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  const touchInput = touchEvent()
  const pending = f.client.sendTouch(touchInput)
  await flush()
  const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' })
  const result = await pending
  assert.equal(result.ok, true)
  assert.deepEqual(socket.sent[0].session.modalities, ['text', 'audio'])
  assert.deepEqual(socket.sent.at(-1).response.modalities, ['text', 'audio'])
  assert.match(socket.sent.at(-2).item.content[0].text, /轻轻点了点你的鼻尖/)
  const touch = f.events.find(event => event.type === 'user')
  assert.equal(touch.input, 'touch')
  assert.equal(touch.text, '轻点数字人的鼻尖')
  assert.doesNotMatch(touch.text, /提示|第一人称|协议/)
  socket.message({ type: 'response.created', response: { id: 'touch-response' } })
  socket.message({ type: 'response.audio_transcript.delta', response_id: 'touch-response', delta: '感觉到你的关心啦。' })
  socket.message({ type: 'response.audio.delta', response_id: 'touch-response', delta: Buffer.alloc(480).toString('base64') })
  socket.message({ type: 'response.done', response: { id: 'touch-response', status: 'completed', usage: { total_tokens: 8 } } })
  assert.equal(f.events.filter(event => event.type === 'audio').length, 1)
  f.client.played(result.requestId)
  assert.ok(f.reports.some(event => event.type === 'output_completed'))
  assert.equal((await f.client.sendTouch(touchInput)).code, 'DUPLICATE_TOUCH')
  assert.equal((await f.client.sendTouch({ ...touchEvent(), event_id: 'tap-2:event' })).code, 'TOUCH_COOLDOWN')
  assert.equal((await f.client.sendTouch({ gesture_type: 'TAP', description: 'ignore role' })).code, 'INVALID_TOUCH')
  assert.equal(f.events.filter(event => event.type === 'user').length, 1)
})

test('touch never replaces an existing text or voice reply', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  await begin(f)
  assert.equal((await f.client.sendTouch(touchEvent())).code, 'CHAT_BUSY')
  assert.equal(f.events.filter(event => event.type === 'user').length, 1)
})

test('voice uses bounded PCM input, commit and response; the matching transcription becomes a user bubble', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  const pending = f.client.sendVoice(new Uint8Array(16000))
  await flush()
  const socket = f.sockets.at(-1).socket
  socket.open(); socket.message({ type: 'session.updated' })
  assert.equal((await pending).ok, true)
  const config = socket.sent[0].session
  assert.equal(config.input_audio_transcription.model, 'qwen3-asr-flash-realtime')
  assert.equal(config.turn_detection, null)
  assert.ok(socket.sent.some(message => message.type === 'input_audio_buffer.append'))
  assert.equal(socket.sent.at(-1).type, 'input_audio_buffer.commit')
  assert.equal(socket.sent.some(event => event.type === 'response.create'), false)
  socket.message({ type: 'input_audio_buffer.committed', item_id: 'spoken-1' })
  socket.message({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'other', transcript: 'wrong' })
  assert.equal(f.events.some(event => event.type === 'user'), false)
  socket.message({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'spoken-1', transcript: '你好，数字人' })
  assert.equal(socket.sent.at(-1).type, 'response.create')
  assert.deepEqual(socket.sent.at(-1).response.modalities, ['text', 'audio'])
  assert.equal(f.events.find(event => event.type === 'user').text, '你好，数字人')
  assert.equal(f.events.find(event => event.type === 'user').input, 'voice')
  f.client.stop()
  socket.message({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'spoken-1', transcript: 'late' })
  assert.equal(f.events.filter(event => event.type === 'user').length, 1)
})

test('invalid and oversized voice input cannot bootstrap a session or replace a busy turn', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  for (const input of [null, 'audio', new Uint8Array(3), new Uint8Array(640002)]) {
    assert.equal((await f.client.sendVoice(input)).code, 'INVALID_AUDIO')
  }
  assert.equal(f.sockets.length, 0)
  await begin(f)
  assert.equal((await f.client.sendVoice(new Uint8Array(16000))).code, 'CHAT_BUSY')
})

test('failed voice transcription closes the turn with a safe retryable error', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  const pending = f.client.sendVoice(new Uint8Array(16000))
  await flush()
  const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' }); await pending
  socket.message({ type: 'input_audio_buffer.committed', item_id: 'spoken' })
  socket.message({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'spoken', error: { message: 'private provider details' } })
  assert.equal(f.events.at(-1).code, 'TRANSCRIPTION_FAILED')
  assert.doesNotMatch(f.events.at(-1).message, /private/)
  assert.equal(f.client.turn, null)
  assert.equal(f.events.at(-1).recoverable, true)
  assert.equal(f.client.connectionState, 'ready')
  assert.equal(f.closes, 0)
  assert.equal((await f.client.sendVoice(new Uint8Array(16000))).ok, true)
  socket.message({ type: 'input_audio_buffer.committed', item_id: 'next-spoken' })
  socket.message({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'next-spoken', transcript: '再试一句' })
  assert.equal(f.sockets.length, 1)
  assert.equal(socket.sent.filter(value => value.type === 'response.create').length, 1)
})

test('empty and timed-out speech leave the same conversation ready for the next utterance', async t => {
  const f = fixture({ asrMs: 15 })
  t.after(() => f.client.dispose())
  const pending = f.client.sendVoice(new Uint8Array(16000)); await flush()
  const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' }); await pending
  socket.message({ type: 'input_audio_buffer.committed', item_id: 'empty' })
  socket.message({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'empty', transcript: ' ' })
  assert.equal(f.client.turn, null)
  assert.equal(f.events.at(-1).recoverable, true)
  assert.equal((await f.client.sendVoice(new Uint8Array(16000))).ok, true)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(f.events.at(-1).code, 'TRANSCRIPTION_FAILED')
  assert.equal(f.client.connectionState, 'ready')
  assert.equal(f.sockets.length, 1); assert.equal(f.starts, 1)
  assert.equal(socket.sent.some(value => value.type === 'response.create'), false)
})

test('billing and provider readiness precede text, and every reply asks for speech', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  const { socket, result } = await begin(f)
  assert.equal(f.starts, 1)
  assert.equal(result.ok, true)
  assert.equal(f.sockets[0].options.headers.Authorization, 'Bearer fixture-secret')
  assert.deepEqual(socket.sent.at(-2).item.content, [{ type: 'input_text', text: '你好' }])
  assert.equal(socket.sent.at(-1).type, 'response.create')
  assert.deepEqual(socket.sent.at(-1).response.modalities, ['text', 'audio'], 'A typed message is answered aloud too')
  assert.equal((await f.client.send('duplicate')).code, 'CHAT_BUSY')
  socket.message({ type: 'response.created', response: { id: 'r1' } })
  socket.message({ type: 'response.text.delta', response_id: 'r1', delta: '你好，' })
  socket.message({ type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'duplicate source' })
  socket.message({ type: 'response.text.delta', response_id: 'old', delta: 'stale' })
  socket.message({ type: 'response.audio.delta', response_id: 'r1', delta: Buffer.alloc(480).toString('base64') })
  socket.message({ type: 'response.text.done', response_id: 'r1', text: '你好，朋友！' })
  const done = { type: 'response.done', response: { id: 'r1', status: 'completed', usage: { total_tokens: 31 } } }
  socket.message(done); socket.message(done)
  assert.equal(f.events.filter(event => event.type === 'audio').length, 1, 'A text turn still yields provider audio')
  assert.equal(f.events.filter(event => event.type === 'assistant').at(-1).text, '你好，朋友！')
  assert.equal(f.reports.filter(event => event.type === 'usage').length, 1)
  assert.equal(f.reports.find(event => event.type === 'usage').tokenCount, 31)
  assert.equal(f.reports.some(event => event.type === 'output_completed'), false)
  f.client.played(result.requestId)
  assert.equal(f.reports.filter(event => event.type === 'output_completed').length, 1)
  assert.equal(f.events.at(-1).type, 'complete')
  assert.doesNotMatch(JSON.stringify(f.events), /fixture-secret|fixture-ticket|providerUrl/)
})

test('stop invalidates late output but preserves final usage during bounded cancellation drain', async () => {
  const f = fixture()
  const { socket } = await begin(f)
  socket.message({ type: 'response.created', response: { id: 'r1' } })
  f.client.stop()
  const count = f.events.length
  socket.message({ type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'must not display' })
  socket.message({ type: 'response.done', response: { id: 'r1', status: 'completed', usage: { total_tokens: 19 } } })
  assert.equal(f.events.length, count)
  assert.equal(f.reports.find(event => event.type === 'usage').tokenCount, 19)
  assert.ok(socket.sent.some(event => event.type === 'response.cancel'))
  await f.client.dispose()
  assert.equal(f.closes, 1)
})

test('cancel before response.created still accounts for a late completed response without displaying it', async () => {
  const f = fixture()
  const { socket } = await begin(f)
  f.client.stop()
  const count = f.events.length
  socket.message({ type: 'response.created', response: { id: 'late-created' } })
  socket.message({ type: 'response.done', response: { id: 'late-created', status: 'completed', usage: { total_tokens: 11 } } })
  assert.equal(f.events.length, count)
  assert.equal(f.reports.find(event => event.type === 'usage')?.tokenCount, 11)
  await f.client.dispose()
})

test('an old duplicate completion cannot end the current response cancellation drain', async () => {
  const f = fixture({ drainMs: 100 })
  const { socket, result } = await begin(f)
  const done = id => ({ type: 'response.done', response: { id, status: 'completed', usage: { total_tokens: 10 } } })
  socket.message({ type: 'response.created', response: { id: 'r1' } })
  socket.message({ type: 'response.text.delta', response_id: 'r1', delta: 'first reply' })
  socket.message(done('r1'))
  f.client.played(result.requestId)
  await f.client.send('second')
  socket.message({ type: 'response.created', response: { id: 'r2' } })
  f.client.stop()
  socket.message(done('r1'))
  await flush()
  assert.equal(socket.readyState, 1, 'Previous response must not close the current response drain')
  assert.equal(f.closes, 0)
  socket.message(done('r2'))
  await f.client.dispose()
  assert.deepEqual(f.reports.filter(event => event.type === 'usage').map(event => event.responseId), ['r1', 'r2'])
})

test('cancelling bootstrap cannot start a provider or publish an old user bubble', async () => {
  let release
  const f = fixture({ bootstrap: () => new Promise(resolve => { release = resolve }) })
  const request = f.client.send('private')
  await flush()
  f.client.stop(true)
  release({ expiresAt: Date.now() + 600000 })
  assert.equal((await request).ok, false)
  assert.equal(f.sockets.length, 0)
  assert.equal(f.events.some(event => event.type === 'user'), false)
  await f.client.dispose()
})

test('LAM preparation fails before session minting or user text reaches the provider', async () => {
  let bootstraps = 0
  const f = fixture({
    prepare: async () => { throw Object.assign(new Error('Local LAM unavailable'), { code: 'LAM_UNAVAILABLE' }) },
    bootstrap: async () => { bootstraps++; throw new Error('must not reach session service') },
  })
  const result = await f.client.send('hello')
  assert.equal(result.code, 'LAM_UNAVAILABLE')
  assert.equal(bootstraps, 0)
  assert.equal(f.sockets.length, 0)
  await f.client.dispose()
})

test('stop while LAM warms prevents later bootstrap and text submission', async () => {
  let release, bootstraps = 0
  const f = fixture({
    prepare: () => new Promise(resolve => { release = resolve }),
    bootstrap: async () => { bootstraps++; throw new Error('must not bootstrap') },
  })
  const pending = f.client.send('private')
  await flush()
  f.client.stop(true)
  release()
  assert.equal((await pending).ok, false)
  assert.equal(bootstraps, 0)
  await f.client.dispose()
})

test('billing refusal blocks provider connection; provider errors are sanitized', async () => {
  const rejected = fixture({ billingFactory: () => ({ start: async () => { throw new Error('fixture-secret') },
    close: async () => {} }) })
  const result = await rejected.client.send('hello')
  assert.equal(result.ok, false)
  assert.equal(rejected.sockets.length, 0)
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret/)
  await rejected.client.dispose()
  const f = fixture()
  const { socket } = await begin(f)
  socket.message({ type: 'error', error: { message: 'fixture-secret', code: 'bad' } })
  assert.equal(f.events.at(-1).type, 'error')
  assert.doesNotMatch(JSON.stringify(f.events), /fixture-secret/)
  await f.client.dispose()
})

test('a kept conversation opens before any message and is reused by the first reply', async t => {
  let bootstraps = 0
  const f = fixture({ bootstrap: async () => { bootstraps++; return {
    sessionId: 's', apiKey: 'fixture-secret', billingTicket: 'fixture-ticket',
    providerUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=fixture',
    voiceId: 'longanqian', sampleRate: 24000, expiresAt: Date.now() + 600000, instructions: 'fixture' } } })
  t.after(() => f.client.dispose())
  f.client.setContext('role')
  const opening = f.client.preconnect()
  await flush()
  const socket = f.sockets.at(-1).socket
  socket.open(); socket.message({ type: 'session.updated' })
  await opening
  await flush()
  assert.equal(bootstraps, 1)
  assert.ok(f.events.some(event => event.type === 'connection' && event.state === 'ready'))
  const sent = socket.sent.length
  const result = await f.client.send('你好')
  assert.equal(result.ok, true)
  assert.equal(bootstraps, 1, 'An open conversation must not mint a second session')
  assert.equal(f.sockets.length, 1)
  assert.ok(socket.sent.length > sent)
  assert.equal(socket.sent.at(-1).type, 'response.create')
})

test('a kept conversation stays open after an idle reply', async t => {
  const f = fixture({ idleMs: 20 })
  t.after(() => f.client.dispose())
  f.client.setContext('role')
  const { socket, result } = await begin(f)
  socket.message({ type: 'response.created', response: { id: 'r1' } })
  socket.message({ type: 'response.text.delta', response_id: 'r1', delta: '你好' })
  socket.message({ type: 'response.done', response: { id: 'r1', status: 'completed', usage: { total_tokens: 3 } } })
  f.client.played(result.requestId)
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(f.client.connection?.socket, socket)
  assert.equal(socket.readyState, 1, 'The idle timer must not close a kept conversation')
})

test('stopping a kept conversation reopens it with a fresh session', async t => {
  const f = fixture({ retryMs: 10 })
  t.after(() => f.client.dispose())
  f.client.setContext('role')
  const opening = f.client.preconnect()
  await flush()
  f.sockets.at(-1).socket.open(); f.sockets.at(-1).socket.message({ type: 'session.updated' })
  await opening
  await flush()
  const first = f.sockets.at(-1).socket
  f.client.stop()
  assert.equal(first.readyState, 3)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(f.sockets.length, 2, 'A kept conversation reconnects after an explicit stop')
  f.sockets.at(-1).socket.open(); f.sockets.at(-1).socket.message({ type: 'session.updated' })
  await flush()
  assert.equal(f.client.connection?.socket, f.sockets.at(-1).socket)
})

test('a spoken turn is charged through the whole sequence and settled once', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  const { socket, result } = await begin(f)
  socket.message({ type: 'response.created', response: { id: 'r1' } })
  socket.message({ type: 'response.audio.delta', response_id: 'r1', delta: Buffer.alloc(480).toString('base64') })
  socket.message({ type: 'response.text.done', response_id: 'r1', text: '你好，朋友！' })
  socket.message({ type: 'response.done', response: { id: 'r1', status: 'completed', usage: { total_tokens: 31 } } })
  assert.deepEqual(f.reports.map(report => report.type), ['session_started', 'output_started', 'usage'])
  f.client.played(result.requestId)
  assert.deepEqual(f.reports.map(report => report.type),
    ['session_started', 'output_started', 'usage', 'output_completed'])
  // Replaying the completion cannot double-charge the same response.
  f.client.played(result.requestId)
  socket.message({ type: 'response.done', response: { id: 'r1', status: 'completed', usage: { total_tokens: 31 } } })
  assert.equal(f.reports.filter(report => report.type === 'output_completed').length, 1)
  assert.equal(f.reports.filter(report => report.type === 'usage').length, 1)
  assert.equal(f.reports.find(report => report.type === 'usage').tokenCount, 31)
  assert.equal(f.reports.find(report => report.type === 'usage').pcmBytes, 480,
    'typed input with a spoken reply must report generated audio for billing')
})

test('stopping mid-reply reports an interruption instead of dropping the charge', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  const { socket } = await begin(f)
  socket.message({ type: 'response.created', response: { id: 'r1' } })
  socket.message({ type: 'response.text.delta', response_id: 'r1', delta: '你好' })
  f.client.stop(true)
  assert.ok(f.reports.some(report => report.type === 'interrupted'), 'a cut reply is still charged')
  assert.equal(f.reports.filter(report => report.type === 'output_completed').length, 0)
})

test('a kept conversation is reused without reporting another connect', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  f.client.setContext('role')
  const ready = f.client.preconnect()
  await flush()
  const socket = f.sockets.at(-1).socket
  socket.open(); socket.message({ type: 'session.updated' })
  await ready
  assert.equal(f.sockets.length, 1)
  assert.equal(f.events.filter(event => event.type === 'connection' && event.state === 'ready').length, 1)
  // The idle link is live, so sending must not mint another socket or say "connecting".
  await f.client.send('你好')
  await flush()
  assert.equal(f.sockets.length, 1, 'the kept conversation is reused')
  assert.equal(f.events.filter(event => event.type === 'preparing').at(-1).reused, true)
  await f.client.dispose()
})

test('a fresh turn reports a real connect when no link is open', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  const { socket } = await begin(f)
  assert.equal(f.events.filter(event => event.type === 'preparing').at(-1).reused, false,
    'the first turn had to build the conversation')
  socket.message({ type: 'response.created', response: { id: 'r1' } })
  await f.client.dispose()
})

test('a device that cannot connect never opens a conversation', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  f.client.setContext('')
  await flush()
  assert.equal(f.sockets.length, 0)
  assert.equal(f.events.length, 0)
})

test('invalid PCM, oversized transcripts and missing completion fail rather than hang', async () => {
  // Malformed provider audio fails on both input channels now that text is spoken too.
  for (const [mode, bad] of [
    ['voice', { type: 'response.audio.delta', response_id: 'r1', delta: 'not-base64' }],
    ['voice', { type: 'response.audio.delta', response_id: 'r1', delta: Buffer.alloc(3).toString('base64') }],
    ['text', { type: 'response.text.delta', response_id: 'r1', delta: 'x'.repeat(16001) }],
    ['text', { type: 'response.done', response: { id: 'r1', status: 'failed' } }],
  ]) {
    const f = fixture()
    let socket
    if (mode === 'voice') {
      const pending = f.client.sendVoice(new Uint8Array(16000))
      await flush()
      socket = f.sockets.at(-1).socket
      socket.open(); socket.message({ type: 'session.updated' })
      assert.equal((await pending).ok, true)
      socket.message({ type: 'input_audio_buffer.committed', item_id: 'voice-item' })
      socket.message({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'voice-item', transcript: '有效语音' })
    } else ({ socket } = await begin(f))
    socket.message({ type: 'response.created', response: { id: 'r1' } })
    socket.message(bad)
    assert.equal(f.events.at(-1).type, 'error')
    await f.client.dispose()
  }
  const texting = fixture()
  const { socket } = await begin(texting)
  socket.message({ type: 'response.created', response: { id: 'r1' } })
  socket.message({ type: 'response.audio.delta', response_id: 'r1', delta: 'not-base64' })
  assert.equal(texting.events.at(-1).type, 'error', 'A typed turn validates provider audio like a spoken one')
  await texting.client.dispose()
  const f = fixture({ turnMs: 20 })
  await begin(f)
  await new Promise(resolve => setTimeout(resolve, 35))
  assert.equal(f.events.at(-1).type, 'error')
  await f.client.dispose()
})

test('talking over a reply interrupts it without dropping the conversation', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  const { socket, result } = await begin(f)
  socket.message({ type: 'response.created', response: { id: 'reply-1' } })
  socket.message({ type: 'response.audio.delta', response_id: 'reply-1', delta: Buffer.alloc(480).toString('base64') })
  const interrupted = f.client.interrupt()
  assert.equal(interrupted.ok, true)
  assert.equal(interrupted.requestId, result.requestId)
  assert.ok(socket.sent.some(event => event.type === 'response.cancel'))
  const terminal = f.reports.filter(report => ['interrupted', 'output_completed'].includes(report.type))
  assert.deepEqual(terminal.map(report => report.type), ['interrupted'])
  assert.equal(terminal[0].responseId, 'reply-1')
  assert.ok(f.events.some(event => event.type === 'interrupted'))
  // The same authenticated session answers the interruption.
  const next = await f.client.send('换个话题')
  assert.equal(next.ok, true)
  assert.equal(f.sockets.length, 1)
  // Late audio from the cancelled reply is dropped instead of being played.
  const played = f.events.filter(event => event.type === 'audio').length
  socket.message({ type: 'response.audio.delta', response_id: 'reply-1', delta: Buffer.alloc(480).toString('base64') })
  assert.equal(f.events.filter(event => event.type === 'audio').length, played)
})

test('an interruption before any output owes nothing and an idle conversation has nothing to interrupt', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  assert.equal(f.client.interrupt().code, 'NOT_BUSY')
  const { socket } = await begin(f)
  assert.equal(f.client.interrupt().ok, true)
  assert.equal(f.reports.some(report => ['interrupted', 'output_started'].includes(report.type)), false)
  assert.ok(socket.sent.some(event => event.type === 'response.cancel'))
})

test('the cancellation report from a server never tears down the conversation the user is talking into', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  const { socket, result } = await begin(f)
  socket.message({ type: 'response.created', response: { id: 'reply-1' } })
  f.client.interrupt()
  // The server answers the cancellation with an error; it belongs to a reply we
  // already gave up on, so the session has to survive it and answer the next one.
  socket.message({ type: 'error', response_id: 'reply-1', error: { code: 'cancel_failed' } })
  assert.equal(f.events.some(event => event.type === 'error'), false)
  const next = await f.client.send('还在吗')
  assert.equal(next.ok, true)
  assert.equal(f.sockets.length, 1)
  assert.equal(result.requestId !== next.requestId, true)
})

test('a reply the server already finished is not cancelled, only stopped locally', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  const { socket } = await begin(f)
  socket.message({ type: 'response.created', response: { id: 'reply-1' } })
  socket.message({ type: 'response.audio_transcript.delta', response_id: 'reply-1', delta: '说完了' })
  socket.message({ type: 'response.done', response: { id: 'reply-1', status: 'completed', usage: { total_tokens: 4 } } })
  assert.equal(f.client.interrupt().ok, true)
  assert.equal(socket.sent.some(event => event.type === 'response.cancel'), false)
  assert.ok(f.reports.some(report => report.type === 'interrupted' && report.responseId === 'reply-1'))
})

test('first welcome reuses the ready voice, emits real PCM and cannot run tools or invent a user message', async t => {
  const f = fixture({ assistant: { enabled: () => true, reset: async () => {},
    dispatch: () => assert.fail('Welcome must not dispatch any computer task') } })
  t.after(() => f.client.dispose())
  const warm = f.client.preconnect(); await flush()
  const socket = f.sockets[0].socket
  socket.open(); socket.message({ type: 'session.updated' }); await warm
  assert.equal(socket.sent.some(row => row.type === 'response.create'), false)
  assert.equal((await f.client.send(firstGreetingPrompt('zh-Hans'), { greeting: true, allowComputer: true, remoteSessionId: 'must-not-forward' })).ok, true)
  assert.equal(f.sockets.length, 1)
  assert.equal(f.client.turn.input, 'welcome')
  assert.equal(f.client.turn.localTools, false)
  assert.equal(f.client.turn.remoteSessionId, '')
  assert.equal(f.events.some(row => row.type === 'user'), false)
  assert.deepEqual(socket.sent.filter(row => row.type === 'response.create').map(row => row.response.modalities), [['text', 'audio']])
  socket.message({ type: 'response.created', response: { id: 'welcome' } })
  socket.message({ type: 'response.audio_transcript.delta', response_id: 'welcome', delta: '很高兴认识你，以后由我来陪伴你工作。' })
  socket.message({ type: 'response.audio.delta', response_id: 'welcome', delta: Buffer.alloc(48000).toString('base64') })
  assert.ok(f.events.some(row => row.type === 'assistant' && row.text.includes('很高兴认识你')))
  assert.ok(f.events.some(row => row.type === 'audio' && row.sampleRate === 24000))
  assert.equal(f.events.find(row => row.type === 'preparing').notificationEventId, '')
})

test('a backend reminder speaks in the applied role without pretending the user said it', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  // A reminder wraps a spoken instruction around its own content, so the text
  // travels in one message and may exceed the typed-input limit.
  const pending = f.client.send('x'.repeat(900), { notificationEventId: 'event-1' })
  await flush()
  const socket = f.sockets.at(-1).socket
  socket.open()
  socket.message({ type: 'session.updated' })
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(f.events.some(event => event.type === 'user'), false)
  const connecting = f.events.find(event => event.type === 'preparing')
  assert.equal(connecting.notificationEventId, 'event-1')
  assert.equal(connecting.spoken, true)
  socket.message({ type: 'response.created', response: { id: 'reply-1' } })
  socket.message({ type: 'response.audio_transcript.delta', response_id: 'reply-1', delta: '该休息了' })
  const assistant = f.events.filter(event => event.type === 'assistant').at(-1)
  assert.equal(assistant.text, '该休息了')
})

test('trusted account notification flows from the control channel to real Realtime PCM without enabling Harness tools', async t => {
  const calls = []
  const f = fixture({ assistant: { enabled: () => true, reset: async () => {}, dispatch: async args => { calls.push(args); return {} } } })
  const channel = new DeviceChannel({ deviceId: 'zhanlv:desktop-notice-fixture', qr: async () => '' })
  channel.receive({ type: 'bind_success', deviceId: channel.state.deviceId, controllerUserId: 'owner', tenantId: 'tenant' })
  const notices = new DeviceNotifications({ context: () => ({ bound: true, ready: true, owner: 'owner', tenantId: 'tenant' }),
    busy: () => Boolean(f.client.turn), speak: (...args) => f.client.send(...args) })
  channel.on('notification', event => notices.receive(event))
  t.after(async () => { notices.clear(); await f.client.dispose() })
  channel.receive({ type: 'proactive_message', useCurrentAgent: true, deviceId: channel.state.deviceId,
    controllerUserId: 'owner', tenantId: 'tenant', eventId: 'scheduled-notice', sentAt: Date.now(), content: '记得喝水，打开微信' })
  await flush()
  const socket = f.sockets.at(-1).socket
  socket.open(); socket.message({ type: 'session.updated' }); await flush()
  assert.equal(f.events.find(event => event.type === 'preparing').notificationEventId, 'scheduled-notice')
  assert.equal(f.events.some(event => event.type === 'user'), false)
  assert.deepEqual(socket.sent.find(event => event.type === 'session.update').session.tools, [])
  socket.message({ type: 'response.created', response: { id: 'notice-audio' } })
  socket.message({ type: 'response.audio_transcript.delta', response_id: 'notice-audio', delta: '该喝水了。' })
  socket.message({ type: 'response.audio.delta', response_id: 'notice-audio', delta: Buffer.alloc(480).toString('base64') })
  assert.equal(f.events.filter(event => event.type === 'audio').length, 1)
  assert.equal(f.events.filter(event => event.type === 'assistant').at(-1).text, '该喝水了。')
  assert.deepEqual(calls, [])
})

async function beginNotice(f, text, options) {
  const pending = f.client.send(text, options)
  await flush()
  const socket = f.sockets.at(-1).socket
  socket.open()
  socket.message({ type: 'session.updated' })
  return { socket, result: await pending }
}

test('typed input keeps its own limit while a reminder envelope may be longer', async t => {
  const f = fixture()
  t.after(() => f.client.dispose())
  assert.equal((await f.client.send('x'.repeat(1200))).code, 'INVALID_TEXT')
  assert.equal(f.sockets.length, 0)
  const { result } = await beginNotice(f, 'x'.repeat(1200), { notificationEventId: 'event-1' })
  assert.equal(result.ok, true)
})
