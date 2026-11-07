import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTextAction, sampleTextAction, textCaption } from '../src/text-motion.mjs'

test('text actions accept Chinese and canonical tags without exposing tags in captions', () => {
  const action = parseTextAction('【H：shake】[微笑]你好，很高兴见到你。')
  assert.equal(action.head, 'shake')
  assert.equal(action.emotion, 'happy')
  assert.equal(action.text, '你好，很高兴见到你。')
  assert.equal(parseTextAction('[head-nod][E:happy]好的。').head, 'nod')
  assert.equal(parseTextAction('请摇摇头。').head, 'shake')
  assert.equal(parseTextAction('不要摇头。').head, 'none')
})
test('invalid, duplicate and empty directives fail clearly', () => {
  for (const text of ['[飞走]你好', '[摇头][点头]你好', '[摇头]', '[H:unknown]你好', '[摇头你好', 'a'.repeat(161)]) {
    assert.throws(() => parseTextAction(text))
  }
})
test('head and face move with smooth boundaries while speech mouth stays closed', () => {
  const action = parseTextAction('[摇头][微笑]你好。')
  const frames = Array.from({length:121}, (_, i) => sampleTextAction(action, i / 30))
  assert.ok(Math.max(...frames.map(f => f.pose.yaw)) > 0.1)
  assert.ok(Math.min(...frames.map(f => f.pose.yaw)) < -0.1)
  assert.ok(frames.some(f => f.weights.mouthSmileLeft > 0.3))
  assert.equal(frames[0].pose.yaw, 0)
  for (const frame of frames) {
    assert.equal(frame.weights.jawOpen, 0)
    assert.equal(frame.speaking, false)
    assert.ok(Object.values(frame.weights).every(n => n >= 0 && n <= 1))
  }
  assert.equal(sampleTextAction(action, action.duration).pose.yaw, 0)
})
test('captions keep Unicode intact, paginate and clear at completion', () => {
  const action = parseTextAction('😀'.repeat(70))
  assert.equal(action.pages.join(''), '😀'.repeat(70))
  assert.ok(action.pages.every(p => [...p].length <= 32))
  assert.equal(textCaption(action, 0), action.pages[0])
  assert.equal(textCaption(action, action.duration), '')
})
