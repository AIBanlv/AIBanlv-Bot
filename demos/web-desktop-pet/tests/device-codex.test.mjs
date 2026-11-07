import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { DeviceCodex, codexFailure } from '../electron/device-codex.mjs'
import { DeviceActivity } from '../electron/device-activity.mjs'

const fixture = fileURLToPath(new URL('./codex-app-server-fixture.mjs', import.meta.url))
const cwd = fileURLToPath(new URL('../', import.meta.url))
const pause = () => new Promise(resolve => setTimeout(resolve, 20))
test('Codex data-directory and authentication failures have actionable sanitized messages', () => {
  assert.match(codexFailure('failed to initialize sqlite state runtime under C:/private'), /数据目录不可访问/)
  assert.match(codexFailure('ENOENT'), /运行程序/)
  assert.match(codexFailure('requires experimentalApi capability'), /协议不兼容/)
  assert.match(codexFailure('login required sk-private-secret'), /重新登录/)
  assert.doesNotMatch(codexFailure('login required sk-private-secret'), /sk-private-secret/)
})
async function until(check) {
  const deadline = Date.now() + 5000
  while (!check()) { assert.ok(Date.now() < deadline, 'fixture timed out'); await pause() }
}
test('stdio creates, monitors, approves and reports tasks without exposing raw reasoning', async t => {
  const activity = [], reports = [], approvals = []
  const client = new DeviceCodex({ launch: async () => ({ command: process.execPath, args: [fixture] }),
    onActivity: row => activity.push(row), onReport: row => reports.push(row),
    approve: async value => { approvals.push(value); return { decision: 'accept' } } })
  t.after(() => client.shutdown())
  await client.connect(); client.cwd = cwd
  const result = await client.create('检查项目测试')
  await until(() => reports.some(report => report.progress === false))
  assert.equal(client.status, 'ready')
  assert.equal(client.tasks.get(result.taskId).status, 'completed')
  assert.equal(approvals.length, 1)
  assert.ok(activity.some(row => row.kind === 'summary'))
  assert.ok(activity.some(row => row.kind === 'plan'))
  assert.equal(JSON.stringify(activity).includes('PRIVATE_RAW_REASONING'), false)
  assert.match(reports.find(report => report.progress === false).text, /本轮已结束/)
  assert.ok(reports.some(report => report.progress === true), 'Task creation and progress are reported without waiting for completion')
  assert.equal((await client.execute({ operation: 'status' })).tasks.length, 1)
})
test('interrupt keeps the connection and stale turn events cannot overwrite a task', async t => {
  const client = new DeviceCodex({ launch: async () => ({ command: process.execPath, args: [fixture] }) })
  t.after(() => client.shutdown())
  await client.connect(); client.cwd = cwd
  const { taskId } = await client.create('hold task')
  await client.interrupt(taskId)
  await until(() => client.tasks.get(taskId).status === 'interrupted')
  assert.equal(client.status, 'ready')
  client.accept('item/agentMessage/delta', { threadId: 'unknown', itemId: 'x', delta: 'wrong task' })
  assert.equal(JSON.stringify(client.snapshot()).includes('wrong task'), false)
  await assert.rejects(client.create('bad path', 'relative'), /文件夹/)
})
test('disconnect rejects pending requests, aborts approvals and never reports completion', async t => {
  let waiting = false, signal
  const reports = []
  const client = new DeviceCodex({ launch: async () => ({ command: process.execPath, args: [fixture] }),
    onReport: value => reports.push(value), approve: async (_value, abort) => {
      waiting = true; signal = abort
      await new Promise(resolve => abort.addEventListener('abort', resolve, { once: true }))
      return { decision: 'accept' }
    } })
  t.after(() => client.shutdown())
  await client.connect(); client.cwd = cwd
  const { taskId } = await client.create('approval pending')
  await until(() => waiting)
  client.shutdown()
  assert.equal(signal.aborted, true)
  assert.equal(client.tasks.get(taskId).status, 'unknown')
  assert.equal(reports.filter(report => report.progress === false).length, 0)
  await assert.rejects(client.create('cannot start'), /连接/)
})
test('activity coalesces streamed rows and bounds memory', () => {
  const activity = new DeviceActivity()
  activity.add('Codex', 'summary', 'first', 'same')
  activity.add('Codex', 'summary', 'second', 'same')
  assert.equal(activity.rows.length, 1)
  assert.equal(activity.rows[0].text, 'second')
  for (let i = 0; i < 150; i++) activity.add('Codex', 'status', `${i}`, `${i}`)
  assert.equal(activity.rows.length, 100)
  activity.clear(); assert.equal(activity.rows.length, 0)
})

