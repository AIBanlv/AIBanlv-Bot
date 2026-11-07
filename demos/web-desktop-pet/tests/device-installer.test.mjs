import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { uninstallCommands, installPreflightCommands } from '../electron/device-installer.mjs'

test('uninstall deletes only enumerated package files and removes directories non-recursively', () => {
  const script = uninstallCommands(['ControlDevice.exe', 'resources/app/package.json', 'resources/app/runtime/a $b.txt'])
  assert.match(script, /Delete "\$INSTDIR\\resources\\app\\runtime\\a \$\$b.txt"/)
  assert.match(script, /RMDir "\$INSTDIR\\resources\\app\\runtime"/)
  assert.doesNotMatch(script, /RMDir \/r|\$APPDATA|\$LOCALAPPDATA|Delete "\$INSTDIR\\\*"/i)
  assert.ok(script.indexOf('RMDir "$INSTDIR\\resources\\app\\runtime"') < script.indexOf('RMDir "$INSTDIR\\resources\\app"'))
})

test('Windows installation and executable publish the requested company', async () => {
  const script = await readFile(new URL('../electron/device-installer.nsi', import.meta.url), 'utf8')
  const packager = await readFile(new URL('../electron/device-package.mjs', import.meta.url), 'utf8')
  assert.match(script, /VIAddVersionKey "CompanyName" "Ieasysell Limited"/)
  assert.match(script, /"Publisher" "Ieasysell Limited"/)
  assert.match(packager, /CompanyName: 'Ieasysell Limited'/)
})

test('uninstall manifest rejects absolute paths, traversal, wildcards and script injection', () => {
  for (const file of ['../outside', 'x/../../outside', 'C:\\outside', '\\\\server\\share', '/outside',
    'x/*', 'x/?', 'x\nDelete', '', 'x//y']) {
    assert.throws(() => uninstallCommands([file]), undefined, file)
  }
})

test('autostart targets the branded executable and shares the isolated installation identifier', async () => {
  const script = await readFile(new URL('../electron/device-installer.nsi', import.meta.url), 'utf8')
  const registration = script.split('\n').find(line => line.includes('WriteRegStr HKCU') && line.includes('\\Run"'))
  assert.ok(registration.includes('"${INSTALL_ID}"'))
  assert.ok(registration.includes(String.raw`'$\"$INSTDIR\AIBanlv.exe$\"'`))
  const cleanup = script.indexOf('DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${INSTALL_ID}"')
  assert.ok(cleanup > script.indexOf('  complete:'))
  assert.doesNotMatch(script, /DeleteRegKey HKCU "[^"]*\\Run"/)
  assert.match(script, /MUI_FINISHPAGE_RUN "\$INSTDIR\\AIBanlv\.exe"/)
})

test('upgrade preflight covers branded and legacy executables, maintenance files and every payload file', () => {
  const files = ['AIBanlv.exe', 'resources/app/runtime/python/python.exe', 'resources/app/runtime/java/bin/server/jvm.dll',
    'resources/app/runtime/a $b.txt', '中文目录/含 空格.txt']
  const script = installPreflightCommands(files)
  assert.ok(script.startsWith('Push "$INSTDIR\\AIBanlv.exe"'))
  for (const file of ['ControlDevice.exe', 'Uninstall.exe', '.control-device-install', ...files]) {
    assert.ok(script.includes(`Push "$INSTDIR\\${file.replaceAll('/', '\\').replaceAll('$', () => '$$')}"`), file)
  }
  assert.equal(script.match(/Push "\$INSTDIR\\AIBanlv.exe"/g).length, 1)
  assert.equal(script.match(/Call CheckInstallFileWritable/g).length, files.length + 3)
  assert.equal(script.match(/StrCmp \$LockedFile "" \+2\nReturn/g).length, files.length + 3)
  assert.doesNotMatch(script, /Delete |FileOpen |Exec|taskkill|RMDir|\$APPDATA/)
})

test('upgrade preflight rejects escaping paths and NSIS injection just like uninstall', () => {
  for (const file of ['../outside', 'x/../../outside', 'C:\\outside', '\\\\server\\share', '/outside',
    'x/*', 'x/?', 'x\nDelete', 'x"', 'x\0', '', 'x//y']) assert.throws(() => installPreflightCommands([file]))
})

test('installer checks files before touching old payload, links or registry and never offers skip-file installation', async () => {
  const script = await readFile(new URL('../electron/device-installer.nsi', import.meta.url), 'utf8')
  const section = script.slice(script.indexOf('Section "AIBanlv"'), script.indexOf('SectionEnd', script.indexOf('Section "AIBanlv"')))
  const preflight = section.indexOf('Call EnsureInstallWritable')
  assert.ok(preflight > section.indexOf('Call ValidateInstallDir'))
  for (const operation of ['Delete ', 'SetOutPath ', 'File /r ', 'WriteRegStr ', 'CreateShortcut ']) {
    assert.ok(preflight < section.indexOf(operation), operation)
  }
  assert.match(section, /AllowSkipFiles off[\s\S]*File \/r/)
  assert.match(script, /Function CheckInstallFileWritable[\s\S]*CreateFileW\(w r0, i 0x40000000, i 0, p 0, i 3,[\s\S]*CloseHandle/)
  assert.match(script, /IntCmp \$1 -1 failed/)
  assert.match(script, /!include "\$\{PREFLIGHT_FILES\}"/)
  const guard = script.slice(script.indexOf('Function EnsureInstallWritable'), script.indexOf('FunctionEnd', script.indexOf('Function EnsureInstallWritable')))
  assert.match(guard, /IfSilent blocked/)
  assert.match(guard, /MB_RETRYCANCEL/)
  assert.match(guard, /\/SD IDCANCEL IDRETRY retry/)
  assert.match(guard, /SetErrorLevel 2[\s\S]*Abort/)
  assert.doesNotMatch(script, /taskkill|TerminateProcess|SetFileAttributes|RequestExecutionLevel admin/i)
})
