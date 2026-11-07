import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { redact } from './device-assistant-log.mjs'
import { CodexRolloutReader } from './device-codex-rollout.mjs'

const clean = (value, limit = 4000) => typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, limit) : ''
const fail = message => new Error(message)
const userRequest = items => items.filter(item => item?.type === 'userMessage')
  .map(item => (item.content || []).filter(part => part.type === 'text').map(part => clean(part.text, 1200)).join('\n'))
  .filter(Boolean).join('\n').slice(-1200)
const turnItems = (data, turnId) => (Array.isArray(data) ? data : []).filter(entry => !entry.turnId || entry.turnId === turnId).map(entry => entry.item || entry)
export function codexFailure(detail, fallback = 'Codex 连接失败，请检查本机安装与登录。') {
  if (/workspace routing discovery timed out/i.test(detail)) return 'Codex 账号工作空间路由查询超时，将自动重连；当前无法确认任务状态，请检查 Codex 的账号连接与网络。'
  if (/code-mode-host|配套执行程序/i.test(detail)) return 'Codex 配套执行程序缺失，请选择包含 codex-code-mode-host.exe 的完整 CLI 安装，不能只复制 codex.exe。'
  if (/sqlite state runtime|state runtime|access is denied|拒绝访问|permission denied/i.test(detail)) return 'Codex 数据目录不可访问，请使用当前 Windows 用户启动，检查 CODEX_HOME 目录权限后重新连接。'
  if (/not found|ENOENT|cannot find|找不到/i.test(detail)) return '找不到 Codex 运行程序，请安装 Codex CLI 或设置 PET_CODEX_BIN 为 codex.exe 的完整路径。'
  if (/auth|login|sign.?in|登录|unauthorized/i.test(detail)) return 'Codex 登录已失效，请在本机 Codex 中重新登录后重试。'
  if (/requires experimentalApi|method not found|invalid params/i.test(detail)) return 'Codex CLI 协议不兼容，请更新 CLI 后重连；可在诊断日志查看失败方法。'
  return fallback
}

export async function codexLaunch({ env = process.env, platform = process.platform, arch = process.arch } = {}) {
  const exists = file => stat(file).then(s => s.isFile()).catch(() => false)
  const complete = async file => await exists(file) && (platform !== 'win32' || await exists(path.join(path.dirname(file), 'codex-code-mode-host.exe')))
  const nativeLaunch = command => ({ command, args: ['app-server', '--listen', 'stdio://'] })
  if (env.PET_CODEX_BIN) {
    if (!(await exists(env.PET_CODEX_BIN))) throw fail('找不到 PET_CODEX_BIN 指定的 Codex 运行程序。')
    if (!(await complete(env.PET_CODEX_BIN))) throw fail(codexFailure('code-mode-host'))
    return nativeLaunch(env.PET_CODEX_BIN)
  }
  const bases = [...new Set([env.APPDATA && path.join(env.APPDATA, 'npm'),
    ...String(env.PATH || '').split(platform === 'win32' ? ';' : ':')].filter(Boolean))]
  let incomplete = false
  for (const base of bases) {
    const executable = path.join(base, 'codex.exe')
    const script = path.join(base, 'node_modules/@openai/codex/bin/codex.js')
    if (await exists(script)) {
      if (platform === 'win32') {
        const triple = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
        let vendor = path.resolve(script, '../../vendor')
        try { vendor = path.join(path.dirname(createRequire(script).resolve(`@openai/codex-win32-${arch}/package.json`)), 'vendor') } catch {}
        for (const directory of ['bin', 'codex']) {
          const native = path.join(vendor, triple, directory, 'codex.exe')
          if (await complete(native)) return nativeLaunch(native)
          if (await exists(native)) incomplete = true
        }
      } else {
        return { command: process.execPath, args: [script, 'app-server', '--listen', 'stdio://'],
          env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }
      }
    }
    if (await complete(executable)) return nativeLaunch(executable)
    if (await exists(executable)) incomplete = true
  }
  const bundled = platform === 'darwin'
    ? ['/Applications/Codex.app/Contents/Resources/codex', path.join(env.HOME || homedir(), 'Applications/Codex.app/Contents/Resources/codex')]
    : [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs/Codex/resources/codex.exe'),
      env.ProgramFiles && path.join(env.ProgramFiles, 'Codex/resources/codex.exe')].filter(Boolean)
  for (const executable of bundled) if (await complete(executable)) return nativeLaunch(executable)
  // Native CLI available through PATH on non-Windows hosts.
  if (platform !== 'win32') return nativeLaunch('codex')
  if (incomplete) throw fail(codexFailure('code-mode-host'))
  throw fail('未找到 Codex CLI，请先安装并在本机登录 Codex。')
}

