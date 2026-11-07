import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ModelSettings, modelRoute, ownRealtimeSession, realtimeRegion } from '../electron/device-model-settings.mjs'
import { AssistantSettings } from '../electron/device-assistant-policy.mjs'

test('local roles use own models regardless of login, score or legacy source preference', () => {
  const profile = { agentId: 'local-role', source: 'local' }
  for (const score of [null, 0, 10]) {
    for (const source of ['auto', 'platform', 'deepseek', 'realtime']) {
      for(const bound of [false,true]) {
        const context={score,profile,bound,connected:bound}
        const realtime=modelRoute({source,configured:true},true,context),deepseek=modelRoute({source},true,context)
        assert.equal(realtime.route,'realtime');assert.equal(realtime.funding,'own')
        assert.equal(deepseek.route,'deepseek');assert.equal(deepseek.funding,'own')
        const missing=modelRoute({source},false,context)
        assert.equal(missing.code,'KEY_REQUIRED');assert.doesNotMatch(missing.message,/充值|积分不足/)
      }
    }
  }
})

test('machine country selects Beijing only for mainland China, independent of UI language', () => {
  for (const country of ['CN', 'cn']) assert.equal(realtimeRegion(country, 'en-US'), 'cn-beijing')
  for (const country of ['US', 'SG', 'HK', 'TW', 'JP']) assert.equal(realtimeRegion(country, 'zh-CN'), 'ap-southeast-1')
  assert.equal(realtimeRegion('', 'zh-CN'), 'cn-beijing')
  assert.equal(realtimeRegion('', 'zh-Hant-HK'), 'ap-southeast-1')
  assert.equal(realtimeRegion('', 'zh'), 'ap-southeast-1')
})

test('default Audio model works without workspace; specialized models still require it', () => {
  for (const [region, host] of [['cn-beijing','dashscope.aliyuncs.com'],['ap-southeast-1','dashscope-intl.aliyuncs.com']]) {
    const settings={key:()=> 'fixture-own-key',snapshot:()=>({region,workspaceId:''})}
    const session=ownRealtimeSession(settings,{agentId:'local-fixture',voiceId:'qwen-audio-3.0-realtime-flash-fixture'})
    assert.equal(new URL(session.providerUrl).host,host)
    assert.equal(session.voiceId,'qwen-audio-3.0-realtime-flash-fixture')
    assert.equal(session.funding,'own');assert.equal(session.billingTicket,undefined)
  }
  assert.throws(()=>ownRealtimeSession({key:()=> 'fixture-key',snapshot:()=>({model:'qwen3.8-omni-flash-realtime'})},{agentId:'test'}),{code:'WORKSPACE_REQUIRED'})
})

test('automatic region overrides old saved regions and cannot be changed by renderer input', async t => {
  const directory=await mkdtemp(path.join(tmpdir(),'automatic-region-'));t.after(()=>rm(directory,{recursive:true,force:true}))
  const file=path.join(directory,'settings.json'),encryption={isEncryptionAvailable:()=>false}
  await writeFile(file,JSON.stringify({region:'cn-beijing',workspaceId:'saved-space'}))
  const settings=new ModelSettings({file,encryption,region:'ap-southeast-1'});await settings.load()
  assert.equal(settings.snapshot().region,'ap-southeast-1');assert.equal(settings.snapshot().workspaceId,'saved-space')
  await settings.configure({region:'cn-beijing'})
  assert.equal(settings.snapshot().region,'ap-southeast-1')
})

