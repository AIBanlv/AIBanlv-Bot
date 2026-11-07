import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rm, rmdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { HarnessClient } from '../electron/device-harness-client.mjs'
import { AssistantService } from '../electron/device-assistant-service.mjs'
import { DeviceTextConversation } from '../electron/device-text-conversation.mjs'
import { registerModelControls } from '../electron/device-model-control.mjs'
import { apply, modelText, runHostTask, readConnection } from '../harness-client-plugin/plugin.mjs'

const flush = () => new Promise(resolve => setImmediate(resolve))
async function nextJobs(f) {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const value = await f.poll()
    if (value.jobs.length) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('authorized job was not delivered')
}
async function fixture(t, options = {}) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'control-harness-bridge-')))
  const client = new HarnessClient({ file: path.join(directory, 'connection.json'), leaseMs: 1500,
    authorizeTask: async () => directory, ...options })
  await client.start()
  t.after(async () => { await client.stop(); await rm(directory, { recursive: true, force: true }) })
  const owner = randomUUID()
  const post = (endpoint, value, headers = {}) => fetch(client.connection.endpoint + endpoint, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.connection.token}`, ...headers }, body: JSON.stringify(value) })
  const poll = async (signedIn = true) => { const response = await post('/v1/poll', { sourceId: owner, signedIn, taskProtocol: 2 }); assert.equal(response.status, 200); return response.json() }
  return { client, owner, post, poll, directory }
}
test('only the authenticated local owner can supply readiness or results; jobs are sent once', async t => {
  const f = await fixture(t)
  assert.equal((await f.post('/v1/poll', { sourceId: f.owner, signedIn: true }, { Authorization: 'Bearer invalid' })).status, 401)
  assert.equal((await f.post('/v1/poll', { sourceId: f.owner, signedIn: true }, { Origin: 'https://foreign.test' })).status, 403)
  assert.equal(f.client.ready(), false)
  await f.poll(); assert.equal(f.client.ready(), true)
  const pending = f.client.request('run', '打开 D 盘')
  const { jobs } = await nextJobs(f); assert.equal(jobs.length, 1)
  assert.equal(jobs[0].cwd, await realpath(f.directory))
  assert.equal((await f.poll()).jobs.length, 0)
  assert.equal((await f.post('/v1/result', { sourceId: randomUUID(), id: jobs[0].id, ok: true, text: 'forged' })).status, 409)
  await f.post('/v1/result', { sourceId: f.owner, id: jobs[0].id, ok: true, text: '已在客户端核对结果' })
  assert.equal(await pending, '已在客户端核对结果')
  assert.doesNotMatch(JSON.stringify(f.client.snapshot()), /token|打开|connection/)
})
test('logout, timeout and cancellation stop jobs without replay or changing funding', async t => {
  const f = await fixture(t, { timeoutMs: 30 }); await f.poll()
  const pending = f.client.request('run', '打开软件')
  const rejected = assert.rejects(pending, { code: 'HARNESS_CLIENT_CHANGED' })
  await f.poll(false); await rejected
  assert.equal(f.client.ready(), false)
  await f.poll()
  const timeout = assert.rejects(f.client.request('run', '慢任务'), { code: 'HARNESS_CLIENT_TIMEOUT' })
  await timeout
  assert.deepEqual((await f.poll()).jobs, [])
  const controller = new AbortController()
  const cancelled = assert.rejects(f.client.request('run', '停止的任务', controller.signal), { code: 'ASSISTANT_CANCELLED' })
  controller.abort(); await cancelled
})
test('an expired owner cannot submit results or resume the old job before the lease timer fires', async t => {
  const f = await fixture(t); await f.poll()
  const pending = f.client.request('run', '旧任务')
  const rejected = assert.rejects(pending, { code: 'HARNESS_CLIENT_CHANGED' })
  const { jobs } = await nextJobs(f)
  f.client.lastSeen = Date.now() - f.client.leaseMs - 1
  assert.equal((await f.post('/v1/result', { sourceId: f.owner, id: jobs[0].id, ok: true, text: '旧结果' })).status, 409)
  assert.deepEqual((await f.poll()).jobs, [])
  await rejected
})
test('reset cancels a client report and suppresses stale output', async t => {
  const assistant = new AssistantService({ settings: { snapshot: () => ({ enabled: true }) }, root: '/fixture' })
  let started, reportSignal
  const ready = new Promise(resolve => { started = resolve })
  assistant.client = { ready: () => true, request: async (_operation, _text, signal) => {
    reportSignal = signal
    started()
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    signal.throwIfAborted()
  } }
  const report = assert.rejects(assistant.summarizeTask({ provider: 'codex', text: '待汇报' }))
  await ready; assert.ok(reportSignal instanceof AbortSignal)
  await assistant.reset(); await report
  t.after(() => assistant.reset())
})
test('a signed-in client wins over a saved Key; client failure never launches the embedded worker', async t => {
  let ready = true, calls = 0
  const assistant = new AssistantService({ settings: { snapshot: () => ({ enabled: true }), key: () => 'fixture-key' }, root: '/fixture' })
  assistant.client = { ready: () => ready, request: async () => { calls++; throw Object.assign(new Error(), { code: 'HARNESS_CLIENT_FAILED' }) } }
  assistant.perform = async () => 'embedded'
  await assert.rejects(assistant.run('打开 D 盘'), { code: 'HARNESS_CLIENT_FAILED' })
  assert.equal(calls, 1)
  ready = false
  assert.equal(await assistant.run('新的任务'), 'embedded')
  t.after(() => assistant.reset())
})
test('guest text uses the Host model without a Key and without an API request', async () => {
  const events = [], calls = []
  const conversation = new DeviceTextConversation({ settings: { key: () => '' }, context: () => ({ agentId: 'waner', persona: '你是婉儿' }),
    onEvent: event => events.push(event), client: { ready: () => true, request: async (...args) => { calls.push(args); return '客户端回复' } },
    fetchImpl: () => assert.fail('the account path must not call the API-key transport') })
  assert.equal((await conversation.chat('你好', { allowComputer: false })).ok, true)
  assert.equal(calls[0][0], 'llm')
  assert.equal(events.find(event => event.type === 'assistant').text, '客户端回复')
})
test('DeepSeek test uses the connected account when blank and tests an explicitly typed Key separately', async t => {
  const handlers = new Map(), apiKeys = []; let hostCalls = 0
  const original = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions')
    apiKeys.push(options.headers.Authorization)
    return Response.json({ choices: [{ message: { content: '自有 Key 回复' } }] })
  }
  t.after(() => { globalThis.fetch = original })
  registerModelControls({ ipcMain: { handle: (name, work) => handlers.set(name, work) },
    windows: { fromController: () => true }, deepseek: { preview: value => ({ key: () => value.apiKey || 'saved-key' }) },
    harnessClient: { ready: () => true, request: async () => { hostCalls++; return '宿主回复' } } })
  const run = value => handlers.get('device:models-test-text')({}, value)
  assert.match((await run({ apiKey: '' })).message, /Harness 客户端账号/)
  assert.equal(hostCalls, 1); assert.deepEqual(apiKeys, [])
  assert.equal((await run({ apiKey: 'draft-key' })).ok, true)
  assert.equal(hostCalls, 1); assert.deepEqual(apiKeys, ['Bearer draft-key'])
})
test('missing or invalid local task authorization cannot send a job to the Host', async t => {
  for (const authorizeTask of [undefined, async () => '', async () => 'relative', async () => path.join(tmpdir(), randomUUID())]) {
    const f = await fixture(t, { authorizeTask }); await f.poll()
    await assert.rejects(f.client.request('run', 'do not execute'), { code: 'HARNESS_WORKSPACE_REQUIRED' })
    assert.deepEqual((await f.poll()).jobs, [])
  }
})

test('an older connector may chat but cannot run a task without workspace protocol support', async t => {
  const f = await fixture(t)
  await f.post('/v1/poll', { sourceId: f.owner, signedIn: true })
  assert.equal(f.client.ready(), true)
  await assert.rejects(f.client.request('run', 'old connector must not use home'), { code: 'HARNESS_CLIENT_UPDATE_REQUIRED' })
  const pending = f.client.request('llm', 'chat')
  const response = await f.post('/v1/poll', { sourceId: f.owner, signedIn: true })
  const { jobs } = await response.json()
  assert.equal(jobs.length, 1); assert.equal(jobs[0].operation, 'llm')
  await f.post('/v1/result', { sourceId: f.owner, id: jobs[0].id, ok: true, text: 'chat result' })
  assert.equal(await pending, 'chat result')
})

test('logout while the local picker is open cancels authorization and suppresses late results', async t => {
  let release, started, approvalSignal
  const ready = new Promise(resolve => { started = resolve })
  const f = await fixture(t, { authorizeTask: async (_text, signal) => {
    approvalSignal = signal; started(); return new Promise(resolve => { release = resolve })
  } }); await f.poll()
  const pending = assert.rejects(f.client.request('run', 'do not execute'), { code: 'HARNESS_CLIENT_CHANGED' })
  await ready; assert.deepEqual((await f.poll()).jobs, [])
  await f.poll(false); await pending
  assert.equal(approvalSignal.aborted, true)
  release(f.directory); await flush()
  await f.poll(); assert.deepEqual((await f.poll()).jobs, [])
})

test('the connector rejects missing, relative and nonexistent workspaces before creating agents', async () => {
  const ctx = { on: () => assert.fail('invalid workspace must fail before Host access') }
  for (const cwd of [undefined, '', 'relative', path.join(tmpdir(), randomUUID())]) {
    await assert.rejects(runHostTask(ctx, 'test', new AbortController().signal, cwd), /WORKSPACE/)
  }
})

test('a confirmed path replaced by a directory link cannot redirect execution', async t => {
  const f = await fixture(t), selected = path.join(f.directory, 'selected'), other = path.join(f.directory, 'other')
  await mkdir(selected); await mkdir(other)
  const confirmed = await realpath(selected)
  await rmdir(selected); await symlink(other, selected, process.platform === 'win32' ? 'junction' : 'dir')
  f.client.authorizeTask = async () => confirmed
  await f.poll()
  await assert.rejects(f.client.request('run', 'do not redirect'), { code: 'HARNESS_WORKSPACE_REQUIRED' })
  const ctx = { on: () => assert.fail('changed workspace must not create a Host agent') }
  await assert.rejects(runHostTask(ctx, 'test', new AbortController().signal, confirmed), /WORKSPACE/)
})

test('the connector uses Host llm for chat and Host agents for tasks, without reading credentials', async t => {
  const f = await fixture(t), bus = new EventEmitter(), cleanup = [], tasks = []
  const ctx = {
    on: (name, callback) => { bus.on(name, callback); return () => bus.off(name, callback) },
    effect: work => cleanup.push(work()),
    get: name => ({
      deepseekAccount: { getState: async () => ({ status: 'credential-stored' }) },
      llm: { stream: async function* (options) { assert.equal(options.provider, 'deepseek-account'); yield { type: 'text-delta', text: '宿主回复' }; yield { type: 'finish', reason: { kind: 'stop' } } } },
      agents: { create: async options => {
        assert.equal(options.meta.cwd, await realpath(f.directory))
        return { agent: { cancel() {}, whenIdle: async () => {}, followup(message) {
        tasks.push(message.content[0].text)
        const agent = { session: { id: options.sessionId } }
        bus.emit('agent/assistant-stream', { agent, frame: { type: 'start' } })
        bus.emit('agent/assistant-stream', { agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '客户端任务结果' } } })
        bus.emit('agent/assistant-stream', { agent, frame: { type: 'end', outcome: { kind: 'committed', eventType: 'assistant/message' } } })
        bus.emit('session/event', agent.session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
      } }, dispose: async () => {} } } },
    })[name],
  }
  assert.equal(await modelText(ctx, '闲聊', new AbortController().signal), '宿主回复')
  assert.equal(tasks.length, 0)
  assert.equal(await runHostTask(ctx, '打开 D 盘', new AbortController().signal, f.directory), '客户端任务结果')
  apply(ctx, { connectionFile: f.client.file })
  t.after(() => cleanup.forEach(work => work()))
  const deadline = Date.now() + 4000
  while (!f.client.ready() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(f.client.ready(), true)
  assert.equal(await f.client.request('llm', '测试'), '宿主回复')
  assert.equal(await f.client.request('run', '打开 D 盘'), '客户端任务结果')
  assert.equal(tasks.length, 2)
  assert.equal((await readConnection(f.client.file)).endpoint, f.client.connection.endpoint)
  assert.equal(JSON.parse(await readFile(f.client.file, 'utf8')).version, 1)
})
