import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { checkSourceUpdate, runSourceCommand, sourceCheckout, sourceEnvironment, sourceError } from './device-source-git.mjs'
import { processAlive } from './device-source-update-worker.mjs'

const messages = {
  SOURCE_DIRTY: '当前源码有未提交的修改。请先保存或提交这些修改，再检查更新；程序不会覆盖它们。',
  SOURCE_DETACHED: '当前源码未处于分支上，请先切换到需要更新的分支。',
  SOURCE_NO_UPSTREAM: '当前分支没有可更新的远程上游，请先配置该分支的上游。',
  SOURCE_DIVERGED: '本地与上游分支已有不同提交，请先处理分支差异；程序不会强制覆盖。',
  SOURCE_CHANGED: '检查后源码或分支发生变化，请重新检查更新。',
  SOURCE_IN_PROGRESS: '代码仓库正在进行合并、变基或其他 Git 操作，请完成后重试。',
  SOURCE_NOT_REPOSITORY: '当前目录不是源码仓库，无法自动更新。',
  SOURCE_TOOL_MISSING: '未找到 Git，请安装 Git 后重试。',
  SOURCE_NODE: '源码更新所需的 Node.js 24+ 尚未准备。Windows 请重新运行 Setup AIBanlv.cmd 自动准备；Mac 请安装代码目录之外的 Node.js 24+。',
  SOURCE_NPM: '未找到 Node.js 配套的 npm。Windows 请重新运行 Setup AIBanlv.cmd 修复，Mac 请修复 Node.js 安装后重试。',
  SOURCE_TIMEOUT: '源码更新操作超时，请检查网络后重试。',
  SOURCE_CANCELLED: '已取消检查更新。',
}
const receiptFile = directory => path.join(directory, 'source-update.json')
export async function sourceUpdateActive(directory) {
  try {
    const value = JSON.parse(await readFile(receiptFile(directory), 'utf8'))
    return !['done', 'cancelled', 'restarting'].includes(value.status) && Number.isSafeInteger(value.pid) && value.pid > 0 && processAlive(value.pid)
  } catch { return false }
}

export async function pendingSourceUpdate(directory, root) {
  try {
    const receipt = JSON.parse(await readFile(receiptFile(directory), 'utf8'))
    if (receipt.status === 'done') return null
    const config = JSON.parse(await readFile(receipt.job, 'utf8'))
    if (config.token !== receipt.token || path.resolve(config.plan.root) !== path.resolve(root)) return null
    if (receipt.status === 'cancelled' && !config.resume) return null
    return config
  } catch { return null }
}

// Used by the source shortcut even when an interrupted npm ci removed Electron.
export async function resumeSourceUpdate(directory, root, launch = spawn) {
  const config = await pendingSourceUpdate(directory, root)
  if (!config) return false
  if (await sourceUpdateActive(directory) || processAlive(config.parentId)) return true
  const current = await sourceCheckout(root)
  if (current.branch !== config.plan.branch || ![config.plan.head, config.plan.target].includes(current.head)) throw sourceError('SOURCE_CHANGED')
  const stage = path.dirname(config.jobFile), token = randomUUID()
  Object.assign(config, { parentId: 0, resume: true, token, jobFile: path.join(stage, `${token}.json`), cancelFile: path.join(stage, `${token}.cancel`) })
  await writeFile(config.jobFile, JSON.stringify(config), { mode: 0o600 })
  await launchSourceWorker(config, { launch })
  return true
}

async function launchSourceWorker(config, { launch = spawn, timeout = 10000 } = {}) {
  let stopped = false
  try {
    const child = launch(config.node, [path.join(path.dirname(config.jobFile), 'device-source-update-worker.mjs'), config.jobFile],
      { env: sourceEnvironment(), windowsHide: true, detached: true, stdio: 'ignore', shell: false })
    child.once('error', () => { stopped = true }); child.once('exit', () => { stopped = true }); child.unref()
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const receipt = await readFile(config.receipt, 'utf8').then(JSON.parse, () => null).catch(() => null)
      if (receipt?.token === config.token && receipt.pid === child.pid &&
          (config.parentId ? receipt.status === 'waiting' && processAlive(child.pid) : receipt.status !== 'cancelled')) return
      if (stopped) break
      await delay(40)
    }
    throw sourceError('SOURCE_HANDOFF')
  } catch (error) {
    await writeFile(config.cancelFile, '', { mode: 0o600 })
    throw error
  }
}

export async function sourceTools(root, env = process.env) {
  const candidates = [], repository = await realpath(root)
  const outside = file => { const relative = path.relative(repository, file); return relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) }
  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    try {
      const saved = JSON.parse(await readFile(path.join(env.LOCALAPPDATA, 'AIBanlv/tools/source-node.json'), 'utf8'))
      if (typeof saved.node === 'string' && path.isAbsolute(saved.node)) candidates.push(saved.node)
    } catch {}
  }
  candidates.push('node')
  let failure = 'SOURCE_NODE'
  for (const executable of candidates) {
    try {
      const options = { env: sourceEnvironment(env) }
      const info = JSON.parse(await runSourceCommand(executable, ['-p', 'JSON.stringify({file:process.execPath,major:Number(process.versions.node.split(".")[0]),arch:process.arch})'], options))
      const node = await realpath(info.file)
      if (info.major < 24 || !outside(node) || (process.platform === 'win32' && info.arch !== 'x64')) continue
      failure = 'SOURCE_NPM'
      for (const candidate of [path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js'),
        path.resolve(path.dirname(node), '../lib/node_modules/npm/bin/npm-cli.js'), path.join(path.dirname(node), 'npm')]) {
        try {
          const npm = await realpath(candidate)
          if (!npm.endsWith('npm-cli.js') || !outside(npm)) continue
          await runSourceCommand(node, [npm, '--version'], options)
          return { node, npm }
        } catch {}
      }
    } catch {}
  }
  throw sourceError(failure)
}

