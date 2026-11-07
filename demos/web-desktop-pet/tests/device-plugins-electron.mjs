import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url), root = process.cwd()
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const { WebSocketServer } = require('ws')
const output = path.join(root, 'artifacts/online-plugins')
await mkdir(output, { recursive: true })
const profile = await mkdtemp(path.join(output, 'profile-'))
await writeFile(path.join(profile, 'model-settings.json'), JSON.stringify({ source: 'auto', platformEnabled: false }))
let mode = 'ready', reads = 0, release
const rows = [
  { id: 'sample', name: '示例线上插件', version: '1.0.0', description: '这里显示插件的用途，后续可通过清单发布新的插件。' },
  { id: 'plain-text', name: '<img src=x onerror=alert(1)>', description: '仅作为文字展示' },
  { id: 'unlisted', name: '已下架插件', enabled: false },
]
const fixture = createServer(async (request, response) => {
  assert.equal(request.url, '/catalog.json'); assert.equal(request.headers.authorization, undefined)
  reads++
  if (mode === 'hold') await new Promise(resolve => { release = resolve })
  if (mode === 'missing') { response.writeHead(404).end(); return }
  if (mode === 'error') { response.writeHead(500).end(); return }
  response.setHeader('Content-Type', 'application/json')
  response.end(mode === 'invalid' ? '{invalid' : JSON.stringify({ schema: 1, plugins: mode === 'empty' ? [] : rows }))
})
const ws = new WebSocketServer({ server: fixture })
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${fixture.address().port}`
const bootstrap = path.join(output, 'bootstrap.mjs')
await writeFile(bootstrap, `import { app, dialog } from 'electron'
import { createRequire, registerHooks } from 'node:module'
import { mkdirSync } from 'node:fs'
const profile = ${JSON.stringify(profile)}
mkdirSync(profile + '/session', { recursive: true })
app.setPath('userData', profile); app.setPath('sessionData', profile + '/session')
const require = createRequire(import.meta.url), Socket = require('ws')
globalThis.WebSocket = class extends Socket {
  constructor(url, options) {
    if (!String(url).startsWith(${JSON.stringify(base.replace('http:', 'ws:') + '/')})) throw new Error('Non-fixture socket blocked')
    super(url, options)
  }
}
registerHooks({ resolve(specifier, context, next) {
  return specifier === 'ws' && context.conditions.includes('import')
    ? { url: 'data:text/javascript,export default globalThis.WebSocket', shortCircuit: true } : next(specifier, context)
} })
const fetchImpl = globalThis.fetch
globalThis.fetch = (url, options) => {
  if (String(url) === 'https://download.aibanlv.ai/desktop-plugins/catalog.json') return fetchImpl(${JSON.stringify(base + '/catalog.json')}, options)
  return Promise.reject(new Error('Non-fixture request blocked'))
}
dialog.showErrorBox = title => { console.error(title); app.exit(1) }
dialog.showMessageBox = async () => ({ response: 0 })
await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/device-main.mjs')).href)})
`)
let app
const errors = []
try {
  const env = { ...process.env, PET_DEVICE_USER_DATA: profile, PET_CONTROL_WS_URL: base.replace('http:', 'ws:') + '/ws/control' }
  delete env.ELECTRON_RUN_AS_NODE; delete env.PET_CONTROL_HTTP_ORIGIN
  app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap], env, timeout: 20000 })
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
  await app.firstWindow()
  const deadline = Date.now() + 15000
  while (!(await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows()
    return windows.length === 2 && windows.every(win => win.isVisible() && !win.webContents.isLoading())
  }))) { assert.ok(Date.now() < deadline, 'Both desktop windows must finish startup'); await new Promise(resolve => setTimeout(resolve, 50)) }
  const page = app.windows().find(win => win.url().endsWith('/device/device.html'))
  const pet = app.windows().find(win => win.url().endsWith('/device/device-pet.html'))
  page.setDefaultTimeout(10000)
  assert.equal(reads, 0, 'Opening the app must not query the plugin catalog')
  await page.locator('[data-section="plugins-heading"]').click()
  await page.locator('#online-plugins-list article').first().waitFor()
  assert.equal(await page.locator('#online-plugins-list article').count(), 2)
  assert.equal(await page.locator('#online-plugins-list img').count(), 0)
  assert.ok((await page.locator('#online-plugins-list').textContent()).includes(rows[1].name))
  assert.equal(await page.locator('#plugins-count').textContent(), '6')
  assert.equal(await page.locator('.plugin-shortcut').count(), 4)
  const before = reads
  assert.deepEqual(await pet.evaluate(() => window.controlDevice.queryPlugins()), { ok: false, code: 'INVALID_SOURCE' })
  assert.equal(reads, before, 'The pet cannot invoke plugin queries')
  await page.locator('[data-plugin="assistant-heading"]').click()
  assert.equal(await page.locator('#settings-page-title').textContent(), 'Harness')
  await page.locator('#settings-back').click()
  await page.waitForFunction(() => !document.querySelector('#online-plugins-refresh').disabled)
  assert.equal(reads, before + 1, 'Reopening the page refreshes publication changes')
  for (const [nextMode, message] of [['missing', '线上插件列表尚未发布'], ['error', '线上插件查询失败，请刷新重试'],
    ['invalid', '线上插件查询失败，请刷新重试'], ['empty', '暂无线上插件']]) {
    mode = nextMode
    await page.locator('#online-plugins-refresh').click()
    await page.waitForFunction(text => document.querySelector('#online-plugins-status').textContent === text, message)
    assert.equal(await page.locator('#online-plugins-list article').count(), 0)
    assert.equal(await page.locator('#plugins-count').textContent(), '4')
  }
  mode = 'hold'
  await page.locator('#online-plugins-refresh').click()
  await page.waitForFunction(() => document.querySelector('#online-plugins-refresh').disabled)
  assert.equal(await page.locator('#online-plugins-status').textContent(), '正在查询线上插件…')
  while (!release) await new Promise(resolve => setTimeout(resolve, 10))
  mode = 'ready'; release()
  await page.locator('#online-plugins-list article').first().waitFor()
  for (const width of [320, 768, 1024, 1440]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/device/device.html')).setSize(width, 800), width)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('.settings-workspace').scrollWidth > document.querySelector('.settings-workspace').clientWidth), false)
  }
  await page.screenshot({ path: path.join(output, 'plugins.png') })
  await page.locator('#desktop-language').selectOption('en')
  await page.waitForFunction(() => document.querySelector('#online-plugins-title').textContent === 'Online plugins')
  assert.ok((await page.locator('#online-plugins-list').textContent()).includes('示例线上插件'), 'Publisher text is not translated')
  await page.locator('#online-plugins-refresh').focus()
  assert.equal(await page.locator('#online-plugins-refresh').evaluate(element => element === document.activeElement), true)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ windows: 2, builtinPlugins: 4, onlinePlugins: 2, reads, errors, externalRequestsAllowed: false }))
} finally {
  release?.()
  await app?.close()
  for (const socket of ws.clients) socket.terminate()
  ws.close(); fixture.closeAllConnections()
  await new Promise(resolve => fixture.close(resolve))
}
