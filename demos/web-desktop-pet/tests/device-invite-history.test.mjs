import test from 'node:test'
import assert from 'node:assert/strict'
import { InviteHistory, maskedInviteName } from '../electron/device-invite.mjs'

test('invitation names never expose a short full name or an unmasked fallback', () => {
  for (const [input, expected] of [['王小明','王***明'],['李白','李***'],['李','*'],['🙂小三','🙂***三'],['王***明','王***明'],['','***']])
    assert.equal(maskedInviteName(input),expected)
})

test('invitation history loads a bounded page once and keeps only safe display fields', async () => {
  const calls=[]
  const history=new InviteHistory({request:async(operation,payload)=>{calls.push({operation,payload});return {ok:true,data:{total:21,records:[{maskedName:'王小明',successAt:'2026-10-30 09:00:00',tenantId:'private',email:'private@example.com'}]}}}})
  history.context('account-A',true)
  await Promise.all([history.load(),history.load()])
  assert.equal(calls.length,1);assert.deepEqual(calls[0],{operation:'invite_list',payload:{page:1}})
  assert.deepEqual(history.rows,[{maskedName:'王***明',successAt:'2026-10-30 09:00:00'}])
  assert.equal(history.total,21)
  await history.load(2);assert.equal(calls[1].payload.page,2)
})

test('invitation results from a previous account or connection cannot repopulate private rows', async () => {
  let resolve
  const history=new InviteHistory({request:()=>new Promise(done=>{resolve=done})})
  history.context('account-A',true)
  const first=history.load()
  history.context('account-B',true)
  resolve({ok:true,data:{total:1,records:[{maskedName:'旧***户',successAt:'2026-10-30'}]}})
  await first;assert.deepEqual(history.rows,[]);assert.equal(history.total,0)
  const second=history.load()
  history.context('account-B',false)
  resolve({ok:true,data:{total:1,records:[{maskedName:'旧***户'}]}})
  await second;assert.deepEqual(history.rows,[])
})

test('missing invitation API and malformed responses fail visibly without polling or invented records', async () => {
  let calls=0
  const history=new InviteHistory({request:async()=>{calls++;return {ok:false,code:'SERVER_UPDATE_REQUIRED'}}})
  await history.load();assert.equal(calls,0)
  history.context('account-A',true);await history.load()
  assert.equal(history.error,'SERVER_UPDATE_REQUIRED');assert.deepEqual(history.rows,[]);assert.equal(calls,1)
  history.request=async()=>({ok:true,data:{total:-1,records:[]}})
  await history.load();assert.equal(history.error,'INVALID_RESPONSE')
  history.context('',false);assert.equal(history.total,0);assert.deepEqual(history.rows,[])
})
