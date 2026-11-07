import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const { default: AxeBuilder } = require(process.env.AXE_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/@axe-core/playwright'))
const output = path.join(root, 'artifacts')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true })
const page = await context.newPage()
const errors = []
const warnings = []
const external = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
  if (message.type() === 'warning') warnings.push(message.text())
})
page.on('request', (request) => {
  if (/^https?:/.test(request.url()) && !new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) external.push(request.url())
})
const results = {}

async function pixels() {
  return page.frames().find((frame) => frame.url().includes('/avatar.html')).evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => {
      const canvas = document.querySelector('canvas')
      const gl = canvas.getContext('webgl2')
      const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data)
      let visible = 0, transparent = 0, hash = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 10) visible++
        else transparent++
        hash = (hash * 31 + data[i] + data[i + 1] + data[i + 2]) >>> 0
      }
      resolve({ visible, transparent, hash, alpha: gl.getContextAttributes().alpha, width: canvas.width, height: canvas.height })
    })
  }))
}

try {
  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:5178/')
  await page.waitForFunction(() => document.querySelector('#model-status').textContent === '就绪', null, { timeout: 60000 })
  await page.screenshot({ path: path.join(output, 'desktop-initial.png') })
  results.firstFrame = await pixels()
  assert.equal(results.firstFrame.alpha, true)
  assert.ok(results.firstFrame.visible > 1000, JSON.stringify(results.firstFrame))
  assert.ok(results.firstFrame.transparent > 1000, 'Canvas background must be transparent')
  await page.waitForTimeout(800)
  results.secondFrame = await pixels()
  assert.notEqual(results.firstFrame.hash, results.secondFrame.hash, 'Avatar must animate')
  await page.waitForTimeout(1200)
  const settled = await pixels()
  await page.waitForTimeout(800)
  assert.notEqual(settled.hash, (await pixels()).hash, 'Animation must continue after the initial reveal')
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(accessibility.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })), [])
  results.accessibility = 'WCAG 2.1 AA automated checks passed'
  await page.locator('#speech-play').click({ timeout: 3000 })
  await page.waitForFunction(() => document.querySelector('#speech-audio')?.currentTime > 0.4)
  const audioStart = await page.locator('#speech-audio').evaluate((audio) => ({
    time: audio.currentTime, muted: audio.muted, volume: audio.volume, paused: audio.paused,
  }))
  assert.equal(audioStart.muted, false)
  assert.ok(audioStart.volume > 0 && !audioStart.paused)
  const speechPixels = await pixels()
  await page.screenshot({ path: path.join(output, 'speaking-natural.png') })
  await page.waitForTimeout(600)
  assert.notEqual(speechPixels.hash, (await pixels()).hash)
  await page.locator('#speech-play').click()
  const pausedAt = await page.locator('#speech-audio').evaluate((audio) => audio.currentTime)
  await page.waitForTimeout(300)
  assert.equal(await page.locator('#speech-audio').evaluate((audio) => audio.currentTime), pausedAt)
  await page.locator('#expression').selectOption('smile')
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(output, 'expression-smile.png') })
  await page.locator('#expression').selectOption('surprise')
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(output, 'expression-surprise.png') })
  await page.locator('#expression').selectOption('natural')
  await page.locator('#speech-play').click()
  await page.waitForFunction(() => !document.querySelector('#speech-audio').paused)
  await page.locator('#collapse').click()
  assert.equal(await page.locator('#speech-audio').evaluate((audio) => audio.paused), true)
  await page.locator('#restore').click()
  await page.locator('#speech-stop').click()
  assert.equal(await page.locator('#speech-audio').evaluate((audio) => audio.currentTime), 0)
  await page.locator('#speech-play').click()
  await page.waitForFunction(() => document.querySelector('#speech-audio').ended, null, { timeout: 20000 })
  assert.equal(await page.locator('#speech-status').textContent(), '播放结束')
  await page.locator('#speech-play').click()
  await page.waitForFunction(() => document.querySelector('#speech-audio').currentTime > 0.2)
  await page.locator('#play').click()
  assert.equal(await page.locator('#speech-audio').evaluate((audio) => audio.paused), true)
  await page.locator('#play').click()
  results.speech = 'audible media clock, pause/resume/stop/end/replay, presets, collapse and caption mutual exclusion passed'
  assert.ok(await page.locator('#drag-surface').getAttribute('aria-label'))
  await page.locator('#note').fill('A usable host page')

  const start = await page.locator('#pet').boundingBox()
  const handle = await page.locator('#drag-surface').boundingBox()
  const beforeCaption = await page.locator('#caption').textContent()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 - 180, handle.y + handle.height / 2 - 100, { steps: 12 })
  await page.mouse.up()
  const end = await page.locator('#pet').boundingBox()
  assert.ok(end.x < start.x - 150)
  assert.equal(await page.locator('#caption').textContent(), beforeCaption, 'Drag must not advance caption')
  await page.locator('#drag-surface').press('ArrowLeft')
  assert.ok((await page.locator('#pet').boundingBox()).x < end.x)
  await page.locator('#collapse').click()
  assert.equal(await page.locator('#pet').isVisible(), false)
  await page.locator('#restore').click()
  assert.equal(await page.locator('#pet').isVisible(), true)
  await page.locator('#captions').uncheck()
  assert.equal(await page.locator('#caption-bubble').isVisible(), false)
  await page.locator('#captions').check()
  await page.locator('#script').fill('<script>alert(1)</script>\n这是第二句演示字幕。')
  assert.equal(await page.locator('#caption script').count(), 0)
  assert.equal(await page.locator('#caption').textContent(), '<script>alert(1)</script>')
  await page.locator('#play').click()
  await page.waitForFunction(() => document.querySelector('#caption').textContent === '这是第二句演示字幕。')
  await page.locator('#play').click()
  assert.equal(await page.locator('#playback-status').textContent(), '已暂停')
  await page.locator('#script').fill('你好，很高兴见到你。\n今天也一起，把重要的事情慢慢做好吧。')
  results.interactions = 'mouse drag, keyboard, collapse/restore, captions toggle, text safety and playback passed'

  results.viewports = []
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 900 })
    await page.locator('#reset').click()
    await page.mouse.move(4, 4)
    await page.mouse.wheel(0, -3000)
    await page.waitForFunction(() => window.scrollY === 0)
    const geometry = await page.evaluate(() => {
      const pet = document.querySelector('#pet').getBoundingClientRect()
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, x: pet.x, y: pet.y, right: pet.right, bottom: pet.bottom }
    })
    assert.ok(geometry.scrollWidth <= width)
    assert.ok(geometry.x >= 0 && geometry.y >= 0 && geometry.right <= width && geometry.bottom <= geometry.height, JSON.stringify(geometry))
    const sample = await pixels()
    assert.ok(sample.visible > 500 && sample.transparent > 500, JSON.stringify(sample))
    await page.screenshot({ path: path.join(output, `viewport-${width}.png`) })
    results.viewports.push({ ...geometry, pixels: sample })
  }
  await page.setViewportSize({ width: 320, height: 740 })
  await page.locator('#pet-reset').click()
  const touchHandle = await page.locator('#drag-surface').boundingBox()
  const touchStart = await page.locator('#pet').boundingBox()
  const cdp = await context.newCDPSession(page)
  const touchPoint = { x: touchHandle.x + touchHandle.width / 2, y: touchHandle.y + touchHandle.height / 2 }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchPoint.x - 50, y: touchPoint.y - 120 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  assert.ok((await page.locator('#pet').boundingBox()).y < touchStart.y - 90)
  await page.locator('#collapse').click()
  await page.locator('#script').fill('你好'.repeat(200))
  await page.locator('#restore').click()
  const captionGeometry = await page.locator('#caption-bubble').evaluate((node) => ({
    height: node.offsetHeight, slotHeight: node.parentElement.offsetHeight, scroll: node.scrollWidth, width: node.clientWidth,
  }))
  assert.ok(captionGeometry.height <= captionGeometry.slotHeight - 12, JSON.stringify(captionGeometry))
  assert.ok(captionGeometry.scroll <= captionGeometry.width)
  const scrollPosition = await page.locator('#pet').boundingBox()
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(300)
  assert.equal(Math.round((await page.locator('#pet').boundingBox()).y), Math.round(scrollPosition.y))
  await page.screenshot({ path: path.join(output, 'mobile-touch.png') })
  results.touch = 'touch drag, long captions and fixed position during scrolling passed'
  await page.setViewportSize({ width: 568, height: 320 })
  await page.waitForFunction(() => {
    const box = document.querySelector('#pet').getBoundingClientRect()
    return box.y >= 0 && box.bottom <= innerHeight
  })
  const landscape = await page.locator('#pet').boundingBox()
  assert.ok(landscape.y >= 0 && landscape.y + landscape.height <= 320, JSON.stringify(landscape))
  await page.screenshot({ path: path.join(output, 'landscape.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  assert.deepEqual(external, [])
  assert.deepEqual(errors, [])
  await page.route('**/assets/avatar.zip', (route) => route.fulfill({ status: 404, body: 'Missing test asset' }))
  await page.reload()
  await page.waitForFunction(() => document.querySelector('#model-status').textContent === '加载失败')
  assert.equal(await page.locator('#retry').isVisible(), true)
  await page.unroute('**/assets/avatar.zip')
  await page.locator('#retry').click()
  await page.locator('#collapse').click()
  await page.waitForTimeout(300)
  await page.locator('#restore').click()
  await page.waitForFunction(() => document.querySelector('#model-status').textContent === '就绪', null, { timeout: 60000 })
  assert.ok((await pixels()).visible > 500)
  results.retry = 'expected asset failure shown; retry and collapse during startup recovered'
  results.expectedFailureErrors = errors.splice(0)
  assert.deepEqual(results.expectedFailureErrors.filter((message) => !/404|AxiosError|Renderer initialization failed/.test(message)), [])
  results.warnings = warnings
  results.errors = errors
  assert.deepEqual(warnings, [])
  await writeFile(path.join(output, 'browser-results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(JSON.stringify({ errors, warnings, external, results }, null, 2))
  throw error
} finally {
  await browser.close()
}
