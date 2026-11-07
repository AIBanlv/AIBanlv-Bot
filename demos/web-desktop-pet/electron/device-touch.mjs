import { neutralExpression } from '../src/lam-track.mjs'
import { classifyTouch } from './device-touch-policy.mjs'

const clamp = value => Math.max(-1, Math.min(1, value))

// Relative drag and damping follow Control's touch-interaction / TouchAttention.
export class TouchAttention {
  x = 0; y = 0; smile = 0; active = false
  begin(x, y, width, height, now) {
    if (![x, y, width, height, now].every(Number.isFinite) || width <= 0 || height <= 0) return false
    this.start = { x, y }; this.last = { x, y }; this.width = width; this.height = height
    this.range = Math.min(width, height) * 0.26
    this.path = 0; this.excursion = 0; this.samples = 1
    this.started = this.updated = now; this.active = true; this.stroking = false
    this.targetX = (2 * x / width - 1) * 0.25
    this.targetY = (2 * y / height - 1) * 0.15
    return true
  }
  move(x, y, now) {
    if (!this.active || ![x, y, now].every(Number.isFinite)) return
    this.path += Math.hypot(x - this.last.x, y - this.last.y)
    this.excursion = Math.max(this.excursion, Math.hypot(x - this.start.x, y - this.start.y))
    this.samples++
    this.last = { x, y }; this.updated = now
    this.targetX = clamp((2 * this.start.x / this.width - 1) * 0.25 + (x - this.start.x) / this.range)
    this.targetY = clamp((2 * this.start.y / this.height - 1) * 0.15 + (y - this.start.y) / this.range)
    if (now - this.started >= 220 && this.path >= 22) this.stroking = true
  }
  gesture(now) {
    const duration = now - this.started, dx = this.last.x - this.start.x, dy = this.last.y - this.start.y
    const distance = Math.hypot(dx, dy), speed = this.path / Math.max(0.001, duration / 1000)
    return { gesture_type: classifyTouch({ duration, dx, dy, distance, speed,
      path: this.path, excursion: this.excursion, samples: this.samples }),
    start_position: { x: this.start.x / this.width, y: this.start.y / this.height },
    end_position: { x: this.last.x / this.width, y: this.last.y / this.height },
    duration, movement_distance: this.path, movement_speed: speed,
    movement_direction: distance < 14 ? 'none' : Math.abs(dx) >= Math.abs(dy) ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'up' : 'down' }
  }
  end() { this.active = false; this.targetX = this.targetY = 0; this.stroking = false }
  sample(now, dt) {
    if (this.active && now - this.updated > 10000) this.end()
    const alpha = 1 - Math.exp(-Math.max(0, Math.min(0.1, dt)) * (this.active ? 32 : 36))
    this.x += ((this.targetX || 0) - this.x) * alpha
    this.y += ((this.targetY || 0) - this.y) * alpha
    this.smile += ((this.stroking ? 0.32 : 0) - this.smile) * alpha
    if (!this.active && Math.max(Math.abs(this.x), Math.abs(this.y), this.smile) < 0.001) {
      this.x = this.y = this.smile = 0
      return null
    }
    const value = neutralExpression()
    Object.assign(value.weights, { mouthSmileLeft: this.smile, mouthSmileRight: this.smile,
      eyeSquintLeft: this.smile * 0.3, eyeSquintRight: this.smile * 0.3,
      eyeLookOutLeft: Math.max(0, this.x) * 0.24, eyeLookInRight: Math.max(0, this.x) * 0.24,
      eyeLookInLeft: Math.max(0, -this.x) * 0.24, eyeLookOutRight: Math.max(0, -this.x) * 0.24,
      eyeLookDownLeft: Math.max(0, this.y) * 0.24, eyeLookDownRight: Math.max(0, this.y) * 0.24,
      eyeLookUpLeft: Math.max(0, -this.y) * 0.24, eyeLookUpRight: Math.max(0, -this.y) * 0.24 })
    Object.assign(value.pose, { owned: true, pitch: this.y * 0.70, yaw: this.x * 0.62,
      roll: -this.x * 0.62 * 0.06, gazeX: this.x * 0.24, gazeY: -this.y * 0.24 })
    return value
  }
}

export class TouchReplyGate {
  pendingAt = Infinity
  lastAt = -Infinity
  cancel() { this.pendingAt = Infinity }
  finish(stroked, now) { this.pendingAt = stroked && now - this.lastAt >= 4000 ? now + 550 : Infinity }
  take(now) {
    if (now < this.pendingAt) return false
    this.cancel(); this.lastAt = now
    return true
  }
}

