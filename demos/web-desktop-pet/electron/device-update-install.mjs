import { readFile, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { boundedFile } from './device-update-io.mjs'

export async function installedDirectory({ isPackaged, platform, executable }) {
  if (!isPackaged || platform !== 'win32' || path.basename(executable).toLowerCase() !== 'aibanlv.exe') return null
  const directory = path.dirname(executable)
  return await readFile(path.join(directory, '.control-device-install'), 'utf8').catch(() => '') === 'Control Device\r\n' ? directory : null
}

const encodedCommand = text => Buffer.from(text, 'utf16le').toString('base64')

function launchHelper(config, spawnImpl) {
  const data = Buffer.from(JSON.stringify(config), 'utf8').toString('base64')
  const decode = `$c = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))); `
  // A separate hidden console survives Electron exit. DETACHED_PROCESS makes
  // Windows PowerShell exit without running its script on this platform.
  // Paths travel as JSON data, never interpolated PowerShell expressions.
  const run = decode + '& $c.Script -ParentId $c.ParentId -Installer $c.Installer -Sha256 $c.Sha256 -Bytes $c.Bytes -InstallDirectory $c.InstallDirectory -Receipt $c.Receipt -Token $c.Token -CancelFile $c.CancelFile'
  const bootstrap = "$ErrorActionPreference = 'Stop'; " + decode
    + `Start-Process -FilePath $c.PowerShell -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedCommand(run)}') | Out-Null`
  return spawnImpl(config.PowerShell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand(bootstrap)],
    { shell: false, windowsHide: true, stdio: 'ignore', env: { ...process.env,
      PSModulePath: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') } })
}

export async function prepareUpdateInstall({ file, manifest, directory, installDirectory, spawnImpl = spawn,
  launchImpl = config => launchHelper(config, spawnImpl), timeoutMs = 120000 }) {
  await mkdir(directory, { recursive: true })
  const script = path.join(directory, 'install-update.ps1')
  await copyFile(new URL('./device-update-install.ps1', import.meta.url), script)
  const token = randomUUID()
  const config = { Script: script, ParentId: process.pid, Installer: file, Sha256: manifest.sha256, Bytes: manifest.bytes,
    InstallDirectory: installDirectory, Receipt: path.join(directory, 'handoff.json'), Token: token,
    CancelFile: path.join(directory, `handoff-cancel-${token}`),
    PowerShell: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') }
  let child, launchError
  try {
    child = launchImpl(config)
    child.once('error', () => { launchError = new Error('Cannot start update launcher') })
    child.once('exit', code => { if (code !== 0) launchError = new Error('Update launcher failed') })
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (launchError) throw launchError
      let receipt
      try { receipt = JSON.parse((await boundedFile(config.Receipt, 65536)).toString('utf8')) } catch {}
      if (receipt?.token === token) {
        if (receipt.status === 'error') throw new Error('Update helper failed: ' + receipt.code)
        if (receipt.status === 'armed' && Number.isSafeInteger(receipt.pid) && receipt.pid > 0) {
          child.unref()
          return { pid: receipt.pid, token }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 40))
    }
    throw new Error('Update helper timeout')
  } catch (error) {
    // A delayed helper must not install on some unrelated later app exit.
    await writeFile(config.CancelFile, '', { mode: 0o600 }).catch(() => {})
    if (child && child.exitCode === null) child.kill()
    throw error
  }
}
