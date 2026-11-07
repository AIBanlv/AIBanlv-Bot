import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { LineWorker, lamError } from '../device-lam-worker.mjs'

const execute = promisify(execFile)
export const backends = ['cpuOnly', 'all', 'cpuAndGPU', 'cpuAndNeuralEngine']
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const validFrames = frames => Array.isArray(frames) && frames.length === 30 && frames.every(frame =>
  Array.isArray(frame) && frame.length === 52 && frame.every(value => Number.isFinite(value) && value >= 0 && value <= 1))

export function compareProbe(candidate, baseline) {
  if (!candidate?.healthy || !Number.isFinite(candidate.medianMs) || candidate.medianMs <= 0 ||
      !Array.isArray(candidate.probes) || candidate.probes.length !== 3 || !candidate.probes.every(validFrames)) return false
  const flat = candidate.probes.map(frames => frames.flat())
  if (!flat[0].some((value, index) => Math.abs(value - flat[1][index]) > 0.0001)) return false
  if (!baseline) return true
  const reference = baseline.probes.flat(2), values = flat.flat()
  let squared = 0, maximum = 0
  for (let i = 0; i < values.length; i++) {
    const error = Math.abs(reference[i] - values[i])
    squared += error * error; maximum = Math.max(maximum, error)
  }
  return maximum <= 0.03 && Math.sqrt(squared / values.length) <= 0.005
}

async function saveCache(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  await rename(temporary, file)
}

export async function runProbe({ worker, model, names, backend, signal }) {
  // A native accelerator can crash or hang. Never probe inside Electron itself.
  const { stdout } = await execute(worker, [model, names, '--backend', backend, '--probe'], {
    signal, timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}

export async function selectMacBackend({ worker, model, names, cacheFile, signal,
  mode = process.env.PET_COREML_BACKEND || 'auto', refresh = false, probe = runProbe, cacheKey }) {
  if (mode !== 'auto' && !backends.includes(mode)) throw lamError()
  signal.throwIfAborted()
  const key = cacheKey || digest(Buffer.concat([
    await readFile(worker), await readFile(path.join(path.dirname(model), 'model-manifest.json')),
    Buffer.from(`${os.release()}|${process.arch}|${os.cpus()[0]?.model}`),
  ]))
  if (mode !== 'auto') return { key, backend: mode, selection: 'explicit', reports: [] }
  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'))
      if (cached.key === key && backends.includes(cached.backend)) return { ...cached, selection: 'cached' }
    } catch {}
  }
  const baseline = await probe({ worker, model, names, backend: 'cpuOnly', signal })
  if (baseline.backend !== 'cpuOnly' || !compareProbe(baseline)) throw lamError()
  const reports = [{ backend: 'cpuOnly', healthy: true, medianMs: baseline.medianMs, startupMs: baseline.startupMs }]
  let selected = baseline
  const candidates = ['all', 'cpuAndGPU', ...(process.arch === 'arm64' ? ['cpuAndNeuralEngine'] : [])]
  for (const backend of candidates) {
    signal.throwIfAborted()
    try {
      const result = await probe({ worker, model, names, backend, signal })
      const healthy = result.backend === backend && compareProbe(result, baseline)
      reports.push({ backend, healthy, medianMs: result.medianMs, startupMs: result.startupMs })
      // Avoid switching devices for timing noise or a negligible improvement.
      if (healthy && result.medianMs < selected.medianMs * 0.95) selected = result
    } catch {
      signal.throwIfAborted()
      reports.push({ backend, healthy: false, reason: 'probe-failed-or-timed-out' })
    }
  }
  const selection = { key, backend: selected.backend, selection: 'benchmarked', reports }
  signal.throwIfAborted()
  await saveCache(cacheFile, selection).catch(() => {})
  return selection
}

export class MacLamWorker {
  constructor(options, { workerFactory = (file, args) => new LineWorker(file, args, { startupMs: 120000, timeoutMs: 30000 }),
    select = selectMacBackend } = {}) {
    this.options = options; this.workerFactory = workerFactory; this.select = select
    this.controller = new AbortController()
    this.signal = AbortSignal.any([options.signal, this.controller.signal])
    this.ready = this.start()
    this.ready.catch(() => {})
  }
  async launch(backend) {
    this.signal.throwIfAborted()
    this.worker = this.workerFactory(this.options.worker, [this.options.model, this.options.names, '--backend', backend])
    this.backend = backend
    const ready = await this.worker.ready
    this.signal.throwIfAborted()
    if (ready.backend !== backend) throw lamError()
    return ready
  }
  async start() {
    this.selection = await this.select({ ...this.options, signal: this.signal })
    try {
      this.provenance = await this.launch(this.selection.backend)
    } catch {
      this.signal.throwIfAborted()
      if (this.backend === 'cpuOnly') throw lamError()
      this.provenance = await this.fallback()
    }
    return this.provenance
  }
  fallback() {
    if (this.fallingBack) return this.fallingBack
    this.fallingBack = this.fallbackToCPU().finally(() => { this.fallingBack = null })
    return this.fallingBack
  }
  async fallbackToCPU() {
    await this.worker?.dispose()
    this.signal.throwIfAborted()
    const ready = await this.launch('cpuOnly')
    if (this.provenance) Object.assign(this.provenance, ready)
    this.selection = { ...this.selection, backend: 'cpuOnly', selection: 'runtime-fallback' }
    await saveCache(this.options.cacheFile, this.selection).catch(() => {})
    this.lastOutput = this.lastInput = null; this.repeats = 0
    return ready
  }
  async request(data) {
    this.signal.throwIfAborted()
    try {
      const result = await this.worker.request(data)
      if (!validFrames(result.frames)) throw lamError()
      if (this.backend !== 'cpuOnly') {
        const pcm = Buffer.from(data.pcm, 'base64')
        let energy = 0
        for (let i = 0; i < pcm.length; i += 16) energy += (pcm.readInt16LE(i) / 32768) ** 2
        const voiced = Math.sqrt(energy / (pcm.length / 16)) > 0.01
        const input = digest(pcm), output = digest(JSON.stringify(result.frames.map(frame => frame.map(value => Math.round(value * 1e5)))))
        this.repeats = voiced && input !== this.lastInput && output === this.lastOutput ? (this.repeats || 0) + 1 : 0
        this.lastInput = input; this.lastOutput = output
        if (this.repeats >= 2) throw lamError()
      }
      return result
    } catch {
      this.signal.throwIfAborted()
      if (this.backend === 'cpuOnly') throw lamError()
      // Re-run only this local PCM block; never resubmit a cloud request.
      await this.fallback()
      const result = await this.worker.request(data)
      if (!validFrames(result.frames)) throw lamError()
      return result
    }
  }
  async ensureReady() {
    await this.ready
    this.signal.throwIfAborted()
    if (this.worker?.dead && this.backend !== 'cpuOnly') await this.fallback()
  }
  get dead() { return this.signal.aborted || this.worker?.dead }
  get child() { return this.worker?.child }
  get closed() { return this.worker?.closed }
  fail() { this.controller.abort(); this.worker?.fail() }
  async dispose() { this.fail(); await this.ready.catch(() => {}); await this.worker?.dispose() }
}