export function installTouchInteraction({ surface, canInteract, onExpression, onTouch = () => {}, onGesture = () => {},
  onEngage = () => {} }) {
  let attention = new TouchAttention(), pointer = null, keyboard = false, animation = 0, last = 0, presenting = false
  let replyTimer = 0
  const replies = new TouchReplyGate()
  let pendingTap = null, doubleCandidate = false, interactionId = ''
  const localPoint = event => {
    const bounds = surface.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top, width: bounds.width, height: bounds.height }
  }
  const clearVisual = () => {
    const captured = pointer
    pointer = null; keyboard = false
    if (captured !== null && surface.hasPointerCapture(captured)) surface.releasePointerCapture(captured)
    cancelAnimationFrame(animation); animation = 0; attention = new TouchAttention()
    surface.dataset.touchState = 'idle'
    if (presenting) { presenting = false; onExpression(neutralExpression()) }
  }
  const cancel = () => {
    clearTimeout(replyTimer); replyTimer = 0; replies.cancel()
    pendingTap = null; doubleCandidate = false; clearVisual()
  }
  const finish = () => {
    const now = performance.now(), event = attention.gesture(now)
    if (event.gesture_type === 'TAP' && doubleCandidate) event.gesture_type = 'DOUBLE_TAP'
    pendingTap = event.gesture_type === 'TAP' ? { at: now, ...attention.last } : null
    doubleCandidate = false
    Object.assign(event, { event_id: `${interactionId}:event`, interaction_id: interactionId,
      timestamp: Date.now(), interaction_region: 'avatar' })
    // The mood director sees every recognised gesture, even when the reply gate
    // throttles the conversation.
    onGesture(event)
    replies.finish(event.gesture_type !== 'UNKNOWN', now)
    attention.end()
    clearTimeout(replyTimer)
    replyTimer = setTimeout(() => {
      replyTimer = 0
      if (canInteract() && replies.take(performance.now())) {
        surface.dataset.touchGesture = event.gesture_type
        onTouch(event)
      }
      else replies.cancel()
    }, 551)
  }
  const tick = now => {
    animation = 0
    if (!canInteract()) { cancel(); return }
    const value = attention.sample(now, (now - last) / 1000)
    last = now
    surface.dataset.touchState = attention.stroking ? 'stroking' : attention.active ? 'following' : 'idle'
    if (!value) { clearVisual(); return }
    presenting = true; onExpression(value)
    animation = requestAnimationFrame(tick)
  }
  const start = (x, y, width, height, now) => {
    interactionId = crypto.randomUUID()
    // Touch is an interruption like speech: a hand on the pet outranks whatever
    // it was saying, and the stroke feedback needs the face to itself.
    onEngage()
    attention.begin(x, y, width, height, now)
    last = now
    if (!animation) animation = requestAnimationFrame(tick)
  }
  const down = event => {
    if (event.button !== 0 || !event.isPrimary || !canInteract() || pointer !== null) return
    const p = localPoint(event)
    const prior = pendingTap, now = performance.now()
    cancel()
    doubleCandidate = Boolean(prior && now - prior.at <= 300 && Math.hypot(p.x - prior.x, p.y - prior.y) <= 28)
    start(p.x, p.y, p.width, p.height, performance.now())
    pointer = event.pointerId; surface.setPointerCapture(pointer); surface.focus(); event.preventDefault()
  }
  const move = event => {
    if (pointer !== event.pointerId) return
    if (!(event.buttons & 1)) { cancel(); return }
    const p = localPoint(event)
    if (p.x < 0 || p.y < 0 || p.x > p.width || p.y > p.height) { cancel(); return }
    attention.move(p.x, p.y, performance.now())
  }
  const end = event => {
    if (pointer !== event.pointerId) return
    const captured = pointer; pointer = null
    if (event.type === 'pointerup') {
      const p = localPoint(event)
      if (p.x < 0 || p.y < 0 || p.x > p.width || p.y > p.height) { cancel(); return }
      attention.move(p.x, p.y, performance.now())
      finish()
    }
    else cancel()
    if (surface.hasPointerCapture(captured)) surface.releasePointerCapture(captured)
  }
  const keydown = event => {
    if (!['Enter', ' '].includes(event.key)) return
    event.preventDefault()
    if (event.repeat || !canInteract()) return
    cancel(); keyboard = true
    const { width, height } = surface.getBoundingClientRect(), now = performance.now()
    start(width / 2, height / 2, width, height, now - 220)
    attention.move(width / 2 + 24, height / 2, now)
  }
  const keyup = event => {
    if (keyboard && ['Enter', ' '].includes(event.key)) { keyboard = false; finish() }
  }
  const hidden = () => { if (document.hidden) cancel() }
  const listeners = [[surface, 'pointerdown', down], [surface, 'pointermove', move],
    [surface, 'pointerup', end], [surface, 'pointercancel', cancel],
    [surface, 'lostpointercapture', end], [surface, 'keydown', keydown], [surface, 'keyup', keyup],
    [surface, 'blur', cancel], [window, 'blur', cancel], [window, 'resize', cancel],
    [document, 'visibilitychange', hidden]]
  for (const [target, name, handler] of listeners) target.addEventListener(name, handler)
  return { cancel, active: () => pointer !== null || keyboard || attention.active || presenting, dispose() {
    cancel()
    for (const [target, name, handler] of listeners) target.removeEventListener(name, handler)
  } }
}
