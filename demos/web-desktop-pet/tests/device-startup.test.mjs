import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { DeviceStartup } from '../electron/device-startup.mjs'

function fixture(t, { packaged = true, enabled = false, disabled = false, allowRegistration = true } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'control-startup-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const changes = [], file = path.join(directory, 'startup.json')
  let item = enabled ? { name: 'ControlDeviceTest', scope: 'user', enabled: !disabled } : null
  const app = { isPackaged: packaged, getLoginItemSettings: options => {
    assert.equal(options.path, '"C:\\Program Files\\AIBanlv\\AIBanlv.exe"')
    // Electron checks AppUserModelID for openAtLogin, not our custom name.
    return { openAtLogin: false, executableWillLaunchAtLogin: Boolean(item?.enabled), launchItems: item ? [item] : [] }
  },
    setLoginItemSettings: value => { changes.push(value); item = value.openAtLogin
      ? { name: value.name, scope: 'user', enabled: value.enabled } : null } }
  const startup = new DeviceStartup({ app, file, platform: 'win32', executable: 'C:\\Program Files\\AIBanlv\\AIBanlv.exe', allowRegistration })
  return { startup, changes, file, app }
}
test('installed fresh startup is enabled by default using the installer owned entry and verified OS state', t => {
  const f = fixture(t)
  assert.equal(f.startup.initialize().enabled, true)
  assert.deepEqual(f.changes[0], { name: 'ControlDeviceTest', path: 'C:\\Program Files\\AIBanlv\\AIBanlv.exe', args: [], openAtLogin: true, enabled: true })
  assert.deepEqual(JSON.parse(readFileSync(f.file, 'utf8')), { enabled: true })
})
test('opt-out persists across restart; startup registration disabled by the OS is not silently reenabled', t => {
  const f = fixture(t, { enabled: true })
  assert.equal(f.startup.set(false).enabled, false)
  f.changes.length = 0; f.startup.initialize(); assert.equal(f.changes.length, 0)
  const disabled = fixture(t, { enabled: true, disabled: true })
  assert.equal(disabled.startup.initialize().enabled, false)
  assert.match(disabled.startup.snapshot().message, /系统禁用/)
  assert.equal(disabled.changes.length, 0)
  assert.equal(disabled.startup.set(true).enabled, true)
})
test('development and isolated installed fixtures never register any OS startup item', t => {
  for (const value of [{ packaged: false }, { allowRegistration: false }]) {
    const f = fixture(t, value)
    assert.equal(f.startup.initialize().supported, false)
    assert.equal(f.startup.set(true).supported, false)
    assert.match(f.startup.snapshot().message, /请安装 EXE/)
    assert.equal(f.changes.length, 0)
  }
})
test('a saved opt-in restores a missing entry after an update without overriding a system-disabled entry', t => {
  const f = fixture(t)
  writeFileSync(f.file, JSON.stringify({ enabled: true }))
  assert.equal(f.startup.initialize().enabled, true)
  assert.equal(f.changes.length, 1)
  const disabled = fixture(t, { enabled: true, disabled: true })
  writeFileSync(disabled.file, JSON.stringify({ enabled: true }))
  assert.equal(disabled.startup.initialize().enabled, false)
  assert.equal(disabled.changes.length, 0)
})
test('owned entry toggles both ways and a new application instance restores each saved state', t => {
  const f = fixture(t, { enabled: true })
  const restart = () => new DeviceStartup({ app: f.app, file: f.file, platform: 'win32',
    executable: 'C:\\Program Files\\AIBanlv\\AIBanlv.exe' })
  for (const enabled of [false, true, false]) {
    assert.equal(f.startup.set(enabled).enabled, enabled)
    assert.deepEqual(JSON.parse(readFileSync(f.file, 'utf8')), { enabled })
    const count = f.changes.length
    assert.equal(restart().initialize().enabled, enabled)
    assert.equal(f.changes.length, count)
  }
})
test('other user or machine entries cannot stand in for the installer owned entry', t => {
  const f = fixture(t)
  f.app.getLoginItemSettings = () => ({ openAtLogin: true, executableWillLaunchAtLogin: true,
    launchItems: [{ name: 'OtherApp', scope: 'user', enabled: true },
      { name: 'ControlDeviceTest', scope: 'machine', enabled: true }] })
  assert.equal(f.startup.snapshot().enabled, false)
  assert.equal(f.startup.set(true).error, true)
})
test('unreadable preferences, OS rejection and login-item read exceptions stay visible without crashing startup', t => {
  const f = fixture(t)
  writeFileSync(f.file, 'broken')
  assert.equal(f.startup.initialize().error, true); assert.equal(f.changes.length, 0)
  f.app.setLoginItemSettings = () => {}
  assert.equal(f.startup.set(true).enabled, false); assert.equal(f.startup.snapshot().error, true)
  f.app.getLoginItemSettings = () => { throw new Error('registry denied') }
  assert.doesNotThrow(() => f.startup.initialize())
  assert.equal(f.startup.snapshot().error, true)
})
