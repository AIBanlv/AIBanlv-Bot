import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { DeviceRuntime } from '../electron/device-runtime.mjs'
import { DeviceAvatarCache } from '../electron/device-avatar-cache.mjs'
import { archiveFixture } from './avatar-fixture.mjs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const role = (id, voice = `voice-${id}`) => ({
  agentId: id, agentName: id, voiceId: voice, language: 'zh',
  zipUrl: `https://qn.ieasysell.com/${id}.zip`, profileVersion: 0,
})

test('an asset-free local bot changes conversation identity without downloading or replacing the displayed avatar', async t => {
  let downloads = 0, stops = 0
  const { runtime, channel, files } = fixture(t, async () => { downloads++; return Buffer.from('fixture avatar') })
  await runtime.apply({ ...role('previous'), source: 'local' }); runtime.rendered(runtime.state.renderId, 'ready')
  const asset = runtime.state.renderAsset, renderId = runtime.state.renderId
  runtime.on('stop-speech', () => { stops++ })
  const bot = { agentId: 'local-bot', agentName: '工作 Bot', source: 'local', zipUrl: '', voiceId: 'own-bot-voice', characterSetting: '新角色的人设' }
  await runtime.apply(bot)
  assert.equal(runtime.state.phase, 'ready')
  assert.deepEqual(runtime.state.current, bot)
  assert.equal(runtime.state.renderAsset, asset)
  assert.equal(runtime.state.renderId, renderId)
  assert.equal(files.has(asset), true)
  assert.equal(downloads, 1)
  assert.equal(stops, 1, 'Prior character conversation is stopped, not reused')
  await runtime.apply({ ...bot, agentId: 'local-bot-two', characterSetting: '第二个独立角色' })
  assert.equal(runtime.state.renderId, renderId)
  assert.equal(downloads, 1)
  assert.equal(channel.reports.length, 0)
})

test('an asset-free local bot is conversation-ready with no previous avatar and survives a late cancelled download', async t => {
  let finish
  const { runtime, channel } = fixture(t, () => new Promise(resolve => { finish = resolve }))
  const pending = runtime.apply({ ...role('old'), publicAvatar: true })
  const bot = { agentId: 'local-bot', source: 'local', zipUrl: '', voiceId: 'local-voice', characterSetting: '本地角色' }
  await runtime.apply(bot)
  assert.equal(runtime.state.phase, 'ready')
  assert.equal(runtime.state.current.agentId, bot.agentId)
  assert.equal(runtime.state.renderAsset, '')
  finish(Buffer.from('late avatar')); await pending
  assert.equal(runtime.state.current.agentId, bot.agentId)
  channel.state = { binding: 'unbound', connection: 'offline' }; channel.emit('state', channel.state)
  assert.equal(runtime.state.phase, 'ready')
})

test('reusing a public image never turns a local bot into a platform-funded role, including after revocation', async t => {
  const { runtime, channel } = fixture(t)
  await runtime.apply({ ...role('public-visual'), publicAvatar: true }); runtime.rendered(runtime.state.renderId, 'ready')
  const asset = runtime.state.renderAsset
  await runtime.apply({ agentId: 'local-bot', source: 'local', zipUrl: '', voiceId: 'local-voice' })
  channel.state = { binding: 'unbound', connection: 'offline' }; channel.emit('revoked'); channel.emit('state', channel.state)
  assert.equal(runtime.state.current.agentId, 'local-bot')
  assert.equal(runtime.state.current.source, 'local')
  assert.equal(runtime.state.current.publicAvatar, undefined)
  assert.equal(runtime.state.renderAsset, asset)
})

