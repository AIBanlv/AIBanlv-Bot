import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.resolve(root, '../../..')
const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
const exists = file => access(file).then(() => true, () => false)
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex')
const runPs = (script, env = process.env) => execute(powershell,
  ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30000, env })
const runKey = 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Run'
const cleanRegistry = `if (Test-Path 'HKCU:/Software/ControlDeviceTest') { exit 1 }
if (Test-Path 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/ControlDeviceTest') { exit 1 }
if (Test-Path (Join-Path ([Environment]::GetFolderPath('Desktop')) 'AIBanlv.lnk')) { exit 1 }
if (Test-Path (Join-Path ([Environment]::GetFolderPath('Programs')) 'AIBanlv')) { exit 1 }
if (Test-Path (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Control Device.lnk')) { exit 1 }
if (Test-Path (Join-Path ([Environment]::GetFolderPath('Programs')) 'Control Device')) { exit 1 }
if ((Test-Path '${runKey}') -and ((Get-ItemProperty -Path '${runKey}' -Name ControlDeviceTest -ErrorAction SilentlyContinue) -ne $null)) { exit 1 }`
await runPs(cleanRegistry)
const identity = path.join(process.env.APPDATA, 'Control Device/device-identity.json')
const beforeIdentity = await exists(identity) ? await hash(identity) : null
const build = JSON.parse(await readFile(path.join(root, 'dist/device-latest.json'), 'utf8'))
const installer = JSON.parse(await readFile(path.join(root, 'dist/device-installer.json'), 'utf8'))
await mkdir(path.join(workspace, '.codex_tmp'), { recursive: true })
const scratch = await mkdtemp(path.join(workspace, '.codex_tmp/cd-install-'))
const install = path.join(scratch, 'Device Test')
await mkdir(install)
const environment = { ...process.env, CONTROL_TEST_INSTALL: install, CONTROL_TEST_VERSION: installer.version }
await execute(installer.installer, ['/S', `/D=${install}`],
  { windowsHide: true, windowsVerbatimArguments: true, timeout: 180000 })
const executable = path.join(install, 'AIBanlv.exe')
assert.equal(await hash(executable), await hash(build.executable))
await runPs(`$ErrorActionPreference='Stop'
$item=Get-ItemProperty 'HKCU:/Software/ControlDeviceTest'
if ($item.InstallDir -ne $env:CONTROL_TEST_INSTALL) { throw 'Wrong install directory' }
$item=Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/ControlDeviceTest'
if ($item.DisplayVersion -ne $env:CONTROL_TEST_VERSION) { throw 'Wrong installed version' }
if ($item.DisplayName -ne 'AIBanlv (Internal Test)') { throw 'Wrong installed name' }
$run=(Get-ItemProperty -Path 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Run' -Name ControlDeviceTest -ErrorAction Stop).ControlDeviceTest
if ($run -ne ('"' + (Join-Path $env:CONTROL_TEST_INSTALL 'AIBanlv.exe') + '"')) { throw 'Wrong autostart value' }
$shell=New-Object -ComObject WScript.Shell
foreach ($link in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'AIBanlv.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'AIBanlv/AIBanlv.lnk'))) {
  if ($shell.CreateShortcut($link).TargetPath -ne (Join-Path $env:CONTROL_TEST_INSTALL 'AIBanlv.exe')) {
    throw 'Wrong shortcut target'
  }
}`, environment)
const installed = []
async function verifyFiles(directory, relative = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(relative, entry.name)
    if (entry.isDirectory()) await verifyFiles(path.join(directory, entry.name), name)
    else {
      const actual = await stat(path.join(install, name))
      assert.equal(actual.size, (await stat(path.join(directory, entry.name))).size, name)
      installed.push(name)
    }
  }
}
await verifyFiles(build.directory)
await execute(process.execPath, ['tests/device-electron.mjs'], {
  cwd: root, env: { ...process.env, DEVICE_EXECUTABLE: executable },
  windowsHide: true, timeout: 240000, maxBuffer: 2 * 1024 * 1024,
})
const electron = JSON.parse(await readFile(path.join(root, 'artifacts/device-electron/results.json'), 'utf8'))
assert.equal(electron.packagedWithDeveloperDependenciesDisabled, true)
assert.equal(electron.realtimeFixture.originalLamInference, true)
await writeFile(path.join(install, 'keep-colleague-file.txt'), 'must-survive')
const uninstaller = path.join(scratch, 'Uninstall-test.exe')
await copyFile(path.join(install, 'Uninstall.exe'), uninstaller)
await execute(uninstaller, ['/S', `_?=${install}`],
  { windowsHide: true, windowsVerbatimArguments: true, timeout: 120000 })
assert.deepEqual(await readdir(install), ['keep-colleague-file.txt'])
await runPs(cleanRegistry)
assert.equal(await exists(identity) ? await hash(identity) : null, beforeIdentity)
const result = { installer: installer.installer, install, installedFiles: installed.length,
  freshEmptyDirectory: true, pathWithSpaces: true, executableMatches: true,
  shortcutsAndRegistry: true, autostartRegisteredAndRemoved: true, installedElectron: true, realLam: true,
  developerDependenciesDisabled: true, unrelatedFilePreserved: true,
  identityUnchanged: true, uninstallComplete: true, cloudSpeechTested: false }
await writeFile(path.join(root, 'artifacts/device-installed.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
