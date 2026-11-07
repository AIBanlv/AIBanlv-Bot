import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { WorkBuddyBridge } from '../electron/device-workbuddy.mjs'

async function fixture(t) {
  const parent = path.resolve('artifacts')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(path.join(parent, 'control-workbuddy-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'projects', 'my-workspace'), { recursive: true })
  await mkdir(path.join(root, 'tasks'), { recursive: true })
  return root
}
const session = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const stream = (root, id = session) => path.join(root, 'projects', 'my-workspace', `${id}.jsonl`)
const append = async (file, ...rows) => {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n',
    { flag: 'a', encoding: 'utf8' })
}
const taskFile = async (root, name, value) => {
  const file = path.join(root, 'tasks', session, name)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value))
}
async function bridge(t, root, options = {}) {
  const events = []
  const monitor = new WorkBuddyBridge({ configDir: root, onEvent: event => events.push(event), ...options })
  t.after(() => monitor.stop())
  // The first pass is the baseline: history already on disk must stay silent.
  await monitor.scan()
  return { events, monitor }
}
const types = events => events.map(event => event.type)

test('a task appears the moment WorkBuddy names it, and its replies follow', async t => {
  const root = await fixture(t)
  const { events, monitor } = await bridge(t, root)
  await append(stream(root),
    { type: 'session-meta', sessionId: session, timestamp: 1000 },
    { type: 'ai-title', sessionId: session, timestamp: 1100, aiTitle: '熟悉项目并预览打包结果', cwd: 'f:\\work' })
  await monitor.scan()
  assert.deepEqual(types(events), ['task.created'])
  assert.match(events[0].title, /熟悉项目/)
  assert.equal(events[0].workspace, 'my-workspace')

  await append(stream(root), { type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: '已经把打包脚本跑通了。' }], timestamp: 1200 })
  await monitor.scan()
  assert.deepEqual(types(events), ['task.created', 'task.reply'])
  assert.match(events.at(-1).text, /打包脚本/)

  // Watching is incremental: the same line is never announced twice.
  await monitor.scan()
  assert.equal(events.length, 2)
})

test('a question the user must answer interrupts once, after it has clearly waited', async t => {
  const root = await fixture(t)
  let clock = 10_000
  const { events, monitor } = await bridge(t, root, { now: () => clock, settleMs: 1500 })
  await append(stream(root), { type: 'ai-title', sessionId: session, aiTitle: '整理桌面', timestamp: 9000 })
  await append(stream(root), { type: 'function_call', name: 'AskUserQuestion', callId: 'call-1', timestamp: 9000,
    arguments: JSON.stringify({ question: '会话记忆要接在哪一层？', options: [{ label: '补上 tenantId' }, { label: '按设备续接' }] }) })
  await monitor.scan()
  assert.deepEqual(types(events), ['task.created'], 'an answer may still be arriving')

  clock += 2000
  await monitor.scan()
  assert.deepEqual(types(events), ['task.created', 'task.confirm'])
  const confirm = events.at(-1)
  assert.equal(confirm.question, '会话记忆要接在哪一层？')
  assert.deepEqual(confirm.options, ['补上 tenantId', '按设备续接'])
  assert.equal(monitor.pending.size, 1)

  // A question answered before it ever had to interrupt stays silent.
  const second = await bridge(t, root, { now: () => clock, settleMs: 1500 })
  await append(stream(root), { type: 'function_call_result', name: 'AskUserQuestion', callId: 'call-1',
    status: 'completed', output: { type: 'text', text: '补上 tenantId' }, timestamp: 9500 })
  await second.monitor.scan()
  assert.equal(second.events.some(event => event.type === 'task.confirm'), false)
  assert.equal(second.monitor.pending.size, 0)
})

test('the agent task list announces created, started and completed once each', async t => {
  const root = await fixture(t)
  const { events, monitor } = await bridge(t, root)
  await taskFile(root, '1.json', { subject: '接入会话记忆', status: 'pending', id: '1', updatedAt: 1000 })
  await monitor.scan()
  await taskFile(root, '1.json', { subject: '接入会话记忆', status: 'in_progress', id: '1', updatedAt: 2000 })
  await monitor.scan()
  await taskFile(root, '1.json', { subject: '接入会话记忆', status: 'completed', id: '1', updatedAt: 3000 })
  await monitor.scan()
  await monitor.scan()
  assert.deepEqual(types(events), ['task.created', 'task.started', 'task.completed'])
  assert.equal(events.at(-1).subject, '接入会话记忆')
})