test('an inherited private image is revoked without destroying local bot chat or local history identity', async t => {
  const { runtime, channel, files } = fixture(t)
  Object.assign(channel.state, { owner: 'owner-a' }); channel.tenantId = 'tenant-a'
  await runtime.apply(role('private')); runtime.rendered(runtime.state.renderId, 'ready')
  const asset = runtime.state.renderAsset
  await runtime.apply({ agentId: 'local-bot', source: 'local', zipUrl: '', voiceId: 'local-voice' })
  Object.assign(channel.state, { owner: 'owner-b' }); channel.emit('state', channel.state)
  assert.equal(runtime.state.current.agentId, 'local-bot')
  assert.equal(runtime.state.phase, 'ready')
  assert.equal(runtime.state.renderAsset, '')
  assert.equal(files.has(asset), false)
})

test('a failed inherited iframe does not prevent an asset-free bot from continuing the conversation', async t => {
  const { runtime } = fixture(t)
  await runtime.apply({ ...role('visual'), source: 'local' }); runtime.rendered(runtime.state.renderId, 'ready')
  await runtime.apply({ agentId: 'local-bot', source: 'local', zipUrl: '', voiceId: 'local-voice' })
  runtime.rendered(runtime.state.renderId, 'error')
  assert.equal(runtime.state.current.agentId, 'local-bot')
  assert.equal(runtime.state.phase, 'ready')
  assert.equal(runtime.state.renderAsset, '')
})

test('a local role stays local across platform login and revocation without role reports', async t => {
  const { runtime, channel } = fixture(t)
  channel.state = { binding: 'unbound', connection: 'offline' }
  await runtime.apply({ ...role('local'), source: 'local' })
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current?.source, 'local')
  channel.state = { binding: 'bound', connection: 'connected' }
  channel.emit('state', channel.state)
  channel.emit('revoked')
  assert.equal(runtime.state.current?.agentId, 'local')
  assert.equal(channel.reports.length, 0)
})

test('local: avatars bypass the HTTPS disk cache, load offline and reuse their own local bytes', async t => {
  let reads=0
  const {runtime,channel}=fixture(t,async url=>{assert.equal(url,'local:fixture');reads++;return archiveFixture()},
    {assetCache:new DeviceAvatarCache({directory:'/not-used-for-local'})})
  channel.state={binding:'unbound',connection:'offline'}
  const profile={...role('local'),source:'local',zipUrl:'local:fixture'}
  await runtime.apply(profile)
  assert.equal(runtime.state.phase,'rendering');runtime.rendered(runtime.state.renderId,'ready')
  await runtime.retry();runtime.rendered(runtime.state.renderId,'ready')
  assert.equal(runtime.state.current.agentId,'local');assert.equal(reads,1)
  assert.equal(channel.reports.length,0)
})

test('missing local avatar reports a reimport action, never a network or Control App error', async t => {
  const {runtime}=fixture(t,async()=>{throw Object.assign(new Error('missing file'),{code:'ENOENT'})},
    {assetCache:new DeviceAvatarCache({directory:'/not-used-for-local'})})
  await runtime.apply({...role('local'),source:'local',zipUrl:'local:fixture'})
  assert.equal(runtime.state.phase,'error');assert.match(runtime.state.error,/本地形象文件不存在.*重新导入/)
  assert.doesNotMatch(runtime.state.error,/网络|Control App/)
})

test('revoking an account during local-role loading removes private assets without cancelling the local switch', async t => {
  let finish
  const { runtime, channel } = fixture(t, url => url.includes('/local.zip')
    ? new Promise(resolve => { finish = resolve }) : Promise.resolve(Buffer.from('private asset')))
  await runtime.apply(role('private')); runtime.rendered(runtime.state.renderId, 'ready')
  const privateAsset = runtime.state.renderAsset
  const switching = runtime.apply({ ...role('local'), source: 'local' })
  channel.emit('revoked')
  assert.equal(runtime.state.current, null)
  assert.equal(runtime.files.has(privateAsset), false)
  assert.equal(runtime.state.desired.agentId, 'local')
  channel.state = { binding: 'unbound', connection: 'offline' }; channel.emit('state', channel.state)
  finish(Buffer.from('local asset')); await switching
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current.agentId, 'local')
})

