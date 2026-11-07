import { MoodState, classifyHover, classifyProximity, idleLevel, moodAction, reactiveKinds, moodDrift } from './device-mood-policy.mjs'
import { sampleTextAction } from '../src/text-motion.mjs'
import { names } from '../src/expression.mjs'
import { pipeline } from '../src/control.mjs'

const hoverKinds = { STROKE: 'stroke', FLICK: 'swipe' }
const lookStaleMs = 1600
// One driver owns the face from start to finish. Every value it sends is eased
// towards a target instead of being written outright, so an action can never
// snap on or off, a follow never snaps back, and the renderer is never pushed
// into a sudden jump between our expression and its own idle animation.
const emitMs = 24
const poseKeys = ['pitch', 'yaw', 'roll', 'gazeX', 'gazeY', 'depth']
const weightTau = 0.14, poseTau = 0.12, aimTau = 0.14
const blinkMs = 220
// A parked cursor is not an audience: after this long without a real change the
// pet stops staring at it and gets on with its own business.
const stillMs = 8000
const clamp = value => Math.max(-1, Math.min(1, value))
const rate = (seconds, tau) => 1 - Math.exp(-Math.max(0, seconds) / tau)
const zeroWeights = () => Object.fromEntries(names.map(name => [name, 0]))
const zeroPose = () => ({ version: 1, owned: true, pitch: 0, yaw: 0, roll: 0, gazeX: 0, gazeY: 0, depth: 0 })

