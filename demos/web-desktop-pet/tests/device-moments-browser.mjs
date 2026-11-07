import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createTextServer, resolveTextFiles } from '../electron/text-server.mjs'

const require = createRequire(import.meta.url), root = process.cwd()
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const files = resolveTextFiles(), main = await readFile('electron/device-main.mjs', 'utf8')
for (const match of main.match(/for \(const name of \[([\s\S]*?)\]\) \{\s*files\.set\(`\/device\//)[1].matchAll(/'([^']+)'/g)) files.set(`/device/${match[1]}`, path.join(root, 'electron', match[1]))
files.set('/desktop/desktop.css', path.join(root, 'electron/desktop.css'))
files.set('/device/logo.png', path.resolve(root, '../../static/aibanlv-logo.png'))
const server = createTextServer(files, { accessToken: 'moments-fixture' })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const imageUrl = 'https://zhanlvgpt.ieasysell.com/tenant/moments/user/fixture.jpg'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4V0AAAAASUVORK5CYII=', 'base64')
let browser, reads = 0, uploads = 0, release, failure = false
const writes = [], state = { binding: 'bound', connection: 'connected', accountScope: 'account-A', desktopMomentsSupported: true,
  roles: [{ agentId: 'waner', agentName: '小舞' }] }
const post = id => ({ id: id.repeat(64), authorName: '小舞', content: '真实接口夹具 <script>alert(1)</script>', comments: [],
  media: [{ type: 'image', url: imageUrl }, { type: 'video', url: imageUrl.replace('.jpg', '.mp4') }] })
const methods = {
  state: () => state,
  desktopAction: (operation, payload) => {
    if (operation === 'moments_roles') return { ok: true, data: [{ id: 'waner', name: '小舞' }] }
    if (operation === 'moments_feed') { reads++; return { ok: true, data: { records: [post(payload.cursor ? 'b' : 'a')], hasMore: !payload.cursor, nextCursor: payload.cursor ? '' : 'fixture-cursor' } } }
    writes.push({ operation, payload }); return failure ? { ok: false, code: 'TIMEOUT' } : { ok: true, data: true }
  },
  uploadMomentMedia: value => { uploads++; assert.equal(value.extension, 'jpg'); return new Promise(resolve => { release = () => resolve({ ok: true, data: { type: 'image', url: imageUrl } }) }) },
}
const output = path.join(root, 'artifacts/moments-browser'); await mkdir(output, { recursive: true })
try {
  const executablePath = process.env.SETTINGS_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync)
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'msedge' }), headless: true })
  const context = await browser.newContext({ viewport: { width: 960, height: 780 }, extraHTTPHeaders: { 'X-Pet-Token': 'moments-fixture' } })
  await context.exposeBinding('invokeMomentFixture', (_source, name, args) => methods[name](...args))
  await context.addInitScript(() => {
    window.momentStateListeners = []
    window.controlDevice = { state: () => window.invokeMomentFixture('state', []),
      onState: callback => { window.momentStateListeners.push(callback); return () => {} },
      desktopAction: (...args) => window.invokeMomentFixture('desktopAction', args),
      uploadMomentMedia: (...args) => window.invokeMomentFixture('uploadMomentMedia', args) }
  })
  // Isolate just the real moments module; the full settings regression covers the other editors.
  await context.route('**/device/device-view.mjs', route => route.fulfill({ contentType: 'text/javascript', body: "import './device-moments-view.mjs';import {installTranslations} from './device-i18n.mjs';installTranslations();" }))
  await context.route('https://zhanlvgpt.ieasysell.com/**', route => route.fulfill({ contentType: 'image/png', body: png }))
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin + '/device/device.html')
  const emit = () => page.evaluate(state => { for (const callback of window.momentStateListeners) callback(state) }, state)
  const activate = async () => { await page.evaluate(() => {
    for (const node of document.querySelectorAll('[data-settings-page]')) node.hidden = node.dataset.settingsPage !== 'ai-moments'
    window.dispatchEvent(new CustomEvent('settings-page', { detail: 'ai-moments' }))
  }) }
  await page.waitForFunction(() => document.querySelectorAll('.moment-card').length === 1)
  assert.equal(reads, 1, 'One initial authenticated preview supplies the menu portrait')
  await activate()
  await page.waitForFunction(() => document.querySelectorAll('.moment-card').length === 1)
  assert.equal(await page.locator('#moments-feed script').count(), 0)
  assert.equal(await page.locator('video').count(), 0, 'Video tiles must not eagerly create players')
  await page.locator('#moments-more').click()
  await page.waitForFunction(() => document.querySelectorAll('.moment-card').length === 2)
  await page.locator('.moments-media button').first().click()
  assert.equal(await page.locator('#moments-media-dialog').isVisible(), true)
  await page.locator('#moments-media-close').click()
  await page.locator('#moments-new').click()
  await page.locator('#moments-content').fill('草稿保留')
  const imageData = await page.evaluate(() => { const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);return canvas.toDataURL('image/png').split(',')[1] })
  await page.locator('#moments-image-files').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(imageData,'base64') })
  for (let attempt=0; !release && attempt<100; attempt++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(release, `Selected image should reach upload: ${await page.locator('#moments-status').textContent()}`)
  assert.equal(await page.locator('#moments-publish').isDisabled(), true)
  release()
  await page.waitForFunction(() => document.querySelectorAll('#moments-media-draft img').length === 1)
  assert.equal(uploads, 1)
  failure = true; await page.locator('#moments-publish').click()
  await page.waitForFunction(() => document.querySelector('#moments-status').textContent.includes('结果未确认'))
  const originalId = writes.at(-1).payload.requestId
  assert.equal(await page.locator('#moments-content').inputValue(), '草稿保留')
  assert.equal(writes.at(-1).payload.media[0].url, imageUrl)
  await page.locator('#moments-publish').click()
  await page.waitForFunction(() => !document.querySelector('#moments-publish').disabled)
  assert.equal(writes.at(-1).payload.requestId, originalId)
  for (const width of [320, 650, 960]) {
    await page.setViewportSize({ width, height: 780 })
    assert.equal(await page.locator('.settings-workspace').evaluate(node => node.scrollWidth <= node.clientWidth), true)
    await page.screenshot({ path: path.join(output, `moments-editor-${width}.png`) })
  }
  await page.setViewportSize({width:320,height:560})
  assert.equal(await page.locator('#account-menu').evaluate(node=>node.getBoundingClientRect().bottom<=innerHeight),true,'The added menu must not push account controls out of a short window')
  assert.equal(await page.locator('.settings-workspace').evaluate(node=>node.scrollWidth<=node.clientWidth),true)
  for (const locale of ['en', 'ja', 'zh-Hant', 'zh-Hans']) {
    await page.evaluate(async locale => { const { setLanguage } = await import('/device/device-i18n.mjs'); setLanguage(locale) }, locale)
    assert.ok((await page.locator('#moments-publish').textContent()).length)
    const name = { en: 'AI Advisory Council', ja: 'AIアドバイザーチーム', 'zh-Hant': 'AI智囊團', 'zh-Hans': 'AI智囊团' }[locale]
    assert.equal(await page.locator('#ai-moments h2').textContent(), name)
    assert.equal(await page.locator('[data-section="ai-moments"] .nav-text').textContent(), name)
    assert.equal(await page.locator('[data-section="ai-moments"]').getAttribute('aria-label'), name)
    assert.ok((await page.locator('#moments-description').textContent()).length > 20)
  }
  const description = '主动式 AI 顾问系统，根据日常互动内容，AI主动讨论并找到解决方案'
  assert.equal(await page.locator('#moments-description').textContent(), description)
  await page.locator('#moments-about').click()
  assert.equal(await page.locator('#moments-about-panel > p').first().textContent(), description)
  await page.locator('#moments-about-back').click()
  state.accountScope = 'account-B'; await emit()
  assert.equal(await page.locator('#moments-content').inputValue(), '')
  assert.equal(await page.locator('#moments-media-draft img').count(), 0)
  state.desktopMomentsSupported = false; await emit()
  assert.equal(await page.locator('#moments-new').isDisabled(), true)
  assert.match(await page.locator('#moments-status').textContent(), /更新后端/)
  assert.deepEqual(errors, [])
  console.log('PASS: moments pagination, safe text/media preview, chosen image compression/upload, draft/idempotency retention, account clearing, capability gating, four languages and 320/650/960 layouts')
} finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
