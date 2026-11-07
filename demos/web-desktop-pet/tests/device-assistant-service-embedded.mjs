import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { AssistantService } from '../electron/device-assistant-service.mjs'
import { prepareHarnessLaunch } from '../electron/device-assistant-runtime.mjs'
import { modelFixture } from './assistant-model-fixture.mjs'
await mkdir('artifacts', { recursive: true })
const container = await mkdtemp(path.resolve('artifacts/assistant-embedded-service-'))
const root = path.join(container, 'private')
const desktop = path.join(container, 'desktop')
await mkdir(desktop)
await writeFile(path.join(desktop, 'notes.txt'), 'desktop fixture')
const model = await modelFixture()
const approvals = [], opened = [], statuses = []
let approve = true
const assistant = new AssistantService({ root, desktop, history: path.join(container, 'history'),
listApps: async () => [{ name: 'Fixture Player', id: path.join(container, 'player.exe') }],
launchApp: async app => { opened.push(app.id) }, settings: {
  snapshot: () => ({ enabled: true }), key: () => 'fixture-only-key',
}, launchFactory: async options => {
  const launch = await prepareHarnessLaunch(options)
  launch.env.DEEPSEEK_BASE_URL = model.base
  launch.env.DEEPSEEK_SEARCH_BASE_URL = `${model.base}/search`
  return launch
}, approve: async value => { approvals.push(value); return approve },
openExternal: async target => { opened.push(target) }, onStatus: status => statuses.push(status),
openPath: async target => { opened.push(target); return '' },
resolveHost: async () => [{ address: '8.8.8.8', family: 4 }] })
try {
  assert.equal(await assistant.run('打开测试页面'), model.answer)
  const sessionId = assistant.process.sessionId
  assert.equal(opened.length, 1)
  assert.equal(approvals[0].target, 'https://example.com/')
  approve = false
  await assistant.run('再打开测试页面')
  assert.equal(assistant.process.sessionId, sessionId)
  assert.equal(opened.length, 1)
  assert.match(JSON.stringify(model.requests.at(-1)), /ACTION_DENIED|你已拒绝此操作/)
  assert.equal(approvals.length, 2)
  approve = true
  model.tool = 'control_open_folder'; model.target = container
  await assistant.run('打开指定文件夹')
  assert.equal(opened.at(-1), container)
  const file = path.join(container, 'notes.md')
  await writeFile(file, '夹具会议记录：本周已完成接口联调。')
  model.tool = 'control_read_text'; model.target = file
  await assistant.run('总结指定文本文件')
  assert.match(JSON.stringify(model.requests.at(-1)), /本周已完成接口联调/)
  model.tool = 'control_open_app'; model.target = 'Fixture Player'
  await assistant.run('打开已安装的应用')
  assert.equal(opened.at(-1), path.join(container, 'player.exe'))
  assert.match(JSON.stringify(model.requests.at(-1)), /launch_requested/)
  model.tool = 'control_plan_desktop'; model.target = 'desktop'
  await assistant.run('预览桌面整理')
  assert.deepEqual(await readdir(desktop), ['notes.txt'])
  assert.match(JSON.stringify(model.requests.at(-1)), /planId/)
  const planId = [...assistant.organizer.pending.keys()][0]
  model.tool = 'control_organize_desktop'; model.target = planId
  await assistant.run('执行桌面整理')
  assert.match(JSON.stringify(model.requests.at(-1)), /organized/)
  await assert.rejects(readFile(path.join(desktop, 'notes.txt')), { code: 'ENOENT' })
  await assistant.reset()
  model.tool = 'control_undo_desktop'; model.target = 'latest'
  await assistant.run('恢复上次桌面整理')
  assert.equal(await readFile(path.join(desktop, 'notes.txt'), 'utf8'), 'desktop fixture')
  assert.match(JSON.stringify(model.requests.at(-1)), /restored/)
  model.tool = 'web_search'; model.arguments = { queries: ['测试检索'] }
  await assistant.run('搜索并总结测试资料')
  assert.equal(model.searchRequests.length, 1)
  assert.match(JSON.stringify(model.requests.at(-1)), /https:\/\/example.com\/reference/)
  model.tool = 'web_fetch'; model.arguments = { url: `${model.base}/must-not-fetch-private` }
  await assistant.run('验证内网网页拒绝')
  assert.deepEqual(model.unexpected, [])
  model.hold = true
  const before = model.requests.length
  const controller = new AbortController()
  const pending = assistant.run('等待取消', { signal: controller.signal })
  const rejected = assert.rejects(pending, /ASSISTANT_CANCELLED/)
  const deadline = Date.now() + 15000
  while (model.requests.length === before) {
    assert.ok(Date.now() < deadline, 'Harness did not reach loopback model')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  controller.abort()
  await rejected
  await assistant.reset()
  assert.deepEqual(await readdir(root), [])
  assert.deepEqual(model.unexpected, [])
  console.log('Embedded service: web/folder/text, app launch, native desktop moves and restart recovery, approval/denial, cancellation and cleanup passed (loopback only).')
} finally {
  await assistant.reset(); await model.close(); await rm(container, { recursive: true, force: true })
}
