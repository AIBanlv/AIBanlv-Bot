import { createHash } from 'node:crypto'
import { app, dialog } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { createDesktopUpdate } from '../electron/device-update-mode.mjs'
import { sourceFixture } from './source-update-fixture.mjs'
import { checkSourceUpdate, sourceError } from '../electron/device-source-git.mjs'
import { createLamEngine } from '../electron/device-lam-engine.mjs'

if (process.env.DEVICE_SOURCE_RUNTIME_CHECK === '1') globalThis.createRuntimeFixtureEngine = createLamEngine

const payload = Buffer.from('local update installer fixture, never executable')
const applicationVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version.split('.').map(Number)
const fixtureVersion = increment => [...applicationVersion.slice(0, 2), applicationVersion[2] + increment].join('.')
globalThis.updateFixture = { mode: 'normal', stalled: false, updateRequests: [] }
if (process.env.DEVICE_UPDATE_SOURCE_ONLY === '1') {
  const fixture = await sourceFixture({ after: () => {} })
  globalThis.sourceFixture = fixture
  fixture.writeApp = value => writeFile(path.join(fixture.root, 'app.txt'), value)
  globalThis.createFixtureDesktopUpdate = options => createDesktopUpdate({ ...options, isPackaged: false, sourceDirectory: fixture.root,
    sourceCheck: (root, options) => globalThis.updateFixture.mode === 'stall'
      ? new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(sourceError('SOURCE_CANCELLED'))))
      : checkSourceUpdate(root, options),
    sourcePrepare: async ({ plan }) => {
      globalThis.updateFixture.sourcePrepared = (globalThis.updateFixture.sourcePrepared || 0) + 1
      if (globalThis.updateFixture.mode === 'handoff-error') throw sourceError('SOURCE_NODE')
      if (plan.root !== fixture.root) throw new Error('Not a fixture')
    },
    sourceQuit: () => { globalThis.updateFixture.sourceQuit = true } })
} else {
  // Exercise installed update capabilities without packaging or launching an EXE.
  globalThis.createFixtureDesktopUpdate = options => createDesktopUpdate({ ...options, isPackaged: true, installed: true,
    handoff: async () => { throw new Error('Fixture blocks actual installation') } })
}
registerHooks({ resolve(specifier, context, next) {
    return specifier === './device-update-mode.mjs' && context.parentURL?.endsWith('/electron/device-main.mjs')
      ? { url: 'data:text/javascript,export const createDesktopUpdate = globalThis.createFixtureDesktopUpdate', shortCircuit: true }
      : next(specifier, context)
} })
globalThis.fetch = async (url, options = {}) => {
  if (String(url).startsWith('https://updates.example.test/')) globalThis.updateFixture.updateRequests.push(String(url))
  if (url === 'https://updates.example.test/latest.json') {
    if (globalThis.updateFixture.mode === '404') return new Response('', { status: 404 })
    if (globalThis.updateFixture.mode === 'delta') {
      const directory = process.env.PET_TEST_UPDATE_DELTA
      const data = await readFile(path.join(directory, 'next-fixture.bin')), map = await readFile(path.join(directory, 'next-fixture.bin.blockmap'))
      return Response.json({ version: fixtureVersion(2), platform: 'win32', arch: 'x64', bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'), url: 'https://updates.example.test/Delta.exe',
        blockmap: { url: 'https://updates.example.test/Delta.exe.blockmap', bytes: map.length,
          sha256: createHash('sha256').update(map).digest('hex') }, notes: '增量更新本地夹具' })
    }
    return Response.json({ version: fixtureVersion(1), platform: 'win32', arch: 'x64', bytes: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex'),
      url: 'https://updates.example.test/Setup.exe', notes: '更新说明 <img src=x onerror=alert(1)>\n本地夹具，无安装行为' })
  }
  if (url === 'https://updates.example.test/Delta.exe.blockmap') return new Response(await readFile(path.join(process.env.PET_TEST_UPDATE_DELTA, 'next-fixture.bin.blockmap')))
  if (url === 'https://updates.example.test/Delta.exe') {
    const data = await readFile(path.join(process.env.PET_TEST_UPDATE_DELTA, 'next-fixture.bin'))
    const range = /^bytes=(\d+)-(\d+)$/.exec(options.headers?.Range || '')
    if (!range) return new Response(data)
    const start = Number(range[1]), end = Number(range[2])
    return new Response(data.subarray(start, end + 1), { status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${data.length}` } })
  }
  if (url === 'https://updates.example.test/Setup.exe') {
    if (globalThis.updateFixture.mode === 'stall') return new Response(new ReadableStream({ start(controller) {
      globalThis.updateFixture.stalled = true
      controller.enqueue(payload.subarray(0, 2))
      options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true })
    } }))
    return new Response(globalThis.updateFixture.mode === 'corrupt' ? Buffer.alloc(payload.length) : payload)
  }
  // The fixture must never open production HTTP services.
  return Response.json({ code: 200, data: [] })
}
dialog.showErrorBox = (title, message) => console.error('[update fixture]', title, message)
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('render-process-gone', (_event, details) => console.error('[update renderer]', details.reason))
})
await import('../electron/device-main.mjs')
