import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { access, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { uninstallCommands, installPreflightCommands } from '../electron/device-installer.mjs'
import { prepareNsis } from '../scripts/device-package-tools.mjs'

const execute = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
const runKey = 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Run'
const runPs = (script, env = process.env) => execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', script],
  { windowsHide: true, timeout: 30000, env })
const exists = file => access(file).then(() => true, () => false)
const scratch = await mkdtemp(path.join(root, 'artifacts/installer-safety-'))
const installId = `AIBanlvSafety-${path.basename(scratch)}`
const shortcut = installId, legacyShortcut = `${installId}-legacy`
await runPs(`if (Test-Path 'HKCU:/Software/${installId}') { exit 1 }
if ((Test-Path '${runKey}') -and ((Get-ItemProperty -Path '${runKey}' -Name '${installId}' -ErrorAction SilentlyContinue) -ne $null)) { exit 1 }
if (Test-Path 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/${installId}') { exit 1 }
if (Test-Path (Join-Path ([Environment]::GetFolderPath('Desktop')) '${shortcut}.lnk')) { exit 1 }
if (Test-Path (Join-Path ([Environment]::GetFolderPath('Programs')) '${shortcut}')) { exit 1 }
if (Test-Path (Join-Path ([Environment]::GetFolderPath('Desktop')) '${legacyShortcut}.lnk')) { exit 1 }
if (Test-Path (Join-Path ([Environment]::GetFolderPath('Programs')) '${legacyShortcut}')) { exit 1 }`)
const payload = path.join(scratch, 'payload'), install = path.join(scratch, '中文 目录 empty install')
await mkdir(payload)
await mkdir(install)
await writeFile(path.join(payload, 'AIBanlv.exe'), 'installer-test-payload')
await writeFile(path.join(payload, 'Readme.txt'), 'test')
const build = JSON.parse(await readFile(path.join(root, 'dist/device-latest.json'), 'utf8'))
const include = path.join(scratch, 'uninstall.nsh'), preflight = path.join(scratch, 'preflight.nsh'), setup = path.join(scratch, 'Setup.exe')
await writeFile(include, uninstallCommands(['AIBanlv.exe', 'Readme.txt']))
await writeFile(preflight, installPreflightCommands(['AIBanlv.exe', 'Readme.txt']))
await execute(await prepareNsis(), ['/INPUTCHARSET', 'UTF8', '/V2',
  `/DINSTALL_ID=${installId}`, `/DSHORTCUT_NAME=${shortcut}`, `/DLEGACY_SHORTCUT_NAME=${legacyShortcut}`,
  `/DAPPDIR=${payload}`, `/DOUTPUT=${setup}`, `/DICON=${build.icon}`, '/DVERSION=0.1.0', '/DSIZE=1',
  `/DUNINSTALL_FILES=${include}`, `/DPREFLIGHT_FILES=${preflight}`, path.join(root, 'electron/device-installer.nsi')],
{ windowsHide: true, timeout: 30000 })

await execute(setup, ['/S', `/D=${install}`],
  { windowsHide: true, windowsVerbatimArguments: true, timeout: 15000 })
assert.equal(await readFile(path.join(install, 'AIBanlv.exe'), 'utf8'), 'installer-test-payload')
assert.equal(await exists(path.join(install, '.control-device-install')), true)
await runPs(`$ErrorActionPreference='Stop'
$run=(Get-ItemProperty -Path '${runKey}' -Name '${installId}').'${installId}'
if ($run -ne ('"' + (Join-Path $env:CONTROL_FIXTURE_INSTALL 'AIBanlv.exe') + '"')) { throw 'Wrong autostart value' }
$item=Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/${installId}'
if ($item.DisplayName -ne 'AIBanlv (Internal Test)') { throw 'Wrong application name' }
$shell=New-Object -ComObject WScript.Shell
foreach ($link in @((Join-Path ([Environment]::GetFolderPath('Desktop')) '${shortcut}.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) '${shortcut}/${shortcut}.lnk'))) {
  if ($shell.CreateShortcut($link).TargetPath -ne (Join-Path $env:CONTROL_FIXTURE_INSTALL 'AIBanlv.exe')) {
    throw 'Wrong shortcut target'
  }
}`, { ...process.env, CONTROL_FIXTURE_INSTALL: install })
await writeFile(path.join(install, 'ControlDevice.exe'), 'legacy-owned-executable')
await runPs(`Set-ItemProperty -Path '${runKey}' -Name '${installId}' -Value ('"' + (Join-Path $env:CONTROL_FIXTURE_INSTALL 'ControlDevice.exe') + '"')`,
  { ...process.env, CONTROL_FIXTURE_INSTALL: install })
await execute(setup, ['/S', `/D=${install}`],
  { windowsHide: true, windowsVerbatimArguments: true, timeout: 15000 })
assert.equal(await exists(path.join(install, 'ControlDevice.exe')), false, 'Upgrade removes the old owned executable')
await runPs(`$run=(Get-ItemProperty -Path '${runKey}' -Name '${installId}' -ErrorAction Stop).'${installId}'
if ($run -ne ('"' + (Join-Path $env:CONTROL_FIXTURE_INSTALL 'AIBanlv.exe') + '"')) { throw 'Wrong upgraded autostart value' }`,
  { ...process.env, CONTROL_FIXTURE_INSTALL: install })
