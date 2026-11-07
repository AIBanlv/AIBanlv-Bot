import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createTextServer, resolveTextFiles } from '../electron/text-server.mjs'
import { AssistantSettings } from '../electron/device-assistant-policy.mjs'
import { DeviceCodex } from '../electron/device-codex.mjs'
import { DeviceActivity } from '../electron/device-activity.mjs'
import { HarnessTaskDispatcher } from '../electron/device-task-dispatcher.mjs'
import { buildFaceBank } from '../electron/device-face-bank.mjs'
import { settingsPages } from '../electron/device-settings-navigation.mjs'
import { showSettings } from './settings-navigation-fixture.mjs'
import { aiToolStatuses } from '../electron/device-ai-tools.mjs'
import { invitationResult, installationPrompt } from '../electron/device-invite.mjs'

const require = createRequire(import.meta.url), root = process.cwd()
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const QRCode = require('qrcode')
const output = path.join(root, 'artifacts/settings-browser')
await mkdir(output, { recursive: true })
const profile = await mkdtemp(path.join(output, 'profile-'))
const files = resolveTextFiles()
const main = await readFile(path.join(root, 'electron/device-main.mjs'), 'utf8')
const whitelist = main.match(/for \(const name of \[([\s\S]*?)\]\) \{\s*files\.set\(`\/device\//)[1]
for (const match of whitelist.matchAll(/'([^']+)'/g)) files.set(`/device/${match[1]}`, path.join(root, 'electron', match[1]))
for (const name of ['lam-track', 'device-particles', 'device-presentation', 'device-idle']) files.set(`/src/${name}.mjs`, path.join(root, 'src', `${name}.mjs`))
const library = path.resolve(root, '../../android-native/digitalhuman-core/src/main/assets/AIBANLVKeyframeFace.json')
const bank = path.join(profile, 'face-bank.json')
await writeFile(bank, JSON.stringify(buildFaceBank(JSON.parse(await readFile(library, 'utf8')))))
files.set('/device/face-bank.json', bank)
files.set('/assets/idle-expressions.json', library)
files.set('/desktop/desktop.css', path.join(root, 'electron/desktop.css'))
files.set('/device/logo.png', path.resolve(root, '../../static/aibanlv-logo.png'))
const token = 'local-settings-fixture'
const server = createTextServer(files, { accessToken: token })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const settings = new AssistantSettings({ file: path.join(profile, 'assistant-settings.json'), encryption: { isEncryptionAvailable: () => false } })
await settings.load()
const activity = new DeviceActivity()
let browser, page, pet
const emit = async (kind, value) => {
  for (const target of [page, pet]) if (target && !target.isClosed()) await target.evaluate(({ kind, value }) => {
    for (const callback of window.fixtureEvents?.[kind] || []) callback(value)
  }, { kind, value }).catch(() => {})
}
const codex = new DeviceCodex({ launch: async () => ({ command: process.execPath, args: [path.join(root, 'tests/codex-app-server-fixture.mjs')] }),
  approve: async () => ({ decision: 'accept' }),
  onActivity: value => activity.add(value.source, value.kind, value.text, value.key) })
codex.on('state', value => { void emit('Codex', value) })
activity.on('state', value => { void emit('Activity', value) })
const state = { deviceId: 'zhanlv:desktop-fixture', binding: 'unbound', connection: 'connected',
  qr: await QRCode.toDataURL('local-bind-fixture'), expiresAt: Date.now() + 900000, roles: [], current: null, phase: 'idle', catalog: { status: 'idle' },
  models: { platformEnabled:true,region:'cn-beijing',workspaceId:'',model:'qwen-audio-3.0-realtime-flash',voice:'longanlingxi',remember:false,configured:false } }
const desktop = { ready: false, visible: true, pinned: true, clickThrough: false, size: 360, volume: 80,
  startup: { supported: true, enabled: true, message: '' } }
let lastVolume = desktop.volume, quitRequests = 0, accountRefreshes = 0
let aiGuideAcknowledgements = 0
let onlineRoleSaves = 0
const openedProviders = [], petMessages = []
let lamProjectOpens = 0
const invitationWrites = [], installationWrites = []
let installationFailure = false
let momentFailure = false, momentWrites = [], momentReads = 0
const momentId = 'a'.repeat(64), commentId = 'b'.repeat(64)
let momentRows = [{ id: momentId, authorName: '小舞', agentId: 'waner', content: '手机与电脑共享的动态 <img src=x onerror=alert(1)>',
  createdAt: '2026-10-29T08:00:00Z', liked: false, media: [], comments: [{ id: commentId, content: '初始评论', authorName: '测试用户' }] }]
  let memoRows = [{ id:'existing-memo-one',content:'已有角色一提醒',agentId:'waner',intervalType:'daily',time:'10:00' },{ id:'existing-memo-two',content:'已有角色二提醒',agentId:'second-role',intervalType:'none',time:'11:00' }], pointsFailure = false
  let memoReads=0,inviteReads=0,inviteCopies=0,inviteFailure=false,shareFailure=false
  const fixtureMailState={configured:false,enabled:false,notifications:false,contentAnnouncements:false,storageAvailable:true}
const methods = {
  desktopAction: (operation, payload, id) => {
    if (operation === 'moments_roles') return { ok: true, data: [{ id: 'waner', name: '小舞' }] }
    if (operation === 'moments_feed') {
      momentReads++
      return momentFailure ? { ok: false, code: 'AI_MOMENTS_DB_UNAVAILABLE' } : { ok: true, data: { records: momentRows, hasMore: false, nextCursor: '' } }
    }
    if (operation.startsWith('moments_')) {
      assert.ok(!('tenantId' in payload) && !('controllerUserId' in payload)); momentWrites.push({ operation, payload })
      if (operation === 'moments_publish') momentRows = [{ id: 'c'.repeat(64), authorName: '测试用户', content: payload.content, media: payload.media, comments: [], createdAt: '2026-10-29T08:05:00Z' }, ...momentRows]
      if (operation === 'moments_like') momentRows.find(row=>row.id===payload.id).liked=payload.liked
      if (operation === 'moments_comment') momentRows.find(row=>row.id===payload.id).comments.push({ id: 'd'.repeat(64), content: payload.content, authorName: '测试用户' })
      if (operation === 'moments_comment_edit') momentRows.flatMap(row=>row.comments).find(row=>row.id===payload.id).content=payload.content
      if (operation === 'moments_delete') momentRows=momentRows.filter(row=>row.id!==payload.id)
      if (operation === 'moments_comment_delete') for(const row of momentRows)row.comments=row.comments.filter(comment=>comment.id!==payload.id)
      return { ok:true, data:true }
    }
    if (operation === 'points_list') {
      if (pointsFailure) return { ok: false, code: 'INVALID_ACTION' }
      assert.ok(!('tenantId' in payload))
      return { ok: true, data: { total: 21, records: Array.from({ length: payload.page === 1 ? 20 : 1 }, (_, i) => ({
        id: `points-${payload.page}-${i}`, type: i ? 2 : -3, amount: i ? 1000 : 8,
        changedScore: 1234 - i, createTime: '2026-10-29 10:20:30', remark: '<img src=x onerror=alert(1)>',
      })) } }
    }
    if (operation === 'invite') { if(shareFailure)return {ok:false,code:'OFFLINE'};if(payload.copy)inviteCopies++;return invitationResult('FIXTURE123','zh-Hans',payload,text=>invitationWrites.push(text)) }
    if (operation === 'invite_list') {
      inviteReads++;assert.deepEqual(Object.keys(payload),['page'])
      if(inviteFailure)return {ok:false,code:'SERVER_UPDATE_REQUIRED'}
      return {ok:true,data:{total:21,records:Array.from({length:payload.page===1?20:1},()=>({maskedName:'王***明',successAt:'2026-10-30 09:30:00'}))}}
    }
    if (operation === 'memo_list') {memoReads++;return { ok: true, data: { records: memoRows, total: memoRows.length } }}
    if (operation === 'memo_create') {
      assert.equal(id, payload.requestId); assert.ok(payload.timezone)
      memoRows = [{ ...payload, id: 'fixture-memo', status: 'active', intervalType: payload.repeat, nextTriggerAt: Date.now() + 86400000 }]
      return { ok: true, data: { ...memoRows[0], notificationsEnabled: false } }
    }
    if (operation === 'memo_delete') { memoRows = []; return { ok: true, data: { id: payload.id, status: 'deleted' } } }
    return { ok: false, code: 'SERVER_UPDATE_REQUIRED' }
  },
  state: () => state, assistantState: () => ({ ...settings.snapshot(), state: settings.snapshot().enabled ? 'ready' : 'disabled' }),
  modelState: () => state.models,
  configureModels: async value => {
    Object.assign(state.models, value, {configured:Boolean(value.apiKey || state.models.configured)})
    delete state.models.apiKey
    state.localWorkspace={configured:state.models.configured||settings.snapshot().configured,realtimeConfigured:state.models.configured,deepseekConfigured:settings.snapshot().configured,momentsEnabled:true,moments:[]}
    await emit('State',state);return {ok:true,...state.models}
  },
  exportHistory: () => ({ok:true}),clearHistory: () => ({ok:true}),
  acknowledgeAiToolsGuide: () => { aiGuideAcknowledgements++; state.aiTools.guide = null; return {} },
  configureAssistant: async value => { try { await settings.configure(value); return { ok: true, ...methods.assistantState() } } catch { return { ok: false, message: 'Key 格式不正确' } } },
  mailState: () => ({...fixtureMailState}),
  configureMail: async value => {
    for(const key of ['provider','user','remember','notifications','contentAnnouncements'])if(key in value)fixtureMailState[key]=value[key]
    fixtureMailState.configured=true;fixtureMailState.enabled=value.enabled!==false
    await emit('Mail',{...fixtureMailState});return {ok:true,...fixtureMailState}
  },
  workbuddyState: () => ({ sessions: [], online: true, count: 0 }),
  codexState: () => codex.snapshot(), codexConnect: () => codex.connect(), codexDisconnect: () => { codex.shutdown(); return {} },
  codexDirectory: () => { codex.cwd = profile; codex.publish(); return { ok: true } },
  codexCreate: prompt => codex.create(prompt), codexInterrupt: id => codex.interrupt(id), activityState: () => activity.snapshot(),
  desktopStatus: () => desktop,
  desktopCommand: (name, value) => {
    if (name === 'volume' && Number.isInteger(value) && value >= 0 && value <= 100) { desktop.volume = value; if (value) lastVolume = value }
    if (name === 'muted' && typeof value === 'boolean') desktop.volume = value ? 0 : lastVolume || 80
    if (name === 'quality') desktop.quality = value
    if (name === 'startup') desktop.startup.enabled = value
    desktop.muted = desktop.volume === 0
    return emit('Desktop', desktop)
  },
  accountState: () => state.account || { bound: false, name: '未登录', points: null },
  refreshAccount: () => { accountRefreshes++; return { ok: true, ...methods.accountState(), message: '账号信息已刷新' } },
  checkUpdate: () => ({ ok: true, message: '本地夹具版本，无需更新' }),
  logout: () => { quitRequests++ },
  configureLocal: async value => {
    state.localWorkspace.momentsEnabled=value.momentsEnabled
    await emit('State',state);return {ok:true}
  },
  openLocalDocuments: () => ({ok:true}),
  openProviderConsole: (provider,region) => {openedProviders.push({provider,region});return {ok:true}},
  openLamProject: () => {lamProjectOpens++;return {ok:true}},
  copyInstallationPrompt: () => {if(installationFailure)return {ok:false};installationWrites.push(installationPrompt);return {ok:true}},
  chooseRoleMedia: kind => ({ok:true,id:`fixture-${kind}`,name:`fixture.${kind==='lam'?'zip':kind==='voice'?'wav':'png'}`}),
  saveRole: async value => {
    if(value.mode==='online') {
      assert.equal(value.consent,true);assert.equal(value.media.photo,'fixture-photo');assert.equal(value.media.voice,'fixture-voice')
      assert.match(value.requestId,/^[a-f0-9-]{36}$/);onlineRoleSaves++
      const role={agentId:'online-fixture',agentName:value.name,description:value.description,kind:'private',available:true}
      state.roles.push(role);state.current=role;state.mode='online';await emit('State',state);return {ok:true,role}
    }
    assert.equal(value.mode,'local');assert.equal(value.media.lam,undefined);assert.equal(value.media.voice,'fixture-voice')
    const role={agentId:'local-fixture',agentName:value.name,description:value.description,characterSetting:value.prompt,source:'local',kind:'local',local:true,available:true}
    state.roles=[role];state.current=role;state.phase='ready';state.mode='local';setTimeout(()=>void emit('State',state),50);return {ok:true,role}
  },
  openRole: () => ({ok:true,history:[{role:'user',text:'昨天聊过的内容',timestamp:Date.now()-86400000},{role:'assistant',text:'[perform:平静地回应对方并自然表达关切]我记得。[msg_end]',timestamp:Date.now()-86400000}]}),
  roleChat: async value => {
    assert.equal(value.agentId,'local-fixture');
    for(const event of [{type:'user',text:value.text},{type:'assistant',text:'[perform:亲切地回应对方并保持自然语气]今天也一起加油。[msg_end]'},{type:'complete'}])await emit('Conversation',{...event,requestId:'local-text-fixture',textOnly:true})
    return {ok:true}
  },
}
const errors = [], requests = []
const trace = text => { if (process.argv.includes('--trace-steps')) console.log(`[settings] ${text}`) }
try {
  const executablePath = process.env.SETTINGS_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(file => existsSync(file))
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'msedge' }), headless: true })
  const context = await browser.newContext({ viewport: { width: 960, height: 780 }, reducedMotion:'reduce', extraHTTPHeaders: { 'X-Pet-Token': token } })
  await context.exposeBinding('fixtureInvoke', async (_source, name, args) => methods[name]?.(...args))
  await context.addInitScript(() => {
    window.fixtureEvents = {}
    const subscribe = (name, callback) => { (window.fixtureEvents[name] ||= []).push(callback); return () => {} }
    window.controlDevice = new Proxy({}, { get: (_target, name) => name.startsWith('on')
      ? callback => subscribe(name.slice(2), callback) : (...args) => window.fixtureInvoke(name, args) })
    window.fixtureGains = []
    const NativeAudioContext = window.AudioContext
    window.AudioContext = class extends NativeAudioContext { createGain() { const gain = super.createGain(); window.fixtureGains.push(gain); return gain } }
    window.desktopPet = { status: () => window.fixtureInvoke('desktopStatus', []), command: (name, value) => window.fixtureInvoke('desktopCommand', [name, value]), drag: () => {},
      onState: callback => subscribe('Desktop', callback), onPause: () => () => {}, onPointer: () => () => {} }
  })
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => { if (response.status() >= 400) requests.push(response.url()) })
  await page.goto(`${origin}/device/device.html`)
  await page.waitForFunction(() => document.querySelector('#qr').naturalWidth > 0 && !document.querySelector('#qr').hidden)
  trace('QR ready')
  if (process.argv.includes('--layout-only')) {
    Object.assign(state,{binding:'bound',accountScope:'fixture-layout',roles:[{agentId:'waner',agentName:'上官婉儿',kind:'public'}],localWorkspace:{configured:true,roles:[],moments:[]}})
    await emit('State',state)
    for(const width of [320,650,1024]) {
      await page.setViewportSize({width,height:800})
      for(const destination of settingsPages) {
        await showSettings(page,destination.id)
        assert.equal(await page.locator('.settings-workspace').evaluate(el=>el.scrollWidth<=el.clientWidth),true,`${destination.id} overflows at ${width}`)
      }
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({allSettingsLayouts:true,widths:[320,650,1024],errors}))
  } else if (process.argv.includes('--conversation-access-only')) {
    const portrait='https://qn.ieasysell.com/menu-author-fixture.png'
    const image=await readFile(path.resolve(root,'../../static/aibanlv-logo.png'))
    await context.route(portrait,route=>route.fulfill({contentType:'image/png',body:image}))
    const role={agentId:'online-chat',agentName:'私有小光',source:'online',kind:'private',agentPhotoUrl:portrait,available:true}
    momentRows=[{id:'e'.repeat(64),authorName:'我',content:'更新的用户动态',createdAt:new Date().toISOString(),avatar:portrait,comments:[],media:[]},
      {id:'f'.repeat(64),agentId:role.agentId,authorName:role.agentName,avatar:portrait,content:'角色动态',createdAt:new Date(Date.now()-60000).toISOString(),comments:[],media:[]}]
    Object.assign(state,{binding:'bound',connection:'connected',accountScope:'composer-fixture',desktopMomentsSupported:true,phase:'ready',
      current:role,roles:[role],score:10,models:{...state.models,route:'platform'}})
    await emit('State',state)
    await page.waitForFunction(()=>!document.querySelector('#moments-menu-avatar').hidden)
    assert.equal(await page.locator('#moments-menu-avatar').getAttribute('src'),portrait)
    assert.equal(await page.locator('#moments-menu-default').isVisible(),false)
    const menuReads=momentReads;await emit('State',state);assert.equal(momentReads,menuReads,'Hidden feeds must not poll on every device state')
    await showSettings(page,'characters');await page.locator('[data-kind=private] summary').click();await page.locator('.character-row').click()
    await page.waitForFunction(()=>!document.querySelector('#character-message').disabled)
    await emit('Conversation',{type:'assistant',requestId:'wrong-account',agentId:'online-chat',accountScope:'another-owner',text:'不应展示其他账号内容'})
    assert.doesNotMatch(await page.locator('#character-chat-history').textContent(),/不应展示其他账号内容/)
    assert.match(await page.locator('#character-chat-funding').textContent(),/线上角色.*在线积分.*不使用本地 Key/)
    await page.locator('#character-message').fill('保留未发送草稿')
    state.score=0;state.models={...state.models,route:'',code:'SCORE_DEPLETED',message:'平台积分不足，请充值后继续对话'};await emit('State',state)
    assert.equal(await page.locator('#character-message').isDisabled(),true);assert.equal(await page.locator('#character-chat-send').isDisabled(),true)
    assert.match(await page.locator('#character-chat-access').textContent(),/积分不足/)
    assert.match(await page.locator('#character-chat-access').textContent(),/AIBanlv 手机端充值/)
    assert.match(await page.locator('#character-message').getAttribute('placeholder'),/AIBanlv 手机端充值/)
    assert.match(await page.locator('#score-status').textContent(),/AIBanlv 手机端充值/)
    state.score=10;state.models={...state.models,route:'platform'};await emit('State',state)
    assert.equal(await page.locator('#character-message').isEnabled(),true);assert.equal(await page.locator('#character-message').inputValue(),'保留未发送草稿')
    const localId='local-12345678-1234-1234-1234-123456789abc',localPhoto=`/assets/local-${localId}.png`
    await context.route(`${origin}${localPhoto}`,route=>route.fulfill({contentType:'image/png',body:image}))
    const localRole={agentId:localId,agentName:'本地小光',source:'local',kind:'local',local:true,agentPhotoUrl:localPhoto,available:true}
    Object.assign(state,{score:0,current:localRole,roles:[role,localRole],localWorkspace:{configured:true,moments:[{agentId:localId,timestamp:Date.now()+60000,authorName:'本地小光',content:'本地动态'}]},models:{...state.models,route:'deepseek'}})
    await emit('State',state);await page.locator('[data-kind=local] summary').click();await page.locator('.character-row').filter({hasText:'本地小光'}).click()
    assert.equal(await page.locator('#character-message').isEnabled(),true,'Local own-key conversations do not depend on platform score')
    assert.match(await page.locator('#character-chat-funding').textContent(),/本地角色.*本地配置.*不消耗 AIBanlv 积分/)
    assert.doesNotMatch(await page.locator('#score-status').textContent(),/充值/)
    await page.waitForFunction(()=>document.querySelector('#moments-menu-avatar').getAttribute('src').startsWith('/assets/local-')&&!document.querySelector('#moments-menu-avatar').hidden)
    state.localWorkspace.moments=[];state.binding='unbound';state.accountScope='';await emit('State',state)
    assert.equal(await page.locator('#moments-menu-avatar').isVisible(),false);assert.equal(await page.locator('#moments-menu-default').isVisible(),true)
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[])
    console.log(JSON.stringify({creditsDisableTyping:true,creditsRecoverDraft:true,localZeroCreditsAllowed:true,latestAuthorMenuAvatar:true,defaultAvatarFallback:true,accountIsolation:true,errors,requests}))
  } else if (process.argv.includes('--pet-local-only')) {
    const role={agentId:'local-pet-fixture',agentName:'本地小光',source:'local',local:true,kind:'local'}
    Object.assign(state,{mode:'local',binding:'unbound',connection:'offline',current:role,roles:[role],phase:'rendering',renderId:'local-render-fixture',renderAsset:'/assets/fixture.zip'})
    desktop.clickThrough=true
    methods.rendered=async(id,status)=>{assert.equal(id,'local-render-fixture');if(status==='ready'){state.phase='ready';await emit('State',state)}}
    methods.chat=text=>{petMessages.push(text);return {ok:true,requestId:'local-pet-chat'}}
    await context.route('**/avatar.html?**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><script>window.pauses=[];window.addEventListener('message',event=>{if(event.data.type==='pause')window.pauses.push(event.data.paused)});setTimeout(()=>parent.postMessage({channel:'control-desktop-pet-v1',type:'ready'},location.origin),20)</script>`}))
    pet=await context.newPage();pet.on('pageerror',error=>errors.push(error.message));await pet.setViewportSize({width:360,height:600})
    await pet.goto(`${origin}/device/device-pet.html`)
    await pet.waitForFunction(()=>!document.querySelector('#chat-text').disabled)
    assert.equal(state.phase,'ready');assert.equal(await pet.locator('#avatar-host iframe').count(),1)
    await pet.waitForFunction(()=>document.querySelector('#avatar-host iframe').contentWindow.pauses.length>0)
    const avatar=pet.frames().find(frame=>frame.url().includes('/avatar.html?'))
    assert.ok((await avatar.evaluate(()=>window.pauses)).every(value=>value===false),'Passthrough must not pause the avatar')
    await pet.locator('#chat-text').fill('本地模式可以对话');await pet.locator('#chat-send').click()
    assert.deepEqual(petMessages,['本地模式可以对话'])
    Object.assign(state,{connection:'connecting',binding:'unknown'});await emit('State',state)
    assert.equal(await pet.locator('#avatar-host iframe').count(),1,'Online reconnect must not remove the local avatar')
    await emit('Desktop',{...desktop,visible:false});assert.equal((await avatar.evaluate(()=>window.pauses)).at(-1),true)
    await emit('Desktop',{...desktop,visible:true});assert.equal((await avatar.evaluate(()=>window.pauses)).at(-1),false)
    await emit('Conversation',{type:'stopped'})
    Object.assign(state,{binding:'bound',connection:'connected',score:0,current:{...role,source:'online',local:false},models:{...state.models,route:'',code:'SCORE_DEPLETED',message:'平台积分不足'}})
    await emit('State',state)
    assert.equal(await pet.locator('#chat-text').isDisabled(),true);assert.equal(await pet.locator('#chat-send').isDisabled(),true)
    assert.equal(await pet.locator('#avatar-host iframe').count(),1,'Credits must not hide the avatar')
    state.score=10;state.models.route='platform';await emit('State',state)
    assert.equal(await pet.locator('#chat-text').isEnabled(),true)
    assert.deepEqual(errors,[])
    console.log(JSON.stringify({localPetRendersWithoutBinding:true,localComposer:true,passthroughDoesNotPause:true,hideAndRestore:true,errors}))
  } else if (process.argv.includes('--local-roles-only')) {
    assert.equal(await page.locator('.character-group:not([open])').count(),3)
    assert.equal(await page.locator('.character-menu-heading').getByRole('button',{name:'创建角色',exact:true}).count(),1)
    await page.locator('#binding-tab-keys').click()
    assert.equal(await page.locator('#model-form').isVisible(),true)
    assert.equal(await page.locator('#model-region').count(),0)
    assert.equal(await page.locator('#model-model, #model-voice').count(),0)
    assert.equal(await page.locator('#model-workspaceId').isVisible(),false)
    await page.locator('[data-provider-console="qwen"]').click();await page.locator('#model-form [data-provider-console="deepseek"]').click()
    assert.deepEqual(openedProviders.map(row=>row.provider),['qwen','deepseek'])
    await page.locator('#realtime-key').fill('fixture-realtime-key')
    await page.locator('#model-deepseek').fill('fixture-deepseek-key')
    await page.locator('#model-form button[type=submit]').click()
    await page.waitForFunction(()=>document.querySelector('#model-feedback').textContent.includes('已保存'))
    await showSettings(page,'characters')
    await page.locator('.characters-nav-label').focus();await page.keyboard.press('Tab')
    assert.equal(await page.locator('#sidebar-character-new').evaluate(el=>el===document.activeElement),true)
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('#sidebar-character-new').getAttribute('aria-current'),'page')
    assert.equal(await page.locator('#character-mode-local').isVisible(),true)
    assert.equal(await page.locator('#character-mode-online').isVisible(),false)
    await page.locator('#character-name').fill('小光 <img src=x>')
    assert.equal(await page.locator('#character-description').isVisible(),false)
    assert.equal(await page.locator('label[for="character-description"]').count(),0)
    assert.equal(await page.locator('#character-lam-project').getAttribute('href'),'https://github.com/aigc3d/LAM')
    const editorUrl=page.url()
    await page.locator('#character-lam-project').click()
    assert.equal(lamProjectOpens,1);assert.equal(page.url(),editorUrl,'External project links must not navigate the settings window')
    await page.locator('#character-prompt').fill('你是温柔的小光')
    assert.match(await page.locator('label[for="character-lam"]').textContent(),/可选/)
    await page.locator('#character-voice').click()
    await page.locator('#character-save').click()
    await page.waitForFunction(()=>document.querySelector('#character-chat-history').textContent.includes('昨天聊过的内容'))
    assert.equal(await page.locator('#character-list .character-row').count(),1)
    assert.equal(await page.locator('.settings-sidebar #character-list').count(),1,'Characters must be nested in the sidebar')
    await showSettings(page,'binding');await page.locator('.character-group[data-kind=local] summary').click();await page.locator('#character-list .character-row').click()
    assert.equal(await page.locator('#character-message').isVisible(),true)
    assert.equal(await page.locator('#character-list strong img').count(),0)
    assert.match(await page.locator('#character-list').textContent(),/本地私有/)
    assert.equal(await page.locator('#character-chat-description, #character-chat-avatar').count(),0)
    assert.equal(await page.locator('#character-chat-history .character-message-avatar').count(),2)
    assert.equal(await page.locator('#characters.controller-section, #characters h2, #character-new').count(),0,'Chat must not repeat the character-list card or creation toolbar')
    assert.equal(await page.locator('#character-refresh').isVisible(),true)
    state.roles[0].description='已有简介应保留';await emit('State',state)
    await page.locator('#character-edit').click()
    assert.equal(await page.locator('#character-description').isVisible(),false)
    assert.equal(await page.locator('#character-description').inputValue(),'已有简介应保留')
    await page.locator('#character-editor-back').click()
    await page.locator('#character-message').fill('今天做点什么？');await page.locator('#character-message').press('Enter')
    await page.waitForFunction(()=>document.querySelector('#character-chat-history').textContent.includes('今天也一起加油'))
    assert.doesNotMatch(await page.locator('#character-chat-history').textContent(),/\[perform:|\[msg_end\]/)
    assert.equal(await page.locator('#character-chat-send').isEnabled(),true)
    const beforeLive = await page.locator('#character-chat-history .character-message').count()
    await emit('Conversation',{type:'preparing',requestId:'avatar-live',agentId:'local-fixture'})
    assert.equal(await page.locator('#character-message').isDisabled(),true)
    await emit('Conversation',{type:'user',requestId:'avatar-live',agentId:'local-fixture',text:'来自数字人窗口的输入'})
    await emit('Conversation',{type:'assistant',requestId:'avatar-live',agentId:'local-fixture',text:'正'})
    await page.evaluate(()=>{window.fixtureStreamNode=document.querySelector('#character-chat-history .character-message:last-child')})
    for(const text of ['正在','正在实时回复'])await emit('Conversation',{type:'assistant',requestId:'avatar-live',agentId:'local-fixture',text})
    await page.waitForFunction(()=>document.querySelector('#character-chat-history').textContent.includes('正在实时回复'))
    assert.equal(await page.locator('#character-chat-history .character-message').count(),beforeLive+2,'Streaming snapshots update one row')
    assert.equal(await page.evaluate(()=>window.fixtureStreamNode===document.querySelector('#character-chat-history .character-message:last-child')),true,'A streamed token must not recreate the history DOM')
    await emit('Conversation',{type:'assistant',requestId:'other-role',agentId:'other-role',text:'不应串到当前角色'})
    assert.doesNotMatch(await page.locator('#character-chat-history').textContent(),/不应串到当前角色/)
    await emit('Conversation',{type:'complete',requestId:'avatar-live',agentId:'local-fixture'})
    assert.equal(await page.locator('#character-message').isEnabled(),true)
    const originalOpenRole=methods.openRole;let releaseHistory
    methods.openRole=()=>new Promise(resolve=>{releaseHistory=resolve})
    await page.locator('#character-list .character-row').click()
    assert.ok(releaseHistory)
    await emit('Conversation',{type:'user',requestId:'while-loading',agentId:'local-fixture',text:'加载历史时的新问题'})
    await emit('Conversation',{type:'assistant',requestId:'while-loading',agentId:'local-fixture',text:'不能被历史覆盖的新回复'})
    releaseHistory({ok:true,history:[{role:'user',text:'旧的历史'},{role:'assistant',text:'旧的回复'},{role:'user',text:'加载历史时的新问题'}]})
    await page.waitForFunction(()=>document.querySelector('#character-chat-history').textContent.includes('旧的历史'))
    assert.match(await page.locator('#character-chat-history').textContent(),/不能被历史覆盖的新回复/)
    assert.equal(await page.locator('#character-chat-history .character-message').count(),4,'History/live overlap is shown only once')
    methods.openRole=originalOpenRole
    state.localWorkspace.moments=[{agentId:'local-fixture',authorName:'小光',content:'今天一起整理了计划。',timestamp:Date.now()}]
    await emit('State',state);await showSettings(page,'ai-moments')
    assert.match(await page.locator('#local-moments-feed').textContent(),/今天一起整理了计划/)
    for(const [width,height] of [[320,800],[650,800],[768,800],[1024,800],[1024,1200],[1440,800]]) {
      await page.setViewportSize({width,height});await showSettings(page,'characters')
      assert.equal(await page.locator('.settings-workspace').evaluate(el=>el.scrollWidth<=el.clientWidth),true)
      assert.equal(await page.locator('.settings-workspace').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'Only chat history should scroll, not the whole workspace')
      assert.equal(await page.locator('#character-message').isVisible(),true)
      const chat=await page.locator('.character-conversation').boundingBox(),compose=await page.locator('#character-chat-form').boundingBox()
      assert.ok(compose.y+compose.height<=height,`Composer must remain inside the window: ${JSON.stringify({width,height,chat,compose})}`)
      assert.ok((await page.locator('#character-chat-history').boundingBox()).height>=80,'History must retain usable space')
      if(width>=650)assert.ok(chat.height>height*.6,'Chat should use the freed card space and grow on tall windows')
      if(width===1024&&height===800)await page.screenshot({path:path.join(output,'local-characters.png')})
    }
    await page.setViewportSize({width:1024,height:800})
    Object.assign(state,{binding:'bound',accountScope:'fixture-owner'});await emit('State',state)
    await page.locator('#sidebar-character-new').click();assert.equal(await page.locator('#character-mode-online').isVisible(),true)
    await page.locator('#character-mode-online').click();assert.equal(await page.locator('#character-lam-field').isVisible(),false)
    assert.equal(await page.locator('#character-online-media-help').count(),0)
    assert.equal(await page.locator('#character-online-consent-field').textContent(),'我确认有权使用这些照片和声音，并同意提交到云端训练。')
    await page.locator('#character-online-consent-field').scrollIntoViewIfNeeded()
    await page.screenshot({path:path.join(output,'role-training.png'),fullPage:true})
    await page.locator('#character-name').fill('线上小光');await page.locator('#character-prompt').fill('你是线上小光')
    await page.locator('#character-photo').click();await page.locator('#character-voice').click()
    await page.locator('#character-save').click()
    assert.match(await page.locator('#character-save-status').textContent(),/请先确认/);assert.equal(onlineRoleSaves,0)
    await page.locator('#character-online-consent').check();await page.locator('#character-save').click()
    await page.waitForFunction(()=>document.querySelector('#character-list').textContent.includes('线上私有'))
    await showSettings(page,'binding')
    assert.equal(await page.locator('#binding-tab-scan').isVisible(),true)
    assert.equal(await page.locator('#model-form').isVisible(),true)
    assert.equal(await page.locator('#binding-summary').isVisible(),false)
    assert.equal(await page.locator('#connected-ai-tools').evaluate(el=>el.closest('[data-binding-panel]').dataset.bindingPanel),'tools')
    assert.equal(await page.locator('#connected-ai-tools').isVisible(),false,'Local settings must not include tool status')
    await page.locator('#binding-tab-tools').click()
    assert.equal(await page.locator('#connected-ai-heading').isVisible(),true)
    assert.equal(await page.locator('#model-form').isVisible(),false)
    await page.locator('#binding-tab-scan').click()
    assert.equal(await page.locator('#binding-summary').isVisible(),true)
    assert.equal(await page.locator('#scan-binding').isVisible(),false)
    await page.locator('#binding-tab-keys').click()
    Object.assign(state,{binding:'unknown',connection:'offline'});await emit('State',state)
    assert.equal(await page.locator('#binding-tab-scan').isVisible(),true)
    assert.equal(await page.locator('#model-form').isVisible(),true)
    Object.assign(state,{binding:'bound',connection:'connected'});await emit('State',state)
    assert.equal(onlineRoleSaves,1)
    state.binding='unbound';state.accountScope='';await emit('State',state)
    assert.equal(await page.locator('#scan-binding').isVisible(),true,'Explicit unbinding returns to the pairing panel')
    assert.equal(await page.locator('#binding-tab-keys').isVisible(),true)
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[])
    console.log(JSON.stringify({localConfiguration:true,characterModes:true,localChat:true,localMoments:true,onlineCreationConsent:true,widths:[320,650,768,1024,1440],errors,requests}))
  } else if (process.argv.includes('--ai-tools-only')) {
    const scope = 'e'.repeat(64)
    const tools = value => ({ items: aiToolStatuses(value), guide: null })
    state.aiTools = tools({ codex: { status: 'connecting' }, workbuddy: { status: 'checking' } })
    await emit('State', state)
    assert.equal(await page.locator('#binding-summary').isVisible(), false)
    Object.assign(state, { binding: 'bound', qr: '', accountScope: scope })
    await emit('State', state)
    await page.waitForFunction(() => !document.querySelector('#binding-summary').hidden)
    await page.locator('#binding-tab-keys').click()
    assert.equal(await page.locator('#connected-ai-tools').isVisible(),false)
    await page.locator('#binding-tab-tools').click()
    assert.equal(await page.locator('#connected-ai-tools button').count(), 3)
    assert.match(await page.locator('[data-tool=codex]').innerText(), /连接中/)
    assert.equal(await page.locator('#settings-page-title').textContent(), '设备绑定', 'Discovery must not redirect while pending')
    state.aiTools = tools({ codex: { status: 'ready' }, workbuddy: { status: 'associated' } })
    await emit('State', state)
    assert.match(await page.locator('[data-tool=codex]').innerText(), /已连接/)
    assert.match(await page.locator('[data-tool=workbuddy]').innerText(), /已关联/)
    assert.equal(aiGuideAcknowledgements, 0)
    await page.locator('[data-tool=codex]').click()
    assert.equal(await page.locator('#settings-page-title').textContent(), 'Codex')
    await showSettings(page, 'binding')
    state.aiTools = { ...tools(), guide: { id: 'f'.repeat(64) } }
    await emit('State', state)
    assert.equal(await page.locator('#settings-page-title').textContent(), '设备绑定', 'A stale account guide cannot navigate')
    state.aiTools.guide = { id: scope }
    await emit('State', state)
    await page.waitForFunction(() => document.activeElement?.id === 'model-deepseek')
    assert.equal(await page.locator('#settings-page-title').textContent(), '设备绑定')
    await showSettings(page,'assistant-heading')
    assert.equal(await page.locator('#assistant-onboarding').isVisible(), true)
    await page.waitForFunction(() => document.querySelector('#assistant-onboarding').textContent.includes('DeepSeek API Key'))
    assert.equal(aiGuideAcknowledgements, 1)
    await showSettings(page,'model-settings');await page.locator('#model-deepseek').fill('fixture-unsaved-key')
    await showSettings(page, 'binding'); await emit('State', state)
    assert.equal(await page.locator('#settings-page-title').textContent(), '设备绑定', 'Updates cannot repeatedly force navigation')
    await showSettings(page,'model-settings')
    assert.equal(await page.locator('#model-deepseek').inputValue(), 'fixture-unsaved-key', 'Automatic detection preserves unsaved input')
    state.aiTools = tools({ assistant: { configured: true, enabled: true } })
    await emit('State', state)
    assert.equal(await page.locator('#assistant-onboarding').isVisible(), false)
    await showSettings(page, 'binding')
    await page.locator('#binding-tab-tools').click()
    assert.match(await page.locator('[data-tool=harness]').innerText(), /已就绪/)
    for (const width of [320,650,960]) {
      await page.setViewportSize({ width, height: 780 })
      assert.equal(await page.locator('.settings-workspace').evaluate(el => el.scrollWidth <= el.clientWidth), true)
      assert.equal(await page.locator('#connected-ai-tools').evaluate(el => el.scrollWidth <= el.clientWidth), true)
      if (width === 960) await page.screenshot({ path: path.join(output, 'settings-ai-tools.png') })
    }
    await page.evaluate(async () => (await import('/device/device-i18n.mjs')).setLanguage('en'))
    assert.match(await page.locator('#connected-ai-heading').innerText(), /AI tool status/)
    assert.match(await page.locator('[data-tool=harness]').innerText(), /Ready/)
    Object.assign(state, { binding: 'unbound', accountScope: '' }); await emit('State', state)
    assert.equal(await page.locator('#binding-summary').isVisible(), false)
    assert.equal(aiGuideAcknowledgements, 1)
    assert.deepEqual(errors, []); assert.deepEqual(requests, [])
    console.log(JSON.stringify({ toolStatuses: true, automaticGuide: true, staleGuideRejected: true, guideOnce: true, draftPreserved: true, localized: true, widths: [320,650,960], errors, requests }))
  } else if (process.argv.includes('--invitation-copy-only')) {
    assert.equal(await page.locator('[data-section="binding"]').innerText(), '设备绑定')
    assert.equal(await page.locator('#settings-page-title').textContent(), '设备绑定')
    Object.assign(state, { binding:'bound', qr:'', accountScope:'fixture-owner-tenant',
      current:{agentId:'waner',agentName:'上官婉儿'}, roles:[{agentId:'waner',agentName:'上官婉儿'}],
      account:{bound:true,name:'测试用户',points:1000,supported:true} })
    await emit('State',state)
    for (const destination of settingsPages) {
      await showSettings(page,destination.id)
      assert.equal(await page.locator('#settings-help,#settings-help-dialog').count(),0)
      await page.locator('#invite-copy').click()
      await page.waitForFunction(()=>document.querySelector('#invite-share-app-url').value==='https://aibanlv.ai/?inviteCode=FIXTURE123')
      const closeStyle=await page.locator('#invite-share-close').evaluate(el=>{const s=getComputedStyle(el);return {text:el.textContent,border:s.borderTopWidth,background:s.backgroundColor,shadow:s.boxShadow,radius:s.borderRadius}})
      assert.deepEqual(closeStyle,{text:'×',border:'0px',background:'rgba(0, 0, 0, 0)',shadow:'none',radius:'0px'})
      assert.match(await page.locator('.invite-share-rules').textContent(),/双方各得 1,000 积分/)
      await page.locator('#invite-share-close').click()
    }
    assert.equal(inviteCopies,0,'Opening the share dialog must not modify clipboard')
    await page.locator('#invite-copy').click()
    await page.locator('#invite-share-copy-url').click()
    await page.waitForFunction(()=>document.querySelector('#invite-share-status').textContent==='电脑客户端邀请链接已复制')
    await page.locator('#invite-share-copy-app-url').click()
    await page.waitForFunction(()=>document.querySelector('#invite-share-status').textContent==='手机 App 邀请链接已复制')
    assert.equal(inviteCopies,2)
    assert.deepEqual(invitationWrites,['https://aibanlv.ai/zh?view=desktop-companion&inviteCode=FIXTURE123','https://aibanlv.ai/?inviteCode=FIXTURE123'])
    assert.equal(await page.locator('#invite-share-installation').inputValue(),installationPrompt)
    assert.equal(await page.locator('#invite-share-code').count(),0)
    await page.locator('#invite-share-copy-installation').click()
    await page.waitForFunction(()=>document.querySelector('#invite-share-status').textContent==='安装提示词已复制')
    assert.deepEqual(installationWrites,[installationPrompt]);assert.equal(inviteCopies,2,'Installation prompt copy must not call the invitation API')
    installationFailure=true;await page.locator('#invite-share-copy-installation').click()
    await page.waitForFunction(()=>document.querySelector('#invite-share-status').textContent==='复制失败，请重试')
    installationFailure=false
    await page.keyboard.press('Escape')
    await page.waitForFunction(()=>document.querySelector('#invite-share-url').value==='')
    assert.equal(await page.locator('#invite-share-url').inputValue(),'')
    shareFailure=true;await page.locator('#invite-copy').click()
    await page.waitForFunction(()=>document.querySelector('#invite-share-status').textContent==='邀请暂时无法获取，请稍后重试')
    assert.equal(await page.locator('#invite-share-copy-app-url').isDisabled(),true)
    assert.equal(await page.locator('#invite-share-copy-installation').isEnabled(),true)
    await page.locator('#invite-share-copy-installation').click()
    await page.waitForFunction(()=>document.querySelector('#invite-share-status').textContent==='安装提示词已复制')
    assert.equal(installationWrites.length,2,'Public installation prompt remains usable when the invitation service fails')
    shareFailure=false;await page.locator('#invite-share-retry').click()
    await page.waitForFunction(()=>document.querySelector('#invite-share-app-url').value==='https://aibanlv.ai/?inviteCode=FIXTURE123')
    Object.assign(state,{binding:'unbound',accountScope:''});await emit('State',state)
    await page.waitForFunction(()=>!document.querySelector('#invite-share-dialog').open)
    assert.equal(await page.locator('#invite-share-app-url').inputValue(),'')
    Object.assign(state,{binding:'bound',accountScope:'fixture-owner-tenant'});await emit('State',state)
    await showSettings(page,'invite-section')
    assert.doesNotMatch(await page.locator('#invite-section').innerText(),/展示成功邀请的账号|奖励以服务端结果为准|好友首次注册/)
    inviteFailure=true;await page.locator('#invite-record-refresh').click()
    await page.waitForFunction(()=>document.querySelector('#invite-record-status').textContent==='邀请记录暂时无法查看，请稍后再试')
    assert.doesNotMatch(await page.locator('#invite-section').innerText(),/控制服务|服务端|后端|数据库/)
    for (const [language,label] of [['en','Device binding'],['ja','デバイス連携'],['zh-Hant','設備綁定'],['zh-Hans','设备绑定']]) {
      await page.evaluate(async value=>(await import('/device/device-i18n.mjs')).setLanguage(value),language)
      await showSettings(page,'binding')
      assert.equal(await page.locator('#settings-page-title').textContent(),label)
      await page.locator('#invite-copy').click()
      const explanation=await page.locator('.invite-share-rules').textContent()
      assert.match(explanation,/1,000/)
      assert.doesNotMatch(explanation,/服务端|後端|server|サーバー/)
      assert.equal(await page.locator('#invite-share-installation').inputValue(),installationPrompt,'The requested installation text stays exact in every UI language')
      assert.match(await page.locator('label[for="invite-share-url"]').textContent(),/电脑客户端|電腦客戶端|Desktop client|デスクトップ版/)
      assert.match(await page.locator('label[for="invite-share-app-url"]').textContent(),/手机|手機|Mobile|モバイル/)
      await page.locator('#invite-share-close').click()
    }
    for (const width of [320,650,960]) {
      await page.setViewportSize({width,height:780})
      await page.locator('#invite-copy').click()
      await page.waitForFunction(()=>document.querySelector('#invite-share-app-url').value==='https://aibanlv.ai/?inviteCode=FIXTURE123')
      assert.equal(await page.locator('#invite-share-dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth}),true)
      if(width===960)await page.screenshot({path:path.join(output,'settings-invitation-share.png')})
      await page.locator('#invite-share-close').click()
    }
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[])
    console.log(JSON.stringify({deviceBindingRenamed:true,unifiedShareDialog:true,copyDesktopAndMobileLinks:true,copyInstallationPrompt:true,noClipboardOnOpen:true,unbindClearsDialog:true,customerFriendlyErrors:true,localized:true,widths:[320,650,960],errors,requests}))
  } else if (process.argv.includes('--mail-codex-only')) {
    await showSettings(page,'mail-heading')
    assert.equal(await page.locator('#mail-content-announcements').isChecked(),false)
    await page.locator('#mail-user').fill('fixture@qq.com')
    await page.locator('#mail-password').fill('fixture-only-authorization')
    await page.locator('#mail-content-announcements').check()
    await page.locator('#mail-save').click()
    await page.waitForFunction(()=>document.querySelector('#mail-password').placeholder.includes('已配置'))
    assert.equal(fixtureMailState.contentAnnouncements,true)
    assert.equal(await page.locator('#mail-password').inputValue(),'')
    assert.match(await page.locator('#mail-content-help').textContent(),/对话服务.*正文不保存/)
    codex.status='ready'
    codex.tasks.set('history',{id:'history',title:'旧历史任务',status:'completed',records:[],updatedAt:Date.now()+1000})
    codex.tasks.set('live',{id:'live',title:'当前真实任务名称',currentRequest:'修复当前登录和通知',status:'inProgress',external:true,records:[],updatedAt:Date.now()})
    codex.publish()
    await showSettings(page,'codex-heading')
    await page.waitForFunction(()=>document.querySelector('#codex-tasks .workbuddy-title')?.textContent.includes('当前真实任务名称'))
    await page.locator('#codex-tasks article').first().locator('summary').click()
    assert.match(await page.locator('#codex-tasks article').first().innerText(),/本轮要求：修复当前登录和通知/)
    for(const width of [320,650,960]){
      await page.setViewportSize({width,height:780})
      for(const id of ['mail-heading','codex-heading']){
        await showSettings(page,id)
        assert.equal(await page.locator('.settings-workspace').evaluate(el=>el.scrollWidth<=el.clientWidth),true)
      }
    }
    await showSettings(page,'mail-heading')
    await page.screenshot({path:path.join(output,'settings-mail-content.png')})
    await page.evaluate(async()=>(await import('/device/device-i18n.mjs')).setLanguage('en'))
    assert.match(await page.locator('label[for="mail-content-announcements"]').textContent(),/Read out new email content/)
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[])
    console.log(JSON.stringify({mailContentOptIn:true,mailPasswordCleared:true,activeCodexFirst:true,currentCodexRequest:true,localized:true,widths:[320,650,960],errors,requests}))
  } else {
  const qrCenter = await page.evaluate(() => {
    const qr = document.querySelector('.qr-slot').getBoundingClientRect(), area = document.querySelector('#scan-binding').getBoundingClientRect()
    return Math.abs(qr.x + qr.width / 2 - area.x - area.width / 2)
  })
  assert.ok(qrCenter < 2, `QR must be centered: ${qrCenter}`)
  assert.equal(await page.locator('#mode-login, #login-form, #registration-fields').count(), 0)
  assert.equal(await page.locator('#binding-title').textContent(), '设备绑定')
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 780 })
    const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > innerWidth,
      workspace: document.querySelector('.settings-workspace').scrollWidth > document.querySelector('.settings-workspace').clientWidth }))
    assert.deepEqual(overflow, { page: false, workspace: false }, `QR authorization must fit settings at ${width}px`)
    await page.screenshot({ path: path.join(output, `qr-only-${width}.png`) })
  }
  assert.equal(await page.locator('#qr').isVisible(), true)
  await page.waitForFunction(() => document.querySelector('#workbuddy-state').textContent !== '未监控')
  assert.equal(await page.locator('#feedback').textContent(), '')
  assert.equal(await page.locator('.plugin-card').count(), 4)
  assert.match(await page.locator('#assistant-heading').textContent(), /Harness/)
  assert.match(await page.locator('#assistant-heading').textContent(), /已内置电脑助手/)
  assert.match(await page.locator('#assistant-heading').evaluate(element => element.nextElementSibling.textContent), /无需额外下载，模拟操作电脑一切任务/)
   assert.match(await page.locator('#assistant-help').textContent(), /权限设置/)
  assert.equal(await page.locator('[data-section="window-settings"]').count(), 0)
  await page.locator('[data-section="role-controls"]').click()
  assert.equal(await page.locator('#settings-page-title').textContent(), '形象设置')
  assert.equal(await page.locator('#window-settings h2').textContent(), '窗口设置')
  await page.locator('[data-section="binding"]').click()
  assert.equal(await page.locator('#quit').count(), 0)
  const announceLayout = await page.evaluate(() => ['codex', 'workbuddy'].map(name => {
    const toggle = document.querySelector(`#${name}-announce`)
    return { role: toggle.getAttribute('role'), className: toggle.closest('label').className,
      direct: toggle.closest('label').parentElement.matches('.plugin-card'), label: toggle.closest('label').textContent.trim() }
  }))
  assert.deepEqual(announceLayout[0], announceLayout[1])
   assert.match(await page.locator('label[for="model-deepseek"]').textContent(), /DeepSeek API Key/)
  assert.equal(await page.locator('#window-settings').evaluate(element=>element.closest('[data-settings-page]').dataset.settingsPage),'role-controls')
  assert.equal(await page.locator('[data-section="role-controls"]').evaluate(element => element.nextElementSibling.dataset.section), 'ai-moments')
  await page.screenshot({ path: path.join(output, 'settings-connection.png') })
  await page.locator('[data-section="plugins-heading"]').click()
  assert.equal(await page.locator('[data-settings-page]:visible').count(), 1)
  assert.equal(await page.locator('.plugin-shortcut:visible').count(), 4)
  assert.equal(await page.locator('.plugin-card:visible').count(), 0)
  await page.screenshot({ path: path.join(output, 'settings-plugins.png') })
  await page.locator('[data-plugin="assistant-heading"]').click()
  assert.equal(await page.locator('[data-settings-page]:visible').count(), 1)
  assert.equal(await page.locator('#settings-page-title').textContent(), 'Harness')
  assert.equal(await page.locator('#mail-form').isVisible(), false)
   await page.locator('#assistant-model-settings').click()
   await page.locator('#model-deepseek').fill('draft-not-submitted')
   await page.locator('[data-section="plugins-heading"]').click()
  await page.locator('[data-plugin="mail-heading"]').click()
  assert.equal(await page.locator('#mail-form').isVisible(), true)
  assert.equal(await page.locator('#assistant-form').isVisible(), false)
   await showSettings(page,'model-settings')
   assert.equal(await page.locator('#model-deepseek').inputValue(), 'draft-not-submitted')
   await page.locator('#model-deepseek').fill('sk-local-fixture-only')
   assert.equal(await page.locator('#model-deepseek').getAttribute('type'), 'password')
   await page.locator('#model-form button[type=submit]').click()
   await page.waitForFunction(() => document.querySelector('#model-feedback').textContent.includes('已保存'))
   assert.equal(await page.locator('#model-deepseek').inputValue(), '')
  assert.equal(settings.snapshot().enabled, true)
   await page.locator('#model-deepseek').fill('bad')
   await page.locator('#model-form button[type=submit]').click()
   await page.waitForFunction(() => document.querySelector('#model-feedback').textContent.includes('格式'))
   assert.equal(await page.locator('#model-deepseek').inputValue(), 'bad')
   await page.locator('#model-deepseek').fill('')
   await page.locator('#model-form button[type=submit]').click()
   await page.waitForFunction(() => document.querySelector('#model-feedback').textContent.includes('已保存'))
  await page.screenshot({ path: path.join(output, 'settings-harness.png') })
   trace('Model settings verified')
   await showSettings(page,'codex-heading')
  await page.locator('#codex-connect').click()
  await page.waitForFunction(() => document.querySelector('#codex-state').textContent === '已连接')
  assert.equal(await page.locator('#codex-directory, #codex-prompt, #codex-create').count(), 0)
  const dispatcher = new HarnessTaskDispatcher({ assistant: { review: async () => ({ decision: 'allow' }) }, codex,
    workbuddy: {}, file: path.join(profile, 'task-projects.json'), workspaceRoots: [profile] })
  await dispatcher.execute({ provider: 'codex', task: '检查项目测试', workspace: profile }, { fromHarness: true })
  await page.waitForFunction(() => document.querySelector('#codex-tasks').textContent.includes('本轮已结束'))
  await page.screenshot({ path: path.join(output, 'codex-task.png') })
  const logGeometry = async id => page.locator(`#${id}`).evaluate(element => ({ height: element.clientHeight,
    overflow: getComputedStyle(element).overflowY, content: element.scrollHeight, top: element.scrollTop }))
  const codexHeight = (await logGeometry('codex-log')).height
  await emit('Codex', { status: 'ready', tasks: Array.from({ length: 32 }, (_, i) => ({ id: `fixture-${i}`, title: `测试任务 ${i}`, status: 'completed',
    records: [{ text: '公开任务进度。'.repeat(100) }] })) })
  assert.equal((await logGeometry('codex-log')).height, codexHeight)
  await page.locator('#codex-tasks summary').first().click()
  assert.equal((await logGeometry('codex-log')).height, codexHeight)
  assert.ok((await logGeometry('codex-log')).content > codexHeight)
  await page.locator('#codex-log').evaluate(element => { element.scrollTop = 120 })
  assert.ok((await logGeometry('codex-log')).top > 0)
  await page.screenshot({ path: path.join(output, 'settings-codex-log.png') })
  await page.locator('#settings-back').click()
  await page.locator('[data-plugin="workbuddy-heading"]').click()
  const buddyHeight = (await logGeometry('workbuddy-log')).height
  await emit('Workbuddy', { online: true, count: 24, sessions: Array.from({ length: 24 }, (_, i) => ({ id: `work-${i}`, title: `WorkBuddy 测试任务 ${i}`, reply: '公开回复与任务进度。'.repeat(100) })), worker: { tasks: [] } })
  const buddyLog = await logGeometry('workbuddy-log')
  assert.equal(buddyLog.height, buddyHeight)
  assert.ok(buddyLog.content > buddyLog.height)
  assert.equal(buddyLog.overflow, 'auto')
  await page.locator('#workbuddy-log').evaluate(element => { element.scrollTop = 160 })
  assert.ok((await logGeometry('workbuddy-log')).top > 0)
  await page.screenshot({ path: path.join(output, 'settings-workbuddy-log.png') })
  await page.locator('[data-section="invite-section"]').click()
  assert.equal(await page.locator('#invite-copy').isVisible(), true)
  const invitationColor = await page.locator('#invite-copy').evaluate(element => getComputedStyle(element).backgroundColor)
  assert.equal(invitationColor, 'rgb(150, 243, 208)')
  await page.screenshot({ path: path.join(output, 'settings-invitation.png') })
  await page.locator('#settings-search').fill('邮箱')
  assert.equal(await page.locator('[data-settings-page]:visible').count(), 1)
  assert.equal(await page.locator('#settings-page-title').textContent(), '搜索结果')
  await page.locator('#settings-search-results button').click()
  assert.equal(await page.locator('#mail-form').isVisible(), true)
  const settingsUrl = page.url()
  await page.locator('#settings-search').fill('电脑助手')
  await page.locator('#settings-search').press('Escape')
  assert.equal(await page.locator('#settings-page-title').textContent(), '只读邮箱')
  await page.locator('#settings-back').click()
  pet = await context.newPage()
  await pet.setViewportSize({ width: 360, height: 780 })
  pet.on('pageerror', error => errors.push(error.message))
  pet.on('response', response => { if (response.status() >= 400) requests.push(response.url()) })
  await pet.goto(`${origin}/device/device-pet.html`)
  await pet.waitForFunction(() => !document.querySelector('#task-summary').hidden)
  assert.equal(await pet.locator('#task-records').isVisible(), false)
  await pet.locator('#task-summary').hover()
  await pet.waitForFunction(() => getComputedStyle(document.querySelector('#task-records')).display !== 'none')
  assert.match(await pet.locator('#task-records').textContent(), /正在检查测试依赖/)
  assert.doesNotMatch(await pet.locator('#task-records').textContent(), /PRIVATE_RAW_REASONING/)
  assert.equal(await pet.locator('#task-records img').count(), 0)
  await pet.screenshot({ path: path.join(output, 'task-records-hover.png') })
  await pet.mouse.move(1, 1)
  await pet.waitForFunction(() => getComputedStyle(document.querySelector('#task-records')).display === 'none')
  // The same main-process activity aggregator receives the events passed to DeviceChat.
  const dialogue = async data => {
    activity.conversation(data, '上官婉儿')
    await emit('Conversation', data)
    await emit('Activity', activity.snapshot())
  }
  await dialogue({ type: 'preparing', requestId: 'text-turn' })
  await dialogue({ type: 'user', requestId: 'text-turn', text: '帮我打开浏览器', input: 'text' })
  await pet.waitForFunction(() => document.querySelector('#task-summary').textContent.includes('我：帮我打开浏览器'))
  await dialogue({ type: 'assistant', requestId: 'text-turn', text: '[微笑]正在处理' })
  await dialogue({ type: 'assistant', requestId: 'text-turn', text: '[微笑]已提交启动请求。<img src=x> [head:' })
  await dialogue({ type: 'complete', requestId: 'text-turn' })
  await dialogue({ type: 'preparing', requestId: 'voice-turn' })
  await dialogue({ type: 'user', requestId: 'voice-turn', text: '谢谢，接着看看任务状态', input: 'voice' })
  await dialogue({ type: 'assistant', requestId: 'voice-turn', text: '[点头]好的，我会继续汇报。' })
  await dialogue({ type: 'complete', requestId: 'voice-turn' })
  await dialogue({ type: 'assistant', requestId: 'text-turn', text: '过期回复不应显示' })
  await pet.waitForFunction(() => document.querySelector('#task-summary').textContent.includes('上官婉儿：好的，我会继续汇报。'))
  assert.equal(await pet.locator('#conversation, #caption-bubble, .conversation-bubble').count(), 0)
  const chatRows = pet.locator('.task-record[data-kind="user"], .task-record[data-kind="reply"]')
  assert.deepEqual(await chatRows.locator('p').allTextContents(), [
    '帮我打开浏览器', '已提交启动请求。<img src=x>', '谢谢，接着看看任务状态', '好的，我会继续汇报。',
  ])
  const dialogueHeaders = await chatRows.locator('small').allTextContents()
  assert.deepEqual(dialogueHeaders.map(text => text.split(' · ')[0]), ['我', '上官婉儿', '我', '上官婉儿'])
  assert.ok(dialogueHeaders.every(text => / · \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \/ 对话$/.test(text)))
  assert.equal(await pet.locator('#task-records img').count(), 0)
  assert.match(await pet.locator('#task-summary').textContent(), /^实时信息/)
  assert.equal(await pet.locator('#chat-text').evaluate(element => getComputedStyle(element).overflowY), 'hidden')
  assert.equal(await pet.locator('#chat-form').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(14, 30, 43, 0.48)')
  await pet.locator('#pet-volume').fill('35')
  await pet.waitForFunction(() => document.querySelector('#pet-volume').value === '35')
  await pet.locator('#pet-audio').click()
  await pet.waitForFunction(() => document.querySelector('#pet-audio').getAttribute('aria-pressed') === 'true')
  assert.equal(desktop.volume, 0)
  await pet.waitForFunction(() => window.fixtureGains.length && window.fixtureGains.every(gain => gain.gain.value === 0))
  await pet.locator('#pet-audio').click()
  await pet.waitForFunction(() => document.querySelector('#pet-volume').value === '35')
  assert.equal(await pet.locator('#task-records').isVisible(), false)
  for (const width of [300, 360, 440]) {
    await pet.setViewportSize({ width, height: 650 })
    await pet.locator('#task-summary').focus()
    await pet.waitForFunction(() => getComputedStyle(document.querySelector('#task-records')).display !== 'none')
    const geometry = await pet.locator('#task-records').evaluate(element => {
      const rect = element.getBoundingClientRect(), form = document.querySelector('#chat-form').getBoundingClientRect()
      return { left: rect.left, right: rect.right, bottom: rect.bottom, formTop: form.top, viewport: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth }
    })
    assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.bottom <= geometry.formTop && !geometry.overflow, JSON.stringify(geometry))
    await pet.screenshot({ path: path.join(output, `dialogue-tasks-${width}.png`) })
    await pet.locator('#task-summary').evaluate(element => element.blur())
    await pet.mouse.move(1, 1)
  }
  await pet.waitForFunction(() => getComputedStyle(document.querySelector('#task-records')).display === 'none')
  await pet.screenshot({ path: path.join(output, 'dialogue-task-status.png') })
  await dialogue({ type: 'reset' })
  assert.equal(await chatRows.count(), 0)
  assert.match(await pet.locator('#task-records').textContent(), /正在检查测试依赖/)
  state.binding = 'bound'; state.qr = ''; state.accountScope = 'fixture-owner-tenant'
  state.current = { agentId: 'waner', agentName: '上官婉儿', voiceId: 'fixture-voice', language: 'zh' }
  state.roles = [state.current]; state.catalog = { status: 'ready', count: 1 }
  state.account = { bound: true, name: '测试用户', points: 1234, supported: true }
  state.desktopMomentsSupported = true
  desktop.ready = true; desktop.status = 'ready'
  await emit('State', state); await emit('Desktop', desktop)
  assert.equal(await page.locator('[data-section="ai-moments"]').evaluate(el=>el.nextElementSibling.dataset.section), 'scheduled-tasks')
  const readsBefore = momentReads
  await page.locator('[data-section="ai-moments"]').click()
  await page.waitForFunction(()=>document.querySelectorAll('.moment-card').length===1)
  assert.equal(momentReads, readsBefore + 1)
  assert.match(await page.locator('#moments-feed').textContent(), /手机与电脑共享的动态/)
  assert.equal(await page.locator('#moments-feed img[src="x"]').count(),0)
  assert.equal(await page.locator('#moments-feed video').count(),0)
  await page.locator('.moment-card').first().getByRole('button',{name:'点赞',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.moment-tools button').getAttribute('aria-pressed')==='true')
  await page.locator('.moment-card').first().getByRole('button',{name:'评论',exact:true}).click()
  await page.locator('#moments-comment-content').fill('桌面端评论测试')
  await page.locator('#moments-comment-save').click()
  await page.waitForFunction(()=>!document.querySelector('#moments-comment-dialog').open)
  await page.waitForFunction(()=>document.querySelector('#moments-feed').textContent.includes('桌面端评论测试'))
  await page.locator('.moment-comment').first().getByRole('button',{name:'修改评论',exact:true}).click()
  await page.locator('#moments-comment-content').fill('修改后的评论')
  await page.locator('#moments-comment-save').click()
  await page.waitForFunction(()=>document.querySelector('#moments-feed').textContent.includes('修改后的评论'))
  await page.locator('#moments-new').click()
  await page.locator('#moments-content').fill('桌面端新动态')
  await page.locator('#moments-mentions').selectOption('waner')
  await page.locator('#moments-publish').click()
  await page.waitForFunction(()=>document.querySelectorAll('.moment-card').length===2)
  const publish=momentWrites.find(row=>row.operation==='moments_publish')
  assert.match(publish.payload.requestId,/^[\w-]{16,80}$/);assert.deepEqual(publish.payload.mentionAgentIds,['waner'])
  await page.locator('.moment-card').first().getByRole('button',{name:'删除动态',exact:true}).click()
  await page.locator('#moments-confirm-delete').click()
  await page.waitForFunction(()=>document.querySelectorAll('.moment-card').length===1)
  momentFailure=true;await page.locator('#moments-refresh').click()
  await page.waitForFunction(()=>document.querySelector('#moments-status').textContent.includes('服务繁忙'))
  momentFailure=false;await page.locator('#moments-refresh').click()
  await page.waitForFunction(()=>document.querySelector('#moments-status').textContent==='')
  await page.screenshot({path:path.join(output,'settings-ai-moments.png')})
   trace('Tasks, conversation and Moments verified')
   state.score = null; state.scoreSync = { state: 'error', message: '积分查询失败，已降低重试频率；可稍后点击积分旁的刷新图标重试' }
  await emit('State', state)
  assert.match(await page.locator('#score-status').textContent(), /积分查询失败/)
  assert.doesNotMatch(await page.locator('#score-status').textContent(), /正在核实/)
  state.score = 0; state.scoreSync = { state: 'ready' }; await emit('State', state)
  assert.match(await page.locator('#score-status').textContent(), /平台积分不足/)
  state.score = 1234; await emit('State', state)
  await showSettings(page, 'points-details')
  await page.waitForFunction(() => document.querySelectorAll('.points-record').length === 20)
  assert.equal(await page.locator('#points-balance').textContent(), '1,234')
  assert.equal(await page.locator('#points-records img').count(), 0)
  assert.match(await page.locator('#points-records').textContent(), /对话消耗/)
  await page.locator('#points-next').click()
  await page.waitForFunction(() => document.querySelector('#points-page').textContent === '2 / 2')
  assert.equal(await page.locator('.points-record').count(), 1)
  await page.locator('#points-prev').click()
  await page.waitForFunction(() => document.querySelector('#points-page').textContent === '1 / 2')
  pointsFailure = true
  await page.locator('#points-refresh').click()
  await page.waitForFunction(() => document.querySelector('#points-status').textContent.includes('当前后端尚不支持'))
  pointsFailure = false
  await page.locator('#points-refresh').click()
  await page.waitForFunction(() => document.querySelector('#points-status').textContent === '')
  assert.equal(await page.locator('#binding').isVisible(), false, 'Binding is not the active settings page')
  await page.locator('[data-section="role-controls"]').click()
  assert.equal(await page.locator('#startup').isChecked(), true)
  desktop.startup = { supported: false, enabled: false, message: '当前为开发或隔离测试版，不能开启自启动。请安装 EXE 后设置。' }
  await emit('Desktop', desktop)
  assert.equal(await page.locator('#startup').isDisabled(), true)
  assert.match(await page.locator('#startup-label').textContent(), /仅安装版/)
  assert.match(await page.locator('#startup-status').textContent(), /请安装 EXE/)
  desktop.startup = { supported: true, enabled: true, message: '' }; await emit('Desktop', desktop)
  await page.locator('#startup').uncheck()
  assert.equal(desktop.startup.enabled, false)
  await page.locator('#startup').check()
  assert.equal(desktop.startup.enabled, true)
  await page.locator('[data-section="role-controls"]').click()
  await page.locator('#avatar-quality').selectOption('high')
  await page.waitForFunction(() => document.querySelector('#avatar-quality').value === 'high')
  assert.equal(desktop.quality, 'high')
  const readsBeforeMemo=memoReads
  await page.locator('[data-section="scheduled-tasks"]').click()
  await page.waitForFunction(()=>document.querySelector('#memo-list').textContent.includes('已有角色二提醒'))
  assert.equal(memoReads,readsBeforeMemo+1,'opening reminders loads all roles without clicking refresh')
  assert.equal(await page.locator('#memo-form').isVisible(),false)
  await page.locator('#memo-new').click()
  assert.equal(await page.locator('#memo-form').isVisible(),true)
  await page.locator('#memo-cancel').click()
  assert.equal(await page.locator('#memo-form').isVisible(),false)
  await page.locator('#memo-new').click()
  state.notificationSync = { state: 'unsupported' }; await emit('State', state)
  assert.match(await page.locator('#notification-status').textContent(), /请更新后端/)
  state.notificationSync = { state: 'ready' }; await emit('State', state)
  assert.match(await page.locator('#notification-status').textContent(), /漏收恢复已启用/)
  await page.locator('#memo-content').fill('本地夹具喝水提醒')
  await page.locator('#memo-repeat').selectOption('daily')
  await page.locator('#memo-time').fill('09:00')
  await page.locator('#memo-save').click()
  await page.waitForFunction(() => document.querySelector('#memo-list').textContent.includes('本地夹具喝水提醒'))
  assert.match(await page.locator('#memo-status').textContent(), /通知已关闭/)
  assert.equal(await page.locator('#memo-form').isVisible(),false)
  await page.locator('#memo-list button').click()
  await page.waitForFunction(() => document.querySelector('#memo-list').textContent.includes('暂无定时任务'))
  await page.locator('[data-section="invite-section"]').click()
  await page.waitForFunction(()=>document.querySelectorAll('.invite-record').length===20)
  assert.match(await page.locator('#invite-record-list').textContent(),/王\*\*\*明/)
  assert.doesNotMatch(await page.locator('#invite-record-list').textContent(),/王小明/)
  assert.equal(await page.locator('#invite-record-page').textContent(),'1 / 2')
  await page.locator('#invite-record-next').click()
  await page.waitForFunction(()=>document.querySelectorAll('.invite-record').length===1)
  inviteFailure=true;await page.locator('#invite-record-refresh').click()
   await page.waitForFunction(()=>document.querySelector('#invite-record-status').textContent==='邀请记录暂时无法查看，请稍后再试')
  const failedReads=inviteReads;await page.waitForTimeout(300);assert.equal(inviteReads,failedReads,'unsupported invitation history never polls')
  inviteFailure=false;await page.locator('#invite-record-refresh').click()
  await page.waitForFunction(()=>document.querySelector('#invite-record-status').textContent==='')
  await page.locator('#invite-copy').click()
  await page.locator('#invite-share-copy-url').click()
  await page.waitForFunction(()=>document.querySelector('#invite-share-status').textContent.includes('已复制'))
  assert.equal(inviteCopies,1)
  await page.locator('#invite-share-close').click()
  await page.screenshot({path:path.join(output,'settings-invite-history.png')})
  await page.locator('[data-section="role-controls"]').click()
   trace('Points, reminders and invitation verified')
   const sizes = []
  for (const width of [320, 650, 960]) {
    await page.setViewportSize({ width, height: 780 })
    for (const destination of settingsPages) {
       trace(`${width}px / ${destination.id}`)
      await showSettings(page, destination.id)
      assert.equal(await page.locator('[data-settings-page]:visible').count(), 1)
       assert.equal(await page.locator('#settings-page-title').textContent(), destination.container ? settingsPages.find(page=>page.id===destination.container).title : destination.title)
      assert.equal(await page.locator('.controller-heading #invite-copy').isVisible(),true)
      assert.equal(await page.locator('#settings-help,#settings-help-dialog').count(),0)
      await page.locator('#invite-copy').click()
      assert.equal(await page.locator('#invite-share-dialog').evaluate(element=>element.open),true)
      assert.match(await page.locator('.invite-share-rules').textContent(),/双方各得 1,000 积分/)
      await page.locator('#invite-share-close').click()
      const fits = await page.locator('.settings-workspace').evaluate(element => element.scrollWidth <= element.clientWidth)
      assert.ok(fits, `Settings page ${destination.id} overflows at ${width}px`)
      assert.equal(page.url(), settingsUrl, 'View changes must retain the exact trusted settings URL')
      if (['codex-heading', 'workbuddy-heading'].includes(destination.id)) {
        const id = destination.id === 'codex-heading' ? 'codex-log' : 'workbuddy-log'
        const log = await logGeometry(id)
        assert.equal(log.height, (width <= 650 ? 260 : 300) - 2, JSON.stringify(log))
        assert.equal(log.overflow, 'auto')
      }
      if (width === 320) await page.screenshot({ path: path.join(output, `page-${destination.id}-${width}.png`) })
    }
    await page.locator('[data-section="role-controls"]').click()
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      content: document.querySelector('.settings-workspace').clientWidth, contentScroll: document.querySelector('.settings-workspace').scrollWidth }))
    assert.ok(layout.scroll <= width && layout.contentScroll <= layout.content, JSON.stringify(layout))
    const roleField = await page.locator('#roles').evaluate(element => {
      const style = getComputedStyle(element)
      const text = element.selectedOptions[0]?.textContent
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const metrics = context.measureText(text || '角色')
      // Native Windows selects expose line-height as "normal"; measure the font box instead.
      return { text, textHeight: metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent,
        availableHeight: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) }
    })
    assert.equal(roleField.text, '上官婉儿')
    assert.ok(roleField.availableHeight >= roleField.textHeight, `Role text is vertically clipped: ${JSON.stringify(roleField)}`)
     const icons = await page.locator('.settings-nav > .menu-icon:visible').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height }
    }))
    assert.ok(icons.length === 6 && icons.every(icon => icon.width === 20 && icon.height === 20), JSON.stringify(icons))
    assert.equal(await page.locator('.settings-sidebar > nav').evaluate(el=>getComputedStyle(el).scrollbarWidth),'none')
    sizes.push(layout)
    await page.screenshot({ path: path.join(output, `settings-${width}.png`) })
    await page.locator('#account-menu > summary').click()
    assert.equal(await page.locator('#account-menu-name').textContent(), '测试用户')
    assert.equal(await page.locator('#account-points').textContent(), '1,234')
    await page.mouse.move(300, 10)
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#account-refresh')).opacity === '0')
    await page.locator('.account-balance').hover()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#account-refresh')).opacity === '1')
    assert.equal(await page.locator('#account-refresh').textContent(), '')
    await page.locator('#account-refresh').click()
    await page.waitForFunction(() => !document.querySelector('#account-refresh').disabled)
    assert.equal(await page.locator('#account-feedback').textContent(), '账号信息已刷新')
    assert.equal(await page.locator('#account-points-status').textContent(), '')
    const accountRect = await page.locator('.account-popover').boundingBox()
    assert.ok(accountRect.x >= 0 && accountRect.x + accountRect.width <= width)
    await page.screenshot({ path: path.join(output, `account-${width}.png`) })
    await page.keyboard.press('Escape')
  }
  await page.locator('#account-menu > summary').click()
  await page.locator('#account-update').click()
  await page.waitForFunction(() => document.querySelector('#account-feedback').textContent.includes('无需更新'))
  await page.locator('#desktop-update-close').click()
  await page.locator('#account-menu > summary').click()
  await page.locator('#account-logout').click()
  await page.waitForFunction(() => document.querySelector('#account-feedback').textContent === '正在关闭软件…')
  assert.equal(quitRequests, 1)
  assert.equal(state.account.bound, true, 'Quitting must not revoke the binding or clear account settings')
  state.binding = 'unbound'; state.qr = await QRCode.toDataURL('local-bind-fixture'); await emit('State', state)
  state.account = { bound: false, name: '未登录', points: null }; await emit('State', state)
  assert.equal(await page.locator('.points-record').count(), 0, 'Revocation must clear private ledger rows even when its page is hidden')
  assert.equal(await page.locator('#points-balance').textContent(), '—')
  assert.equal(await page.locator('.moment-card').count(),0,'Unbinding clears private moment posts even while the page is hidden')
  assert.equal(await page.locator('#account-logout').isEnabled(), true)
  await page.locator('#account-logout').click()
  assert.equal(quitRequests, 2, 'Unbound users can also close the app from this menu')
  await page.locator('[data-section="binding"]').click()
  assert.equal(await page.locator('#qr').isVisible(), true)
  assert.equal(await page.locator('#mode-login, #login-form, #registration-fields').count(), 0)
  assert.equal(accountRefreshes, 5)
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [])
  const report = { qrVisible: true, scanOnlyAuthorization: true, keySaved: true, failedKeyRetained: true, bindingTransitions: true,
    taskLifecycle: true, hoverRecords: true, rawReasoningExcluded: true, roleTextFits: true, independentSettingsPages: true,
    pluginDraftPreserved: true, uniformMenuIcons: true, highlightedInvitation: true, hoverCreditRefresh: true, boundedPluginLogs: true,
    pagedCreditHistory: true, creditFailureAndRetry: true, datedDialogue: true, removedAccountRegistration: true, windowSettingsRenamed: true,
    aiMomentsFeed: true, momentPublishLikeCommentEditDelete: true, momentsFailureRetryAndAccountIsolation: true,
    harnessBranding: true, unifiedDialogue: true, streamedDialogueDeduplicated: true, noLegacyBubbles: true,
    dialogueReset: true, accountMenu: true, accountExitRequestsQuit: true, mutedGainZero: true, noInputScrollbar: true, alignedAnnouncementSwitches: true, sizes, errors, requests }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  }
} finally {
  codex.shutdown(); activity.clear()
  if (browser) await browser.close()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