test('online roles and cached public roles always require platform access and score', () => {
  for (const profile of [{ agentId: 'old-role' }, { agentId: 'public', source: 'online', publicAvatar: true, local: true }]) {
    for (const source of ['auto', 'platform', 'deepseek', 'realtime']) {
      const settings = { source, configured: true }
      assert.equal(modelRoute(settings, true, { profile, score: 10 }).code, 'BIND_REQUIRED')
      assert.equal(modelRoute(settings, true, { profile, bound: true, connected: false, score: 10 }).code, 'BIND_REQUIRED')
      assert.equal(modelRoute(settings, true, { profile, bound: true, connected: true }).code, 'SCORE_PENDING')
       assert.equal(modelRoute(settings, true, { profile, bound: true, connected: true, score: 0 }).code, 'SCORE_DEPLETED')
       assert.match(modelRoute(settings,true,{profile,bound:true,connected:true,score:0}).message,/AIBanlv 手机端充值/)
      assert.equal(modelRoute(settings, true, { profile, bound: true, connected: true, score: 29 }).code, 'SCORE_DEPLETED')
      assert.equal(modelRoute(settings, true, { profile, bound: true, connected: true, score: 30 }).route, 'platform')
       assert.equal(modelRoute(settings,true,{profile,bound:true,connected:true,score:30}).funding,'platform')
    }
  }
  assert.equal(modelRoute({ configured: true }, true).code, 'AVATAR_NOT_READY')
  assert.equal(modelRoute({ configured: true }, true, { profile: { agentId: 'unknown', source: 'other' } }).code, 'AVATAR_NOT_READY')
})

test('Realtime key encrypted persistence is independent from source and account', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'model-settings-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const encryption = { isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value).reverse(), decryptString: value => Buffer.from(value).reverse().toString() }
  const file = path.join(directory, 'models.json'), settings = new ModelSettings({ file, encryption })
  await settings.load()
  assert.equal(settings.snapshot().model, 'qwen-audio-3.0-realtime-flash')
  assert.equal(settings.snapshot().voice, 'longanlingxi')
  assert.equal(settings.snapshot().platformEnabled, true)
  await settings.configure({ source: 'realtime', platformEnabled: false, voice: 'longanqian', apiKey: 'sk-fixture-realtime-key', remember: true, workspaceId: 'workspace-1' })
  assert.equal(JSON.stringify(settings.snapshot()).includes('sk-fixture'), false)
  assert.equal((await readFile(file, 'utf8')).includes('sk-fixture'), false)
  const restored = new ModelSettings({ file, encryption }); await restored.load()
  assert.equal(restored.key(), 'sk-fixture-realtime-key')
  assert.equal(restored.snapshot().source, 'realtime')
  assert.equal(restored.snapshot().model, 'qwen-audio-3.0-realtime-flash')
  assert.equal(restored.snapshot().voice, 'longanqian', 'explicit saved voice is preserved')
  assert.equal(restored.snapshot().platformEnabled, false)
  await restored.configure({ forget: true })
  assert.equal(restored.key(), '')
  assert.equal(restored.snapshot().source, 'realtime', 'clearing a key never silently enables paid platform service')
  await assert.rejects(restored.configure({ workspaceId: 'bad.example/secret' }))
})

test('loading the legacy Realtime default pair migrates both fields and preserves credentials and preferences', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'model-default-migration-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const encryption = { isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value).reverse(), decryptString: value => Buffer.from(value).reverse().toString() }
  const file = path.join(directory, 'models.json')
  const legacy = { source: 'realtime', platformEnabled: false, remember: true, region: 'ap-southeast-1',
    workspaceId: 'saved-space', model: 'qwen3.8-omni-flash-realtime', voice: 'Tina',
    encryptedKey: encryption.encryptString('fixture-realtime-key').toString('base64') }
  await writeFile(file, JSON.stringify(legacy))
  const settings = new ModelSettings({ file, encryption }); await settings.load()
  assert.deepEqual(settings.snapshot(), { source: 'realtime', platformEnabled: false, remember: true,
    region: 'ap-southeast-1', workspaceId: 'saved-space', model: 'qwen-audio-3.0-realtime-flash',
    voice: 'longanlingxi', configured: true, storageAvailable: true })
  assert.equal(settings.key(), 'fixture-realtime-key')
  const session = ownRealtimeSession(settings, { agentId: 'local-role' })
  assert.equal(session.modelId, 'qwen-audio-3.0-realtime-flash')
  assert.equal(session.voiceId, 'longanlingxi')
  await settings.configure({})
  const restored = new ModelSettings({ file, encryption }); await restored.load()
  assert.deepEqual(restored.snapshot(), settings.snapshot())
  assert.equal(restored.key(), settings.key())
  assert.equal((await readFile(file, 'utf8')).includes('fixture-realtime-key'), false)
})

