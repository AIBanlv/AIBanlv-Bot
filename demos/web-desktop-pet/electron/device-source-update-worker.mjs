import { spawn } from 'node:child_process'
import { access, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { applySourceUpdate, runSourceCommand, sourceEnvironment, sourceError } from './device-source-git.mjs'

export const processAlive = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}
export async function writeSourceReceipt(config, status, message, extra = {}) {
  const temporary = `${config.receipt}.${config.token}.tmp`
  await writeFile(temporary, JSON.stringify({ token: config.token, job: config.jobFile, pid: process.pid, status, message, ...extra }), { mode: 0o600 })
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, config.receipt); break }
    catch (error) {
      if (attempt === 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error
      await delay(30 * (attempt + 1))
    }
  }
}

export async function performSourceUpdate(config, { run = runSourceCommand, launch = spawn, resume = false,
  report = (status, message) => writeSourceReceipt(config, status, message) } = {}) {
  await report('updating', '正在更新源码…')
  await applySourceUpdate(config.plan, { resume })
  const options = { cwd: config.plan.root, timeout: 35 * 60 * 1000,
    env: { ...sourceEnvironment(), PATH: `${path.dirname(config.node)}${path.delimiter}${process.env.PATH || ''}` } }
  if (config.plan.dependenciesChanged) {
    await report('dependencies', '正在安装更新所需的依赖，请稍候…')
    try {
      const manifest = JSON.parse(await readFile(path.join(config.plan.root, 'package.json'), 'utf8'))
      await run(config.node, [config.npm, 'ci', '--no-audit', '--no-fund'], options)
      await run(config.node, [config.npm, 'run', manifest.scripts?.['setup:deps'] ? 'setup:deps' : 'setup'], options)
    } catch { throw sourceError('SOURCE_DEPENDENCIES') }
  }
  if (config.plan.runtimeChanged || config.plan.dependenciesChanged && await access(path.join(config.plan.root, 'source-runtime.lock.json')).then(() => true, () => false)) {
    await report('runtime', '正在准备并验证本地推理运行资源。首次下载较大，请稍候…')
    try { await run(config.node, [path.join(config.plan.root, 'demos/web-desktop-pet/scripts/setup-runtime.mjs')], options) }
    catch (error) { throw sourceError(error.exitCode === 2 ? 'SOURCE_RUNTIME_CODE' : 'SOURCE_RUNTIME') }
  }
  await report('restarting', '更新已完成，正在重新打开 AIBanlv…')
  const child = launch(config.executable, config.args, { cwd: config.plan.root, env: sourceEnvironment(),
    shell: false, windowsHide: true, detached: true, stdio: 'ignore' })
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve) })
  child.unref()
  await report('done', '源码更新完成，已启动新版进程。')
}

async function retryUpdate(code) {
  const message = code === 'SOURCE_RUNTIME_CODE' ? '当前 Java 源码编译失败。请修复源码后重试；已下载的运行资源会继续保留。'
    : code === 'SOURCE_RUNTIME' ? '源码已更新，但本地推理资源准备失败。请检查网络、磁盘空间或自定义运行环境后重试。关闭后也可双击桌面快捷方式继续。'
    : code === 'SOURCE_DEPENDENCIES' ? '源码已更新，但依赖安装未完成。请检查网络，并关闭占用源码运行时的插件连接后重试。关闭此提示后，也可双击桌面快捷方式继续。'
    : '源码更新未完成。请检查 Git、网络或本地修改后点击“重试”。现有文件不会被强制覆盖。'
  try {
    if (process.platform === 'win32') {
      const script = "$ProgressPreference='SilentlyContinue'; Add-Type -AssemblyName System.Windows.Forms; " +
        `[Console]::Write([int][System.Windows.Forms.MessageBox]::Show('${message}', 'AIBanlv 源码更新', 'RetryCancel', 'Error'))`
      return (await runSourceCommand(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 24 * 60 * 60 * 1000 })).trim() === '4'
    }
    if (process.platform === 'darwin') {
      return (await runSourceCommand('/usr/bin/osascript', ['-e',
        'on run argv\nreturn button returned of (display dialog (item 1 of argv) with title "AIBanlv" buttons {"关闭", "重试"} default button "重试")\nend run', message],
      { timeout: 24 * 60 * 60 * 1000 })).trim() === '重试'
    }
  } catch {}
  return false
}

// The OS releases this checkout-wide lock on exit/crash. No stale file deletion race.
async function lockCheckout(root) {
  let name = await realpath(root)
  if (process.platform === 'win32') name = name.toLowerCase()
  const hash = createHash('sha256').update(name).digest('hex')
  const server = createServer(socket => socket.destroy())
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\aibanlv-update-${hash}`
    : { host: '127.0.0.1', port: 20000 + parseInt(hash.slice(0, 8), 16) % 40000, exclusive: true }
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(address, resolve) }) }
  catch (error) { if (error.code === 'EADDRINUSE') return null; throw error }
  return () => new Promise(resolve => server.close(resolve))
}

function showProgress(config) {
  if (process.platform === 'win32') {
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(path.dirname(fileURLToPath(import.meta.url)), 'device-source-update-progress.ps1'),
        '-Receipt', config.receipt, '-Token', config.token], { windowsHide: true, stdio: 'ignore' })
    child.on('error', () => {}); child.unref()
  }
}

export async function runSourceWorker(config, { alive = processAlive, waitMs = 120000, retry = retryUpdate,
  perform = performSourceUpdate, progress = true } = {}) {
  const cancelled = () => access(config.cancelFile).then(() => true, () => false)
  if (await cancelled()) return
  const release = await lockCheckout(config.plan.root)
  if (!release) return
  try {
    await writeSourceReceipt(config, 'waiting', '正在等待 AIBanlv 退出…')
    if (progress) showProgress(config)
    const deadline = Date.now() + waitMs
    while (alive(config.parentId)) {
      if (await cancelled() || Date.now() >= deadline) {
        await writeSourceReceipt(config, 'cancelled', '更新已取消：旧程序尚未退出。'); return
      }
      await delay(100)
    }
    if (await cancelled()) { await writeSourceReceipt(config, 'cancelled', '更新已取消。'); return }
    let resume = Boolean(config.resume)
    for (;;) {
      try { await perform(config, { resume }); return }
      catch (error) {
        await writeSourceReceipt(config, 'error', error.code === 'SOURCE_RUNTIME_CODE' ? 'Java 源码编译失败，请修复源码后重试。'
          : error.code === 'SOURCE_RUNTIME' ? '本地推理资源准备未完成，请重试源码更新。'
          : error.code === 'SOURCE_DEPENDENCIES' ? '依赖安装未完成，请重试源码更新。' : '源码更新未完成，请检查网络或本地修改后重试。', { code: error.code || 'SOURCE_RESTART' })
        if (!await retry(error.code)) return
        resume = true
        await writeSourceReceipt(config, 'updating', '正在重试源码更新…')
        if (progress) showProgress(config)
      }
    }
  } finally { await release() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
  await runSourceWorker(config).catch(async () => {
    await writeSourceReceipt(config, 'error', '源码更新进程异常，未完成更新。').catch(() => {})
  })
}
