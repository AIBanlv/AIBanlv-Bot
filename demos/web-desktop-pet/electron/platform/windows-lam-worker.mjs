import { LineWorker, lamError } from '../device-lam-worker.mjs'

// Probe in a killable worker; fallback replays only the current local PCM.
export class WindowsLamWorker {
  constructor(file, args, { signal, factory = (file, args, options) => new LineWorker(file, args, options) } = {}) {
    Object.assign(this, { file, args, signal, factory }); this.cpu = false
    this.ready = this.start().catch(() => this.fallback())
    this.ready.catch(() => {})
  }
  get dead() { return this.stopped || this.worker?.dead }
  get child() { return this.worker?.child }
  get closed() { return this.worker?.closed }
  async start() {
    if(this.stopped)throw lamError()
    this.signal?.throwIfAborted()
    this.worker = this.factory(this.file, [...this.args, ...(this.cpu ? ['--backend=cpu'] : [])], { startupMs: 180000, timeoutMs: 60000 })
    const provenance=await this.worker.ready
    this.provenance ||= {}
    Object.assign(this.provenance,provenance)
    this.signal?.throwIfAborted()
    return this.provenance
  }
  async fallback() {
    if (this.fallingBack) return this.fallingBack
    if (this.cpu || this.stopped || this.signal?.aborted) throw lamError()
    this.cpu = true
    this.fallingBack = (async () => { await this.worker?.dispose(); return this.start() })()
    try { return await this.fallingBack } finally { this.fallingBack = null }
  }
  async ensureReady() { await this.ready; if (this.dead) await this.fallback() }
  async request(value) {
    await this.ensureReady()
    try { return await this.worker.request(value) }
    catch { await this.fallback(); return this.worker.request(value) }
  }
  fail() { this.stopped = true; this.worker?.fail() }
  async dispose() { this.fail(); await this.worker?.dispose() }
}
