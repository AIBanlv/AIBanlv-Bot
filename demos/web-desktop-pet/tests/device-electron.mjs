import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { knownSpeech } from './lam-fixture.mjs'
import { verifyAssistant } from './device-assistant-electron.mjs'
import { verifyCatalog } from './device-catalog-electron.mjs'
import { verifyFirstSend } from './device-first-send-electron.mjs'
import { verifyIdleExpressions } from './device-idle-electron.mjs'
import { verifyControlErrors } from './device-control-errors-electron.mjs'
import { verifyBoundText } from './device-bound-text-electron.mjs'
import { verifyTaskPermissions } from './device-task-permissions-electron.mjs'
import { verifyRemoteCodex } from './device-codex-remote-electron.mjs'
import { showSettings } from './settings-navigation-fixture.mjs'
const require = createRequire(import.meta.url)
const root = process.cwd()
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const { default: AxeBuilder } = require(process.env.AXE_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/@axe-core/playwright'))
const qaModule = name => path.resolve(root, '../../../.codex_tmp/device-qa/node_modules/', name)
const jsQR = require(process.env.JSQR_MODULE || qaModule('jsqr'))
const { PNG } = require(process.env.PNGJS_MODULE || qaModule('pngjs'))
const { Server: WebSocketServer } = require('ws')
const speechPcm = knownSpeech(root).subarray(0, 144000)
const artifacts = path.join(root, 'artifacts/device-electron')
await mkdir(artifacts, { recursive: true })
// A real Chromium capture stream driven by a local WAV, never the user's microphone.
const microphoneWav = path.join(artifacts, 'microphone-fixture.wav')
const wav = Buffer.alloc(44 + 16000 * 12 * 2)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
for (let i = 16000; i < 32000; i++) wav.writeInt16LE(speechPcm.readInt16LE(Math.floor((i - 16000) * 1.5) * 2), 44 + i * 2)
await writeFile(microphoneWav, wav)
const httpServer = createServer()
const ws = new WebSocketServer({ server: httpServer })
await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve))
let socket, deviceId, bound = false
const reports = []
const reportRejections = []
const rejections = []
const billingEvents = [], providerConfigs = [], providerTexts = []
const providerVoices = []
let replyNumber = 0, holdReply = false, replyText = '[微笑]你好[head:[nod]]，很高兴见到你！<img src=x>[]'
let providerCancels = 0
let assistantMode = false
const toolOutputs = []
let pairedIdentity, fixtureNonce
const send = data => {
  if (data.type === 'bind_success' && pairedIdentity &&
      (pairedIdentity.tenantId !== data.tenantId || pairedIdentity.controllerUserId !== data.controllerUserId)) {
    socket.send(JSON.stringify({ type: 'bind_offer', deviceId, bindToken: 'test-server-issued-token',
      bound: false, expireAt: Date.now() + 900000 }))
  }
  socket.send(JSON.stringify({ deviceId, ...data }))
  if (data.type === 'bind_success') {
    pairedIdentity = { tenantId: data.tenantId, controllerUserId: data.controllerUserId }
    fixtureNonce = randomUUID()
    socket.send(JSON.stringify({ type: 'device_challenge', deviceId, nonce: fixtureNonce }))
  }
}
const deviceTokenRequests = []
const fixtureConnections = []
httpServer.on('request', async (request, response) => {
  if (request.url !== '/fixture-device-token') { response.writeHead(404).end(); return }
  let body = ''; for await (const chunk of request) body += chunk
  const value = JSON.parse(body)
  const expected = createHmac('sha256','test-server-issued-token').update(`${deviceId}\n${fixtureNonce}`).digest('hex')
  assert.equal(value.deviceId,deviceId); assert.equal(value.deviceProof,expected)
  deviceTokenRequests.push({ proved: true })
  response.writeHead(200,{ 'Content-Type':'application/json' }).end(JSON.stringify({code:200,data:{
    ...pairedIdentity,deviceId,accessToken:'fixture-device-jwt',expiresAt:Date.now()+300000,
  }}))
})
ws.on('connection', (client, request) => {
  fixtureConnections.push(request.url)
  if (request.url.startsWith('/billing/')) {
    const sessionId = request.url.split('/').at(-1)
    client.on('message', raw => {
      const message = JSON.parse(raw)
      if (message.type === 'session_register') {
        assert.equal(message.billingTicket, 'fixture-billing-ticket')
        assert.match(message.deviceId, /^[a-f0-9]{64}$/)
        client.send(JSON.stringify({ type: 'session_ready', sessionId, role: 'producer' }))
      } else if (message.type === 'session_event') {
        billingEvents.push(message)
        client.send(JSON.stringify({ type: 'event_ack', sessionId, sequence: message.sequence, duplicate: false }))
      } else if (message.type === 'heartbeat') client.send(JSON.stringify({ type: 'pong', sessionId }))
    })
    return
  }
  if (request.url === '/provider') {
    assert.equal(request.headers.authorization, 'Bearer fixture-provider-key')
    let responseId, timer, inputBytes = 0, toolReturned = false
    const emit = value => { if (client.readyState === 1) client.send(JSON.stringify(value)) }
    client.on('message', raw => {
      const message = JSON.parse(raw)
      if (message.type === 'session.update') {
        providerConfigs.push(message.session)
        emit({ type: 'session.updated' })
      } else if (message.type === 'conversation.item.create') {
        if (message.item.id?.startsWith('history-')) {
          emit({ type: 'conversation.item.created', item: message.item }); return
        }
        if (message.item.type === 'function_call_output') { toolOutputs.push(message.item); toolReturned = true }
        else if (message.item.type === 'function_call') { /* Host-routed Harness call; wait for its actual result. */ }
        else { providerTexts.push(message.item.content[0].text); toolReturned = false }
      }
      else if (message.type === 'input_audio_buffer.clear') inputBytes = 0
      else if (message.type === 'input_audio_buffer.append') inputBytes += Buffer.from(message.audio, 'base64').length
      else if (message.type === 'input_audio_buffer.commit') {
        toolReturned = false
        providerVoices.push(inputBytes)
        const itemId = `voice-input-${replyNumber}`
        emit({ type: 'input_audio_buffer.committed', item_id: itemId })
        emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: itemId, transcript: '这是麦克风输入的测试' })
      }
      else if (message.type === 'response.create') {
        responseId = `reply-${++replyNumber}`
        emit({ type: 'response.created', response: { id: responseId } })
        if (assistantMode && !toolReturned) {
          const call = { type: 'function_call', call_id: `computer-${replyNumber}`, name: 'computer_task', arguments: '{"task":"打开测试页面"}' }
          emit({ type: 'response.function_call_arguments.done', response_id: responseId, ...call })
          emit({ type: 'response.output_item.done', response_id: responseId, item: call })
          emit({ type: 'response.done', response: { id: responseId, status: 'completed', output: [call], usage: { total_tokens: 7 } } })
          return
        }
        emit({ type: 'response.audio_transcript.delta', response_id: responseId, delta: '[微' })
        if (holdReply) return
        timer = setTimeout(() => {
          emit({ type: 'response.audio_transcript.delta', response_id: responseId, delta: '笑]你好[head:' })
          emit({ type: 'response.audio_transcript.delta', response_id: responseId, delta: '[nod]]，' })
          for (let i = 0; i < 6; i++) emit({ type: 'response.audio.delta', response_id: responseId,
            delta: speechPcm.subarray(i * 24000, (i + 1) * 24000).toString('base64') })
          emit({ type: 'response.audio_transcript.done', response_id: responseId, transcript: replyText })
          emit({ type: 'response.done', response: { id: responseId, status: 'completed', usage: { total_tokens: 42 } } })
        }, 120)
      } else if (message.type === 'response.cancel') {
        providerCancels++
        clearTimeout(timer)
        emit({ type: 'response.done', response: { id: responseId, status: 'cancelled' } })
      }
    })
    client.on('close', () => clearTimeout(timer))
    return
  }
  client.on('message', raw => {
    const message = JSON.parse(raw)
    assert.notEqual(message.type, 'controller_online', 'Desktop must not open an account controller connection')
    assert.notEqual(message.type, 'bind_request', 'Only the phone may initiate QR binding')
    if (message.type === 'device_online') {
      socket = client
      deviceId = message.deviceId
      if (bound) send({ type: 'bind_success', controllerUserId: 'test-user', tenantId: 'test-tenant' })
      else send({ type: 'bind_offer', bindToken: 'test-server-issued-token', bound: false, expireAt: Date.now() + 900000 })
    }
    if (message.type === 'device_history_request') {
      send({ type: 'device_history', requestId: message.requestId, agentId: message.agentId,
        tenantId: 'test-tenant', controllerUserId: 'test-user', history: [] })
    }
    if (message.type === 'agent_state_report') {
      // Match MybatisControlStateStore.validApplyStatus instead of accepting any status.
      if (!['unknown', 'applied', 'failed'].includes(message.applyStatus)) {
        reportRejections.push({ agentId: message.agentId, applyStatus: message.applyStatus })
        send({ type: 'error', code: 'INVALID_AGENT_STATE', message: 'invalid applyStatus' })
      } else reports.push(message)
    }
    if (message.type === 'error') rejections.push(message)
    if (message.type === 'ping') send({ type: 'pong' })
  })
})
const env = { ...process.env, PET_DEVICE_USER_DATA: path.join(artifacts, `profile-${Date.now()}`),
  PET_CONTROL_WS_URL: `ws://127.0.0.1:${httpServer.address().port}/ws/control` }