test('an answer is written where WorkBuddy can read it, and an unanswered one can be dropped', async t => {
  const root = await fixture(t)
  let clock = 10_000
  const { events, monitor } = await bridge(t, root, { now: () => clock })
  await append(stream(root), { type: 'function_call', name: 'AskUserQuestion', callId: 'call-9',
    timestamp: 9000, arguments: JSON.stringify({ question: '用哪种方案？', options: [{ label: 'A' }] }) })
  clock += 3000
  await monitor.scan()
  assert.equal(events.at(-1).type, 'task.confirm')

  const answer = await monitor.answer('call-9', '用方案 A')
  assert.equal(answer.ok, true)
  const written = JSON.parse(await readFile(answer.file, 'utf8'))
  assert.equal(written.callId, 'call-9')
  assert.equal(written.choice, '用方案 A')
  assert.equal(monitor.pending.size, 0)
  assert.equal((await monitor.answer('call-9', '再来一次')).ok, false, 'a question is asked once')

  // Drop path: a question the user refused to deal with must not linger.
  await append(stream(root), { type: 'function_call', name: 'ExitPlanMode', callId: 'call-10',
    timestamp: 12000, arguments: JSON.stringify({ plan: '先做只读部分' }) })
  clock += 3000
  await monitor.scan()
  assert.equal(monitor.pending.size, 1)
  assert.equal((await monitor.discard('call-10')).ok, true)
  assert.equal(monitor.pending.size, 0)
})

test('the snapshot is what the console shows: newest task first, with what it is waiting for', async t => {
  const root = await fixture(t)
  const { monitor } = await bridge(t, root)
  await append(stream(root), { type: 'ai-title', sessionId: session, aiTitle: '修音量控件', timestamp: 5000 })
  await append(stream(root), { type: 'function_call', name: 'AskUserQuestion', callId: 'call-2',
    timestamp: 5100, arguments: JSON.stringify({ question: '喇叭放左边？' }) })
  await monitor.scan()
  const snapshot = monitor.snapshot()
  assert.equal(snapshot.count, 1)
  assert.equal(snapshot.sessions[0].title, '修音量控件')
  // The console shows it immediately; only the spoken interruption waits.
  assert.equal(snapshot.sessions[0].pending.question, '喇叭放左边？')
  monitor.stop()
})

test('history already on disk is a baseline, not an announcement', async t => {
  const root = await fixture(t)
  await append(stream(root), { type: 'ai-title', sessionId: session, aiTitle: '很早以前的任务', timestamp: 1000 })
  await append(stream(root), { type: 'message', role: 'assistant', status: 'completed', timestamp: 1000,
    content: [{ type: 'output_text', text: '早就做完了。' }] })
  await taskFile(root, '1.json', { subject: '很久以前的事', status: 'completed', id: '1', updatedAt: 1000 })
  const { events, monitor } = await bridge(t, root)
  assert.deepEqual(events, [], 'starting up must not flood the pet')
  assert.equal(monitor.snapshot().count, 1, 'the history is still visible in the console')
  await append(stream(root), { type: 'ai-title', sessionId: 'another-session', aiTitle: '刚刚开始的任务', timestamp: 2000 })
  await monitor.scan()
  assert.deepEqual(types(events), ['task.created'])
  assert.equal(events[0].title, '刚刚开始的任务')
})

test('a rewritten or unreadable stream is survived without announcing anything invented', async t => {
  const root = await fixture(t)
  const { events, monitor } = await bridge(t, root)
  await append(stream(root), { type: 'ai-title', sessionId: session, aiTitle: '第一次运行：把打包脚本跑通并预览', timestamp: 1000 })
  await append(stream(root), { type: 'message', role: 'assistant', status: 'completed', timestamp: 1000,
    content: [{ type: 'output_text', text: '打包已经完成，安装包在 dist 目录下，可以直接安装预览，也可以继续调整图标与窗口尺寸。' }] })
  await monitor.scan()
  // A shorter file after a longer one means it was rewritten, not appended.
  await writeFile(stream(root), JSON.stringify({ type: 'ai-title', sessionId: session, aiTitle: '第二次' }) + '\n')
  await append(stream(root), 'not json at all\n', { type: 'message', role: 'user', content: 'hi' })
  await monitor.scan()
  assert.deepEqual(types(events), ['task.created', 'task.reply', 'task.created'])
  assert.equal(events.at(-1).title, '第二次')
})
