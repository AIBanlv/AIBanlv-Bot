import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
const warnings = []
const external = []
const report = {}
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()) })
page.on('request', (request) => {
  if (/^https?:/.test(request.url()) && !/^(127\.0\.0\.1|localhost)$/.test(new URL(request.url()).hostname)) external.push(request.url())
})
await page.addInitScript(() => {
  window.speechSamples = []
  window.addEventListener('message', ({ data }) => {
    if (data?.channel === 'control-desktop-pet-v1' && data.type === 'expression') {
      window.speechSamples.push(data)
      if (window.speechSamples.length > 500) window.speechSamples.shift()
    }
  })
})
const base = process.env.DEMO_URL || 'http://127.0.0.1:5178/'
const audio = () => page.locator('#speech-audio').evaluate((node) => ({ time: node.currentTime, paused: node.paused }))
const frame = () => page.frames().find((item) => item.url().includes('/avatar.html'))
async function ready() {
  await page.goto(base)
  await page.waitForFunction(() => document.querySelector('#model-status').textContent === '就绪', null, { timeout: 60000 })
}
try {
  await ready()
  let release, captured
  const arrived = new Promise((resolve) => { captured = resolve })
  await page.route('**/assets/speech.json', async (route) => {
    await new Promise((resolve) => { release = resolve; captured() })
    await route.continue()
  })
  await page.locator('#speech-play').click()
  await arrived
  await page.locator('#speech-stop').click()
  release()
  await page.waitForTimeout(800)
  assert.deepEqual(await audio(), { time: 0, paused: true }, 'Pending loading must not restart stopped audio')
  await page.unroute('**/assets/speech.json')
  await page.locator('#speech-play').click()
  await page.waitForFunction(() => document.querySelector('#speech-audio').currentTime > 2)
  const samples = await frame().evaluate(() => window.speechSamples.filter((sample) => sample.speaking))
  const jaw = samples.map((sample) => sample.weights.jawOpen)
  assert.ok(jaw.length > 10 && Math.max(...jaw) - Math.min(...jaw) > 0.05)
  report.jawOpenRange = [Math.min(...jaw), Math.max(...jaw)]
  await page.locator('#speech-play').click()
  await page.waitForTimeout(100)
  assert.deepEqual(await frame().evaluate(() => window.speechSamples.at(-1).weights), {})
  await page.locator('#expression').selectOption('smile')
  await page.waitForTimeout(100)
  assert.ok(await frame().evaluate(() => window.speechSamples.at(-1).weights.mouthSmileLeft > 0))
  await page.locator('#expression').selectOption('natural')

  await page.setViewportSize({ width: 320, height: 740 })
  await page.mouse.wheel(0, -4000)
  await page.locator('#speech-play').click()
  await page.waitForFunction(() => !document.querySelector('#speech-audio').paused)
  await page.screenshot({ path: path.join(root, 'artifacts/mobile-speaking.png') })
  await page.locator('#expression').selectOption('surprise')
  await page.locator('#speech-stop').click()
  assert.equal((await audio()).paused, true)
  report.mobile = 'speech and expression controls usable at 320px'

  await page.setViewportSize({ width: 1440, height: 900 })
  for (const kind of ['missing', 'mismatched']) {
    await page.route('**/assets/speech.json', async (route) => {
      if (kind === 'missing') await route.fulfill({ status: 404, body: 'Missing test speech' })
      else {
        const response = await route.fetch()
        const clip = await response.json()
        clip.provenance.audioSha256 = 'mismatched'
        await route.fulfill({ json: clip })
      }
    })
    await ready()
    await page.locator('#speech-play').click()
    await page.waitForFunction(() => document.querySelector('#speech-label').textContent === '重试语音')
    assert.equal((await audio()).paused, true)
    assert.match(await page.locator('#speech-status').textContent(), kind === 'missing' ? /缺少语音资源/ : /不匹配/)
    await page.unroute('**/assets/speech.json')
    await page.locator('#speech-play').click()
    await page.waitForFunction(() => document.querySelector('#speech-audio').currentTime > 0.2)
    await page.locator('#speech-stop').click()
  }
  report.lifecycle = 'pending-load stop, changing real jaw coefficients, neutral reset, missing/hash-mismatch retry passed'
  assert.deepEqual(errors, [])
  assert.deepEqual(warnings, [])
  assert.deepEqual(external, [])
  report.pageErrors = errors
  await mkdir(path.join(root, 'artifacts'), { recursive: true })
  await writeFile(path.join(root, 'artifacts/speech-results.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
