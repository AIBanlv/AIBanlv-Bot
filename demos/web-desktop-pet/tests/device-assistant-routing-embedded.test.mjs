import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { AssistantService } from '../electron/device-assistant-service.mjs'
import { prepareHarnessLaunch } from '../electron/device-assistant-runtime.mjs'
import { modelFixture } from './assistant-model-fixture.mjs'

test('real embedded Harness routes semantically with zero executable tools and cleans its private worker', async t => {
  await mkdir('artifacts', { recursive: true })
  const root = await mkdtemp(path.resolve('artifacts/harness-routing-'))
  const model = await modelFixture()
  let actions = 0
  const service = new AssistantService({ root, settings: {
    snapshot: () => ({ enabled: true }), key: () => 'fixture-key' },
    launchFactory: async options => {
      assert.equal(options.purpose, 'routing')
      const launch = await prepareHarnessLaunch(options)
      launch.env.DEEPSEEK_BASE_URL = model.base
      launch.env.DEEPSEEK_SEARCH_BASE_URL = `${model.base}/search`
      return launch
    } })
  service.execute = async () => { actions++; throw new Error('MUST_NOT_EXECUTE') }
  t.after(async () => { await service.reset(); await model.close(); await rm(root, { recursive: true, force: true }) })
  const plan = { decision: 'task', task: '今天有没有新邮件？', provider: 'desktop', operation: 'create' }
  assert.deepEqual(await service.planTask('今天有没有新邮件？'), plan)
  assert.equal(model.requests.length, 1)
  assert.deepEqual(model.requests[0].tools || [], [])
  assert.equal(actions, 0)
  assert.equal(model.searchRequests.length, 0)
  assert.equal(service.planner.process, null, 'routing releases its worker/history after each bounded decision')
  // The live app supplies recent dialogue. This used to exceed the worker's
  // 2,000-character task limit before any classification request reached it.
  const drive = { decision: 'task', task: '打开 D 盘', provider: 'desktop', operation: 'create' }
  const context = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: '较长的历史对话内容。'.repeat(100) }))
  assert.deepEqual(await service.planTask(drive.task, { context }), drive)
  assert.equal(model.requests.length, 2)
  assert.deepEqual(model.requests[1].tools || [], [])
  assert.equal(actions, 0)
  model.routingAnswer = '{"decision":"chat"}'
  assert.deepEqual(await service.planTask('不要截图，解释一下截图是什么'), { decision: 'chat' })
  assert.equal(model.requests.length, 3)
  assert.deepEqual(model.requests[2].tools || [], [])
  await service.reset()
  assert.deepEqual(await readdir(path.join(root, 'routing')), [])
  assert.equal(service.planner.process, null)
  assert.deepEqual(model.unexpected, [])
})

test('text drive commands with long history reach real Harness folder tools and report only their result', async t => {
  const { DeviceTextConversation } = await import('../electron/device-text-conversation.mjs')
  await mkdir('artifacts', { recursive: true })
  const root = await mkdtemp(path.resolve('artifacts/harness-text-folder-'))
  const folder = path.join(root, 'drive-fixture'); await mkdir(folder)
  const model = await modelFixture(), opened = []
  model.tool = 'control_open_folder'; model.target = folder
  const service = new AssistantService({ root: path.join(root, 'private'), approvalMode: 'automatic',
    settings: { snapshot: () => ({ enabled: true }), key: () => 'fixture-key' },
    openPath: async target => { opened.push(target); return '' },
    launchFactory: async options => {
      const launch = await prepareHarnessLaunch(options)
      launch.env.DEEPSEEK_BASE_URL = model.base
      launch.env.DEEPSEEK_SEARCH_BASE_URL = `${model.base}/search`
      return launch
    } })
  t.after(async () => { await service.reset(); await model.close(); await rm(root, { recursive: true, force: true }) })
  const events = [], context = Array.from({ length: 6 }, () => ({ role: 'assistant', text: '历史上下文'.repeat(200) }))
  const chat = new DeviceTextConversation({ settings: service.settings, assistant: service,
    context: () => ({ agentId: 'fixture-role', persona: '本地测试角色' }), getHistory: () => context,
    onEvent: event => events.push(event), fetchImpl: () => assert.fail('must not fall back to ordinary chat') })
  assert.equal((await chat.chat('打开 D 盘')).ok, true)
  // realpath reports the filesystem's drive-letter casing, which may differ from
  // the temporary directory's spelling on Windows; the path itself must match.
  const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
  assert.deepEqual(opened.map(canonical), [canonical(folder)], 'OS action is substituted; do not open the actual user drive during tests')
  assert.equal(events.find(row => row.type === 'assistant').text, model.answer)
  assert.equal(model.requests.length, 3, 'one read-only route, one tool call, one tool-result reply')
  assert.deepEqual(model.requests[0].tools || [], [])
  assert.match(JSON.stringify(model.requests.at(-1)), /opened/)
  assert.deepEqual(model.unexpected, [])
})
