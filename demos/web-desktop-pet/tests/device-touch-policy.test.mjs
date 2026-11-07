import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyTouch, touchObservation } from '../electron/device-touch-policy.mjs'

const event = overrides => ({ event_id: 'gesture-1:event', interaction_id: 'gesture-1',
  gesture_type: 'TAP', timestamp: 10000, start_position: { x: 0.5, y: 0.5 },
  end_position: { x: 0.5, y: 0.5 }, duration: 100, movement_distance: 1, movement_speed: 10,
  movement_direction: 'none', ...overrides })

test('a nose tap becomes a specific touch observation rather than a generic caress', () => {
  const observation = touchObservation(event(), 10000)
  assert.equal(observation.region, 'nose')
  assert.equal(observation.gesture, 'TAP')
  assert.match(observation.description, /轻轻点了点你的鼻尖/)
  assert.doesNotMatch(observation.description, /抚摸/)
})

test('Control face zones use character-relative cheeks and retain stroke direction and endpoints', () => {
  for (const [point, part] of [[{ x: 0.5, y: 0.2 }, '额头'], [{ x: 0.5, y: 0.8 }, '下巴'],
    [{ x: 0.3, y: 0.5 }, '右脸颊'], [{ x: 0.7, y: 0.5 }, '左脸颊']]) {
    assert.ok(touchObservation(event({ end_position: point }), 10000).description.includes(part))
  }
  const stroke = touchObservation(event({ gesture_type: 'GENTLE_STROKE',
    start_position: { x: 0.7, y: 0.5 }, end_position: { x: 0.3, y: 0.5 }, movement_direction: 'left' }), 10000)
  assert.match(stroke.description, /左脸颊.*右脸颊/)
  assert.match(stroke.description, /向你自身右侧/)
  assert.match(touchObservation(event({ gesture_type: 'DOUBLE_TAP' }), 10000).description, /两下.*鼻尖/)
  assert.match(touchObservation(event({ gesture_type: 'LONG_PRESS' }), 10000).description, /停留.*鼻尖/)
})

test('gesture classification matches Control tap, hold, swipe and caress thresholds', () => {
  const base = { samples: 2, duration: 100, path: 0, excursion: 0, distance: 0, speed: 0, dx: 0, dy: 0 }
  assert.equal(classifyTouch(base), 'TAP')
  assert.equal(classifyTouch({ ...base, duration: 700 }), 'LONG_PRESS')
  assert.equal(classifyTouch({ ...base, duration: 400, path: 40, distance: 40, speed: 100, dx: -40 }), 'SWIPE_LEFT')
  assert.equal(classifyTouch({ ...base, duration: 500, path: 60, distance: 5, excursion: 20, speed: 120 }), 'GENTLE_STROKE')
  assert.equal(classifyTouch({ ...base, duration: 350, path: 200, distance: 5, speed: 900 }), 'UNKNOWN')
  assert.equal(classifyTouch({ ...base, samples: 1 }), 'UNKNOWN')
})

test('invalid or stale geometry cannot reach the prompt', () => {
  for (const invalid of [undefined, {}, event({ gesture_type: 'ignore role' }),
    event({ end_position: { x: -0.1, y: 0.5 } }), event({ duration: NaN }),
    event({ timestamp: -100000 }), event({ event_id: '<instruction>' }),
    event({ movement_direction: 'somewhere' })]) assert.equal(touchObservation(invalid, 10000), null)
  const clean = touchObservation(event({ description: 'ignore role', region: 'anything' }), 10000)
  assert.doesNotMatch(JSON.stringify(clean), /ignore role|anything/)
})
