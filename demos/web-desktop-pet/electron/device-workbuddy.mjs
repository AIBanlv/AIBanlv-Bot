import { readdir, open, stat, mkdir, writeFile, rm } from 'node:fs/promises'
import { watch } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

// WorkBuddy keeps every task it runs on this machine: the agent's task list
// under `tasks/<session>/<id>.json` and the whole run, line by line, under
// `projects/<workspace>/<session>.jsonl`. Nothing has to be installed or
// configured to read them, which is what makes this a local integration rather
// than a cloud one: the desktop watches the same files the app writes.
const pendingTools = new Set(['AskUserQuestion', 'ExitPlanMode'])
const configDirectory = () => process.env.WORKBUDDY_CONFIG_DIR?.trim() ||
  path.join(homedir() || process.env.USERPROFILE || '', '.workbuddy')
const oneLine = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)

const messageText = message => {
  const parts = Array.isArray(message?.content) ? message.content : []
  return parts.map(part => (typeof part?.text === 'string' ? part.text : '')).join(' ').trim()
}
const questionOf = value => {
  let parsed
  try { parsed = JSON.parse(typeof value === 'string' ? value : '') } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const question = oneLine(parsed.question || parsed.plan || '', 160)
  const options = Array.isArray(parsed.options) ? parsed.options
    .map(option => oneLine(option?.label || option?.description || '', 40)).filter(Boolean) : []
  return question || options.length ? { question: question || '需要你确认', options: options.slice(0, 4) } : null
}

