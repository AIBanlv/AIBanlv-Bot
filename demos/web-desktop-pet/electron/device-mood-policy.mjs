import { motionTags } from '../src/text-motion.mjs'

// Local judgement only: this module never calls a model. It reads the pointer the
// way Mochi does (stroking builds intimacy, repeated poking builds irritation) and
// keeps Glitch-style internal emotion variables that drive the idle behaviour.
export const moodKinds = new Set(['stroke', 'long-press', 'tap', 'double-tap', 'swipe', 'hover', 'leave',
  'focus', 'blur', 'idle', 'approach', 'retreat'])

// Gestures worth an immediate visible answer; the rest only move the variables.
export const reactiveKinds = new Set(['stroke', 'long-press', 'tap', 'double-tap', 'swipe', 'hover', 'approach'])

// Screen-wide cursor sampling: this close the pet notices you coming, this far
// it lets you go without turning the whole window into a reaction trigger.
export const approachPx = 320
export const retreatPx = 760

export const moodVariables = ['curiosity', 'irritation', 'drowsiness', 'intimacy']

// Per-event push on the internal variables.
const effects = {
  stroke: { intimacy: 0.09, curiosity: 0.05, irritation: -0.3, drowsiness: -0.35 },
  'long-press': { intimacy: 0.05, curiosity: 0.04, irritation: -0.12, drowsiness: -0.2 },
  tap: { curiosity: 0.14, irritation: 0.06, drowsiness: -0.25 },
  'double-tap': { curiosity: 0.16, intimacy: 0.03, irritation: 0.1, drowsiness: -0.3 },
  swipe: { curiosity: 0.1, irritation: 0.08, drowsiness: -0.2 },
  hover: { curiosity: 0.06, drowsiness: -0.18 },
  leave: { curiosity: 0.07, intimacy: -0.01 },
  focus: { curiosity: 0.05, drowsiness: -0.15 },
  blur: { drowsiness: 0.12, curiosity: -0.05 },
  idle: { drowsiness: 0.1, curiosity: -0.06, irritation: -0.04 },
  approach: { curiosity: 0.12, drowsiness: -0.25 },
  retreat: { curiosity: 0.03, drowsiness: 0.04 },
}

// Resting drift per second: the pet calms down, forgets and slowly gets sleepy.
export const moodDrift = { curiosity: -0.02, irritation: -0.05, drowsiness: 0.03, intimacy: -0.004 }

const clamp = value => Math.max(0, Math.min(1, value))

export class MoodState {
  constructor({ random = Math.random } = {}) {
    this.random = random
    this.curiosity = 0.3
    this.irritation = 0
    this.drowsiness = 0.05
    this.intimacy = 0.2
    this.clicks = 0
    this.lastClickAt = -Infinity
    this.lastKind = 'idle'
    this.mood = 'calm'
  }

  apply(kind, now = 0) {
    if (!moodKinds.has(kind)) return this.mood
    if (kind === 'tap' || kind === 'double-tap') {
      this.clicks = now - this.lastClickAt <= 1400 ? this.clicks + 1 : 1
      this.lastClickAt = now
      // The third poke inside a short window is what tips the mood over.
      if (this.clicks >= 3) this.irritation = clamp(this.irritation + 0.3)
    } else if (kind !== 'hover') {
      this.clicks = 0
      this.lastClickAt = -Infinity
    }
    const effect = effects[kind] || {}
    for (const name of moodVariables) this[name] = clamp(this[name] + (effect[name] || 0))
    this.lastKind = kind
    return this.refresh()
  }

  decay(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return this.mood
    for (const [name, rate] of Object.entries(moodDrift)) this[name] = clamp(this[name] + rate * seconds)
    return this.refresh()
  }

  refresh() {
    this.mood = this.irritation >= 0.45 ? 'annoyed'
      : this.drowsiness >= 0.55 ? 'sleepy'
      : this.intimacy >= 0.55 ? 'affectionate'
      : this.curiosity >= 0.5 ? 'curious'
      : 'calm'
    return this.mood
  }
}

// Idle presets, written in the existing text-motion tags so the idle behaviour and
// the typed actions share one library.
export const moodActions = {
  annoyed: [
    { head: 'shake', emotion: 'angry', gaze: 'none', depth: 'back' },
    { head: 'shake', emotion: 'disgusted', gaze: 'lower', depth: 'none' },
  ],
  sleepy: [
    { head: 'slow_nod', emotion: 'neutral', gaze: 'lower', depth: 'back' },
    { head: 'look_down', emotion: 'sad', gaze: 'lower', depth: 'none' },
  ],
  affectionate: [
    { head: 'nod', emotion: 'warm', gaze: 'contact', depth: 'forward' },
    { head: 'tilt', emotion: 'happy', gaze: 'gentle', depth: 'cycle' },
  ],
  curious: [
    { head: 'tilt', emotion: 'curious', gaze: 'thinking', depth: 'forward' },
    { head: 'look_up', emotion: 'surprised', gaze: 'up', depth: 'none' },
  ],
  calm: [
    { head: 'none', emotion: 'neutral', gaze: 'soft', depth: 'none' },
    { head: 'look_left', emotion: 'neutral', gaze: 'left', depth: 'none' },
    { head: 'look_right', emotion: 'neutral', gaze: 'right', depth: 'none' },
    { head: 'slow_nod', emotion: 'caring', gaze: 'gentle', depth: 'none' },
  ],
}

