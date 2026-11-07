import { DirectPeer } from './device-direct-peer.mjs'
const bridge = window.controlDevice
let peer
bridge.onTransfer(async ({ type, value }) => {
  if (type === 'reset') { peer?.fail(); peer = null; return }
  if (type === 'signal') { await peer?.handle(value); return }
  if (type !== 'start') return
  peer?.fail()
  try {
    peer = new DirectPeer({ signal: value => bridge.transferSignal(value).then(ok => { if (!ok) throw Object.assign(new Error('连接信令发送失败'), { code: 'SIGNAL_REJECTED' }) }),
      onState: value => bridge.transferState(value), relay: value.relay === true,
      ...(value.relay ? { iceServers: value.iceServers } : {}) })
    await peer.send(value, (offset, length) => bridge.transferChunk(value.transferId, offset, length))
  } catch (error) { bridge.transferState({ transferId: value.transferId, status: 'failed', code: error.code, message: error.message }) }
})
window.addEventListener('pagehide', () => peer?.fail())