export class DeviceCodex extends EventEmitter {
  constructor({ launch = codexLaunch, spawnProcess = spawn, approve = async () => ({ decision: 'decline' }),
    onActivity = () => {}, onReport = () => {}, log, requestMs = 30000, retryMs = 3000, monitorMs = 3000, externalStaleMs = 10 * 60000, monitorScope = () => undefined,
    rolloutReader = new CodexRolloutReader() } = {}) {
    super()
    Object.assign(this, { launch, spawnProcess, approve, onActivity, onReport, log, requestMs })
    Object.assign(this, { retryMs, monitorMs, monitorScope, externalStaleMs })
    this.rolloutReader = rolloutReader
    this.status = 'disconnected'; this.message = ''; this.cwd = ''; this.tasks = new Map()
    this.pending = new Map(); this.approvals = new Map(); this.nextId = 0; this.generation = 0
    this.monitorStartedAt = Date.now(); this.monitorCursor = null; this.monitorBaseline = true
  }
  snapshot() {
    return { status: this.status, message: this.message, cwd: this.cwd,
      monitoring: 'all-projects', autoConnect: this.autoConnect === true, totalTasks: this.tasks.size,
      monitorStatus: this.status !== 'ready' ? 'offline' : this.monitorError ? 'error' : this.lastMonitorAt ? 'ready' : 'pending',
      monitorError: this.monitorError || '', lastMonitorAt: this.lastMonitorAt || null,
      tasks: [...this.tasks.values()].sort((a, b) => Number(a.status === 'inProgress') - Number(b.status === 'inProgress') || a.updatedAt - b.updatedAt).slice(-100)
        .map(({ scope, instruction, hydrating, rolloutPath, ...task }) => ({ ...task, records: task.records.map(row => ({ ...row })) })) }
  }
  publish() { this.emit('state', this.snapshot()) }
  record(task, kind, text, id = `${Date.now()}-${++this.nextId}`, append = false) {
    if (!text) return
    let row = task.records.find(row => row.id === id)
    if (row && !append && row.text === clean(text)) return
    if (row) row.text = clean(append ? row.text + text : text)
    else { row = { id, kind, text: clean(text) }; task.records.push(row) }
    task.records = task.records.slice(-60)
    if (!task.hydrating) {
      task.updatedAt = Date.now()
      this.onActivity({ source: 'Codex', kind, text: row.text, key: `${task.id}:${task.lastTurnId || task.turnId || ''}:${id}` })
    }
    if (!task.hydrating && task.status === 'inProgress' && ['message', 'summary', 'plan', 'tool'].includes(kind) &&
        Date.now() - (task.reportAt || 0) >= 15000) {
      task.reportAt = Date.now()
      this.onReport({ id: task.id, turnId: task.lastTurnId || task.turnId, eventId: `codex:${task.id}:${task.lastTurnId || task.turnId}:progress:${task.reportAt}`, progress: true,
        scope: task.scope,
        text: `Codex 正在处理：${task.title}。${task.currentRequest ? `本轮要求：${task.currentRequest.slice(0, 240)}。` : ''}${row.text.slice(-220)}` })
    }
    this.updateTimer ||= setTimeout(() => { this.updateTimer = null; this.publish() }, 50)
  }
  connect() {
    clearTimeout(this.retryTimer); this.retryTimer = null
    if (this.status === 'ready') return Promise.resolve(this.snapshot())
    if (this.connecting) return this.connecting
    const generation = this.generation + 1
    this.connecting = this.initialize().catch(error => {
      if (generation === this.generation) this.shutdown('error', error.message || 'Codex 连接失败，请检查本机登录。')
      throw error
    }).finally(() => { this.connecting = null; if (this.status !== 'ready') this.scheduleReconnect() })
    return this.connecting
  }
  startAutoConnect() {
    this.autoConnect = true
    void this.connect().catch(() => {})
  }
  stopAutoConnect() {
    this.autoConnect = false
    clearTimeout(this.retryTimer); this.retryTimer = null
    this.shutdown()
  }
  scheduleReconnect() {
    if (!this.autoConnect || this.retryTimer) return
    const delay = Math.min(60000, this.retryMs * 2 ** Math.min(this.retryAttempts || 0, 5))
    this.retryAttempts = (this.retryAttempts || 0) + 1
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.autoConnect) void this.connect().catch(() => {}) }, delay)
    this.retryTimer.unref?.()
  }
  async initialize() {
    this.status = 'connecting'; this.message = '正在连接本机 Codex'; this.publish()
    const generation = ++this.generation
    const launch = await this.launch()
    if (generation !== this.generation) throw fail('连接已取消')
    this.log?.event('codex.launch', { command: launch.command })
    const child = this.child = this.spawnProcess(launch.command, launch.args, {
      cwd: launch.cwd || homedir(), env: launch.env || process.env, windowsHide: true,
      shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', data => { if (this.child === child) this.read(data) })
    this.stderrTail = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', value => { this.stderrTail = (this.stderrTail + redact(value)).slice(-8192) })
    child.stdin.on('error', () => { if (this.child === child) this.shutdown('error', 'Codex 通信已断开，请重新连接。') })
    const closed = error => {
      if (this.child !== child) return
      this.log?.event('codex.connection-failed', { message: error?.message, stderr: this.stderrTail })
      this.shutdown('error', codexFailure(`${error?.message || ''}\n${this.stderrTail}`, 'Codex 已退出，请检查安装与登录后重连。'))
    }
    child.on('error', closed); child.on('close', closed)
    await this.request('initialize', { clientInfo: { name: 'aibanlv', title: 'AIBanlv', version: '0.1.5' }, capabilities: { experimentalApi: true } })
    this.write({ method: 'initialized', params: {} })
    const account = await this.request('account/read', { refreshToken: false })
    if (account.requiresOpenaiAuth && !account.account) throw fail('请先在 Codex CLI 或 Codex 应用中登录，再点击连接。')
    if (generation !== this.generation) throw fail('连接已取消')
    this.status = 'ready'; this.message = 'Codex 已连接，可创建项目任务'; this.publish()
    this.retryAttempts = 0
    this.log?.event('codex.ready', {})
    clearInterval(this.monitorTimer)
    this.monitorTimer = setInterval(() => { void this.monitorProject().catch(error => {
      this.log?.event('codex.monitor-failed', { message: error.message })
    }) }, this.monitorMs)
    this.monitorTimer.unref?.()
    void this.monitorProject().catch(error => this.log?.event('codex.monitor-failed', { message: error.message }))
    return this.snapshot()
  }
  write(value) {
    if (!this.child || this.child.killed || this.child.stdin.destroyed) throw fail('Codex 未连接')
    this.child.stdin.write(JSON.stringify(value) + '\n')
  }
  request(method, params) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.log?.event('codex.timeout', { method, stderr: this.stderrTail })
        reject(fail(codexFailure(this.stderrTail, 'Codex 请求超时，请检查任务状态后重试。')))
      }, this.requestMs)
      this.pending.set(id, { resolve, reject, timer, method })
      try { this.write({ id, method, params }) }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }
  read(data) {
    this.buffer += data
    if (this.buffer.length > 4 * 1024 * 1024) { this.shutdown('error', 'Codex 返回的数据过大，连接已停止。'); return }
    let end
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1)
      if (!line.trim()) continue
      let value
      try { value = JSON.parse(line) } catch { this.shutdown('error', 'Codex 返回了无效消息。'); return }
      if (!value || typeof value !== 'object') continue
      if (value.method && value.id !== undefined) void this.serverRequest(value).catch(() => this.shutdown('error', 'Codex 请求处理失败，请重新连接。'))
      else if (value.id !== undefined) {
        const pending = this.pending.get(value.id)
        if (!pending) continue
        clearTimeout(pending.timer); this.pending.delete(value.id)
        if (value.error) {
          this.log?.event('codex.rpc-failed', { method: pending.method, code: value.error.code, message: value.error.message })
          pending.reject(fail(codexFailure(value.error.message || '', 'Codex 拒绝了请求，请检查登录、项目权限和任务状态。')))
        } else pending.resolve(value.result)
      } else if (value.method) {
        try { this.accept(value.method, value.params || {}) }
        catch { this.shutdown('error', 'Codex 消息格式不兼容，请检查 CLI 版本。'); return }
      }
    }
  }
  async serverRequest({ id, method, params = {} }) {
    const task = this.tasks.get(params.threadId), child = this.child
    if (!task || task.external || task.status !== 'inProgress' || params.turnId && task.turnId && params.turnId !== task.turnId) {
      try { this.write({ id, error: { code: -32601, message: 'Unmanaged request' } }) } catch {}
      return
    }
    if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput'].includes(method)) {
      this.write({ id, error: { code: -32601, message: 'Unsupported request' } }); return
    }
    const controller = new AbortController()
    this.approvals.set(id, { controller, taskId: task.id })
    this.record(task, 'approval', clean(params.reason || params.command || '任务需要你确认'), `approval:${id}`)
    try {
      const result = await this.approve({ id, method, title: task.title, params }, controller.signal)
      if (this.child === child && !controller.signal.aborted) this.write({ id, result })
    } catch {
      if (this.child === child && !controller.signal.aborted) this.write({ id, result: method === 'item/permissions/requestApproval'
        ? { permissions: {}, scope: 'turn' } : method === 'item/tool/requestUserInput' ? { answers: {} } : { decision: 'decline' } })
    } finally { this.approvals.delete(id) }
  }
  accept(method, params) {
    if (method === 'serverRequest/resolved') {
      this.approvals.get(params.requestId)?.controller.abort(); this.approvals.delete(params.requestId); return
    }
    const task = this.tasks.get(params.threadId)
    const turnId = params.turnId || params.turn?.id
    const expectedTurn = task?.turnId || task?.lastTurnId
    if (!task || turnId && expectedTurn && turnId !== expectedTurn && method !== 'turn/started') return
    if (method.endsWith('/delta') || method === 'item/reasoning/summaryTextDelta') {
      if (task.status !== 'inProgress') return
    }
    task.eventRevision = (task.eventRevision || 0) + 1
    if (method === 'turn/started') {
      if (expectedTurn !== params.turn.id) { task.result = ''; task.records = []; task.reportAt = 0; task.currentRequest = expectedTurn ? '' : task.currentRequest || '' }
      task.turnId = params.turn.id; task.lastTurnId = params.turn.id; task.status = 'inProgress'; task.syncError = ''; this.publish()
    }
    else if (method === 'turn/plan/updated') {
      this.record(task, 'plan', (params.plan || []).map(step => `${step.status === 'completed' ? '✓' : '○'} ${clean(step.step, 400)}`).join('\n'), 'plan')
    } else if (['item/agentMessage/delta', 'item/plan/delta', 'item/reasoning/summaryTextDelta'].includes(method)) {
      const kind = method.includes('reasoning') ? 'summary' : method.includes('/plan/') ? 'plan' : 'message'
      this.record(task, kind, clean(params.delta), `${params.itemId}:${kind}:${params.summaryIndex || 0}`, true)
    } else if (method === 'item/commandExecution/outputDelta') {
      this.record(task, 'output', clean(params.delta), `${params.itemId}:output`, true)
    } else if (method === 'item/started' || method === 'item/completed') {
      const item = params.item || {}
      if (item.type === 'userMessage') task.currentRequest = userRequest([item])
      else if (item.type === 'commandExecution') this.record(task, 'tool', `${method === 'item/started' ? '执行' : '完成'}：${clean(item.command, 1000)}`, item.id)
      else if (item.type === 'fileChange') this.record(task, 'tool', `文件变更：${(item.changes || []).map(change => clean(change.path, 400)).join('、')}`, item.id)
      else if (item.type === 'agentMessage' && method === 'item/completed') {
        const text = clean(item.text, 4000)
        if (!['commentary', 'partial_answer'].includes(item.phase)) task.result = text
        this.record(task, 'message', text, `${item.id}:message:0`)
      } else if (item.type === 'plan') this.record(task, 'plan', clean(item.text), `${item.id}:plan:0`)
      // Deliberately ignore raw reasoning text and raw provider items.
    } else if (method === 'turn/completed') {
      task.lastTurnId = params.turn?.id || task.turnId || task.lastTurnId
      task.status = params.turn?.status || 'failed'; task.turnId = ''; this.cancelApprovals(task.id)
      // Protocol completion means the turn ended, not that the user's objective
      // was achieved. Preserve the actual result, including blocked execution.
      const label = { completed: '本轮已结束', interrupted: '已中断', failed: '执行失败' }[task.status] || '已结束'
      this.record(task, 'status', `${task.title}：${label}`, 'status')
      if (task.reportedTurnId !== params.turn?.id) {
        task.reportedTurnId = params.turn?.id
        this.onReport({ id: task.id, turnId: params.turn?.id, scope:task.scope, eventId: `codex:${task.id}:${params.turn?.id}:${task.status}`, progress: false,
          text: `Codex ${label}：${task.title}。${task.currentRequest ? `本轮要求：${task.currentRequest.slice(0, 240)}。` : ''}${task.result || ''}`.slice(0, 900) })
      }
    } else if (method === 'error') this.record(task, 'error', '任务出现错误，请在 Codex 中检查账号额度、网络或执行权限。')
  }
  async create(prompt, cwd = this.cwd, { signal = new AbortController().signal, scope } = {}) {
    signal.throwIfAborted()
    if (this.status !== 'ready') throw fail('请先在插件中心连接 Codex。')
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 6000) throw fail('请输入 1-6000 字的任务内容。')
    if (!cwd || !path.isAbsolute(cwd) || !(await stat(cwd)).isDirectory()) throw fail('请先选择可用的任务项目文件夹。')
    if ([...this.tasks.values()].filter(task => !task.external).length >= 20) {
      const finished = [...this.tasks.values()].find(task => !task.external && task.status !== 'inProgress')
      if (!finished) throw fail('已有 20 个任务在运行，请先等待或停止部分任务。')
      this.tasks.delete(finished.id)
    }
    const { thread } = await this.request('thread/start', { cwd, approvalPolicy: 'on-request', sandbox: 'workspace-write' })
    signal.throwIfAborted()
    const task = { id: thread.id, title: clean(thread.name || prompt.trim(), 100), currentRequest: clean(prompt.trim(), 1200), instruction:prompt.trim(), scope, cwd, status: 'inProgress', turnId: '', records: [], result: '', updatedAt: Date.now() }
    this.tasks.set(task.id, task)
    this.record(task, 'status', `已创建：${task.title}`, 'status')
    this.onReport({ id: task.id, scope:task.scope, eventId: `codex:${task.id}:created`, progress: true, text: `Harness 已向 Codex 创建任务：${task.title}` })
    try {
      const { turn } = await this.request('turn/start', { threadId: task.id, input: [{ type: 'text', text: prompt.trim() }] })
      this.log?.event('codex.turn-started', { taskId: task.id, turnId: turn.id })
      if (task.status === 'inProgress') { task.turnId = turn.id; task.lastTurnId = turn.id }
      this.publish()
    } catch (error) {
      task.status = 'unknown'; this.record(task, 'error', '提交结果尚未确认；请刷新任务状态，避免重复创建。'); throw error
    }
    return { ok: true, taskId: task.id, message: `Codex 已接收任务：${task.title}` }
  }
  async refresh(selected = [...this.tasks.values()]) {
    if (this.status !== 'ready') return this.snapshot()
    const generation = this.generation
    const readTask = async task => {
      const revision = task.eventRevision || 0
      try {
        const observation = task.external && task.rolloutPath ? await this.rolloutReader.read({ id: task.id, file: task.rolloutPath }) : null
        if (generation !== this.generation || revision !== (task.eventRevision || 0)) return
        if (task.external && task.rolloutPath && !observation) {
          task.status = 'unknown'; task.result = ''; task.syncError = '最新运行记录尚未确认，不播报历史结果'; task.checkedAt = Date.now(); return
        }
        const { data } = observation ? { data: [{ id: observation.turnId, status: observation.status }] }
          : await this.request('thread/turns/list', { threadId: task.id, limit: 1, sortDirection: 'desc' })
        if (generation !== this.generation || revision !== (task.eventRevision || 0)) return
        const turn = data?.[0]
        if (turn) {
          if (typeof turn.id !== 'string' || !['inProgress', 'completed', 'failed', 'interrupted'].includes(turn.status)) throw fail('任务状态格式不兼容')
          if (task.external && turn.status === 'inProgress' && task.runtimeStatus !== 'active' &&
              Number.isFinite(Number(observation?.modifiedAt ?? Number(task.observedAt) * 1000)) && Date.now() - Number(observation?.modifiedAt ?? Number(task.observedAt) * 1000) > this.externalStaleMs) {
            task.status = 'unknown'; task.result = ''; task.syncError = '运行记录较旧，无法确认当前仍在执行，请到 Codex 原窗口核对'; task.checkedAt = Date.now(); return
          }
          if (task.external && !observation && turn.status === 'interrupted') {
            task.status = 'unknown'; task.result = ''; task.syncError = '外部任务中断状态尚未核实，请到 Codex 原窗口核对'; task.checkedAt = Date.now(); return
          }
          const items = observation ? { data: [...observation.items].reverse() }
            : await this.request('thread/items/list', { threadId: task.id, turnId: turn.id, limit: 12, sortDirection: 'desc' })
          if (generation !== this.generation || revision !== (task.eventRevision || 0)) return
          const previous = task.status, previousTurn = task.lastTurnId || task.turnId
          const newTurn = previousTurn !== turn.id, changed = previous !== turn.status || newTurn
          let latest = turnItems(items.data, turn.id).reverse(), request = userRequest(latest)
          if (!observation && !request && (newTurn || !task.currentRequest)) {
            const first = await this.request('thread/items/list', { threadId: task.id, turnId: turn.id, limit: 8, sortDirection: 'asc' })
            if (generation !== this.generation || revision !== (task.eventRevision || 0)) return
            request = userRequest(turnItems(first.data, turn.id))
          }
          const previousRecords = JSON.stringify(task.records)
          if (newTurn) { task.result = ''; task.records = []; task.reportAt = 0; task.currentRequest = previousTurn ? '' : task.currentRequest || '' }
          if (request) task.currentRequest = request
          const historical = task.baselinePending || previous === 'idle'
          task.hydrating = true
          task.status = turn.status; task.lastTurnId = turn.id; task.turnId = turn.status === 'inProgress' ? turn.id : ''
          task.syncError = ''; task.checkedAt = Date.now()
          for (const item of latest) {
            if (['agentMessage', 'commandExecution', 'fileChange', 'plan'].includes(item.type)) {
              this.accept(item.status === 'inProgress' ? 'item/started' : 'item/completed', { threadId: task.id, turnId: turn.id, item })
            } else if (item.type === 'reasoning' && Array.isArray(item.summary)) {
              const text = item.summary.map(part => typeof part === 'string' ? part : clean(part.text)).join('\n')
              if (text) this.record(task, 'summary', text, `${item.id}:summary:0`)
            }
          }
          task.hydrating = false
          if (turn.status === 'inProgress' && (newTurn || JSON.stringify(task.records) !== previousRecords) && Date.now() - (task.reportAt || 0) >= 15000) {
            const row = [...task.records].reverse().find(row => ['message','summary','plan','tool'].includes(row.kind))
            if (row) {
              task.reportAt = Date.now()
              this.onReport({ id:task.id, turnId:turn.id, scope:task.scope, progress:true, eventId:`codex:${task.id}:${turn.id}:progress:${task.reportAt}`,
                text:`Codex 正在处理：${task.title}。${task.currentRequest ? `本轮要求：${task.currentRequest.slice(0,240)}。` : ''}${row.text.slice(-220)}` })
            }
          }
          if (changed && !historical && turn.status !== 'inProgress') this.accept('turn/completed', { threadId: task.id, turn })
          if (historical && turn.status !== 'inProgress') task.reportedTurnId = turn.id
          task.baselinePending = false
        } else if (task.lastTurnId || task.turnId) {
          task.status = 'unknown'; task.result = ''; task.syncError = '尚未读取到任务轮次，请稍后核对'
        }
      } catch (error) {
        this.log?.event('codex.task-poll-failed', { taskId: task.id, message: error.message })
        if (generation === this.generation && revision === (task.eventRevision || 0)) {
          task.status = 'unknown'; task.syncError = '任务状态查询失败，请重试或到 Codex 原窗口核对'; task.result = ''
        }
      } finally { task.hydrating = false }
    }
    for (let offset = 0; offset < selected.length && generation === this.generation; offset += 4) {
      await Promise.all(selected.slice(offset, offset + 4).map(readTask))
    }
    this.publish(); return this.snapshot()
  }
  monitorProject() {
    if (this.status !== 'ready') return Promise.resolve()
    if (this.monitorJob) return this.monitorJob
    const generation = this.generation
    const job = this.scanProject().catch(error => {
      if (generation === this.generation) { this.monitorError = error.message; this.publish() }
      throw error
    }).finally(() => { if (this.monitorJob === job) this.monitorJob = null })
    this.monitorJob = job
    return job
  }
  async scanProject() {
    const generation = this.generation
    // Omit cwd and enumerate every source; the API otherwise defaults to CLI/VSCode only.
    const filters = { limit: 50, sortKey: 'updated_at',
      sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'] }
    const head = await this.request('thread/list', filters)
    const older = this.monitorCursor ? await this.request('thread/list', { ...filters, cursor: this.monitorCursor }) : null
    if (generation !== this.generation) return
    const changed = []
    for (const thread of [...head.data || [], ...older?.data || []]) {
      if (typeof thread.id !== 'string' || !thread.id || typeof thread.cwd !== 'string') continue
      let task = this.tasks.get(thread.id)
      if (!task) {
        // First observation establishes a baseline, even if metadata was recently
        // edited. A renamed old thread is not a newly completed turn.
        const historical = true
        task = { id: thread.id, title: clean(thread.name || thread.preview || 'Codex 项目任务', 100), cwd: thread.cwd,
          status: historical ? 'idle' : 'unknown', baselinePending: historical, turnId: '', records: [], result: '', external: true,
          scope: this.monitorScope(), updatedAt: Number(thread.updatedAt) * 1000 || Date.now() }
        this.tasks.set(thread.id, task)
        changed.push(task)
      } else if ((task.external && thread.path || task.observedAt !== thread.updatedAt || task.status === 'inProgress' || task.status === 'unknown' ||
          thread.status?.type === 'active' || (thread.name || thread.preview) && clean(thread.name || thread.preview,100) !== task.title) && !changed.includes(task)) changed.push(task)
      if (thread.name || thread.preview) task.title = clean(thread.name || thread.preview, 100)
      task.runtimeStatus = thread.status?.type || ''
      if (task.external && typeof thread.path === 'string') task.rolloutPath = thread.path
      if (task.external && Number.isFinite(Number(thread.updatedAt))) task.updatedAt = Number(thread.updatedAt) * 1000
      task.observedAt = thread.updatedAt
    }
    this.monitorCursor = (older || head).nextCursor || null
    this.monitorBaseline = false
    // Keep already-known active jobs hot while the historical cursor moves through other projects.
    for (const task of this.tasks.values()) if (task.status === 'inProgress' && !changed.includes(task)) changed.push(task)
    await this.refresh(changed)
    if (generation === this.generation) {
      this.lastMonitorAt = Date.now()
      this.monitorError = changed.some(task => task.syncError) ? '部分任务状态尚未确认，请重试或到 Codex 原窗口核对' : ''
      this.publish()
    }
  }
  async interrupt(taskId) {
    const task = this.tasks.get(taskId)
    if (task?.external) throw fail('这个任务由其他 Codex 窗口创建，请回到原窗口停止。')
    if (!task?.turnId || task.status !== 'inProgress') throw fail('这个任务没有正在运行的轮次。')
    await this.request('turn/interrupt', { threadId: task.id, turnId: task.turnId })
    return { ok: true, message: '已请求停止 Codex 任务' }
  }
  async execute(args) {
    if (args?.operation === 'create') return this.create(args.prompt)
    if (args?.operation === 'status') return { ok: true, tasks: (await this.refresh()).tasks.map(({ id, title, status, result }) => ({ id, title, status, result })) }
    if (args?.operation === 'interrupt') return this.interrupt(args.taskId)
    throw fail('不支持的 Codex 任务操作')
  }
  cancelApprovals(taskId) {
    for (const [id, value] of this.approvals) if (!taskId || value.taskId === taskId) { value.controller.abort(); this.approvals.delete(id) }
  }
  shutdown(status = 'disconnected', message = 'Codex 已断开') {
    clearTimeout(this.updateTimer); this.updateTimer = null
    clearInterval(this.monitorTimer)
    this.generation++; const child = this.child; this.child = null; child?.kill()
    this.monitorJob = null
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(fail(message)) }
    this.pending.clear(); this.cancelApprovals()
    for (const task of this.tasks.values()) if (task.status === 'inProgress') task.status = 'unknown'
    this.status = status; this.message = message; this.publish()
    if (status === 'error') this.scheduleReconnect()
  }
}