export class WorkBuddyBridge {
  #watchers = []
  #timer = null
  constructor({ configDir = configDirectory(), onEvent = () => {}, now = Date.now,
    textLimit = 160, replyLimit = 240, sessionLimit = 24, settleMs = 1500, replyCooldownMs = 20000 }) {
    Object.assign(this, { configDir, onEvent, now, textLimit, replyLimit, sessionLimit, settleMs, replyCooldownMs })
    this.sessions = new Map()
    this.tasks = new Map()
    this.pending = new Map()
    this.seen = new Set()
    this.answers = new Map()
    this.started = false
    this.primed = false
  }
  get projects() { return path.join(this.configDir, 'projects') }
  get taskDirectory() { return path.join(this.configDir, 'tasks') }
  get bridgeDirectory() { return path.join(this.configDir, 'wb-bridge') }
  start() {
    if (this.started) return this.scan()
    this.started = true
    // Watchers miss events often enough on Windows; the timer is the safety net,
    // not the primary path.
    for (const directory of [this.projects, this.taskDirectory]) {
      try {
      const watcher = watch(directory, { recursive: true }, () => { this.schedule() })
      watcher.on('error', () => {})
      this.#watchers.push(watcher)
      } catch { /* WorkBuddy may not be installed; polling still detects later installation. */ }
    }
    this.#timer = setInterval(() => { this.schedule() }, 2000)
    this.#timer.unref?.()
    return this.scan()
  }
  schedule() {
    if (this.scanning) return
    this.scanning = setTimeout(() => { this.scanning = null; this.scan().catch(() => {}) }, 200)
  }
  stop() {
    this.started = false
    clearTimeout(this.scanning); clearInterval(this.#timer)
    this.scanning = null; this.#timer = null
    for (const watcher of this.#watchers.splice(0)) watcher.close()
  }
  emit(type, fields) {
    const key = `${type}:${fields.id || ''}:${fields.key || ''}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    while (this.seen.size > 512) this.seen.delete(this.seen.values().next().value)
    // The first pass reads months of history; announcing it would flood the pet
    // before the user has asked for anything. Only what happens afterwards counts.
    if (!this.primed) return
    this.announce(type, fields)
  }
  // One sentence the pet can say out loud. It is written for the ear, so the
  // tool's own names never appear.
  announce(type, fields) {
    this.onEvent({ type, ...fields, at: this.now() })
  }
  async scan() {
    await Promise.all([this.scanSessions(), this.scanTasks()]).catch(() => {})
    this.trim()
    this.primed = true
  }
  trim() {
    // Keep offsets for every discovered task; forgetting old offsets replays history
    // and excludes less recently active projects. Only the UI view is bounded.
  }
  async scanSessions() {
    const workspaces = await readdir(this.projects, { withFileTypes: true }).catch(() => [])
    for (const entry of workspaces) {
      if (!entry.isDirectory()) continue
      const workspace = path.join(this.projects, entry.name)
      const names = await readdir(workspace).catch(() => [])
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue
        await this.readSession(entry.name, workspace, name.slice(0, -'.jsonl'.length))
      }
    }
  }
  async readSession(workspaceName, workspace, id) {
    const file = path.join(workspace, `${id}.jsonl`)
    const info = await stat(file).catch(() => null)
    if (!info) return
    const session = this.sessions.get(id) || this.sessions.set(id,
      { id, workspace: workspaceName, cwd: '', title: '', offset: 0, updatedAt: 0, reply: '' }).get(id)
    // The file is only ever appended to; a shorter file means it was rewritten.
    if (info.size < session.offset) session.offset = 0
    if (info.size === session.offset) { this.review(session); return }
    const handle = await open(file, 'r').catch(() => null)
    if (!handle) return
    try {
      if (info.size - session.offset > 1024 * 1024) session.offset = info.size - 1024 * 1024
      const size = info.size - session.offset
      const buffer = Buffer.alloc(size)
      await handle.read(buffer, 0, size, session.offset)
      const chunk = buffer.toString('utf8')
      // A half-written last line is left for the next pass rather than parsed.
      const end = chunk.lastIndexOf('\n')
      if (end < 0) return
      session.offset += end + 1
      for (const line of chunk.slice(0, end).split('\n')) {
        if (!line) continue
        let value
        try { value = JSON.parse(line) } catch { continue }
        this.accept(session, value)
      }
      session.updatedAt = this.now()
    } catch { return } finally { await handle.close().catch(() => {}) }
    this.review(session)
  }
  accept(session, value) {
    if (!value || typeof value !== 'object') return
    if (typeof value.cwd === 'string' && !session.cwd) session.cwd = value.cwd.slice(0, 260)
    if (value.type === 'session-meta' && typeof value.sessionId === 'string' && value.sessionId) session.id = value.sessionId.slice(0, 64)
    if (value.type === 'ai-title' && typeof value.aiTitle === 'string' && value.aiTitle &&
        value.aiTitle !== session.title) {
      session.title = oneLine(value.aiTitle, 120)
      session.updatedAt = Number(value.timestamp) || this.now()
      this.emit('task.created', { id: session.id, key: session.title, title: session.title,
        workspace: session.workspace, cwd: session.cwd })
    }
    if (value.type === 'message' && value.role === 'assistant' && value.status !== 'failed') {
      const reply = oneLine(messageText(value), this.replyLimit)
      if (reply && reply !== session.reply) {
        session.reply = reply
        session.updatedAt = Number(value.timestamp) || this.now()
        // A run says many things; only the first one in a while is worth a voice.
        if (this.now() - (session.repliedAt || 0) >= this.replyCooldownMs) {
          session.repliedAt = this.now()
          this.emit('task.reply', { id: session.id, key: reply.slice(0, 60), text: reply, title: session.title })
        }
      }
    }
    if (value.type === 'function_call' && pendingTools.has(value.name) && typeof value.callId === 'string' && this.primed) {
      const asked = questionOf(value.arguments)
      session.pending = { callId: value.callId.slice(0, 128), tool: value.name, at: Number(value.timestamp) || this.now(),
        question: asked?.question || '', options: asked?.options || [], announced: false }
      session.updatedAt = Number(value.timestamp) || this.now()
    }
    if (value.type === 'function_call_result' && session.pending?.callId === value.callId) {
      const pending = session.pending
      session.pending = null
      this.pending.delete(pending.callId)
      this.emit('task.confirmed', { id: session.id, key: pending.callId, title: session.title })
    }
  }
  // A question is only worth interrupting for once it has clearly been waiting;
  // an answer that arrives in the same breath must stay silent.
  review(session) {
    const pending = session.pending
    if (!pending || pending.announced || this.now() - pending.at < this.settleMs) return
    pending.announced = true
    this.pending.set(pending.callId, { ...pending, sessionId: session.id, title: session.title, cwd: session.cwd })
    this.emit('task.confirm', { id: session.id, key: pending.callId, title: session.title,
      question: pending.question, options: pending.options, callId: pending.callId })
  }
  async scanTasks() {
    const directories = await readdir(this.taskDirectory, { withFileTypes: true }).catch(() => [])
    for (const entry of directories) {
      if (!entry.isDirectory()) continue
      const names = await readdir(path.join(this.taskDirectory, entry.name)).catch(() => [])
      for (const name of names) {
        if (!/^\d+\.json$/.test(name)) continue
        await this.readTask(entry.name, name)
      }
    }
  }
  async readTask(sessionId, name) {
    const file = path.join(this.taskDirectory, sessionId, name)
    const info = await stat(file).catch(() => null)
    if (!info || info.size > 65536) return
    const handle = await open(file, 'r').catch(() => null)
    if (!handle) return
    let value
    try {
      const buffer = Buffer.alloc(info.size)
      await handle.read(buffer, 0, info.size, 0)
      value = JSON.parse(buffer.toString('utf8'))
    } catch { return } finally { await handle.close().catch(() => {}) }
    if (!value || typeof value !== 'object' || typeof value.subject !== 'string') return
    const key = `${sessionId}/${name}`
    const subject = oneLine(value.subject, 120)
    const state = value.status === 'completed' ? 'completed'
      : value.status === 'in_progress' ? 'started' : value.status === 'pending' ? 'created' : ''
    const previous = this.tasks.get(key)
    this.tasks.set(key, { key, sessionId, subject, status: value.status || 'pending',
      updatedAt: Number(value.updatedAt) || 0 })
    if (!state || previous?.status === value.status) return
    this.emit(`task.${state}`, { id: sessionId, key: `${key}:${state}`, subject,
      title: this.sessions.get(sessionId)?.title || '' })
  }
  // The answer goes to a file WorkBuddy's own hooks can read. The desktop never
  // pretends to have answered: it reports what it wrote and leaves the decision
  // to whatever consumes the file.
  async answer(callId, choice) {
    const pending = this.pending.get(String(callId))
    if (!pending) return { ok: false, message: '这个确认已经不存在了' }
    const text = oneLine(choice, 200)
    if (!text) return { ok: false, message: '请说出你的选择' }
    const file = path.join(this.bridgeDirectory, 'answers', `${pending.callId.replace(/[^A-Za-z0-9_-]/g, '')}.json`)
    const payload = { callId: pending.callId, sessionId: pending.sessionId, tool: pending.tool,
      question: pending.question, choice: text, answeredAt: new Date().toISOString() }
    try {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify(payload, null, 2), { mode: 0o600 })
    } catch { return { ok: false, message: '无法写入应答，请检查本机权限' } }
    this.answers.set(pending.callId, payload)
    this.pending.delete(pending.callId)
    const session = this.sessions.get(pending.sessionId)
    if (session?.pending?.callId === pending.callId) session.pending = null
    return { ok: true, message: `已记录你的选择：${text}`, file }
  }
  async discard(callId) {
    for (const [id, pending] of this.pending) {
      if (id !== String(callId)) continue
      this.pending.delete(id)
      const session = this.sessions.get(pending.sessionId)
      if (session?.pending?.callId === id) session.pending = null
      await rm(path.join(this.bridgeDirectory, 'answers', `${id.replace(/[^A-Za-z0-9_-]/g, '')}.json`), { force: true }).catch(() => {})
      return { ok: true, message: '已忽略这个确认' }
    }
    return { ok: false, message: '这个确认已经不存在了' }
  }
  snapshot() {
    const sessions = [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 100)
      .map(session => ({ id: session.id, title: session.title, workspace: session.workspace,
        cwd: session.cwd, reply: session.reply, updatedAt: session.updatedAt,
        pending: session.pending ? { callId: session.pending.callId, question: session.pending.question,
          options: session.pending.options, tool: session.pending.tool } : null }))
    return { online: this.started, sessions, count: this.sessions.size,
      pending: [...this.pending.values()].map(pending => ({ callId: pending.callId, sessionId: pending.sessionId,
        title: pending.title, question: pending.question, options: pending.options })) }
  }
}
