import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { showSettings } from './settings-navigation-fixture.mjs'

const require = createRequire(import.meta.url)
const root = process.cwd()
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const { WebSocketServer } = require('ws')
const artifacts = path.join(root, 'artifacts/settings-plugins')
await mkdir(artifacts, { recursive: true })
const profile = await mkdtemp(path.join(artifacts, 'profile-'))
const wb = path.join(profile, 'workbuddy')
const ws = new WebSocketServer({ host: '127.0.0.1', port: 0 })
await new Promise(resolve => ws.once('listening', resolve))
let socket, deviceId
ws.on('connection', client => {
  socket = client
  client.on('message', raw => {
    const value = JSON.parse(raw)
    if (value.type === 'device_online') {
      deviceId = value.deviceId
      client.send(JSON.stringify({ type: 'bind_offer', deviceId, bindToken: 'local-fixture-only', expireAt: Date.now() + 900000, bound: false }))
    } else if (value.type === 'ping') client.send('{"type":"pong"}')
  })
})
const errors = [], failed = []
let app
try {
  const env = { ...process.env, PET_DEVICE_USER_DATA: profile, WORKBUDDY_CONFIG_DIR: wb,
    PET_TEST_CODEX_FIXTURE: path.join(root, 'tests/codex-app-server-fixture.mjs'), PET_TEST_NODE: process.execPath,
    PET_CONTROL_WS_URL: `ws://127.0.0.1:${ws.address().port}/ws/control`,
    PET_PYTHON: path.join(profile, 'no-python'), PET_LAM_SOURCE: path.join(profile, 'no-model') }
  delete env.ELECTRON_RUN_AS_NODE
  app = await _electron.launch({ executablePath: process.env.SETTINGS_ELECTRON_EXECUTABLE || process.argv[2] || require('electron'),
    args: ['--disable-gpu', '--in-process-gpu', `--user-data-dir=${profile}`, path.join(root, 'tests/settings-electron-bootstrap.mjs')], env, timeout: 30000 })
  app.process().stderr.on('data', data => process.stderr.write(data))
  console.log('stage: launched')
  await app.evaluate(({ app, BrowserWindow }) => {
    globalThis.settingsLoadFailures = []
    const watch = win => win.webContents.on('did-fail-load', (_event, code, description, url) => globalThis.settingsLoadFailures.push({ code, description, url }))
    BrowserWindow.getAllWindows().forEach(watch)
    app.on('browser-window-created', (_event, win) => watch(win))
  })
  await app.firstWindow({ timeout: 15000 })
  console.log('stage: windows')
  const until = Date.now() + 10000
  while (app.windows().filter(page => page.url().includes('/device/')).length !== 2) {
    if (Date.now() >= until) {
      console.log(await app.evaluate(({ BrowserWindow }) => ({ windows: BrowserWindow.getAllWindows().map(win => win.webContents.getURL()), failures: globalThis.settingsLoadFailures })))
      assert.fail('The local settings and pet windows did not load')
    }
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  const page = app.windows().find(page => page.url().endsWith('/device/device.html'))
  const pet = app.windows().find(page => page.url().endsWith('/device/device-pet.html'))
  for (const window of [page, pet]) {
    window.on('pageerror', error => errors.push(error.message))
    window.on('response', response => { if (response.status() >= 400) failed.push(response.url()) })
  }
  await page.waitForFunction(() => document.querySelector('#qr').naturalWidth > 0 && !document.querySelector('#qr').hidden)
  console.log('stage: qr')
  assert.equal(await page.locator('#startup').isDisabled(), true, 'Source/isolated fixtures must never register OS startup')
  await page.waitForFunction(() => document.querySelector('#assistant-key').placeholder.includes('填写'))
  assert.equal(await page.locator('.plugin-card').count(), 4)
  assert.equal(await page.locator('#feedback').textContent(), '')
  await page.screenshot({ path: path.join(artifacts, 'settings-connection.png') })
  await showSettings(page, 'assistant-heading')
  await page.locator('#assistant-key').fill('sk-local-fixture-only')
  await page.locator('#assistant-key-toggle').click()
  assert.equal(await page.locator('#assistant-key').getAttribute('type'), 'text')
  await page.locator('#assistant-key-toggle').click()
  await page.locator('#assistant-save').click()
  await page.waitForFunction(() => document.querySelector('#assistant-key').placeholder.includes('已配置'))
  console.log('stage: key')
  assert.equal(await page.locator('#assistant-key').inputValue(), '')
  assert.equal((await page.evaluate(() => window.controlDevice.assistantState())).enabled, true)
  await page.screenshot({ path: path.join(artifacts, 'settings-plugins.png') })

  // Use the real process/RPC path with a local stand-in, never a paid model.
  await app.evaluate(({ dialog }, paths) => {
    const require = globalThis.fixtureRequire
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.cwd] })
    dialog.showMessageBox = async () => ({ response: 1 })
    const childProcess = require('node:child_process'), originalSpawn = childProcess.spawn
    childProcess.spawn = (command, args, options) => args.includes('app-server')
      ? originalSpawn(paths.node, [paths.fixture], { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
      : originalSpawn(command, args, options)
    require('node:module').syncBuiltinESMExports()
    // No catalog, voice metadata or production session requests in this test.
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 200, data: [] }), { headers: { 'content-type': 'application/json' } })
  }, { cwd: profile, node: process.execPath, fixture: path.join(root, 'tests/codex-app-server-fixture.mjs') })
  await showSettings(page, 'codex-heading')
  await page.locator('#codex-connect').click()
  await page.waitForFunction(() => document.querySelector('#codex-state').textContent === '已连接')
  console.log('stage: codex connected')
  assert.equal(await page.locator('#codex-directory, #codex-prompt, #codex-create, #workbuddy-directory').count(), 0)
  // Task creation belongs to Harness; provider protocol tests exercise its RPC.
  // Keep this UI test focused on displaying a public progress event.
  await app.evaluate(({ BrowserWindow }) => {
    const value={sequence:999999,rows:[{id:'fixture-progress',source:'Codex',kind:'summary',
      text:'正在检查测试依赖',at:Date.now(),revision:999999}]}
    BrowserWindow.getAllWindows().forEach(win=>win.webContents.send('device:activity',value))
  })
  await pet.waitForFunction(() => !document.querySelector('#task-summary').hidden)
  assert.equal(await pet.locator('#task-records').isVisible(), false)
  await pet.locator('#task-summary').hover()
  await pet.waitForFunction(() => getComputedStyle(document.querySelector('#task-records')).display !== 'none')
  assert.match(await pet.locator('#task-records').textContent(), /正在检查测试依赖/)
  assert.doesNotMatch(await pet.locator('#task-records').textContent(), /PRIVATE_RAW_REASONING/)
  assert.equal(await pet.locator('#task-records img').count(), 0)
  await pet.screenshot({ path: path.join(artifacts, 'task-records-hover.png') })
  await pet.mouse.move(1, 1)
  await pet.waitForFunction(() => getComputedStyle(document.querySelector('#task-records')).display === 'none')
  await pet.screenshot({ path: path.join(artifacts, 'task-summary.png') })
  await page.screenshot({ path: path.join(artifacts, 'codex-task.png') })

  socket.send(JSON.stringify({ type: 'bind_success', deviceId, tenantId: 'fixture-tenant', controllerUserId: 'fixture-user' }))
  await page.waitForFunction(() => document.querySelector('#binding').hidden && !document.querySelector('#binding-summary').hidden)
  socket.send(JSON.stringify({ type: 'bind_lost', deviceId }))
  await page.waitForFunction(() => !document.querySelector('#qr').hidden && document.querySelector('#qr').naturalWidth > 0)
  const sizes = []
  for (const width of [320, 650, 960]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/device/device.html')).setContentSize(width, 780), width)
    await page.waitForFunction(width => innerWidth === width, width)
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      contentWidth: document.querySelector('.settings-workspace').clientWidth, contentScroll: document.querySelector('.settings-workspace').scrollWidth }))
    assert.ok(dimensions.scrollWidth <= width && dimensions.contentScroll <= dimensions.contentWidth, JSON.stringify(dimensions))
    sizes.push(dimensions)
    await page.screenshot({ path: path.join(artifacts, `settings-${width}.png`) })
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(failed, [])
  // The account exit is available even when unbound and closes the actual app,
  // rather than hiding one window or waiting for an unsupported server logout.
  await page.locator('#account-menu > summary').click()
  assert.equal(await page.locator('#account-logout').isEnabled(), true)
  const closed = new Promise(resolve => app.process().once('exit', resolve))
  await page.locator('#account-logout').click()
  await closed
  app = null
  const report = { qrVisible: true, keySaved: true, bindingTransitions: true, accountExitClosesApp: true, harnessOnlyTaskControls: true, hoverRecords: true, rawReasoningExcluded: true, noProductionSessions: true, sizes, errors, failed }
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  if (app) {
    let timer
    await Promise.race([app.close(), new Promise(resolve => { timer = setTimeout(() => { app.process().kill(); resolve() }, 5000) })])
    clearTimeout(timer)
  }
  for (const client of ws.clients) client.terminate()
  await new Promise(resolve => ws.close(resolve))
}