test('all project tasks are monitored read-only, with public summaries and no historical announcements', async t => {
  const methods = [], reports = []
  let status = 'completed', turnId = 'historical-turn'
  const client = new DeviceCodex({ onReport: value => reports.push(value) })
  t.after(() => client.shutdown())
  client.status = 'ready'; client.cwd = cwd
  client.request = async (method, params) => {
    methods.push(method)
    if (method === 'thread/list') return { data: [{ id: 'external', name: '已有任务', cwd }, { id: 'foreign', cwd: 'other' }]
      .map(row => ({ ...row, updatedAt: status === 'inProgress' ? Date.now() / 1000 : 1 })) }
    if (method === 'thread/turns/list') return { data: [{ id: turnId, status }] }
    if (method === 'thread/items/list') return { data: [{ turnId: params.turnId, item: {
      id: 'reasoning', type: 'reasoning', summary: [{ text: '公开的进度摘要' }], content: [{ text: 'PRIVATE_RAW_REASONING' }],
    } }] }
    assert.fail(`unexpected mutation: ${method}`)
  }
  await client.monitorProject()
  assert.equal(client.tasks.has('foreign'), true)
  assert.equal(client.tasks.get('external').external, true)
  assert.equal(reports.length, 0)
  assert.match(JSON.stringify(client.snapshot()), /公开的进度摘要/)
  assert.doesNotMatch(JSON.stringify(client.snapshot()), /PRIVATE_RAW_REASONING/)
  await assert.rejects(client.interrupt('external'), /原窗口/)
  status = 'inProgress'; turnId = 'turn-external'; await client.monitorProject()
  status = 'completed'; await client.monitorProject()
  assert.equal(reports.filter(report => report.progress === false).length, 2)
  assert.equal(reports.filter(report => report.progress === true).length, 2)
  assert.ok(methods.every(method => ['thread/list', 'thread/turns/list', 'thread/items/list'].includes(method)))
})

test('global monitoring pages all sources without a workspace filter and keeps polling the head', async t => {
  const lists = [], reports = []
  const client = new DeviceCodex({ onReport: row => reports.push(row) })
  t.after(() => client.shutdown())
  client.status = 'ready'
  client.request = async (method, params) => {
    if (method === 'thread/list') {
      lists.push(params)
      return params.cursor ? { data: [{ id: 'older', cwd: '/other-project', updatedAt: 1 }], nextCursor: null }
        : { data: [{ id: 'head', cwd: '/new-project', updatedAt: 1 }], nextCursor: 'page-2' }
    }
    if (method === 'thread/turns/list') return { data: [{ id: 'turn', status: 'completed' }] }
    if (method === 'thread/items/list') return { data: [] }
    assert.fail(method)
  }
  await client.monitorProject()
  await client.monitorProject()
  assert.equal(client.tasks.size, 2)
  assert.equal(lists.length, 3)
  assert.equal(lists[1].cursor, undefined)
  assert.equal(lists[2].cursor, 'page-2')
  assert.ok(lists.every(params => !('cwd' in params) && params.sourceKinds.includes('appServer') && params.sourceKinds.includes('exec')))
  assert.equal(reports.length, 0)
  assert.equal(client.snapshot().monitoring, 'all-projects')
})

test('global discovery does not silently stop after twenty tasks', async t => {
  const client = new DeviceCodex()
  t.after(() => client.shutdown())
  client.status = 'ready'
  client.request = async method => method === 'thread/list'
    ? { data: Array.from({ length: 40 }, (_, i) => ({ id: `task-${i}`, cwd: `/project-${i}`, updatedAt: 1 })) }
    : { data: [] }
  await client.monitorProject()
  assert.equal(client.tasks.size, 40)
  assert.equal(client.snapshot().totalTasks, 40)
})

test('automatic discovery retries a missing installation and manual disconnect stops retries', async t => {
  let attempts = 0
  const client = new DeviceCodex({ retryMs: 5, launch: async () => { attempts++; throw new Error('未安装') } })
  t.after(() => client.stopAutoConnect())
  client.startAutoConnect()
  await until(() => attempts >= 2)
  client.stopAutoConnect()
  const stopped = attempts
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(attempts, stopped)
  assert.equal(client.status, 'disconnected')
})

test('invalid protocol frames fail the plugin without escaping into the desktop process', () => {
  const client = new DeviceCodex()
  client.read('not json\n')
  assert.equal(client.status, 'error')
  assert.match(client.message, /无效/)
})

