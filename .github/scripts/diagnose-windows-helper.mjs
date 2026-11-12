import { execFile } from 'node:child_process'
import path from 'node:path'

const command = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
const minimal = {}
for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData']) {
  if (process.env[key]) minimal[key] = process.env[key]
}
const system = { ...minimal }
for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USERDOMAIN']) {
  if (process.env[key]) system[key] = process.env[key]
}
const script = `
$ErrorActionPreference = 'Stop'
[Console]::Error.WriteLine('entered')
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
[Console]::Error.WriteLine('encoding')
$data = ConvertFrom-Json -InputObject '{}'
[Console]::Error.WriteLine('json')
Add-Type -TypeDefinition 'public class HelperProbe { public static int Value = 1; }'
[Console]::Error.WriteLine('compiled')
Import-Module (Join-Path $PSHOME 'Modules\\StartLayout\\StartLayout.psd1')
[Console]::Error.WriteLine('module')
$apps = @(Get-StartApps)
[Console]::Error.WriteLine('apps')
[Console]::Write('ready')
`
console.log(JSON.stringify({ executionPolicy: process.env.PSExecutionPolicyPreference,
  architecture: process.env.PROCESSOR_ARCHITECTURE, systemDrive: process.env.SystemDrive }))
for (const [name, env] of Object.entries({ policy: minimal,
  architecture: { ...minimal, PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE, SystemDrive: process.env.SystemDrive },
  inheritedModules: { ...minimal, PSModulePath: process.env.PSModulePath },
  extended: { ...system, PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE, SystemDrive: process.env.SystemDrive,
    HOME: process.env.HOME, PSModulePath: process.env.PSModulePath, PSExecutionPolicyPreference: process.env.PSExecutionPolicyPreference } })) {
  const start = Date.now()
  await new Promise(resolve => {
    const child = execFile(command, ['-NoLogo', '-NoProfile', '-NonInteractive', ...(name === 'policy' ? ['-ExecutionPolicy', 'Bypass'] : []), '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], { env, windowsHide: true, timeout: 7000, maxBuffer: 16384 },
    (error, stdout, stderr) => {
      console.log(JSON.stringify({ name, milliseconds: Date.now() - start, code: error?.code,
        killed: error?.killed, signal: error?.signal, stdout: stdout.slice(0, 1000), stderr: stderr.slice(0, 3000) }))
      resolve()
    })
    child.stdin.end()
  })
}