await mkdir(env.PET_DEVICE_USER_DATA, { recursive: true })
await writeFile(path.join(env.PET_DEVICE_USER_DATA, 'model-settings.json'), JSON.stringify({ source: 'platform', platformEnabled: true }))
delete env.ELECTRON_RUN_AS_NODE
if (process.env.DEVICE_EXECUTABLE) {
  env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`
  for (const key of ['PYTHONHOME', 'PYTHONPATH', 'JAVA_HOME', 'GSON_JAR']) delete env[key]
  for (const key of ['PET_PYTHON', 'PET_LAM_SOURCE', 'JAVA', 'JAVAC', 'GRADLE_USER_HOME']) {
    env[key] = path.join(artifacts, 'missing-developer-dependency')
  }
}
const launch = process.env.DEVICE_EXECUTABLE
  ? { executablePath: process.env.DEVICE_EXECUTABLE, args: [] }
  : { executablePath: require('electron'), args: [path.join(root, 'electron/device-main.mjs')] }
if (!process.env.DEVICE_EXECUTABLE) {
  const bootstrap = path.join(artifacts, 'fixture-bootstrap.mjs')
  await writeFile(bootstrap, `import { createRequire, registerHooks } from 'node:module'
const require = createRequire(import.meta.url)
const wsEntry = require.resolve('ws', { paths: [${JSON.stringify(root)}] })
const OriginalSocket = require(wsEntry)
class FixtureSocket extends OriginalSocket {
  constructor(url, options) {
    let target = String(url)
    if (target.startsWith('wss://dashscope.aliyuncs.com/api-ws/v1/realtime?')) target = 'ws://127.0.0.1:${httpServer.address().port}/provider'
    else if (target.startsWith('wss://scrm.ieasysell.com/ws/digital-human-session/')) target = 'ws://127.0.0.1:${httpServer.address().port}/billing/' + new URL(target).pathname.split('/').at(-1)
    else if (!target.startsWith('ws://127.0.0.1:${httpServer.address().port}/')) throw new Error('Non-fixture socket blocked')
    super(target, options)
  }
}
globalThis.WebSocket = FixtureSocket
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'ws' && context.conditions.includes('import')
    ? { url: 'data:text/javascript,export default globalThis.WebSocket', shortCircuit: true }
    : nextResolve(specifier, context)
} })
const original = globalThis.fetch
globalThis.fetch = (url, options) => String(url).startsWith('http://127.0.0.1:')
  ? original(url, options) : Promise.reject(new Error('Non-fixture request blocked at startup'))
