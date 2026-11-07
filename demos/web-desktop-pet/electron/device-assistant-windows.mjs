import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const native = fileURLToPath(new URL('./device-assistant-file-ops.cs', import.meta.url))
const failure = code => Object.assign(new Error(code), { code })
const prefix = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$data = ConvertFrom-Json -InputObject $env:AIBANLV_ACTION_JSON
`
const appMetadata = `
Import-Module (Join-Path $PSHOME 'Modules\\StartLayout\\StartLayout.psd1')
$shell = New-Object -ComObject Shell.Application
$folder = $shell.NameSpace('shell:AppsFolder')
function AppMetadata($entry) {
  try {
  $target = ''; $arguments = ''
  if ([IO.Path]::IsPathRooted($entry.AppID)) { $target = $entry.AppID }
  else {
    $item = $folder.ParseName($entry.AppID)
    if ($null -eq $item) { return $null }
    $target = [string]$item.ExtendedProperty('System.Link.TargetParsingPath')
    $arguments = [string]$item.ExtendedProperty('System.Link.Arguments')
  }
  return @{ name = $entry.Name; id = $entry.AppID; target = $target; arguments = $arguments }
  } catch { return $null }
}
`
const discovery = appMetadata + `
$apps = @(Get-StartApps | ForEach-Object { AppMetadata $_ } | Where-Object { $null -ne $_ })
ConvertTo-Json -InputObject $apps -Compress
`
const desktopEntries = `
$entries = @(Get-ChildItem -LiteralPath $data.desktop -Force | Where-Object {
  ($_.Attributes -band ([IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::System -bor [IO.FileAttributes]::ReparsePoint)) -ne 0
} | ForEach-Object { $_.Name })
ConvertTo-Json -InputObject $entries -Compress
`
const launch = appMetadata + `
$match = @(Get-StartApps | Where-Object { $_.Name -ceq $data.name -and $_.AppID -ceq $data.id })
if ($match.Count -ne 1) { throw 'Target changed' }
$current = AppMetadata $match[0]
if ($null -eq $current -or $current.target -cne $data.target -or $current.arguments -cne $data.arguments) { throw 'Target changed' }
if ($current.target -and ([IO.Path]::GetFileName($current.target) -match '^(cmd|powershell|pwsh|wscript|cscript|mshta|rundll32|regsvr32|msiexec|unins[0-9]*|uninstall|setup)\\.exe$')) { throw 'Forbidden target' }
if ([IO.Path]::IsPathRooted($data.id) -and [IO.Path]::GetExtension($data.id) -ieq '.exe') {
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $data.id
  $info.UseShellExecute = $true
  $info.WorkingDirectory = [IO.Path]::GetDirectoryName($data.id)
  $null = [Diagnostics.Process]::Start($info)
} else {
  $item = $folder.ParseName($data.id)
  if ($null -eq $item) { throw 'Target unavailable' }
  $item.InvokeVerb('open')
}
'{"submitted":true}'
`
const move = `
Add-Type -Path $data.native
[AssistantFileOps]::Move($data.root, $data.source, $data.target,
  $data.expected.dev, $data.expected.ino, $data.expected.size, $data.expected.mtime)
'{"moved":true}'
`
const removeEmpty = `
Add-Type -Path $data.native
$removed = [AssistantFileOps]::RemoveEmpty($data.root, $data.directory)
ConvertTo-Json -InputObject @{ removed = $removed } -Compress
`
const prepareDirectories = `
Add-Type -Path $data.native
[AssistantFileOps]::Prepare($data.root, $data.directory, [string[]]$data.categories)
'{"created":true}'
`

// Only fixed, application-owned scripts reach PowerShell. JSON is data in a
// child-only environment variable, never substituted into script text.
async function run(script, data, signal, code) {
  signal.throwIfAborted()
  if (process.platform !== 'win32') throw failure('WINDOWS_REQUIRED')
  const env = {}
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  env.AIBANLV_ACTION_JSON = JSON.stringify(data)
  if (env.AIBANLV_ACTION_JSON.length > 16000) throw failure('INVALID_ACTION')
  const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  try {
    const stdout = await new Promise((resolve, reject) => {
      let outcome
      const child = execFile(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(prefix + script, 'utf16le').toString('base64')],
      { windowsHide: true, signal, timeout: 15000, maxBuffer: 2 * 1024 * 1024, env, encoding: 'utf8' },
      (error, output) => { outcome = { error, output } })
      // Reconciliation must run after the helper is gone, not just after its
      // abort callback, which can precede actual process termination.
      child.once('close', () => outcome?.error ? reject(outcome.error) : resolve(outcome?.output || ''))
    })
    signal.throwIfAborted()
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
  } catch (error) {
    signal.throwIfAborted()
    throw failure(code)
  }
}

export const listWindowsApps = ({ signal }) => run(discovery, {}, signal, 'APP_DISCOVERY_FAILED')
export const excludedWindowsDesktopEntries = (desktop, { signal }) => run(desktopEntries, { desktop }, signal, 'TARGET_UNAVAILABLE')
export const launchWindowsApp = (app, { signal }) => run(launch, app, signal, 'OPEN_FAILED')
export const moveWindowsFile = (source, target, { signal, root = path.dirname(source), expected } = {}) =>
  run(move, { source, target, root, expected, native }, signal, 'MOVE_FAILED')
export const removeWindowsEmptyDirectory = (directory, { signal, root }) =>
  run(removeEmpty, { directory, root, native }, signal, 'MOVE_FAILED')
export const prepareWindowsDesktopDirectories = (directory, categories, { signal, root }) =>
  run(prepareDirectories, { directory, categories, root, native }, signal, 'MOVE_FAILED')
