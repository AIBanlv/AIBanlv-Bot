import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { MomentsTimeline, momentPage, momentMediaUrl, momentAvatar, momentResourceAllowed, latestMomentAuthor } from '../electron/device-moments.mjs'
import { MomentsUpload } from '../electron/device-moments-upload.mjs'
import { DesktopServices } from '../electron/device-desktop-services.mjs'

const id = 'a'.repeat(64), url = 'https://zhanlvgpt.ieasysell.com/tenant/moments/user/abcd-123.jpg'
const page = { records: [{ id, content: '<img src=x onerror=alert(1)>', comments: [], media: [] }], hasMore: false, nextCursor: '' }
test('menu portrait follows the latest posting AI, not user posts or AI comments, with safe fallback', () => {
  const avatar='https://qn.ieasysell.com/role.png', localId='local-12345678-1234-1234-1234-123456789abc'
  const online=[{agentId:'',avatar:'https://qn.ieasysell.com/user.png',createdAt:'2026-11-03T12:00:00Z',comments:[{agentId:'commenter'}]},
    {agentId:'role',avatar,createdAt:'2026-11-03T11:00:00Z'}]
  assert.deepEqual(latestMomentAuthor(online),{agentId:'role',avatar})
  const image=`/assets/local-${localId}.png`, roles=[{agentId:localId,source:'local',agentPhotoUrl:image}]
  assert.deepEqual(latestMomentAuthor(online,[{agentId:localId,timestamp:Date.parse('2026-11-03T13:00:00Z')}],roles),{agentId:localId,avatar:image})
  assert.equal(latestMomentAuthor([],[],roles),null)
  assert.equal(latestMomentAuthor([{agentId:'role',avatar:'file:///private.png',createdAt:'2026-11-03T11:00:00Z'}]).avatar,'')
})
test('menu initial preview is bounded and single-flight; ordinary hidden polling remains disabled', async () => {
  let calls=0,release
  const timeline=new MomentsTimeline({request:()=>{calls++;return new Promise(resolve=>release=resolve)}})
  await timeline.load({menuPreview:true});assert.equal(calls,0)
  timeline.context('A',true,true)
  const job=timeline.load({menuPreview:true});await timeline.load({menuPreview:true});assert.equal(calls,1)
  release({ok:true,data:page});await job
  await timeline.load({automatic:true});assert.equal(calls,1)
})
test('only visible, bound, connected, capable timelines poll, with single-flight reads and failure backoff', async () => {
  let now=0, calls=0, release
  const timeline = new MomentsTimeline({ now:()=>now, request:()=>{calls++;return new Promise(resolve=>release=resolve)} })
  timeline.context('owner-A',true,true)
  await timeline.load(); assert.equal(calls,0)
  timeline.active=true
  const first=timeline.load(); await timeline.load(); assert.equal(calls,1)
  release({ok:false,code:'AI_MOMENTS_DISABLED'});await first
  assert.equal(timeline.error,'AI_MOMENTS_DISABLED')
  now=29999;await timeline.load({automatic:true});assert.equal(calls,1)
  now=30000;const second=timeline.load({automatic:true});release({ok:false,code:'OFFLINE'});await second
  assert.equal(timeline.nextAt,90000)
  now=90000;const third=timeline.load({automatic:true});release({ok:true,data:page});await third
  assert.equal(timeline.rows[0].id,id);assert.equal(timeline.error,'')
  timeline.active=false;now+=90000;await timeline.load({automatic:true});assert.equal(calls,3)
  timeline.active=true;timeline.context('owner-A',false,true);await timeline.load();assert.equal(calls,3)
})
test('binding changes discard late private reads and writes and clear cached records', async () => {
  let release
  const timeline=new MomentsTimeline({request:()=>new Promise(resolve=>release=resolve)})
  timeline.context('A',true,true);timeline.active=true
  const pending=timeline.load();timeline.context('B',true,true);release({ok:true,data:page});await pending
  assert.deepEqual(timeline.rows,[])
  const write=timeline.write('moments_publish',{requestId:'stable-id'});timeline.context('',false,false)
  release({ok:true,data:id});assert.equal((await write).code,'BIND_REQUIRED');assert.equal(timeline.saving,false)
})
test('writes never retry automatically, preserve caller idempotency IDs and serialize submissions', async () => {
  let release, count=0, received
  const timeline=new MomentsTimeline({request:(operation,payload)=>{count++;received={operation,payload};return new Promise(resolve=>release=resolve)}})
  timeline.context('A',true,true)
  const pending=timeline.write('moments_publish',{requestId:'stable-request',content:'draft'})
  assert.equal((await timeline.write('moments_publish',{})).code,'BUSY')
  release({ok:false,code:'TIMEOUT'});assert.equal((await pending).code,'TIMEOUT')
  assert.equal(count,1);assert.equal(received.payload.requestId,'stable-request')
})
test('time line parsing and renderer resource policy reject unsafe URLs, forged media and other windows', () => {
  assert.equal(momentMediaUrl(url),url)
  for(const value of ['javascript:alert(1)','file:///private',url+'?token=x',url.replace('https:','http:'),url.replace('ieasysell.com','ieasysell.com.evil')])assert.equal(momentMediaUrl(value),'')
  assert.equal(momentAvatar('https://user:pass@qn.ieasysell.com/a.png'),'')
  const result=momentPage({...page,records:[{...page.records[0],media:[{type:'image',url},{type:'image',url:'data:text/html,bad'},{type:'video',url}]}]})
  assert.equal(result.records[0].media.length,1);assert.equal(result.records[0].content,page.records[0].content)
  assert.throws(()=>momentPage({...page,hasMore:true}))
  assert.equal(momentResourceAllowed({url,resourceType:'image',webContentsId:3},3),true)
  assert.equal(momentResourceAllowed({url,resourceType:'script',webContentsId:3},3),false)
  assert.equal(momentResourceAllowed({url,resourceType:'media',webContentsId:4},3),false)
})
function uploadFixture(fetchImpl) {
  const channel=new EventEmitter();channel.tenantId='tenant';channel.state={deviceId:'device',owner:'user',binding:'bound',connection:'connected',accountAuthReady:true,desktopMomentsSupported:true}
  const services={request:async()=>({ok:true,data:{key:'tenant/moments/user/abcd-123.jpg',url,token:'private-fixture-ticket'}})}
  return {channel,services,upload:new MomentsUpload({channel,services,fetchImpl})}
}
test('chosen media uploads directly to the fixed storage host without disclosing upload credentials', async () => {
  let called=0
  const {upload}=uploadFixture(async(target,options)=>{
    called++;assert.equal(target,'https://up-cn-east-2.qiniup.com');assert.equal(options.redirect,'error')
    assert.equal(options.body.get('token'),'private-fixture-ticket')
    assert.equal(options.body.get('key'),'tenant/moments/user/abcd-123.jpg')
    return Response.json({key:'tenant/moments/user/abcd-123.jpg'})
  })
  const result=await upload.upload({type:'image',extension:'jpg',bytes:new Uint8Array([255,216,255,0])})
  assert.deepEqual(result,{ok:true,data:{type:'image',url}});assert.equal(called,1)
  assert.doesNotMatch(JSON.stringify(result),/ticket|token/)
})
test('invalid bytes, oversized files and revoked scopes cannot be uploaded or report success', async () => {
  let called=0
  const {channel,services,upload}=uploadFixture(async()=>{called++;return Response.json({})})
  assert.equal((await upload.upload({type:'image',extension:'jpg',bytes:new Uint8Array([1,2,3])})).ok,false)
  assert.equal((await upload.upload({type:'video',extension:'exe',bytes:new Uint8Array(8)})).ok,false)
  let release;services.request=()=>new Promise(resolve=>release=resolve)
  const pending=upload.upload({type:'image',extension:'jpg',bytes:new Uint8Array([255,216,255])})
  assert.equal((await upload.upload({})).code,'BUSY')
  channel.state.owner='other';channel.emit('state');release({ok:true,data:{url,token:'private'}})
  assert.equal((await pending).code,'BIND_REQUIRED');assert.equal(called,0)
})
test('old backends cannot be queried for unsupported moments actions', async () => {
  const channel=new EventEmitter();channel.state={binding:'bound',connection:'connected',desktopServicesSupported:true};channel.send=()=>assert.fail('must not send')
  const services=new DesktopServices({channel})
  assert.equal((await services.request('moments_feed')).code,'SERVER_UPDATE_REQUIRED')
})
