import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { ApplicationLauncher } from '../electron/device-assistant-apps.mjs'

const signal = () => new AbortController().signal
function fixture(catalog) {
  const launches = [], approvals = []
  const launcher = new ApplicationLauncher({
    listApps: async () => catalog,
    launchApp: async app => { launches.push(app); return { submitted: true } },
    approve: async action => { approvals.push(action); return true },
  })
  return { launcher, launches, approvals }
}

test('application paths come from this user catalog and are never guessed', async () => {
  for (const id of ['D:\\User Programs\\Music\\player.exe', 'E:\\Another\\player.exe']) {
    const f = fixture([{ name: 'Music Player', id }])
    assert.equal((await f.launcher.run('Music Player', { signal: signal() })).status, 'launch_requested')
    assert.equal(f.launches[0].id, id)
    assert.match(f.approvals[0].target, /Music Player/)
    assert.ok(f.approvals[0].target.includes(id))
  }
})

test('ambiguous apps require a candidate selection; uninstallers are not candidates', async () => {
  const f = fixture([
    { name: 'Music One', id: 'D:\\One\\music.exe' },
    { name: 'Music Two', id: 'D:\\Two\\music.exe' },
    { name: 'Uninstall Music', id: 'D:\\One\\uninstall.exe' },
  ])
  const result = await f.launcher.run('Music', { signal: signal() })
  assert.equal(result.status, 'needs_selection')
  assert.equal(result.candidates.length, 2)
  assert.equal(f.launches.length, 0)
  const selected = await f.launcher.run(result.candidates[1].selection, { signal: signal() })
  assert.equal(selected.app, 'Music Two')
  assert.equal(f.launches.length, 1)
})

test('missing apps, forged selections, shell hosts and raw paths never launch', async () => {
  const f = fixture([{ name: 'PowerShell', id: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }])
  for (const target of ['Unknown', `app:${'0'.repeat(24)}`, 'PowerShell']) {
    assert.equal((await f.launcher.run(target, { signal: signal() })).status, 'not_found')
  }
  for (const target of ['C:\\evil.exe', 'https://example.com', 'hello\nworld', '', 'a'.repeat(121)]) {
    await assert.rejects(f.launcher.run(target, { signal: signal() }), /INVALID_ACTION/)
  }
  assert.equal(f.launches.length, 0)
})

test('denial, cancellation and catalog changes after confirmation prevent launch', async () => {
  const app = { name: 'Music', id: 'D:\\Music\\music.exe' }
  const f = fixture([app])
  f.launcher.approve = async () => false
  await assert.rejects(f.launcher.run('Music', { signal: signal() }), /ACTION_DENIED/)
  const abort = new AbortController()
  f.launcher.approve = async () => { abort.abort(); return true }
  await assert.rejects(f.launcher.run('Music', { signal: abort.signal }), /abort/i)
  f.launcher.approve = async () => { app.id = 'D:\\Replaced\\music.exe'; return true }
  await assert.rejects(f.launcher.run('Music', { signal: signal() }), /TARGET_CHANGED/)
  assert.equal(f.launches.length, 0)
})

test('registered packaged apps work but failures are never described as successful opens', async () => {
  const f = fixture([{ name: 'Calculator', id: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' }])
  const result = await f.launcher.run('Calculator', { signal: signal() })
  assert.equal(result.status, 'launch_requested')
  assert.equal(result.windowVerified, false)
  f.launcher.launchApp = async () => { throw new Error('OPEN_FAILED') }
  await assert.rejects(f.launcher.run('Calculator', { signal: signal() }), /OPEN_FAILED/)
})

test('localized registered ids resolve to actual executables and shell aliases stay excluded', async () => {
  const f = fixture([
    { name: '百度网盘', id: '百度网盘', target: 'D:\\Apps\\disk.exe', arguments: '' },
    { name: 'Developer Console', id: 'Vendor.Console', target: 'C:\\Windows\\System32\\cmd.exe', arguments: '/c dangerous' },
    { name: 'Product Manager', id: 'Vendor.Installer', target: 'D:\\Apps\\setup.exe', arguments: '' },
  ])
  assert.equal((await f.launcher.run('百度网盘', { signal: signal() })).status, 'launch_requested')
  assert.equal((await f.launcher.run('Developer Console', { signal: signal() })).status, 'not_found')
  assert.equal((await f.launcher.run('Product Manager', { signal: signal() })).status, 'not_found')
  assert.equal(f.launches.length, 1)
})

test('selection tokens must have been issued and resolved shortcut arguments are revalidated', async () => {
  const entry = { name: 'Music', id: 'Vendor.Music', target: 'D:\\Apps\\music.exe', arguments: '--normal' }
  const f = fixture([entry])
  const forged = `app:${createHash('sha256').update(`${entry.name}\0${entry.id}`).digest('hex').slice(0, 24)}`
  assert.equal((await f.launcher.run(forged, { signal: signal() })).status, 'not_found')
  f.launcher.approve = async () => { entry.arguments = '--changed'; return true }
  await assert.rejects(f.launcher.run('Music', { signal: signal() }), /TARGET_CHANGED/)
  assert.equal(f.launches.length, 0)
})
