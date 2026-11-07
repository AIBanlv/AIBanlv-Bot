export const names = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight',
  'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
  'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight', 'mouthClose',
  'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight', 'tongueOut',
]

export function validateClip(clip) {
  const invalid = () => { throw new Error('Invalid speech timeline') }
  if (!clip || clip.version !== 1 || clip.fps !== 30 ||
      !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 120) invalid()
  if (!Array.isArray(clip.names) || clip.names.length !== 52 ||
      new Set(clip.names).size !== 52 || clip.names.some((name) => !names.includes(name))) invalid()
  if (!Array.isArray(clip.frames) || clip.frames.length !== Math.ceil(clip.duration * clip.fps)) invalid()
  if (clip.frames.some((frame) => !Array.isArray(frame) || frame.length !== 52 ||
      frame.some((value) => !Number.isFinite(value) || value < 0 || value > 1))) invalid()
  if (!Array.isArray(clip.captions)) invalid()
  let previousEnd = 0
  for (const cue of clip.captions) {
    if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) ||
        cue.start < previousEnd || cue.end <= cue.start || cue.end > clip.duration ||
        typeof cue.text !== 'string' || [...cue.text].length > 32) invalid()
    previousEnd = cue.end
  }
  return clip
}

export function sampleExpression(clip, time) {
  if (!Number.isFinite(time) || time < 0 || time >= clip.duration) return {}
  const position = time * clip.fps
  const index = Math.min(Math.floor(position), clip.frames.length - 1)
  const next = clip.frames[Math.min(index + 1, clip.frames.length - 1)]
  return Object.fromEntries(clip.names.map((name, i) => [
    name, clip.frames[index][i] + (next[i] - clip.frames[index][i]) * (position - Math.floor(position)),
  ]))
}

export function speechCaption(clip, time) {
  return clip.captions.find((cue) => cue.start <= time && time < cue.end)?.text || ''
}

const presets = {
  natural: {},
  smile: { mouthSmileLeft: 0.42, mouthSmileRight: 0.42, cheekSquintLeft: 0.2, cheekSquintRight: 0.2 },
  surprise: { browInnerUp: 0.55, browOuterUpLeft: 0.4, browOuterUpRight: 0.4, eyeWideLeft: 0.4, eyeWideRight: 0.4 },
  focus: { browDownLeft: 0.3, browDownRight: 0.3, eyeSquintLeft: 0.18, eyeSquintRight: 0.18 },
}

export function blendPreset(expression, preset) {
  const result = { ...expression }
  for (const [name, weight] of Object.entries(presets[preset] || {})) {
    result[name] = Math.min(1, (result[name] || 0) + weight)
  }
  return result
}
