import test from 'node:test'
import assert from 'node:assert/strict'
import { RemoteCodexChat } from '../electron/device-codex-remote.mjs'

const scope = { bound: true, owner: 'owner', tenantId: 'tenant', deviceId: 'pc', agentId: 'role' }
const options = { allowComputer: true, sessionId: 'phone' }
function setup(initial, config = {}) {
  const sent = []
  let context = scope
  const codex = { tasks: new Map(initial.map(task => [task.id, task])),
    connect: async () => {}, monitorProject: async () => {}, refresh: async () => {},
    continue: async (id, text, options) => { sent.push({ id, text, options }); return { ok: true, taskId: id, status: 'queued', message: `已排队：${id}` } } }
  const router = new RemoteCodexChat({ codex, context: () => context, ...config })
  return { router, codex, sent, setScope: value => { context = value } }
}
const task = (id, status = 'completed', updatedAt = 1) => ({ id, title: `任务 ${id}`, status, updatedAt, cwd: '/local/project', lastTurnId: 'old' })

test('any remote input discovers a unique target without querying and stays pinned across turns', async () => {
  const { router, codex, sent } = setup([task('old', 'completed', 1), task('current', 'inProgress', 2)])
  const text = '先别改代码，解释一下这个问题。\n“继续讲故事”只是测试输入。'
  assert.equal((await router.send(text, options)).status, 'queued')
  assert.equal(sent[0].id, 'current'); assert.equal(sent[0].text, text)
  codex.tasks.get('current').lastTurnId = 'new-turn'
  codex.tasks.get('current').status = 'completed'
  codex.tasks.set('different', task('different', 'inProgress', 100))
  await router.send('把刚才的方案改成最小改动', options)
  assert.deepEqual(sent.map(row => row.id), ['current', 'current'])
})

test('finished history selects only a unique latest target and never guesses a tie', async () => {
  const unique = setup([task('old', 'completed', 1), task('recent', 'completed', 2)])
  await unique.router.send('补充测试', options)
  assert.equal(unique.sent[0].id, 'recent')
  const tied = setup([task('one'), task('two')])
  const answer = await tied.router.send('检查登录', options)
  assert.equal(answer.status, 'selection-required')
  assert.match(answer.message, /选择任务/); assert.equal(tied.sent.length, 0)
})

test('numbered selection retains the original instruction and cannot change as discovery order changes', async () => {
  const { router, codex, sent } = setup([task('one', 'inProgress', 2), task('two', 'inProgress', 1)])
  const answer = await router.send('修复现在的问题', options)
  assert.match(answer.message, /1\. 任务 one/); assert.match(answer.message, /2\. 任务 two/)
  codex.tasks.get('two').updatedAt = 20
  await router.send('选择任务 2', options)
  assert.deepEqual(sent.map(({ id, text }) => ({ id, text })), [{ id: 'two', text: '修复现在的问题' }])
  await router.send('继续检查', options)
  assert.equal(sent[1].id, 'two')
})

test('list and switch select a task without forwarding the selection command as an instruction', async () => {
  const { router, sent } = setup([task('one'), task('two')])
  await router.send('任务列表', options)
  await router.send('选择任务 1', options)
  assert.equal(sent.length, 0)
  await router.send('解释这段代码', options)
  assert.equal(sent[0].id, 'one')
  await router.send('切换任务', options)
  await router.send('选择任务 2', options)
  await router.send('先执行测试', options)
  assert.equal(sent[1].id, 'two')
})

test('authorization, scope loss and removed targets never submit to a guessed replacement', async () => {
  const { router, codex, sent, setScope } = setup([task('one', 'inProgress'), task('two', 'inProgress')])
  await assert.rejects(router.send('检查项目', { ...options, allowComputer: false }), /授权/)
  await router.send('检查项目', options)
  setScope({ ...scope, owner: 'other' })
  await assert.rejects(router.send('选择任务 1', options), /选择|失效/)
  assert.equal(sent.length, 0)
  await router.send('任务列表', options)
  await router.send('选择任务 1', options)
  codex.tasks.delete('one')
  await assert.rejects(router.send('修复它', options), /失效|不存在/)
  assert.equal(sent.length, 0)
})

test('phone sessions cannot use each other choices and cancellation during discovery sends nothing', async () => {
  const { router, codex, sent } = setup([task('one'), task('two')])
  await router.send('任务列表', options)
  await assert.rejects(router.send('选择任务 1', { ...options, sessionId: 'different' }), /选择|失效/)
  const controller = new AbortController()
  codex.monitorProject = async () => controller.abort()
  await assert.rejects(router.send('修复它', { ...options, signal: controller.signal }), /abort/i)
  assert.equal(sent.length, 0)
})

