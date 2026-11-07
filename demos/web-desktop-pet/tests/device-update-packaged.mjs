import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { aibanlvAppId } from '../electron/device-branding.mjs'

const root = process.cwd(), require = createRequire(import.meta.url)
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const { WebSocketServer } = require('ws')
const build = JSON.parse(await readFile(path.join(root, 'dist/device-latest-win32-x64.json'), 'utf8'))
const output = path.join(root, 'artifacts/release-' + build.version)
await mkdir(output, { recursive: true })
const profile = await mkdtemp(path.join(output, 'update-profile-'))
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
await new Promise(resolve => server.once('listening', resolve))
server.on('connection', socket => socket.on('message', raw => {
  const message = JSON.parse(raw)
  if (message.type === 'device_online') socket.send(JSON.stringify({ type: 'bind_offer', deviceId: message.deviceId,
    bindToken: 'packaged-update-fixture', expireAt: Date.now() + 900000, bound: false }))
  if (message.type === 'ping') socket.send('{"type":"pong"}')
}))
let electron
try {
  const env = { ...process.env, PET_DEVICE_USER_DATA: profile, WORKBUDDY_CONFIG_DIR: path.join(profile, 'workbuddy'),
    PET_CONTROL_WS_URL: `ws://127.0.0.1:${server.address().port}/ws/control`,
    PET_DESKTOP_UPDATE_URL: 'https://updates.example.test/latest.json',
    PET_PYTHON: path.join(profile, 'missing-python'), PET_LAM_SOURCE: path.join(profile, 'missing-model'),
    JAVA: path.join(profile, 'missing-java'), GSON_JAR: path.join(profile, 'missing-gson') }
  delete env.ELECTRON_RUN_AS_NODE
  electron = await _electron.launch({ executablePath: build.executable, args: ['--disable-gpu', '--in-process-gpu'], env, timeout: 30000 })
  await electron.firstWindow()
  const actualVersion = await electron.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged }))
  assert.deepEqual(actualVersion, { version: build.version, packaged: true })
  const defaultFeed = await electron.evaluate(({ app }) => {
    const path = process.getBuiltinModule('node:path')
    const require = process.getBuiltinModule('node:module').createRequire(path.join(app.getAppPath(), 'package.json'))
    return require('./control-windows/demos/web-desktop-pet/electron/device-update.mjs').DEFAULT_UPDATE_URL
  })
  assert.equal(defaultFeed, 'https://download.aibanlv.ai/desktop-updates/windows/x64/latest.json')
  const payload = 'Packaged update smoke fixture, never executable'
  await electron.evaluate((_electron, fixture) => {
    const payload = Buffer.from(fixture.payload)
    globalThis.fetch = async url => String(url).endsWith('/latest.json') ? Response.json({ version: '999.0.0',
      platform: 'win32', arch: 'x64', url: 'https://updates.example.test/Setup.exe', bytes: payload.length,
      sha256: fixture.sha256, notes: '打包后更新检查夹具' }) : new Response(payload)
  }, { payload, sha256: createHash('sha256').update(payload).digest('hex') })
  const deadline = Date.now() + 10000
  let page
  while (!(page = electron.windows().find(page => page.url().endsWith('/device/device.html')))) {
    assert.ok(Date.now() < deadline, 'Settings window did not load')
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  let taskbar = []
  if (process.platform === 'win32') {
    const handles = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win =>
      win.getNativeWindowHandle().readBigUInt64LE().toString()))
    taskbar = JSON.parse(execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'tests/windows-taskbar-properties.ps1'), '-Handles', handles.join(',')],
      { encoding: 'utf8', windowsHide: true, env: { ...process.env,
        PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules') } }))
    assert.equal(taskbar.length, 2)
    for (const properties of taskbar) {
      assert.equal(properties.appId, aibanlvAppId(true))
      assert.equal(properties.icon, `${build.executable},0`)
      assert.equal(properties.command, `"${build.executable}"`)
      assert.equal(properties.displayName, 'AIBanlv')
    }
    const shortcut = await electron.evaluate(({ app, shell }, profile) => {
      const { mkdirSync } = process.getBuiltinModule('node:fs')
      const path = process.getBuiltinModule('node:path')
      const require = process.getBuiltinModule('node:module').createRequire(path.join(app.getAppPath(), 'package.json'))
      const { repairOwnedShortcuts } = require('./control-windows/demos/web-desktop-pet/electron/device-branding.mjs')
      const desktop = path.join(profile, 'Desktop')
      mkdirSync(desktop)
      const file = path.join(desktop, 'AIBanlv.lnk')
      if (!shell.writeShortcutLink(file, 'create', { target: process.execPath })) throw new Error('Cannot create fixture shortcut')
      repairOwnedShortcuts({ shell, executable: process.execPath, desktop, appData: profile })
      return shell.readShortcutLink(file)
    }, profile)
    assert.equal(shortcut.appUserModelId, aibanlvAppId(true))
    assert.equal(shortcut.icon, build.executable)
  }
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => document.querySelector('#account-update')?.onclick)
  await page.locator('#account-menu > summary').click()
  await page.locator('#account-update').click()
  await page.waitForFunction(() => !document.querySelector('#desktop-update-download').hidden)
  assert.ok((await page.locator('#desktop-update-version').textContent()).includes(`当前版本 ${build.version}`))
  await page.locator('#desktop-update-download').click()
  await page.waitForFunction(() => document.querySelector('#desktop-update-status').textContent.includes('安装包已校验'))
  const state = await page.evaluate(() => window.controlDevice.updateState())
  assert.equal(state.status, 'ready')
  assert.equal(state.canInstall, false, 'Uninstalled distribution must not replace an existing installation')
  assert.equal((await page.evaluate(() => window.controlDevice.installUpdate())).ok, false)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: path.join(output, 'packaged-update.png') })
  const report = { version: build.version, packaged: true, bundledUpdateModules: true, checked: true,
    downloadedAndVerified: true, portableInstallDenied: true, defaultFeed, taskbar, errors }
  await writeFile(path.join(output, 'packaged-update.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  if (electron) await electron.close()
  for (const client of server.clients) client.terminate()
  await new Promise(resolve => server.close(resolve))
}
