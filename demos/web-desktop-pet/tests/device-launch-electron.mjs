import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, launchStatus } from '../harness-client-plugin/desktop-launch.mjs'

const require = createRequire(import.meta.url), root = process.cwd()
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const { WebSocketServer } = require('ws')
const artifacts = path.join(root, 'artifacts/desktop-launch')
await mkdir(artifacts, { recursive: true })
const profile = await mkdtemp(path.join(artifacts, 'profile-'))
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
await new Promise(resolve => server.once('listening', resolve))
server.on('connection', socket => socket.on('message', raw => {
  const message = JSON.parse(raw)
  if (message.type === 'device_online') socket.send(JSON.stringify({ type: 'bind_offer', deviceId: message.deviceId,
    bindToken: 'local-launch-only', expireAt: Date.now() + 900000, bound: false }))
  if (message.type === 'ping') socket.send('{"type":"pong"}')
}))
const env = { ...process.env, PET_DEVICE_USER_DATA: profile, WORKBUDDY_CONFIG_DIR: path.join(profile, 'workbuddy'),
  PET_CONTROL_WS_URL: `ws://127.0.0.1:${server.address().port}/ws/control`, DEVICE_UPDATE_SOURCE_ONLY: '1',
  PET_PYTHON: path.join(profile, 'no-python'), PET_LAM_SOURCE: path.join(profile, 'no-model') }
delete env.ELECTRON_RUN_AS_NODE
let electron
async function open() {
  electron = await _electron.launch({ executablePath: require('electron'), args: ['--disable-gpu', '--in-process-gpu',
    path.join(root, 'tests/device-update-bootstrap.mjs')], env, timeout: 30000 })
  await electron.firstWindow()
  await electron.evaluate(({ app }) => { globalThis.secondLaunches = []; app.on('second-instance', (_event, argv) => globalThis.secondLaunches.push(argv)) })
  const deadline = Date.now() + 15000
  while (!electron.windows().some(page => page.url().endsWith('/device/device.html'))) {
    assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 50))
  }
  await electron.windows().find(page => page.url().endsWith('/device/device.html')).waitForFunction(() => window.controlDevice && document.querySelector('#account-update')?.onclick)
}
async function waitSecond(count) {
  const deadline = Date.now() + 10000
  while ((await electron.evaluate(() => globalThis.secondLaunches.length)) < count) {
    assert.ok(Date.now() < deadline, 'second-instance was not delivered'); await new Promise(resolve => setTimeout(resolve, 50))
  }
}
try {
  await open()
  assert.equal((await launchStatus(profile)).configured, true)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/device/device.html')).hide())
  await launchDesktop({ directory: profile, automatic: true, env }); await waitSecond(1)
  assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/device/device.html')).isVisible()), false)
  assert.equal((await launchStatus(profile)).paused, false, 'losing automatic process must not pause the owner')
  await launchDesktop({ directory: profile, env }); await waitSecond(2)
  assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/device/device.html')).isVisible()), true)
  assert.equal(electron.windows().length, 2, 'all launch paths reuse the same desktop instance')
  await electron.close(); electron = null
  assert.equal((await launchDesktop({ directory: profile, automatic: true, env })).status, 'paused')
  await open()
  assert.equal((await launchStatus(profile)).paused, false, 'manual application startup resumes host launch')
  console.log('desktop launch Electron: shared instance, quiet auto-start, manual show, quit pause and manual recovery passed')
} finally {
  await electron?.close()
  for (const client of server.clients) client.terminate()
  await new Promise(resolve => server.close(resolve))
}
