import test from 'node:test'
import assert from 'node:assert/strict'
import { RemoteTools } from '../electron/device-remote-tools.mjs'

const scope = { bound: true, owner: 'owner', tenantId: 'tenant', deviceId: 'pc', agentId: 'role' }
function fixture() {
  let context = scope, key = 'fixture-key'
  const calls = [], bodies = []
  const settings = { key: () => key }
  const assistant = { settings, enabled: () => true, run: async (text, options) => {
    calls.push({ target: 'harness', text, options }); return 'Harness 实际结果'
  } }
  const tools = new RemoteTools({ context: () => context, settings, assistant,
    codex: { status: 'ready' }, codexChat: { send: async (text, options) => {
      calls.push({ target: 'codex', text, options }); return { ok: true, message: '已排队' }
    } },
    workbuddy: { create: async (text, cwd, options) => {
      calls.push({ target: 'workbuddy', text, cwd, options }); return { ok: true, taskId: 'new', message: '实际已提交' }
    } },
    statuses: () => [{ id: 'workbuddy', available: true }], project: () => '/trusted/project',
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body))
      return Response.json({ choices: [{ message: { content: 'DeepSeek 实际回答' } }] })
    } })
  const send = (text, target, extra = {}) => tools.send(text, { target, allowComputer: true, sessionId: 'phone', ...extra })
  return { tools, send, calls, bodies, assistant, setKey: value => { key = value }, setContext: value => { context = value } }
}

test('explicit targets receive exact ordinary input without classification or cross-provider fallback', async () => {
  const f = fixture(), text = '先不要执行，解释一下方案\n创建任务是什么意思？'
  assert.match((await f.send(text, 'codex')).message, /已排队/)
  assert.match((await f.send(text, 'harness')).message, /实际结果/)
  assert.match((await f.send(text, 'workbuddy')).message, /实际已提交/)
  assert.deepEqual(f.calls.map(({ target, text: value }) => [target, value]), ['codex', 'harness', 'workbuddy'].map(target => [target, text]))
  assert.equal(f.calls[2].cwd, '/trusted/project')
  assert.equal(f.calls[1].options.targetSession, 'phone')
})

test('DeepSeek stays on its own key, retains isolated history and never runs Harness tools', async () => {
  const f = fixture()
  await f.send('第一问', 'deepseek')
  await f.send('第二问', 'deepseek')
  assert.deepEqual(f.bodies[1].messages.slice(1).map(row => row.content), ['第一问', 'DeepSeek 实际回答', '第二问'])
  assert.equal(f.calls.length, 0)
  assert.equal(f.bodies[0].tools, undefined)
  await f.send('另一手机', 'deepseek', { sessionId: 'other-phone' })
  assert.deepEqual(f.bodies[2].messages.slice(1).map(row => row.content), ['另一手机'])
  f.setContext({ ...scope, owner: 'other' })
  await f.send('另一账户', 'deepseek')
  assert.deepEqual(f.bodies[3].messages.slice(1).map(row => row.content), ['另一账户'])
})

test('authorization, unavailable/unknown tools and scope changes never fall back or execute', async () => {
  const f = fixture()
  await assert.rejects(f.send('普通问题', 'harness', { allowComputer: false }), /授权/)
  await assert.rejects(f.send('普通问题', 'untrusted'), /工具/)
  f.setKey('')
  await assert.rejects(f.send('普通问题', 'deepseek'), /DeepSeek/)
  assert.equal(f.calls.length + f.bodies.length, 0)
  f.setContext({ ...scope, bound: false })
  await assert.rejects(f.send('普通问题', 'codex'), /绑定/)
})

test('catalog contains only bounded public readiness and distinguishes WorkBuddy new-task support', () => {
  const f = fixture(), catalog = f.tools.catalog()
  assert.equal(catalog.version, 1)
  assert.equal(catalog.defaultTarget, 'codex')
  assert.deepEqual(catalog.items.map(row => row.id), ['codex', 'deepseek', 'harness', 'workbuddy'])
  assert.equal(catalog.items.find(row => row.id === 'workbuddy').mode, 'create')
  assert.ok(catalog.items.every(row => typeof row.available === 'boolean'))
  assert.doesNotMatch(JSON.stringify(catalog), /fixture-key|trusted\/project/)
})

test('provider cancellation suppresses a late answer and does not add it to DeepSeek history', async () => {
  const f = fixture(), controller = new AbortController()
  f.tools.beforeSend = async () => controller.abort()
  await assert.rejects(f.send('取消的消息', 'deepseek', { signal: controller.signal }), /取消|abort/i)
  assert.equal(f.bodies.length, 0)
})

test('clearing a binding clears DeepSeek memory and cancels sends waiting at the provider boundary', async () => {
  const f = fixture()
  await f.send('旧绑定消息', 'deepseek')
  let entered, release
  const waiting = new Promise(resolve => { entered = resolve })
  f.tools.beforeSend = () => { entered(); return new Promise(resolve => { release = resolve }) }
  const pending = f.send('失效请求', 'harness')
  await waiting
  f.tools.clear()
  release()
  await assert.rejects(pending, /上下文/)
  assert.equal(f.tools.histories.size, 0)
  assert.equal(f.calls.length, 0)
})
