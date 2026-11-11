import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID, createHmac } from 'node:crypto'
import { DeviceChannel } from '../electron/device-channel.mjs'
import { DeviceFileTransfer } from '../electron/device-file-transfer.mjs'
import { DeviceBindingProof } from '../electron/device-binding-proof.mjs'
import { isComputerCommand, fileTaskKind, remoteTaskAccess } from '../electron/device-task-intent.mjs'
import { validMeta, DirectPeer } from '../electron/device-direct-peer.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ZkAAAAASUVORK5CYII=', 'base64')
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'control-direct-')); t.after(() => rm(directory, { recursive: true, force: true }))
  const channel = new DeviceChannel({ deviceId: 'zhanlv:desktop-fixture', qr: async () => '' })
  channel.receive({ type: 'bind_success', deviceId: channel.state.deviceId, controllerUserId: 'owner', tenantId: 'tenant', capabilities: { directTransferV1: true } })
  channel.publish({ connection: 'connected' })
  const sent = [], worker = [], activity = []; channel.send = message => { sent.push(message); return true }
  const files = new DeviceFileTransfer({ channel, directory, chooseFile: async () => '', captureScreen: async () => png,
    sendWorker: (type, value) => worker.push({ type, value }), onActivity: value => activity.push(value) })
  t.after(() => files.reset())
  return { files, channel, directory, sent, worker, activity }
}
test('explicit operations route to Harness, while questions, negation and quotations do not', () => {
  for (const text of ['打开微信', '帮我电脑截个图发到手机', '把这个文件发到手机', '发送邮件给张三', '请截图', '让 WorkBuddy 检查文件']) assert.equal(isComputerCommand(text), true, text)
  for (const text of ['如何截图', '不要打开微信', '他说打开微信', '“打开微信”是什么意思', '你好', 'How to send a file']) assert.equal(isComputerCommand(text), false, text)
  assert.equal(fileTaskKind('帮我电脑截个图发到手机'), 'capture_send')
  assert.equal(fileTaskKind('截图'), 'capture')
  assert.equal(fileTaskKind('把这个文件发到手机'), 'send')
  assert.equal(fileTaskKind('截图发给我'), 'capture_send')
  assert.equal(fileTaskKind('发送刚才的截图'), 'send_capture')
  assert.equal(fileTaskKind('发送截图'), 'capture_send')
  assert.equal(fileTaskKind('你把电脑现在的屏幕截图发给我'), 'capture_send')
  assert.equal(fileTaskKind('发张截图给我'), 'capture_send')
  assert.equal(fileTaskKind('把桌面的报价.pdf发给我'), 'send')
  assert.equal(fileTaskKind('发送文件'), 'send')
  assert.equal(fileTaskKind('把刚才的截图发送到邮箱'), '')
})
test('remote operations fail closed without server authentication while normal chat stays available', () => {
  assert.equal(remoteTaskAccess('打开微信', {}).code, 'REMOTE_AUTH_REQUIRED')
  assert.equal(remoteTaskAccess('查询 codex 任务', {}).code, 'REMOTE_AUTH_REQUIRED')
  assert.deepEqual(remoteTaskAccess('你好', {}), { ok: true, allowComputer: false })
  assert.deepEqual(remoteTaskAccess('打开微信', { computerAuthorized: true }), { ok: true, allowComputer: true })
})
test('channel authorizes a server-verified phone only with the new capability and pairing readiness', async t => {
  const f = await fixture(t), received = []
  f.channel.on('text', (text, id, metadata) => received.push(metadata))
  const command = { type: 'send_text', deviceId: f.channel.state.deviceId, tenantId: 'tenant', controllerUserId: 'owner',
    text: '打开微信', computerAuthorized: true, originSessionId: 'origin-phone' }
  f.channel.receive(command); assert.equal(received.at(-1).computerAuthorized, true)
  f.channel.publish({ proofRequired: true, accountAuthReady: false })
  f.channel.receive(command); assert.equal(received.at(-1).computerAuthorized, false)
  f.channel.publish({ accountAuthReady: true })
  f.channel.receive(command); assert.equal(received.at(-1).computerAuthorized, true)
  f.channel.publish({ directTransferSupported: false })
  f.channel.receive(command); assert.equal(received.at(-1).computerAuthorized, false)
})
test('capture saves a real PNG locally and never claims it was sent', async t => {
  const f = await fixture(t), signal = new AbortController().signal
  const result = await f.files.capture({ signal })
  assert.equal(result.status, 'captured'); assert.deepEqual(await readFile(result.path), png)
  assert.equal(f.sent.length, 0); assert.match(result.message, /尚未发送/)
})
test('TURN credential failures explain the actual server category and never claim delivery', async t => {
  const f = await fixture(t), signal = new AbortController().signal
  f.channel.publish({ turnFallbackSupported: true })
  await f.files.capture({ signal })
  const pending = f.files.send('latest_capture', { signal })
  f.files.state({ transferId: f.files.pending.meta.transferId, status: 'failed', code: 'ICE_CONNECT_FAILED' })
  const id = f.files.pending.meta.transferId
  f.channel.emit('request-error', { requestId: id, code: 'TURN_AUTH_FAILED' })
  await assert.rejects(pending, /令牌无效或权限不足/)
  assert.equal(f.files.pending, null)
  assert.ok(!f.activity.some(row => /已接收并校验/.test(row.text)))
})
test('Cloudflare edge rejection is distinct from invalid TURN keys and never claims delivery', async t => {
  const f = await fixture(t), signal = new AbortController().signal
  f.channel.publish({ turnFallbackSupported: true })
  await f.files.capture({ signal })
  const pending = f.files.send('latest_capture', { signal })
  f.files.state({ transferId: f.files.pending.meta.transferId, status: 'failed', code: 'ICE_CONNECT_FAILED' })
  f.channel.emit('request-error', { requestId: f.files.pending.meta.transferId, code: 'TURN_REQUEST_BLOCKED' })
  await assert.rejects(pending, /拦截了后端凭证请求/)
  assert.equal(f.files.pending, null)
  assert.ok(!f.activity.some(row => /已接收并校验/.test(row.text)))
})
test('user-named file sends directly without opening a picker and requires the phone integrity acknowledgement', async t => {
  const f = await fixture(t), signal = new AbortController().signal
  f.files.fileRoots = [f.directory]
  f.files.chooseFile = () => { throw new Error('Must not open picker') }
  await writeFile(path.join(f.directory, '报价.pdf'), 'synthetic quotation')
  const pending = f.files.send('request', { signal, request: '把报价.pdf发到手机', targetSession: 'request-phone' })
  while (!f.files.pending) await new Promise(resolve => setImmediate(resolve))
  const id = f.files.pending.meta.transferId
  assert.equal(f.files.pending.meta.name, '报价.pdf')
  assert.equal(f.files.pending.targetSession, 'request-phone')
  f.files.state({ transferId: id, status: 'received' })
  assert.equal((await pending).status, 'received')
})
test('only current staged chunks are exposed and transfer succeeds only with a complete receiver event', async t => {
  const f = await fixture(t), signal = new AbortController().signal
  await f.files.capture({ signal })
  const pending = f.files.send('latest_capture', { signal })
  const meta = f.worker[0].value
  assert.equal(validMeta(meta), true)
  assert.deepEqual(f.files.chunk(meta.transferId, 0, png.length), png)
  assert.throws(() => f.files.chunk('foreign', 0, 8))
  assert.throws(() => f.files.chunk(meta.transferId, 0, 16385))
  f.files.state({ transferId: meta.transferId, status: 'sending' })
  assert.ok(f.files.pending)
  f.files.state({ transferId: meta.transferId, status: 'received' })
  assert.equal((await pending).status, 'received')
  assert.throws(() => f.files.chunk(meta.transferId, 0, 8))
})
test('offline phone errors and binding changes never become success or automatic upload', async t => {
  const f = await fixture(t), signal = new AbortController().signal
  await f.files.capture({ signal })
  const first = f.files.send('latest_capture', { signal }), id = f.files.pending.meta.transferId
  f.channel.emit('request-error', { requestId: id, code: 'PHONE_NOT_READY' })
  await assert.rejects(first, /接收电脑文件/)
  const second = f.files.send('latest_capture', { signal })
  f.channel.receive({ type: 'bind_lost', deviceId: f.channel.state.deviceId })
  await assert.rejects(second, /绑定/)
  assert.equal(f.files.lastCapture, null)
  assert.ok(f.sent.every(value => value.type !== 'transfer_signal' || value.kind === 'cancel'))
})
test('arbitrary paths, invalid file metadata and TURN configurations are refused', async t => {
  const f = await fixture(t)
  await assert.rejects(f.files.send('C:/private.txt', { signal: new AbortController().signal }), /不接受/)
  assert.equal(validMeta({ transferId: randomUUID(), name: '../x', size: 1, sha256: 'a'.repeat(64) }), false)
  assert.throws(() => new DirectPeer({ iceServers: [{ urls: 'turn:relay.example.com:3478' }] }), /STUN/)
})
test('remote receipt offers target only their source session and are identified separately from task success', async t => {
  const f = await fixture(t), signal = new AbortController().signal
  const pending = f.files.receipt({ signal, targetSession: 'origin-phone' })
  while (!f.files.pending) await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.files.lastCapture.file, '')
  const id = f.files.pending.meta.transferId
  f.files.signal({ transferId: id, kind: 'offer', sdp: 'v=0\r\nm=application' })
  const offer = f.sent.find(value => value.kind === 'offer')
  assert.equal(offer.targetSession, 'origin-phone'); assert.equal(offer.purpose, 'task_receipt')
  f.files.state({ transferId: id, status: 'received' })
  assert.equal((await pending).status, 'received')
})
test('pairing proof is encrypted at rest, nonce-bound, and never sent for ordinary messages', async t => {
  const f = await fixture(t), file = path.join(f.directory, 'proof.json')
  const encryption = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value).reverse(), decryptString: value => Buffer.from(value).reverse().toString() }
  const proof = new DeviceBindingProof({ channel: f.channel, file, encryption }), secret = 'pairing-fixture-private-secret', nonce = randomUUID()
  f.channel.emit('pairing-offer', secret); f.channel.emit('paired'); await proof.queue
  f.channel.emit('device-challenge', nonce)
  const decorated = f.channel.decorateMessage({ type: 'get_device_account' })
  assert.equal(decorated.deviceProof, createHmac('sha256', secret).update(`${f.channel.state.deviceId}\n${nonce}`).digest('hex'))
  assert.equal(f.channel.decorateMessage({ type: 'ping' }).deviceProof, undefined)
  assert.equal((await readFile(file, 'utf8')).includes(secret), false)
  f.channel.publish({ connection: 'offline' }); assert.equal(f.channel.state.accountAuthReady, false)
  f.channel.emit('revoked'); await proof.queue
  await assert.rejects(readFile(file))
})

