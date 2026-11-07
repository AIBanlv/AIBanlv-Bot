import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DeviceCatalog, loadCatalog, profileKind } from '../electron/device-catalog.mjs'

const scope = { tenantId: 'tenant-a', controllerUserId: 'user-a' }
const row = (id, extra = {}) => ({ id, name: id, tenantId: 'tenant-a', userId: 'user-a',
  digitalHumanId: `model-${id}`, voiceId: 'longanqian', ...extra })
const response = rows => Response.json({ code: 200, data: rows })
const profile = agentId => ({ agentId, voiceId: 'longanqian' })
const flush = () => new Promise(resolve => setImmediate(resolve))

test('tenant private characters without userId and phone-distributed characters never default to public', async () => {
  const profiles=await loadCatalog(scope,undefined,async()=>response([
    row('tenant-private',{userId:null}),row('user-private'),row('public',{tenantId:'1',userId:null}),row('default-clone',{userId:null,isDefault:true}),
  ]))
  assert.deepEqual(profiles.map(profile=>profile.kind),['private','private','public','private'])
  assert.equal(profileKind({agentId:'distributed',source:'online'}),'private')
  assert.equal(profileKind({source:'local'}),'local')
  assert.equal(profileKind({publicAvatar:true}),'public')
})

test('the public catalog loads on startup even with the account connection offline', async t => {
  const channel = new EventEmitter(); channel.state = { binding: 'unbound', connection: 'offline' }
  const seen = []
  const catalog = new DeviceCatalog({ channel, load: async scope => { seen.push(scope); return [profile('waner')] } })
  t.after(() => catalog.dispose())
  await flush()
  assert.deepEqual(seen, [{ guest: true }])
  assert.equal(catalog.find('waner').agentId, 'waner')
  channel.emit('state', channel.state)
  assert.equal(seen.length, 1)
})

test('guests query public roles only and cannot receive private roles', async () => {
  const profiles = await loadCatalog({ guest: true }, undefined, async url => {
    assert.equal(new URL(url).pathname, '/jwt/client/desktop-public/roles')
    assert.equal(new URL(url).search, '')
    return response([row('public', { tenantId: '1', userId: null }), row('private'),
      row('owned-public', { tenantId: '1' }), row('tenant-shared', { userId: null })])
  })
  assert.deepEqual(profiles.map(p => p.agentId), ['public'])
  assert.equal(profiles[0].publicAvatar, true)
})

test('queries only the confirmed tenant and includes own private, tenant shared and public roles', async () => {
  const profiles = await loadCatalog(scope, undefined, async (url, options) => {
    assert.equal(new URL(url).searchParams.get('tenantId'), scope.tenantId)
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit')
    return response([row('own'), row('shared', { userId: null }), row('public', { tenantId: '1', userId: null }),
      row('foreign-user', { userId: 'user-b' }), row('foreign-tenant', { tenantId: 'tenant-b' }),
      row('invalid-owner', { userId: {} }),
      row('foreign-public-private', { tenantId: '1', userId: 'user-b' })])
  })
  assert.deepEqual(profiles.map(p => p.agentId), ['own', 'shared', 'public'])
  assert.equal(profiles[0].zipUrl, 'https://zhanlvgpt.ieasysell.com/tenant-a/model-own/model-own.zip')
  assert.equal(profiles[0].voiceId, 'longanqian')
})

