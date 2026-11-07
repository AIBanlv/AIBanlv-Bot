import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { LocalWorkspace } from '../electron/device-local-workspace.mjs'
import { AssistantSettings } from '../electron/device-assistant-policy.mjs'
import { DeviceRuntime } from '../electron/device-runtime.mjs'
import { archiveFixture } from './avatar-fixture.mjs'
import { ModelSettings } from '../electron/device-model-settings.mjs'

const encryption = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value).map(byte => byte ^ 91), decryptString: value => Buffer.from(value).map(byte => byte ^ 91).toString() }
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibanlv-local-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const assistantSettings = new AssistantSettings({ file: path.join(directory, 'harness.json'), encryption })
  const calls = []
  let now = new Date(2026, 10, 3, 10).getTime()
  const create = () => new LocalWorkspace({ directory, encryption, assistantSettings, now: () => now, random: () => 0,
    fetcher: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body), authorization: options.headers.Authorization })
      if (url.includes('customization')) return Response.json({ output: { voice_id: 'qwen-audio-3.0-realtime-flash-fixture-voice' } })
      assert.equal(url, 'https://api.deepseek.com/chat/completions')
      return Response.json({ choices: [{ message: { content: '今天陪你整理了思路，一点点前进也很踏实。' } }] })
    } })
  const workspace = create(); await workspace.load(); t.after(() => workspace.dispose())
  await workspace.configure({ realtimeKey: 'fixture-realtime-private', deepseekKey: 'fixture-deepseek-private', region: 'cn-beijing' })
  const save = () => workspace.saveRole({ name: '小光', description: '安静的陪伴者', prompt: '你是小光，温柔简短地交流。' }, { lam: archiveFixture(), voice: Buffer.from('fixture voice') })
  return { directory, assistantSettings, workspace, calls, create, save, advance: ms => { now += ms } }
}
test('local roles, editable Markdown memory and complete conversation survive restart without the account backend', async t => {
  const f = await fixture(t), result = await f.save(), id = result.role.agentId
  await f.workspace.select(id)
  await f.workspace.appendTurn(id, 'turn-one', [{ role: 'user', text: '我的猫叫 MAX' }, { role: 'assistant', text: '我记住啦。' }])
  await f.workspace.appendTurn(id, 'turn-one', [{ role: 'user', text: '重复不能保存' }])
  await writeFile(path.join(f.workspace.folder(id), 'MEMORY.md'), '用户的猫叫 MAX。')
  await writeFile(path.join(f.workspace.folder(id), 'SOUL.md'), '你是小光，喜欢小猫。')
  const restored = f.create(); await restored.load(); t.after(() => restored.dispose())
  const session = await restored.session(id, new AbortController().signal)
  assert.equal(session.local, true); assert.match(session.providerUrl, /^wss:\/\/dashscope\.aliyuncs\.com\//)
  assert.match(session.instructions, /喜欢小猫/); assert.match(session.instructions, /猫叫 MAX/)
  assert.deepEqual(session.history.map(row => row.text), ['我的猫叫 MAX', '我记住啦。'])
  assert.match(await readFile(path.join(restored.folder(id), 'memory/2026-11-03.md'), 'utf8'), /我的猫叫 MAX/)
  assert.equal(restored.config.selectedRole, id)
  assert.equal(f.calls.length, 1, 'Only the explicit voice creation reaches the provider')
  assert.ok(!JSON.stringify(restored.snapshot()).includes('fixture-realtime-private'))
  assert.ok(!(await readFile(path.join(f.directory, 'realtime-key.json'), 'utf8')).includes('fixture-realtime-private'))
})
test('invalid local assets and missing keys cannot invoke voice creation or traverse local document paths', async t => {
  const f = await fixture(t)
  await assert.rejects(f.workspace.saveRole({ name: 'x', prompt: 'y' }, { lam: Buffer.from('invalid'), voice: Buffer.from('sample') }))
  assert.equal(f.calls.length, 0)
  assert.throws(() => f.workspace.folder('../../secrets'))
  await f.assistantSettings.forget()
  await f.workspace.realtime.forget()
  await assert.rejects(f.save(), { code: 'KEY_REQUIRED' })
  assert.equal(f.calls.length, 0)
})

test('a local bot can omit LAM, retain its own persona and voice after restart, then add an avatar later', async t => {
  const f = await fixture(t)
  const result = await f.workspace.saveRole({ name: '本地工作 Bot', prompt: '你是工作顾问，只使用自己的本地配置。' }, { voice: Buffer.from('fixture voice') })
  const id = result.role.agentId
  assert.equal(result.role.hasAvatar, false)
  assert.equal((await f.workspace.profile(id)).zipUrl, '')
  await assert.rejects(readFile(path.join(f.workspace.folder(id), 'avatar.zip')), { code: 'ENOENT' })
  await f.workspace.select(id)
  await f.workspace.appendTurn(id, 'bot-turn', [{ role: 'user', text: '安排今天的工作' }, { role: 'assistant', text: '先列出优先事项。' }])
  const restored = f.create(); await restored.load(); t.after(() => restored.dispose())
  assert.equal(restored.snapshot().roles.find(row => row.agentId === id).hasAvatar, false)
  const session = await restored.session(id, new AbortController().signal)
  assert.match(session.instructions, /你是工作顾问/)
  assert.equal(session.voiceId, 'qwen-audio-3.0-realtime-flash-fixture-voice')
  assert.deepEqual(session.history.map(row => row.text), ['安排今天的工作', '先列出优先事项。'])
  const edit = { agentId: id, name: '本地工作 Bot', prompt: '改过的人设。' }
  await restored.saveRole(edit)
  assert.equal((await restored.profile(id)).zipUrl, '')
  const withAvatar = await restored.saveRole(edit, { lam: archiveFixture() })
  assert.equal(withAvatar.role.hasAvatar, true)
  assert.equal((await restored.profile(id)).zipUrl, `local:${id}`)
  await restored.saveRole(edit)
  assert.equal((await restored.profile(id)).zipUrl, `local:${id}`, 'Editing without a new ZIP preserves an existing owned avatar')
  assert.equal(f.calls.length, 1, 'Omitting/adding LAM never makes an extra voice or platform request')
})

test('omitting LAM does not permit missing voice or invalid supplied avatar bytes', async t => {
  const f = await fixture(t)
  await assert.rejects(f.workspace.saveRole({ name: 'Bot', prompt: '本地' }), { code: 'ROLE_ASSETS_REQUIRED' })
  await assert.rejects(f.workspace.saveRole({ name: 'Bot', prompt: '本地' }, { lam: Buffer.from('bad ZIP'), voice: Buffer.from('sample') }))
  assert.equal(f.calls.length, 0)
  assert.equal(f.workspace.roles.size, 0)
})

test('legacy local keys migrate once into shared encrypted settings and never return after explicit removal', async t => {
  const f=await fixture(t), {role}=await f.save()
  const model=new ModelSettings({file:path.join(f.directory,'models.json'),encryption,region:'ap-southeast-1'})
  await model.load()
  const create=()=>new LocalWorkspace({directory:f.directory,encryption,assistantSettings:f.assistantSettings,modelSettings:model})
  const workspace=create();await workspace.load();t.after(()=>workspace.dispose())
  assert.equal(model.key(),'fixture-realtime-private');assert.equal(model.snapshot().region,'ap-southeast-1')
  assert.equal((await workspace.profile(role.agentId)).source,'local')
  assert.match(workspace.endpoint(),/^https:\/\/dashscope-intl\.aliyuncs\.com\//)
  assert.equal(workspace.legacyRealtime.key(),'')
  await model.configure({forget:true})
  const again=create();await again.load();t.after(()=>again.dispose())
  assert.equal(model.key(),'','Cleared keys must never be reimported from a legacy file')
  assert.equal(again.snapshot().realtimeConfigured,false)
})
test('daily local moments require a real same-day chat, persist the random schedule and never duplicate after restart', async t => {
  const f = await fixture(t), { role } = await f.save(), id = role.agentId
  await f.workspace.tick(); assert.equal(f.workspace.posts.length, 0)
  await f.workspace.appendTurn(id, 'one', [{ role: 'user', text: '帮我梳理今天的计划' }, { role: 'assistant', text: '先做最重要的一件吧。' }])
  const restored = f.create(); await restored.load(); t.after(() => restored.dispose())
  f.advance(2000); await restored.tick(); await restored.tick()
  assert.equal(restored.posts.length, 1)
  const again = f.create(); await again.load(); t.after(() => again.dispose()); await again.tick()
  assert.equal(again.posts.length, 1)
  assert.equal(f.calls.filter(call => call.url.includes('deepseek')).length, 1)
  f.advance(24 * 3600000); await again.tick(); assert.equal(again.posts.length, 1)
})
test('disabled moments and revoked local configuration never generate, and provider failure has a bounded retry count', async t => {
  const f = await fixture(t), { role } = await f.save()
  await f.workspace.appendTurn(role.agentId, 'one', [{ role: 'user', text: '你好' }]); f.advance(2000)
  f.workspace.config.momentsEnabled = false; await f.workspace.tick(); assert.equal(f.calls.length, 1)
  f.workspace.config.momentsEnabled = true
  f.workspace.fetcher = async () => { throw new Error('provider down') }
  for (let i = 0; i < 6; i++) { f.advance(16 * 60000); await f.workspace.tick() }
  assert.equal(f.workspace.schedules[role.agentId].attempts, 3)
  assert.equal(f.workspace.posts.length, 0)
})
test('local avatar remains available when online binding disconnects or is revoked and never reports a local profile to the backend', async t => {
  const channel = new EventEmitter(); channel.state = { local: true, binding: 'bound', connection: 'connected' }
  channel.report = () => assert.fail('Local avatars must not be reported to Control')
  const files = new Map(), runtime = new DeviceRuntime({ channel, files, directory: 'fixture', save: async () => {}, remove: async () => {}, download: async () => Buffer.from('fixture') })
  t.after(() => runtime.dispose())
  await runtime.apply({ agentId: 'local-fixture', source: 'local', local: true, zipUrl: 'local:fixture' })
  runtime.rendered(runtime.state.renderId, 'ready')
  channel.state.connection = 'disconnected'; channel.emit('state', channel.state); channel.emit('revoked')
  assert.equal(runtime.state.phase, 'ready'); assert.equal(runtime.state.current.agentId, 'local-fixture')
})
