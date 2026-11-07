import { readFileSync, writeFileSync, renameSync } from 'node:fs'

export function loadDisplayPreferences(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return { particles: value?.particles === true, quality: ['auto', 'low', 'balanced', 'high'].includes(value?.quality) ? value.quality : 'auto' }
  } catch { return { particles: false, quality: 'auto' } }
}

export function saveDisplayPreferences(file, { particles, quality = 'auto' }) {
  if (typeof particles !== 'boolean') throw new TypeError('Invalid particle preference')
  if (!['auto', 'low', 'balanced', 'high'].includes(quality)) throw new TypeError('Invalid quality preference')
  writeFileSync(`${file}.tmp`, JSON.stringify({ particles, quality }), { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}