test('uses public default ZIP layout, preserves settings and excludes unsafe or ambiguous entries', async () => {
  const profiles = await loadCatalog(scope, undefined, async () => response([
    row('default', { isDefault: 1, tenantId: '1', userId: null, characterSetting: 'setting', languageCode: 'en' }),
    row('explicit', { zipUrl: 'https://qn.ieasysell.com/explicit.zip' }),
    row('unsafe', { zipUrl: 'file:///C:/secret.zip' }), row('duplicate'), row('duplicate', { voiceId: 'other' }),
  ]))
  assert.deepEqual(profiles.map(p => p.agentId), ['default', 'explicit'])
  assert.match(profiles[0].zipUrl, /\.com\/1\//)
  assert.equal(profiles[0].characterSetting, 'setting'); assert.equal(profiles[0].language, 'en')
})

test('missing binding, errors, oversized lists and cancellation never become a successful catalog', async () => {
  let requests = 0
  for (const binding of [{}, { tenantId: '1' }, { controllerUserId: 'user' }]) {
    await assert.rejects(loadCatalog(binding, undefined, async () => { requests++; return response([]) }))
  }
  assert.equal(requests, 0)
  for (const fetcher of [async () => new Response('', { status: 403 }),
    async () => Response.json({ ok: false, data: [] }),
    async () => Response.json({ code: 401, data: [] }), async () => response(Array(1001).fill(row('many'))),
    async () => new Response('x'.repeat(4 * 1024 * 1024 + 1))]) {
    await assert.rejects(loadCatalog(scope, undefined, fetcher))
  }
  const abort = new AbortController(); abort.abort()
  await assert.rejects(loadCatalog(scope, abort.signal, async (_url, opts) => opts.signal.throwIfAborted()))
})

test('Control catalog ZIP aliases and model ID fallback keep trained private avatars selectable', async () => {
  const profiles = await loadCatalog(scope, undefined, async () => response([
    row('trained', { digitalHumanId: null }),
    row('resource', { resource_url: 'https://qn.ieasysell.com/trained.zip' }),
    row('default-clone', { isDefault: '1' }),
  ]))
  assert.equal(profiles[0].zipUrl, 'https://zhanlvgpt.ieasysell.com/tenant-a/trained/trained.zip')
  assert.equal(profiles[1].zipUrl, 'https://qn.ieasysell.com/trained.zip')
  assert.match(profiles[2].zipUrl, /\.com\/1\//)
})

function fixture(t, load = async () => [profile('own')]) {
  const channel = new EventEmitter()
  channel.state = { binding: 'unbound', connection: 'connected', deviceId: 'device', owner: '' }
  channel.tenantId = ''; channel.controllerUserId = ''
  const catalog = new DeviceCatalog({ channel, load: (scope, signal) => scope.guest ? [] : load(scope, signal) })
  t.after(() => catalog.dispose())
  const bind = (tenant = 'tenant-a', user = 'user-a') => {
    channel.tenantId = tenant; channel.controllerUserId = user
    Object.assign(channel.state, { binding: 'bound', connection: 'connected', owner: user })
    channel.emit('state', channel.state)
  }
  return { channel, catalog, bind }
}

test('an old guest flag stays blocked until a confirmed binding supplies identity', async t => {
  const pending = []
  const f = fixture(t, (scope, signal) => new Promise(resolve => pending.push({ scope, signal, resolve })))
  Object.assign(f.channel.state, { guest: true, connection: 'offline' })
  f.channel.emit('state', f.channel.state)
  assert.equal(pending.length, 0)
  f.channel.state.guest = false
  f.bind()
  pending[0].resolve([profile('own')]); await flush()
  assert.ok(f.catalog.find('own'))
})

test('binding automatically loads; refresh replaces options, errors remain visible and retries work', async t => {
  let calls = 0, fail = false
  const f = fixture(t, async () => { calls++; if (fail) throw new Error('private payload'); return [profile(`role-${calls}`)] })
  assert.equal(calls, 0)
  f.bind(); await flush()
  assert.equal(f.catalog.state.status, 'ready')
  assert.equal(f.catalog.find('role-1').voiceId, 'longanqian')
  f.bind(); await flush(); assert.equal(calls, 1)
  await f.catalog.refresh()
  assert.equal(f.catalog.find('role-1'), undefined)
  assert.ok(f.catalog.find('role-2'))
  fail = true; await f.catalog.refresh()
  assert.equal(f.catalog.state.status, 'error')
  assert.doesNotMatch(f.catalog.state.error, /private payload/)
  assert.equal(f.catalog.find('role-2'), undefined)
  fail = false; await f.catalog.refresh()
  assert.ok(f.catalog.find('role-4'))
})

test('private catalog waits for pairing proof and loads automatically when authorization becomes ready', async t => {
  let calls=0
  const f=fixture(t,async()=>{calls++;return [profile('private')]})
  f.channel.state.proofRequired=true;f.channel.state.accountAuthReady=false
  f.bind();await flush();assert.equal(calls,0)
  f.channel.state.accountAuthReady=true;f.channel.emit('state',f.channel.state);await flush()
  assert.equal(calls,1);assert.ok(f.catalog.find('private'))
  f.channel.state.accountAuthReady=false;f.channel.emit('state',f.channel.state)
  assert.deepEqual(f.catalog.state.profiles,[])
})

test('owner changes, disconnect and unbind clear private options and ignore late results', async t => {
  const pending = []
  const f = fixture(t, (binding, signal) => new Promise(resolve => pending.push({ binding, signal, resolve })))
  f.bind(); await flush()
  f.bind('tenant-a', 'user-b'); await flush()
  assert.equal(pending[0].signal.aborted, true)
  pending[0].resolve([profile('old')]); await flush()
  assert.equal(f.catalog.find('old'), undefined)
  pending[1].resolve([profile('new')]); await flush()
  assert.ok(f.catalog.find('new'))
  f.channel.state.connection = 'offline'; f.channel.emit('state', f.channel.state)
  assert.deepEqual(f.catalog.state.profiles, [])
  f.bind(); await flush()
  f.channel.emit('revoked')
  pending[2].resolve([profile('late')]); await flush()
  assert.deepEqual(f.catalog.state.profiles, [])
})
