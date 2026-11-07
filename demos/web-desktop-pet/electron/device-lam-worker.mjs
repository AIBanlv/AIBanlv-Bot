import { spawn } from 'node:child_process'

export const lamError = () => Object.assign(new Error('LAM 嘴型推理不可用，请检查本地模型和推理运行环境后重试'),
  { code: 'LAM_UNAVAILABLE' })

export class LineWorker {
  constructor(file, args, { spawnImpl = spawn, startupMs = 60000, timeoutMs = 15000, killMs = 1000 } = {}) {
    this.timeoutMs = timeoutMs
    this.killMs = killMs
    this.sequence = 0
    this.buffer = ''
    this.ready = new Promise((resolve, reject) => { this.startup = { resolve, reject } })
    this.ready.catch(() => {})
    this.child = spawnImpl(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.closed = new Promise(resolve => this.child.once('close', () => {
      this.exited = true
      clearTimeout(this.killTimer)
      resolve()
    }))
    this.timer = setTimeout(() => this.fail(), startupMs)
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', chunk => this.read(chunk))
    this.child.stderr.resume()
    this.child.on('error', () => this.fail())
    this.child.on('close', () => this.fail())
    this.child.stdin.on('error', () => this.fail())
  }
  read(chunk) {
    if (this.dead) return
    this.buffer += chunk
    if (this.buffer.length > 512 * 1024) { this.fail(); return }
    let end
    while ((end = this.buffer.indexOf('\n')) >= 0 && !this.dead) {
      const line = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 1)
      try {
        const data = JSON.parse(line)
        if (this.startup) {
          if (data?.type !== 'ready') throw lamError()
          clearTimeout(this.timer)
          this.startup.resolve(data); this.startup = null
        } else {
          if (!this.pending || data?.id !== this.pending.id || data.error) throw lamError()
          clearTimeout(this.timer)
          this.pending.resolve(data); this.pending = null
        }
      } catch { this.fail() }
    }
  }
  request(data) {
    if (this.dead || this.startup || this.pending) return Promise.reject(lamError())
    const id = ++this.sequence
    const line = JSON.stringify({ ...data, id }) + '\n'
    if (Buffer.byteLength(line) > 160000) return Promise.reject(lamError())
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject }
      this.timer = setTimeout(() => this.fail(), this.timeoutMs)
      this.child.stdin.write(line, error => { if (error) this.fail() })
    })
  }
  fail() {
    if (this.dead) return
    this.dead = true
    clearTimeout(this.timer)
    this.startup?.reject(lamError()); this.pending?.reject(lamError())
    this.startup = this.pending = null
    this.buffer = ''
    if (!this.exited) {
      this.child.kill()
      this.killTimer = setTimeout(() => this.child.kill('SIGKILL'), this.killMs)
      this.killTimer.unref?.()
    }
  }
  async dispose() { this.fail(); await this.closed }
}
