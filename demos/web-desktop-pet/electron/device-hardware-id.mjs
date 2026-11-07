import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import path from 'node:path'

const unavailable = () => Object.assign(new Error('无法读取硬件身份，请扫码使用账号积分'), { code: 'HARDWARE_ID_UNAVAILABLE' })
export async function hardwareFingerprint({ platform = process.platform, run = promisify(execFile) } = {}) {
  try {
    const options = { windowsHide: true, timeout: 8000, maxBuffer: 65536, encoding: 'utf8' }
    let value
    if (platform === 'win32') {
      const shell = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      const result = await run(shell, ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction Stop).UUID'], options)
      value = result.stdout?.trim()
    } else if (platform === 'darwin') {
      const result = await run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], options)
      value = result.stdout?.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1]
    } else throw unavailable()
    value = value?.trim().toLowerCase()
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value || '') ||
        /^([a-f0-9])\1{31}$/.test(value.replaceAll('-', ''))) throw unavailable()
    return createHash('sha256').update(`control-desktop-hardware-v1\n${platform}\n${value}`).digest('hex')
  } catch { throw unavailable() }
}
