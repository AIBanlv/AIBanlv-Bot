import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const root = process.cwd(), require = createRequire(import.meta.url)
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const { default: AxeBuilder } = require(process.env.AXE_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/@axe-core/playwright'))
const artifacts = path.join(root, 'artifacts/text-electron')
await mkdir(artifacts, {recursive:true})
const build = JSON.parse(await readFile('dist/text-latest.json','utf8'))
const relocated = await mkdtemp(path.join(root,'dist/文字动作版 '))
await cp(build.directory,relocated,{recursive:true})
const executable = path.join(relocated,'ControlTextPet.exe')
const env = {...process.env, PET_DESKTOP_USER_DATA:path.join(artifacts,`profile-${Date.now()}`),
  PET_PYTHON:'Z:/missing/python.exe', PET_TTS_PYTHON:'Z:/missing/python.exe', JAVA:'Z:/missing/java.exe',
  JAVAC:'Z:/missing/javac.exe', GSON_JAR:'Z:/missing.jar', PET_LAM_SOURCE:'Z:/missing', PET_AVATAR_ZIP:'Z:/missing.zip'}
delete env.ELECTRON_RUN_AS_NODE
delete env.PET_TEXT_ONLY
const app = await _electron.launch({executablePath:executable,args:[],env,timeout:60000})
const errors=[], external=[], forbidden=[]
let control, pet
const report={executable,independentRuntime:true}
const state = value => control.waitForFunction(expected=>document.querySelector('#action-status').dataset.state===expected,value)
async function pixels() {
  return pet.frames().find(f=>f.url().includes('avatar.html')).evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>{
    const gl=document.querySelector('canvas').getContext('webgl2')
    const data=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4)
    gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,data)
    let visible=0,transparent=0,hash=0
    for(let i=0;i<data.length;i+=4){ if(data[i+3]>10)visible++;else transparent++;hash=(hash*31+data[i]+data[i+1]+data[i+2])>>>0 }
    resolve({visible,transparent,hash,alpha:gl.getContextAttributes().alpha})
  })))
}
try {
  await app.firstWindow()
  for(let i=0;i<100 && app.windows().length<2;i++)await new Promise(r=>setTimeout(r,100))
  for(const page of app.windows()) {
    page.on('pageerror',e=>errors.push(e.message))
    page.on('request',r=>{
      if(/^https?:/.test(r.url()) && new URL(r.url()).hostname!=='127.0.0.1')external.push(r.url())
      if(/\/api\/|\.wav(?:\?|$)|\.tar(?:\?|$)|\.onnx(?:\?|$)/.test(r.url()))forbidden.push(r.url())
    })
    await page.waitForLoadState()
    if(page.url().includes('controller.html'))control=page
    if(page.url().includes('pet.html'))pet=page
  }
  assert.ok(control && pet)
  await control.waitForFunction(()=>document.querySelector('#model-status').textContent==='就绪',null,{timeout:60000})
  const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.webContents.getLastWebPreferences()))
  for(const prefs of windows){assert.equal(prefs.sandbox,true);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.nodeIntegration,false)}
  assert.equal(await control.locator('audio,video').count(),0)
  report.initialPixels=await pixels()
  assert.ok(report.initialPixels.visible>1000 && report.initialPixels.transparent>1000 && report.initialPixels.alpha)
  await control.evaluate(()=>document.querySelector('#action-play').addEventListener('click',()=>{window.actionClickedAt=Date.now()},{capture:true}))
  await pet.evaluate(()=>new MutationObserver(()=>{if(document.querySelector('#caption').textContent)window.captionArrivedAt=Date.now()}).observe(document.querySelector('#caption'),{childList:true,subtree:true,characterData:true}))
  report.captionLatencyMs=[]
  for(let i=0;i<5;i++) {
    await control.locator('#preview-text').fill(`[摇头][微笑]你好，第${i+1}次文字动作测试。`)
    await control.locator('#action-play').click()
    await pet.waitForFunction(()=>document.querySelector('#caption').textContent.includes('你好'))
    report.captionLatencyMs.push(await pet.evaluate(()=>window.captionArrivedAt)-await control.evaluate(()=>window.actionClickedAt))
    if(i<4)await control.locator('#action-stop').click()
  }
  await control.waitForTimeout(550)
  const avatar=pet.frames().find(f=>f.url().includes('avatar.html'))
  report.pose=await avatar.evaluate(()=>JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics))
  assert.equal(report.pose.poseApplied,true)
  assert.ok(report.pose.appliedBoneAngles.some(b=>Math.abs(b.y)>0.001))
  report.movingPixels=await pixels()
  assert.notEqual(report.initialPixels.hash,report.movingPixels.hash)
  await control.screenshot({path:path.join(artifacts,'controller.png')})
  await pet.screenshot({path:path.join(artifacts,'pet-smile-shake.png'),omitBackground:true})
  await control.locator('#action-play').click();await state('paused')
  await control.locator('#action-play').click();await state('playing')
  await control.locator('#visible').uncheck();await state('paused')
  await control.locator('#visible').check()
  await control.locator('#action-stop').click()
  await control.locator('#preview-text').fill('[飞走]你好');await control.locator('#action-play').click();await state('error')
  await control.locator('#preview-text').fill('[点头]好的。');await control.locator('#action-play').click();await state('playing')
  report.nodSamples=[]
  for(let i=0;i<8;i++) {
    await control.waitForTimeout(150)
    report.nodSamples.push(await avatar.evaluate(()=>JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics)))
  }
  await writeFile(path.join(artifacts,'nod-diagnostics.json'),JSON.stringify(report.nodSamples,null,2))
  assert.ok(report.nodSamples.some(s=>s.appliedBoneAngles.some(b=>Math.abs(b.x)>0.001)))
  await state('ended')
  await control.locator('#captions').uncheck();await control.locator('#captions').check()
  assert.equal(await pet.locator('#caption').textContent(),'')
  await control.locator('#action-play').click();await state('playing')
  await control.locator('#preview-text').fill('<img src=x onerror=alert(1)>');await state('idle')
  await control.locator('#action-play').click()
  await pet.waitForFunction(()=>document.querySelector('#caption').textContent.includes('<img'))
  assert.equal(await pet.locator('#caption img').count(),0)
  await control.locator('#action-stop').click()
  const axe=await new AxeBuilder({page:control}).setLegacyMode().withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
  assert.deepEqual(axe.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[])
  for(const width of [360,480,768,1024,1440]) {
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('控制台')).setSize(width,700),width)
    await control.waitForTimeout(80)
    assert.equal(await control.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  }
  await control.locator('#size').fill('240')
  await control.locator('#pinned').uncheck();await control.locator('#pinned').check()
  await control.locator('#click-through').check();await control.locator('#click-through').uncheck()
  const before=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('桌面数字人')).getPosition())
  await pet.locator('#drag-surface').press('ArrowLeft')
  const after=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('桌面数字人')).getPosition())
  assert.equal(after[0],before[0]-10)
  const processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true}))
  // Playwright launches Windows paths through cmd.exe; inspect the actual Electron main PID.
  const mainPid=await app.evaluate(()=>process.pid)
  const ids=new Set([mainPid]);let changed=true
  while(changed){changed=false;for(const p of processes)if(ids.has(p.ParentProcessId)&&!ids.has(p.ProcessId)){ids.add(p.ProcessId);changed=true}}
  report.childProcessNames=processes.filter(p=>ids.has(p.ProcessId)).map(p=>p.Name)
  await writeFile(path.join(artifacts,'processes.json'),JSON.stringify(processes.filter(p=>ids.has(p.ProcessId)),null,2))
  assert.ok(report.childProcessNames.every(name=>name==='ControlTextPet.exe'))
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(forbidden,[])
  report.checks='relocated ASAR; invalid external environments; real alpha/pose/pixels; no speech/model/API/child runtimes; pause/resume/hide/stop/edit/replay/error; native controls; WCAG AA'
  await writeFile(path.join(artifacts,'results.json'),JSON.stringify(report,null,2))
  await writeFile('dist/text-portable.json',JSON.stringify({directory:relocated,executable},null,2))
  console.log(JSON.stringify(report,null,2))
} catch(error) {
  await control?.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{})
  console.error({errors,external,forbidden,childProcessNames:report.childProcessNames});throw error
} finally {await app.close()}