test('revoking a pending online selection returns to the existing local role', async t => {
  let finish
  const { runtime, channel } = fixture(t, url => url.includes('/private.zip')
    ? new Promise(resolve => { finish = resolve }) : Promise.resolve(Buffer.from('local asset')))
  await runtime.apply({ ...role('local'), source: 'local' }); runtime.rendered(runtime.state.renderId, 'ready')
  const localAsset = runtime.state.renderAsset
  const switching = runtime.apply(role('private'))
  channel.emit('revoked')
  channel.state = { binding: 'unbound', connection: 'offline' }; channel.emit('state', channel.state)
  finish(Buffer.from('late private asset')); await switching
  assert.equal(runtime.state.current?.agentId, 'local')
  assert.equal(runtime.state.desired?.source, 'local')
  assert.equal(runtime.state.renderAsset, localAsset)
  assert.equal(runtime.state.phase, 'ready')
})

test('an unbound offline desktop loads the public default and retains it on disconnect', async t => {
  const channel = new EventEmitter(); channel.state = { binding: 'unbound', connection: 'offline' }
  channel.report = () => assert.fail('anonymous role must not report account state')
  const runtime = new DeviceRuntime({ channel, files: new Map(), directory: 'fixture',
    defaultProfile: async () => ({ ...role('waner'), publicAvatar: true }),
    download: async () => Buffer.from('validated fixture'), save: async () => {}, remove: async () => {} })
  t.after(() => runtime.dispose())
  await runtime.ensureInitialProfile()
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current.agentId, 'waner')
  channel.emit('state', channel.state)
  assert.equal(runtime.state.phase, 'ready')
  await runtime.apply(role('private'))
  assert.equal(runtime.state.current.agentId, 'waner')
})

test('a new desktop runtime loads downloaded avatar bytes from the persistent local cache without any network download', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'control-runtime-cache-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let downloads = 0
  const download = async () => { downloads++; return archiveFixture() }
  const first = fixture(t, download, { assetCache: new DeviceAvatarCache({ directory }) }).runtime
  await first.apply(role('persistent')); await first.dispose()
  const second = fixture(t, download, { assetCache: new DeviceAvatarCache({ directory }) }).runtime
  await second.apply(role('persistent'))
  assert.equal(second.state.phase, 'rendering')
  assert.equal(downloads, 1)
})

test('switching keeps the current iframe stable until the new archive is ready and reuses binding-local bytes', async t => {
  const requested = []
  let finish
  const { runtime } = fixture(t, async url => {
    requested.push(url)
    if (url.includes('/b.zip')) return new Promise(resolve => { finish = resolve })
    return Buffer.from('validated A')
  })
  await runtime.apply(role('a'))
  runtime.rendered(runtime.state.renderId, 'ready')
  const before = runtime.state.renderId
  const switching = runtime.apply(role('b'))
  assert.equal(runtime.state.renderId, before, 'Do not recreate the old iframe while fetching')
  finish(Buffer.from('validated B')); await switching
  assert.notEqual(runtime.state.renderId, before)
  runtime.rendered(runtime.state.renderId, 'ready')
  await runtime.apply(role('a'))
  assert.equal(requested.length, 2, 'Switching back must not download again')
  runtime.clear()
  assert.equal(runtime.cache.size, 0, 'Revocation must erase private bytes')
})

test('a stalled iframe fails visibly without requiring a binding refresh', async t => {
  const { runtime } = fixture(t, undefined, { renderMs: 5 })
  await runtime.apply(role('a'))
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal(runtime.state.phase, 'error')
  assert.match(runtime.state.error, /画面加载超时/)
  assert.equal(runtime.pending, null)
})

test('phone switches and desktop catalog switches finish without reconnecting the control channel', async t => {
  const { runtime, channel } = fixture(t)
  await runtime.apply(role('a'))
  runtime.rendered(runtime.state.renderId, 'ready')
  channel.emit('profile', role('phone'), 'phone-request', 'switch_avatar')
  await Promise.allSettled([...runtime.jobs])
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current.agentId, 'phone')
  await runtime.apply({ ...role('catalog'), fromCatalog: true })
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current.agentId, 'catalog')
  assert.equal(channel.state.connection, 'connected')
  assert.equal(channel.reports.filter(row => row.status === 'applied').length, 3)
})

