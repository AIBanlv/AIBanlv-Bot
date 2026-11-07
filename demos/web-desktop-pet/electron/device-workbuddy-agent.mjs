import { EventEmitter } from 'node:events'
import { spawn, execFile } from 'node:child_process'
import { stat, realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const text = (value, max = 4000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : ''
const isFile = file => stat(file).then(info => info.isFile()).catch(() => false)
const execute = promisify(execFile)
async function checkPermissionMode(launch, cwd, signal) {
  try {
    const { stdout } = await execute(launch.command, [...launch.args, '--help'], {
      cwd, env: launch.env || process.env, signal, timeout: 10000, maxBuffer: 1024 * 1024,
      shell: false, windowsHide: true,
    })
    if (/--permission-mode\b[\s\S]{0,1000}\bdontAsk\b/.test(stdout)) return
  } catch { signal.throwIfAborted() }
  throw new Error('WorkBuddy 运行时未确认支持 dontAsk 权限模式，请更新 WorkBuddy，或在其客户端中执行并授权任务')
}
export async function workbuddyLaunch({ env: environment = process.env, platform = process.platform, home = homedir() } = {}) {
  const config = environment.WORKBUDDY_CONFIG_DIR || path.join(home, '.workbuddy')
  const resource = 'resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs'
  const roots = platform === 'darwin'
    ? ['/Applications/WorkBuddy.app/Contents', path.join(home, 'Applications/WorkBuddy.app/Contents')]
    : [environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Programs/WorkBuddy'),
      environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'WorkBuddy'),
      environment.ProgramFiles && path.join(environment.ProgramFiles, 'WorkBuddy'),
      environment['ProgramFiles(x86)'] && path.join(environment['ProgramFiles(x86)'], 'WorkBuddy')]
  const candidates = environment.PET_WORKBUDDY_CLI ? [environment.PET_WORKBUDDY_CLI]
    : roots.filter(Boolean).map(root => path.join(root, platform === 'darwin' ? resource.replace(/^resources/, 'Resources') : resource))
  const script = await (async () => { for (const file of candidates) if (path.isAbsolute(file) && await isFile(file)) return file })()
  if (!script) throw new Error('未找到 WorkBuddy 任务运行时，请先安装 WorkBuddy；自定义安装可设置 PET_WORKBUDDY_CLI')
  const env = { ...environment, CODEBUDDY_CONFIG_DIR: config, WORKBUDDY_CONFIG_DIR: config,
    CODEBUDDY_FORCE_LITE_WB_BUNDLE: '1', ELECTRON_RUN_AS_NODE: '1' }
  return path.extname(script).toLowerCase() === '.exe' ? { command: script, args: [], env }
    : { command: process.execPath, args: [script], env }
}

// WorkBuddy's bundled CodeBuddy CLI supports headless streaming. Reading its
// task files is monitoring only; it never starts work, hence this separate adapter.
export class WorkBuddyAgent extends EventEmitter {
  constructor({ launch = workbuddyLaunch, spawnProcess = spawn, onActivity = () => {}, onReport = () => {}, log, taskMs = 30 * 60000 } = {}) {
    super(); Object.assign(this, { launch, spawnProcess, onActivity, onReport, log, taskMs })
    this.cwd = ''; this.tasks = new Map(); this.running = new Map()
  }
  snapshot() { return { cwd: this.cwd, tasks: [...this.tasks.values()].map(({ scope, ...task }) => ({ ...task, records: task.records.map(row => ({ ...row })) })) } }
  publish() { this.emit('state', this.snapshot()) }
  record(task, kind, value, key = kind) {
    const content = text(value); if (!content) return
    let row = task.records.find(row => row.id === key)
    if (row?.text === content) return
    if (row) row.text = content
    else { row = { id: key, kind, text: content }; task.records.push(row) }
    task.records = task.records.slice(-60)
    this.onActivity({ source: 'WorkBuddy', kind, text: content, key: `${task.id}:${key}` })
    if (kind === 'message' && Date.now() - (task.reportAt || 0) > 15000) {
      task.reportAt = Date.now(); this.onReport({ id: task.id, scope: task.scope, eventId: `wb:${task.id}:progress:${task.reportAt}`, progress: true, text: `WorkBuddy 正在处理：${task.title}。${content.slice(-220)}` })
    }
    this.publish()
  }
  async create(prompt, cwd = this.cwd, { signal = new AbortController().signal, scope } = {}) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 6000) throw new Error('请输入 1-6000 字的 WorkBuddy 任务')
    if (!cwd || !path.isAbsolute(cwd) || !(await stat(cwd)).isDirectory()) throw new Error('请先在插件中心选择 WorkBuddy 任务项目文件夹')
    cwd = await realpath(cwd)
    if (this.running.size >= 4) throw new Error('WorkBuddy 已有 4 个任务在运行，请先等待或停止')
    const launch = await this.launch(); signal.throwIfAborted()
    // The headless bridge cannot answer interactive approvals. Only the Host's
    // already-authorized tools may run; unsupported modes never fall back to auto.
    await checkPermissionMode(launch, cwd, signal)
    signal.throwIfAborted()
    if (this.running.size >= 4) throw new Error('WorkBuddy 已有 4 个任务在运行，请先等待或停止')
    const id = randomUUID(), task = { id, title: text(prompt.trim(), 100), scope, cwd, status: 'inProgress', result: '', records: [] }
    const child = this.spawnProcess(launch.command, [...launch.args, '--print', '--verbose', '--output-format', 'stream-json',
      '--include-partial-messages', '--permission-mode', 'dontAsk', '--max-turns', '30', '--session-id', id],
    { cwd, env: launch.env || process.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const run = { child, buffer: '', stderr: '', received: false }
    this.tasks.set(id, task); this.running.set(id, run)
    while (this.tasks.size > 20) {
      const old = [...this.tasks.values()].find(value => value.status !== 'inProgress')
      if (!old) break
      this.tasks.delete(old.id)
    }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stderr.on('data', value => { run.stderr = (run.stderr + value).slice(-4096) })
    child.stdout.on('data', chunk => {
      run.buffer += chunk
      if (run.buffer.length > 1024 * 1024) { this.finish(task, 'failed', 'WorkBuddy 返回的数据过大'); this.terminate(run); return }
      let end
      while ((end = run.buffer.indexOf('\n')) >= 0) {
        const line = run.buffer.slice(0, end); run.buffer = run.buffer.slice(end + 1)
        try { this.accept(task, JSON.parse(line)) } catch { /* Ignore CLI banners, never render them as task output. */ }
      }
    })
    child.stdin.on('error', () => { this.finish(task, 'failed', 'WorkBuddy 输入连接已断开'); this.terminate(run) })
    child.once('error', error => {
      this.log?.event('workbuddy.spawn-failed', { message: error.message })
      this.finish(task, 'failed', 'WorkBuddy 未能启动，请检查本机安装与登录')
    })
    child.once('close', code => {
      if (run.buffer.trim()) { try { this.accept(task, JSON.parse(run.buffer)) } catch {} }
      clearTimeout(run.timer); clearTimeout(run.cleanup); this.running.delete(id)
      this.log?.event('workbuddy.exit', { code, stderr: run.stderr })
      if (task.status === 'inProgress') this.finish(task, 'failed', /auth|login|登录|credential|api.?key/i.test(run.stderr)
        ? 'WorkBuddy 登录不可用，请在 WorkBuddy 中重新登录后重试' : 'WorkBuddy 已退出，但未返回可验证的任务完成结果')
    })
    run.timer = setTimeout(() => { this.finish(task, 'failed', 'WorkBuddy 任务超时，已请求终止'); this.terminate(run) }, this.taskMs)
    run.timer.unref?.()
    this.record(task, 'status', `已提交：${task.title}`)
    this.onReport({ id, scope: task.scope, eventId: `wb:${id}:created`, progress: true, text: `Harness 已向 WorkBuddy 提交任务：${task.title}` })
    // Prompt travels over stdin, never through a shell or a flag parser.
    child.stdin.end(prompt.trim())
    return { ok: true, taskId: id, message: `Harness 已向 WorkBuddy 提交任务：${task.title}，尚未完成` }
  }
  accept(task, value) {
    if (task.status !== 'inProgress' || !value || typeof value !== 'object') return
    const run = this.running.get(task.id); if (!run) return
    if (value.type === 'stream_event') {
      const event = value.event
      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const key = `text:${value._messageId || value.message_id || 'current'}`
        const previous = task.records.find(row => row.id === key)?.text || ''
        this.record(task, 'message', previous + text(event.delta.text), key)
      }
      // Never publish thinking_delta, signatures or other hidden reasoning.
    } else if (value.type === 'assistant') {
      const content = (value.message?.content || []).filter(part => part.type === 'text').map(part => text(part.text)).join('\n')
      if (content) this.record(task, 'message', content, `text:${value._messageId || value.message?.id || 'current'}`)
      for (const part of value.message?.content || []) if (part.type === 'tool_use') this.record(task, 'tool', `执行：${text(part.name, 100)}`, `tool:${part.id}`)
    } else if (value.type === 'result') {
      run.received = true
      const denied = Array.isArray(value.permission_denials) && value.permission_denials.length > 0
      const success = !denied && value.is_error !== true && (value.subtype === 'success' || !value.subtype && value.is_error === false)
      if (!success) this.log?.event('workbuddy.result-failed', { message: value.result, subtype: value.subtype, denied })
      this.finish(task, success ? 'completed' : 'failed', success ? text(value.result) || 'WorkBuddy 返回成功结果'
        : denied ? 'WorkBuddy 操作被其安全策略拒绝，任务未全部完成' : 'WorkBuddy 任务失败，请检查登录、额度和任务权限；诊断日志保留脱敏原因')
    }
  }
  finish(task, status, result, report = true) {
    if (task.status !== 'inProgress') return
    task.status = status; task.result = result
    const run = this.running.get(task.id)
    clearTimeout(run?.timer)
    // A terminal result is authoritative, but a misbehaving CLI must not retain
    // a process slot forever after emitting it.
    if (run) { run.cleanup = setTimeout(() => this.terminate(run), 5000); run.cleanup.unref?.() }
    const label = { completed: '已完成', interrupted: '已中断', failed: '失败' }[status]
    this.record(task, 'status', `${task.title}：${label}。${result}`, 'status')
    if (report) this.onReport({ id: task.id, scope:task.scope, eventId: `wb:${task.id}:${status}`, progress: false, text: `WorkBuddy 任务${label}：${task.title}。${result}`.slice(0, 900) })
  }
  terminate(run) {
    if (run.child.exitCode != null || run.child.killed) return
    if (process.platform === 'win32' && Number.isInteger(run.child.pid)) {
      execFile('taskkill.exe', ['/PID', String(run.child.pid), '/T', '/F'], { windowsHide: true }, () => {})
    } else run.child.kill()
  }
  async interrupt(id) {
    const task = this.tasks.get(id), run = this.running.get(id)
    if (!run || task?.status !== 'inProgress') throw new Error('没有这个正在运行的 WorkBuddy 任务')
    this.finish(task, 'interrupted', '已请求停止，已发生的文件变更不会自动撤销'); this.terminate(run)
    return { ok: true, message: '已请求停止 WorkBuddy 任务' }
  }
  shutdown() { for (const [id, run] of this.running) { this.finish(this.tasks.get(id), 'interrupted', '会话结束，已请求停止', false); this.terminate(run) } }
}
