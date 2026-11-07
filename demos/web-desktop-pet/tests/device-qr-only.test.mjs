import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { deviceInputResult } from '../electron/device-pet-policy.mjs'
import { DeviceRuntime } from '../electron/device-runtime.mjs'
import { DeviceCatalog } from '../electron/device-catalog.mjs'
import { DeviceHttpAuth } from '../electron/device-http-auth.mjs'

test('QR is the only desktop authorization UI and no credential IPC is exposed', async () => {
  const source = async name => readFile(new URL(`../electron/${name}`, import.meta.url), 'utf8')
  const html = await source('device.html')
  assert.match(html, /id="scan-binding"/)
  assert.doesNotMatch(html, /id="(?:mode-login|login-form|login-password|register-email|register-code)"/)
  assert.doesNotMatch(await source('device-preload.cjs'), /device:(?:login|login-cancel|register|register-code)['"]/)
  assert.doesNotMatch(await source('device-main.mjs'), /device:(?:login|login-cancel|register|register-code)['"]|DeviceLogin|passwordLogin/)
})

test('unbound guests can query the public catalog but cannot authorize protected input, avatars or HTTP', async t => {
  const channel = new EventEmitter()
  channel.state = { deviceId: 'device', binding: 'unbound', connection: 'connected', guest: true,
    current: { agentId: 'old-public' }, phase: 'ready' }
  assert.equal(deviceInputResult(channel.state).code, 'BIND_REQUIRED')
  let downloads = 0, requests = 0
  const catalogScopes = []
  const runtime = new DeviceRuntime({ channel, files: new Map(), directory: '/fixture',
    download: async () => { downloads++; return Buffer.from('unused') }, save: async () => {}, remove: async () => {},
    defaultProfile: async () => { downloads++; return {} } })
  const catalog = new DeviceCatalog({ channel, load: async scope => { catalogScopes.push(scope); return [] } })
  const auth = new DeviceHttpAuth({ channel, proof: () => 'f'.repeat(64), fetchImpl: async () => { requests++; return Response.json({}) } })
  t.after(async () => { catalog.dispose(); auth.dispose(); await runtime.dispose() })
  channel.emit('state', channel.state)
  await runtime.apply({ agentId: 'old-public', zipUrl: 'https://qn.ieasysell.com/public.zip' })
  for (const [path, method, body] of [['aliBot/getBotListTWithPublic?tenantId=1', 'GET'],
    ['Voice/aliyun/listClientVoices', 'POST', '{}'], ['desktop/metered-realtime/sessions', 'POST', '{}'],
    ['reception/getReception', 'GET']]) {
    await assert.rejects(auth.fetch(`https://scrm.ieasysell.com/jwt/client/${path}`, { method, body }))
  }
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(catalogScopes, [{ guest: true }])
  assert.equal(downloads, 0)
  assert.equal(requests, 0)
  assert.equal(runtime.state.current, null)
})
