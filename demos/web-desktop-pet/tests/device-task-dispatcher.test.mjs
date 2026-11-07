import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkBuddyAgent } from '../electron/device-workbuddy-agent.mjs'
import { HarnessTaskDispatcher } from '../electron/device-task-dispatcher.mjs'

const fixture = fileURLToPath(new URL('./workbuddy-cli-fixture.mjs', import.meta.url))
const cwd = fileURLToPath(new URL('../', import.meta.url))
test('direct file routing never opens a picker and forwards the original user filename with its phone session', async () => {
  const calls = []
  const assistant = { execute: async (action, signal, context) => { calls.push({ action, context }); return { status: 'received' } } }
  const router = new HarnessTaskDispatcher({ assistant })
  const task = '把桌面的报价.pdf发到手机'
  await router.execute({ task }, { targetSession: 'phone-1', originalTask: task })
  assert.deepEqual(calls[0], { action: { name: 'send_file', target: 'request' }, context: { targetSession: 'phone-1', fileRequest: task } })
  calls.length = 0
  await router.execute({ task: '发送截图' }, { targetSession: 'phone-1' })
  assert.deepEqual(calls.map(call => call.action), [{ name: 'capture_screen', target: 'primary' }, { name: 'send_file', target: 'latest_capture' }])
})
async function until(check) {
  const end = Date.now() + 5000
  while (!check()) { assert.ok(Date.now() < end, 'local worker timed out'); await new Promise(resolve => setTimeout(resolve, 10)) }
}

test('WorkBuddy creates a real child, streams public progress and reports verified completion', async t => {
  const reports = [], activity = []
  const worker = new WorkBuddyAgent({ launch: async () => ({ command: process.execPath, args: [fixture] }),
    onActivity: value => activity.push(value), onReport: value => reports.push(value) })
  t.after(() => worker.shutdown())
  const result = await worker.create('check fixture', cwd)
  assert.equal(result.ok, true)
  await until(() => worker.tasks.get(result.taskId).status === 'completed')
  assert.ok(reports.some(report => report.progress === true))
  assert.match(reports.find(report => report.progress === false).text, /已完成/)
  assert.equal(JSON.stringify(activity).includes('PRIVATE_RAW_REASONING'), false)
  assert.equal(worker.tasks.get(result.taskId).records.filter(row => row.id === 'text:message-1').length, 1)
})

test('WorkBuddy rejects a runtime without advertised dontAsk support before submitting a task', async t => {
  const worker = new WorkBuddyAgent({ launch: async () => ({ command: process.execPath, args: ['-e', 'console.log("--permission-mode auto")', '--'] }),
    spawnProcess: () => assert.fail('unsupported runtime must not receive a task') })
  t.after(() => worker.shutdown())
  await assert.rejects(worker.create('check fixture', cwd), /权限模式/)
  assert.equal(worker.tasks.size, 0)
})

test('a clean process exit without a result is not task success, and errors never leak credentials', async t => {
  const worker = new WorkBuddyAgent({ launch: async () => ({ command: process.execPath, args: [fixture] }) })
  t.after(() => worker.shutdown())
  for (const prompt of ['no result', 'failure', 'denied']) {
    const { taskId } = await worker.create(prompt, cwd)
    await until(() => worker.tasks.get(taskId).status === 'failed')
    assert.doesNotMatch(JSON.stringify(worker.snapshot()), /sk-fixture-secret-key/)
    if (prompt === 'denied') assert.match(worker.tasks.get(taskId).result, /安全策略拒绝/)
  }
})

test('only an owned WorkBuddy task can be interrupted and late output cannot report completion', async t => {
  const reports = []
  const worker = new WorkBuddyAgent({ launch: async () => ({ command: process.execPath, args: [fixture] }), onReport: value => reports.push(value) })
  worker.terminate = run => run.child.kill()
  t.after(() => worker.shutdown())
  const { taskId } = await worker.create('hold', cwd)
  await worker.interrupt(taskId)
  await until(() => !worker.running.has(taskId))
  assert.equal(worker.tasks.get(taskId).status, 'interrupted')
  assert.equal(reports.filter(report => report.progress === false).length, 1)
  await assert.rejects(worker.interrupt('another-window'), /没有/)
})

test('concurrent permission probes cannot exceed the four WorkBuddy task slots', async t => {
  const worker = new WorkBuddyAgent({ launch: async () => ({ command: process.execPath, args: [fixture] }) })
  worker.terminate = run => run.child.kill()
  t.after(() => worker.shutdown())
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => worker.create('hold', cwd)))
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 4)
  assert.match(results.find(value => value.status === 'rejected').reason.message, /4 个任务/)
})

