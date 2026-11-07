import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const { default: AxeBuilder } = require(process.env.AXE_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/@axe-core/playwright'))
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = [], warnings = [], requests = [], report = {}
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()) })
page.on('request', (request) => requests.push(request.url()))
await page.addInitScript(() => {
  window.previewSamples = []
  window.audioPlayCalls = 0
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) { window.audioPlayCalls++; return play.apply(this, args) }
  const speak = speechSynthesis.speak
  speechSynthesis.speak = function (...args) { window.audioPlayCalls++; return speak.apply(this, args) }
  window.addEventListener('message', ({ data }) => {
    if (data?.channel === 'control-desktop-pet-v1' && data.type === 'expression') {
      window.previewSamples.push(data)
      if (window.previewSamples.length > 1000) window.previewSamples.shift()
    }
  })
})
const frame = () => page.frames().find((item) => item.url().includes('/avatar.html'))
const state = (value) => page.waitForFunction((expected) =>
  document.querySelector('#preview-status').dataset.state === expected, value, { timeout: 120000 })
const latest = () => frame().evaluate(() => window.previewSamples.at(-1))
async function pixels() {
  return frame().evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
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
  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:5179/')
  await page.waitForFunction(() => document.querySelector('#model-status').textContent === '就绪', null, { timeout: 60000 })
  await page.locator('#preview-text').fill('[摇摇头][E:happy]你好，很高兴见到你。今天我们一起看看数字人的动作。')
  const response = page.waitForResponse((r) => r.url().endsWith('/api/previews') && r.status() === 200)
  await page.locator('#preview-play').click()
  await state('generating')
  const data = await (await response).json()
  await state('playing')
  assert.equal(data.behavior.head, 'shake')
  assert.equal(data.clip.provenance.engine, 'pytorch-original-tar')
  assert.equal(data.clip.provenance.checkpointSha256, '38084d471966381f2e52d9f59e5654c9b8cde6fa36d4c6f18fc02cbaf593d157')
  assert.ok(data.clip.captions.every((cue) => !/[\[\]<>]/.test(cue.text)))
  const first = await pixels()
  await page.waitForTimeout(1700)
  assert.notEqual(first.hash, (await pixels()).hash)
  const samples = await frame().evaluate(() => window.previewSamples.filter((item) => item.speaking))
  const jaw = samples.map((s) => s.weights.jawOpen)
  const yaw = samples.map((s) => s.pose.yaw)
  assert.ok(Math.max(...jaw) - Math.min(...jaw) > 0.05)
  assert.ok(Math.max(...yaw) - Math.min(...yaw) > 0.1)
  report.motion = { jawRange: [Math.min(...jaw), Math.max(...jaw)], yawRange: [Math.min(...yaw), Math.max(...yaw)] }
  report.pose = await frame().evaluate(() => JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics))
  assert.equal(report.pose.poseApplied, true)
  assert.equal(await page.locator('#speech-audio').evaluate((audio) => audio.paused && audio.currentTime === 0), true)
  await page.screenshot({ path: path.join(root, 'artifacts/preview-speaking.png') })
  await page.locator('#preview-play').click()
  await state('paused')
  const atPause = await page.locator('#preview-time').textContent()
  await page.waitForTimeout(200)
  assert.equal(await page.locator('#preview-time').textContent(), atPause)
  assert.equal((await latest()).weights.jawOpen || 0, 0)
  await page.locator('#preview-play').click()
  await state('playing')
  await page.locator('#collapse').click()
  await state('paused')
  await page.locator('#restore').click()
  await page.locator('#preview-play').click()
  await state('ended')
  assert.equal((await latest()).speaking, false)
  assert.ok(await frame().evaluate(() => window.previewSamples.some((s) => s.closing && s.pose?.owned)))
  await page.locator('#captions').uncheck()
  await page.locator('#captions').check()
  assert.equal(await page.locator('#caption-bubble').isVisible(), false, 'Finished preview must not resurrect the first caption')
  await page.locator('#preview-play').click()
  await state('playing')
  await page.locator('#preview-stop').click()
  await state('idle')
  report.lifecycle = 'pause/resume/collapse/replay/end closure/stop clear articulation'

  report.viewports = []
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 900 })
    await page.locator('#pet-reset').click()
    await page.locator('#preview-play').click()
    await state('playing')
    await page.waitForTimeout(250)
    const sample = await pixels()
    assert.ok(sample.visible > 500 && sample.transparent > 500 && sample.alpha)
    const layout = await page.evaluate(() => {
      const button = document.querySelector('#preview-play').getBoundingClientRect()
      const caption = document.querySelector('#caption-bubble').getBoundingClientRect()
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        buttonBottom: button.bottom, captionTop: caption.top, buttonRight: button.right, captionLeft: caption.left }
    })
    assert.ok(layout.scrollWidth <= width)
    assert.ok(layout.buttonRight <= layout.captionLeft || layout.buttonBottom <= layout.captionTop,
      `Preview controls overlap avatar caption: ${JSON.stringify(layout)}`)
    await page.screenshot({ path: path.join(root, `artifacts/preview-${width}.png`) })
    report.viewports.push({ ...layout, pixels: sample })
    await page.locator('#preview-stop').click()
  }
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(accessibility.violations.map((v) => v.id), [])
  await page.locator('#preview-text').fill('[H:invalid]你好。')
  await page.locator('#preview-play').click()
  await state('error')
  assert.match(await page.locator('#preview-status').textContent(), /标签/)
  await page.locator('#preview-text').fill('[H:nod]欢迎回来。')
  const secondResponse = page.waitForResponse((r) => r.url().endsWith('/api/previews') && r.status() === 200)
  await page.locator('#preview-play').click()
  const second = await (await secondResponse).json()
  await state('playing')
  assert.equal(second.behavior.head, 'nod')
  assert.notEqual(second.clip.provenance.audioSha256, data.clip.provenance.audioSha256)
  assert.notDeepEqual(second.clip.frames, data.clip.frames)
  await page.locator('#preview-text').fill('[微笑]修改后的台词。')
  await state('idle')
  assert.equal((await latest()).speaking, false)
  await page.route('**/api/previews', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await route.fulfill({ json: data }).catch(() => {})
  })
  await page.locator('#preview-play').click()
  await state('generating')
  await page.locator('#preview-stop').click()
  await page.waitForTimeout(700)
  await state('idle')
  assert.equal((await latest()).speaking, false)
  await page.locator('#preview-play').click()
  await state('generating')
  await page.locator('#preview-text').fill('再次修改台词。')
  await page.waitForTimeout(700)
  await state('idle')
  assert.equal((await latest()).speaking, false)
  await page.unroute('**/api/previews')
  report.failure = 'invalid tags rejected, corrected text regenerates actual TAR, edit/stop discard stale responses'
  assert.equal(await page.evaluate(() => window.audioPlayCalls), 0)
  assert.equal(requests.some((url) => /\.wav(?:$|\?)/.test(url)), false)
  assert.equal(requests.some((url) => /^https?:/.test(url) && !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)), false)
  assert.deepEqual(errors, [])
  assert.deepEqual(warnings, [])
  report.silence = 'zero media play/speechSynthesis calls, zero WAV requests, zero external requests'
  await writeFile(path.join(root, 'artifacts/preview-results.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(root, 'artifacts/preview-failure.png') }).catch(() => {})
  throw error
} finally {
  await browser.close()
}
