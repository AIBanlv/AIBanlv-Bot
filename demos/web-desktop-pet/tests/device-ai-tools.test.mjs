import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { aiToolStatuses, DeviceAiTools } from '../electron/device-ai-tools.mjs'

const scope = 'a'.repeat(64), otherScope = 'b'.repeat(64)
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'device-ai-tools-'))
  const context = { bound: true, connected: true, authorized: true, scope }
  const assistant = {}, codex = { status: 'disconnected' }
  const options = { file: path.join(directory, 'onboarding.json'), context: () => context,
    assistant: () => assistant, codex: () => codex, discoverWorkbuddy: () => { throw new Error('未找到 WorkBuddy') }, ...overrides }
  const manager = new DeviceAiTools(options)
  t.after(async () => { manager.stop(); await rm(directory, { recursive: true, force: true }) })
  return { manager, options, context, assistant, codex }
}

test('AI status distinguishes usable local configuration, real Codex handshake, and a watcher alone', () => {
  const rows = aiToolStatuses({ assistant: { configured: true, enabled: true, apiKey: 'private-key' },
    codex: { status: 'connecting', tasks: ['private-task'] }, workbuddy: { online: true } })
  assert.equal(rows[0].available, true)
  assert.equal(rows[0].label, '已就绪')
  assert.equal(rows[1].available, false)
  assert.equal(rows[1].state, 'checking')
  assert.equal(rows[2].available, false, 'A running watcher does not prove WorkBuddy is installed or online')
  assert.doesNotMatch(JSON.stringify(rows), /private-key|private-task/)
  assert.equal(aiToolStatuses({ assistant: { configured: true, enabled: false } })[0].available, false)
  assert.equal(aiToolStatuses({ assistant: { configured: true, enabled: true, state: 'error' } })[0].state, 'error')
  assert.equal(aiToolStatuses({ codex: { status: 'ready' } })[1].available, true)
  assert.equal(aiToolStatuses({ workbuddy: { status: 'associated' } })[2].label, '已关联')
})

test('first successful binding discovers local tools, guides once, and persists only a scope hash', async t => {
  const { manager, options, context } = await fixture(t)
  assert.equal(manager.observe().guide, null, 'Wait for local discovery before deciding')
  await manager.discover()
  assert.equal(manager.snapshot().guide.id, scope)
  assert.deepEqual(JSON.parse(await readFile(options.file, 'utf8')), { completed: [scope] })
  manager.acknowledge()
  context.connected = false; manager.observe()
  context.connected = true; assert.equal(manager.observe().guide, null)
  const restarted = new DeviceAiTools(options)
  t.after(() => restarted.stop())
  await restarted.discover()
  assert.equal(restarted.observe().guide, null, 'Reopening an existing account must not force navigation')
  context.scope = otherScope
  assert.equal(manager.observe().guide.id, otherScope, 'A new account has its own first-login decision')
})

test('discovery does not guide before binding and authorization are confirmed', async t => {
  const { manager, context } = await fixture(t)
  context.authorized = false
  await manager.discover()
  assert.equal(manager.snapshot().guide, null)
  context.authorized = true; context.bound = false
  assert.equal(manager.observe().guide, null)
  context.bound = true
  assert.equal(manager.observe().guide.id, scope)
})

for (const source of ['harness', 'codex', 'workbuddy']) test(`${source} availability prevents unnecessary Harness onboarding`, async t => {
  const { manager, assistant, codex } = await fixture(t, source === 'workbuddy' ? { discoverWorkbuddy: () => ({ command: 'fixture' }) } : {})
  if (source === 'harness') Object.assign(assistant, { configured: true, enabled: true })
  if (source === 'codex') codex.status = 'ready'
  await manager.discover()
  assert.equal(manager.observe().guide, null)
  assert.equal(manager.seen.has(scope), true)
})

test('a hanging Codex connection has a bounded first-login grace period', async t => {
  let now = 1000
  const { manager, codex } = await fixture(t, { now: () => now, settleMs: 100 })
  codex.status = 'connecting'
  await manager.discover()
  assert.equal(manager.observe().guide, null)
  now += 101
  assert.equal(manager.observe().guide.id, scope)
  codex.status = 'ready'
  assert.equal(manager.observe().guide, null)
})

test('synchronous discovery errors do not poison retries, and concurrent discovery is coalesced', async t => {
  let calls = 0
  const { manager } = await fixture(t, { discoverWorkbuddy: () => { calls++; throw new Error('not found') } })
  await Promise.all([manager.discover(), manager.discover()])
  assert.equal(calls, 1)
  await manager.discover()
  assert.equal(calls, 2)
  assert.equal(manager.workbuddy.status, 'missing')
})

test('late discovery cannot publish or overwrite state after shutdown', async t => {
  let finish
  const { manager } = await fixture(t, { discoverWorkbuddy: () => new Promise(resolve => { finish = resolve }) })
  const job = manager.discover()
  await Promise.resolve()
  manager.stop(); let events = 0
  manager.on('state', () => events++)
  finish({ command: 'fixture' }); await job
  assert.equal(manager.workbuddy.status, 'checking')
  assert.equal(events, 0)
})
