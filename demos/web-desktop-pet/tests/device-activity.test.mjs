import test from 'node:test'
import assert from 'node:assert/strict'
import { DeviceActivity } from '../electron/device-activity.mjs'

function setup(t) {
  const activity = new DeviceActivity()
  t.after(() => activity.clear())
  const accept = (data, name = '上官婉儿') => activity.conversation(data, name)
  const begin = id => accept({ type: 'preparing', requestId: id })
  const say = (type, text, id = 'turn', extra = {}) => accept({ type, requestId: id, text, ...extra })
  return { activity, accept, begin, say }
}

test('both sides of alternating turns share one ordered task feed, including voice transcription', t => {
  const { activity, begin, say, accept } = setup(t)
  begin('turn'); say('user', '打开浏览器'); say('assistant', '正在打开')
  activity.add('Harness', 'tool', '应用启动请求已提交', 'tool')
  say('assistant', '已提交启动请求')
  accept({ type: 'complete', requestId: 'turn' })
  begin('voice'); say('user', '谢谢', 'voice', { input: 'voice' }); say('assistant', '不客气', 'voice')
  assert.deepEqual(activity.rows.map(row => [row.source, row.text]), [
    ['我', '打开浏览器'], ['上官婉儿', '已提交启动请求'], ['Harness', '应用启动请求已提交'], ['我', '谢谢'], ['上官婉儿', '不客气'],
  ])
  assert.deepEqual(activity.rows.map(row => row.kind), ['user', 'reply', 'tool', 'user', 'reply'])
})

test('reply labels are captured per turn and cannot overwrite another role or an older turn', t => {
  const { activity, begin, say, accept } = setup(t)
  begin('old'); say('assistant', '旧角色', 'old')
  accept({ type: 'preparing', requestId: 'new' }, '新角色')
  say('assistant', '迟到的旧回复', 'old'); say('assistant', '新回复', 'new')
  assert.deepEqual(activity.rows.map(row => row.source), ['上官婉儿', '新角色'])
  accept({ type: 'complete', requestId: 'old' }); say('assistant', '继续回复', 'new')
  assert.equal(activity.rows.at(-1).text, '继续回复')
  accept({ type: 'interrupted', requestId: 'new' }); say('assistant', '不再接收', 'new')
  assert.equal(activity.rows.at(-1).text, '继续回复')
})

test('task-feed dialogue hides directives without altering user text or treating markup as HTML', t => {
  const { activity, begin, say } = setup(t)
  begin('turn')
  const text = '[微笑]你好[head:[nod]]！\n<img src=x> []'
  say('user', text); say('assistant', text)
  assert.equal(activity.rows[0].text, text)
  assert.equal(activity.rows[1].text, '你好！\n<img src=x>')
})

test('streamed replies update one record and never expose unfinished directives', t => {
  const { activity, begin, say } = setup(t)
  begin('turn')
  for (const text of ['[', '[微', '[微笑]']) { say('assistant', text); assert.equal(activity.rows.length, 0) }
  for (const text of ['[微笑]你好[', '[微笑]你好[head:', '[微笑]你好[head:nod]']) {
    say('assistant', text); assert.equal(activity.rows.length, 1); assert.equal(activity.rows[0].text, '你好')
  }
  say('assistant', '[微笑]你好[head:nod]，继续。]')
  assert.equal(activity.rows[0].text, '你好，继续。')
  say('assistant', '[微笑][未闭合')
  assert.equal(activity.rows.length, 0)
})

test('reset clears private dialogue, preserves plugin progress and rejects late text', t => {
  const { activity, begin, say, accept } = setup(t)
  activity.add('Codex', 'status', '任务运行中', 'task')
  begin('turn'); say('user', '私密问题'); say('assistant', '私密回答')
  accept({ type: 'reset' }); say('assistant', '迟到的回复')
  assert.deepEqual(activity.rows.map(row => row.text), ['任务运行中'])
  begin('next'); say('assistant', '新对话', 'next')
  assert.equal(activity.rows.at(-1).text, '新对话')
})

test('touch observations stay hidden, but the role reply is recorded', t => {
  const { activity, begin, say } = setup(t)
  begin('turn'); say('user', '轻轻抚摸了数字人', 'turn', { input: 'touch' }); say('assistant', '[微笑]谢谢你陪着我。')
  assert.deepEqual(activity.rows.map(row => row.text), ['谢谢你陪着我。'])
})

test('complete spoken text is retained beyond the shorter plugin summary limit', t => {
  const { activity, begin, say } = setup(t)
  begin('turn'); say('assistant', '长'.repeat(16000))
  assert.equal(activity.rows[0].text.length, 16000)
  activity.add('Harness', 'summary', '短'.repeat(9000), 'bounded')
  assert.equal(activity.rows[1].text.length, 4000)
})

test('a streamed dialogue keeps its original timestamp while its revision advances', t => {
  const { activity, begin, say } = setup(t)
  begin('turn'); say('assistant', '第一段')
  activity.rows[0].at = 1700000000000
  const revision = activity.rows[0].revision
  say('assistant', '第一段，继续回复')
  assert.equal(activity.rows[0].at, 1700000000000)
  assert.ok(activity.rows[0].revision > revision)
})
