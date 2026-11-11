import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DeviceCodex } from '../electron/device-codex.mjs'
import { DeviceChannel } from '../electron/device-channel.mjs'
import { DeviceRemoteReplies } from '../electron/device-remote-replies.mjs'
import { DeviceTextConversation } from '../electron/device-text-conversation.mjs'
import { DeviceConversation } from '../electron/device-conversation.mjs'
import { HarnessTaskDispatcher } from '../electron/device-task-dispatcher.mjs'
import { AssistantService } from '../electron/device-assistant-service.mjs'
import { remoteTaskAccess } from '../electron/device-task-intent.mjs'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const fixture = fileURLToPath(new URL('./codex-queue-fixture.mjs', import.meta.url))

test('arbitrary authorized phone text discovers and queues without querying; creation, followups and replay keep their target', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'phone-codex-queue-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const inbox = path.join(directory, 'inbox.jsonl')
  const channel = new DeviceChannel({ deviceId: 'zhanlv:desktop-continuation', qr: async () => '' })
  channel.receive({ type: 'bind_success', deviceId: channel.state.deviceId, controllerUserId: 'owner',
    tenantId: 'tenant', capabilities: { directTransferV1: true } })
  const scope = { bound: true, owner: 'owner', tenantId: 'tenant', agentId: 'role', deviceId: channel.state.deviceId }
  const sent = [], reports = []
  channel.send = value => { sent.push(value); return true }
  let router
  const codex = new DeviceCodex({ launch: async () => ({ command: process.execPath, args: [fixture, 'app-server'],
    env: { ...process.env, QUEUE_FIXTURE_INBOX: inbox } }),
    onReport: value => { reports.push(value); router?.rememberReport('codex', value) },
    approve: async () => assert.fail('approvals remain in the original window') })
  t.after(() => codex.shutdown())
  await codex.connect()
  const { thread } = await codex.request('thread/start', { cwd })
  const { turn } = await codex.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'hold original task' }] })
  codex.tasks.set(thread.id, { id: thread.id, title: '手机汇报的原任务', cwd, scope, external: true,
    status: 'inProgress', turnId: turn.id, lastTurnId: turn.id, records: [] })
  const settings = { key: () => '', snapshot: () => ({ enabled: false }) }
  const assistant = new AssistantService({ settings, root: 'fixture' })
  router = new HarnessTaskDispatcher({ assistant, codex, context: () => scope })
  assistant.taskRouter = router
  let relay
  const text = new DeviceTextConversation({ settings, context: () => ({ ...scope, persona: '测试角色' }),
    assistant, onEvent: event => relay.accept(event),
    fetchImpl: async () => assert.fail('Codex continuation must not use the companion model') })
  const realtime = new EventEmitter()
  Object.assign(realtime, { setContext() {}, stop() {}, send: () => assert.fail('must not open a paid speech session') })
  const conversation = new DeviceConversation({ realtime, text, routing: () => ({ route: 'platform' }), tasks: () => router })
  conversation.setContext('owner-role')
  conversation.on('event', event => relay.accept(event))
  relay = new DeviceRemoteReplies({ context: () => scope, send: value => channel.send(value),
    chat: (value, metadata) => {
      const access = remoteTaskAccess(value, metadata)
      return access.ok ? conversation.send(value, { allowComputer: access.allowComputer, remoteSessionId: metadata.originSessionId,
        remoteCodex: access.allowComputer }) : access
    } })
  t.after(() => { text.close(); relay.clear() })
  let submission
  channel.on('text', (value, id, metadata) => { submission = relay.submit(value, id, metadata) })
  const command = { type: 'send_text', deviceId: scope.deviceId, controllerUserId: scope.owner, tenantId: scope.tenantId,
    agentId: scope.agentId, requestId: 'phone-continue', text: '先别改代码，解释现有实现\n再提供最小方案', computerAuthorized: true, originSessionId: 'phone-socket' }
  channel.receive(command); await submission
  assert.ok(sent.some(row => row.type === 'assistant_reply' && row.requestId === command.requestId && row.finished && /原 Codex 会话/.test(row.text)),
    JSON.stringify(sent.filter(row => row.type === 'error')))
  assert.ok(sent.some(row => row.type === 'assistant_reply' && row.finished && /已排队/.test(row.text)))
  assert.equal(reports.filter(row => row.progress === false).length, 0, 'queue acknowledgement is not a task completion report')
  channel.receive(command); await submission
  channel.receive({ ...command, text: '打开微信', requestId: 'unauthorized', computerAuthorized: false }); await submission
  const { data } = await codex.request('thread/list', {})
  assert.equal(data.length, 1)
  assert.equal(data[0].turnCount, 1, 'secondary app-server never adds a turn to the externally owned thread')
  const queued = (await readFile(inbox, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(queued, [{ thread: thread.id, text: command.text }])
  const create = { ...command, requestId: 'phone-create', text: '新建任务：hold 创建搜索功能' }
  channel.receive(create); await submission
  assert.ok(sent.some(row => row.type === 'assistant_reply' && row.requestId === create.requestId && row.finished && /已接收任务/.test(row.text)))
  channel.receive(create); await submission
  channel.receive({ ...command, requestId: 'phone-followup', text: '搜索还要支持中文' }); await submission
  const threads = (await codex.request('thread/list', {})).data
  assert.equal(threads.length, 2)
  const created = threads.find(row => row.id !== thread.id)
  assert.equal(created.lastInput[0].text, 'hold 创建搜索功能')
  const finalQueue = (await readFile(inbox, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(finalQueue, [...queued, { thread: created.id, text: '搜索还要支持中文' }])
})

test('query then continue uses a real latest target even with Harness disabled and no model quota', async () => {
  const scope = { owner: 'owner', tenantId: 'tenant', deviceId: 'device', agentId: 'role', bound: true }
  const latest = { id: 'latest', title: '当前窗口任务', status: 'completed', lastTurnId: 'last', updatedAt: 200 }
  const old = { id: 'old', title: '历史任务', status: 'completed', lastTurnId: 'old-turn', updatedAt: 100 }
  const codex = { tasks: new Map([latest, old].map(task => [task.id, task])), connect: async () => {},
    monitorProject: async () => {}, refresh: async () => ({ tasks: [old, latest], monitorStatus: 'ready' }),
    continue: async (id, prompt) => ({ ok: true, taskId: id, turnId: 'next', message: `已发送到 ${id}：${prompt}` }) }
  const router = new HarnessTaskDispatcher({ assistant: { enabled: () => false }, codex, context: () => scope })
  const realtime = new EventEmitter()
  Object.assign(realtime, { setContext() {}, stop() {}, send: () => assert.fail('must not ask companion to invent a status') })
  const conversation = new DeviceConversation({ realtime, text: { stop() {}, close() {} },
    routing: () => ({ route: '', code: 'SCORE_DEPLETED' }), tasks: () => router })
  conversation.setContext('owner-role')
  const events = []
  conversation.on('event', event => events.push(event))
  assert.equal((await conversation.send('查询 codex 任务', { allowComputer: true })).ok, true)
  assert.match(events.find(event => event.type === 'assistant').text, /当前窗口任务/)
  assert.deepEqual(router.continuationTasks().map(task => task.id), ['latest'])
  events.length = 0
  assert.equal((await conversation.send('继续', { allowComputer: true })).ok, true)
  assert.match(events.find(event => event.type === 'assistant').text, /已发送到 latest：继续/)
  assert.equal((await conversation.send('查询 codex 任务', { allowComputer: false })).code, 'REMOTE_AUTH_REQUIRED')
})