// Idle behaviour is fully decoupled from the conversation: it only plays while
// nothing else owns the face (no reply, no action preview, no live touch).
export function installMoodDirector({ surface, canPlay, onExpression, faceBank = null,
  now = () => performance.now(), random = Math.random, pulseMs = 5000 }) {
  let state = new MoodState({ random })
  let bank = faceBank && typeof faceBank.sample === 'function' ? faceBank : null
  // Which face the pet is wearing is worth seeing from the outside: a debug
  // probe should not have to guess whether the library was picked up.
  surface.dataset.bank = bank ? 'clips' : 'synth'
  let playing = null, animation = 0, idleTimer = 0, pulseTimer = 0
  let lastEventAt = now(), lastReactionAt = -Infinity, pending = '', hover = null
  let look = null, aim = { x: 0, y: 0 }, lastDistance = null, idle = 0
  let shown = null, emitAt = -Infinity, lastFrameAt = now(), blinkAt = 0, blinkUntil = 0, hoverTimer = 0
  let released = false
  let lastPoint = null, lastMoveAt = now(), wander = null, wanderAt = now() + 1500

  const side = () => !hover ? '' : hover.x / hover.width < 0.42 ? 'left' : hover.x / hover.width > 0.58 ? 'right' : ''
  // Nothing to hand over: the aim rides on top of whatever the action asks for,
  // so a gesture taking over from a follow is a change of target, not a jump.
  const aimOn = (weights, pose) => {
    pose.yaw += aim.x * 0.34
    pose.pitch += aim.y * 0.26
    pose.roll += -aim.x * 0.02
    pose.gazeX += aim.x * 0.2
    pose.gazeY += -aim.y * 0.2
    for (const [name, value] of [['eyeLookOutLeft', aim.x], ['eyeLookInRight', aim.x],
      ['eyeLookInLeft', -aim.x], ['eyeLookOutRight', -aim.x], ['eyeLookDownLeft', aim.y],
      ['eyeLookDownRight', aim.y], ['eyeLookUpLeft', -aim.y], ['eyeLookUpRight', -aim.y]]) {
      if (value > 0) weights[name] = Math.max(weights[name] || 0, value * 0.2)
    }
  }
  // A face that is owned but perfectly still looks frozen; a slow breath keeps
  // it alive without reading as a gesture.
  const breathe = (pose, stamp) => {
    // The breath gives way to a real aim: while the pet is looking at the
    // cursor, micro motion would only fight the follow.
    const calm = 1 - Math.min(1, Math.hypot(aim.x, aim.y))
    if (calm <= 0) return
    const t = stamp / 1000
    pose.yaw += (Math.sin(t * 0.29) * 0.022 + Math.sin(t * 0.11 + 1.3) * 0.014) * calm
    pose.pitch += Math.sin(t * 0.21 + 2.2) * 0.016 * calm
    pose.roll += Math.sin(t * 0.17) * 0.01 * calm
    pose.depth += Math.sin(t * 0.23 + 0.7) * 0.018 * calm
    pose.gazeX += Math.sin(t * 0.27 + 0.4) * 0.08 * calm
    pose.gazeY += Math.sin(t * 0.19 + 1.9) * 0.05 * calm
  }
  // Left alone, the eyes keep drifting to random points instead of freezing on
  // the last direction the cursor happened to sit in.
  const glance = stamp => {
    if (wander && stamp >= wander.until) { wander = null; wanderAt = stamp + 2400 + random() * 4200 }
    if (!wander && stamp >= wanderAt && !look && !playing) {
      wander = { x: (random() * 2 - 1) * 0.38, y: (random() * 2 - 1) * 0.2, until: stamp + 1100 + random() * 1500 }
    }
    return wander
  }
  const alone = stamp => idle > 0 || stamp - lastMoveAt >= stillMs
  const blink = stamp => {
    if (!blinkAt) blinkAt = stamp + 1200 + random() * 3000
    if (!blinkUntil && stamp >= blinkAt) blinkUntil = stamp + blinkMs
    if (!blinkUntil) return 0
    if (stamp >= blinkUntil) { blinkUntil = 0; blinkAt = stamp + 1800 + random() * 4200; return 0 }
    return Math.sin((1 - (blinkUntil - stamp) / blinkMs) * Math.PI)
  }
  const target = stamp => {
    const weights = zeroWeights(), pose = zeroPose()
    if (playing) {
      // The gesture layer still owns the head, the gaze and the depth; a clip
      // from the expression library owns the face itself, so an emotion reads
      // as a real performance instead of a handful of blendshapes held still.
      const seconds = (stamp - playing.started) / 1000
      const sample = sampleTextAction(playing, seconds)
      for (const key of poseKeys) pose[key] = sample.pose[key] || 0
      const face = playing.clip ? bank?.sample(playing.clip, playing.clipAt + seconds) : null
      if (face) for (const name of names) weights[name] = face[name]
      else for (const name of names) weights[name] = sample.weights[name] || 0
      weights.eyeBlinkLeft = weights.eyeBlinkRight = 0
    }
    if (aim.x || aim.y) aimOn(weights, pose)
    breathe(pose, stamp)
    for (const key of poseKeys) pose[key] = clamp(pose[key])
    return { weights, pose }
  }
  const ease = (goal, dt) => {
    if (!shown) { shown = { weights: { ...goal.weights }, pose: { ...goal.pose } }; return }
    const weightRate = rate(dt, weightTau), poseRate = rate(dt, poseTau)
    for (const name of names) shown.weights[name] += ((goal.weights[name] || 0) - shown.weights[name]) * weightRate
    for (const key of poseKeys) shown.pose[key] += (goal.pose[key] - shown.pose[key]) * poseRate
  }
  const emit = stamp => {
    const blinkValue = blink(stamp)
    const weights = { ...shown.weights }
    weights.eyeBlinkLeft = Math.max(weights.eyeBlinkLeft || 0, blinkValue)
    weights.eyeBlinkRight = Math.max(weights.eyeBlinkRight || 0, blinkValue)
    surface.dataset.gaze = `${aim.x.toFixed(2)},${aim.y.toFixed(2)}`
    onExpression({ type: 'expression', pipeline, speaking: false, weights,
      source: playing ? 'mood' : look || wander ? 'gaze' : 'ambient',
      pose: { ...shown.pose, version: 1, owned: true } })
  }
  // The loop never stops on its own: it idles while another owner has the face
  // and picks the expression back up without a snap.
  function tick() {
    animation = 0
    const stamp = now()
    const dt = Math.min(0.12, Math.max(0.001, (stamp - lastFrameAt) / 1000))
    lastFrameAt = stamp
    // Another owner (a reply, a preview, a touch) has the face: let go once and
    // wait, instead of writing a neutral frame that would fight with it.
    if (!canPlay()) { if (!released) { released = true; release(); schedule() } }
    else {
      released = false
      if (playing && stamp - playing.started >= playing.duration * 1000) { playing = null; schedule() }
      const fresh = look && stamp - look.at <= lookStaleMs
      // With the cursor parked the pet looks around by itself; a live cursor
      // always wins, and a glance never starts while an action is playing.
      const roaming = !fresh && !playing ? glance(stamp) : null
      const goal = roaming || { x: 0, y: 0 }
      const aimRate = rate(dt, aimTau)
      aim.x += ((fresh ? look.x : goal.x) - aim.x) * aimRate
      aim.y += ((fresh ? look.y : goal.y) - aim.y) * aimRate
      // Only drop the follow once the head has actually glided back to centre.
      if (!fresh && !roaming && Math.abs(aim.x) < 0.004 && Math.abs(aim.y) < 0.004) { aim.x = aim.y = 0; look = null }
      ease(target(stamp), dt)
      if (stamp - emitAt >= emitMs) { emitAt = stamp; emit(stamp) }
    }
    animation = requestAnimationFrame(tick)
  }
  const release = () => {
    playing = null
    look = null
    wander = null
    aim.x = aim.y = 0
    shown = null
    emitAt = -Infinity
    delete surface.dataset.gaze
  }
  const play = motion => {
    if (!motion || !Number.isFinite(motion.duration) || motion.duration <= 0) return
    // A captured clip is longer than most gestures, so start somewhere inside it:
    // the same emotion then never replays the same opening frames.
    const clip = bank?.clip(motion.emotion, motion.duration, random)
    const duration = clip ? Math.min(motion.duration, clip.duration) : motion.duration
    playing = { ...motion, duration, started: now(), clip, clipAt: clip ? random() * Math.max(0, clip.duration - duration) : 0 }
  }
  const schedule = () => {
    if (idleTimer) clearTimeout(idleTimer)
    const drowsy = state.drowsiness >= 0.55
    const unattended = alone(now())
    // Nobody around: keep the changes coming. Dozing off: stretch them out.
    const base = drowsy ? 5000 : unattended ? 1400 : 5000
    const spread = drowsy ? 5000 : unattended ? 2600 : 6000
    idleTimer = setTimeout(() => {
      idleTimer = 0
      if (!canPlay() || playing) return
      if (pending) { const kind = pending; pending = ''; lastReactionAt = now(); play(moodAction(state, { kind, random, side: side() })) }
      else play(moodAction(state, { random, side: side(), wander: alone(now()) }))
    }, base + random() * spread)
  }
  const react = kind => {
    if (!reactiveKinds.has(kind)) return
    const urgent = kind === 'stroke' || kind === 'double-tap' || kind === 'approach' || state.mood === 'annoyed'
    if (now() - lastReactionAt < (urgent ? 500 : 1400)) return
    if (!canPlay()) { pending = kind; return }
    lastReactionAt = now()
    play(moodAction(state, { kind, random, side: side() }))
  }
  const observe = kind => {
    // Unrecognised gestures carry no kind; they must not queue an action.
    if (!kind) return
    lastEventAt = now()
    state.apply(kind, now())
    surface.dataset.mood = state.mood
    react(kind)
  }
  // Cursor samples arrive from the main process, so the pet reacts to the mouse
  // even when it is far outside its own window.
  const point = data => {
    if (!canPlay() || !data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return
    const stamp = now()
    // Only a real change counts as company; the 50 ms pass-through keeps
    // repeating the same parked position and must not hold the gaze open.
    const moved = !lastPoint || Math.abs(data.x - lastPoint.x) > 0.02 || Math.abs(data.y - lastPoint.y) > 0.02 ||
      (Number.isFinite(data.distance) && Number.isFinite(lastPoint.distance) &&
        Math.abs(data.distance - lastPoint.distance) > 24)
    if (moved) {
      lastMoveAt = stamp
      lastPoint = { x: data.x, y: data.y, distance: data.distance }
      look = { x: Math.max(-1, Math.min(1, data.x)), y: Math.max(-1, Math.min(1, data.y)), at: stamp }
    }
    lastEventAt = stamp
    const distance = data.distance
    const proximity = classifyProximity(lastDistance, distance)
    if (Number.isFinite(distance)) lastDistance = distance
    if (proximity) observe(proximity)
    const level = idleLevel(data.idle)
    if (level !== idle) {
      const rising = level > idle
      idle = level
      observe(rising ? 'idle' : 'focus')
    }
  }
  const local = event => {
    const bounds = surface.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top, width: bounds.width, height: bounds.height }
  }
  const enter = event => {
    if (!canPlay()) return
    const p = local(event)
    hover = { x: p.x, y: p.y, width: p.width, height: p.height, path: 0, reversals: 0, samples: 1, sign: 0, started: now(), updated: now() }
    // Wait for the cursor to actually rest on the figure; merely sweeping past
    // the window must not jerk the pet into a reaction.
    clearTimeout(hoverTimer)
    hoverTimer = setTimeout(() => { hoverTimer = 0; if (hover) observe('hover') }, 220)
  }
  const move = event => {
    if (!hover || !canPlay()) return
    const p = local(event), dx = p.x - hover.x, dy = p.y - hover.y, step = Math.hypot(dx, dy)
    if (step < 0.5) return
    hover.path += step
    hover.samples++
    if (step >= 5) {
      const sign = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : Math.sign(dy)
      if (sign && hover.sign && sign !== hover.sign) hover.reversals++
      if (sign) hover.sign = sign
    }
    hover.x = p.x; hover.y = p.y; hover.updated = now()
    lastEventAt = now()
    const elapsed = hover.updated - hover.started
    const kind = hoverKinds[classifyHover({ path: hover.path, reversals: hover.reversals, samples: hover.samples,
      duration: elapsed, speed: hover.path / Math.max(0.001, elapsed / 1000) })]
    if (!kind) return
    // Reset the window so a long continuous stroke keeps rewarding the pet.
    hover.path = 0; hover.reversals = 0; hover.sign = 0; hover.started = hover.updated
    observe(kind)
  }
  const leave = () => { clearTimeout(hoverTimer); hoverTimer = 0; hover = null; observe('leave') }
  const blurred = () => { hover = null; observe('blur') }
  const visibility = () => { if (document.hidden) { hover = null; cancel() } }
  const pulse = () => {
    if (document.hidden) return
    const drift = pulseMs / 1000
    state.decay(drift)
    // Drowsiness means "nobody is using the machine", not "the cursor is parked":
    // while the machine is in use the pet stays awake however still the mouse is.
    if (idle === 0) { state.drowsiness = Math.max(0, state.drowsiness - moodDrift.drowsiness * drift); state.refresh() }
    // A silent machine with a parked cursor is the one case that means "nobody".
    if (now() - lastEventAt >= 20000 || idle > 0 && now() - lastMoveAt >= stillMs) state.apply('idle', now())
    surface.dataset.mood = state.mood
    if (!canPlay() || playing) return
    if (pending) { const kind = pending; pending = ''; lastReactionAt = now(); play(moodAction(state, { kind, random, side: side() })) }
    else if (!idleTimer) schedule()
  }
  function cancel() { release(); schedule() }
  function reset() {
    state = new MoodState({ random })
    pending = ''; hover = lastPoint = lastDistance = null; idle = 0
    clearTimeout(hoverTimer); hoverTimer = 0
    lastEventAt = lastMoveAt = now(); lastReactionAt = -Infinity
    wanderAt = now() + 1500; blinkAt = blinkUntil = 0
    surface.dataset.mood = state.mood
    cancel()
  }
  const listeners = [[surface, 'pointerenter', enter], [surface, 'pointermove', move], [surface, 'pointerleave', leave],
    [window, 'focus', () => observe('focus')], [window, 'blur', blurred], [document, 'visibilitychange', visibility]]
  for (const [target, name, handler] of listeners) target.addEventListener(name, handler)
  pulseTimer = setInterval(pulse, pulseMs)
  schedule()
  animation = requestAnimationFrame(tick)
  return { observe, point, cancel, reset, get state() { return state },
    // The bank is fetched after the window is up, so it arrives late or not at
    // all; both cases keep the synthesised face working.
    use: value => { bank = value && typeof value.sample === 'function' ? value : null; surface.dataset.bank = bank ? 'clips' : 'synth' },
    get bank() { return bank },
    get mood() { return state.mood },
    get playing() { return Boolean(playing) },
    get looking() { return Boolean(look) },
    dispose() {
      release()
      if (animation) cancelAnimationFrame(animation)
      animation = 0
      clearTimeout(idleTimer); clearTimeout(hoverTimer); clearInterval(pulseTimer)
      hover = null
      for (const [target, name, handler] of listeners) target.removeEventListener(name, handler)
    } }
}
