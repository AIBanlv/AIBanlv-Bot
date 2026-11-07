import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, appendFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CodexRolloutReader } from '../electron/device-codex-rollout.mjs'
import { DeviceCodex } from '../electron/device-codex.mjs'
const line = (type, payload) => JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n'
async function fixture(t) {
  const home=await mkdtemp(path.join(tmpdir(),'codex-rollout-'));t.after(()=>rm(home,{recursive:true,force:true}))
  const directory=path.join(home,'sessions','2026');await mkdir(directory,{recursive:true})
  const id='fixture-thread',file=path.join(directory,`rollout-now-${id}.jsonl`)
  const reader=new CodexRolloutReader({home});return {home,id,file,reader}
}
test('external unfinished run is not interrupted by a second app-server and reports latest public progress',async t=>{
  const {id,file,reader}=await fixture(t),reports=[]
  await writeFile(file,line('event_msg',{type:'task_started',turn_id:'old'})+line('response_item',{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'旧后端移动端代码未全'}]})+line('event_msg',{type:'task_complete',turn_id:'old'}))
  const client=new DeviceCodex({rolloutReader:reader,onReport:value=>reports.push(value)});t.after(()=>client.shutdown());client.status='ready'
  client.request=async method=>{assert.equal(method,'thread/list');return {data:[{id,path:file,cwd:process.cwd(),name:'当前真实任务',updatedAt:1,status:{type:'notLoaded'}}]}}
  await client.monitorProject();assert.deepEqual(reports,[])
  await appendFile(file,line('event_msg',{type:'task_started',turn_id:'current'})+
    line('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'修复当前截图任务'}]})+
    line('response_item',{type:'reasoning',content:[{type:'reasoning_text',text:'PRIVATE_RAW_REASONING'}]})+
    line('response_item',{type:'message',role:'assistant',channel:'analysis',content:[{type:'output_text',text:'PRIVATE_ANALYSIS'}]})+
    line('response_item',{type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text:'正在核对截图发送回执'}]}))
  await client.monitorProject()
  assert.equal(client.tasks.get(id).status,'inProgress');assert.equal(client.tasks.get(id).lastTurnId,'current')
  assert.match(reports.at(-1).text,/当前真实任务.*修复当前截图任务.*正在核对截图发送回执/)
  assert.doesNotMatch(JSON.stringify(reports),/旧后端|PRIVATE_|中断/)
  assert.doesNotMatch(JSON.stringify(client.snapshot()),/rollout-now/)
  await appendFile(file,line('event_msg',{type:'task_complete',turn_id:'current',last_agent_message:'已核对当前截图回执'}))
  await client.monitorProject();await client.monitorProject()
  assert.equal(reports.filter(row=>!row.progress).length,1);assert.match(reports.at(-1).text,/已核对当前截图回执/)
})
test('starting while an external run is already active reports current progress without replaying history',async t=>{
  const {id,file,reader}=await fixture(t),reports=[]
  await writeFile(file,line('event_msg',{type:'task_started',turn_id:'active'})+line('response_item',{type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text:'正在运行最新测试'}]}))
  const client=new DeviceCodex({rolloutReader:reader,onReport:value=>reports.push(value)});t.after(()=>client.shutdown());client.status='ready'
  client.request=async()=>({data:[{id,path:file,cwd:process.cwd(),name:'正在执行的任务',updatedAt:Date.now()/1000}]})
  await client.monitorProject();assert.equal(reports.length,1);assert.equal(reports[0].progress,true)
  assert.match(reports[0].text,/正在运行最新测试/)
})
test('explicit abort remains interrupted, incomplete writes wait for newline, next turn clears old result',async t=>{
  const {id,file,reader}=await fixture(t)
  await writeFile(file,line('event_msg',{type:'task_started',turn_id:'one'})+line('event_msg',{type:'turn_aborted',turn_id:'one'}))
  assert.equal((await reader.read({id,file})).status,'interrupted')
  const next=line('event_msg',{type:'task_started',turn_id:'two'})
  await appendFile(file,next.slice(0,-1));assert.equal((await reader.read({id,file})).turnId,'one')
  await appendFile(file,'\n');const current=await reader.read({id,file});assert.equal(current.turnId,'two');assert.deepEqual(current.items,[])
})
test('rollout access is restricted to matching session files and bounded tails cannot reuse old state',async t=>{
  const {home,id,file}=await fixture(t),reader=new CodexRolloutReader({home,maxBytes:1024})
  await writeFile(file,line('event_msg',{type:'task_started',turn_id:'one'}))
  assert.equal((await reader.read({id,file})).turnId,'one')
  await appendFile(file,line('response_item',{type:'function_call_output',output:'private'.repeat(2000)}))
  assert.equal(await reader.read({id,file}),null)
  assert.equal(await reader.read({id:'another-thread',file}),null)
  const outside=path.join(home,`rollout-other-${id}.jsonl`);await writeFile(outside,line('event_msg',{type:'task_started',turn_id:'outside'}))
  assert.equal(await reader.read({id,file:outside}),null)
  const link=path.join(home,'sessions',`link-${id}.jsonl`)
  try{await symlink(outside,link)}catch(e){if(['EPERM','EACCES'].includes(e.code))return;throw e}
  assert.equal(await reader.read({id,file:link}),null)
})
test('external interrupted status without original lifecycle evidence is unknown and silent',async t=>{
  const reports=[],client=new DeviceCodex({onReport:value=>reports.push(value)});t.after(()=>client.shutdown());client.status='ready'
  client.request=async method=>method==='thread/list'?{data:[{id:'external',cwd:process.cwd(),updatedAt:Date.now()/1000}]}:{data:[{id:'live',status:'interrupted'}]}
  await client.monitorProject();assert.equal(client.tasks.get('external').status,'unknown');assert.deepEqual(reports,[])
})
