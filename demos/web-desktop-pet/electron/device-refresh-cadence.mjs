// Shared request pacing, independent of renderer repaints and channel state events.
export class RefreshCadence {
  constructor({ now = Date.now, successMs = 30000, emptyMs = 60000, retryMs = 15000, maxRetryMs = 300000, minimumMs = 3000 } = {}) {
    Object.assign(this, { now, successMs, emptyMs, retryMs, maxRetryMs, minimumMs })
    this.reset('')
  }
  reset(key) { this.key = key; this.failures = 0; this.nextAt = 0; this.lastAt = -Infinity }
  begin(key, { force = false } = {}) {
    if (this.key !== key) this.reset(key)
    const now = this.now()
    if (now < this.lastAt + this.minimumMs || !force && now < this.nextAt) return false
    this.lastAt = now; this.nextAt = now + this.minimumMs
    return true
  }
  finish(key, { ok, empty = false }) {
    if (key !== this.key) return
    this.failures = ok ? 0 : Math.min(20, this.failures + 1)
    this.nextAt = this.now() + (ok ? empty ? this.emptyMs : this.successMs
      : Math.min(this.maxRetryMs, this.retryMs * 2 ** (this.failures - 1)))
  }
}
