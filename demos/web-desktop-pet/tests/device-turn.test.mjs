import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DeviceFileTransfer } from '../electron/device-file-transfer.mjs'
import { DirectPeer, cloudflareIceServers } from '../electron/device-direct-peer.mjs'

const ice = [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'temporary-user', credential: 'temporary-secret' }]
function fixture(t) {
  const channel = new EventEmitter(), sent = [], worker = []
  channel.state = { binding: 'bound', connection: 'connected', deviceId: 'desktop', owner: 'owner', directTransferSupported: true, turnFallbackSupported: true }
  channel.tenantId = 'tenant'; channel.send = value => { sent.push(value); return true }
  const files = new DeviceFileTransfer({ channel, sendWorker: (type, value) => worker.push({ type, value }) })
  files.lastCapture = { identity: files.identity(), bytes: Buffer.from('synthetic screenshot'), name: 'fixture.png' }
  t.after(() => files.reset())
  return { files, channel, sent, worker }
}
test('TURN accepts only bounded Cloudflare temporary ICE credentials, never caller-chosen hosts', () => {
  assert.equal(cloudflareIceServers(ice).length, 1)
  for (const bad of [[{ ...ice[0], urls: ['turn:evil.example:3478'] }], [{ urls: ice[0].urls }], [{ ...ice[0], urls: ['turns:turn.cloudflare.com.evil:443'] }]]) assert.throws(() => cloudflareIceServers(bad))
  assert.throws(() => new DirectPeer({ iceServers: ice }), /STUN/)
  assert.doesNotThrow(() => new DirectPeer({ iceServers: ice, relay: true }))
})
test('a pre-channel ICE failure requests exactly one authorized relay attempt with new ID and unchanged phone/file', async t => {
  const f = fixture(t), pending = f.files.send('latest_capture', { signal: new AbortController().signal, targetSession: 'origin-phone' })
  const first = f.files.pending.meta.transferId
  f.files.state({ transferId: first, status: 'failed', code: 'ICE_CONNECT_FAILED' })
  const request = f.sent.find(row => row.type === 'get_transfer_ice')
  assert.ok(request); assert.notEqual(request.transferId, first); assert.equal(request.targetSession, 'origin-phone')
  assert.equal(f.files.pending.bytes.toString(), 'synthetic screenshot')
  f.channel.emit('transfer-ice', { transferId: request.transferId, requestId: request.transferId, iceServers: ice, provider: 'cloudflare', expiresIn: 300 })
  assert.equal(f.worker.at(-1).value.relay, true)
  assert.equal(f.worker.at(-1).value.name, 'fixture.png')
  f.files.state({ transferId: first, status: 'received' })
  assert.ok(f.files.pending, 'stale first-attempt events cannot complete the relay attempt')
  f.files.state({ transferId: request.transferId, status: 'received' })
  assert.match((await pending).message, /Cloudflare/)
})
test('an opened channel, partial send, cancel, and expired authorization cannot trigger blind retransmission', async t => {
  for (const code of ['PEER_CANCELLED', 'TRANSFER_ACK_TIMEOUT', 'SIGNAL_REJECTED']) {
    const f = fixture(t), pending = f.files.send('latest_capture', { signal: new AbortController().signal })
    f.files.state({ transferId: f.files.pending.meta.transferId, status: 'failed', code })
    await assert.rejects(pending); assert.equal(f.sent.some(row => row.type === 'get_transfer_ice'), false)
  }
  const f = fixture(t), pending = f.files.send('latest_capture', { signal: new AbortController().signal })
  const id = f.files.pending.meta.transferId
  f.files.state({ transferId: id, status: 'diagnostic', stage: 'channel-open' })
  f.files.state({ transferId: id, status: 'failed', code: 'ICE_CONNECT_FAILED' })
  await assert.rejects(pending); assert.equal(f.sent.some(row => row.type === 'get_transfer_ice'), false)
})
test('relay failure is final and credentials are not requested or replayed after binding change', async t => {
  const f = fixture(t), pending = f.files.send('latest_capture', { signal: new AbortController().signal })
  f.files.state({ transferId: f.files.pending.meta.transferId, status: 'failed', code: 'ICE_NO_CANDIDATE' })
  const id = f.files.pending.meta.transferId
  f.channel.emit('transfer-ice', { transferId: id, requestId: id, iceServers: ice, provider: 'cloudflare', expiresIn: 300 })
  f.files.state({ transferId: id, status: 'failed', code: 'ICE_CONNECT_FAILED' })
  await assert.rejects(pending, /Cloudflare/)
  assert.equal(f.sent.filter(row => row.type === 'get_transfer_ice').length, 1)
  f.channel.emit('transfer-ice', { transferId: id, requestId: id, iceServers: ice, provider: 'cloudflare', expiresIn: 300 })
  assert.equal(f.files.pending, null)
})

test('stop during credential acquisition discards late credentials and never starts another peer', async t => {
  const f = fixture(t), controller = new AbortController()
  const pending = f.files.send('latest_capture', { signal: controller.signal })
  f.files.state({ transferId: f.files.pending.meta.transferId, status: 'failed', code: 'ICE_CONNECT_FAILED' })
  const id = f.files.pending.meta.transferId
  controller.abort(); await assert.rejects(pending, /取消/)
  const count = f.worker.filter(row => row.type === 'start').length
  f.channel.emit('transfer-ice', { transferId: id, requestId: id, provider: 'cloudflare', expiresIn: 300, iceServers: ice })
  assert.equal(f.worker.filter(row => row.type === 'start').length, count)
})

test('an authorized relay gathers relay candidates and selects relay-only policy without exposing credentials in diagnostics', async t => {
  const sdp = 'v=0\r\na=candidate:1 1 UDP 1 192.0.2.1 4444 typ relay\r\n'
  let config
  const diagnostics = []
  const pc = { iceGatheringState: 'complete', localDescription: { sdp }, createOffer: async () => ({ type: 'offer', sdp }), setLocalDescription: async () => {}, close() {} }
  const peer = new DirectPeer({ signal: async () => {}, relay: true, iceServers: ice,
    createPeer: value => { config = value; return pc }, onState: value => diagnostics.push(value) })
  t.after(() => peer.close())
  peer.setup({ transferId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'fixture', size: 1, sha256: 'a'.repeat(64) })
  assert.equal(await peer.description('offer'), sdp)
  assert.equal(config.iceTransportPolicy, 'relay')
  assert.equal(diagnostics.at(-1).candidates.relay, 1)
  assert.doesNotMatch(JSON.stringify(diagnostics), /temporary-secret|192\.0\.2\.1/)
})
