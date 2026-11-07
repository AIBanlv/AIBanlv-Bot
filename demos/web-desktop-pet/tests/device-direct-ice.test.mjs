import test from 'node:test'
import assert from 'node:assert/strict'
import { DirectPeer } from '../electron/device-direct-peer.mjs'

const host = 'v=0\r\na=candidate:1 1 UDP 2122260223 host.local 6000 typ host\r\n'
function fixture(sdp, options = {}) {
  const diagnostics = []
  const pc = { iceGatheringState: 'gathering', localDescription: { sdp },
    createOffer: async () => ({ type: 'offer', sdp }), setLocalDescription: async () => {} }
  const peer = new DirectPeer({ createPeer: () => pc, signal: async () => {}, gatherMs: 5, settleMs: 0,
    onState: value => diagnostics.push(value), ...options })
  peer.pc = pc
  return { peer, pc, diagnostics }
}
test('slow STUN gathering with usable LAN candidates sends a partial SDP instead of failing at eight seconds', async () => {
  const { peer, diagnostics } = fixture(host)
  assert.equal(await peer.description('offer'), host)
  assert.equal(diagnostics.at(-1).partial, true)
  assert.equal(diagnostics.at(-1).candidates.host, 1)
  assert.equal(JSON.stringify(diagnostics).includes('host.local'), false, 'Diagnostic output must not include addresses or SDP')
})
test('settled public candidates are used without waiting for unreachable interfaces to finish gathering', async () => {
  const sdp = host + 'a=candidate:2 1 UDP 1686052607 203.0.113.1 6001 typ srflx raddr 192.0.2.1 rport 6000\r\n'
  const { peer, diagnostics } = fixture(sdp, { gatherMs: 5000 })
  assert.equal(await peer.description('offer'), sdp)
  assert.ok(diagnostics.at(-1).elapsedMs < 1000)
  assert.equal(diagnostics.at(-1).candidates.srflx, 1)
})
test('empty ICE output, relay SDP and cancellation never generate a connection invitation', async () => {
  await assert.rejects(fixture('v=0\r\n').peer.description('offer'), { code: 'ICE_NO_CANDIDATE' })
  const canceled = fixture(host).peer; canceled.done = true
  await assert.rejects(canceled.description('offer'), { code: 'TRANSFER_CANCELLED' })
  await assert.rejects(fixture(host.replace('typ host', 'typ relay')).peer.description('offer'), /中转/)
})