test('legacy custom Realtime pairs and explicitly resaved old defaults are preserved', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'model-custom-defaults-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'models.json'), encryption = { isEncryptionAvailable: () => false }
  for (const pair of [
    { model: 'qwen3.8-omni-flash-realtime', voice: 'custom-voice' },
    { model: 'qwen-custom-realtime', voice: 'Tina' },
    { model: 'qwen-audio-3.0-realtime-flash', voice: 'longanqian' },
  ]) {
    await writeFile(file, JSON.stringify(pair))
    const settings = new ModelSettings({ file, encryption }); await settings.load()
    assert.equal(settings.snapshot().model, pair.model)
    assert.equal(settings.snapshot().voice, pair.voice)
  }
  const settings = new ModelSettings({ file, encryption })
  await settings.configure({ model: 'qwen3.8-omni-flash-realtime', voice: 'Tina' })
  const restored = new ModelSettings({ file, encryption }); await restored.load()
  assert.equal(restored.snapshot().model, 'qwen3.8-omni-flash-realtime')
  assert.equal(restored.snapshot().voice, 'Tina')
})

test('own Realtime bootstrap supports the Qwen Audio flash model and has no billing ticket', async () => {
  const settings = { key: () => 'fixture-own-key', snapshot: () => ({ workspaceId: 'test-space',
    region: 'cn-beijing', model: 'qwen-audio-3.0-realtime-flash', voice: 'longanqian' }) }
  const session = ownRealtimeSession(settings, { agentId: 'waner', characterSetting: '你是上官婉儿' })
  assert.equal(session.providerUrl, 'wss://test-space.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-flash')
  assert.equal(session.modelId, 'qwen-audio-3.0-realtime-flash')
  assert.equal(session.voiceId, 'longanqian')
  assert.equal(session.apiKey, 'fixture-own-key')
  assert.equal(session.funding, 'own')
  assert.equal(session.billingTicket, undefined)
})

test('testing a Realtime draft uses current inputs without changing saved preferences or credentials', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'realtime-draft-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'models.json')
  const settings = new ModelSettings({ file, encryption: { isEncryptionAvailable: () => false } })
  await settings.load()
  const before = settings.snapshot()
  const preview = settings.preview({ apiKey: 'fixture-draft-key', workspaceId: 'draft-space', voice: 'longanlingxi' })
  const session = ownRealtimeSession(preview, { agentId: 'connection-test' })
  assert.equal(session.apiKey, 'fixture-draft-key')
  assert.equal(session.voiceId, 'longanlingxi')
  assert.match(session.providerUrl, /draft-space\.cn-beijing/)
  assert.deepEqual(settings.snapshot(), before)
  assert.equal(settings.key(), '')
  await assert.rejects(readFile(file), { code: 'ENOENT' })
  await settings.configure({ apiKey: 'fixture-saved-key', workspaceId: 'saved-space' })
  assert.equal(ownRealtimeSession(settings.preview({ apiKey: '', voice: 'longanlingxi' }), { agentId: 'test' }).apiKey, 'fixture-saved-key')
})

test('testing a DeepSeek draft normalizes the current Key without saving or enabling Harness', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'deepseek-draft-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'assistant.json')
  const settings = new AssistantSettings({ file, encryption: { isEncryptionAvailable: () => false } })
  const before = settings.snapshot()
  assert.equal(settings.preview({ apiKey: ' Bearer fixture-draft-deepseek ' }).key(), 'fixture-draft-deepseek')
  assert.deepEqual(settings.snapshot(), before)
  assert.equal(settings.key(), '')
  await assert.rejects(readFile(file), { code: 'ENOENT' })
  assert.throws(() => settings.preview({ apiKey: 'bad' }), { code: 'INVALID_KEY' })
  assert.throws(() => settings.preview({ apiKey: 'fixture-key', enabled: true }), { code: 'INVALID_SETTINGS' })
  await settings.configure({ apiKey: 'fixture-saved-deepseek', enabled: false, remember: false })
  assert.equal(settings.preview({ apiKey: '' }).key(), 'fixture-saved-deepseek')
  assert.equal(settings.snapshot().enabled, false)
})
