import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DeviceHttpAuth } from '../electron/device-http-auth.mjs'

const origin = 'https://scrm.ieasysell.com'
const roles = `${origin}/jwt/client/aliBot/getBotListTWithPublic?tenantId=7`

test('role creation uses its new desktop HTTP route and scoped Bearer credential',async t=>{
  const f=fixture(t),url=`${origin}/jwt/client/desktop/role-creation`
  await f.auth.fetch(url,{method:'POST',body:'{}'})
  assert.equal(f.calls.at(-1).url,url)
  assert.equal(new Headers(f.calls.at(-1).options.headers).get('Authorization'),'Bearer fixture-jwt')
  await assert.rejects(f.auth.fetch(url,{method:'GET'}))
})

test('Windows realtime sessions use the dedicated balance-checked endpoint without falling back', async t => {
  const f=fixture(t)
  await f.auth.fetch(`${origin}/jwt/client/desktop/metered-realtime/sessions`,{method:'POST',body:'{}'})
  assert.equal(f.calls.at(-1).url,`${origin}/jwt/client/desktop/metered-realtime/sessions`)
  assert.equal(new Headers(f.calls.at(-1).options.headers).get('Authorization'),'Bearer fixture-jwt')
  assert.equal(f.calls.length,2)
})
test('public role catalog never obtains or sends a JWT, even while bound', async t => {
  const f = fixture(t)
  const url = `${origin}/jwt/client/desktop-public/roles`
  await f.auth.fetch(url)
  f.channel.state.binding = 'unbound'
  await f.auth.fetch(url)
  assert.equal(f.calls.length, 2)
  for (const call of f.calls) assert.equal(new Headers(call.options.headers).get('Authorization'), null)
})
function fixture(t, fetchImpl, now = Date.now) {
  const channel = new EventEmitter()
  channel.state = { deviceId: 'device-fixture', binding: 'bound', connection: 'connected', accountAuthReady: true }
  channel.tenantId = '7'; channel.controllerUserId = '42'
  const calls = []
  const auth = new DeviceHttpAuth({ channel, proof: () => 'f'.repeat(64), now, fetchImpl: async (url, options) => {
    calls.push({ url, options })
    if (fetchImpl) return fetchImpl(url, options)
    return Response.json({ code: 200, data: new URL(url).pathname.endsWith('/token')
      ? { accessToken: 'fixture-jwt', expiresAt: now()+300000,
          deviceId: 'device-fixture', tenantId: '7', controllerUserId: '42' } : [] })
  } })
  t.after(() => auth.dispose())
  return { auth, channel, calls }
}
test('scan proof obtains JWT once and all private requests use protected jwt routes with Bearer', async t => {
  const f = fixture(t)
  await Promise.all([f.auth.fetch(roles), f.auth.fetch(roles)])
  assert.equal(f.calls.filter(call => call.url.endsWith('/token')).length, 1)
  const first = f.calls[0]
  assert.equal(first.url, `${origin}/jwt/client/desktop-auth/token`)
  assert.deepEqual(JSON.parse(first.options.body), { deviceId:'device-fixture', deviceProof:'f'.repeat(64) })
  assert.equal(new Headers(first.options.headers).get('Authorization'), null)
  for (const call of f.calls.slice(1)) {
    assert.equal(new URL(call.url).pathname, '/jwt/client/desktop/roles')
    assert.equal(new Headers(call.options.headers).get('Authorization'), 'Bearer fixture-jwt')
    assert.equal(call.options.redirect, 'error'); assert.equal(call.options.credentials, 'omit')
  }
  assert.doesNotMatch(JSON.stringify(f.auth), /fixture-jwt/)
})
test('foreign hosts, unrelated APIs and caller credentials never receive the device token', async t => {
  const f = fixture(t)
  for (const url of ['https://evil.test/jwt/client/desktop/roles', `${origin}/jwt/client/aliBot/updateBot`,
    'http://scrm.ieasysell.com/jwt/client/desktop/roles']) await assert.rejects(f.auth.fetch(url))
  await assert.rejects(f.auth.fetch(roles,{ headers:{ Authorization:'Bearer caller-token' } }))
  assert.equal(f.calls.length,0)
})
test('unbind cancels an in-flight grant and late credentials never authorize the next owner', async t => {
  let resolve
  const f = fixture(t, () => new Promise(done => { resolve=done }))
  const pending = f.auth.fetch(roles)
  await new Promise(done => setImmediate(done))
  f.channel.state.binding='unbound'; f.channel.emit('state', f.channel.state)
  resolve(Response.json({code:200,data:{accessToken:'old-token',expiresAt:Date.now()+300000,
    deviceId:'device-fixture',tenantId:'7',controllerUserId:'42'}}))
  await assert.rejects(pending)
  assert.equal(f.calls.length,1)
})
test('forged or expired grant and denied proofs stop before any private business request', async t => {
  for (const data of [{}, {accessToken:'bad\r\nvalue'}, {accessToken:'token',expiresAt:1},
    {accessToken:'token',expiresAt:Date.now()+300000,deviceId:'other',tenantId:'7',controllerUserId:'42'}]) {
    const f=fixture(t, async()=>Response.json({code:200,data}))
    await assert.rejects(f.auth.fetch(roles)); assert.equal(f.calls.length,1)
  }
})
test('unbound desktops cannot request even public voice metadata', async t => {
  const f=fixture(t); f.channel.state.binding='unbound'; f.channel.emit('state',f.channel.state)
  await assert.rejects(f.auth.fetch(`${origin}/jwt/client/Voice/aliyun/listClientVoices`,{method:'POST',body:'{}'}))
  assert.equal(f.calls.length, 0)
})

