import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = [], warnings = [], external = []
const report = {}
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()) })
page.on('request', (request) => {
  if (/^https?:/.test(request.url()) && !/^(localhost|127\.0\.0\.1)$/.test(new URL(request.url()).hostname)) external.push(request.url())
})
await page.addInitScript(() => {
  window.controlSamples = []
  window.addEventListener('message', ({ data }) => {
    if (data?.channel === 'control-desktop-pet-v1' && data.type === 'expression') {
      window.controlSamples.push(data)
      if (window.controlSamples.length > 500) window.controlSamples.shift()
    }
  })
})
const base = process.env.DEMO_URL || 'http://127.0.0.1:5179/'
const frame = () => page.frames().find((item) => item.url().includes('/avatar.html'))
const latest = () => frame().evaluate(() => window.controlSamples.at(-1))
const time = () => page.locator('#speech-audio').evaluate((audio) => audio.currentTime)
const pixels = () => frame().evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
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
try {
  await page.goto(base)
  await page.waitForFunction(() => document.querySelector('#model-status').textContent === '就绪', null, { timeout: 60000 })
  assert.equal(await page.locator('#postprocess').isChecked({ timeout: 3000 }), true)
  await page.locator('#speech-play').click()
  await page.waitForFunction(() => document.querySelector('#speech-audio').currentTime > 1)
  assert.equal((await latest()).pipeline, 'ios-expression-v1-2e75b5f')
  assert.equal((await latest()).pose.owned, true)
  const diagnostics = await frame().evaluate(() => JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics))
  assert.equal(diagnostics.installed, true)
  assert.equal(diagnostics.poseApplied, true)
  report.pose = diagnostics
  report.desktopPixels = await pixels()
  assert.ok(report.desktopPixels.visible > 1000 && report.desktopPixels.transparent > 1000 && report.desktopPixels.alpha)
  await page.waitForTimeout(400)
  assert.notEqual(report.desktopPixels.hash, (await pixels()).hash)
  await page.screenshot({ path: path.join(root, 'artifacts/control-on.png') })
  const before = await time()
  await page.locator('#postprocess').uncheck()
  await page.waitForTimeout(120)
  assert.equal((await latest()).pipeline, 'raw')
  assert.ok(await time() >= before)
  await page.screenshot({ path: path.join(root, 'artifacts/control-off.png') })
  await page.locator('#postprocess').check()
  await page.locator('#expression').selectOption('surprise')
  await page.waitForTimeout(250)
  assert.equal((await latest()).pipeline, 'ios-expression-v1-2e75b5f')
  await page.screenshot({ path: path.join(root, 'artifacts/control-surprise.png') })
  await page.locator('#speech-play').click()
  await page.waitForTimeout(100)
  assert.equal((await latest()).speaking, false)
  assert.equal((await latest()).weights.jawOpen || 0, 0)
  await page.locator('#speech-play').click()
  await page.waitForFunction(() => document.querySelector('#speech-audio').ended, null, { timeout: 20000 })
  await page.waitForTimeout(1200)
  const all = await frame().evaluate(() => window.controlSamples)
  assert.ok(all.some((sample) => sample.closing && sample.pose?.owned))
  assert.equal((await latest()).pose, null)
  await page.setViewportSize({ width: 320, height: 740 })
  await page.mouse.wheel(0, -4000)
  await page.locator('#postprocess').uncheck()
  await page.locator('#postprocess').check()
  await page.locator('#speech-play').click()
  await page.waitForFunction(() => document.querySelector('#speech-audio').currentTime > 0.2)
  await page.screenshot({ path: path.join(root, 'artifacts/control-mobile.png') })
  report.mobilePixels = await pixels()
  assert.ok(report.mobilePixels.visible > 500 && report.mobilePixels.transparent > 500 && report.mobilePixels.alpha)
  await page.locator('#speech-stop').click()
  report.playback = 'A/B preserves audio clock; pause clears articulation; completion plays Control closure; mobile toggle works'

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/assets/speech-control.json', (route) => route.fulfill({ status: 404, body: 'Missing test bank' }))
  await page.reload()
  await page.waitForFunction(() => document.querySelector('#model-status').textContent === '就绪', null, { timeout: 60000 })
  await page.locator('#speech-play').click()
  await page.waitForFunction(() => document.querySelector('#speech-label').textContent === '重试语音')
  assert.equal(await page.locator('#speech-audio').evaluate((audio) => audio.paused), true)
  await page.unroute('**/assets/speech-control.json')
  await page.locator('#speech-play').click()
  await page.waitForFunction(() => document.querySelector('#speech-audio').currentTime > 0.2)
  assert.equal((await latest()).pipeline, 'ios-expression-v1-2e75b5f')
  await page.locator('#speech-stop').click()
  await page.route('**/assets/speech-control.json', async (route) => {
    const response = await route.fetch()
    const data = await response.json()
    data.sourceSha256 = 'b'.repeat(64)
    await route.fulfill({ json: data })
  })
  await page.reload()
  await page.waitForFunction(() => document.querySelector('#model-status').textContent === '就绪', null, { timeout: 60000 })
  await page.locator('#speech-play').click()
  await page.waitForFunction(() => document.querySelector('#speech-label').textContent === '重试语音')
  assert.match(await page.locator('#speech-status').textContent(), /不匹配/)
  await page.locator('#postprocess').uncheck()
  await page.locator('#speech-play').click()
  await page.waitForFunction(() => document.querySelector('#speech-audio').currentTime > 0.2)
  assert.equal((await latest()).pipeline, 'raw')
  await page.locator('#speech-stop').click()
  await page.unroute('**/assets/speech-control.json')
  assert.deepEqual(errors, [])
  assert.deepEqual(warnings, [])
  assert.deepEqual(external, [])
  report.errors = errors
  report.failure = 'Missing/hash-mismatched Control resource blocks playback; retry recovers; explicit raw mode remains available'
  await writeFile(path.join(root, 'artifacts/control-results.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