test('an old guest flag cannot load an avatar before scan binding', async t => {
  const { runtime, channel } = fixture(t)
  channel.state.binding = 'unbound'; channel.state.guest = true
  await runtime.apply(role('public'))
  assert.equal(runtime.state.phase, 'idle')
  assert.equal(runtime.state.current, null)
  assert.deepEqual(channel.reports, [])
})

test('an old guest flag cannot load the default avatar while offline', async t => {
  let requests = 0
  const { runtime, channel } = fixture(t, undefined, { defaultProfile: async () => { requests++; return role('waner') } })
  Object.assign(channel.state, { binding: 'unbound', guest: true, connection: 'offline' })
  channel.emit('state', channel.state)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.state.phase, 'idle')
  assert.equal(runtime.state.current, null)
  assert.equal(requests, 0)
})
function fixture(t, download = async () => Buffer.from('validated archive'), options = {}) {
  const channel = new EventEmitter()
  channel.state = { binding: 'bound', connection: 'connected', deviceId: 'device' }
  channel.reports = []
  channel.report = (profile, status) => channel.reports.push({ profile, status })
  const files = new Map()
  const runtime = new DeviceRuntime({ channel, files, directory: '/test',
    download, save: async () => {}, remove: async () => {}, defaultProfile: async () => ({ ...role('waner'), publicAvatar: true }), ...options })
  t.after(() => runtime.dispose())
  return { runtime, channel, files }
}

test('voice and avatar commit together only after actual render readiness', async t => {
  const { runtime, channel } = fixture(t)
  await runtime.apply(role('a'))
  assert.equal(runtime.state.current, null)
  assert.equal(runtime.state.phase, 'rendering')
  assert.deepEqual(channel.reports.map(item => item.status), ['unknown'])
  const revision = runtime.state.renderId
  runtime.rendered(revision, 'ready')
  assert.equal(runtime.state.current.voiceId, 'voice-a')
  assert.equal(channel.reports.at(-1).status, 'applied')
  await runtime.apply(role('b'))
  runtime.rendered(revision, 'ready')
  assert.equal(runtime.state.current.agentId, 'a')
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current.voiceId, 'voice-b')
})

test('download starts with unknown and failure never reports an applied avatar', async t => {
  let rejectDownload
  const { runtime, channel } = fixture(t, () => new Promise((_resolve, reject) => { rejectDownload = reject }))
  const applying = runtime.apply(role('a'))
  assert.equal(runtime.state.phase, 'downloading')
  assert.deepEqual(channel.reports.map(item => item.status), ['unknown'])
  rejectDownload(new Error('download failed'))
  await applying
  assert.equal(runtime.state.phase, 'error')
  assert.equal(runtime.state.current, null)
  assert.deepEqual(channel.reports.map(item => item.status), ['unknown', 'failed'])
})

test('binding immediately loads waner once without waiting for a server replay', async t => {
  let lookups = 0
  const { channel, runtime } = fixture(t, undefined, { defaultProfile: async () => {
    lookups++
    return role('waner')
  } })
  let syncs = 0
  channel.online = () => { syncs++; channel.emit('state', channel.state) }
  channel.emit('state', channel.state)
  channel.emit('state', channel.state)
  assert.equal(lookups, 1)
  assert.equal(syncs, 0)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.state.phase, 'rendering')
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current.agentId, 'waner')
  assert.equal(channel.reports.at(-1).status, 'applied')
})

test('explicit phone selection during default lookup wins and cancels the lookup', async t => {
  let finish, signal
  const { runtime, channel } = fixture(t, undefined, { defaultProfile: value => {
    signal = value
    return new Promise(resolve => { finish = resolve })
  } })
  channel.emit('state', channel.state)
  channel.emit('profile', role('selected'), 'phone-request', 'apply_agent_config')
  assert.equal(signal.aborted, true)
  finish(role('waner'))
  await new Promise(resolve => setImmediate(resolve))
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current.agentId, 'selected')
})

