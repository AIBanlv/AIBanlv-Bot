import { names } from './expression.mjs'

export const pipeline = 'ios-expression-v1-2e75b5f'
const components = ['pitch', 'yaw', 'roll', 'gazeX', 'gazeY', 'depth']
const presets = ['natural', 'smile', 'surprise', 'focus']

export function validateControl(bank, sourceSha256, duration, requiredPresets = presets) {
  const invalid = () => { throw new Error('Control 后处理数据不匹配，请重新生成') }
  if (!bank || bank.version !== 1 || bank.pipeline !== pipeline || bank.fps !== 30 ||
      !/^[a-f0-9]{64}$/.test(sourceSha256) || bank.sourceSha256 !== sourceSha256 ||
      !Number.isFinite(duration) || duration <= 0 || duration > 120 || bank.duration !== duration) invalid()
  if (!Array.isArray(bank.names) || bank.names.length !== 52 ||
      new Set(bank.names).size !== 52 || bank.names.some((name) => !names.includes(name))) invalid()
  const rows = (value, count, width, min) => Array.isArray(value) && value.length === count &&
    value.every((row) => Array.isArray(row) && row.length === width &&
      row.every((number) => Number.isFinite(number) && number >= min && number <= 1))
  for (const key of requiredPresets) {
    const track = bank.variants?.[key]
    if (!track || !rows(track.frames, Math.ceil(duration * 30), 52, 0) ||
        !rows(track.poses, track.frames.length, 6, -1) ||
        !Array.isArray(track.closingFrames) || !track.closingFrames.length || track.closingFrames.length > 60 ||
        !rows(track.closingFrames, track.closingFrames.length, 52, 0) ||
        !rows(track.closingPoses, track.closingFrames.length, 6, -1)) invalid()
  }
  return bank
}

export function sampleControl(bank, preset, seconds, closing = false) {
  if (!presets.includes(preset)) throw new Error('Unknown Control preset')
  const track = bank.variants[preset]
  const frames = closing ? track.closingFrames : track.frames
  const poses = closing ? track.closingPoses : track.poses
  if (!Number.isFinite(seconds) || seconds < 0 || seconds >= (closing ? frames.length / 30 : bank.duration)) return null
  const index = Math.min(Math.floor(seconds * 30), frames.length - 1)
  const next = Math.min(index + 1, frames.length - 1)
  const fraction = seconds * 30 - Math.floor(seconds * 30)
  const mix = (rows, i) => rows[index][i] + (rows[next][i] - rows[index][i]) * fraction
  return {
    weights: Object.fromEntries(bank.names.map((name, i) => [name, mix(frames, i)])),
    pose: { version: 1, owned: true, ...Object.fromEntries(components.map((name, i) => [name, mix(poses, i)])) },
  }
}
