import assert from 'node:assert/strict'
import test from 'node:test'
import { installVoiceWaveform } from '../electron/device-waveform.mjs'

let frames = []
globalThis.devicePixelRatio = 2
globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length }
globalThis.cancelAnimationFrame = () => { frames = [] }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

function fixture() {
  const heights = [], alphas = [], xs = [], widths = []
  const gradient = { addColorStop() {} }
  const context = {
    setTransform() {},
    clearRect() {},
    beginPath() {},
    fill() {},
    fillRect() {},
    createLinearGradient: () => gradient,
    roundRect(x, _y, width, height) { xs.push(x); widths.push(width); heights.push(height) },
    set globalAlpha(value) { alphas.push(value) },
  }
  const canvas = { width: 0, height: 0, clientWidth: 160, clientHeight: 40, dataset: {}, getContext: () => context }
  return { container: { hidden: false }, canvas, heights, alphas, xs, widths }
}

const step = (count = 1) => {
  for (let index = 0; index < count; index++) {
    const callback = frames.at(-1)
    assert.ok(callback, 'the waveform must schedule animation frames while active')
    callback(16 * (index + 1))
  }
}

test('the waveform activates with the composer, follows clamped energy and clears on stop', () => {
  const { container, canvas, heights, alphas, xs, widths } = fixture()
  const waveform = installVoiceWaveform(container, canvas, { bars: 10 })
  assert.equal(container.hidden, true, 'Voice mode is hidden until the microphone opens')
  waveform.setActive(true)
  assert.equal(container.hidden, false)
  assert.equal(canvas.width, 320)
  assert.equal(canvas.height, 80)
  assert.equal(canvas.dataset.level, '0.000')
  waveform.level(0.6)
  assert.equal(canvas.dataset.level, '0.600')
  step(12)
  assert.ok(Math.max(...heights) > 4, 'Visible bars grow with the captured energy')
  assert.ok(Math.max(...heights) <= 18, 'The refined meter never fills the whole input')
  assert.ok(Math.max(...widths) <= 3, 'Bars stay hairline thin')
  const left = Math.min(...xs), right = Math.max(...xs) + Math.max(...widths)
  assert.ok(right - left < 160 * 0.8 && Math.abs(left - (160 - right)) < 0.01,
    'The waveform stays compact and centered')
  assert.ok(alphas.some(value => value > 0.35 && value < 1), 'Bars vary their opacity with energy')
  waveform.level(2)
  assert.equal(canvas.dataset.level, '1.000')
  step(8)
  assert.ok(Math.max(...heights) <= 18, 'Full-scale energy stays inside the hairline meter')
  waveform.level(Number.NaN)
  assert.equal(canvas.dataset.level, '0.000')
  waveform.setActive(false)
  assert.equal(container.hidden, true)
  assert.equal(canvas.dataset.level, '0')
  assert.equal(frames.length, 0, 'Stopping must cancel the animation loop')
  waveform.setActive(false)
  assert.equal(frames.length, 0)
})

test('reduced motion paints static energy without scheduling frames', () => {
  globalThis.matchMedia = () => ({ matches: true })
  const { container, canvas, heights } = fixture()
  const waveform = installVoiceWaveform(container, canvas, { bars: 10 })
  waveform.setActive(true)
  assert.equal(container.hidden, false)
  assert.equal(frames.length, 0, 'Reduced motion must not start an animation loop')
  waveform.level(0.5)
  assert.equal(canvas.dataset.level, '0.500')
  assert.ok(Math.max(...heights) > 2, 'Static bars still reflect the current energy')
  waveform.dispose()
  assert.equal(container.hidden, true)
  delete globalThis.matchMedia
})
