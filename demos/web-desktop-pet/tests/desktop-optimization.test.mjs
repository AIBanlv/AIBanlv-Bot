import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DesktopServices } from '../electron/device-desktop-services.mjs'
import { TaskReportOutbox } from '../electron/device-task-outbox.mjs'
import { renderingQuality } from '../electron/device-quality.mjs'
import { invitation } from '../electron/device-invite.mjs'
import { reviewTaskRequest } from '../electron/device-task-review.mjs'
import { WindowsLamWorker } from '../electron/platform/windows-lam-worker.mjs'
import { naturalMessages } from '../src/natural-messages.mjs'
import { AssistantService } from '../electron/device-assistant-service.mjs'
import { t } from '../electron/device-i18n.mjs'

test('render quality distinguishes software, modest integrated and capable discrete hardware',()=>{
  assert.equal(renderingQuality({memoryGB:32,cores:16,gpu:'SwiftShader'}).tier,'low')
  assert.equal(renderingQuality({memoryGB:8,cores:4,gpu:'Intel Iris'}).tier,'balanced')
  assert.equal(renderingQuality({memoryGB:32,cores:16,gpu:'NVIDIA GeForce RTX'}).tier,'high')
})
test('Windows failed accelerator replays exactly the same local request once on CPU',async()=>{
  const calls=[]
  const worker=new WindowsLamWorker('python',['worker.py'],{factory:(_file,args)=>({
    ready:Promise.resolve({backend:args.includes('--backend=cpu')?'cpu':'cuda'}),
    request:async value=>{calls.push(value);if(!args.includes('--backend=cpu'))throw new Error('device lost');return {frames:[]}},
    dispose:async()=>{},fail(){}
  })})
  const pcm={pcm:'same-local-audio'}
  await worker.ready;await worker.request(pcm)
  assert.deepEqual(calls,[pcm,pcm]);assert.equal(worker.cpu,true);await worker.dispose()
})
test('desktop account requests are capability gated and revoked replies settle without changing accounts',async()=>{
  const channel=new EventEmitter();channel.state={binding:'bound',connection:'connected',desktopServicesSupported:true}
  let payload;channel.send=value=>{payload=value;return true}
  const service=new DesktopServices({channel,timeoutMs:100})
  const pending=service.request('memo_list')
  assert.equal(payload.operation,'memo_list')
  channel.emit('desktop-result',{requestId:payload.requestId,ok:true,data:{records:[]}})
  assert.equal((await pending).ok,true)
  const revoked=service.request('invite');channel.emit('revoked');assert.equal((await revoked).code,'BIND_REQUIRED')
  channel.state.desktopServicesSupported=false
  assert.equal((await service.request('invite')).code,'SERVER_UPDATE_REQUIRED')
})
test('completion outbox survives offline restart, deduplicates and never flushes to another tenant',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'task-outbox-'));t.after(()=>rm(dir,{recursive:true,force:true}))
  const scope={bound:true,owner:'user',tenantId:'tenant',deviceId:'device',agentId:'role'}
  let context={...scope,bound:false},delivered=[]
  // An opaque reversible test codec; production uses Electron safeStorage.
  const encryption={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from([...value].reverse().join('')),decryptString:value=>[...value.toString()].reverse().join('')}
  const options={file:path.join(dir,'reports.enc'),encryption,context:()=>context,deliver:async value=>{delivered.push(value);return {ok:true}}}
  const outbox=new TaskReportOutbox(options)
  const report={id:'task',eventId:'task:completed',text:'private result',progress:false}
  outbox.add('codex',report,scope);outbox.add('codex',report,scope);await outbox.writes
  assert.equal(outbox.rows.length,1);assert.equal(delivered.length,0)
  assert.equal((await readFile(options.file,'utf8')).includes('private result'),false)
  const restarted=new TaskReportOutbox(options);await restarted.load();context={...scope,owner:'other'}
  await restarted.flush();assert.equal(delivered.length,0)
  context=scope;await restarted.flush();assert.equal(delivered.length,1);assert.equal(restarted.rows.length,0)
  context={...scope,owner:'other'};restarted.add('codex',report,scope);assert.equal(restarted.rows.length,0)
})
test('model review never grants execution permissions or supplies user answers',async()=>{
  const task={instruction:'fix tests',cwd:'/project'},params={questions:[{id:'q',options:[{label:'A'}]}]}
  const assistant={review:async()=>({decision:'allow',answers:{q:'invented'}})}
  assert.deepEqual(await reviewTaskRequest({assistant,task,method:'item/tool/requestUserInput',params}),{answers:{}})
  assert.deepEqual(await reviewTaskRequest({assistant,task:null,method:'item/commandExecution/requestApproval',params:{}}),{decision:'decline'})
  assistant.review=async()=>({decision:'allow'})
  assert.deepEqual(await reviewTaskRequest({assistant,task,method:'item/commandExecution/requestApproval',params:{}}),{decision:'decline'})
})
test('outbox defers review, falls back after restart and stops when binding changes during delivery',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'task-review-'));t.after(()=>rm(dir,{recursive:true,force:true}))
  const scope={bound:true,owner:'user',tenantId:'tenant',deviceId:'device',agentId:'role'}
  let context=scope,delivered=[]
  const options={file:path.join(dir,'queue.enc'),encryption:{isEncryptionAvailable:()=>true,
    encryptString:Buffer.from,decryptString:value=>value.toString()},context:()=>context,
    deliver:async value=>{delivered.push(value);context={...scope,owner:'new-user'};return {ok:true}}}
  const queue=new TaskReportOutbox(options)
  queue.add('codex',{id:'one',text:'actual executor result'},scope,{defer:true})
  queue.add('codex',{id:'two',text:'second actual result'},scope,{defer:true})
  await queue.writes;await queue.flush();assert.equal(delivered.length,0)
  const restarted=new TaskReportOutbox(options);await restarted.load();await restarted.flush()
  assert.equal(delivered.length,1);assert.equal(delivered[0].content,'actual executor result');assert.equal(restarted.rows.length,1)
})
test('Harness serializes factual reports and rejects queued work from a revoked account',async()=>{
  const service=Object.create(AssistantService.prototype),seen=[]
  let complete
  let releases=0
  service.reporter={run:async prompt=>{seen.push(prompt);return new Promise(resolve=>{complete=resolve})},release:async()=>{releases++}}
  const first=service.summarizeTask({provider:'codex',text:'failed: tests did not pass'})
  const second=service.summarizeTask({provider:'workbuddy',text:'submitted, still running'})
  await new Promise(resolve=>setImmediate(resolve));assert.equal(seen.length,1)
  assert.ok(seen[0].includes('failed: tests did not pass'))
  service.reportEpoch=1;complete('Tests failed; review required')
  assert.equal(await first,'Tests failed; review required')
  assert.equal(releases,1,'Each report releases its model session instead of retaining another task’s context')
  await assert.rejects(second,error=>error.code==='ASSISTANT_CANCELLED');assert.equal(seen.length,1)
})
test('outbox retains failed offline pushes for a later retry',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'task-push-retry-'));t.after(()=>rm(dir,{recursive:true,force:true}))
  const scope={bound:true,owner:'user',tenantId:'tenant',deviceId:'device',agentId:'role'}
  let context={...scope,bound:false},status='push_failed'
  const queue=new TaskReportOutbox({file:path.join(dir,'queue'),encryption:{isEncryptionAvailable:()=>false},
    context:()=>context,deliver:async()=>({ok:true,data:{deliveryStatus:status}})})
  queue.add('codex',{id:'task',text:'actual result'},scope);await queue.writes;await queue.flush()
  context=scope;await queue.flush();assert.equal(queue.rows.length,1)
  status='push_accepted';await queue.flush();assert.equal(queue.rows.length,0)
})
test('mobile invitation keeps code and reward copy while changing only the landing page',()=>{
  for(const locale of ['zh-Hans','zh-Hant','en','ja']){
    const value=invitation('abc+123',locale),url=new URL(value.url)
    assert.equal(url.origin,'https://aibanlv.ai');assert.equal(url.pathname,'/zh');assert.equal(url.searchParams.get('view'),'desktop-companion')
    assert.equal(url.searchParams.get('inviteCode'),'abc+123');assert.ok(value.text.includes('abc+123'));assert.ok(value.text.includes('1,000')||value.text.includes('1000'))
  }
})
test('explicit mobile message boundaries publish complete ordered messages without exposing tags',()=>{
  assert.deepEqual(naturalMessages('[perform:微笑]第一条[msg_end][perform:点头]第二'),['第一条'])
  assert.deepEqual(naturalMessages('[perform:微笑]第一条[msg_end][perform:点头]第二',true),['第一条','第二'])
  assert.deepEqual(naturalMessages('完整句子。不要强制切割。'),['完整句子。不要强制切割。'])
  assert.equal(t('定时任务','en'),'Scheduled tasks');assert.equal(t('定时任务','ja'),'定時タスク');assert.equal(t('解除绑定','zh-Hant'),'解除綁定')
})