export async function prepareSourceHandoff({ plan, directory, executable = process.execPath,
  args = [path.join(plan.root, 'demos/web-desktop-pet/electron/device-main.mjs')], tools, launch = spawn, timeout = 10000 }) {
  const current = await sourceCheckout(plan.root)
  if (current.branch !== plan.branch || (current.head !== plan.head && !(plan.recovery && current.head === plan.target))) throw sourceError('SOURCE_CHANGED')
  if (await sourceUpdateActive(directory)) throw sourceError('SOURCE_IN_PROGRESS')
  tools ??= await sourceTools(plan.root)
  await mkdir(directory, { recursive: true })
  const stage = await mkdtemp(path.join(tmpdir(), 'aibanlv-source-update-'))
  for (const name of ['device-source-git.mjs', 'device-source-update-worker.mjs']) {
    await copyFile(new URL(`./${name}`, import.meta.url), path.join(stage, name))
  }
  // Windows PowerShell 5.1 requires a BOM to read Chinese script literals correctly.
  await writeFile(path.join(stage, 'device-source-update-progress.ps1'), '\ufeff' +
    (await readFile(new URL('./device-source-update-progress.ps1', import.meta.url), 'utf8')).replace(/^\ufeff/, ''))
  const token = randomUUID(), config = { plan, ...tools, executable, args, token, parentId: process.pid,
    resume: Boolean(plan.recovery), receipt: receiptFile(directory), cancelFile: path.join(stage, 'cancel'), jobFile: path.join(stage, 'job.json') }
  await writeFile(config.jobFile, JSON.stringify(config), { mode: 0o600 })
  await launchSourceWorker(config, { launch, timeout })
}

export class SourceUpdate {
  constructor({ directory, sourceDirectory, source, version, onState = () => {}, sourceQuit = () => {},
    sourceCheck = checkSourceUpdate, sourcePrepare = prepareSourceHandoff }) {
    Object.assign(this, { directory, sourceDirectory, onState, sourceQuit, sourceCheck, sourcePrepare })
    this.state = { runMode: 'source', status: 'idle', version, source, message: '检查当前分支的源码更新。' }
  }
  snapshot() { return { ...this.state, canCheck: !this.disposed, canDownload: false,
    canInstall: Boolean(this.plan?.available) && !this.busy && !this.disposed } }
  publish(status, message, extra = {}) {
    Object.assign(this.state, { status, message }, extra); this.onState(this.snapshot()); return this.snapshot()
  }
  denied() { return { ...this.snapshot(), ok: false } }
  async check() {
    if (this.busy || this.disposed || this.state.status === 'installing') return this.denied()
    this.busy = true; this.plan = null; this.abort = new AbortController()
    this.publish('checking', '正在检查当前分支的上游更新…', { targetCommit: null })
    try {
      const pending = await pendingSourceUpdate(this.directory, this.sourceDirectory)
      if (this.disposed || this.abort.signal.aborted) throw sourceError('SOURCE_CANCELLED')
      const options = { signal: this.abort.signal }
      const plan = pending ? await sourceCheckout(this.sourceDirectory, options) : await this.sourceCheck(this.sourceDirectory, options)
      if (this.disposed || this.abort.signal.aborted) throw sourceError('SOURCE_CANCELLED')
      if (pending) {
        if (plan.branch !== pending.plan.branch || ![pending.plan.head, pending.plan.target].includes(plan.head)) throw sourceError('SOURCE_CHANGED')
        Object.assign(plan, { target: pending.plan.target, available: true, dependenciesChanged: pending.plan.dependenciesChanged,
          runtimeChanged: pending.plan.runtimeChanged, recovery: true })
      }
      this.plan = plan; this.busy = false
      return { ...this.publish(plan.available ? 'available' : 'current', plan.available
        ? plan.recovery ? '上次更新尚未完成，点击“更新并重启”继续安装并启动。' : '发现源码更新。更新期间程序会暂时关闭，完成后自动重新打开。' : '当前源码已包含上游最新提交。',
      { source: { branch: plan.branch.replace(/^refs\/heads\//, ''), commit: plan.head, detached: false },
        targetCommit: plan.available ? plan.target : null, dependenciesChanged: plan.dependenciesChanged }), ok: true }
    } catch (error) {
      this.busy = false
      return { ...this.publish('error', messages[error.code] || '检查源码更新失败，请检查网络和 Git 访问权限后重试。'), ok: false }
    } finally { this.busy = false; this.abort = null }
  }
  async install() {
    if (!this.plan?.available || this.busy || this.disposed || this.state.status === 'installing') return this.denied()
    this.busy = true; this.publish('preparing', '正在准备源码更新，请稍候…')
    try {
      await this.sourcePrepare({ plan: this.plan, directory: this.directory })
      this.publish('installing', '即将退出并更新源码，完成后自动启动。')
      setImmediate(() => this.sourceQuit())
      return { ...this.snapshot(), ok: true }
    } catch (error) {
      this.busy = false
      return { ...this.publish('error', messages[error.code] || '无法启动源码更新进程，请重试。'), ok: false }
    }
  }
  async download() { return this.denied() }
  cancel() { this.abort?.abort(); return this.snapshot() }
  dispose() { this.disposed = true; this.abort?.abort() }
}