test('a completed turn preserves blocked execution rather than asserting task success', t => {
  const reports = [], client = new DeviceCodex({ onReport: value => reports.push(value) })
  t.after(() => client.shutdown())
  client.tasks.set('blocked', { id: 'blocked', title: '检查代码', turnId: 'turn', status: 'inProgress', records: [], scope: { owner: 'bound-user' } })
  client.accept('item/completed', { threadId: 'blocked', turnId: 'turn', item: { id: 'answer', type: 'agentMessage', text: '未执行：failed to spawn code-mode host，找不到指定文件。' } })
  client.accept('turn/completed', { threadId: 'blocked', turn: { id: 'turn', status: 'completed' } })
  const result = reports.find(row => row.progress === false)
  assert.match(result.text, /本轮已结束.*未执行/)
  assert.doesNotMatch(result.text, /任务已完成/)
  assert.deepEqual(result.scope, { owner: 'bound-user' })
  assert.deepEqual(reports.find(row => row.progress === true).scope, { owner: 'bound-user' })
  assert.match(codexFailure('failed to spawn code-mode-host.exe: ENOENT'), /配套执行程序缺失/)
})

test('polling detects a new completed turn even when its status matches the previous turn', async t => {
  const reports = [], client = new DeviceCodex({ onReport: row => reports.push(row) })
  t.after(() => client.shutdown()); client.status = 'ready'
  const task = { id: 'same-thread', title: '连续任务', status: 'completed', lastTurnId: 'old', reportedTurnId: 'old', result: '上轮结果', records: [] }
  client.tasks.set(task.id, task)
  client.request = async method => method === 'thread/turns/list' ? { data: [{ id: 'new', status: 'completed' }] }
    : { data: [{ item: { id: 'new-answer', type: 'agentMessage', text: '新一轮结果' } }] }
  await client.refresh(); await client.refresh()
  assert.equal(task.result, '新一轮结果')
  assert.equal(reports.filter(row => row.progress === false).length, 1)
  assert.doesNotMatch(reports[0].text, /上轮结果/)
})
test('failed polling marks the task unknown rather than reusing a prior completed result', async t => {
  const client = new DeviceCodex(); t.after(() => client.shutdown()); client.status = 'ready'
  client.tasks.set('task', { id: 'task', title: '测试', status: 'completed', result: '旧结果', records: [] })
  client.request = async () => { throw new Error('unavailable') }
  await client.refresh()
  assert.equal(client.tasks.get('task').status, 'unknown'); assert.equal(client.tasks.get('task').result, '')
  assert.match(client.tasks.get('task').syncError, /查询失败/)
  assert.match(codexFailure('workspace routing discovery timed out'), /工作空间路由查询超时/)
})
test('a late persisted snapshot cannot overwrite a newer live completed event', async t => {
  const reports = [], client = new DeviceCodex({ onReport: row => reports.push(row) })
  t.after(() => client.shutdown()); client.status = 'ready'
  client.tasks.set('task', { id: 'task', title: '测试', status: 'inProgress', turnId: 'turn', lastTurnId: 'turn', records: [] })
  let release
  client.request = async method => method === 'thread/turns/list' ? { data: [{ id: 'turn', status: 'inProgress' }] }
    : await new Promise(resolve => { release = resolve })
  const polling = client.refresh(); await until(() => release)
  client.accept('turn/completed', { threadId: 'task', turn: { id: 'turn', status: 'failed' } })
  release({ data: [] }); await polling
  assert.equal(client.tasks.get('task').status, 'failed')
  assert.equal(reports.filter(row => row.progress === false).length, 1)
})
test('new turns clear old results and concurrent discovery callers wait for one scan', async t => {
  const client = new DeviceCodex(); t.after(() => client.shutdown()); client.status = 'ready'
  client.tasks.set('task', { id: 'task', title: '测试', status: 'completed', lastTurnId: 'old', result: '上轮结果', records: [] })
  client.accept('turn/started', { threadId: 'task', turn: { id: 'new' } })
  assert.equal(client.tasks.get('task').result, '')
  client.tasks.clear()
  let release, lists = 0
  client.request = async method => {
    if (method === 'thread/list') { lists++; return await new Promise(resolve => { release = resolve }) }
    return { data: [] }
  }
  const first = client.monitorProject(), second = client.monitorProject()
  assert.equal(first, second); release({ data: [] }); await Promise.all([first, second])
  assert.equal(lists, 1); assert.equal(client.snapshot().monitorStatus, 'ready')
})