${process.env.DEVICE_TASK_PERMISSIONS_ONLY === '1' ? `
const { DeviceCodex } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/device-codex.mjs')).href)})
DeviceCodex.prototype.startAutoConnect = function () { globalThis.permissionCodex = this }
const { HarnessClient } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/device-harness-client.mjs')).href)})
const startClient = HarnessClient.prototype.start
HarnessClient.prototype.start = function (...args) { globalThis.permissionHarness = this; return startClient.apply(this, args) }
const { DeviceChannel } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/device-channel.mjs')).href)})
const channelStart = DeviceChannel.prototype.start
DeviceChannel.prototype.start = function (...args) { globalThis.permissionChannel = this; return channelStart.apply(this, args) }
const { DeviceConversation } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/device-conversation.mjs')).href)})
const setContext = DeviceConversation.prototype.setContext
DeviceConversation.prototype.setContext = function (...args) { globalThis.permissionConversation = this; return setContext.apply(this, args) }
const { HarnessTaskDispatcher } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/device-task-dispatcher.mjs')).href)})
const loadDispatcher = HarnessTaskDispatcher.prototype.load
HarnessTaskDispatcher.prototype.load = function (...args) { globalThis.permissionDispatcher = this; return loadDispatcher.apply(this, args) }
const { DeviceRemoteReplies } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/device-remote-replies.mjs')).href)})
const submitReply = DeviceRemoteReplies.prototype.submit
DeviceRemoteReplies.prototype.submit = function (...args) { globalThis.permissionReplies = this; return submitReply.apply(this, args) }
` : ''}
await import(${JSON.stringify(pathToFileURL(process.env.DEVICE_MAIN_ENTRY || path.join(root, 'electron/device-main.mjs')).href)})
`)
  launch.args = [bootstrap]
}
launch.args.unshift('--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${microphoneWav}`)
let app, page, pet, appClosed = false
const errors = []
const warnings = [], external = []
const report = { protocolFixture: true, cloudSpeechTested: false, viewports: [] }
let reportCursor = 0
async function waitConnected() {
  const deadline = Date.now() + 15000
  while ((await pet.evaluate(() => window.controlDevice.state())).conversationState !== 'ready') {
    assert.ok(Date.now() < deadline, 'Background conversation must become ready')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
async function waitApplied(id) {
  const deadline = Date.now() + 60000
  while (!reports.slice(reportCursor).some(item => item.agentId === id && item.applyStatus === 'applied')) {
    assert.deepEqual(reportRejections, [], 'Agent state reports must satisfy the server contract')
    assert.ok(Date.now() < deadline, `No new applied report for ${id}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.deepEqual(reportRejections, [], 'Agent state reports must satisfy the server contract')
  report.agentState = { statuses: [...new Set(reports.map(item => item.applyStatus))], rejected: reportRejections.length }
  reportCursor = reports.length
  await page.waitForFunction(id => document.querySelector('#role-name').textContent === id, id, { timeout: 60000 })
}
async function pixels() {
  const avatar = pet.frames().find(frame => frame.url().includes('/avatar.html'))
  return avatar.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
    const gl = document.querySelector('canvas').getContext('webgl2')
    const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data)
    let visible = 0, transparent = 0, hash = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 10) visible++; else transparent++
      hash = (hash * 31 + data[i] + data[i + 1] + data[i + 2]) >>> 0
    }
    resolve({ visible, transparent, hash, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight })
  })))
}
async function particlePixels() {
  return pet.evaluate(() => {
    const canvas = document.querySelector('#device-particles')
    const sample = document.createElement('canvas')
    sample.width = canvas.width; sample.height = canvas.height
    const context = sample.getContext('2d', { willReadFrequently: true })
    context.drawImage(canvas, 0, 0)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let visible = 0, top = 0, hash = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]) { visible++; if (i / 4 < canvas.width * canvas.height * 0.5) top++ }
      hash = (hash * 31 + data[i + 3]) >>> 0
    }
    return { visible, top, hash, hidden: canvas.hidden }
  })
}
async function assertParticleLayout() {
  const handle = await pet.waitForFunction(() => {
    const figure = document.querySelector('#avatar-host').getBoundingClientRect()
    const particles = document.querySelector('#device-particles')
    if (particles.hidden || particles.dataset.anchored !== 'true' || !particles.dataset.edge) return false
    const bounds = particles.getBoundingClientRect()
    const composer = document.querySelector('#chat-form').getBoundingClientRect()
    const sample = document.createElement('canvas')
    sample.width = particles.width; sample.height = particles.height
    const reader = sample.getContext('2d', { willReadFrequently: true })
    const edge = JSON.parse(particles.dataset.edge)
    const bottoms = edge.bottoms.map(value => value === null ? null : figure.top - bounds.top + value * figure.height)
    reader.drawImage(particles, 0, 0)
    const data = reader.getImageData(0, 0, sample.width, sample.height).data
    let nearest = Infinity, overlap = 0, visible = 0
    for (let y = 0; y < sample.height; y++) for (let x = 0; x < sample.width; x++) {
      if (data[(y * sample.width + x) * 4 + 3] < 3) continue
      const bottom = bottoms[Math.min(95, Math.floor(x / sample.width * 96))]
      if (bottom === null) continue
      const gap = y / sample.height * bounds.height - bottom
      nearest = Math.min(nearest, Math.abs(gap))
      visible++; if (gap < -5) overlap++
    }
    if (!visible || nearest > 12 || overlap / visible >= 0.08) return false
    return { nearest, overlap: overlap / visible, visible, particleBottom: bounds.bottom,
      composerTop: composer.top, composerBottom: composer.bottom, figureBottom: figure.bottom }
  })
  const layout = await handle.jsonValue()
  await handle.dispose()
  assert.ok(layout.visible > 0 && layout.nearest <= 12, `Particles must touch the visible lower silhouette: ${JSON.stringify(layout)}`)
  assert.ok(layout.overlap < 0.08, `Particles must emerge below the figure: ${JSON.stringify(layout)}`)
  assert.ok(layout.particleBottom > layout.composerTop && Math.abs(layout.particleBottom - layout.composerBottom) <= 1,
    'Particles reach the window bottom behind the composer')
}
try {
  app = await _electron.launch({ ...launch, env, timeout: 60000 })
  if (process.env.DEVICE_EXECUTABLE) {
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true)
    report.packagedWithDeveloperDependenciesDisabled = true
  }
  await app.firstWindow()
  const windowDeadline = Date.now() + 5000
  while ((app.windows().length !== 2 || app.windows().some(window => !window.url().includes('/device/'))) &&
      Date.now() < windowDeadline) await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(app.windows().length, 2, 'Device edition must keep controller and transparent pet windows')
  page = app.windows().find(window => window.url().endsWith('/device/device.html'))
  pet = app.windows().find(window => window.url().endsWith('/device/device-pet.html'))
  assert.ok(page && pet)
  if (process.env.DEVICE_TASK_PERMISSIONS_ONLY === '1') {
    // Permissions need the real main-process wiring and native dialogs, but no
    // avatar, inference, account or paid model session.
    report.permissions = await verifyTaskPermissions({ app, root })
    report.remoteCodex = await verifyRemoteCodex({ app })
    assert.equal(providerConfigs.length, 0)
    const closed = app.waitForEvent('close', { timeout: 10000 })
    await app.evaluate(({ app }) => app.quit()); await closed; appClosed = true
    await writeFile(path.join(artifacts, 'permissions-results.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } else {
  // Only the exact fixture asset is substituted. Production has no test bypass.
  const asset = await readFile(process.env.DEVICE_AVATAR_ZIP || path.resolve(root, '../../../android-framework-new/photo/benny-avatar.zip'))
  await app.evaluate((_electron, { base64, fixturePort }) => {
    const bytes = Buffer.from(base64, 'base64')
    const original = globalThis.fetch
    const Socket = globalThis.WebSocket
    globalThis.WebSocket = class extends Socket {
      constructor(url, options) {
        const value = String(url)
        if (value.startsWith('wss://dashscope.aliyuncs.com/api-ws/v1/realtime?')) super(`ws://127.0.0.1:${fixturePort}/provider`, options)
        else if (value.startsWith('wss://scrm.ieasysell.com/ws/digital-human-session/')) {
          super(`ws://127.0.0.1:${fixturePort}/billing/${new URL(value).pathname.split('/').at(-1)}`, options)
        } else if (value.startsWith(`ws://127.0.0.1:${fixturePort}/`)) super(url, options)
        else throw new Error('Non-fixture socket blocked')
      }
    }
    globalThis.bootstrapRequests = []
    globalThis.voiceMetadataRequests = []
    globalThis.catalogRequests = []
    globalThis.deviceJwtRequests = []
    globalThis.catalogMode = 'normal'
    globalThis.removedAuthRequests = 0
    globalThis.failNextSession = false
    const fixtureUrls = ['https://qn.ieasysell.com/device-fixture-a.zip', 'https://qn.ieasysell.com/device-fixture-b.zip',
      'https://qn.ieasysell.com/device-fixture-retry.zip']
    globalThis.fetch = (url, options) => {
      const wire = new URL(String(url))
      if (wire.pathname === '/jwt/client/desktop-auth/token') {
        return original(`http://127.0.0.1:${fixturePort}/fixture-device-token`,options)
      }
      if (wire.pathname.startsWith('/jwt/client/desktop/')) {
        if (new Headers(options.headers).get('Authorization') !== 'Bearer fixture-device-jwt') throw new Error('Missing device JWT')
        globalThis.deviceJwtRequests.push(wire.pathname)
        const aliases = { roles:'/jwt/client/aliBot/getBotListTWithPublic',voices:'/jwt/client/Voice/aliyun/listClientVoices',
          sessions:'/jwt/client/desktop/metered-realtime/sessions',account:'/jwt/client/reception/getReception' }
        wire.pathname=aliases[wire.pathname.split('/').at(-1)] || '/unknown'
        url=wire.href
      }
      if (wire.pathname === '/jwt/client/desktop-public/voices') {
        wire.pathname='/jwt/client/Voice/aliyun/listClientVoices';url=wire.href
      }
      const registrationUrl = new URL(String(url))
      if (registrationUrl.pathname.startsWith('/jwt/client/digital-human/anonymous/') ||
          registrationUrl.pathname.startsWith('/jwt/client/website-auth/') || registrationUrl.pathname === '/new/oauth/token') {
        globalThis.removedAuthRequests++
        throw new Error('Removed desktop account/guest endpoint requested')
      }
      if (registrationUrl.pathname === '/jwt/client/reception/getReception') {
        return Promise.resolve(Response.json({ code: 200, data: { score: globalThis.fixtureScore ?? 1200 } }))
      }
      if (String(url).startsWith('https://scrm.ieasysell.com/jwt/client/aliBot/getBotListTWithPublic?') &&
          new URL(url).searchParams.get('tenantId') !== '1') {
        const tenantId = new URL(url).searchParams.get('tenantId')
        globalThis.catalogRequests.push({ tenantId, method: options.method })
        if (globalThis.catalogMode === 'error') return Promise.resolve(Response.json({ code: 403, data: [] }))
        const role = (id, scope = tenantId, userId = 'test-user') => ({ id, name: id, tenantId: scope,
          userId, digitalHumanId: `model-${id}`, voiceId: 'longanqian', zipUrl: fixtureUrls[0] })
        return Promise.resolve(Response.json({ code: 200, data: globalThis.catalogMode === 'empty' ? []
          : tenantId === 'test-tenant' ? [role('catalog-private-a'), role('catalog-shared', tenantId, null),
            role('catalog-public', '1', null), role('catalog-other-user', tenantId, 'another-user'),
            role('catalog-other-tenant', 'another-tenant')]
          : [role('catalog-private-b', tenantId, 'second-user'), role('catalog-leaked-a', 'test-tenant')] }))
      }
      if (String(url) === 'https://scrm.ieasysell.com/jwt/client/desktop-public/roles' ||
          String(url) === 'https://scrm.ieasysell.com/jwt/client/aliBot/getBotListTWithPublic?tenantId=1') {
        return Promise.resolve(Response.json({ data: [{ id: 'waner', name: 'waner', tenantId: '1',
          digitalHumanId: 'waner-model', zipUrl: fixtureUrls[0], voiceId: 'longanlingxi' }] }))
      }
      if (String(url) === 'https://scrm.ieasysell.com/jwt/client/Voice/aliyun/listClientVoices') {
        const {tenantId, pageIndex, pageSize} = JSON.parse(options.body)
        if (options.method !== 'POST' || pageIndex !== 0 || pageSize !== 100) throw new Error('Invalid voice list contract')
        globalThis.voiceMetadataRequests.push({ tenantId, method: options.method })
        const data = tenantId === 'test-tenant' ? [
          { id: 'cosy-row-a', elevenId: 'cosyvoice-v3.5-flash-fixture-a',
            voiceName: 'Fixture A · CosyVoice', tenantId, azureLanguage: 'cosyvoice-v3.5-flash' },
          { id: 'realtime-row-a', elevenId: 'qwen-audio-3.0-realtime-flash-fixture-a',
            voiceName: 'Fixture A · Realtime', tenantId, azureLanguage: 'qwen-audio-3.0-realtime-flash' },
        ] : []
        return Promise.resolve(new Response(JSON.stringify({ code: 200, data: {localVoices:data} })))
      }
      if (String(url) === 'https://scrm.ieasysell.com/jwt/client/desktop/metered-realtime/sessions') {
        const request = JSON.parse(options.body)
        if (request.outputMode !== 'audio') return Promise.reject(new Error('Expected audio billing mode'))
        globalThis.bootstrapRequests.push(request)
        if (globalThis.failNextSession) {
          globalThis.failNextSession = false
          return Promise.resolve(new Response(JSON.stringify({ code: 503 }), { status: 503 }))
        }
        return Promise.resolve(new Response(JSON.stringify({ code: 0, data: {
          sessionId: `fixture-${globalThis.bootstrapRequests.length}`, apiKey: 'fixture-provider-key',
          billingTicket: 'fixture-billing-ticket', provider: 'qwen-realtime', modelId: 'qwen-audio-3.0-realtime-flash',
          wsUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime', workspaceId: 'fixture',
          voiceId: request.voiceId === 'realtime-row-a' ? 'qwen-audio-3.0-realtime-flash-fixture-a' : request.voiceId,
          expiresAt: Date.now() + 600000, credentialExpiresAt: Date.now() + 600000,
          outputSampleRate: 24000, instructions: 'Fixture character', anonymous: false,
        } })))
      }
      if (String(url) === fixtureUrls[2] && globalThis.failNextAvatar) {
        globalThis.failNextAvatar = false
        return Promise.reject(new Error('fixture download failure'))
      }
      return fixtureUrls.includes(String(url))
        ? Promise.resolve(new Response(bytes, { headers: { 'content-length': String(bytes.length) } }))
        : String(url).startsWith('http://127.0.0.1:') ? original(url, options) : Promise.reject(new Error('Non-fixture request blocked'))
    }
  }, { base64: asset.toString('base64'), fixturePort: httpServer.address().port })
  assert.equal(await page.locator('#preview-text, #action-play, #action-stop, #action-tag, #action-status, #captions').count(), 0,
    'The production controller must not expose text/action debug controls')
  assert.equal(await page.evaluate(() => typeof window.desktopPet.relay), 'undefined')
  assert.equal(await page.title(), 'AIBanlv - 桌面伴侣设置')
  assert.equal(await pet.title(), 'AIBanlv - 桌面伴侣')
  assert.equal(await page.locator('h1').textContent(), '设备绑定')
  assert.equal(await app.evaluate(({ app }) => app.getName()), 'AIBanlv')
  assert.equal(await page.evaluate(async () => (await fetch('/desktop/controller.mjs')).status), 404)
  await page.waitForFunction(() => document.querySelector('.sidebar-brand img').naturalWidth === 192)
  report.branding = { name: 'AIBanlv', title: '桌面伴侣', aiLogo: true, noDebugControls: true }
  await page.waitForFunction(() => !document.querySelector('#qr').hidden)
  assert.equal(await pet.locator('#reset').count(), 0, 'Pet toolbar no longer has a reset-position button')
  assert.equal(await pet.locator('.pet-toolbar').count(), 0, 'The toolbar is replaced by the composer header')
  assert.equal(await pet.locator('#chat-toggle').count(), 0, 'The composer cannot be collapsed any more')
  assert.equal(await pet.locator('#controller').getAttribute('aria-label'), '打开设置')
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/device/device-pet.html'))
    globalThis.taskbarRequests = []
    const original = win.setSkipTaskbar
    win.setSkipTaskbar = function (skip) {
      globalThis.taskbarRequests.push(skip)
      return original.call(this, skip)
    }
  })
  await showSettings(page, 'window-settings')
  await page.locator('#visible').uncheck()
  await app.evaluate(() => { globalThis.taskbarRequests = [] })
  await page.locator('#visible').check()
  const taskbarRequests = await app.evaluate(() => globalThis.taskbarRequests)
  assert.ok(taskbarRequests.length > 0 && taskbarRequests.every(skip => skip === false),
    'Showing the pet must register its native taskbar entry')
  const captureWindow = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/device/device-pet.html'))
    return { handle: win.getNativeWindowHandle().readBigUInt64LE().toString(),
      title: win.getTitle(), protected: win.isContentProtected() }
  })
  const captureState = JSON.parse(execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'tests/device-window-state.ps1'), '-Handle', captureWindow.handle],
    { windowsHide: true, encoding: 'utf8', timeout: 15000 }))
  assert.equal(captureWindow.title, 'AIBanlv - 桌面伴侣')
  assert.equal(captureWindow.protected, false)
  assert.equal(captureState.toolWindow, false, 'OBS excludes WS_EX_TOOLWINDOW windows')
  assert.ok(captureState.visible && !captureState.minimized && !captureState.cloaked &&
    !captureState.childWindow && captureState.width > 0 && captureState.height > 0)
  report.captureWindow = { title: captureWindow.title, protected: captureWindow.protected,
    taskbarRegisteredOnShow: true, ...captureState }
  for (const window of [page, pet]) {
    window.on('pageerror', error => errors.push(error.message))
    window.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
      if (message.type() === 'warning') warnings.push(message.text())
    })
    window.on('request', request => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url())
    })
  }
  await showSettings(page, 'binding')
  await page.waitForFunction(() => !document.querySelector('#qr').hidden)
  const source = await page.locator('#qr').getAttribute('src')
  const png = PNG.sync.read(Buffer.from(source.split(',')[1], 'base64'))
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
  assert.ok(decoded)
  const qr = new URL(decoded.data)
  assert.equal(qr.searchParams.get('deviceCode'), deviceId)
  assert.equal(new URLSearchParams(qr.hash.slice(1)).get('bindToken'), 'test-server-issued-token')
  assert.equal(qr.origin, 'https://aibanlv.ai')
  report.qrDecoded = true
  assert.equal(await page.locator('#avatar-host iframe').count(), 0)
  const unboundState = await pet.evaluate(() => window.controlDevice.state())
  assert.equal(unboundState.models.source, 'platform')
  assert.equal(unboundState.current.local, true, 'Unbound desktop may display its local role')
  assert.equal(await pet.locator('#avatar-host iframe').count(), 1)
  assert.equal(await pet.locator('#chat-text').isDisabled(), false)
  assert.equal((await pet.evaluate(() => window.controlDevice.chat('bypass scan'))).code, 'BIND_REQUIRED')
  assert.equal(await pet.evaluate(() => window.controlDevice.microphone(true)), false)
  for (const renderer of [page, pet]) assert.deepEqual(await renderer.evaluate(() =>
    ['login', 'register', 'sendRegistrationCode', 'cancelLogin'].map(name => typeof window.controlDevice[name])),
  ['undefined', 'undefined', 'undefined', 'undefined'])
  assert.equal(await page.locator('#mode-login, #login-form, #registration-fields').count(), 0)
  assert.equal(deviceTokenRequests.length, 0, 'Unbound desktops must never exchange an account JWT')
  assert.equal(await app.evaluate(() => globalThis.bootstrapRequests.length), 0)
  assert.equal(await app.evaluate(() => globalThis.deviceJwtRequests.length), 0)
  assert.equal(await app.evaluate(() => globalThis.removedAuthRequests), 0)
  report.scanOnly = { noCredentialUi: true, noCredentialBridge: true, unboundInputBlocked: true, noUnboundSession: true }
  if (process.env.DEVICE_JWT_ONLY === '1') {
    bound=true
    send({type:'bind_success',controllerUserId:'test-user',tenantId:'test-tenant'})
    await page.waitForFunction(() => document.querySelector('#roles option[value="catalog-private-a"]'))
    send({type:'apply_agent_config',agentId:'JWT Role',agentName:'JWT Role',
      zipUrl:'https://qn.ieasysell.com/device-fixture-a.zip',voiceId:'cosyvoice-v3.5-flash-fixture-a',profileVersion:1})
    await waitApplied('JWT Role')
    await page.waitForFunction(() => globalThis.controlDevice.state().then(state => state.score === 1200))
    await app.evaluate(() => new Promise((resolve,reject) => {
      const deadline=Date.now()+10000
      const poll=()=>globalThis.deviceJwtRequests.includes('/jwt/client/desktop/metered-realtime/sessions') ? resolve()
        : Date.now()>deadline ? reject(new Error('Authenticated session request was not sent')) : setTimeout(poll,25)
      poll()
    }))
    const privatePaths=await app.evaluate(()=>[...new Set(globalThis.deviceJwtRequests)])
    for(const operation of ['roles','voices','metered-realtime/sessions','account']) assert.ok(privatePaths.includes(`/jwt/client/desktop/${operation}`))
    const snapshots=JSON.stringify(await pet.evaluate(()=>window.controlDevice.state()))
    assert.doesNotMatch(snapshots,/fixture-device-jwt|deviceProof|accessToken/)
    assert.ok(deviceTokenRequests.length>0)
    const previous=deviceTokenRequests.length
    socket.close()
    await page.waitForFunction(async()=> (await window.controlDevice.state()).connection!=='connected')
    await page.waitForFunction(async()=> (await window.controlDevice.state()).connection==='connected')
    await page.waitForFunction(()=> document.querySelector('#roles option[value="catalog-private-a"]'))
    assert.ok(deviceTokenRequests.length>previous,'Reconnected device must obtain a fresh JWT')
    bound=false;send({type:'bind_lost'})
    await page.waitForFunction(()=>!document.querySelector('#qr').hidden)
    const afterUnbind=deviceTokenRequests.length
    await page.evaluate(()=>window.controlDevice.refreshCatalog())
    await page.waitForTimeout(100)
    assert.equal(deviceTokenRequests.length,afterUnbind)
    assert.equal((await pet.evaluate(()=>window.controlDevice.state())).models.source,'platform')
    assert.equal((await pet.evaluate(()=>window.controlDevice.state())).current.local,true)
    assert.equal(await pet.locator('#chat-text').isDisabled(),false)
    assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);assert.deepEqual(external,[])
    report.scanJwt={pairingProof:true,privatePaths,credentialsIsolated:true,reconnectRenews:true,unbindClears:true,productionRequests:0}
    const closed=app.waitForEvent('close',{timeout:10000})
    await app.evaluate(({app})=>app.quit());await closed;appClosed=true
    await writeFile(path.join(artifacts,'scan-jwt-results.json'),JSON.stringify(report,null,2))
    console.log(JSON.stringify(report,null,2))
  } else {
  const uri = new URL(page.url())
  assert.equal((await fetch(page.url())).status, 403)
  const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => win.webContents.getLastWebPreferences()))
  for (const item of preferences) {
    assert.equal(item.sandbox, true)
    assert.equal(item.contextIsolation, true)
    assert.equal(item.nodeIntegration, false)
  }
  assert.equal((await fetch(pet.url())).status, 403)
  assert.equal(await page.evaluate(async () => (await window.controlDevice.chat('not a pet')).code), 'FORBIDDEN')
  report.controlErrors = await verifyControlErrors({ app, page, artifacts, send })
  await page.screenshot({ path: path.join(artifacts, 'binding.png') })
  report.boundText = await verifyBoundText({ app, page, pet, billingEvents, providerTexts, send, waitApplied,
    setBound: value => { bound = value } })
  await writeFile(path.join(artifacts, 'bound-text-results.json'), JSON.stringify(report.boundText, null, 2))
  await pet.evaluate(() => {
    const Context = window.AudioContext
    window.fixtureAudioSources = []; window.fixtureAudioGains = []
    window.AudioContext = class extends Context {
      constructor(options) { super(options); window.fixtureAudioContext = this }
      createBufferSource() { const source = super.createBufferSource(); window.fixtureAudioSources.push(source); return source }
      createGain() { const gain = super.createGain(); window.fixtureAudioGains.push(gain); return gain }
    }
  })
  send({ type: 'switch_avatar', agentId: 'unbound', zipUrl: 'https://qn.ieasysell.com/device-fixture-a.zip' })
  await page.waitForTimeout(100)
  assert.notEqual((await pet.evaluate(() => window.controlDevice.state())).current?.agentId, 'unbound')
  bound = true
  send({ type: 'bind_success', controllerUserId: 'test-user', tenantId: 'test-tenant' })
  const previousRole = { type: 'agent_state_desired', agentId: 'Previous Role', agentName: 'Previous Role',
    zipUrl: 'https://qn.ieasysell.com/device-fixture-b.zip', voiceId: 'longanqian', profileVersion: 10 }
  send(previousRole)
  await waitApplied('waner')
  await waitConnected()
  send(previousRole)
  await pet.waitForTimeout(100)
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).current.agentId, 'waner')
  assert.equal(reports.some(item => item.agentId === previousRole.agentId), false,
    'Old desired-state snapshots must not load or replace the startup avatar')
  assert.equal(await page.locator('#roles').inputValue(), 'waner')
  report.startupDefaultOverridesReplay = true
  assert.equal(providerTexts.length, 0, 'Startup preconnection must not send a message')
  assert.equal(billingEvents.some(item => item.eventType === 'usage'), false)
  assert.ok(providerConfigs.length > 0, 'Provider handshake must precede the first message')
  report.startupPreconnection = true
  await pet.waitForTimeout(1000) // Allow the renderer's progressive first frame to settle for visual inspection.
  assert.ok((await pixels()).visible > 100, 'Default waner must produce real visible pixels')
  report.firstBindingDefaultWithoutReapply = true
  await pet.screenshot({ path: path.join(artifacts, 'first-binding-waner.png'), omitBackground: true })
  const roleA = { type: 'apply_agent_config', agentId: 'Role A', agentName: 'Role A',
    zipUrl: 'https://qn.ieasysell.com/device-fixture-a.zip', voiceId: 'cosyvoice-v3.5-flash-fixture-a', profileVersion: 1 }
  send(roleA)
  await waitApplied('Role A')
  if (process.env.DEVICE_INITIAL_ONLY === '1') {
    assert.equal(await page.locator('#role-name').textContent(), 'Role A')
    assert.equal(providerTexts.length, 0, 'Default display and switching must not send messages')
    bound = false
    send({ type: 'bind_lost' })
    await page.waitForFunction(() => !document.querySelector('#qr').hidden)
    await pet.waitForFunction(async () => {
      const state = await window.controlDevice.state()
      return state.current?.local === true && state.binding === 'unbound'
    })
    await pet.locator('#avatar-host iframe').waitFor({ state: 'attached' })
    assert.equal(await pet.locator('#chat-text').isDisabled(), false)
    bound = true
    send({ type: 'bind_success', controllerUserId: 'test-user', tenantId: 'test-tenant' })
    await waitApplied('waner')
    await waitConnected()
    await pet.waitForTimeout(1000)
    assert.ok((await pixels()).visible > 500)
    await pet.screenshot({ path: path.join(artifacts, 'first-binding-waner.png'), omitBackground: true })
    assert.deepEqual(errors, [])
    assert.deepEqual(warnings, [])
    assert.deepEqual(external, [])
    const closed = app.waitForEvent('close', { timeout: 10000 })
    await app.evaluate(({ app }) => app.quit()); await closed; appClosed = true
    assert.deepEqual((await readdir(env.PET_DEVICE_USER_DATA)).filter(name => name.startsWith('avatars-')), [])
    report.initialAvatar = { defaultWithoutReapply: true, startupReplayIgnored: true, explicitSelectionWins: true,
      unbindRequiresScan: true, unboundInputBlocked: true, rebindLoadsDefault: true,
      rebindPreconnects: true, noAutomaticResponse: true, exitCleansAssets: true }
    await writeFile(path.join(artifacts, 'initial-avatar-results.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } else if (process.env.DEVICE_IDLE_ONLY === '1') {
    report.idleExpressions = await verifyIdleExpressions({ app, page, pet, artifacts, pixels, roleA, send,
      waitApplied, providerTexts, billingEvents, setBound: value => { bound = value } })
    assert.deepEqual(errors, []); assert.deepEqual(warnings, []); assert.deepEqual(external, [])
    const closed = app.waitForEvent('close', { timeout: 10000 })
    await app.evaluate(({ app }) => app.quit()); await closed; appClosed = true
    await writeFile(path.join(artifacts, 'idle-results.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } else if (process.env.DEVICE_LATENCY_ONLY === '1') {
    report.firstSend = await verifyFirstSend({ page, pet, artifacts, providerTexts, billingEvents,
      send, setBound: value => { bound = value } })
    assert.deepEqual(errors, []); assert.deepEqual(warnings, []); assert.deepEqual(external, [])
    const closed = app.waitForEvent('close', { timeout: 10000 })
    await app.evaluate(({ app }) => app.quit()); await closed; appClosed = true
    await writeFile(path.join(artifacts, 'first-send-results.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } else if (process.env.DEVICE_CATALOG_ONLY === '1') {
    report.catalog = await verifyCatalog({ app, page, pet, artifacts, send, waitApplied, AxeBuilder,
      providerTexts, billingEvents, setBound: value => { bound = value } })
    assert.deepEqual(errors, []); assert.deepEqual(warnings, []); assert.deepEqual(external, [])
    const closed = app.waitForEvent('close', { timeout: 10000 })
    await app.evaluate(({ app }) => app.quit()); await closed; appClosed = true
    await writeFile(path.join(artifacts, 'catalog-results.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } else if (process.env.DEVICE_ASSISTANT_ONLY === '1') {
    await app.evaluate(() => { globalThis.failNextSession = false })
    report.assistant = await verifyAssistant({ app, page, pet, root, artifacts, userData: env.PET_DEVICE_USER_DATA,
      AxeBuilder, toolOutputs, providerConfigs, setMode: value => { assistantMode = value } })
    assert.deepEqual(errors, [])
    assert.deepEqual(warnings, [])
    assert.deepEqual(external, [])
    const closed = app.waitForEvent('close', { timeout: 10000 })
    await app.evaluate(({ app }) => app.quit()); await closed; appClosed = true
    assert.deepEqual(await readdir(path.join(env.PET_DEVICE_USER_DATA, 'assistant')), [])
    await writeFile(path.join(artifacts, 'assistant-results.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } else if (process.env.DEVICE_TOUCH_ONLY === '1') {
    // The full suite first exercises an intentional bootstrap failure; this
    // focused branch starts directly with the successful reply path.
    await app.evaluate(() => { globalThis.failNextSession = false })
    await pet.locator('#chat-text').fill('抚摸回复时保留这份草稿')
    // Start with the controller focused, as after opening settings or working
    // in another app. The pet is normally shown without taking focus.
    await page.bringToFront()
    const avatar = pet.frames().find(frame => frame.url().includes('/avatar.html'))
    const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().endsWith('/device/device-pet.html')).getBounds())
    const before = await bounds(), area = await pet.locator('#drag-surface').boundingBox()
    const x = area.x + area.width / 2, y = area.y + area.height / 2
    await pet.mouse.move(x, y)
    // The native window updates mouse-through hit regions every 50 ms.
    await pet.waitForTimeout(100)
    await pet.mouse.down()
    await pet.mouse.move(x + 24, y + 12, { steps: 8 })
    await pet.waitForTimeout(240)
    await pet.mouse.move(x + 36, y + 16, { steps: 4 })
    await avatar.waitForFunction(() => {
      const value = JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics || '{}')
      return value.poseApplied && value.face?.mouthSmileLeft > 0.05 &&
        value.appliedBoneAngles.some(bone => Math.abs(bone.y) > 0.02)
    }, null, { timeout: 10000 })
    assert.deepEqual(await bounds(), before, 'Stroking must not move or resize the window')
    await pet.screenshot({ path: path.join(artifacts, 'touch-stroking.png'), omitBackground: true })
    await pet.mouse.up()
    await avatar.waitForFunction(() => !JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics || '{}').poseApplied)
    await pet.waitForFunction(() => window.fixtureAudioSources.some(source => source.buffer?.length > 0) &&
      window.fixtureAudioContext?.state === 'running', null, { timeout: 60000 })
    await avatar.waitForFunction(() => {
      const value = JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics || '{}')
      return value.poseApplied && value.face?.jawOpen > 0.005
    }, null, { timeout: 20000 })
    await pet.mouse.move(x + 70, y + 30)
    await pet.waitForTimeout(100)
    assert.equal(await pet.locator('#drag-surface').getAttribute('data-gaze'), null,
      'Cursor movement must not take presentation ownership during a spoken touch reply')
    await pet.waitForFunction(() => document.querySelector('#chat-send').dataset.busy === 'false', null, { timeout: 60000 })
    assert.equal(providerTexts.length, 1)
    assert.match(providerTexts[0], /抚摸/)
    assert.ok(billingEvents.some(event => event.eventType === 'output_completed'))
    assert.equal(await pet.locator('#chat-form').isVisible(), true, 'The composer stays visible during touch replies')
    assert.equal(await pet.locator('#chat-text').inputValue(), '抚摸回复时保留这份草稿')
    assert.equal(await pet.locator('.task-record[data-kind="user"]').count(), 0, 'Touch observations stay out of the conversation UI')
    assert.ok(await pet.locator('.task-record[data-kind="reply"] p').count() > 0)
    assert.equal(await pet.locator('#chat-microphone').getAttribute('aria-pressed'), 'false')
    await pet.waitForTimeout(4100)
    const sourceCount = await pet.evaluate(() => window.fixtureAudioSources.length)
    await pet.mouse.click(x, y)
    await pet.waitForFunction(() => document.querySelector('#drag-surface').dataset.touchGesture === 'TAP')
    await pet.waitForFunction(count => window.fixtureAudioSources.length > count, sourceCount, { timeout: 60000 })
    await pet.waitForFunction(() => document.querySelector('#chat-send').dataset.busy === 'false', null, { timeout: 60000 })
    assert.equal(providerTexts.length, 2, 'A nose tap must generate its own reply')
    assert.match(providerTexts[1], /用户轻轻点了点你的鼻尖/)
    assert.doesNotMatch(providerTexts[1], /最新观察：用户.*抚过/)
    assert.equal(await pet.locator('.task-record[data-kind="user"]').count(), 0, 'Tap observations stay hidden too')
    assert.equal(await pet.locator('#chat-text').inputValue(), '抚摸回复时保留这份草稿')
    await pet.locator('#drag-surface').focus()
    await pet.keyboard.down('Space')
    await pet.waitForFunction(() => document.querySelector('#drag-surface').dataset.touchState === 'stroking')
    await pet.keyboard.up('Space')
    await pet.waitForFunction(() => document.querySelector('#drag-surface').dataset.touchState === 'idle')
    const handle = await pet.locator('#pet-drag').boundingBox()
    // Chromium's synthetic mouse screenX can lag a moved native window. Keep
    // the real captured pointer, but supply an explicit screen delta for IPC.
    await pet.locator('#pet-drag').evaluate(node => node.addEventListener('pointerdown', event => {
      window.fixtureDragPoint = { id: event.pointerId, x: event.screenX, y: event.screenY }
    }, { once: true }))
    await pet.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await pet.mouse.down()
    await pet.locator('#pet-drag').evaluate(node => {
      const point = window.fixtureDragPoint
      node.dispatchEvent(new PointerEvent('pointermove', { pointerId: point.id, screenX: point.x - 20, screenY: point.y, buttons: 1 }))
    })
    await pet.mouse.up()
    await pet.waitForTimeout(100)
    assert.equal((await bounds()).x, before.x - 20, 'Name handle must still move the window')
    await pet.locator('#pet-drag').press('ArrowRight')
    await pet.waitForTimeout(100)
    assert.equal((await bounds()).x, before.x - 10)
    await pet.locator('#drag-surface').focus()
    await pet.keyboard.down('Space')
    await showSettings(page, 'window-settings')
    await page.locator('#click-through').check()
    await pet.waitForFunction(() => document.querySelector('#drag-surface').dataset.touchState === 'idle')
    await pet.keyboard.up('Space')
    await pet.waitForTimeout(650)
    assert.equal(providerTexts.length, 2, 'Cancelled gestures must not generate another reply')
    assert.deepEqual(errors, [])
    const closed = app.waitForEvent('close', { timeout: 10000 })
    await app.evaluate(({ app }) => app.quit()); await closed; appClosed = true
    console.log('Touch-only Electron: nose tap and directional cheek stroke reach distinct prompts and spoken replies; LAM mouth, billing, draft, keyboard, drag and cancellation. Local provider fixture only. PASS')
  } else {
  await showSettings(page, 'window-settings')
  assert.equal(await page.locator('#particles').isChecked(), false)
  const originalFigureHeight = await pet.locator('#avatar-host').evaluate(element => element.getBoundingClientRect().height)
  assert.equal((await particlePixels()).hidden, true)
  await page.locator('#particles').focus()
  await page.locator('#particles').press('Space')
  await pet.waitForFunction(() => !document.querySelector('#device-particles').hidden)
  await pet.waitForFunction(() => document.querySelector('#device-particles').dataset.anchored === 'true')
  const particleFirst = await particlePixels()
  await pet.waitForTimeout(150)
  const particleSecond = await particlePixels()
  assert.ok(particleSecond.visible > 100, 'Particles must paint visible pixels')
  await assertParticleLayout()
  assert.equal(await pet.locator('#avatar-host').evaluate(element => element.getBoundingClientRect().height), originalFigureHeight,
    'Enabling particles must preserve the avatar size')
  assert.deepEqual(await pet.evaluate(() => ['.chat-field', '#chat-text', '#chat-status'].map(selector =>
    getComputedStyle(document.querySelector(selector)).backgroundColor)), ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'])
  assert.notEqual(particleFirst.hash, particleSecond.hash, 'Enabled particles must animate')
  await pet.screenshot({ path: path.join(artifacts, 'particles-on.png'), omitBackground: true })
  await pet.emulateMedia({ reducedMotion: 'reduce' })
  await pet.waitForTimeout(100)
  const still = await particlePixels()
  await pet.waitForTimeout(100)
  assert.equal((await particlePixels()).hash, still.hash)
  await pet.emulateMedia({ reducedMotion: 'no-preference' })
  await page.locator('#particles').uncheck()
  await pet.waitForFunction(() => document.querySelector('#device-particles').hidden)
  assert.equal((await particlePixels()).visible, 0)
  await page.locator('#particles').check()
  assert.deepEqual(JSON.parse(await readFile(path.join(env.PET_DEVICE_USER_DATA, 'display-preferences.json'), 'utf8')), { particles: true, quality: 'auto' })
  report.particles = { keyboardToggle: true, tangentToVisibleSilhouette: true, preservesAvatarSize: true,
    transparentComposer: true, animated: true, reducedMotion: true, saved: true }
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).current.voiceId, 'cosyvoice-v3.5-flash-fixture-a')
  await pet.evaluate(() => window.controlDevice.stopChat())
  await app.evaluate(() => { globalThis.failNextSession = true })
  send({ type: 'send_text', text: 'Test speech', requestId: 'speech-unavailable' })
  const rejectionDeadline = Date.now() + 60000
  while (!rejections.length && Date.now() < rejectionDeadline) await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(rejections.at(-1)?.code, 'SESSION_UNAVAILABLE')
  assert.equal(rejections.at(-1)?.requestId, 'speech-unavailable')
  assert.equal(rejections.at(-1)?.deviceId, deviceId)
  const first = await pixels()
  await page.waitForTimeout(600)
  const second = await pixels()
  assert.ok(first.visible > 1000 && first.transparent > 1000)
  assert.notEqual(first.hash, second.hash)
  report.initialPixels = first
  report.animatedPixels = second
  await page.screenshot({ path: path.join(artifacts, 'bound.png') })
  const speakingAvatar = pet.frames().find(frame => frame.url().includes('/avatar.html'))
  await speakingAvatar.evaluate(() => {
    window.fixtureMouths = []
    window.addEventListener('message', event => {
      const value = event.data
      if (value?.type === 'expression' && value.speaking && value.pipeline === 'ios-expression-v1-2e75b5f' &&
          window.fixtureMouths.length < 180) {
        window.fixtureMouths.push({ jawOpen: value.weights.jawOpen, mouthPucker: value.weights.mouthPucker,
          mouthClose: value.weights.mouthClose, channels: Object.keys(value.weights).length, owned: value.pose?.owned })
      }
    })
  })
  const field = pet.locator('#chat-text')
  await pet.evaluate(() => window.controlDevice.stopChat())
  await app.evaluate(() => { globalThis.failNextSession = true })
  await field.fill('你好')
  await field.press('Shift+Enter')
  assert.equal(await field.inputValue(), '你好\n')
  await field.dispatchEvent('compositionstart')
  await field.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  await pet.waitForTimeout(100)
  assert.notEqual(await pet.locator('#chat-status').getAttribute('data-state'), 'error')
  await field.dispatchEvent('compositionend')
  await field.press('Enter')
  await pet.waitForFunction(() => document.querySelector('#chat-status').dataset.state === 'error')
  assert.equal(await field.inputValue(), '你好\n')
  assert.match(await pet.locator('#chat-status').textContent(), /无法创建会话/)
  assert.equal(await field.evaluate(node => document.activeElement === node), true)
  await waitConnected()
  const warmBootstrapCount = await app.evaluate(() => globalThis.bootstrapRequests.length)
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).conversationState, 'ready')
  await pet.evaluate(() => {
    window.fixtureChatStatuses = []
    new MutationObserver(() => window.fixtureChatStatuses.push(document.querySelector('#chat-status').textContent))
      .observe(document.querySelector('#chat-status'), { childList: true, subtree: true, characterData: true })
  })
  await field.press('Enter')
  await pet.locator('.task-record[data-kind="reply"]').waitFor({ state: 'attached' })
  await pet.locator('#task-summary').hover()
  await pet.waitForFunction(() => document.querySelector('.task-record[data-kind="reply"] p').textContent.includes('<img'))
  assert.equal(await pet.locator('.task-record[data-kind="reply"] p').textContent(), '你好，很高兴见到你！<img src=x>')
  assert.equal(await pet.locator('#task-records img').count(), 0)
  assert.equal(await field.inputValue(), '')
  assert.equal(await pet.locator('.task-record[data-kind="user"] p').textContent(), '你好')
  assert.equal(await app.evaluate(() => globalThis.bootstrapRequests.length), warmBootstrapCount,
    'The first successful message must reuse its background connection')
  assert.equal(await pet.evaluate(() => window.fixtureChatStatuses.some(text => text.includes('正在连接'))), false)
  report.firstMessageReusesConnection = true
  assert.equal(await pet.locator('#conversation, #caption-bubble').count(), 0)
  assert.match(await pet.locator('.task-record[data-kind="reply"] small').textContent(), /^Role A · \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \/ 对话$/)
  assert.equal(await pet.locator('#chat-link').getAttribute('data-state'), 'online')
  assert.equal(await pet.locator('#chat-send').getAttribute('aria-label'), '停止回复')
  await pet.waitForFunction(() => window.fixtureAudioSources.length > 0, null, { timeout: 20000 })
  const clock = await pet.evaluate(() => window.fixtureAudioContext.currentTime)
  await pet.waitForTimeout(200)
  assert.ok(await pet.evaluate(() => window.fixtureAudioContext.currentTime) > clock)
  assert.equal(await pet.evaluate(() => window.fixtureAudioContext.state), 'running')
  assert.ok(await pet.evaluate(() => window.fixtureAudioSources.some(source =>
    source.buffer?.getChannelData(0).some(value => Math.abs(value) > 0.01))))
  await speakingAvatar.waitForFunction(() => {
    const pose = JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics || '{}')
    return pose.poseApplied && window.fixtureMouths.length > 2
  }, null, { timeout: 10000 })
  const audioPose = await pet.frames().find(frame => frame.url().includes('/avatar.html'))
    .evaluate(() => JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics))
  assert.equal(audioPose.poseApplied, true)
  const mouths = await speakingAvatar.evaluate(() => window.fixtureMouths)
  assert.ok(mouths.length > 2 && mouths.every(value => value.channels === 52 && value.owned))
  assert.ok(mouths.some(value => value.mouthPucker > 0 || value.mouthClose > 0))
  await pet.screenshot({ path: path.join(artifacts, 'realtime-bubbles.png'), omitBackground: true })
  await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled, null, { timeout: 20000 })
  const audioConfiguration = providerConfigs.findLast(config => config.voice)
  assert.equal(audioConfiguration.voice, 'qwen-audio-3.0-realtime-flash-fixture-a')
  assert.equal(await app.evaluate(() => globalThis.bootstrapRequests.at(-1).voiceId), 'realtime-row-a')
  assert.deepEqual(await app.evaluate(() => globalThis.voiceMetadataRequests),
    Array.from({ length: 4 }, () => ['test-tenant', '1508290699769155584', '24', '1']
      .map(tenantId => ({ tenantId, method: 'POST' }))).flat())
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).current.voiceId, 'cosyvoice-v3.5-flash-fixture-a')
  assert.deepEqual(audioConfiguration.modalities, ['text', 'audio'])
  assert.equal(billingEvents.filter(item => item.eventType === 'usage').at(-1).tokenCount, 42)
  assert.ok(billingEvents.some(item => item.eventType === 'output_completed'))
  const emotions = {}
  for (const emotion of ['neutral', 'surprised']) {
    replyText = `[E:${emotion}]我来展示这个表情。`
    await field.fill(emotion === 'surprised' ? '请做出惊讶的表情' : '请保持自然表情')
    await field.press('Enter')
    await pet.waitForFunction(() => document.querySelector('#chat-status').textContent === '正在回复')
    await speakingAvatar.waitForFunction(emotion => {
      const value = JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics)
      return value.poseApplied && (emotion === 'surprised'
        ? value.face.browInnerUp > 0.4 : value.face.jawOpen > 0.01)
    }, emotion, { timeout: 20000 })
    await pet.screenshot({ path: path.join(artifacts, `expression-${emotion}.png`), omitBackground: true })
    const samples = []
    for (let index = 0; index < 8; index++) {
      samples.push(await speakingAvatar.evaluate(() =>
        JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics).face))
      await pet.waitForTimeout(100)
    }
    emotions[emotion] = Object.fromEntries(['browInnerUp', 'browOuterUpLeft', 'eyeWideLeft'].map(name =>
      [name, Math.max(...samples.map(sample => sample[name]))]))
    await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled, null, { timeout: 20000 })
  }
  assert.ok(['browInnerUp', 'browOuterUpLeft', 'eyeWideLeft'].some(name =>
    emotions.surprised[name] > emotions.neutral[name] + 0.05), JSON.stringify(emotions))
  await pet.waitForTimeout(800)
  const handoff = await speakingAvatar.evaluate(() =>
    JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics))
  assert.ok(handoff.handoffs >= 4 && handoff.transitionMaxRadians < 0.12, JSON.stringify(handoff))
  assert.equal(handoff.mixerHookActive, true)
  report.expressionBehavior = { emotions, handoffs: handoff.handoffs, transitionMaxRadians: handoff.transitionMaxRadians }
  await showSettings(page, 'role-controls')
  await page.locator('#voice-volume').fill('35')
  assert.equal(await page.locator('#voice-volume-value').textContent(), '35%')
  assert.ok(Math.abs(await pet.evaluate(() => window.fixtureAudioGains[0].gain.value) - 0.35) < 0.001)
  holdReply = true
  const cancelBefore = providerCancels
  await field.fill('请慢一点回复')
  await field.press('Enter')
  await pet.waitForFunction(() => document.querySelector('#chat-status').textContent === '正在回复')
  await pet.locator('#chat-send').click()
  await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled)
  const cancelDeadline = Date.now() + 2000
  while (providerCancels === cancelBefore && Date.now() < cancelDeadline) await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(providerCancels, cancelBefore + 1, 'Stop must cancel the actual provider response exactly once')
  assert.equal(await pet.locator('#chat-send').getAttribute('aria-label'), '发送消息')
  holdReply = false
  const micButton = pet.locator('#chat-microphone')
  assert.equal(await micButton.getAttribute('aria-pressed'), 'false')
  assert.equal(await page.evaluate(async () => (await fetch(location.href)).headers.get('Permissions-Policy')), 'microphone=(), camera=(), geolocation=()')
  assert.equal(await pet.evaluate(async () => (await fetch(location.href)).headers.get('Permissions-Policy')), 'microphone=(self), camera=(), geolocation=()')
  assert.equal(await page.evaluate(() => window.controlDevice.microphone(true)), false)
  assert.equal((await pet.evaluate(() => window.controlDevice.voice(new Uint8Array(16000)))).code, 'MICROPHONE_CLOSED')
  await field.fill('语音对话期间保留这份草稿')
  await micButton.click()
  await pet.waitForFunction(() => ['listening', 'speaking', 'error'].includes(document.querySelector('#chat-microphone').dataset.state))
  assert.notEqual(await micButton.getAttribute('data-state'), 'error', await pet.locator('#microphone-status').textContent())
  assert.equal(await micButton.getAttribute('aria-pressed'), 'true')
  assert.equal(await field.isDisabled(), false)
  assert.equal(await pet.locator('#chat-form').getAttribute('data-mode'), 'voice')
  assert.equal(await pet.locator('#chat-waveform').isVisible(), true, 'Voice mode reveals the energy waveform')
  await pet.waitForFunction(() => Number(document.querySelector('#chat-waveform-canvas').dataset.level) > 0.02,
    null, { timeout: 15000 })
  await pet.screenshot({ path: path.join(artifacts, 'microphone-on.png'), omitBackground: true })
  await pet.waitForFunction(() => document.querySelector('#chat-microphone').dataset.state === 'paused', null, { timeout: 15000 })
  await pet.waitForFunction(() => [...document.querySelectorAll('.task-record[data-kind="user"] p')].some(node => node.textContent === '这是麦克风输入的测试'), null, { timeout: 30000 })
  assert.ok(providerVoices.at(-1) >= 6400 && providerVoices.at(-1) <= 640000)
  await pet.waitForFunction(() => document.querySelector('#chat-microphone').dataset.state === 'listening', null, { timeout: 30000 })
  assert.equal(await field.inputValue(), '语音对话期间保留这份草稿')
  assert.equal(await pet.locator('.task-record[data-kind="user"] p').last().textContent(), '这是麦克风输入的测试')
  await micButton.click()
  assert.equal(await micButton.getAttribute('aria-pressed'), 'false')
  assert.equal(await micButton.getAttribute('data-state'), 'off')
  await pet.waitForFunction(() => document.querySelector('#chat-form').dataset.mode === 'text' &&
    document.querySelector('#chat-waveform').hidden)
  assert.equal(await pet.locator('#chat-waveform-canvas').getAttribute('data-level'), '0')
  report.microphone = { syntheticHardware: true, automaticVoiceTurn: true, pauseDuringReply: true,
    draftPreserved: true, explicitOnOff: true, scopedPermissions: true, energyWaveform: true }
  // The composer is permanent now: neither the toolbar nor a collapse control exists.
  assert.equal(await pet.locator('#chat-toggle').count(), 0, 'The composer cannot be collapsed any more')
  assert.equal(await pet.locator('.pet-toolbar').count(), 0, 'The composer replaces the floating toolbar')
  assert.equal(await pet.locator('#chat-form').isVisible(), true, 'The composer stays visible after dictation')
  assert.equal(await pet.locator('#chat-text').inputValue(), '语音对话期间保留这份草稿')
  assert.ok(await pet.locator('.task-record[data-kind="user"] p').count() > 0, 'The transcript survives the voice turn')
  const controls = await pet.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect()
    const form = box('#chat-form'), input = box('#chat-text'), grip = box('#pet-drag')
    const gear = box('#controller'), hide = box('#hide'), size = box('#pet-size')
    const mic = box('#chat-microphone'), send = box('#chat-send')
    return { formLeft: form.left, formRight: form.right, formBottom: form.bottom, inputBottom: input.bottom,
      gripLeft: grip.left, gripBottom: grip.bottom, gearLeft: gear.left, hideRight: hide.right, sizeLeft: size.left,
      micRight: mic.right, micTop: mic.top, sendTop: send.top }
  })
  assert.ok(controls.gripLeft < controls.formLeft + 48 && controls.gripBottom <= controls.formBottom,
    'The drag grip sits at the bottom left of the composer')
  assert.ok(controls.gripLeft <= controls.gearLeft && controls.hideRight <= controls.sizeLeft,
    'Settings and hide stay left of the size slider')
  assert.ok(controls.sizeLeft < controls.micRight, 'The size slider stays left of the microphone')
  assert.ok(controls.micRight > controls.formRight - 48, 'The microphone sits at the bottom right of the composer')
  assert.ok(controls.micTop >= controls.inputBottom && controls.sendTop >= controls.inputBottom,
    'The microphone and send buttons stay below the input field')
  report.composerControls = controls
  report.realtimeFixture = { bubbles: true, bracketFiltering: true, audioClock: true, stop: true, usage: true, cosyVoicePairing: true,
    originalLamInference: true, controlledMouthSamples: mouths.length }
  const layout = await pet.evaluate(() => {
    const avatar = document.querySelector('.avatar-view').getBoundingClientRect()
    const bubbles = document.querySelector('.caption-slot').getBoundingClientRect()
    const form = document.querySelector('#chat-form').getBoundingClientRect()
    return { avatarTop: avatar.top, avatarBottom: avatar.bottom, bubblesTop: bubbles.top, bubblesBottom: bubbles.bottom,
      formTop: form.top, formBottom: form.bottom, height: innerHeight }
  })
  assert.equal(layout.avatarTop, 0)
  assert.ok(layout.bubblesTop >= layout.avatarTop && layout.bubblesBottom <= layout.formTop &&
    Math.abs(layout.avatarBottom - layout.formTop) <= 1 &&
    layout.formBottom <= layout.height)
  report.composer = layout
  const screenshot = await pet.screenshot({ path: path.join(artifacts, 'pet-chat.png'), omitBackground: true })
  assert.equal(PNG.sync.read(screenshot).data[3], 0, 'Native pet screenshot must preserve transparent corners')
  send({ ...roleA, type: 'switch_avatar', agentId: 'Role B', agentName: 'Role B', voiceId: 'longanlingxi',
    zipUrl: 'https://qn.ieasysell.com/device-fixture-b.zip', profileVersion: 2 })
  await waitApplied('Role B')
  await assertParticleLayout()
  assert.equal(await field.inputValue(), '')
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).current.voiceId, 'longanlingxi')
  assert.equal(await pet.locator('.task-record:is([data-kind="user"], [data-kind="reply"])').count(), 0)
  await field.fill('新形象你好')
  await field.press('Enter')
  await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled, null, { timeout: 20000 })
  assert.equal(providerConfigs.findLast(config => config.voice).voice, 'longanlingxi')
  await app.evaluate(() => { globalThis.failNextAvatar = true })
  await showSettings(page, 'role-controls')
  // An already cached ZIP must not pretend to exercise a failing download.
  const refreshedRole = { ...roleA, zipUrl: 'https://qn.ieasysell.com/device-fixture-retry.zip', profileVersion: 3 }
  send(refreshedRole)
  await page.waitForFunction(() => !document.querySelector('#retry').hidden)
  assert.equal(await page.locator('#role-name').textContent(), 'Role B')
  assert.equal(await page.locator('#roles').inputValue(), 'Role B', 'Failed selection must restore the actual role')
  send(refreshedRole)
  await waitApplied('Role A')
  send({ ...roleA, agentId: 'Wrong device', deviceId: 'another-device', profileVersion: 99 })
  await page.waitForTimeout(150)
  assert.equal(await page.locator('#role-name').textContent(), 'Role A')
  send({ ...roleA, agentId: 'Invalid asset', zipUrl: 'file:///C:/private.zip', profileVersion: 3 })
  await page.waitForFunction(() => !document.querySelector('#retry').hidden)
  assert.equal(await page.locator('#role-name').textContent(), 'Role A')
  assert.ok(reports.some(item => item.agentId === 'Invalid asset' && item.applyStatus === 'failed'))
  send({ ...roleA, profileVersion: 4 })
  await page.waitForFunction(() => document.querySelector('#retry').hidden)
  await waitApplied('Role A')
  replyText = '我们可以慢慢聊。文字会保留在实时任务中，输入框仍在数字人下方。\n'.repeat(8) + 'LongWord'.repeat(30)
  await field.fill('长文本布局检查')
  await field.press('Enter')
  await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled, null, { timeout: 20000 })
  for (const width of [320, 768, 1024, 1440]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/device/device.html')).setContentSize(width, 800), width)
    await page.waitForTimeout(1000)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
    const sample = await pixels()
    await assertParticleLayout()
    assert.ok(sample.visible > 500)
    report.viewports.push({ viewportWidth: width, ...sample })
    await page.screenshot({ path: path.join(artifacts, `device-${width}.png`) })
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/device/device.html')).setContentSize(464, 781))
  await showSettings(page, 'window-settings')
  for (const width of [240, 300, 360, 440]) {
    if (width === 240) await page.evaluate(() => window.desktopPet.command('size', 240))
    else await page.locator('#size').fill(String(width))
    await pet.waitForFunction(expected => innerWidth === expected, width, { timeout: 10000 })
    assert.equal(await pet.evaluate(() => innerWidth), width)
    assert.equal(await pet.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await pet.locator('#task-summary').hover()
    const bubbleLayout = await pet.evaluate(() => {
      const log = document.querySelector('#task-records')
      const form = document.querySelector('#chat-form').getBoundingClientRect()
      const avatar = document.querySelector('.avatar-view').getBoundingClientRect()
      return { logTop: log.getBoundingClientRect().top, logBottom: log.getBoundingClientRect().bottom, avatarTop: avatar.top,
        avatarBottom: avatar.bottom, formTop: form.top, scrollable: log.scrollHeight > log.clientHeight,
        contained: [...log.querySelectorAll('.task-record:is([data-kind="user"], [data-kind="reply"])')].every(row => {
          const rect = row.getBoundingClientRect()
          return rect.left >= 0 && rect.right <= innerWidth && row.scrollWidth <= row.clientWidth
        }) }
    })
    assert.ok(bubbleLayout.scrollable && bubbleLayout.contained)
    assert.ok(bubbleLayout.logTop >= bubbleLayout.avatarTop && bubbleLayout.logBottom <= bubbleLayout.formTop)
    const sample = await pixels()
    assert.ok(sample.visible > 500 && sample.transparent > 500)
    await pet.screenshot({ path: path.join(artifacts, `pet-${width}.png`), omitBackground: true })
  }
  const longStatus = await pet.evaluate(() => {
    const status = document.querySelector('#chat-status')
    const previous = status.textContent
    status.textContent = 'LAM 嘴型推理不可用，请检查本地模型、Python 和 Java 环境后重试'
    const send = document.querySelector('#chat-send').getBoundingClientRect()
    const result = { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      sendRight: send.right }
    status.textContent = previous
    return result
  })
  assert.ok(longStatus.scrollWidth <= longStatus.width, 'A long status must not widen the pet')
  assert.ok(longStatus.sendRight <= longStatus.width, 'Composer buttons must stay inside the pet')
  report.composerLongStatus = longStatus
  for (const window of [page, pet]) {
    const axe = await new AxeBuilder({ page: window }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    assert.deepEqual(axe.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })), [])
  }
  report.assistant = await verifyAssistant({ app, page, pet, root, artifacts, userData: env.PET_DEVICE_USER_DATA,
    AxeBuilder, toolOutputs, providerConfigs, setMode: value => { assistantMode = value } })
  const nativeState = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/device/device-pet.html'))
    return { bounds: win.getBounds(), pinned: win.isAlwaysOnTop(), visible: win.isVisible(), minimized: win.isMinimized() }
  })
  await page.locator('#pinned').uncheck()
  assert.equal((await nativeState()).pinned, false)
  await page.locator('#pinned').check()
  await pet.locator('#chat-microphone').click()
  await pet.waitForFunction(() => document.querySelector('#chat-microphone').getAttribute('aria-pressed') === 'true')
  await page.locator('#visible').uncheck()
  await pet.waitForFunction(() => document.querySelector('#chat-microphone').dataset.state === 'off')
  report.microphone.hideStopsCapture = true
  assert.equal((await nativeState()).visible, false)
  assert.equal((await particlePixels()).visible, 0)
  const hiddenBootstraps = await app.evaluate(() => globalThis.bootstrapRequests.length)
  assert.equal((await pet.evaluate(() => window.controlDevice.chat('隐藏后不能提交电脑任务'))).code, 'FORBIDDEN')
  await pet.waitForTimeout(1200)
  assert.equal(await app.evaluate(() => globalThis.bootstrapRequests.length), hiddenBootstraps)
  await page.locator('#visible').check()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/device/device-pet.html')).minimize())
  await pet.waitForTimeout(100)
  assert.equal((await nativeState()).minimized, true)
  await page.locator('#visible').uncheck()
  await page.locator('#visible').check()
  assert.equal((await nativeState()).minimized, false, 'Show must restore a taskbar-minimized pet')
  const before = (await nativeState()).bounds
  await pet.locator('#drag-surface').press('ArrowLeft')
  await pet.waitForTimeout(100)
  assert.equal((await nativeState()).bounds.x, before.x - 10)
  const surface = await pet.locator('#pet-drag').boundingBox()
  await pet.mouse.move(surface.x + surface.width / 2, surface.y + surface.height / 2)
  await pet.mouse.down()
  await pet.mouse.move(surface.x + surface.width / 2 - 20, surface.y + surface.height / 2, { steps: 1 })
  await pet.mouse.up()
  await pet.waitForTimeout(100)
  assert.equal((await nativeState()).bounds.x, before.x - 30)
  await page.locator('#click-through').check()
  await field.click()
  await field.fill('鼠标穿透时仍可输入')
  await pet.locator('#chat-send').click()
  await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled)
  assert.equal(await field.inputValue(), '')
  assert.equal(await pet.locator('.task-record[data-kind="user"] p').last().textContent(), '鼠标穿透时仍可输入')
  await page.locator('#click-through').uncheck()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/device/device.html')).close())
  await pet.locator('#controller').click()
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/device/device.html')).isVisible()), true)
  bound = false
  send({ type: 'bind_lost' })
  await page.waitForFunction(() => !document.querySelector('#qr').hidden)
  await pet.waitForFunction(async () => {
    const state = await window.controlDevice.state()
    return state.current?.publicAvatar === true && state.binding === 'unbound'
  })
  await pet.locator('#avatar-host iframe').waitFor({ state: 'attached' })
  assert.equal(await field.inputValue(), '')
  await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled)
  await page.waitForFunction(() => document.querySelector('#roles').options.length === 1)
  assert.deepEqual(await page.locator('#roles option').evaluateAll(rows => rows.map(row => row.value)), ['waner'])
  assert.equal((await pet.evaluate(() => window.controlDevice.chat('platform still requires scan'))).code, 'BIND_REQUIRED')
  bound = true
  send({ type: 'bind_success', controllerUserId: 'test-user', tenantId: 'test-tenant' })
  send(roleA)
  await waitApplied('Role A')
  const closed = app.waitForEvent('close', { timeout: 10000 })
  await app.evaluate(({ app }) => app.quit())
  await closed
  appClosed = true
  assert.deepEqual((await readdir(env.PET_DEVICE_USER_DATA)).filter(name => name.startsWith('avatars-')), [])
  app = await _electron.launch({ ...launch, env, timeout: 60000 })
  appClosed = false
  await app.firstWindow()
  const restartDeadline = Date.now() + 10000
  do {
    page = app.windows().find(window => window.url().endsWith('/device/device.html'))
    if (!page) await new Promise(resolve => setTimeout(resolve, 50))
  } while (!page && Date.now() < restartDeadline)
  assert.ok(page, 'Restart must reopen the controller')
  await page.waitForFunction(() => document.querySelector('#assistant-key')?.placeholder.includes('已配置'))
  assert.equal((await page.evaluate(() => window.controlDevice.assistantState())).enabled, false)
  await showSettings(page, 'assistant-heading')
  await page.locator('#assistant-forget').click()
  await page.waitForFunction(() => document.querySelector('#assistant-key').placeholder.includes('填写'))
  await page.waitForFunction(() => document.querySelector('#particles')?.checked)
  report.particles.restoredAfterRestart = true
  const restartedClose = app.waitForEvent('close', { timeout: 10000 })
  await app.evaluate(({ app }) => app.quit())
  await restartedClose
  appClosed = true
  report.twoWindowExitCleansAssets = true
  report.unauthenticatedHttp = uri.origin
  report.checks = 'AIBanlv branding; no debug controls; two windows; decoded QR; binding gate; real transparent animated pet; voiceId sync; switching; unsafe asset; unbind; composer/IME/focus; keyboard/pointer drag; controller restore; responsive; WCAG AA'
  assert.deepEqual(errors, [])
  assert.deepEqual(warnings, [])
  assert.deepEqual(external, [])
  await writeFile(path.join(artifacts, 'results.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  }
  }
  }
} catch (error) {
  console.error('JWT fixture diagnostics', { provedExchanges: deviceTokenRequests.length,
    fixtureConnections, providerConfigurations: providerConfigs.length, billingEventCount: billingEvents.length,
    requests: await app?.evaluate(() => globalThis.deviceJwtRequests).catch(() => []),
    guestTextRequests: await app?.evaluate(() => globalThis.guestTextRequests?.length).catch(() => 0) })
  console.error('device diagnostic', await page?.evaluate(async () => {
    const { binding, connection, guest, phase, score, textOnly, error, login } = await window.controlDevice.state()
    return { binding, connection, guest, phase, score, textOnly, error, login }
  }).catch(() => null))
  await page?.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {})
  await pet?.screenshot({ path: path.join(artifacts, 'failure-pet.png'), omitBackground: true }).catch(() => {})
  console.error({ errors, reports: reports.map(item => ({ agentId: item.agentId, status: item.applyStatus })) })
  throw error
} finally {
  if (!appClosed) await app?.close()
  for (const client of ws.clients) client.terminate()
  await new Promise(resolve => ws.close(resolve))
  await new Promise(resolve => httpServer.close(resolve))
}