test('Harness routes both providers, connects Codex on demand and restores selected projects', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'harness-router-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const calls = [], make = name => ({ cwd: '', publish() {}, snapshot: () => ({ tasks: [{ id: name, title: name, status: 'inProgress' }] }),
    connect: async () => calls.push(`${name}:connect`), refresh: async () => ({ tasks: [] }),
    create: async task => { calls.push(`${name}:create:${task}`); return { ok: true, taskId: name } }, interrupt: async id => { calls.push(`${name}:interrupt:${id}`); return { ok: true } } })
  const codex = make('codex'), workbuddy = make('workbuddy'), assistant = { run: async task => `desktop:${task}` }
  const file = path.join(directory, 'projects.json')
  const router = new HarnessTaskDispatcher({ assistant, codex, workbuddy, file })
  await router.select('codex', directory); await router.select('workbuddy', directory)
  assert.match((await router.execute({ provider: 'codex', task: '检查代码' })).result,/Harness/)
  assert.equal(calls.length,0,'Conversation requests must be planned by Harness before provider creation')
  assert.equal((await router.execute({ provider: 'codex', task: '检查代码' },{fromHarness:true})).taskId, 'codex')
  assert.equal((await router.execute({ task: '让 WorkBuddy 检查文档' },{fromHarness:true})).taskId, 'workbuddy')
  await assert.rejects(router.execute({provider:'codex',task:'wrong workspace',workspace:path.dirname(directory)},{fromHarness:true}),/工作空间/)
  assert.match((await router.execute({ task: '打开浏览器' })).result, /desktop/)
  assert.match((await router.execute({ task: '搜索 Codex 使用教程' })).result, /desktop/)
  assert.match((await router.execute({ task: '阅读 WorkBuddy 文档' })).result, /desktop/)
  assert.equal((await router.execute({ provider: 'workbuddy', operation: 'status' })).tasks[0].id, 'workbuddy')
  await router.execute({ provider: 'workbuddy', operation: 'interrupt', taskId: 'workbuddy' })
  assert.ok(calls.includes('codex:connect'))
  const restored = new HarnessTaskDispatcher({ assistant, codex: make('codex'), workbuddy: make('workbuddy'), file })
  await restored.load(); const canonical=await realpath(directory)
  assert.equal(restored.codex.cwd, canonical); assert.equal(restored.workbuddy.cwd, canonical)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { codex: canonical, workbuddy: canonical })
  const abort = new AbortController(); abort.abort()
  const count = calls.length
  await assert.rejects(router.execute({ provider: 'codex', task: 'do not run' }, { signal: abort.signal }), /abort/i)
  assert.equal(calls.length, count)
  await assert.rejects(router.execute({ provider: 'unknown', task: 'bad' }), /不支持/)
  await assert.rejects(router.execute({ provider: 'codex', task: 'bad', cwd: 'C:/untrusted' }), /参数/)
})

test('Codex status discovers new jobs before querying and returns all bounded monitored results', async () => {
  const calls = [], codex = {
    connect: async () => calls.push('connect'), monitorProject: async () => calls.push('discover'),
    refresh: async () => { calls.push('refresh'); return { monitorStatus: 'ready', lastMonitorAt: 123,
      tasks: Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, title: `任务${i}`, status: i ? 'completed' : 'unknown', result: '旧结果', syncError: i ? '' : '查询失败' })) } },
  }
  const router = new HarnessTaskDispatcher({ assistant: {}, codex })
  const result = await router.execute({ provider: 'codex', operation: 'status' })
  assert.deepEqual(calls, ['connect', 'discover', 'refresh'])
  assert.equal(result.tasks.length, 30); assert.equal(result.tasks.find(row=>row.id==='0').result, '')
  assert.equal(result.tasks.find(row=>row.id==='0').syncError, '查询失败'); assert.equal(result.syncedAt, 123)
  assert.deepEqual(result.currentTasks, [])
})

test('status separates current tasks from history and includes the latest actual request',async()=>{
  const codex={connect:async()=>{},monitorProject:async()=>{},refresh:async()=>({tasks:[
    {id:'active',title:'当前真实名称',status:'inProgress',currentRequest:'修复现在的登录',lastTurnId:'current',result:''},
    {id:'history',title:'旧任务',status:'completed',result:'旧结果'}]})}
  const router=new HarnessTaskDispatcher({assistant:{},codex})
  const value=await router.execute({provider:'codex',operation:'status'})
  assert.equal(value.tasks[0].id,'active');assert.equal(value.currentTasks.length,1)
  assert.equal(value.currentTasks[0].currentRequest,'修复现在的登录');assert.equal(value.currentTasks[0].turnId,'current')
  const selected=await router.execute({provider:'codex',operation:'status',taskId:'history'})
  assert.equal(selected.tasks.length,1);assert.deepEqual(selected.currentTasks,[])
})

test('ending a binding stops owned WorkBuddy tasks without announcing to a later account', async t => {
  const reports = []
  const worker = new WorkBuddyAgent({ launch: async () => ({ command: process.execPath, args: [fixture] }), onReport: value => reports.push(value) })
  worker.terminate = run => run.child.kill()
  t.after(() => worker.shutdown())
  const { taskId } = await worker.create('hold', cwd)
  reports.length = 0
  worker.shutdown()
  await until(() => !worker.running.has(taskId))
  assert.equal(worker.tasks.get(taskId).status, 'interrupted')
  assert.equal(reports.length, 0)
})
test('Harness reviews its plan before a provider can create a task',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'task-plan-review-'));t.after(()=>rm(directory,{recursive:true,force:true}))
  let creates=0,decision='deny';const reviews=[]
  const client={connect:async()=>{},create:async()=>{creates++;return {ok:true,taskId:'task'}},publish(){}}
  const assistant={active:{task:'original user task'},review:async value=>{reviews.push(value);return {decision}}}
  const router=new HarnessTaskDispatcher({assistant,codex:client,workbuddy:client,file:path.join(directory,'projects.json'),workspaceRoots:[directory]})
  const workspace=await realpath(directory)
  await assert.rejects(router.execute({provider:'codex',task:'planned task',workspace},{fromHarness:true}),/审核/)
  assert.equal(creates,0);decision='allow'
  await router.execute({provider:'codex',task:'planned task',workspace},{fromHarness:true})
  assert.equal(creates,1);assert.equal(reviews[0].request.originalTask,'original user task')
})