test('renewal uses pairing proof before expiry and never replays a denied business POST', async t => {
  let now=Date.now()
  const f=fixture(t,undefined,()=>now)
  await f.auth.fetch(roles)
  now+=280000
  await f.auth.fetch(roles)
  assert.equal(f.calls.filter(call=>call.url.endsWith('/token')).length,2)
  const requests=[]
  const denied=fixture(t,async(url,options)=> {
    requests.push(url)
    return url.endsWith('/token') ? Response.json({code:200,data:{accessToken:'jwt',expiresAt:Date.now()+300000,
      deviceId:'device-fixture',tenantId:'7',controllerUserId:'42'}}) : new Response('',{status:401})
  })
  const result=await denied.auth.fetch(`${origin}/jwt/client/desktop/metered-realtime/sessions`,{method:'POST',body:'{}'})
  assert.equal(result.status,401); assert.equal(requests.length,2)
})

test('caller cancellation stops waiting for proof without sending private business data', async t => {
  const f=fixture(t); f.channel.state.accountAuthReady=false
  const abort=new AbortController()
  const pending=f.auth.fetch(roles,{signal:abort.signal})
  abort.abort()
  await assert.rejects(pending)
  assert.equal(f.calls.length,0)
})

test('disconnected or revoked identities cannot downgrade private calls to anonymous APIs', async t => {
  const f=fixture(t); f.channel.state.binding='unknown'; f.channel.state.connection='offline'
  f.channel.emit('state',f.channel.state)
  await assert.rejects(f.auth.fetch(roles))
  await assert.rejects(f.auth.fetch(`${origin}/jwt/client/desktop/metered-realtime/sessions`,{
    method:'POST',body:JSON.stringify({tenantId:'7'}),
  }))
  assert.equal(f.calls.length,0)
})

test('a request started by an earlier binding listener survives the auth state listener', async t => {
  const f=fixture(t)
  f.channel.state.binding='unbound';f.channel.emit('state',f.channel.state)
  f.channel.state.binding='bound'
  const pending=f.auth.fetch(roles)
  f.channel.emit('state',f.channel.state)
  assert.equal((await pending).status,200)
})
