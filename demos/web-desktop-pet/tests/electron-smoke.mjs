import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const { default: AxeBuilder } = require(process.env.AXE_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/@axe-core/playwright'))
const artifacts = path.join(root, 'artifacts/electron')
await mkdir(artifacts, { recursive: true })
const env = { ...process.env, PET_DESKTOP_USER_DATA: path.join(artifacts, `profile-${Date.now()}`) }
delete env.ELECTRON_RUN_AS_NODE
const packaged = process.env.PET_PACKAGED_EXE
const application = await _electron.launch({
  executablePath: packaged || require('electron'), args: packaged ? [] : [root], env, timeout: 60000,
})
const errors = [], warnings = [], external = []
let control, pet
const report = {}
const state = (value) => control.waitForFunction((expected) =>
  document.querySelector('#preview-status').dataset.state === expected, value, { timeout: 120000 })
const windows = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => ({
  title: win.getTitle(), bounds: win.getBounds(), visible: win.isVisible(), pinned: win.isAlwaysOnTop(),
  preferences: win.webContents.getLastWebPreferences(),
})))
async function pixels() {
  return pet.frames().find((frame) => frame.url().includes('/avatar.html')).evaluate(() =>
    new Promise((resolve) => requestAnimationFrame(() => {
      const gl = document.querySelector('canvas').getContext('webgl2')
      const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data)
      let visible = 0, transparent = 0, hash = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 10) visible++
        else transparent++
        hash = (hash * 31 + data[i] + data[i + 1] + data[i + 2]) >>> 0
      }
      resolve({ visible, transparent, hash, alpha: gl.getContextAttributes().alpha })
    })))
}
try {
  await application.firstWindow()
  for (let i = 0; i < 100 && application.windows().length < 2; i++) await new Promise((r) => setTimeout(r, 100))
  for (const page of application.windows()) {
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()) })
    page.on('request', (request) => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url())
    })
    await page.waitForLoadState()
    if (page.url().includes('controller.html')) control = page
    if (page.url().includes('pet.html')) pet = page
  }
  assert.ok(control && pet, 'Controller and pet windows must both open')
  await control.waitForFunction(() => document.querySelector('#model-status').textContent === '就绪', null, { timeout: 60000 })
  const win = await windows()
  assert.equal(win.length, 2)
  for (const item of win) {
    assert.equal(item.preferences.contextIsolation, true)
    assert.equal(item.preferences.sandbox, true)
    assert.equal(item.preferences.nodeIntegration, false)
  }
  assert.equal(await control.evaluate(() => typeof window.require), 'undefined')
  assert.equal((await fetch(control.url())).status, 403, 'A browser outside Electron must not access the private server')
  report.firstPixels = await pixels()
  assert.ok(report.firstPixels.alpha && report.firstPixels.visible > 1000 && report.firstPixels.transparent > 1000)
  await control.waitForTimeout(600)
  assert.notEqual(report.firstPixels.hash, (await pixels()).hash)
  await control.screenshot({ path: path.join(artifacts, 'controller.png') })
  await pet.screenshot({ path: path.join(artifacts, 'pet.png'), omitBackground: true })
  // Electron cannot create a browser tab for axe aggregation; this controller has no frames.
  const axe = await new AxeBuilder({ page: control }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(axe.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })), [])
  await control.locator('#preview-text').fill('[摇头][微笑]你好，很高兴见到你。今天我们一起看看数字人的动作。')
  const response = control.waitForResponse((r) => r.url().endsWith('/api/previews') && r.status() === 200)
  await control.locator('#preview-play').click()
  const data = await (await response).json()
  await state('playing')
  assert.equal(data.clip.provenance.engine, 'pytorch-original-tar')
  assert.equal(data.behavior.head, 'shake')
  await pet.waitForFunction(() => document.querySelector('#caption').textContent.includes('你好'))
  assert.doesNotMatch(await pet.locator('#caption').textContent(), /\[|\]/)
  await control.waitForTimeout(900)
  report.speakingPixels = await pixels()
  assert.notEqual(report.firstPixels.hash, report.speakingPixels.hash)
  report.pose = await pet.frames().find((f) => f.url().includes('/avatar.html'))
    .evaluate(() => JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics))
  assert.equal(report.pose.poseApplied, true)
  assert.equal(await control.locator('#speech-audio').evaluate((audio) => audio.paused && audio.currentTime === 0), true)
  await pet.screenshot({ path: path.join(artifacts, 'pet-speaking.png'), omitBackground: true })
  await control.locator('#preview-play').click()
  await state('paused')
  await control.locator('#preview-play').click()
  await state('playing')
  await state('ended')
  await control.locator('#visible').uncheck()
  await control.waitForTimeout(100)
  assert.equal((await windows()).find((w) => w.title.includes('桌面数字人')).visible, false)
  await control.locator('#visible').check()
  await control.locator('#pinned').uncheck()
  await control.waitForTimeout(100)
  assert.equal((await windows()).find((w) => w.title.includes('桌面数字人')).pinned, false)
  await control.locator('#pinned').check()
  await control.locator('#click-through').check()
  assert.equal(await control.evaluate(async () => (await window.desktopPet.status()).clickThrough), true)
  await control.locator('#click-through').uncheck()
  await control.locator('#size').fill('380')
  await control.waitForTimeout(250)
  assert.equal((await windows()).find((w) => w.title.includes('桌面数字人')).bounds.width, 380)
  await control.locator('#size').fill('240')
  await control.waitForTimeout(250)
  report.smallPixels = await pixels()
  assert.ok(report.smallPixels.visible > 500 && report.smallPixels.transparent > 500)
  await pet.screenshot({ path: path.join(artifacts, 'pet-small.png'), omitBackground: true })
  const before = (await windows()).find((w) => w.title.includes('桌面数字人')).bounds
  await pet.locator('#drag-surface').press('ArrowLeft')
  await control.waitForTimeout(100)
  const after = (await windows()).find((w) => w.title.includes('桌面数字人')).bounds
  assert.equal(after.x, before.x - 10)
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('控制台')).close())
  await pet.locator('#controller').click()
  await control.waitForTimeout(100)
  assert.equal((await windows()).find((w) => w.title.includes('控制台')).visible, true)
  report.lifecycle = 'two isolated windows, pin/show/click-through/size, native keyboard movement, close-to-tray and restore passed'
  assert.deepEqual(errors, [])
  assert.deepEqual(warnings, [])
  assert.deepEqual(external, [])
  report.packaged = Boolean(packaged)
  await writeFile(path.join(artifacts, packaged ? 'packaged-results.json' : 'results.json'), JSON.stringify(report, null, 2))
  const closed = application.waitForEvent('close')
  await control.locator('#quit').click()
  await closed
  await assert.rejects(fetch(control.url()))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  await control?.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {})
  console.error({ errors, warnings, external })
  throw error
} finally {
  await application.close().catch(() => {})
}
