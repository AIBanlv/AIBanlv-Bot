import { names } from './expression.mjs'

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t) }
const articulation = name => name.startsWith('jaw') || name === 'tongueOut' ||
  name.startsWith('mouth') && !/^mouth(Smile|Frown|Dimple)/.test(name)
const gaze = name => name.startsWith('eyeLook')
const blank = () => Object.fromEntries(names.map(name => [name, 0]))

// Face-only port of Control AmbientMotion.choose/ambient/compose. Head/neck
// ownership stays with the existing Windows renderer, touch and mouse adapters.
export class IdleExpressions {
  constructor(library, random = Math.random) {
    if (!Array.isArray(library?.channels) || !Array.isArray(library?.clips)) throw new Error('Invalid idle library')
    this.indices = names.map(name => library.channels.findIndex(channel => channel.toLowerCase() === name.toLowerCase()))
    this.pool = library.clips.filter(clip => ['neutral', 'warm', 'thinking', 'curious'].includes(clip.emotion))
    for (const clip of this.pool) {
      if (!clip.id || !Number.isFinite(clip.fps) || clip.fps <= 0 || !Array.isArray(clip.frames) ||
          clip.frames.some(frame => !Array.isArray(frame) || frame.length !== library.channels.length ||
            frame.some(value => !Number.isFinite(value) || Math.abs(value) > 1))) throw new Error('Invalid idle clip')
    }
    this.pool = this.pool.filter(clip => clip.frames.length >= 60)
    this.random = random
    this.recent = []
    this.face = blank()
    this.entry = blank()
    this.position = this.transition = 0
    this.owner = 'idle'
  }
  pause() { this.last = null }
  choose() {
    let candidates = this.pool.filter(clip => !this.recent.includes(clip.id))
    if (!candidates.length) candidates = this.pool.filter(clip => clip.id !== this.clip?.id)
    if (!candidates.length) candidates = this.pool
    if (!candidates.length) return
    const weight = clip => ['neutral', 'warm'].includes(clip.emotion) ? 2 : 1
    let draw = this.random() * candidates.reduce((sum, clip) => sum + weight(clip), 0)
    this.clip = candidates.find(clip => (draw -= weight(clip)) <= 0) || candidates.at(-1)
    this.recent.push(this.clip.id)
    this.recent = this.recent.slice(-Math.min(5, Math.max(1, this.pool.length - 1)))
    const duration = (this.clip.frames.length - 1) / this.clip.fps * 1000
    this.duration = Math.min(duration, 2800 + this.random() * 2400)
    this.start = this.random() * Math.max(0, duration - this.duration)
    this.position = this.transition = 0
    this.entry = { ...this.face }
  }
  sample(now, { owner = 'idle', weights = {} } = {}) {
    let dt = this.last == null ? 0 : Math.max(0, now - this.last)
    this.last = now
    if (owner === 'foreground') {
      this.owner = owner
      this.face = { ...blank(), ...weights }
      return { ...this.face }
    }
    if (this.owner === 'foreground') {
      this.entry = { ...this.face }
      this.transition = 0
      dt = 0
    }
    this.owner = owner
    this.position += dt
    this.transition += dt
    if (!this.clip || this.position >= this.duration) this.choose()
    const target = blank(), clip = this.clip
    if (clip) {
      const position = Math.min(clip.frames.length - 1, (this.start + this.position) / 1000 * clip.fps)
      const lo = Math.floor(position), hi = Math.min(lo + 1, clip.frames.length - 1), t = position - lo
      for (let i = 0; i < names.length; i++) {
        const name = names[i], index = this.indices[i]
        if (index < 0 || articulation(name)) continue
        const value = clip.frames[lo][index] * (1 - t) + clip.frames[hi][index] * t
        target[name] = value * (name.startsWith('eyeBlink') ? 1 : .44) * (gaze(name) ? .6 : 1)
      }
      // Control converges captured eye directions instead of holding a long side look.
      const x = clamp(Math.tanh(((target.eyeLookInLeft - target.eyeLookOutLeft) +
        (target.eyeLookOutRight - target.eyeLookInRight)) * 1) * .1, -.18, .18)
      const y = clamp(Math.tanh(((target.eyeLookDownLeft - target.eyeLookUpLeft) +
        (target.eyeLookDownRight - target.eyeLookUpRight)) * 1) * .08, -.12, .12)
      for (const name of names.filter(gaze)) target[name] = 0
      target.eyeLookInLeft = target.eyeLookOutRight = Math.max(0, x)
      target.eyeLookOutLeft = target.eyeLookInRight = Math.max(0, -x)
      target.eyeLookDownLeft = target.eyeLookDownRight = Math.max(0, y)
      target.eyeLookUpLeft = target.eyeLookUpRight = Math.max(0, -y)
    }
    for (const name of names) {
      const desired = clamp(this.entry[name] + (target[name] - this.entry[name]) *
        ease(this.transition / (articulation(name) ? 240 : 550)))
      this.face[name] = gaze(name) ? this.face[name] + clamp(desired - this.face[name], -dt * .00035, dt * .00035) : desired
      if (owner === 'gaze' && gaze(name)) this.face[name] = weights[name] || 0
      if (owner === 'gaze' && name.startsWith('eyeBlink')) this.face[name] = Math.max(this.face[name], weights[name] || 0)
    }
    return { ...this.face }
  }
  diagnostics() {
    return { clipId: this.clip?.id || '', emotion: this.clip?.emotion || '',
      positionMs: this.position, durationMs: this.duration || 0, owner: this.owner }
  }
}
