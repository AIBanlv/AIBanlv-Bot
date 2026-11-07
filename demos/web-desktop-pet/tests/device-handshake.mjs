import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DeviceChannel } from '../electron/device-channel.mjs'

// Explicit online check: creates an unbound device offer, never a controller/account.
const channel = new DeviceChannel({
  deviceId: `zhanlv:desktop-${randomUUID()}`,
  endpoint: process.env.PET_CONTROL_WS_URL,
  qr: async () => 'received',
})
let timeout
try {
  const offered = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('No valid binding offer within 30 seconds')), 30000)
    channel.on('state', state => { if (state.qr) resolve(state) })
  })
  channel.start()
  const state = await offered
  assert.equal(state.connection, 'connected')
  assert.equal(state.binding, 'unbound')
  assert.ok(state.expiresAt > Date.now())
  console.log(JSON.stringify({
    endpoint: channel.endpoint, binding: state.binding, serverIssuedOffer: true,
    expiresInSeconds: Math.floor((state.expiresAt - Date.now()) / 1000),
    phoneBindingTested: false, cloudSpeechTested: false,
  }, null, 2))
} finally {
  clearTimeout(timeout)
  channel.stop()
}
