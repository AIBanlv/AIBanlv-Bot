import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'
import { mkdtemp,mkdir,writeFile } from 'node:fs/promises'
import path from 'node:path'
const require=createRequire(import.meta.url)
const {_electron}=require(process.env.PLAYWRIGHT_MODULE)
const {WebSocketServer}=require('ws'),root=process.cwd()
const output=path.join(root,'artifacts/desktop-optimization');await mkdir(output,{recursive:true})
const profile=await mkdtemp(path.join(output,'profile-'))
const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(resolve=>server.once('listening',resolve))
let socket,deviceId,rows=[],monthly=0;const requests=[]
const secret='fixture-binding-secret-0123456789',nonce='11111111-1111-4111-8111-111111111111'
server.on('connection',client=>{socket=client;client.on('message',raw=>{
  const value=JSON.parse(raw)
  if(value.type==='device_online'){deviceId=value.deviceId;client.send(JSON.stringify({type:'bind_offer',deviceId,bindToken:secret,expireAt:Date.now()+900000,bound:false}))}
  if(value.type==='ping')client.send('{"type":"pong"}')
  if(value.type!=='desktop_action')return
  assert.equal(value.deviceProof,createHmac('sha256',secret).update(`${deviceId}\n${nonce}`).digest('hex'))
  requests.push(value.operation)
  let data={}
  if(value.operation==='claim_monthly'){monthly++;data={points:800}}
  if(value.operation==='memo_list')data={records:rows,total:rows.length,page:1,size:20}
  if(value.operation==='memo_create'){
    const p=value.payload;assert.equal(p.repeat,'daily');assert.ok(p.timezone);assert.ok(p.requestId)
    rows=[{id:'memo-1',...p,intervalType:p.repeat,status:'active',nextTriggerAt:Date.now()+86400000}];data=rows[0]
  }
  if(value.operation==='memo_delete'){rows=[];data={id:'memo-1',status:'deleted'}}
  if(value.operation==='invite')data={code:'fixture-code'}
  client.send(JSON.stringify({type:'desktop_result',deviceId,tenantId:'fixture-tenant',controllerUserId:'fixture-user',requestId:value.requestId,ok:true,data}))
  if(value.operation==='unbind')client.send(JSON.stringify({type:'bind_lost',deviceId}))
})})
let app,clipboardOriginal;const errors=[]
try{
  const env={...process.env,PET_DEVICE_USER_DATA:profile,WORKBUDDY_CONFIG_DIR:path.join(profile,'workbuddy'),PET_CONTROL_WS_URL:`ws://127.0.0.1:${server.address().port}/ws/control`}
  delete env.ELECTRON_RUN_AS_NODE
  app=await _electron.launch({executablePath:require('electron'),args:['--disable-gpu','--in-process-gpu',path.join(root,'tests/desktop-optimization-bootstrap.mjs')],env,timeout:90000})
  clipboardOriginal=await app.evaluate(({clipboard})=>clipboard.readText())
  await app.firstWindow({timeout:60000})
  const page=app.windows().find(page=>page.url().endsWith('/device/device.html')) || await app.waitForEvent('window',{predicate:page=>page.url().endsWith('/device/device.html'),timeout:60000})
  page.on('pageerror',error=>errors.push(error.message))
  await page.waitForFunction(()=>document.querySelector('#qr').naturalWidth>0)
  assert.match(await page.locator('#scan-binding').textContent(),/800/)
  assert.equal(await page.locator('#desktop-language option').count(),4)
  assert.equal(await page.locator('#codex-form,#codex-directory,#workbuddy-directory').count(),0)
  for(const [language,html,text] of [['en','en','Scheduled tasks'],['ja','ja','定時タスク'],['zh-Hant','zh-TW','定時任務'],['zh-Hans','zh-CN','定时任务']]){
    await page.selectOption('#desktop-language',language)
    await page.waitForFunction(locale=>document.documentElement.lang===locale,html)
    assert.equal((await page.locator('[data-section="scheduled-tasks"]').textContent()).replace('◷','').trim(),text)
  }
  socket.send(JSON.stringify({type:'bind_success',deviceId,tenantId:'fixture-tenant',controllerUserId:'fixture-user',capabilities:{desktopServicesV1:true,deviceProofRequired:true}}))
  socket.send(JSON.stringify({type:'device_challenge',deviceId,nonce}))
  await page.waitForFunction(()=>!document.querySelector('#binding-summary').hidden&&!document.querySelector('#device-unbind').disabled)
  await page.waitForFunction(()=>document.querySelector('#memo-role').options.length>0)
  await page.locator('[data-section="scheduled-tasks"]').click();await page.locator('#memo-refresh').click()
  await page.waitForFunction(()=>document.querySelector('#memo-status').textContent==='')
  await page.fill('#memo-content','fixture daily reminder');await page.selectOption('#memo-repeat','daily')
  await page.fill('#memo-time','20:30');await page.locator('#memo-save').click()
  await page.waitForFunction(()=>document.querySelector('#memo-list').textContent.includes('fixture daily reminder'))
  await page.locator('#memo-list button').click();await page.waitForFunction(()=>!document.querySelector('#memo-list').textContent.includes('fixture daily reminder'))
  await page.locator('[data-section="invite-section"]').click();await page.locator('#invite-copy').click()
  await page.locator('#invite-share-copy-url').click()
  await page.waitForFunction(()=>document.querySelector('#invite-share-status').textContent==='邀请链接已复制')
  const invite=await app.evaluate(({clipboard})=>clipboard.readText())
  assert.ok(invite.includes('https://aibanlv.ai/zh?view=desktop-companion&inviteCode=fixture-code'))
  await page.locator('#invite-share-close').click()
  const viewports=[]
  for(const width of [320,650,960]){
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().endsWith('/device/device.html')).setContentSize(width,780),width)
    await page.waitForFunction(width=>innerWidth===width,width)
    const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,content:document.querySelector('.settings-workspace').clientWidth,contentScroll:document.querySelector('.settings-workspace').scrollWidth}))
    assert.ok(size.scroll<=width&&size.contentScroll<=size.content,JSON.stringify(size));viewports.push(size)
    await page.screenshot({path:path.join(output,`settings-${width}.png`)})
  }
  await page.locator('[data-section="binding"]').click();await page.locator('#device-unbind').click()
  await page.waitForFunction(()=>!document.querySelector('#binding').hidden&&document.querySelector('#qr').naturalWidth>0)
  assert.equal(monthly,1);assert.deepEqual(errors,[])
  const report={languages:true,proofRequired:true,monthlyOnce:true,memos:true,invite:true,unbind:true,harnessOnlyControls:true,viewports,errors,noProductionRequests:true,requests}
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{
  if(app){if(clipboardOriginal!==undefined)await app.evaluate(({clipboard},value)=>clipboard.writeText(value),clipboardOriginal).catch(()=>{});await app.close().catch(()=>app.process().kill())}
  for(const client of server.clients)client.terminate();await new Promise(resolve=>server.close(resolve))
}
