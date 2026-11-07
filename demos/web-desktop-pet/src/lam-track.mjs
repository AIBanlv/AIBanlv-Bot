import { names } from './expression.mjs'
import { pipeline, sampleControl } from './control.mjs'

export function validateLamTrack(track, count) {
  const rows = (items, width, min) => Array.isArray(items) && items.length === count &&
    items.every(row => Array.isArray(row) && row.length === width &&
      row.every(value => Number.isFinite(value) && value >= min && value <= 1))
  if (!Number.isInteger(count) || count < 1 || count > 30 || track?.pipeline !== pipeline ||
      track.fps !== 30 || !rows(track.frames, 52, 0) || !rows(track.poses, 6, -1)) {
    throw new Error('Invalid LAM expression track')
  }
  return track
}

export function sampleLamTrack(track, seconds, duration) {
  const value = sampleControl({ names, variants: { natural: track }, duration }, 'natural', seconds)
  return value ? { ...value, pipeline, speaking: true } : null
}

export function neutralExpression() {
  return { pipeline, speaking: false, weights: Object.fromEntries(names.map(name => [name, 0])),
    pose: { version: 1, owned: false, pitch: 0, yaw: 0, roll: 0, gazeX: 0, gazeY: 0, depth: 0 } }
}