await writeFile(path.join(install, 'keep-colleague-file.txt'), 'must-survive')
const marker = path.join(install, '.control-device-install')
const uninstaller = path.join(install, 'Uninstall.exe')
const lock = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command',
  '$f=[IO.File]::Open($env:CONTROL_LOCK_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); ' +
  'try { [Console]::WriteLine("LOCKED"); [Console]::ReadLine() | Out-Null } finally { $f.Dispose() }'],
{ windowsHide: true, env: { ...process.env, CONTROL_LOCK_FILE: path.join(install, 'AIBanlv.exe') },
  stdio: ['pipe', 'pipe', 'pipe'] })
const lockExit = new Promise(resolve => lock.once('exit', resolve))
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('File lock timed out')), 10000)
    lock.once('error', reject)
    lock.stdout.once('data', data => {
      clearTimeout(timer)
      if (data.toString().includes('LOCKED')) resolve()
      else reject(new Error('File lock not established'))
    })
  })
  // Preflight must reject before deleting a legacy EXE or replacing *any* file.
  await writeFile(path.join(install, 'ControlDevice.exe'), 'legacy-must-survive-blocked-upgrade')
  await writeFile(path.join(install, 'Readme.txt'), 'existing-readme')
  await assert.rejects(execute(setup, ['/S', `/D=${install}`],
    { windowsHide: true, windowsVerbatimArguments: true, timeout: 15000 }), error => error.code === 2)
  assert.equal(await readFile(path.join(install, 'AIBanlv.exe'), 'utf8'), 'installer-test-payload')
  assert.equal(await readFile(path.join(install, 'ControlDevice.exe'), 'utf8'), 'legacy-must-survive-blocked-upgrade')
  assert.equal(await readFile(path.join(install, 'Readme.txt'), 'utf8'), 'existing-readme')
  assert.equal(await exists(marker), true)
  await runPs(`$run=(Get-ItemProperty -Path '${runKey}' -Name '${installId}' -ErrorAction Stop).'${installId}'
if ($run -ne ('"' + (Join-Path $env:CONTROL_FIXTURE_INSTALL 'AIBanlv.exe') + '"')) { throw 'Blocked upgrade modified autostart' }`,
    { ...process.env, CONTROL_FIXTURE_INSTALL: install })
  // _?= avoids NSIS self-copy so the exit code belongs to the real uninstaller.
  // Its own EXE is copied outside the install directory for this failure test.
  const outside = path.join(scratch, 'Uninstall-check.exe')
  await copyFile(uninstaller, outside)
  await assert.rejects(execute(outside, ['/S', `_?=${install}`],
    { windowsHide: true, windowsVerbatimArguments: true, timeout: 15000 }))
  assert.equal(await exists(marker), true, 'A failed uninstall must retain its marker')
  assert.equal(await exists(uninstaller), true, 'A failed uninstall must remain retryable')
  await runPs(`if (!(Test-Path 'HKCU:/Software/${installId}')) { exit 1 }
if (!(Test-Path 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/${installId}')) { exit 1 }
if ((Get-ItemProperty -Path '${runKey}' -Name '${installId}' -ErrorAction SilentlyContinue) -eq $null) { exit 1 }`)
} finally {
  lock.stdin.end('\n')
  await lockExit
}
// Releasing the lock makes the same installation safely retryable.
await execute(setup, ['/S', `/D=${install}`],
  { windowsHide: true, windowsVerbatimArguments: true, timeout: 15000 })
assert.equal(await readFile(path.join(install, 'Readme.txt'), 'utf8'), 'test')
assert.equal(await exists(path.join(install, 'ControlDevice.exe')), false)
const outside = path.join(scratch, 'Uninstall-retry.exe')
await copyFile(uninstaller, outside)
await execute(outside, ['/S', `_?=${install}`],
  { windowsHide: true, windowsVerbatimArguments: true, timeout: 15000 })
assert.equal(await exists(marker), false)
assert.equal(await exists(uninstaller), false)
assert.equal(await exists(path.join(install, 'AIBanlv.exe')), false)
assert.equal(await readFile(path.join(install, 'keep-colleague-file.txt'), 'utf8'), 'must-survive')
await runPs(`if (Test-Path 'HKCU:/Software/${installId}') { exit 1 }
if ((Test-Path '${runKey}') -and ((Get-ItemProperty -Path '${runKey}' -Name '${installId}' -ErrorAction SilentlyContinue) -ne $null)) { exit 1 }
if (Test-Path 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/${installId}') { exit 1 }
if (Test-Path (Join-Path ([Environment]::GetFolderPath('Desktop')) '${shortcut}.lnk')) { exit 1 }
if (Test-Path (Join-Path ([Environment]::GetFolderPath('Programs')) '${shortcut}')) { exit 1 }`)
console.log(JSON.stringify({ emptyDirectory: true, lockedFileRetainsMaintenance: true, autostartRemoved: true,
  lockedUpgradePreservesPayload: true, upgradeRetryAfterUnlock: true, unicodeInstallPath: true,
  uninstallRetry: true, legacyExecutableRenamed: true, brandedShortcuts: true, isolatedInstallIdentifiers: true,
  unrelatedFilePreserved: true, scratch }, null, 2))
