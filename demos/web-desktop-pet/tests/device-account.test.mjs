import test from 'node:test'
import assert from 'node:assert/strict'
import { DeviceChannel } from '../electron/device-channel.mjs'
import { DeviceAccount, checkDesktopUpdate } from '../electron/device-account.mjs'

function fixture(supported = false) {
  const channel = new DeviceChannel({ deviceId: 'zhanlv:desktop-fixture', qr: async () => '' })
  const sent = []; channel.send = value => { sent.push(value); return true }
  channel.receive({ type: 'bind_success', deviceId: channel.state.deviceId, tenantId: 'tenant', controllerUserId: 'owner',
    capabilities: { deviceAccount: supported }, ...(supported ? { account: { name: '测试用户', points: 1234 } } : {}) })
  return { channel, sent, account: new DeviceAccount({ channel, timeoutMs: 100 }) }
}

test('account metadata is server-scoped and unavailable credits never display a fictional zero', async () => {
  const { channel, account, sent } = fixture()
  assert.equal(account.snapshot().points, null)
  assert.match(account.snapshot().name, /昵称待同步/)
  const result = await account.request('device_logout')
  assert.equal(result.ok, false); assert.match(result.message, /手机端/)
  assert.equal(sent.length, 0, 'Do not send unsupported messages or impersonate a mobile JWT')
  assert.equal(channel.state.binding, 'bound')
})

test('supported account refresh accepts only the bound device owner and logout waits for server revocation', async () => {
  const { channel, account, sent } = fixture(true)
  assert.equal(account.snapshot().name, '测试用户'); assert.equal(account.snapshot().points, 1234)
  const pending = account.request('get_device_account'), requestId = sent.at(-1).requestId
  channel.receive({ type: 'device_account', deviceId: channel.state.deviceId, controllerUserId: 'other', tenantId: 'tenant', requestId, account: { name: '错误用户', points: 9999 } })
  assert.equal(account.snapshot().name, '测试用户')
  channel.receive({ type: 'device_account', deviceId: channel.state.deviceId, controllerUserId: 'owner', tenantId: 'tenant', requestId, account: { name: '新昵称', points: 1200 } })
  const refreshed = await pending
  assert.equal(refreshed.points, 1200)
  assert.equal(refreshed.ok, true)
  assert.equal(refreshed.message, '积分已刷新')
  assert.doesNotThrow(() => channel.emit('account', {}), 'Unsolicited metadata is not a pending refresh response')
  const logout = account.request('device_logout')
  assert.equal(channel.state.binding, 'bound')
  channel.receive({ type: 'bind_lost', deviceId: channel.state.deviceId })
  assert.equal((await logout).ok, true)
  assert.equal(account.snapshot().bound, false); assert.equal(account.snapshot().points, null)
})

test('update checks distinguish an invalid feed from up-to-date and never install or follow redirects', async () => {
  assert.equal((await checkDesktopUpdate({ version: '0.1.4', url: '' })).ok, false)
  let calls = 0
  const result = await checkDesktopUpdate({ version: '0.1.4', url: 'https://updates.example.com/windows.json',
    fetchImpl: async (_url, options) => { calls++; assert.equal(options.redirect, 'error'); return Response.json({ version: '0.1.5', platform: 'win32', arch: 'x64',
      url: 'https://updates.example.com/setup.exe', bytes: 100, sha256: 'a'.repeat(64) }) } })
  assert.equal(result.available, true); assert.equal(calls, 1)
  const denied = await checkDesktopUpdate({ version: '0.1.4', url: 'http://updates.example.com', fetchImpl: async () => { calls++; throw new Error() } })
  assert.equal(denied.ok, false); assert.equal(calls, 1)
})

test('concurrent automatic and manual account refreshes share one proven channel request', async () => {
  const { channel, account, sent } = fixture(true)
  const first = account.request('get_device_account'), second = account.request('get_device_account')
  assert.equal(first, second); assert.equal(sent.length, 1)
  channel.receive({ type: 'device_account', deviceId: channel.state.deviceId, controllerUserId: 'owner', tenantId: 'tenant',
    requestId: sent[0].requestId, account: { name: 'login-account', points: 0 } })
  const result = await second
  assert.equal(result.ok, true); assert.equal(result.points, 0)
  assert.equal((await first).name, 'login-account')
})
