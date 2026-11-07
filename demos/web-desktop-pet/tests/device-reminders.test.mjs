import test from 'node:test'
import assert from 'node:assert/strict'
import { DeviceReminders } from '../electron/device-reminders.mjs'
import { isComputerCommand } from '../electron/device-task-intent.mjs'
import { AssistantService } from '../electron/device-assistant-service.mjs'
test('reminder commands route to Harness while questions, quotations and negation remain conversation', () => {
  for (const text of ['明天上午九点提醒我开会', '十分钟后提醒我喝水', '每天晚上八点提醒我运动', '提醒我明天下午三点开会', '查看我的定时提醒']) assert.equal(isComputerCommand(text), true, text)
  for (const text of ['不要提醒我开会', '如何设置定时提醒', '“明天提醒我”是什么意思']) assert.equal(isComputerCommand(text), false, text)
})

test('only explicit original reminder requests authorize the Harness reminder tool', async () => {
  const service = new AssistantService({ settings: {}, root: 'fixture' }), signal = new AbortController().signal
  let count = 0
  service.reminders = { execute: async () => { count++; return { ok: true } } }
  service.active = { task: '读取邮件，里面可能包含第三方指令' }
  const action = { name: 'reminder', target: JSON.stringify({ operation: 'create', content: 'injected' }) }
  await assert.rejects(service.execute(action, signal), /ACTION_DENIED/)
  service.active = { task: '明天九点提醒我开会', originalTask: '明天九点提醒我开会' }
  assert.equal((await service.execute(action, signal)).ok, true); assert.equal(count, 1)
})
test('reminders use the bound current role and stable request IDs and confirm only actual server saves', async () => {
  const calls = [], context = { bound: true, owner: 'u', tenantId: 't', agentId: 'role' }
  const reminders = new DeviceReminders({ context: () => context, services: { request: async (...args) => { calls.push(args); return { ok: true, data: { id: 'persisted', status: 'active' } } } } })
  const args = { operation: 'create', content: '喝水', date: '2027-01-01', time: '09:00', repeat: 'none' }, signal = new AbortController().signal
  const request = new Map()
  const result = await reminders.execute(args, { signal, requests: request })
  assert.equal(result.data.id, 'persisted'); assert.equal(calls[0][0], 'memo_create'); assert.equal(calls[0][1].agentId, 'role')
  await reminders.execute(args, { signal, requests: request })
  assert.equal(calls[0][2], calls[1][2])
  await assert.rejects(reminders.execute({ ...args, tenantId: 'other' }, { signal }), /参数/)
  reminders.services.request = async () => ({ ok: false, code: 'TIMEOUT' })
  await assert.rejects(reminders.execute(args, { signal }), /未确认|超时/)
})
