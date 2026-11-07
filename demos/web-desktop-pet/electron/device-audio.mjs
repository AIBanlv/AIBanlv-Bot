import { validateLamTrack, sampleLamTrack, neutralExpression } from '../src/lam-track.mjs'

export class DeviceAudio {
  constructor({ createContext = () => new AudioContext({ sampleRate: 24000 }),
    raf = callback => requestAnimationFrame(callback), cancelRaf = id => cancelAnimationFrame(id),
    onExpression = () => {} } = {}) {
    Object.assign(this, { createContext, raf, cancelRaf, onExpression })
    this.sources = new Set()
    this.segments = new Map()
    this.level = 0.8
    this.revision = 0
  }
  // Full duplex needs to know whether the pet is audible right now: while it
  // is, the microphone stays open but has to prove a real interruption.
  get speaking() { return Boolean(this.sources.size || this.closing) }
  async prepare() {
    if (!this.context) {
      this.context = this.createContext()
      this.gain = this.context.createGain()
      this.gain.gain.value = this.level
      this.gain.connect(this.context.destination)
    }
    await this.context.resume()
    if (this.context.state !== 'running') throw new Error('Audio unavailable')
  }
  volume(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) return
    this.level = value
    if (this.gain) this.gain.gain.value = value
  }
  push(encoded, sampleRate, expression) {
    if (!this.context || this.context.state !== 'running' || sampleRate !== 24000 ||
        typeof encoded !== 'string' || encoded.length > 1500000) throw new Error('Invalid audio')
    const bytes = atob(encoded)
    if (!bytes.length || bytes.length % 2 || this.sources.size >= 1024) throw new Error('Invalid audio')
    validateLamTrack(expression, Math.ceil(bytes.length / 1600))
    if (this.finished || this.closing) throw new Error('Audio already ended')
    const buffer = this.context.createBuffer(1, bytes.length / 2, sampleRate)
    const samples = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) {
      const word = bytes.charCodeAt(i * 2) | bytes.charCodeAt(i * 2 + 1) << 8
      samples[i] = (word >= 32768 ? word - 65536 : word) / 32768
    }
    const start = Math.max(this.nextTime || 0, this.context.currentTime + 0.025)
    if (start - this.context.currentTime + buffer.duration > 180) throw new Error('Audio queue exceeded')
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.gain)
    source.onended = () => {
      source.disconnect()
      this.sources.delete(source)
      this.segments.delete(source)
      if (!this.sources.size) this.settle()
    }
    this.sources.add(source)
    this.segments.set(source, { start, duration: buffer.duration, expression })
    source.start(start)
    this.nextTime = start + buffer.duration
    if (!this.animation) this.animate()
  }
  animate() {
    const revision = this.revision
    const tick = () => {
      if (this.revision !== revision) return
      const now = this.context.currentTime
      let value
      for (const segment of this.segments.values()) {
        if (now >= segment.start && now < segment.start + segment.duration) {
          value = sampleLamTrack(segment.expression, now - segment.start, segment.duration)
          break
        }
      }
      if (!value && this.closing) {
        value = sampleLamTrack(this.closing.track, now - this.closing.start, 1)
        if (now >= this.closing.start + 1) {
          this.closing = null
          this.finished?.(true); this.finished = null
        }
      }
      this.onExpression(value || neutralExpression())
      this.animation = this.sources.size || this.closing ? this.raf(tick) : null
    }
    this.animation = this.raf(tick)
  }
  settle() {
    if (this.closingTrack) {
      this.closing = { track: this.closingTrack, start: this.context.currentTime }
      this.closingTrack = null
      if (!this.animation) this.animate()
    } else if (!this.closing) {
      this.cancelRaf(this.animation); this.animation = null
      this.onExpression(neutralExpression())
      this.finished?.(true); this.finished = null
    }
  }
  finish(closing) {
    if (closing) this.closingTrack = validateLamTrack(closing, 30)
    if (!this.sources.size && !closing) return Promise.resolve(true)
    return new Promise(resolve => {
      this.finished = resolve
      if (!this.sources.size) this.settle()
    })
  }
  stop() {
    this.revision++
    this.cancelRaf(this.animation); this.animation = null
    for (const source of this.sources) {
      source.onended = null
      try { source.stop(); source.disconnect() } catch {}
    }
    this.sources.clear(); this.segments.clear(); this.nextTime = 0
    this.closing = this.closingTrack = null
    this.finished?.(false); this.finished = null
    this.onExpression(neutralExpression())
  }
  async dispose() { this.stop(); await this.context?.close() }
}