test('explicit new task uses the pinned local project and future messages target the created thread', async () => {
  const { router, codex, sent } = setup([task('original')])
  const created = []
  codex.create = async (text, cwd, options) => {
    created.push({ text, cwd, options })
    codex.tasks.set('created', task('created', 'inProgress'))
    return { ok: true, taskId: 'created', message: '已创建真实任务' }
  }
  await router.send('先解释现状', options)
  await router.send('新建任务：为这个项目添加搜索功能', options)
  assert.equal(created.length, 1)
  assert.equal(created[0].cwd, '/local/project')
  assert.equal(created[0].text, '为这个项目添加搜索功能')
  await router.send('搜索还需要支持中文', options)
  assert.deepEqual(sent.map(row => row.id), ['original', 'created'])
})

test('first instruction creates a task only after selecting an ambiguous local project', async () => {
  const projects = [{ name: 'one', path: '/trusted/one' }, { name: 'two', path: '/trusted/two' }]
  const { router, codex } = setup([], { projects: async () => projects })
  const created = []
  codex.create = async (text, cwd) => { created.push({ text, cwd }); return { ok: true, taskId: 'new', message: '已创建' } }
  const answer = await router.send('检查项目的测试', options)
  assert.equal(answer.status, 'selection-required'); assert.match(answer.message, /选择项目/)
  assert.equal(created.length, 0)
  projects.reverse()
  await router.send('选择项目 2', options)
  assert.deepEqual(created, [{ text: '检查项目的测试', cwd: '/trusted/two' }])
  await assert.rejects(router.send('选择项目 2', options), /失效/)
})

test('a new task uses the locally configured project without asking a companion model', async () => {
  const { router, codex } = setup([], { project: () => '/configured/project' })
  codex.create = async (text, cwd) => ({ ok: true, taskId: 'new', message: `${cwd}:${text}` })
  assert.match((await router.send('创建 Codex 任务：完成代码审查', options)).message, /configured\/project:完成代码审查/)
})

test('questions about creating tasks remain exact input instead of creating a thread', async () => {
  const { router, codex, sent } = setup([task('current')])
  codex.create = async () => assert.fail('a question must not create a task')
  for (const text of ['创建任务是什么意思？', '新建任务的入口在哪里？']) {
    await router.send(text, options)
    assert.equal(sent.at(-1).text, text)
  }
})

test('missing project or unknown target status cannot silently create in an unrelated directory', async () => {
  const missing = setup([])
  missing.codex.create = async () => assert.fail('no project must never create')
  assert.match((await missing.router.send('检查登录', options)).message, /项目/)
  const unknown = setup([task('unconfirmed', 'unknown')])
  unknown.codex.create = async () => assert.fail('unconfirmed target must never create')
  await assert.rejects(unknown.router.send('修改它', options), /状态.*确认/)
})

test('cancelled or changed scope while choosing a workspace never starts a thread', async () => {
  const { router, codex, setScope } = setup([], { projects: async () => {
    setScope({ ...scope, tenantId: 'other' })
    return [{ path: '/trusted', name: 'project' }]
  } })
  codex.create = async () => assert.fail('context changed before creation')
  await assert.rejects(router.send('新建任务：检查项目', options), /上下文/)
})

test('an outstanding task switch never forwards new instructions to the previously selected thread', async () => {
  const { router, sent } = setup([task('one', 'inProgress', 2), task('two', 'completed', 1)])
  await router.send('检查原任务', options)
  await router.send('切换任务', options)
  const answer = await router.send('把新任务改成只读检查', options)
  assert.equal(answer.status, 'selection-required')
  assert.equal(sent.length, 1)
  await router.send('选择任务 2', options)
  assert.equal(sent[1].id, 'two')
  assert.equal(sent[1].text, '把新任务改成只读检查')
})

test('an outstanding project choice never forwards the new task to the previous thread', async () => {
  const { router, codex, sent } = setup([task('one')], { projects: async () => [{ name: 'first', path: '/one' }, { name: 'second', path: '/two' }] })
  codex.tasks.get('one').cwd = ''
  await router.send('检查原任务', options)
  await router.send('新建任务：另一个项目的工作', options)
  const answer = await router.send('新要求是只读检查', options)
  assert.equal(answer.status, 'selection-required')
  assert.equal(sent.length, 1)
})
