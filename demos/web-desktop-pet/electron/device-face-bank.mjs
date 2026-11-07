import { names } from '../src/expression.mjs'

// The idle face used to be synthesised from a handful of blendshapes, which is
// why every emotion looked alike. The KeyframeFace library that ships with the
// Control sources holds real captured clips; this module turns them into a
// compact bank the pet can actually play, and leaves the head, gaze and depth
// layer the pet already owns alone.
export const FACE_BANK_VERSION = 1
// 20 fps resolves every change these clips make, and the pet interpolates
// between frames anyway, so anything faster is only payload.
export const faceBankFps = 20
const peak = 255
// Our own gaze layer decides where the eyes point, so captured eye aim only
// adds flavour instead of fighting the follow.
const gazeScale = 0.35
const gazeChannels = names.map((name, index) => (/^eyeLook/.test(name) ? index : -1)).filter(index => index >= 0)
const clamp01 = value => Math.max(0, Math.min(1, value))

// Turns a KeyframeFace library into a bank of 52-channel clips quantised to
// bytes: 3.6 MB of float samples becomes a little over a megabyte of integers.
export function buildFaceBank(library, { fps = faceBankFps } = {}) {
  if (!library || library.schemaVersion !== 1 || !Array.isArray(library.channels) || !Array.isArray(library.clips)) {
    throw new Error('表情库格式不支持')
  }
  const source = library.channels.map(channel => channel[0].toLowerCase() + channel.slice(1))
  const pick = names.map(name => source.indexOf(name))
  if (pick.some(index => index < 0)) throw new Error('表情库缺少面部通道')
  const scale = names.map((name, index) => (gazeChannels.includes(index) ? gazeScale : 1))
  const clips = []
  for (const entry of library.clips) {
    if (!entry || typeof entry.emotion !== 'string' || !(entry.fps > 0) ||
        !Array.isArray(entry.frames) || entry.frames.length < 2) continue
    const duration = (entry.frames.length - 1) / entry.fps
    const count = Math.max(2, Math.round(duration * fps) + 1)
    const frames = []
    for (let i = 0; i < count; i++) {
      const position = (i / (count - 1)) * (entry.frames.length - 1)
      const index = Math.floor(position)
      const next = Math.min(index + 1, entry.frames.length - 1)
      const mix = position - index
      const a = entry.frames[index], b = entry.frames[next]
      const frame = new Array(names.length)
      for (let k = 0; k < names.length; k++) {
        frame[k] = Math.round(clamp01((a[pick[k]] + (b[pick[k]] - a[pick[k]]) * mix) * scale[k]) * peak)
      }
      frames.push(frame)
    }
    clips.push({ id: entry.id, emotion: entry.emotion, duration, frames })
  }
  if (!clips.length) throw new Error('表情库没有可用片段')
  return { version: FACE_BANK_VERSION, fps, channels: names, clips }
}

// Reads one frame out of a bank clip, interpolated so a 20 fps bank still
// moves smoothly at the pet's own frame rate.
export function sampleFaceBank(clip, seconds, fps = faceBankFps) {
  if (!clip || !Array.isArray(clip.frames) || clip.frames.length < 2 || !Number.isFinite(seconds)) return null
  const span = clip.frames.length - 1
  const position = Math.max(0, Math.min(span, Math.max(0, seconds) * fps))
  const index = Math.floor(position)
  const next = Math.min(index + 1, span)
  const mix = position - index
  const a = clip.frames[index], b = clip.frames[next]
  const weights = {}
  for (let i = 0; i < names.length; i++) weights[names[i]] = (a[i] + (b[i] - a[i]) * mix) / peak
  return weights
}

// The renderer side handle: bank data arrives as JSON, so the lookups live here
// instead of riding along with the payload.
export function createFaceBank(data) {
  if (!data || data.version !== FACE_BANK_VERSION || !Array.isArray(data.channels) || !Array.isArray(data.clips)) return null
  if (data.channels.length !== names.length || data.channels.some((name, index) => name !== names[index])) return null
  const fps = data.fps > 0 ? data.fps : faceBankFps
  const byEmotion = new Map()
  for (const clip of data.clips) {
    if (!clip || typeof clip.emotion !== 'string' || !(clip.duration > 0) ||
        !Array.isArray(clip.frames) || clip.frames.length < 2) continue
    if (clip.frames.some(frame => !Array.isArray(frame) || frame.length !== names.length ||
      frame.some(value => !Number.isFinite(value) || value < 0 || value > peak))) continue
    const pool = byEmotion.get(clip.emotion) || []
    pool.push(clip)
    byEmotion.set(clip.emotion, pool)
  }
  if (!byEmotion.size) return null
  return {
    fps,
    emotions: [...byEmotion.keys()],
    // Prefer a clip that covers the whole gesture; failing that the longest one,
    // so the action is cut to fit instead of freezing on a held frame.
    clip: (emotion, seconds = 0, random = Math.random) => {
      const pool = byEmotion.get(emotion)
      if (!pool?.length) return null
      const long = pool.filter(candidate => candidate.duration >= seconds)
      if (long.length) return long[Math.min(long.length - 1, Math.floor(random() * long.length))]
      return pool.reduce((best, candidate) => (candidate.duration > best.duration ? candidate : best))
    },
    sample: (clip, seconds) => sampleFaceBank(clip, seconds, fps),
  }
}
