// Focused runtime check: real main/preload/windows, local control/relay fixtures.
// Avatar download, LAM inference and unrelated host integrations are not under test.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const { WebSocketServer } = require('ws')
const artifacts = path.join(root, 'artifacts', `device-guest-${Date.now()}`)
const profile = path.join(artifacts, 'profile')
await mkdir(profile, { recursive: true })
await writeFile(path.join(profile, 'model-settings.json'), JSON.stringify({ source: 'platform', platformEnabled: true }))
const requests = [], violations = [], relayMessages = [], guestSockets = []
const pairingToken = 'local-guest-fixture-pairing-token', nonce = randomUUID()
const hardwareId = 'c'.repeat(64), registrations = new Map()
let guestScore = 800
let deviceId, control, grants = 0, boundGrants = 0, replies = 0
const server = createServer(async (request, response) => {
  const json = (status, value) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
  try {
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) : null
    const route = new URL(request.url, 'http://localhost').pathname
    requests.push(route)
    if (route.startsWith('/client/desktop-public/guest/')) {
      assert.equal(request.headers.authorization, undefined)
      assert.equal(request.headers.cookie, undefined)
      if (route.endsWith('/identity')) {
        assert.equal(body.deviceId, deviceId); assert.equal(body.hardwareId, hardwareId)
        assert.equal(body.deviceProof, createHmac('sha256', pairingToken).update(`desktop-guest-hardware-v1\n${deviceId}\n${hardwareId}`).digest('hex'))
        registrations.set(createHash('sha256').update(deviceId).digest('hex'), hardwareId)
        return json(200, { code: 0, data: { registered: true } })
      }
      assert.equal(body.deviceId, createHash('sha256').update(deviceId).digest('hex'))
      assert.equal(registrations.get(body.deviceId), hardwareId)
      for (const key of ['tenantId', 'userId', 'voiceId']) assert.equal(body[key], undefined)
      if (route.endsWith('/status')) return json(200, { code: 0, data: { anonymous: true, score: guestScore } })
      assert.equal(route, '/client/desktop-public/guest/sessions'); grants++
      return json(200, { code: 0, data: grant(true) })
    }
    if (route === '/client/desktop-auth/token') {
      assert.equal(body.deviceProof, createHmac('sha256', pairingToken).update(`${deviceId}\n${nonce}`).digest('hex'))
      return json(200, { code: 200, data: { deviceId, tenantId: 'fixture-tenant', controllerUserId: 'fixture-user',
        accessToken: 'fixture-desktop-jwt', expiresAt: Date.now() + 300000 } })
    }
    if (route.startsWith('/client/desktop/')) {
      assert.equal(request.headers.authorization, 'Bearer fixture-desktop-jwt')
      if (route === '/client/desktop/account') return json(200, { code: 200, data: { score: guestScore } })
      if (route === '/client/desktop/metered-realtime/sessions') {
        boundGrants++
        return json(200, { code: 200, data: grant(false) })
      }
      if (route === '/client/desktop/roles') return json(200, { code: 200, data: [] })
    }
    if (route === '/client/desktop-public/roles') return json(200, { code: 200, data: [] })
    violations.push(`Unexpected HTTP route: ${route}`)
    json(404, { code: 404 })
  } catch (error) { violations.push(error.message); json(500, { code: 500 }) }
})
const wss = new WebSocketServer({ server })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
function grant(anonymous) {
  return { provider: 'control-realtime', modelId: 'qwen-audio-3.0-realtime-flash', anonymous,
    speechFilterEnabled: false, sessionId: randomUUID(), relayTicket: 'a'.repeat(64),
    wsUrl: anonymous ? '/ws/control/desktop/guest-realtime' : '/ws/desktop-metered-realtime',
    voiceId: 'longanqian', expiresAt: Date.now() + 60000, outputSampleRate: 24000, instructions: '本机游客验证' }
}
wss.on('connection', (client, request) => {
  const emit = value => { if (client.readyState === 1) client.send(JSON.stringify(value)) }
  const guest = request.url === '/ws/control/desktop/guest-realtime'
  if (guest) guestSockets.push(client)
  if (guest || request.url === '/ws/desktop-metered-realtime') {
    if (request.headers['x-desktop-session'] !== 'a'.repeat(64) || request.headers.authorization) violations.push('Invalid relay credential')
    client.on('message', raw => {
      const message = JSON.parse(raw)
      relayMessages.push(message.type)
      if (message.type === 'session.update') emit({ type: 'session.updated' })
      if (message.type === 'conversation.item.create') emit({ type: 'conversation.item.created', item: message.item })
      if (message.type === 'response.create') {
        if (guest) guestScore -= 120
        const id = `fixture-response-${++replies}`
        emit({ type: 'response.created', response: { id } })
        emit({ type: 'response.text.delta', response_id: id, delta: guest ? '游客本机对话成功' : '绑定后本机对话成功' })
        emit({ type: 'response.done', response: { id, status: 'completed', output: [], usage: { total_tokens: 1000 } } })
      }
    })
    return
  }
  if (request.url !== '/ws/control/desktop') violations.push(`Unexpected WS route: ${request.url}`)
  control = client
  client.on('message', raw => {
    const message = JSON.parse(raw)
    if (message.type === 'device_online') {
      deviceId = message.deviceId
      emit({ type: 'bind_offer', deviceId, bound: false, bindToken: pairingToken, expireAt: Date.now() + 900000 })
    }
    if (message.type === 'ping') emit({ type: 'pong' })
    if (message.type === 'device_history_request') emit({ type: 'device_history', deviceId,
      requestId: message.requestId, agentId: message.agentId, history: [], tenantId: 'fixture-tenant', controllerUserId: 'fixture-user' })
  })
})

