import { BILLING_URL, sessionError } from './device-session.mjs'

const events = new Set(['session_started', 'output_started', 'output_completed',
  'human_transcript', 'assistant_transcript', 'usage', 'interrupted', 'speech_timeout', 'error'])
const numbers = new Set(['textCharacterCount', 'pcmBytes', 'audioDurationMs', 'tokenCount'])
const strings = { text: 16384, responseId: 128, errorCode: 128, errorMessage: 1000 }
const maxPending = 128, maxBytes = 256 * 1024
const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit
const failure = code => sessionError(code, 'Billing connection unavailable; conversation stopped.')

export class DeviceBilling {
  constructor({ session, socketFactory = (url, opts) => new WebSocket(url, opts),
    onFailure = () => {}, timeoutMs = 10000 }) {
    if (!session || !text(session.sessionId, 128) || !/^[\w-]+$/.test(session.sessionId) ||
        !text(session.billingTicket, 2048) || /[\r\n]/.test(session.billingTicket) ||
        !/^[a-fA-F0-9]{64}$/.test(session.deviceId) || !text(session.agentId, 128) ||
        !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Date.now() ||
        !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 ||
        typeof socketFactory !== 'function' || typeof onFailure !== 'function') {
      throw failure('INVALID_BILLING_SESSION')
    }
    const { sessionId, billingTicket, deviceId, agentId, expiresAt } = session
    this.session = Object.freeze({ sessionId, billingTicket, deviceId, agentId, expiresAt })
    Object.assign(this, { socketFactory, onFailure, timeoutMs })
    this.state = 'new'
    this.pending = []
    this.pendingBytes = 0
    this.sequence = 0
    this.lastAck = 0
    this.reportedUsage = new Map()
  }

  async start() {
    if (this.state === 'closed') throw this.error || failure('BILLING_CLOSED')
    if (this.startPromise) return this.startPromise
    this.startPromise = new Promise((resolve, reject) => {
      this.resolveStart = resolve; this.rejectStart = reject
    })
    this.state = 'connecting'
    this.startTimer = setTimeout(() => this.fail('BILLING_TIMEOUT'), this.timeoutMs)
    this.expiryTimer = setTimeout(() => this.fail('BILLING_EXPIRED'),
      Math.max(1, Math.min(2147483647, this.session.expiresAt - Date.now())))
    this.expiryTimer.unref?.()
    try {
      if (this.session.expiresAt <= Date.now()) throw new Error('expired')
      const socket = this.socketFactory(BILLING_URL + encodeURIComponent(this.session.sessionId), {})
      this.socket = socket
      this.listeners = {
        open: () => this.send({ type: 'session_register', role: 'producer',
          sessionId: this.session.sessionId, deviceId: this.session.deviceId,
          agentId: this.session.agentId, billingTicket: this.session.billingTicket }),
        message: event => this.receive(event.data),
        error: () => this.fail('BILLING_DISCONNECTED'),
        close: event => {
          const last = this.pending[0]
          if (this.state === 'closing' && event.code === 1000 && this.inFlight &&
              this.pending.length === 1 && last.eventType === 'session_closed') this.finish(true)
          else this.fail('BILLING_DISCONNECTED')
        },
      }
      for (const [name, listener] of Object.entries(this.listeners)) socket.addEventListener(name, listener)
    } catch { this.fail('BILLING_UNAVAILABLE') }
    return this.startPromise
  }

  report(eventType, fields = {}) {
    if (this.state !== 'ready') return false
    if (this.session.expiresAt <= Date.now()) { this.fail('BILLING_EXPIRED'); return false }
    if (!events.has(eventType)) { this.fail('BILLING_INVALID_EVENT'); return false }
    return this.enqueue(eventType, fields)
  }

