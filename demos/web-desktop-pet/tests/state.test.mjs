import assert from 'node:assert/strict'
import test from 'node:test'
import { constrain, dragged, splitCaptions, captionAt } from '../src/state.mjs'

test('keeps the whole pet within the viewport after dragging or resizing', () => {
  assert.deepEqual(constrain({ x: -100, y: 999 }, { width: 280, height: 420 }, { width: 800, height: 600 }), { x: 12, y: 168 })
  assert.deepEqual(constrain({ x: 900, y: -20 }, { width: 296, height: 440 }, { width: 320, height: 480 }), { x: 12, y: 12 })
  assert.deepEqual(constrain({ x: NaN, y: Infinity }, { width: 280, height: 420 }, { width: 800, height: 600 }), { x: 12, y: 12 })
})

test('does not mistake a small pointer movement for dragging', () => {
  assert.equal(dragged({ x: 0, y: 0 }, { x: 3, y: 2 }), false)
  assert.equal(dragged({ x: 0, y: 0 }, { x: 8, y: 0 }), true)
})

test('splits long Unicode captions without dropping characters or emitting blank lines', () => {
  assert.deepEqual(splitCaptions('  \n '), [])
  assert.deepEqual(splitCaptions('hello\nworld'), ['hello', 'world'])
  const text = '你好'.repeat(50)
  const lines = splitCaptions(text)
  assert.equal(lines.join(''), text)
  assert.ok(lines.every((line) => Array.from(line).length <= 32), 'Captions must fit the smallest pet width')
})

test('caption playback has deterministic pause, end and loop semantics', () => {
  const lines = ['one', 'two']
  assert.deepEqual(captionAt(lines, 0, false), { text: 'one', index: 0, ended: false })
  assert.deepEqual(captionAt(lines, 4500, false), { text: 'two', index: 1, ended: false })
  assert.deepEqual(captionAt(lines, 9000, false), { text: 'two', index: 1, ended: true })
  assert.deepEqual(captionAt(lines, 9000, true), { text: 'one', index: 0, ended: false })
  assert.deepEqual(captionAt([], 1000, false), { text: '', index: 0, ended: true })
})