test('baseline recovery after a failed poll never announces old completed history', async t => {
  const reports = [], client = new DeviceCodex({ onReport: row => reports.push(row) })
  t.after(() => client.shutdown()); client.status = 'ready'
  let available = false
  client.request = async method => {
    if (method === 'thread/list') return { data: [{ id: 'history', cwd: '/project', updatedAt: 1 }] }
    if (!available) throw new Error('temporarily unavailable')
    return method === 'thread/turns/list' ? { data: [{ id: 'old-turn', status: 'completed' }] } : { data: [] }
  }
  await client.monitorProject(); assert.equal(client.tasks.get('history').status, 'unknown')
  available = true; await client.monitorProject()
  assert.equal(client.tasks.get('history').status, 'completed'); assert.deepEqual(reports, [])
  available = false; await client.refresh()
  available = true; await client.refresh()
  assert.deepEqual(reports, [], 'Recovering an already-baselined completed turn must not announce it later')
})

test('renamed thread reports the current turn request even when the user item is outside the latest page', async t => {
  const reports=[],client=new DeviceCodex({onReport:row=>reports.push(row)})
  t.after(()=>client.shutdown());client.status='ready'
  let name='旧会话名',turnId='old-turn',status='completed'
  client.request=async(method,params)=>{
    if(method==='thread/list')return {data:[{id:'thread',cwd, name, updatedAt:Date.now()/1000}]}
    if(method==='thread/turns/list')return {data:[{id:turnId,status}]}
    if(params.sortDirection==='asc')return {data:[{turnId,item:{id:'request',type:'userMessage',content:[{type:'text',text:'本轮修复当前登录错误'}]}}]}
    return {data:[{turnId,item:{id:'answer',type:'agentMessage',text:'当前轮次的真实结果',phase:'final_answer'}}]}
  }
  await client.monitorProject();assert.deepEqual(reports,[])
  name='当前任务名称';turnId='current-turn';status='inProgress';await client.monitorProject()
  status='completed';await client.monitorProject()
  const task=client.tasks.get('thread'),completion=reports.find(row=>row.progress===false)
  assert.equal(task.title,'当前任务名称');assert.equal(task.currentRequest,'本轮修复当前登录错误')
  assert.match(completion.text,/当前任务名称.*本轮修复当前登录错误.*当前轮次的真实结果/)
  assert.equal(completion.turnId,'current-turn');assert.doesNotMatch(completion.text,/旧会话名/)
})

test('polling never imports another turn result and commentary is not a final result', async t=>{
  const client=new DeviceCodex();t.after(()=>client.shutdown());client.status='ready'
  const task={id:'thread',title:'真实任务',status:'inProgress',turnId:'new',lastTurnId:'new',records:[],result:''}
  client.tasks.set(task.id,task)
  client.request=async method=>method==='thread/turns/list'?{data:[{id:'new',status:'inProgress'}]}:{data:[
    {turnId:'old',item:{id:'old-answer',type:'agentMessage',text:'上个任务的结果'}},
    {turnId:'new',item:{id:'progress',type:'agentMessage',phase:'commentary',text:'正在实际检查'}}]}
  await client.refresh();assert.equal(task.result,'');assert.doesNotMatch(JSON.stringify(task.records),/上个任务/)
})

test('newly discovered old completion stays silent even if metadata was edited just now',async t=>{
  const reports=[],client=new DeviceCodex({onReport:row=>reports.push(row)})
  t.after(()=>client.shutdown());client.status='ready';client.monitorBaseline=false
  client.request=async method=>method==='thread/list'?{data:[{id:'renamed-history',cwd,name:'刚重命名的旧任务',updatedAt:Date.now()/1000}]}:
    method==='thread/turns/list'?{data:[{id:'old',status:'completed'}]}:{data:[]}
  await client.monitorProject();assert.deepEqual(reports,[])
})

test('old persisted running markers are unknown, not current running tasks',async t=>{
  const client=new DeviceCodex();t.after(()=>client.shutdown());client.status='ready'
  client.request=async method=>method==='thread/list'?{data:[{id:'old-active',cwd,updatedAt:1,status:{type:'notLoaded'}}]}:
    {data:[{id:'stale-turn',status:'inProgress'}]}
  await client.monitorProject();assert.equal(client.tasks.get('old-active').status,'unknown')
  assert.match(client.tasks.get('old-active').syncError,/无法确认/)
})

test('completion keeps its turn identity even when the started event was missed',t=>{
  const reports=[],client=new DeviceCodex({onReport:row=>reports.push(row)});t.after(()=>client.shutdown())
  client.tasks.set('thread',{id:'thread',title:'当前任务',status:'inProgress',turnId:'actual-turn',records:[],result:'真实结果'})
  client.accept('turn/completed',{threadId:'thread',turn:{id:'actual-turn',status:'completed'}})
  assert.equal(client.tasks.get('thread').lastTurnId,'actual-turn')
  assert.equal(reports[0].turnId,'actual-turn')
})