  enqueue(eventType, fields) {
    try {
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('fields')
      const copied = {}
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'finished' ? typeof value !== 'boolean'
          : numbers.has(key) ? !Number.isSafeInteger(value) || value < 0
          : Object.hasOwn(strings, key) ? typeof value !== 'string' || value.length > strings[key]
          : true) throw new Error('field')
        if (key === 'tokenCount' && eventType !== 'usage') throw new Error('tokens')
        copied[key] = value
      }
      if (copied.tokenCount > 0 && !text(copied.responseId, 128)) throw new Error('response')
      if (copied.tokenCount > 0 && this.reportedUsage.has(copied.responseId)) {
        if (this.reportedUsage.get(copied.responseId) !== copied.tokenCount) throw new Error('changed usage')
        return true
      }
      const sequence = this.sequence + 1
      if (!Number.isSafeInteger(sequence)) throw new Error('sequence')
      const raw = JSON.stringify({ type: 'session_event', sessionId: this.session.sessionId,
        sequence, requestId: `billing-${sequence}`, eventType,
        finished: ['output_completed', 'session_closed', 'interrupted', 'speech_timeout', 'error', 'usage'].includes(eventType),
        ...copied })
      const bytes = Buffer.byteLength(raw)
      if (bytes > 65536) throw new Error('size')
      // Reserve capacity for the final close event, never evict unacknowledged usage.
      if (eventType !== 'session_closed' &&
          (this.pending.length >= maxPending || this.pendingBytes + bytes > maxBytes ||
            copied.tokenCount > 0 && this.reportedUsage.size >= 1024)) {
        this.fail('BILLING_QUEUE_FULL'); return false
      }
      this.sequence = sequence
      this.pending.push({ sequence, eventType, raw, bytes })
      this.pendingBytes += bytes
      if (copied.tokenCount > 0) this.reportedUsage.set(copied.responseId, copied.tokenCount)
      this.flush()
      return this.state !== 'closed' || this.completed
    } catch { this.fail('BILLING_INVALID_EVENT'); return false }
  }

  send(value) {
    if (this.state === 'closed') return false
    try {
      if (this.socket.readyState !== 1 || this.socket.bufferedAmount > maxBytes) throw new Error('socket')
      this.socket.send(typeof value === 'string' ? value : JSON.stringify(value))
      return true
    } catch { this.fail('BILLING_DISCONNECTED'); return false }
  }

  flush() {
    if (!['ready', 'closing'].includes(this.state) || this.inFlight || !this.pending.length) return
    this.inFlight = true
    this.ackTimer = setTimeout(() => this.fail('BILLING_TIMEOUT'), this.timeoutMs)
    this.send(this.pending[0].raw)
  }

  receive(raw) {
    if (this.state === 'closed') return
    try {
      if (typeof raw !== 'string' || raw.length > 65536) throw new Error('size')
      const message = JSON.parse(raw)
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('message')
      // Error envelopes may omit sessionId; the live socket still scopes them.
      if (message.type === 'error' && (message.sessionId === undefined ||
          message.sessionId === this.session.sessionId)) { this.fail('BILLING_REJECTED'); return }
      if (message.sessionId !== this.session.sessionId) throw new Error('session')
      if (message.type === 'session_ready') {
        if (message.role !== 'producer') throw new Error('role')
        if (this.state !== 'connecting') return
        this.state = 'ready'
        clearTimeout(this.startTimer)
        this.lastSeen = Date.now()
        this.heartbeat = setInterval(() => {
          if (Date.now() - this.lastSeen >= 30000) this.fail('BILLING_TIMEOUT')
          else this.send({ type: 'heartbeat', sessionId: this.session.sessionId })
        }, 10000)
        this.heartbeat.unref?.()
        this.resolveStart()
        this.resolveStart = this.rejectStart = null
        return
      }
      if (!['ready', 'closing'].includes(this.state)) throw new Error('not ready')
      if (message.type === 'pong') { this.lastSeen = Date.now(); return }
      if (message.type !== 'event_ack' || !Number.isSafeInteger(message.sequence) ||
          message.sequence < 1 || typeof message.duplicate !== 'boolean') throw new Error('ack')
      this.lastSeen = Date.now()
      if (message.sequence <= this.lastAck) return
      if (!this.inFlight || message.sequence !== this.pending[0]?.sequence) throw new Error('sequence')
      clearTimeout(this.ackTimer)
      const accepted = this.pending.shift()
      this.pendingBytes -= accepted.bytes
      this.lastAck = accepted.sequence
      this.inFlight = false
      // ACK precedes server accumulation/settlement; this is not a debit receipt.
      if (accepted.eventType === 'session_closed') this.finish(true)
      else this.flush()
    } catch { this.fail('BILLING_PROTOCOL_ERROR') }
  }

  async close() {
    if (this.closePromise) return this.closePromise
    if (this.state === 'closed') return Boolean(this.completed)
    if (['new', 'connecting'].includes(this.state)) { this.finish(true); return true }
    this.closePromise = new Promise(resolve => { this.resolveClose = resolve })
    this.state = 'closing'
    this.closeTimer = setTimeout(() => this.fail('BILLING_TIMEOUT'), this.timeoutMs)
    this.enqueue('session_closed', { finished: true })
    return this.closePromise
  }

  fail(code) {
    if (this.state === 'closed') return
    this.error = failure(code)
    this.rejectStart?.(this.error)
    this.finish(false)
    try { this.onFailure(this.error) } catch { /* Transport cleanup must survive caller errors. */ }
  }

  finish(completed) {
    this.completed = completed
    this.state = 'closed'
    for (const timer of [this.startTimer, this.ackTimer, this.closeTimer, this.expiryTimer]) clearTimeout(timer)
    clearInterval(this.heartbeat)
    this.rejectStart?.(this.error || failure('BILLING_CLOSED'))
    this.resolveStart = this.rejectStart = null
    for (const [name, listener] of Object.entries(this.listeners || {})) this.socket.removeEventListener(name, listener)
    try { this.socket?.close(1000, 'billing complete') } catch {}
    this.pending.length = 0
    this.pendingBytes = 0
    this.reportedUsage.clear()
    this.resolveClose?.(completed)
  }
}
