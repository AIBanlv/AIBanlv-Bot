import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { verifyReviewFixes } from './device-review-fixes-electron.mjs'
import { verifyModelPage, verifyModelTest } from './device-model-page-electron.mjs'
import { verifyHarnessClient } from './device-harness-client-electron.mjs'
import { waitForDeviceState } from './device-state-fixture.mjs'
import { verifyRoleBilling } from './device-role-billing-electron.mjs'
const require = createRequire(import.meta.url), root = process.cwd()
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const { default: AxeBuilder } = require(process.env.AXE_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/@axe-core/playwright'))
const { WebSocketServer } = require('ws')
const artifacts = path.join(root, 'artifacts/standalone-electron')
const profile = path.join(artifacts, `profile-${Date.now()}`)
await mkdir(profile, { recursive: true })
await writeFile(path.join(profile, 'local-role.json'), JSON.stringify({ agentName: '旧本地角色', characterSetting: '旧版配置', archive: false }))
if (process.env.DEVICE_MODEL_PAGE_ONLY === '1' || process.env.DEVICE_MODEL_LEGACY_DEFAULTS === '1') {
  await writeFile(path.join(profile, 'model-settings.json'), JSON.stringify({ platformEnabled: false,
    ...(process.env.DEVICE_MODEL_LEGACY_DEFAULTS === '1' ? { model: 'qwen3.8-omni-flash-realtime', voice: 'Tina' } : {}) }))
}
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
await new Promise(resolve => server.once('listening', resolve))
const port = server.address().port, rows = new Map(), messages = [], configs = [], errors = []
const realtimeFixture = { hold: false, pending: [], connections: 0, cancellations: 0 }
let device, deviceId, bound = false, owner = 'fixture-user-a', tenant = 'fixture-tenant-a', providers = 0
const send = value => device.send(JSON.stringify({ deviceId, ...value }))
const bind = () => {
  bound = true
  send({ type: 'bind_success', tenantId: tenant, controllerUserId: owner })
  send({ type: 'device_challenge', nonce: randomUUID() })
}
server.on('connection', (socket, request) => {
  if (request.url.startsWith('/billing/')) {
    socket.on('message', raw => {
      const value = JSON.parse(raw); messages.push(value)
      if (value.type === 'session_register') socket.send(JSON.stringify({ type: 'session_ready', sessionId: value.sessionId, role: 'producer' }))
      if (value.type === 'session_event') socket.send(JSON.stringify({ type: 'event_ack', sessionId: value.sessionId, sequence: value.sequence, duplicate: false }))
    })
    return
  }
  if (['/provider', '/platform-provider'].includes(request.url)) {
    providers++
    realtimeFixture.connections++
    const own = request.url === '/provider'
    if (own) messages.push({ type: 'fixture-own-provider' })
    assert.equal(request.headers.authorization, own ? 'Bearer fixture-own-realtime' : 'Bearer fixture-platform-realtime')
    socket.on('message', raw => {
      const value = JSON.parse(raw)
      if (value.type === 'session.update') { configs.push(value.session); socket.send('{"type":"session.updated"}') }
      if (value.type === 'conversation.item.create') socket.send(JSON.stringify({ type: 'conversation.item.created', item: value.item }))
      if (value.type === 'response.cancel') realtimeFixture.cancellations++
      if (value.type === 'response.create') {
        const id = randomUUID(), emit = item => socket.send(JSON.stringify(item))
        emit({ type: 'response.created', response: { id } })
        const finish = () => {
          emit({ type: 'response.audio.delta', response_id: id, delta: Buffer.alloc(16000).toString('base64') })
          emit({ type: 'response.audio_transcript.done', response_id: id, transcript: '自有语音回复' })
          emit({ type: 'response.done', response: { id, status: 'completed', usage: { total_tokens: 9 } } })
        }
        if (realtimeFixture.hold) realtimeFixture.pending.push({ socket, finish })
        else finish()
      }
    })
    return
  }
  assert.equal(request.url, '/ws/control')
  device = socket
  socket.on('message', raw => {
    const value = JSON.parse(raw); messages.push(value)
    if (value.type === 'device_online') {
      deviceId = value.deviceId
      if (bound) bind()
      else send({ type: 'bind_offer', bindToken: 'fixture-pairing-token', expireAt: Date.now() + 900000, bound: false })
    }
    if (value.type === 'ping') send({ type: 'pong' })
    if (value.type === 'device_history_request') send({ type: 'device_history', requestId: value.requestId, agentId: value.agentId,
      tenantId: tenant, controllerUserId: owner, history: [] })
    if (value.type === 'assistant_reply' && value.finished) {
      rows.set(`${owner}:${value.messageId}`, value)
      send({ type: 'reply_saved', messageId: value.messageId, tenantId: tenant, controllerUserId: owner })
    }
  })
})
const bootstrap = path.join(artifacts, 'bootstrap.mjs')
await writeFile(bootstrap, `import { createRequire, registerHooks } from 'node:module'
const require = createRequire(${JSON.stringify(pathToFileURL(path.join(root, 'package.json')).href)})
const Socket = require('ws')
globalThis.WebSocket = class extends Socket {
  constructor(url, options) {
    const text = String(url)
    if (text.startsWith('wss://fixture-space.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?')) super('ws://127.0.0.1:${port}/provider', options)
    else if (text.startsWith('wss://dashscope.aliyuncs.com/api-ws/v1/realtime?')) super('ws://127.0.0.1:${port}/platform-provider', options)
    else if (text.startsWith('wss://scrm.ieasysell.com/ws/digital-human-session/')) super('ws://127.0.0.1:${port}/billing/' + text.split('/').pop(), options)
    else if (text === 'ws://127.0.0.1:${port}/ws/control') super(text, options)
    else throw new Error('Non-fixture socket blocked')
  }
}
registerHooks({ resolve(specifier, context, next) { return specifier === 'ws' && context.conditions.includes('import')
  ? { url: 'data:text/javascript,export default globalThis.WebSocket', shortCircuit: true } : next(specifier, context) } })
const { DeviceCodex } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/device-codex.mjs')).href)})
DeviceCodex.prototype.startAutoConnect = () => {}
// Only test code can create this local role; online catalog/phone inputs still
// pass through the production normalizer and can never opt out of billing.
const { DeviceRuntime } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/device-runtime.mjs')).href)})
const applyProfile = DeviceRuntime.prototype.apply
globalThis.fixtureProfileEvents = []
const publishProfile = DeviceRuntime.prototype.publish
DeviceRuntime.prototype.publish = function(patch) {
  globalThis.fixtureProfileEvents.push({ current: patch.current?.agentId, desired: patch.desired?.agentId, phase: patch.phase })
  return publishProfile.call(this, patch)
}
DeviceRuntime.prototype.apply = function(...args) {
  globalThis.fixtureRuntime = this
  return applyProfile.apply(this, args)
}
globalThis.fixtureSelectLocal = () => globalThis.fixtureRuntime.apply({ source: 'local', agentId: 'fixture-local-role',
  agentName: '本地测试角色', characterSetting: '仅存在本地夹具中的角色', profileVersion: 0,
  zipUrl: 'https://qn.ieasysell.com/public-avatar-fixture.zip' })
// Prevent the embedded planner child from accessing a real model in this fixture.
const { AssistantService } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/device-assistant-service.mjs')).href)})
const planTask = AssistantService.prototype.planTask
AssistantService.prototype.planTask = function(...args) {
  return this.client?.ready() ? planTask.apply(this, args) : Promise.resolve({ decision: 'chat' })
}
// Test-only inference stub: no production model downloads or local portrait implementation.
const { DeviceLam } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/device-lam.mjs')).href)})
const { pipeline } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'src/control.mjs')).href)})
const track = frames => ({ pipeline, fps: 30, frames, poses: frames.map(() => [0,0,0,0,0,0]) })
const engine = () => ({ reset: async () => {}, reply: async () => {}, dispose: async () => {},
  infer: async () => Array.from({ length: 30 }, () => Array(52).fill(0)), process: async frames => track(frames),
  finish: async () => track(Array.from({ length: 30 }, () => Array(52).fill(0))) })
for (const name of ['prewarm', 'begin']) {
  const original = DeviceLam.prototype[name]
  DeviceLam.prototype[name] = function(...args) { this.engineFactory = async () => engine(); return original.apply(this, args) }
}
globalThis.fixtureRequests = []; globalThis.fixtureRejectText = false
globalThis.fixtureRejectPublic = process.env.DEVICE_PUBLIC_AVATAR_FAIL === '1'
const original = globalThis.fetch
globalThis.fetch = async (url, options = {}) => {
  const target = String(url)
  if (target.startsWith('http://127.0.0.1:')) return original(url, options)
  globalThis.fixtureRequests.push({ url: target, body: options.body })
  if (target.endsWith('/jwt/client/desktop-public/roles')) {
    if (new Headers(options.headers).has('Authorization')) throw new Error('Public catalog must not send credentials')
    if (globalThis.fixtureRejectPublic) return new Response('', { status: 503 })
    return Response.json({ code: 200, data: [
      { id: 'public-waner', name: 'waner', tenantId: '1', digitalHumanId: 'model-waner', voiceId: 'longanlingxi', zipUrl: 'https://qn.ieasysell.com/public-avatar-fixture.zip' },
      { id: 'public-other', name: '公共角色二', tenantId: '1', digitalHumanId: 'model-other', voiceId: 'Tina', zipUrl: 'https://qn.ieasysell.com/public-avatar-fixture.zip' },
    ] })
  }
  if (target === 'https://qn.ieasysell.com/public-avatar-fixture.zip') {
    const { readFile } = await import('node:fs/promises')
    return new Response(await readFile(${JSON.stringify(path.resolve(root, '../../../android-framework-new/photo/benny-avatar.zip'))}))
  }
  if (target === 'https://api.deepseek.com/chat/completions') {
    if (options.headers.Authorization !== 'Bearer fixture-own-deepseek') throw new Error('wrong own key')
    if (globalThis.fixtureRejectText) return new Response('', { status: 401 })
    return Response.json({ choices: [{ message: { content: '自有文字回复' } }] })
  }
  if (target.endsWith('/jwt/client/desktop-auth/token')) return Response.json({ code: 200, data: {
    deviceId: JSON.parse(options.body).deviceId, tenantId: globalThis.fixtureTenant || 'fixture-tenant-a',
    controllerUserId: globalThis.fixtureOwner || 'fixture-user-a', accessToken: 'fixture-jwt', expiresAt: Date.now() + 300000 } })
  if (new URL(target).pathname === '/jwt/client/desktop/roles') return Response.json({ code: 200, data: [] })
  if (new URL(target).pathname === '/jwt/client/desktop/account') return Response.json({ code: 200, data: { score: globalThis.fixtureScore || 0 } })
  if (target.endsWith('/jwt/client/desktop/metered-realtime/sessions')) return globalThis.fixtureRejectSession ? Response.json({ code: 500 }) : Response.json({ code: 200, data: {
    sessionId: 'fixture-platform-session', apiKey: 'fixture-platform-realtime', billingTicket: 'fixture-billing-ticket',
    provider: 'qwen-realtime', modelId: 'qwen-audio-3.0-realtime-flash', wsUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
    voiceId: 'longanlingxi', expiresAt: Date.now() + 600000, credentialExpiresAt: Date.now() + 600000,
    instructions: '线上测试角色', outputSampleRate: 24000, anonymous: false } })
  throw new Error('Non-fixture request blocked')
}
await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/device-main.mjs')).href)})
`)
const env = { ...process.env, PET_DEVICE_USER_DATA: profile, PET_CONTROL_WS_URL: `ws://127.0.0.1:${port}/ws/control` }
delete env.ELECTRON_RUN_AS_NODE
let app, page, pet
async function launch() {
  app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap], env, timeout: 60000 })
  app.process().stderr.on('data', bytes => process.stderr.write(bytes))
  app.process().stdout.on('data', bytes => process.stdout.write(bytes))
  await app.firstWindow()
  await new Promise(resolve => setTimeout(resolve, 800))
  page = app.windows().find(item => item.url().endsWith('/device/device.html'))
  pet = app.windows().find(item => item.url().endsWith('/device/device-pet.html'))
  assert.ok(page && pet)
  for (const window of [page, pet]) window.on('pageerror', error => errors.push(error.message))
  if (env.DEVICE_PUBLIC_AVATAR_FAIL !== '1') await pet.locator('#loading').waitFor({ state: 'hidden', timeout: 60000 })
  if (!['DEVICE_PUBLIC_AVATAR_ONLY', 'DEVICE_MODEL_TEST_ONLY', 'DEVICE_MODEL_PAGE_ONLY', 'DEVICE_ROLE_BILLING_ONLY'].some(key => env[key] === '1')) {
    await app.evaluate(() => globalThis.fixtureSelectLocal())
    await waitForDeviceState(pet, value => value.phase === 'ready' && value.current?.source === 'local')
  }
}
async function say(text) {
  await pet.locator('#chat-text').fill(text); await pet.locator('#chat-send').click()
  await pet.waitForFunction(() => document.querySelector('#chat-send').dataset.busy === 'false')
}
try {
  await launch()
  if (process.env.DEVICE_ROLE_BILLING_ONLY === '1') {
    await verifyRoleBilling({ app, page, pet, bind, messages, say })
    assert.deepEqual(errors, [])
  } else if (process.env.DEVICE_HARNESS_CLIENT_ONLY === '1') {
    await verifyHarnessClient({ app, page, pet, profile, say, errors, artifacts, AxeBuilder, realtimeFixture })
  } else if (process.env.DEVICE_PUBLIC_AVATAR_ONLY === '1') {
    const initial = await pet.evaluate(() => window.controlDevice.state())
    assert.equal(initial.binding, 'unbound')
    assert.equal(initial.current.agentId, 'public-waner')
    assert.equal(initial.current.agentName, '上官婉儿')
    assert.equal(initial.current.publicAvatar, true)
    assert.equal(initial.roles.some(role => role.agentId === 'local-companion'), false)
    assert.equal(await page.locator('#local-role-form').count(), 0)
    assert.equal(await page.evaluate(() => typeof window.controlDevice.configureLocal), 'undefined')
    assert.equal(await pet.locator('#avatar-host iframe').count(), 1)
    await page.evaluate(() => window.controlDevice.configureModels({ platformEnabled: false }))
    await page.locator('.settings-nav[data-section="role-controls"]').click()
    await page.locator('#roles').selectOption('public-other')
    await waitForDeviceState(pet, value => value.current?.agentId === 'public-other')
    await page.evaluate(() => window.dispatchEvent(new Event('open-model-settings')))
    await page.locator('#model-deepseek').fill('fixture-own-deepseek')
    await page.locator('#model-form button[type="submit"]').click()
    await page.waitForFunction(() => !document.querySelector('#model-form button[type="submit"]').disabled)
    const denied = await pet.evaluate(() => window.controlDevice.chat('未扫码不能使用线上角色'))
    assert.equal(denied.code, 'BIND_REQUIRED')
    assert.equal((await pet.evaluate(() => window.controlDevice.state())).history.messages, 0)
    assert.equal(providers, 0)
    assert.equal((await app.evaluate(() => globalThis.fixtureRequests)).some(row => /desktop-auth|desktop\/(sessions|account|roles)$/.test(row.url)), false)
    assert.deepEqual(errors, [])
    await pet.screenshot({ path: path.join(artifacts, 'public-avatar.png'), omitBackground: true })
    await app.close(); app = null
    env.DEVICE_PUBLIC_AVATAR_FAIL = '1'
    await launch()
    await page.locator('#retry').waitFor({ state: 'visible' })
    assert.equal((await pet.evaluate(() => window.controlDevice.state())).current, null)
    assert.equal(await pet.locator('#avatar-host iframe').count(), 0)
    assert.match(await pet.locator('#loading-text').textContent(), /上官婉儿加载失败/)
    await app.evaluate(() => { globalThis.fixtureRejectPublic = false })
    await page.locator('#retry').click()
    await pet.locator('#loading').waitFor({ state: 'hidden', timeout: 60000 })
    assert.equal((await pet.evaluate(() => window.controlDevice.state())).current.agentId, 'public-waner')
    console.log('public avatar Electron: guest display/selection, no local import IPC, failure/retry, own Key cannot bypass online-role login passed')
  } else if (process.env.DEVICE_MODEL_TEST_ONLY === '1') {
    await verifyModelTest({ page, app })
    assert.equal(providers, 1)
    assert.equal(configs[0].voice, 'longanlingxi')
  } else if (process.env.DEVICE_MODEL_PAGE_ONLY === '1') {
    await verifyModelPage({ app, page, pet, root, artifacts, AxeBuilder })
  } else if (process.env.DEVICE_REVIEW_ONLY === '1') {
    await verifyReviewFixes({ app, page, pet, root, bind, rows })
  } else {
  await page.locator('#qr').waitFor({ state: 'visible' })
  assert.equal(messages.some(row => row.type === 'device_online'), true, 'the binding page obtains its QR automatically')
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).current.source, 'local')
  assert.equal(await pet.locator('#avatar-host iframe').count(), 1)
  assert.equal((await pet.evaluate(() => window.controlDevice.configureModels({ source: 'platform' }))).code, 'FORBIDDEN')
  await page.locator('#binding-tab-keys').click()
  await page.locator('#model-deepseek').fill('fixture-own-deepseek')
  await page.locator('#deepseek-remember').check()
  await page.locator('#model-form button[type="submit"]').click()
  await waitForDeviceState(page, value => value.models.route === 'deepseek')
  assert.equal((await page.evaluate(() => window.controlDevice.assistantState())).enabled, true)
  await say('游客第一轮')
  await waitForDeviceState(pet, value => value.history.messages === 2)
  assert.equal((await app.evaluate(() => globalThis.fixtureRequests)).filter(row => row.url === 'https://api.deepseek.com/chat/completions').length, 1)
  await page.locator('#deepseek-test').click()
  await page.waitForFunction(() => document.querySelector('#model-feedback').textContent.includes('DeepSeek 连接正常'))
  assert.equal(providers, 0)
  await page.evaluate(() => window.controlDevice.configureModels({ platformEnabled: true }))
  await page.locator('#binding-tab-scan').click()
  await page.waitForFunction(() => !document.querySelector('#qr').hidden)
  bind()
  await waitForDeviceState(page, value => value.binding === 'bound' && value.history.pending === 0)
  assert.equal(rows.size, 0, 'local history is not claimed when scanning')
  assert.equal(await page.locator('#memo-role option[value="fixture-local-role"]').count(), 0)
  const reminder = await page.evaluate(() => window.controlDevice.desktopAction('memo_create', {
    agentId: 'fixture-local-role', content: '本地提醒不得上传平台',
  }))
  assert.equal(reminder.code, 'LOCAL_ROLE_PRIVATE')
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).models.route, 'deepseek')
  await page.evaluate(() => window.controlDevice.configureModels({ platformEnabled: false }))
  await say('平台断开仍能使用')
  await waitForDeviceState(pet, value => value.history.messages === 4)
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).history.pending, 0)
  await page.evaluate(() => window.controlDevice.configureModels({ source: 'realtime', apiKey: 'fixture-own-realtime',
    remember: true, workspaceId: 'fixture-space' }))
  await waitForDeviceState(pet, value => value.conversationState === 'ready')
  await say('自有语音')
  await waitForDeviceState(pet, value => value.history.messages === 6)
  assert.ok(configs.length > 0); assert.equal(configs[0].tts_filters, undefined)
  assert.equal(messages.some(row => row.type === 'session_register' || row.type === 'session_event'), false)
  assert.equal((await app.evaluate(() => globalThis.fixtureRequests)).some(row => /desktop\/(?:sessions|account)$/.test(row.url)), false)
  const before = providers
  await page.evaluate(() => window.controlDevice.configureModels({ forget: true }))
  await app.evaluate(() => { globalThis.fixtureRejectText = true })
  await say('错误 Key 不切换费用来源')
  assert.equal(providers, before)
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).models.route, 'deepseek')
  await page.screenshot({ path: path.join(artifacts, 'models.png') })
  await pet.screenshot({ path: path.join(artifacts, 'pet.png'), omitBackground: true })
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  assert.deepEqual((await new AxeBuilder({ page }).setLegacyMode().analyze()).violations, [])
  assert.deepEqual(errors, [])
  await app.close(); app = null
  await launch()
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).models.route, 'deepseek')
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).history.messages, 7, 'offline restart retains the archive owner')
  await say('重启后离线账号继续聊天')
  await waitForDeviceState(pet, value => value.history.messages === 9)
  await page.evaluate(() => window.controlDevice.configureModels({ platformEnabled: true }))
  await waitForDeviceState(pet, value => value.binding === 'bound' && value.history.messages === 9 && value.history.pending === 0)
  assert.equal(rows.size, 0, 'local history remains private after restart and reconnect')
  assert.equal(messages.some(row => row.type === 'agent_state_report' && row.agentId === 'fixture-local-role'), false)
  const snapshots = JSON.stringify(await pet.evaluate(() => window.controlDevice.state()))
  assert.doesNotMatch(snapshots, /fixture-own-deepseek|fixture-own-realtime|fixture-jwt/)
  console.log('standalone Electron: local text/audio, no platform history or role upload after scan/restart, IPC isolation, no paid fallback, four widths and axe passed')
  }
} catch (error) {
  console.error(await pet?.evaluate(async () => {
    const { qr, ...value } = await window.controlDevice.state(); return value
  }).catch(() => null), errors, await app?.evaluate(() => globalThis.fixtureProfileEvents).catch(() => []))
  await page?.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await app?.close()
  for (const socket of server.clients) socket.terminate()
  await new Promise(resolve => server.close(resolve))
}