const entry = name => pathToFileURL(path.join(root, 'electron', name)).href
const bootstrap = path.join(artifacts, 'bootstrap.cjs')
await writeFile(bootstrap, `const { app, dialog } = require('electron');
const { registerHooks } = require('node:module');
const OriginalSocket = require(${JSON.stringify(require.resolve('ws'))});
globalThis.FixtureSocket = class extends OriginalSocket {
  constructor(url, options) {
    if (!String(url).startsWith(${JSON.stringify(origin.replace('http:', 'ws:') + '/')})) throw new Error('Non-fixture socket blocked');
    super(url, options);
  }
};
const substitutes = {
  './device-hardware-id.mjs': ${JSON.stringify(`export const hardwareFingerprint = async () => '${hardwareId}'`)},
  '../scripts/source-runtime.mjs': 'export const loadSourceRuntime = async () => ({})',
  '../harness-client-plugin/desktop-launch.mjs': 'export const registerDesktop = async () => {}; export const pauseAutomaticLaunch = () => {}',
  './device-lam-engine.mjs': 'export const createLamEngine = async () => ({ reset: async () => {}, dispose: async () => {} })'
};
registerHooks({ resolve(specifier, context, next) {
  const source = specifier === 'ws' && context.conditions.includes('import') ? 'export default globalThis.FixtureSocket' : substitutes[specifier];
  return source ? { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true } : next(specifier, context);
} });
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => String(url).startsWith('http://127.0.0.1:')
  ? originalFetch(url, options) : Promise.reject(new Error('Non-fixture request blocked'));
dialog.showErrorBox = (title, message) => { console.error(title, message); app.exit(1); };
(async () => {
  const { DeviceCodex } = await import(${JSON.stringify(entry('device-codex.mjs'))});
  DeviceCodex.prototype.startAutoConnect = () => {};
  const { HarnessClient } = await import(${JSON.stringify(entry('device-harness-client.mjs'))});
  HarnessClient.prototype.start = async () => {};
  const { WorkBuddyBridge } = await import(${JSON.stringify(entry('device-workbuddy.mjs'))});
  WorkBuddyBridge.prototype.start = async () => {};
  const { DeviceFirstGreeting } = await import(${JSON.stringify(entry('device-first-greeting.mjs'))});
  DeviceFirstGreeting.prototype.schedule = () => {};
  const { DeviceRuntime } = await import(${JSON.stringify(entry('device-runtime.mjs'))});
  DeviceRuntime.prototype.ensureInitialProfile = async function () {
    if (this.state.current) return;
    const current = { agentId: 'guest-role', agentName: '游客测试角色', source: 'online', publicAvatar: true, voiceId: 'longanqian' };
    this.publish({ current, desired: current, roles: [current], phase: 'ready' });
  };
  await import(${JSON.stringify(entry('device-main.mjs'))});
})().catch(error => { console.error(error); app.exit(1); });
`)