test('file picker waiting is explicit and cancellation settles without waiting for a human', async t => {
  const f = await fixture(t), abort = new AbortController()
  let finish
  f.files.chooseFile = () => new Promise(resolve => { finish = resolve })
  const sending = f.files.send('choose', { signal: abort.signal })
  await new Promise(resolve => setImmediate(resolve))
  assert.match(f.activity.at(-1).text, /等待.*电脑.*选择文件/)
  assert.equal(f.worker.length, 0, 'No file can be offered before selection')
  abort.abort()
  await assert.rejects(sending, /停止等待选择文件/)
  finish('late-private-file.txt')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.worker.length, 0, 'Late selection cannot send after cancellation')
})

test('picker and missing renderer have independent short deadlines before Harness times out', async t => {
  const f = await fixture(t), signal = new AbortController().signal
  f.files.selectionMs = 5
  let finish
  f.files.chooseFile = () => new Promise(resolve => { finish = resolve })
  await assert.rejects(f.files.send('choose', { signal }), /选择文件超时/)
  finish('')
  await new Promise(resolve => setImmediate(resolve))
  f.files.workerMs = 5
  await f.files.capture({ signal })
  await assert.rejects(f.files.send('latest_capture', { signal }), /发送组件未响应/)
  assert.equal(f.files.pending, null)
})
test('transfer diagnostics keep stages and candidate counts, preserve a concrete ICE error, and never log SDP or addresses', async t => {
  const f = await fixture(t), signal = new AbortController().signal, events = []
  f.files.log = { event: (name, fields) => events.push({ name, ...fields }) }
  await f.files.capture({ signal })
  const pending = f.files.send('latest_capture', { signal }), id = f.files.pending.meta.transferId
  f.files.state({ transferId: id, status: 'diagnostic', stage: 'gather-ready', partial: true,
    gathering: 'gathering', candidates: { host: 2, srflx: 0 }, sdp: 'PRIVATE SDP 192.0.2.1', address: '192.0.2.1' })
  assert.equal(events.at(-1).host, 2)
  assert.equal(events.at(-1).partial, true)
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|192\.0\.2\.1/)
  f.files.state({ transferId: id, status: 'failed', code: 'ICE_NO_CANDIDATE' })
  await assert.rejects(pending, /未获得直连地址/)
  assert.equal(f.files.pending, null)
})
