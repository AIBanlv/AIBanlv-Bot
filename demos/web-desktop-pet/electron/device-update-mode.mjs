import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { DeviceUpdate } from './device-update.mjs'
import { SourceUpdate } from './device-source-update.mjs'

const execute = promisify(execFile)
export async function sourceRevision(directory, executeImpl = execute) {
  try {
    const git = args => executeImpl('git', args, { cwd: directory, windowsHide: true,
      timeout: 2000, maxBuffer: 8192, encoding: 'utf8' })
    const root = (await git(['rev-parse', '--show-toplevel'])).stdout.trim()
    // A source ZIP nested inside an unrelated checkout is not that repository.
    if (await realpath(root) !== await realpath(directory)) return null
    const [head, reference] = await Promise.all([
      git(['rev-parse', '--verify', 'HEAD']),
      git(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(error => {
        if (error.code === 1) return { stdout: '' }
        throw error
      }),
    ])
    const commit = head.stdout.trim(), branch = reference.stdout.trim()
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit) || branch.length > 512 || /[\x00-\x1f\x7f]/.test(branch)) return null
    return { branch, commit, detached: !branch }
  } catch { return null }
}

class ManualUpdate {
  constructor({ version, mode, source }) {
    this.state = { runMode: mode, status: 'manual', version, source, canCheck: false, canDownload: false, canInstall: false,
      message: mode === 'portable' ? '当前为未安装的便携版，请使用新版 Windows 安装包手动安装。'
          : '当前平台暂不支持应用内在线更新，请下载对应平台的新版应用。' }
  }
  snapshot() { return structuredClone(this.state) }
  async check() { return { ...this.snapshot(), ok: !this.disposed } }
  async download() { return { ...this.snapshot(), ok: false } }
  async install() { return { ...this.snapshot(), ok: false } }
  cancel() { return this.snapshot() }
  dispose() { this.disposed = true }
}

export async function createDesktopUpdate({ isPackaged, sourceDirectory, readRevision = sourceRevision, ...options }) {
  if (!isPackaged) return new SourceUpdate({ ...options, sourceDirectory, source: await readRevision(sourceDirectory) })
  if (options.platform !== 'win32' || options.arch !== 'x64') return new ManualUpdate({ ...options, mode: 'unsupported' })
  return options.installed ? new DeviceUpdate(options) : new ManualUpdate({ ...options, mode: 'portable' })
}