test('startup state replays cannot replace waner before or after it renders', async t => {
  let finish, signal
  const { runtime, channel } = fixture(t, undefined, { defaultProfile: value => {
    signal = value
    return new Promise(resolve => { finish = resolve })
  } })
  channel.emit('state', channel.state)
  const previous = { ...role('previous'), profileVersion: 10 }
  channel.emit('profile', previous, '', 'agent_state_desired')
  assert.equal(runtime.state.desired, null)
  assert.equal(signal.aborted, false)
  finish(role('waner'))
  await new Promise(resolve => setImmediate(resolve))
  channel.emit('profile', previous, '', 'agent_state_desired')
  runtime.rendered(runtime.state.renderId, 'ready')
  channel.emit('profile', previous, '', 'agent_state_desired')
  assert.equal(runtime.state.current.agentId, 'waner')
  assert.equal(runtime.state.desired.agentId, 'waner')
  assert.equal(runtime.state.phase, 'ready')

  await runtime.apply(role('manual'))
  runtime.rendered(runtime.state.renderId, 'ready')
  channel.emit('state', channel.state)
  assert.equal(runtime.state.current.agentId, 'manual')
  channel.emit('profile', { ...role('updated'), profileVersion: 11 }, '', 'agent_state_desired')
  await new Promise(resolve => setImmediate(resolve))
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current.agentId, 'updated')
})

test('unbind cancels the old default lookup and reloads the public default without accepting late results', async t => {
  const pending = []
  const { runtime, channel, files } = fixture(t, undefined, {
    defaultProfile: signal => new Promise(resolve => pending.push({ signal, resolve })),
  })
  channel.emit('state', channel.state)
  channel.state.binding = 'unbound'
  channel.emit('state', channel.state)
  channel.emit('revoked')
  assert.equal(pending[0].signal.aborted, true)
  pending[1].resolve({ ...role('waner'), publicAvatar: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.state.current, null)
  runtime.rendered(runtime.state.renderId, 'ready')
  pending[0].resolve(role('old-private'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.state.current.agentId, 'waner')
  assert.equal(files.size, 1)
})

test('a public default lookup survives account disconnect and reconnect without starting duplicate requests', async t => {
  const pending = []
  const { runtime, channel } = fixture(t, undefined, { defaultProfile: signal =>
    new Promise(resolve => pending.push({ signal, resolve })) })
  channel.state.connection = 'offline'
  channel.emit('state', channel.state)
  assert.equal(pending.length, 0)
  channel.state.connection = 'connected'
  channel.emit('state', channel.state)
  channel.state.connection = 'offline'
  channel.state.binding = 'unknown'
  channel.emit('state', channel.state)
  assert.equal(pending[0].signal.aborted, false)
  channel.state.connection = 'connected'
  channel.state.binding = 'bound'
  channel.emit('state', channel.state)
  assert.equal(pending.length, 1)
  pending[0].resolve({ ...role('waner'), publicAvatar: true })
  await new Promise(resolve => setImmediate(resolve))
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current.agentId, 'waner')
  assert.equal(runtime.state.desired.agentId, 'waner')
})

test('retrying a failed default download still ignores old state replays', async t => {
  let downloads = 0
  const { runtime, channel } = fixture(t, async () => {
    if (++downloads === 1) throw new Error('offline')
    return Buffer.from('validated archive')
  }, { defaultProfile: async () => role('waner') })
  channel.emit('state', channel.state)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.state.phase, 'error')
  await runtime.retry()
  channel.emit('profile', role('previous'), '', 'agent_state_desired')
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current.agentId, 'waner')
  assert.equal(downloads, 2)
})

