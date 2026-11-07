import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { OnlineRoles } from '../electron/device-online-roles.mjs'

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibanlv-online-role-'))
  t.after(() => rm(directory,{force:true,recursive:true}))
  const channel=new EventEmitter();channel.state={deviceId:'device',binding:'bound',connection:'connected',owner:'owner',accountAuthReady:true};channel.tenantId='tenant'
  const calls=[], uploads=[]
  const services={request:async (operation,payload)=>{
    calls.push({operation,payload});assert.ok(!payload.tenantId&&!payload.controllerUserId)
    if(operation==='role_upload'){const key=`desktop-roles/${randomUUID()}.${payload.extension}`;return {ok:true,data:{key,token:'fixture-upload-token',url:`https://zhanlvgpt.ieasysell.com/${key}`}}}
    return {ok:true,data:operation==='role_create'?{status:'processing'}:{status:'completed',agentId:'created-online'}}
  }}
  const client=new OnlineRoles({channel,services:{request:()=>assert.fail('Creation must use the unified HTTP endpoint')},
    httpFetch:async(url,options)=>{
      assert.equal(url,'https://scrm.ieasysell.com/jwt/client/desktop/role-creation');assert.equal(options.method,'POST')
      const {operation,payload}=JSON.parse(options.body), result=await services.request(operation,payload)
      return Response.json(result.ok?{code:200,data:result.data}:{code:403,msg:result.code},{status:result.ok?200:403})
    },file:path.join(directory,'jobs.enc'),encryption:{isEncryptionAvailable:()=>false},pollMs:0,
    fetcher:async(url,options)=>{uploads.push({url,body:options.body});assert.equal(url,'https://up-cn-east-2.qiniup.com');assert.equal(options.redirect,'error');return Response.json({key:options.body.get('key')})}})
  t.after(()=>client.dispose())
  const value={requestId:randomUUID(),name:'小光',description:'温柔',prompt:'你是小光',consent:true}
  const media={photo:{bytes:Buffer.from('photo')},voice:{bytes:Buffer.from('voice'),extension:'wav'}}
  return {client,channel,services,calls,uploads,value,media}
}
test('online creation uploads only explicitly selected media with scoped short-lived tickets and reuses a completed request',async t=>{
  const f=await fixture(t)
  const result=await f.client.create(f.value,f.media)
  assert.equal(result.agentId,'created-online');assert.equal(f.uploads.length,2)
  assert.equal(f.calls.filter(row=>row.operation==='role_create').length,1)
  assert.equal((await f.client.create(f.value,f.media)).agentId,'created-online');assert.equal(f.uploads.length,2)
  assert.ok(!JSON.stringify(f.client.snapshot()).includes('fixture-upload-token'))
})
test('unbound devices and missing media consent cannot request any upload or training',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.client.create({...f.value,consent:false},f.media),{code:'MEDIA_CONSENT_REQUIRED'})
  f.channel.state.binding='unbound'
  await assert.rejects(f.client.create(f.value,f.media),{code:'BIND_REQUIRED'})
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.uploads,[])
})
test('changing binding while an upload is pending prevents second upload and training under another account',async t=>{
  const f=await fixture(t)
  f.client.fetcher=async()=>{f.channel.state.owner='another-owner';f.channel.emit('state',f.channel.state);return Response.json({key:'unused'})}
  await assert.rejects(f.client.create(f.value,f.media))
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].operation,'role_upload')
  assert.equal(f.client.snapshot().length,0)
})

test('paid-plan refusal is shown before media upload or training',async t=>{
  const f=await fixture(t)
  f.services.request=async()=>({ok:false,code:'PAID_PLAN_REQUIRED'})
  await assert.rejects(f.client.create(f.value,f.media),{code:'PAID_PLAN_REQUIRED',message:'当前账号需要有效的付费套餐才能创建线上角色，请先开通或续费'})
  assert.equal(f.uploads.length,0);assert.equal(f.client.snapshot().length,0)
})

test('expiry after uploads leaves no pending job and renewal can reuse the same intent',async t=>{
  const f=await fixture(t), original=f.services.request
  f.services.request=async(operation,payload)=>operation==='role_create'?{ok:false,code:'PAID_PLAN_REQUIRED'}:original(operation,payload)
  await assert.rejects(f.client.create(f.value,f.media),{code:'PAID_PLAN_REQUIRED'})
  assert.equal(f.client.snapshot().length,0)
  f.services.request=original
  assert.equal((await f.client.create(f.value,f.media)).agentId,'created-online')
  assert.equal(f.calls.filter(row=>row.operation==='role_create').length,1)
})

test('unknown HTTP outcome keeps the job and only queries on retry',async t=>{
  const f=await fixture(t), original=f.services.request
  f.services.request=async(operation,payload)=>{if(operation==='role_create')throw new Error('response lost');return original(operation,payload)}
  await assert.rejects(f.client.create(f.value,f.media),/response lost/)
  assert.equal(f.client.snapshot().length,1)
  f.services.request=original
  assert.equal((await f.client.create(f.value,f.media)).agentId,'created-online')
  assert.equal(f.uploads.length,2);assert.equal(f.calls.filter(row=>row.operation==='role_create').length,0)
})
