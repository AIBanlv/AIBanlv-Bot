import { lamError } from './device-lam-worker.mjs'
import { validateLamTrack } from '../src/lam-track.mjs'

export class DeviceLam {
  constructor({ engineFactory, emit, onFailure, onStatus = () => {}, keepWarm = false }) {
    Object.assign(this, { engineFactory, emit, onFailure, onStatus, keepWarm })
    this.status = { state: 'idle' }
    this.work = Promise.resolve()
    this.closing = new Set()
    this.hasTurnState = false
  }
  setStatus(state, engine) {
    this.status = { state, ...(engine?.provenance?.backend ? { backend: engine.provenance.backend } : {}) }
    this.onStatus(this.status)
  }
  setActive(active) {
    if (this.active === active || this.disposed) return
    this.active = active
    if (active) this.scheduleWarmup()
    else this.cancel()
  }
  scheduleWarmup() {
    clearTimeout(this.warmTimer)
    if (!this.active || this.disposed) return
    this.warmTimer = setTimeout(() => {
      this.warmTimer = null
      if (!this.turn) void this.prewarm()
    }, 0)
  }
  async prewarm() {
    if (this.disposed) return { ok: false }
    if (this.engine) return { ok: true }
    if (this.warming) return this.warming.promise
    const previous = this.drain()
    const warm = { controller: new AbortController() }
    this.warming = warm
    this.setStatus('preparing')
    warm.promise = (async () => {
      try {
        await previous
        warm.controller.signal.throwIfAborted()
        if (this.disposed) throw lamError()
        if (this.engine) return { ok: true }
        const engine = await this.engineFactory(warm.controller.signal)
        if (warm.controller.signal.aborted || this.disposed || this.warming !== warm) {
          await engine.dispose()
          throw lamError()
        }
        this.engine = engine
        this.setStatus('ready', engine)
        return { ok: true }
      } catch { this.setStatus('idle'); return { ok: false } }
      finally { if (this.warming === warm) this.warming = null }
    })()
    return warm.promise
  }
  async begin(requestId, signal) {
    clearTimeout(this.warmTimer)
    if (this.disposed || signal.aborted) throw lamError()
    if (this.turn) this.cancel()
    this.hasTurnState = true
    await this.drain()
    if (this.disposed || signal.aborted) throw lamError()
    const controller = new AbortController()
    const abort = AbortSignal.any([signal, controller.signal])
    const turn = { requestId, controller, abort, pending: Buffer.alloc(0),
      history: Buffer.alloc(54400), total: 0, ended: false, text: '', userText: '', replyVersion: 0, appliedReply: -1 }
    const cancel = () => { if (this.turn === turn) this.cancel() }
    turn.detach = () => abort.removeEventListener('abort', cancel)
    this.turn = turn
    abort.addEventListener('abort', cancel, { once: true })
    const starting = this.prepare(turn)
    this.starting = starting
    try { await starting }
    finally { if (this.starting === starting) this.starting = null }
  }
  async prepare(turn) {
    const { abort } = turn
    try {
      abort.throwIfAborted()
      if (this.keepWarm && !this.engine) await this.prewarm()
      const engine = this.engine || await this.engineFactory(abort)
      if (abort.aborted || this.turn !== turn) { if (!this.keepWarm) await engine.dispose(); throw lamError() }
      this.engine = engine
      this.hasTurnState = true
      await engine.reset()
      abort.throwIfAborted()
      this.setStatus('ready', engine)
    } catch {
      if (this.turn === turn) this.cancel({ release: true })
      throw lamError()
    }
  }
  enqueue(turn, action) {
    this.work = this.work.then(async () => {
      if (this.turn === turn) await action()
    }).catch(() => {
      if (this.turn === turn) { this.cancel({ release: true }); this.onFailure(lamError()) }
    })
  }
  block(turn, pcm) {
    const window = Buffer.alloc(102400)
    turn.history.copy(window)
    pcm.copy(window, 54400)
    turn.history = Buffer.from(window.subarray(48000))
    this.enqueue(turn, async () => {
      const engine = this.engine
      const raw = await engine.infer(window)
      if (this.turn !== turn) return
      if (this.status.backend !== engine.provenance?.backend) this.setStatus('ready', engine)
      while (turn.appliedReply !== turn.replyVersion) {
        const version = turn.replyVersion
        await engine.reply(turn.text, turn.userText)
        if (this.turn !== turn) return
        turn.appliedReply = version
      }
      const expression = await engine.process(raw.slice(0, Math.ceil(pcm.length / 1600)), pcm.length / 2)
      if (this.turn !== turn) return
      validateLamTrack(expression, Math.ceil(pcm.length / 1600))
      this.emit({ type: 'audio', requestId: turn.requestId, pcm: pcm.toString('base64'), sampleRate: 24000, expression })
    })
  }
  accept(data) {
    // `interrupted` is a local event: the user barged in, so the reply audio that
    // was still being converted into expressions has no one left to listen to it.
    if (['reset', 'stopped', 'error', 'interrupted'].includes(data.type)) {
      // An unused model has no role data; keep its loading work across the initial avatar selection.
      if (this.hasTurnState) this.cancel()
      this.emit(data); this.scheduleWarmup(); return
    }
    if (data.type === 'assistant' || data.type === 'user') {
      const turn = this.turn
      if (!turn || data.requestId !== turn.requestId) return
      if (turn.ended) { if (data.type === 'user') this.emit(data); return }
      const key = data.type === 'assistant' ? 'text' : 'userText'
      if (typeof data.text !== 'string' || data.text.length > (key === 'text' ? 16000 : 1000)) {
        this.cancel(); this.onFailure(lamError()); return
      }
      if (turn[key] !== data.text) { turn[key] = data.text; turn.replyVersion++ }
      this.emit(data); return
    }
    if (!['audio', 'done', 'complete'].includes(data.type)) { this.emit(data); return }
    const turn = this.turn
    if (!turn || data.requestId !== turn.requestId) return
    if (data.type === 'complete') {
      turn.detach(); this.turn = null
      turn.pending = turn.history = null
      this.emit(data); return
    }
    if (turn.ended) return
    if (data.type === 'audio') {
      const pcm = Buffer.from(data.pcm, 'base64')
      turn.total += pcm.length
      if (data.sampleRate !== 24000 || pcm.length % 2 || turn.total > 8 * 1024 * 1024) {
        this.cancel(); this.onFailure(lamError()); return
      }
      turn.pending = Buffer.concat([turn.pending, pcm])
      while (turn.pending.length >= 48000) {
        this.block(turn, Buffer.from(turn.pending.subarray(0, 48000)))
        turn.pending = turn.pending.subarray(48000)
      }
    } else {
      turn.ended = true
      if (turn.pending.length) this.block(turn, Buffer.from(turn.pending))
      turn.pending = Buffer.alloc(0)
      this.enqueue(turn, async () => {
        const closing = turn.total ? validateLamTrack(await this.engine.finish(), 30) : undefined
        if (this.turn === turn) this.emit({ ...data, closing })
      })
    }
  }
  cancel({ release = !this.keepWarm || !this.active } = {}) {
    this.hasTurnState = false
    clearTimeout(this.warmTimer)
    const warm = this.warming
    this.warming = null
    if (warm) {
      warm.controller.abort()
      this.closing.add(warm.promise)
      warm.promise.finally(() => this.closing.delete(warm.promise)).catch(() => {})
    }
    const turn = this.turn
    this.turn = null
    if (turn) {
      turn.detach(); turn.controller.abort()
      turn.pending = turn.history = null
      turn.text = turn.userText = ''
    }
    const engine = this.engine
    if (!release && engine) {
      this.work = this.work.then(() => engine.reset()).catch(() => {
        if (this.engine === engine) this.cancel({ release: true })
      })
      return
    }
    this.engine = null
    this.setStatus('idle')
    if (engine) {
      const job = engine.dispose()
      this.closing.add(job)
      job.finally(() => this.closing.delete(job)).catch(() => {})
    }
  }
  async drain() { await Promise.allSettled([this.work, this.starting, this.warming?.promise, ...this.closing]) }
  async dispose() { this.disposed = true; this.active = false; this.cancel({ release: true }); await this.drain() }
}