test('default failures can be retried and a new binding starts with waner again', async t => {
  let lookups = 0
  const { runtime, channel } = fixture(t, undefined, { defaultProfile: async () => {
    lookups++
    if (lookups === 1) throw new Error('offline')
    return role('waner')
  } })
  channel.emit('state', channel.state)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.state.phase, 'error')
  assert.match(runtime.state.error, /上官婉儿/)
  runtime.retry()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.state.desired.agentId, 'waner')
  await runtime.apply(role('manual'))
  runtime.clear()
  channel.emit('state', channel.state)
  channel.emit('profile', role('previous-binding'), '', 'agent_state_desired')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.state.desired.agentId, 'waner')
  assert.equal(lookups, 3)
})

test('a late download and a late iframe cannot overwrite a newer selection', async t => {
  const pending = []
  const { runtime } = fixture(t, () => new Promise(resolve => pending.push(resolve)))
  const a = runtime.apply(role('a'))
  const b = runtime.apply(role('b'))
  pending[1](Buffer.from('b')); await b
  const revision = runtime.state.renderId
  pending[0](Buffer.from('a')); await a
  assert.equal(runtime.state.renderId, revision)
  runtime.rendered(revision, 'ready')
  assert.equal(runtime.state.current.agentId, 'b')
})

test('failed render does not apply the new voice; unbind revokes cached roles and pending work', async t => {
  const { runtime, channel, files } = fixture(t)
  await runtime.apply(role('a'))
  runtime.rendered(runtime.state.renderId, 'ready')
  await runtime.apply(role('b'))
  runtime.rendered(runtime.state.renderId, 'error')
  assert.equal(runtime.state.current.agentId, 'a')
  assert.equal(channel.reports.at(-1).status, 'failed')
  channel.state.binding = 'unbound'
  channel.emit('revoked')
  assert.equal(runtime.state.current, null)
  assert.equal(runtime.state.roles.length, 0)
  assert.equal(files.size, 0)
  await runtime.apply(role('c'))
  assert.equal(runtime.state.current, null)
})

test('older version cannot roll back an applied role; profile-only voice change keeps the correct image', async t => {
  const { runtime } = fixture(t)
  await runtime.apply({ ...role('a'), profileVersion: 5 })
  runtime.rendered(runtime.state.renderId, 'ready')
  await runtime.apply({ ...role('b'), profileVersion: 4 })
  assert.equal(runtime.state.current.agentId, 'a')
  await runtime.apply({ ...role('a', 'new-online-voice'), profileVersion: 6 })
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current.voiceId, 'new-online-voice')
})

test('disconnect during download allows the same server profile to be reapplied after reconnect', async t => {
  const pending = []
  const { runtime, channel } = fixture(t, () => new Promise(resolve => pending.push(resolve)))
  const first = runtime.apply(role('a'))
  channel.state.binding = 'unknown'
  channel.emit('state', channel.state)
  pending[0](Buffer.from('a')); await first
  channel.state.binding = 'bound'
  channel.emit('state', channel.state)
  const second = runtime.apply(role('a'))
  assert.equal(pending.length, 2)
  pending[1](Buffer.from('a')); await second
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current.agentId, 'a')
})

test('older server version cannot cancel a newer accepted download', async t => {
  const pending = []
  const { runtime } = fixture(t, () => new Promise(resolve => pending.push(resolve)))
  const newer = runtime.apply({ ...role('new'), profileVersion: 10 })
  const older = runtime.apply({ ...role('old'), profileVersion: 9 })
  assert.equal(pending.length, 1)
  pending[0](Buffer.from('new')); await newer; await older
  runtime.rendered(runtime.state.renderId, 'ready')
  assert.equal(runtime.state.current.agentId, 'new')
})

test('partial write failures are removed even before the file is exposed to the renderer', async t => {
  const { runtime, files } = fixture(t)
  const removed = []
  let written
  runtime.save = async file => { written = file; throw new Error('disk full after partial write') }
  runtime.remove = async file => removed.push(file)
  await runtime.apply(role('a'))
  await runtime.dispose()
  assert.ok(removed.includes(written))
  assert.equal(files.size, 0)
  assert.equal(runtime.state.current, null)
})