// Immediate answers to a gesture, played before the pet falls back to its mood.
export const reactionActions = {
  stroke: { head: 'nod', emotion: 'warm', gaze: 'contact', depth: 'forward' },
  'long-press': { head: 'tilt', emotion: 'caring', gaze: 'contact', depth: 'none' },
  tap: { head: 'look_up', emotion: 'curious', gaze: 'up', depth: 'none' },
  'double-tap': { head: 'none', emotion: 'surprised', gaze: 'contact', depth: 'forward' },
  swipe: { head: 'shake', emotion: 'playful', gaze: 'gentle', depth: 'cycle' },
  hover: { head: 'none', emotion: 'curious', gaze: 'contact', depth: 'none' },
  approach: { head: 'look_up', emotion: 'curious', gaze: 'contact', depth: 'forward' },
}

// What the pet does with itself when nobody is interacting: small, varied,
// written in the same tag library so nothing here is a special case downstream.
export const wanderActions = [
  { head: 'look_left', emotion: 'neutral', gaze: 'left', depth: 'none' },
  { head: 'look_right', emotion: 'neutral', gaze: 'right', depth: 'none' },
  { head: 'look_up', emotion: 'curious', gaze: 'up', depth: 'none' },
  { head: 'tilt', emotion: 'thinking', gaze: 'thinking', depth: 'cycle' },
  { head: 'slow_nod', emotion: 'caring', gaze: 'gentle', depth: 'none' },
  { head: 'none', emotion: 'neutral', gaze: 'soft', depth: 'none' },
]

const durations = { annoyed: 2.2, sleepy: 3.4, curious: 2.6, affectionate: 2.8, calm: 2.6 }

export function isValidMoodAction(action) {
  return Boolean(action) && ['head', 'emotion', 'gaze', 'depth'].every(key => motionTags[key].includes(action[key]))
}

export function moodMotion(action, duration = 2.6) {
  return { text: '', pages: [''], duration, head: action.head, emotion: action.emotion,
    gaze: action.gaze, depth: action.depth }
}

export function moodAction(state, { kind = '', random = Math.random, side = '', wander = false } = {}) {
  const reaction = reactionActions[kind]
  if (reaction && isValidMoodAction(reaction)) return moodMotion(reaction, kind === 'stroke' ? 3 : 2.4)
  // Left alone, the pet amuses itself instead of replaying the mood preset -
  // but never at the cost of its mood: a sleepy or annoyed pet keeps its own
  // repertoire, only a calm one starts looking around.
  if (wander && (state?.mood || 'calm') === 'calm') {
    let chosen = wanderActions[Math.min(wanderActions.length - 1, Math.floor(random() * wanderActions.length))]
    if (side && random() < 0.6) chosen = wanderActions.find(preset => preset.head === `look_${side}`) || chosen
    if (!isValidMoodAction(chosen)) chosen = moodActions.calm[0]
    return moodMotion(chosen, 1.8 + random() * 1)
  }
  const mood = state?.mood || 'calm'
  const presets = moodActions[mood] || moodActions.calm
  let chosen = presets[Math.min(presets.length - 1, Math.floor(random() * presets.length))]
  if (side && mood === 'calm' && random() < 0.6) {
    // Glance towards the side the cursor sits on instead of staring straight ahead.
    chosen = presets.find(preset => preset.head === `look_${side}`) || chosen
  }
  if (!isValidMoodAction(chosen)) chosen = moodActions.calm[0]
  return moodMotion(chosen, durations[mood] || 2.6)
}

// Press-less pointer reading: back-and-forth over the figure counts as stroking,
// a single fast pass is a flick, anything smaller is just hovering.
export function classifyHover(m) {
  if (!m || !Number.isFinite(m.path) || !Number.isFinite(m.duration) || m.duration < 0) return 'UNKNOWN'
  const speed = Number.isFinite(m.speed) ? m.speed : 0
  if (m.reversals >= 2 && m.path >= 56 && speed <= 900) return 'STROKE'
  if (m.reversals >= 1 && m.path >= 24 && speed > 900) return 'FLICK'
  if (m.path >= 10) return 'HOVER'
  return 'UNKNOWN'
}

// Screen-wide cursor distance crossings, used for the "notices you" reactions.
export function classifyProximity(previous, distance) {
  if (!Number.isFinite(previous) || !Number.isFinite(distance) || distance < 0) return ''
  if (distance < approachPx && previous >= approachPx) return 'approach'
  if (distance > retreatPx && previous <= retreatPx) return 'retreat'
  return ''
}

// Coarse system-idle grading: long enough away and the pet is allowed to doze.
export function idleLevel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 0
  if (seconds >= 300) return 3
  if (seconds >= 60) return 2
  if (seconds >= 15) return 1
  return 0
}
