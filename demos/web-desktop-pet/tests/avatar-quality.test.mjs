import test from 'node:test'
import assert from 'node:assert/strict'
import { avatarPixelRatio } from '../src/avatar-quality.mjs'
import { loadDisplayPreferences, saveDisplayPreferences } from '../electron/device-preferences.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
test('detail mode supersamples even a 1x desktop, balanced/native and performance stay bounded', () => {
  assert.equal(avatarPixelRatio('high', 1), 2)
  assert.equal(avatarPixelRatio('high', 3), 2)
  assert.equal(avatarPixelRatio('balanced', 3), 1.5)
  assert.equal(avatarPixelRatio('low', 2), 1)
  assert.equal(avatarPixelRatio('balanced', NaN), 1)
})
test('quality is persisted with particle preferences and invalid values cannot reach renderer', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'control-quality-')), file = path.join(directory, 'display.json')
  try {
    saveDisplayPreferences(file, { particles: true, quality: 'high' })
    assert.deepEqual(loadDisplayPreferences(file), { particles: true, quality: 'high' })
    assert.throws(() => saveDisplayPreferences(file, { particles: true, quality: 'unbounded' }))
  } finally { rmSync(directory, { force: true, recursive: true }) }
})
