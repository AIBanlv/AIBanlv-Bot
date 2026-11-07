import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDeviceParticles, avatarBottomEdge } from '../src/device-particles.mjs'
import { loadDisplayPreferences, saveDisplayPreferences } from '../electron/device-preferences.mjs'

function fixture(getFootprint) {
  const listeners = new Map(), frames = new Map()
  const positions = []
  let id = 0, draws = 0, clears = 0
  const context = { clearRect() { clears++ }, setTransform() {}, drawImage(...args) { draws++; positions.push(args.slice(1)) },
    createRadialGradient: () => ({ addColorStop() {} }), beginPath() {}, arc() {}, fill() {} }
  const events = { addEventListener(name, fn) { listeners.set(name, fn) }, removeEventListener(name) { listeners.delete(name) } }
  const media = { ...events, matches: false }
  const document = { ...events, hidden: false, createElement: () => ({ getContext: () => context }) }
  const window = { ...events, devicePixelRatio: 2, performance: { now: () => 100 }, matchMedia: () => media,
    requestAnimationFrame(fn) { frames.set(++id, fn); return id }, cancelAnimationFrame(key) { frames.delete(key) } }
  const canvas = { hidden: false, dataset: {}, getContext: () => context, getBoundingClientRect: () => ({ width: 300, height: 400 }) }
  const effect = createDeviceParticles({ canvas, getFootprint, window, document })
  return { effect, canvas, document, media, frames, listeners, positions, draws: () => draws, clears: () => clears,
    tick(time) { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)) } }
}

test('particle origin follows the visible avatar bottom, including uneven shoulders and transparent margins', () => {
  const width = 32, height = 24, data = new Uint8ClampedArray(width * height * 4)
  for (let x = 4; x < 28; x++) {
    const bottom = x < 12 ? 15 : x < 20 ? 19 : 17
    for (let y = 4; y <= bottom; y++) data[(y * width + x) * 4 + 3] = 255
  }
  const edge = avatarBottomEdge(data, width, height)
  assert.ok(edge)
  assert.equal(edge.left, 4 / 32)
  assert.equal(edge.right, 28 / 32)
  assert.equal(edge.bottoms[8], 16 / 24)
  assert.equal(edge.bottoms[16], 20 / 24)
  assert.equal(edge.bottoms[24], 18 / 24)
  assert.equal(avatarBottomEdge(new Uint8ClampedArray(data.length), width, height), null)
})

test('reduced motion can show a static effect when the first silhouette arrives after enabling', () => {
  let edge = null
  const f = fixture(() => edge)
  f.media.matches = true
  f.effect.update({ enabled: true, visible: true, ready: true })
  assert.equal(f.draws(), 0)
  edge = { left: 0.1, right: 0.9, bottoms: Array(96).fill(0.7), height: 300 }
  f.effect.refresh()
  assert.ok(f.draws() > 0)
  assert.equal(f.frames.size, 0)
  f.positions.length = 0
  edge = { ...edge, bottoms: Array(96).fill(0.9) }
  f.effect.refresh()
  assert.equal(f.positions.length, 0, 'Reduced-motion particles need no redraw while the avatar moves')
  f.effect.dispose()
  const before = f.draws()
  f.effect.refresh()
  assert.equal(f.draws(), before)
})

test('particles are opt-in, draw transparently below the figure, and clear when disabled', () => {
  const f = fixture()
  assert.equal(f.canvas.hidden, true)
  assert.equal(f.frames.size, 0)
  f.effect.update({ enabled: true, visible: true, ready: true })
  assert.equal(f.canvas.hidden, false)
  assert.equal(f.frames.size, 1)
  f.tick(100)
  assert.ok(f.draws() > 0)
  const clears = f.clears()
  f.effect.update({ enabled: false, visible: true, ready: true })
  assert.equal(f.canvas.hidden, true)
  assert.equal(f.frames.size, 0)
  assert.ok(f.clears() > clears)
  f.effect.dispose()
})

test('readiness, visibility, reduced motion and disposal never leave a second animation running', () => {
  const f = fixture()
  const active = { enabled: true, visible: true, ready: true }
  f.effect.update(active); f.effect.update(active)
  assert.equal(f.frames.size, 1)
  for (const patch of [{ visible: false }, { ready: false }]) {
    f.effect.update({ ...active, ...patch })
    assert.equal(f.frames.size, 0)
    assert.equal(f.canvas.hidden, true)
    f.effect.update(active)
    assert.equal(f.frames.size, 1)
  }
  f.document.hidden = true; f.listeners.get('visibilitychange')()
  assert.equal(f.frames.size, 0)
  f.document.hidden = false; f.listeners.get('visibilitychange')()
  assert.equal(f.frames.size, 1)
  f.media.matches = true; f.listeners.get('change')()
  assert.equal(f.frames.size, 0)
  assert.equal(f.canvas.hidden, false)
  f.effect.dispose(); f.effect.dispose(); f.effect.update(active)
  assert.equal(f.frames.size, 0)
  assert.equal(f.listeners.size, 0)
})

test('display preferences default off, survive reload and persist only the boolean choice', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'control-particles-'))
  const file = path.join(directory, 'display-preferences.json')
  try {
    assert.deepEqual(loadDisplayPreferences(file), { particles: false, quality: 'auto' })
    for (const particles of [true, false]) {
      saveDisplayPreferences(file, { particles, token: 'must-not-persist' })
      assert.deepEqual(loadDisplayPreferences(file), { particles, quality: 'auto' })
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { particles, quality: 'auto' })
    }
    for (const raw of ['broken', 'null', '{"particles":"true"}']) {
      writeFileSync(file, raw)
      assert.deepEqual(loadDisplayPreferences(file), { particles: false, quality: 'auto' })
    }
    assert.throws(() => saveDisplayPreferences(file, { particles: 'yes' }))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
