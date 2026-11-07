import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { showSettings } from './settings-navigation-fixture.mjs'

const root = process.cwd(), require = createRequire(import.meta.url)
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const { Server } = require('ws')
const artifacts = path.join(root, 'artifacts/device-memory-electron')
await mkdir(artifacts, { recursive: true })
const userData = path.join(artifacts, `profile-${Date.now()}`)
const server = createServer(), ws = new Server({ server })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port, errors = [], historyItems = [], historyRequests = [], generated = []
let bound = false, owner = 'test-user', acknowledge = false, currentSocket, deviceId, app, page, pet
const deliveries = []
const maxHistory = [{ role: 'user', text: '我的金毛叫MAX。' }, { role: 'assistant', text: '记住了，你的金毛叫MAX。' }]
ws.on('connection', (socket, request) => {
  const send = value => socket.send(JSON.stringify(value))
  socket.on('message', raw => {
    const value = JSON.parse(raw)
    if (request.url.startsWith('/billing/')) {
      if (value.type === 'session_register') send({ type: 'session_ready', sessionId: request.url.split('/').at(-1), role: 'producer' })
      if (value.type === 'session_event') send({ type: 'event_ack', sessionId: value.sessionId, sequence: value.sequence })
      return
    }
    if (request.url === '/provider') {
      if (value.type === 'session.update') send({ type: 'session.updated' })
      if (value.type === 'conversation.item.create') {
        historyItems.push(value.item)
        send({ type: 'conversation.item.created', item: value.item })
      }
      if (value.type === 'response.create') generated.push(value)
      return
    }
    currentSocket = socket
    if (value.type === 'device_online') {
      deviceId = value.deviceId
      send(bound ? { type: 'bind_success', deviceId, controllerUserId: owner, tenantId: 'test-tenant' }
        : { type: 'bind_offer', deviceId, bindToken: 'fixture', bound: false, expireAt: Date.now() + 900000 })
    }
    if (value.type === 'device_history_request') {
      historyRequests.push(value)
      send({ type: 'device_history', deviceId, agentId: value.agentId, requestId: value.requestId,
        tenantId: 'test-tenant', controllerUserId: owner, history: maxHistory })
    }
    if (value.type === 'assistant_reply' && value.finished && !value.snapshot) {
      deliveries.push({ owner, messageId: value.messageId, text: value.text })
      if (acknowledge) send({ type: 'reply_saved', deviceId, messageId: value.messageId })
    }
    if (value.type === 'ping') send({ type: 'pong', deviceId })
  })
})
const bootstrap = path.join(artifacts, 'bootstrap.mjs')
await writeFile(bootstrap, `const original = globalThis.fetch
globalThis.fetch = (url, options) => String(url).startsWith('http://127.0.0.1:') ? original(url, options)
 : Promise.reject(new Error('Non-fixture request blocked'))
await import(${JSON.stringify(pathToFileURL(path.join(root, 'electron/device-main.mjs')).href)})
`)
const env = { ...process.env, PET_DEVICE_USER_DATA: userData, PET_CONTROL_WS_URL: `ws://127.0.0.1:${port}/ws/control` }
delete env.ELECTRON_RUN_AS_NODE
const asset = (await readFile(process.env.DEVICE_AVATAR_ZIP || path.resolve(root, '../../../android-framework-new/photo/benny-avatar.zip'))).toString('base64')
async function launch() {
  app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap], env, timeout: 60000 })
  await app.firstWindow()
  for (let i = 0; i < 100; i++) {
    page = app.windows().find(w => w.url().endsWith('/device/device.html'))
    pet = app.windows().find(w => w.url().endsWith('/device/device-pet.html'))
    if (page && pet) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(page && pet)
  for (const window of [page, pet]) window.on('pageerror', error => errors.push(error.message))
  await app.evaluate((_electron, { asset, port, bound }) => {
    const bytes = Buffer.from(asset, 'base64'), Socket = globalThis.WebSocket
    globalThis.WebSocket = class extends Socket {
      constructor(url, options) {
        const value = String(url)
        if (value.startsWith('wss://dashscope.aliyuncs.com/')) super(`ws://127.0.0.1:${port}/provider`, options)
        else if (value.startsWith('wss://scrm.ieasysell.com/ws/digital-human-session/')) super(`ws://127.0.0.1:${port}/billing/${value.split('/').at(-1)}`, options)
        else if (value.startsWith(`ws://127.0.0.1:${port}/`)) super(url, options)
        else throw new Error('Non-fixture socket blocked')
      }
    }
    globalThis.memoryRequests = []
    globalThis.fetch = async (url, options) => {
      const value = String(url)
      if (value.includes('/aliBot/getBotListTWithPublic?')) return Response.json({ code: 200, data: [{
        id: 'waner', name: 'waner', tenantId: '1', digitalHumanId: 'waner-model', characterSetting: '你是温柔的上官婉儿。', voiceId: 'longanlingxi', zipUrl: 'https://qn.ieasysell.com/memory-fixture.zip',
      }] })
      if (value === 'https://qn.ieasysell.com/memory-fixture.zip') return new Response(bytes)
      if (value.includes('/anonymous/status') || value.includes('/reception/getReception')) return Response.json({ code: 200, data: { score: bound ? 800 : 0 } })
      if (value === 'https://scrm.ieasysell.com/client/Voice/aliyun/listClientVoices') return Response.json({ code: 200, data: {localVoices:[]} })
      if (value.endsWith('/desktop/metered-realtime/sessions')) return Response.json({ code: 0, data: {
        sessionId: 'memory-session', apiKey: 'fixture', billingTicket: 'fixture', provider: 'qwen-realtime', modelId: 'qwen-audio-3.0-realtime-flash',
        wsUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime', workspaceId: 'fixture', voiceId: 'longanlingxi',
        expiresAt: Date.now() + 600000, credentialExpiresAt: Date.now() + 600000, outputSampleRate: 24000, instructions: 'Fixture', anonymous: false,
      } })
      if (value === 'https://api.deepseek.com/chat/completions') {
        const body = JSON.parse(options.body); globalThis.memoryRequests.push(body)
        const recalled = body.messages.some(row => row.content.includes('金毛') && row.content.includes('MAX'))
        return Response.json({ choices: [{ message: { content: recalled ? '你的金毛叫MAX。' : '我还不知道。' } }] })
      }
      throw new Error('Non-fixture request blocked')
    }
  }, { asset, port, bound })
  await page.evaluate(() => { window.controlDevice.refresh(); window.controlDevice.refreshCatalog(); window.desktopPet.command('retry') })
  await pet.waitForFunction(async () => (await window.controlDevice.state()).phase === 'ready', null, { timeout: 60000 })
  await pet.waitForFunction(async () => (await window.controlDevice.state()).score !== null, null, { timeout: 15000 })
  await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled, null, { timeout: 60000 })
}
async function close() {
  const closed = app.waitForEvent('close', { timeout: 15000 })
  await page.locator('#account-menu > summary').click()
  await page.locator('#account-logout').click(); await closed; app = null
}
async function stored() {
  return app.evaluate(async ({ safeStorage }, file) => {
    const raw = JSON.parse(await process.getBuiltinModule('node:fs/promises').readFile(file, 'utf8'))
    const value = JSON.parse(safeStorage.decryptString(Buffer.from(raw.encrypted, 'base64')))
    return { ids: value.historyRows.map(row => row.messageId), owner: value.claimOwner?.owner }
  }, path.join(userData, 'guest-memory.json'))
}
try {
  await launch()
  await showSettings(page, 'assistant-heading')
  await page.locator('#assistant-key').fill('fixture-memory-key'); await page.locator('#assistant-save').click()
  await page.waitForFunction(async () => (await window.controlDevice.assistantState()).configured)
  await pet.locator('#chat-text').fill('我的金毛叫MAX。'); await pet.locator('#chat-send').click()
  await pet.waitForFunction(() => [...document.querySelectorAll('.task-record[data-kind="reply"] p')].some(row => row.textContent === '你的金毛叫MAX。'))
  await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled)
  await close()
  const persisted = await readFile(path.join(userData, 'guest-memory.json'), 'utf8')
  assert.doesNotMatch(persisted, /MAX|金毛/, 'Guest memory must remain encrypted on disk')
  await launch()
  await showSettings(page, 'assistant-heading')
  await page.locator('#assistant-key').fill('fixture-memory-key'); await page.locator('#assistant-save').click()
  await page.waitForFunction(async () => (await window.controlDevice.assistantState()).configured)
  await pet.locator('#chat-text').fill('我的狗叫什么？'); await pet.locator('#chat-send').click()
  await pet.waitForFunction(() => [...document.querySelectorAll('.task-record[data-kind="reply"] p')].some(row => row.textContent === '你的金毛叫MAX。'))
  const remembered = await app.evaluate(() => globalThis.memoryRequests[0])
  assert.ok(remembered.messages.some(row => row.role === 'user' && row.content === '我的金毛叫MAX。'))
  await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled)
  await close()
  bound = true
  await launch()
  await pet.waitForFunction(async () => (await window.controlDevice.state()).conversationState === 'ready', null, { timeout: 60000 })
  assert.ok(historyRequests.length > 0)
  assert.deepEqual(historyItems.slice(0, 2).map(item => ({ role: item.role, text: item.content[0].text })), maxHistory)
  assert.equal(generated.length, 0, 'History hydration must finish before any first reply generation')
  const claimed = await stored()
  assert.equal(claimed.owner, 'test-user')
  assert.ok(claimed.ids.length >= 4)
  const delivered = new Set(deliveries.map(row => row.messageId))
  assert.ok(claimed.ids.every(id => delivered.has(id)))
  await close()
  const beforeReplay = deliveries.length
  await launch()
  await pet.waitForFunction(async () => (await window.controlDevice.state()).conversationState === 'ready', null, { timeout: 60000 })
  assert.ok(claimed.ids.every(id => deliveries.slice(beforeReplay).some(row => row.messageId === id)), 'Same owner must retry the stable pending IDs after restart')
  await close()
  owner = 'other-user'
  const beforeOther = deliveries.length
  await launch()
  await pet.waitForFunction(async () => (await window.controlDevice.state()).conversationState === 'ready', null, { timeout: 60000 })
  await pet.waitForTimeout(500)
  assert.equal(deliveries.length, beforeOther, 'A different owner must not receive the old pending transcript')
  assert.equal((await stored()).owner, 'test-user')
  await close()
  owner = 'test-user'; acknowledge = true
  await launch()
  for (let i = 0; i < 100 && (await stored()).ids.length; i++) await pet.waitForTimeout(50)
  assert.deepEqual((await stored()).ids, [], 'Only server acknowledgements may clear pending guest memory')
  assert.deepEqual(errors, [])
  await close()
  const report = { realProcessRestarts: 5, sameUserData: true, guestMaxRecalled: true, guestEncrypted: true,
    boundServerMaxHydrated: true, providerAcknowledgedBeforeFirstQuestion: true, automaticGeneration: 0,
    pendingSurvivesExit: true, sameOwnerRetriesStableIds: true, otherOwnerIsolated: true, acknowledgementClearsPending: true, localFixturesOnly: true }
  await writeFile(path.join(artifacts, 'results.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  console.error(await pet?.evaluate(async () => {
    const { phase, error, score, binding, conversationState } = await window.controlDevice.state()
    return { phase, error, score, binding, conversationState, status: document.querySelector('#chat-status')?.textContent }
  }))
  console.error(errors)
  await pet?.screenshot({ path: path.join(artifacts, 'failure.png') })
  throw error
} finally {
  await app?.close()
  for (const socket of ws.clients) socket.terminate()
  await new Promise(resolve => ws.close(resolve))
  await new Promise(resolve => server.close(resolve))
}
