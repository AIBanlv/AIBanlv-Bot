import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { invitationResult, installationPrompt } from '../electron/device-invite.mjs'
test('opening an invitation returns the real code and link without changing clipboard',()=>{
  const writes=[],result=invitationResult('BOUND123','zh-Hans',{},text=>writes.push(text))
  assert.equal(result.data.code,'BOUND123');assert.equal(new URL(result.data.url).searchParams.get('inviteCode'),'BOUND123')
  assert.equal(new URL(result.data.url).searchParams.get('view'),'desktop-companion')
  assert.equal(result.data.appUrl,'https://aibanlv.ai/?inviteCode=BOUND123');assert.deepEqual(writes,[])
})
test('copy buttons write only reconstructed invitation data and reject arbitrary renderer content',()=>{
  const writes=[]
  for(const copy of ['url','app','code','text'])invitationResult('BOUND123','zh-Hans',{copy},text=>writes.push(text))
  assert.equal(writes[0],'https://aibanlv.ai/zh?view=desktop-companion&inviteCode=BOUND123')
  assert.equal(writes[1],'https://aibanlv.ai/?inviteCode=BOUND123');assert.equal(writes[2],'BOUND123');assert.match(writes[3],/邀请双方各获得 1000 积分/)
  for(const payload of [{copy:'arbitrary'}, {copy:'url',text:'private'}, {tenantId:'someone'}, [], null])assert.throws(()=>invitationResult('BOUND123','zh-Hans',payload,text=>writes.push(text)))
  assert.equal(writes.length,4)
})
test('desktop and mobile invitation links encode the same bound code without query injection',()=>{
  const code='a&view=other?#/你好'
  for(const language of ['zh-Hans','zh-Hant','en','ja']) {
    const {data}=invitationResult(code,language)
    const desktop=new URL(data.url),app=new URL(data.appUrl)
    assert.equal(desktop.origin,'https://aibanlv.ai');assert.equal(desktop.pathname,'/zh')
    assert.equal(desktop.searchParams.get('view'),'desktop-companion');assert.equal(desktop.hash,'')
    assert.equal(app.origin,'https://aibanlv.ai');assert.equal(app.pathname,'/');assert.equal(app.hash,'')
    for(const url of [desktop,app])assert.equal(url.searchParams.get('inviteCode'),code)
    assert.deepEqual([...app.searchParams.keys()],['inviteCode'])
  }
})
test('installation prompt IPC copies only fixed public text from the trusted settings window',async()=>{
  const source=await readFile(new URL('../electron/device-main.mjs',import.meta.url),'utf8')
  const match=source.match(/ipcMain\.handle\('device:copy-installation-prompt', (event => \{[\s\S]*?\n  \})\)/)
  assert.ok(match)
  const writes=[],trusted={settings:true}
  const handler=runInNewContext(`(${match[1]})`,{windows:{fromController:event=>event===trusted},clipboard:{writeText:text=>writes.push(text)},installationPrompt})
  assert.equal(handler({}).ok,false);assert.deepEqual(writes,[])
  assert.equal(handler(trusted,'untrusted custom clipboard content').ok,true)
  assert.deepEqual(writes,['帮我安装 AIBanlv 桌面伴侣：https://github.com/AIBanlv/AIBanlv-Bot'])
  const preload=await readFile(new URL('../electron/device-preload.cjs',import.meta.url),'utf8')
  let bridge;const invokes=[]
  runInNewContext(preload,{require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>{if(name==='controlDevice')bridge=value}},ipcRenderer:{invoke:(...args)=>invokes.push(args)}})})
  bridge.copyInstallationPrompt('ignored custom content');assert.deepEqual(invokes,[['device:copy-installation-prompt']])
})