const env = { ...process.env, PET_DEVICE_USER_DATA: profile, PET_CONTROL_HTTP_ORIGIN: origin,
  PET_CONTROL_WS_URL: origin.replace('http:', 'ws:') + '/ws/control' }
delete env.ELECTRON_RUN_AS_NODE
const wait = async (predicate, label) => {
  const until = Date.now() + 15000
  while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw new Error(`Timed out: ${label}`)
}
let app, controller, pet
const logs = []
try {
  app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap], env, timeout: 30000 })
  app.process().stderr.on('data', data => logs.push(data.toString()))
  await wait(() => {
    controller = app.windows().find(page => page.url().includes('/device/device.html'))
    pet = app.windows().find(page => page.url().includes('/device/device-pet.html'))
    return controller && pet
  }, 'actual desktop windows')
  const state = () => pet.evaluate(() => window.controlDevice.state())
  await wait(async () => { const s = await state(); return s.guest && s.score === 800 && s.conversationState === 'ready' }, 'hardware guest balance')
  assert.equal(await controller.locator('#account-name').textContent(), '游客试用')
  assert.equal(await controller.locator('#account-points').textContent(), '800')
  await controller.locator('#account-menu > summary').click()
  await controller.screenshot({ path: path.join(artifacts, 'guest-ready.png') })
  await controller.evaluate(() => {
    window.controllerConversation = []
    window.controlDevice.onConversation(event => window.controllerConversation.push(event))
    window.dispatchEvent(new CustomEvent('navigate-settings', { detail: 'characters' }))
    document.querySelector('.character-group[data-kind=public]').open = true
  })
  await controller.locator('.character-row').filter({ hasText: '游客测试角色' }).click()
  await controller.waitForFunction(() => !document.querySelector('#character-message').disabled)
  await pet.evaluate(() => { window.guestEvents = []; window.controlDevice.onConversation(event => window.guestEvents.push(event)) })
  assert.equal((await pet.evaluate(() => window.controlDevice.chat('游客先用'))).ok, true)
  await wait(() => pet.evaluate(() => window.guestEvents.some(event => event.type === 'assistant' && event.text === '游客本机对话成功')), 'guest reply')
  await wait(() => pet.evaluate(() => window.guestEvents.some(event => event.type === 'complete')), 'renderer turn completion')
  assert.equal(guestScore, 680)
  // The same live turn must reach the settings transcript without audio buffers.
  await controller.waitForFunction(() => document.querySelector('#character-chat-history').textContent.includes('游客本机对话成功'))
  assert.equal(await controller.locator('#character-chat-history .character-message').count(), 2, 'Avatar input syncs to text chat without refreshing')
  assert.ok(await controller.evaluate(() => window.controllerConversation.some(row => row.type === 'assistant' && row.agentId === 'guest-role')))
  assert.equal(await controller.evaluate(() => window.controllerConversation.some(row => row.pcm || row.expression)), false, 'Settings receives no audio or expression buffers')
  // A reinstall with the same hardware keeps the remaining trial quota.
  const firstInstall = deviceId
  await app.close()
  const reinstalledProfile = path.join(artifacts, 'reinstalled-profile')
  await mkdir(reinstalledProfile, { recursive: true })
  await writeFile(path.join(reinstalledProfile, 'model-settings.json'), JSON.stringify({ source: 'platform', platformEnabled: true }))
  app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap], env: { ...env, PET_DEVICE_USER_DATA: reinstalledProfile }, timeout: 30000 })
  app.process().stderr.on('data', data => logs.push(data.toString()))
  await wait(() => {
    controller = app.windows().find(page => page.url().includes('/device/device.html'))
    pet = app.windows().find(page => page.url().includes('/device/device-pet.html'))
    return controller && pet
  }, 'reinstalled windows')
  await wait(async () => { const s = await state(); return s.guest && s.score === 680 && s.conversationState === 'ready' }, 'same hardware remaining quota')
  assert.notEqual(deviceId, firstInstall); assert.equal(registrations.size, 2)
  await pet.evaluate(() => { window.guestEvents = []; window.controlDevice.onConversation(event => window.guestEvents.push(event)) })
  // The text composer must send through the same live turn and keep history on reopen.
  await controller.evaluate(() => {
    window.controllerConversation = []
    window.controlDevice.onConversation(event => window.controllerConversation.push(event))
    window.dispatchEvent(new CustomEvent('navigate-settings', { detail: 'characters' }))
    document.querySelector('.character-group[data-kind=public]').open = true
  })
  await controller.locator('.character-row').filter({ hasText: '游客测试角色' }).click()
  await controller.waitForFunction(() => !document.querySelector('#character-message').disabled)
  await controller.locator('#character-message').fill('文字页实时消息')
  await controller.locator('#character-chat-send').click()
  await controller.waitForFunction(() => document.querySelectorAll('#character-chat-history .character-message').length === 4 && !document.querySelector('#character-message').disabled)
  assert.equal(await controller.locator('#character-message').inputValue(), '')
  assert.ok(await pet.evaluate(() => window.guestEvents.some(row => row.type === 'user' && row.text === '文字页实时消息')))
  await controller.locator('.character-row').filter({ hasText: '游客测试角色' }).click()
  await controller.waitForFunction(() => document.querySelectorAll('#character-chat-history .character-message').length === 4)
  assert.equal(guestScore, 560, 'The extra text-page turn is billed like any guest turn')
  const beforeBinding = grants, oldGuest = guestSockets.at(-1)
  control.send(JSON.stringify({ type: 'bind_success', deviceId, tenantId: 'fixture-tenant', controllerUserId: 'fixture-user' }))
  control.send(JSON.stringify({ type: 'device_challenge', deviceId, nonce }))
  await wait(async () => { const s = await state(); return s.binding === 'bound' && !s.guest && s.score === 560 && s.conversationState === 'ready' }, 'switch to bound account')
  await wait(() => oldGuest.readyState === 3, 'guest relay closed after binding')
  assert.equal(grants, beforeBinding, 'Binding must not request another guest grant')
  assert.equal((await pet.evaluate(() => window.controlDevice.chat('绑定后正常对话'))).ok, true)
  await wait(() => pet.evaluate(() => window.guestEvents.some(event => event.type === 'assistant' && event.text === '绑定后本机对话成功')), 'bound reply')
  await wait(() => pet.evaluate(() => window.guestEvents.some(event => event.type === 'complete')), 'renderer turn completion')
  assert.ok(boundGrants > 0)
  assert.ok(!relayMessages.includes('session_event'), 'Desktop must not submit token usage')
  assert.deepEqual(violations, [])
  const report = { passed: true, runtime: 'Electron', guestBalance: 800, guestReply: true, reinstallPreservesQuota: true,
    boundReply: true, bindingSwitch: true, accountBalance: 560, clientTokenReports: false, liveSettingsTranscript: true,
    textComposerCompleted: true, localHistoryOnReopen: true, avatarAndSpeechInferenceTested: false }
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, artifacts }))
} finally {
  if (pet) await pet.evaluate(() => window.controlDevice.state()).then(value => writeFile(path.join(artifacts, 'last-state.json'), JSON.stringify(value, null, 2))).catch(() => {})
  await writeFile(path.join(artifacts, 'stderr.log'), logs.join(''))
  if (app) await app.close()
  for (const client of wss.clients) client.terminate()
  await new Promise(resolve => wss.close(resolve))
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
