import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { createInstallerBlockmap } from '../electron/device-update-blockmap.mjs'
import { saveBaseline } from '../electron/device-update-delta.mjs'
import { verifySourceUpdate } from './device-update-source-electron.mjs'
import { runtimeCacheDirectory } from '../scripts/source-runtime.mjs'

const require = createRequire(import.meta.url), root = process.cwd()
const applicationVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const { WebSocketServer } = require('ws')
const artifacts = path.join(root, 'artifacts/windows-update')
await mkdir(artifacts, { recursive: true })
const profile = await mkdtemp(path.join(artifacts, 'profile-'))
const fixtureDirectory = await mkdtemp(path.join(artifacts, 'delta-fixture-'))
const oldPayload = randomBytes(1024 ** 2), nextPayload = Buffer.from(oldPayload)
nextPayload.fill(0x66, 500000, 502048)
await writeFile(path.join(fixtureDirectory, 'next-fixture.bin'), nextPayload)
await createInstallerBlockmap(path.join(fixtureDirectory, 'next-fixture.bin'))
await writeFile(path.join(fixtureDirectory, 'old-fixture.bin'), oldPayload)
const oldBlockmap = await createInstallerBlockmap(path.join(fixtureDirectory, 'old-fixture.bin'))
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
await new Promise(resolve => server.once('listening', resolve))
server.on('connection', socket => socket.on('message', raw => {
  const message = JSON.parse(raw)
  if (message.type === 'device_online') socket.send(JSON.stringify({ type: 'bind_offer', deviceId: message.deviceId,
    bindToken: 'update-fixture-only', expireAt: Date.now() + 900000, bound: false }))
  if (message.type === 'ping') socket.send('{"type":"pong"}')
}))
let electron
const errors = [], failures = []
try {
  const env = { ...process.env, PET_DEVICE_USER_DATA: profile, WORKBUDDY_CONFIG_DIR: path.join(profile, 'workbuddy'),
    PET_CONTROL_WS_URL: `ws://127.0.0.1:${server.address().port}/ws/control`, PET_DESKTOP_UPDATE_URL: 'https://updates.example.test/latest.json',
    ...(process.env.DEVICE_SOURCE_RUNTIME_CHECK === '1' ? {} : { PET_PYTHON: path.join(profile, 'no-python'), PET_LAM_SOURCE: path.join(profile, 'no-model') }),
    PET_TEST_UPDATE_DELTA: fixtureDirectory }
  delete env.ELECTRON_RUN_AS_NODE
  electron = await _electron.launch({ executablePath: require('electron'),
    args: ['--disable-gpu', '--in-process-gpu', `--user-data-dir=${profile}`, path.join(root, 'tests/device-update-bootstrap.mjs')], env, timeout: 30000 })
  electron.process().stderr.on('data', chunk => process.stderr.write(chunk))
  await electron.firstWindow()
  let page
  const deadline = Date.now() + 15000
  while (!(page = electron.windows().find(page => page.url().endsWith('/device/device.html')))) {
    assert.ok(Date.now() < deadline, 'settings window did not load')
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => { if (response.status() >= 400) failures.push(response.url()) })
  await page.waitForFunction(() => window.controlDevice && document.querySelector('#account-update')?.onclick)
  if (process.env.DEVICE_SOURCE_RUNTIME_CHECK === '1') {
    const result = await electron.evaluate(async (_electron, cacheDirectory) => {
      const engine = await globalThis.createRuntimeFixtureEngine(AbortSignal.timeout(150000), { cacheDirectory })
      try {
        await engine.reset()
        const frames = await engine.infer(Buffer.alloc(102400))
        await engine.process(frames, 24000); await engine.finish()
        return { python: process.env.PET_PYTHON, javac: process.env.JAVAC, frames: frames.length, channels: frames[0].length,
          engine: engine.provenance.engine }
      } finally { await engine.dispose() }
    }, path.join(profile, 'lam-cache'))
    assert.ok(result.javac.startsWith(runtimeCacheDirectory() + path.sep))
    if (process.platform === 'win32') assert.ok(result.python.startsWith(runtimeCacheDirectory() + path.sep))
    assert.equal(result.frames, 30); assert.equal(result.channels, 52)
    assert.equal(result.engine, process.platform === 'win32' ? 'pytorch-original-tar' : 'coreml-ios')
    console.log('PASS: real Electron loaded managed runtime, compiled source Java and ran local LAM inference.')
  }
  if (process.env.DEVICE_UPDATE_SOURCE_ONLY === '1') {
    await verifySourceUpdate({ page, electron, root, artifacts, applicationVersion })
    assert.deepEqual(errors, []); assert.deepEqual(failures, [])
  } else {
  const dialog = page.locator('#desktop-update-dialog'), status = page.locator('#desktop-update-status')
  await page.locator('#account-menu > summary').click()
  await page.locator('#account-update').click()
  await page.waitForFunction(() => document.querySelector('#desktop-update-download').hidden === false)
  assert.ok((await page.locator('#desktop-update-version').textContent()).includes(`当前版本 ${applicationVersion}`))
  assert.equal(await page.locator('#desktop-update-notes img').count(), 0, 'Release notes are plain text')
  assert.match(await page.locator('#desktop-update-notes').textContent(), /<img/)
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 })
    const bounds = await dialog.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
    await page.screenshot({ path: path.join(artifacts, `available-${width}.png`) })
  }
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.querySelector('#desktop-update-dialog').contains(document.activeElement)), true)
  const axe = await readFile(path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/axe-core/axe.min.js'), 'utf8')
  await page.evaluate(axe)
  const accessibility = await page.evaluate(async () => (await window.axe.run(document.querySelector('#desktop-update-dialog'),
    { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations)
  assert.deepEqual(accessibility, [])
  await electron.evaluate(() => { globalThis.updateFixture.mode = 'stall' })
  await page.locator('#desktop-update-download').click()
  await page.waitForFunction(() => !document.querySelector('#desktop-update-cancel').hidden)
  await page.locator('#desktop-update-cancel').click()
  await page.waitForFunction(() => document.querySelector('#desktop-update-status').textContent.includes('取消'))
  assert.equal(await page.locator('#desktop-update-download').isEnabled(), true)
  await electron.evaluate(() => { globalThis.updateFixture.mode = 'corrupt' })
  await page.locator('#desktop-update-download').click()
  await page.waitForFunction(() => document.querySelector('#desktop-update-status').textContent.includes('校验不通过'))
  assert.equal(await page.locator('#desktop-update-install').isVisible(), false)
  await electron.evaluate(() => { globalThis.updateFixture.mode = 'normal' })
  await page.locator('#desktop-update-download').click()
  await page.waitForFunction(() => document.querySelector('#desktop-update-status').textContent.includes('安装包已校验'))
  assert.match(await status.textContent(), /可退出并安装/)
  assert.equal((await page.evaluate(() => window.controlDevice.updateState())).runMode, 'installed')
  await page.locator('#desktop-update-install').click()
  await page.waitForFunction(() => document.querySelector('#desktop-update-status').textContent.includes('无法启动升级'))
  // Seed the cache with a real generated baseline, then use the real main
  // process service, narrow IPC and UI to reconstruct the next fixture.
  const updates = path.join(profile, 'updates')
  await writeFile(path.join(updates, 'setup.exe'), oldPayload)
  assert.equal(await saveBaseline({ directory: updates, manifest: { bytes: oldPayload.length,
    sha256: createHash('sha256').update(oldPayload).digest('hex'), blockmap: oldBlockmap },
    blockmap: await readFile(oldBlockmap.file) }), true)
  await electron.evaluate(() => { globalThis.updateFixture.mode = 'delta' })
  await page.locator('#desktop-update-check').click()
  await page.waitForFunction(() => !document.querySelector('#desktop-update-download').hidden)
  await page.locator('#desktop-update-download').click()
  await page.waitForFunction(() => document.querySelector('#desktop-update-status').textContent.includes('安装包已校验'))
  const deltaState = await page.evaluate(() => window.controlDevice.updateState())
  assert.equal(deltaState.mode, 'differential')
  assert.ok(deltaState.networkBytes < nextPayload.length / 10)
  assert.equal(deltaState.cacheStored, true)
  assert.deepEqual(await readFile(path.join(updates, 'setup.exe')), nextPayload)
  assert.match(await page.locator('#desktop-update-size').textContent(), /增量下载.*实际下载.*本地复用/)
  assert.match(await page.locator('#desktop-update-size').textContent(), /实际下载 \d+\.\d KB/)
  await page.screenshot({ path: path.join(artifacts, 'differential-ready.png') })
  await page.locator('#desktop-update-check').click()
  await page.waitForFunction(() => !document.querySelector('#desktop-update-download').hidden)
  await electron.evaluate(() => { globalThis.updateFixture.mode = '404' })
  await page.locator('#desktop-update-check').click()
  await page.waitForFunction(() => document.querySelector('#desktop-update-status').textContent.includes('404'))
  await page.screenshot({ path: path.join(artifacts, 'feed-not-published.png') })
  const pet = electron.windows().find(page => page.url().endsWith('/device/device-pet.html'))
  assert.equal((await pet.evaluate(() => window.controlDevice.checkUpdate())).ok, false, 'Pet cannot invoke controller updates')
  await page.keyboard.press('Escape')
  assert.equal(await dialog.isVisible(), false)
  await page.waitForFunction(() => document.activeElement === document.querySelector('#account-menu > summary'))
  assert.deepEqual(errors, []); assert.deepEqual(failures, [])
  const report = { appVersion: applicationVersion, cancel: true, integrityFailure: true, download: true, failedHandoffReported: true,
    petDenied: true, missingFeed: true, plainTextNotes: true, keyboard: true, differential: {
      bytes: deltaState.bytes, networkBytes: deltaState.networkBytes, reusedBytes: deltaState.reusedBytes },
    widths: [320, 768, 1024, 1440], accessibility, errors, failures }
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  }
} finally {
  if (electron) {
    const sourceDirectory = await electron.evaluate(() => globalThis.sourceFixture?.directory).catch(() => null)
    await electron.close()
    if (sourceDirectory) await rm(sourceDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
  for (const client of server.clients) client.terminate()
  await new Promise(resolve => server.close(resolve))
}
