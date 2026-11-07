import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { compareProbe, selectMacBackend, MacLamWorker } from '../electron/platform/mac-lam-backends.mjs'
import { desktopTarget, buildTarget } from '../electron/platform/target.mjs'

const frames = value => Array.from({ length: 30 }, () => Array(52).fill(value))
const report = (backend, medianMs, delta = 0) => ({ backend, healthy: true, medianMs,
  probes: [frames(0.1 + delta), frames(0.3 + delta), frames(0.2 + delta)] })
const fixture = async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-backends-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { cacheFile: path.join(directory, 'backend.json'), cacheKey: 'fixture-hardware-model', signal: new AbortController().signal }
}

test('one desktop entry supports Windows x64, Mac x64 and Mac arm64', () => {
  for (const [platform, arch, engine] of [['win32', 'x64', 'pytorch-original-tar'], ['darwin', 'x64', 'coreml-ios'], ['darwin', 'arm64', 'coreml-ios']]) {
    assert.deepEqual(desktopTarget({ platform, arch }), { platform, arch, engine })
    assert.deepEqual(buildTarget([`--platform=${platform}`, `--arch=${arch}`], {}), { platform, arch, engine })
  }
  assert.throws(() => desktopTarget({ platform: 'win32', arch: 'arm64' }))
  assert.throws(() => desktopTarget({ platform: 'linux', arch: 'x64' }))
})

test('accelerators must be finite, input dependent and numerically close to CPU', () => {
  const baseline = report('cpuOnly', 10)
  assert.equal(compareProbe(report('all', 5, 0.001), baseline), true)
  assert.equal(compareProbe(report('all', 5, 0.1), baseline), false)
  const frozen = report('all', 1); frozen.probes.fill(frames(0.1))
  assert.equal(compareProbe(frozen, baseline), false)
  const corrupt = report('all', 1); corrupt.probes[0][0][0] = NaN
  assert.equal(compareProbe(corrupt, baseline), false)
})

test('selection rejects fast wrong output, caches fastest healthy backend and invalidates on model change', async t => {
  const options = await fixture(t), calls = []
  const probe = async ({ backend }) => {
    calls.push(backend)
    return report(backend, backend === 'cpuOnly' ? 20 : backend === 'all' ? 1 : 5, backend === 'all' ? 0.2 : 0)
  }
  const selected = await selectMacBackend({ ...options, probe })
  assert.equal(selected.backend, 'cpuAndGPU')
  const cached = await selectMacBackend({ ...options, probe: () => { throw new Error('must reuse cache') } })
  assert.equal(cached.selection, 'cached')
  calls.length = 0
  await selectMacBackend({ ...options, cacheKey: 'different-model', probe })
  assert.ok(calls.includes('cpuOnly'))
  assert.equal((await readFile(options.cacheFile, 'utf8')).includes('probes'), false, 'Cache must contain timings, never audio/output traces')
})

test('native probe crash or timeout falls back; cancellation never persists a successful selection', async t => {
  const options = await fixture(t)
  const selected = await selectMacBackend({ ...options, probe: async ({ backend }) => {
    if (backend !== 'cpuOnly') throw new Error('native process crash')
    return report(backend, 20)
  } })
  assert.equal(selected.backend, 'cpuOnly')
  const controller = new AbortController()
  await assert.rejects(selectMacBackend({ ...options, cacheKey: 'cancelled', signal: controller.signal,
    probe: async ({ backend }) => { controller.abort(); return report(backend, 1) } }))
  assert.equal(JSON.parse(await readFile(options.cacheFile, 'utf8')).key, options.cacheKey)
})

function fakeWorkers({ failedGPU = false, frozen = false } = {}) {
  const calls = [], instances = []
  return { calls, instances, workerFactory: (_file, args) => {
    const backend = args.at(-1)
    const worker = { dead: false, ready: Promise.resolve({ type: 'ready', engine: 'coreml-ios', backend }),
      request: async data => {
        calls.push({ backend, data })
        if (failedGPU && backend !== 'cpuOnly') throw new Error('accelerator failed')
        return { frames: frames(frozen && backend !== 'cpuOnly' ? 0.1 : 0.2) }
      }, fail() { this.dead = true }, async dispose() { this.dead = true } }
    instances.push(worker)
    return worker
  } }
}

test('runtime accelerator failure replays only the same local PCM on CPU and caches fallback', async t => {
  const options = await fixture(t), fake = fakeWorkers({ failedGPU: true })
  const worker = new MacLamWorker({ ...options, worker: 'fixture', model: 'fixture', names: 'fixture' },
    { ...fake, select: async () => ({ key: options.cacheKey, backend: 'cpuAndGPU' }) })
  await worker.ready
  const data = { pcm: Buffer.alloc(102400).toString('base64') }
  await worker.request(data)
  assert.deepEqual(fake.calls.map(call => call.backend), ['cpuAndGPU', 'cpuOnly'])
  assert.equal(fake.calls[0].data, fake.calls[1].data)
  assert.equal(JSON.parse(await readFile(options.cacheFile, 'utf8')).backend, 'cpuOnly')
  await worker.dispose()
})

test('runtime frozen output across changing voiced windows triggers CPU replay', async t => {
  const options = await fixture(t), fake = fakeWorkers({ frozen: true })
  const worker = new MacLamWorker(options, { ...fake, select: async () => ({ key: options.cacheKey, backend: 'all' }) })
  await worker.ready
  for (const sample of [10000, 11000, 12000]) {
    const pcm = Buffer.alloc(102400)
    for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(sample, i)
    await worker.request({ pcm: pcm.toString('base64') })
  }
  assert.deepEqual(fake.calls.map(call => call.backend), ['all', 'all', 'all', 'cpuOnly'])
  await worker.dispose()
})
