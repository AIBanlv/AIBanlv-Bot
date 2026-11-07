import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, unlink, stat, realpath } from 'node:fs/promises'
import path from 'node:path'

const fail = code => Object.assign(new Error(code), { code })
export class HarnessClient extends EventEmitter {
  constructor({ file, leaseMs = 5000, timeoutMs = 120000, authorizeTask } = {}) {
    super(); Object.assign(this, { file, leaseMs, timeoutMs, authorizeTask }); this.jobs = new Map(); this.enabled = true
    this.state = { online: false, signedIn: false }
  }
  ready() { return this.enabled && this.state.online && this.state.signedIn && Date.now() - this.lastSeen < this.leaseMs }
  snapshot() { return { ...this.state, enabled: this.enabled, ready: this.ready() } }
  async setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw fail('INVALID_SETTINGS')
    await writeFile(`${this.file}.preferences.tmp`, JSON.stringify({ enabled }), { mode: 0o600 })
    await rename(`${this.file}.preferences.tmp`, `${this.file}.preferences`)
    this.enabled = enabled; if (!enabled) this.cancelAll(); this.emit('changed')
  }
  cancelAll() { for (const job of [...this.jobs.values()]) job.finish(fail('HARNESS_CLIENT_CHANGED')) }
  async start() {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 })
    try { this.enabled = JSON.parse(await readFile(`${this.file}.preferences`, 'utf8')).enabled !== false } catch {}
    const token = randomBytes(32).toString('hex')
    this.server = createServer(async (req, res) => {
      const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
      if (req.headers.origin || req.headers.host !== new URL(this.connection.endpoint).host) return reply(403, {})
      const supplied = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${token}`)
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(401, {})
      if (req.method !== 'POST' || !['/v1/poll', '/v1/result'].includes(req.url)) return reply(404, {})
      if (req.headers['content-type'] !== 'application/json') return reply(415, {})
      req.setTimeout(2000, () => req.destroy())
      try {
        const chunks = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 65536) return reply(413, {}); chunks.push(chunk) }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!/^[a-f0-9-]{36}$/.test(body.sourceId || '')) return reply(400, {})
        if (this.owner && this.owner !== body.sourceId && Date.now() - this.lastSeen < this.leaseMs) return reply(409, {})
        if (req.url === '/v1/result') {
          const job = this.jobs.get(body.id)
          if (this.owner !== body.sourceId || !this.ready() || !job?.sent) return reply(409, {})
          if (body.ok === true && typeof body.text === 'string' && body.text.length <= 16000) job.finish(null, body.text)
          else job.finish(fail('HARNESS_CLIENT_FAILED'))
          return reply(200, { ok: true })
        }
        if (typeof body.signedIn !== 'boolean') return reply(400, {})
        const taskProtocol = body.taskProtocol === 2 ? 2 : 1
        const changed = this.owner !== body.sourceId || !this.state.online || this.state.signedIn !== body.signedIn
          || this.state.taskProtocol !== taskProtocol || Date.now() - this.lastSeen >= this.leaseMs
        if (changed) this.cancelAll()
        this.owner = body.sourceId; this.lastSeen = Date.now(); this.state = { online: true, signedIn: body.signedIn, taskProtocol }
        if (changed) this.emit('changed')
        const jobs = []
        if (this.ready()) for (const job of this.jobs.values()) if (job.approved && !job.sent) { job.sent = true; jobs.push(job.request) }
        reply(200, { jobs, active: [...this.jobs.keys()] })
      } catch { if (!res.writableEnded) reply(400, {}) }
    })
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve) })
    this.connection = { version: 1, endpoint: `http://127.0.0.1:${this.server.address().port}`, token }
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.connection), { mode: 0o600 }); await rename(`${this.file}.tmp`, this.file)
    this.timer = setInterval(() => {
      if (this.state.online && Date.now() - this.lastSeen >= this.leaseMs) {
        this.state = { online: false, signedIn: false }; this.cancelAll(); this.emit('changed')
      }
    }, Math.min(this.leaseMs, 1000)); this.timer.unref?.()
  }
  request(operation, text, signal = new AbortController().signal) {
    if (!this.ready()) return Promise.reject(fail('HARNESS_CLIENT_UNAVAILABLE'))
    if (!['run', 'llm'].includes(operation) || typeof text !== 'string' || !text.trim() || text.length > 16000 || this.jobs.size >= 4) return Promise.reject(fail('HARNESS_CLIENT_BUSY'))
    if (operation === 'run' && this.state.taskProtocol !== 2) return Promise.reject(fail('HARNESS_CLIENT_UPDATE_REQUIRED'))
    if (operation === 'run' && typeof this.authorizeTask !== 'function') return Promise.reject(fail('HARNESS_WORKSPACE_REQUIRED'))
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const id = randomUUID(), authorization = new AbortController(), cancel = () => finish(fail('ASSISTANT_CANCELLED'))
      const finish = (error, value) => { clearTimeout(timer); signal.removeEventListener('abort', cancel); this.jobs.delete(id); authorization.abort(); error ? reject(error) : resolve(value) }
      const timer = setTimeout(() => finish(fail('HARNESS_CLIENT_TIMEOUT')), this.timeoutMs)
      const job = { request: { id, operation, text }, approved: operation === 'llm', sent: false, finish }
      this.jobs.set(id, job)
      signal.addEventListener('abort', cancel, { once: true })
      if (operation === 'run') void (async () => {
        const selected = await this.authorizeTask(text, authorization.signal)
        if (typeof selected !== 'string' || !path.isAbsolute(selected)) throw fail('HARNESS_WORKSPACE_REQUIRED')
        const cwd = await realpath(selected)
        if (path.relative(selected, cwd) || !(await stat(cwd)).isDirectory()) throw fail('HARNESS_WORKSPACE_REQUIRED')
        // Cancellation, account changes and lease expiry also revoke an open picker.
        authorization.signal.throwIfAborted()
        if (!this.ready() || this.jobs.get(id) !== job) throw fail('HARNESS_CLIENT_CHANGED')
        job.request.cwd = cwd; job.approved = true
      })().catch(() => { if (this.jobs.get(id) === job) finish(fail('HARNESS_WORKSPACE_REQUIRED')) })
    })
  }
  async stop() {
    clearInterval(this.timer); this.state = { online: false, signedIn: false }; this.cancelAll(); this.server?.closeAllConnections()
    if (this.server) await new Promise(resolve => this.server.close(resolve))
    try { if (JSON.parse(await readFile(this.file, 'utf8')).token === this.connection?.token) await unlink(this.file) } catch {}
  }
}
