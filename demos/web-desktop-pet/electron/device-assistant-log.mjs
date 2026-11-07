import { appendFile, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

// The on-screen message is deliberately vague about provider errors, because the
// provider's own wording can carry credential fragments. That makes it useless
// for the one question the user actually has — "which of the six reasons is it".
// So the wording is kept, scrubbed of anything that looks like a secret, and
// written here instead: a local file only its owner can reach.
const secrets = [
  [/sk-[A-Za-z0-9_-]{4,}/g, match => `${match.slice(0, 3)}***(${match.length})`],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***'],
  [/\b(?:api[_-]?key|authorization|x-api-key|token|password|secret)\b\s*[:=]\s*\S+/gi,
    match => `${match.split(/[:=]/)[0]}=***`],
  // A JWT, or any long opaque token, is not worth printing in any form.
  [/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '***'],
  [/\b[A-Fa-f0-9]{32,}\b/g, match => `${match.slice(0, 4)}***(${match.length})`],
]
export function redact(value) {
  if (typeof value !== 'string') {
    if (value instanceof Error) return redact(value.stack || value.message)
    if (value === null || value === undefined) return ''
    try { return redact(JSON.stringify(value)) } catch { return String(value) }
  }
  let text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
  for (const [pattern, replacement] of secrets) text = text.replace(pattern, replacement)
  return text
}

const field = (key, value) => {
  if (value === undefined) return ''
  const text = redact(value).replace(/\s+/g, ' ').trim()
  return text ? ` ${key}=${text.slice(0, 300)}` : ''
}

export class AssistantLog {
  #pending = null
  #size = 0
  constructor({ file, maxBytes = 262144, keep = 2 }) {
    Object.assign(this, { file, maxBytes, keep })
  }
  get path() { return this.file }
  // Never let logging break the assistant: the queue is best effort and every
  // failure is dropped silently.
  event(name, fields = {}) {
    const line = `${new Date().toISOString()} ${String(name).slice(0, 40)}${Object.entries(fields)
      .map(([key, value]) => field(key, value)).join('')}`
    this.#pending = (this.#pending || Promise.resolve()).then(() => this.write(line)).catch(() => {})
    return this.#pending
  }
  async write(line) {
    const text = `${line.slice(0, 2000)}\n`
    try {
      if (!this.#size) this.#size = await stat(this.file).then(info => info.size, () => 0)
      if (this.#size + text.length > this.maxBytes) await this.rotate()
    } catch { return }
    try {
      await appendFile(this.file, text, { mode: 0o600 })
      this.#size += text.length
    } catch (error) {
      if (error.code !== 'ENOENT') return
      try {
        await mkdir(path.dirname(this.file), { recursive: true })
        await appendFile(this.file, text, { mode: 0o600 })
        this.#size += text.length
      } catch {}
    }
  }
  async rotate() {
    for (let index = this.keep; index > 0; index -= 1) {
      const from = index === 1 ? this.file : `${this.file}.${index - 1}`
      const to = `${this.file}.${index}`
      if (index === this.keep) await rm(to, { force: true }).catch(() => {})
      await rename(from, to).catch(() => {})
    }
    this.#size = 0
  }
  async tail(lines = 80) {
    const file = await open(this.file, 'r').catch(() => null)
    if (!file) return []
    try {
      const info = await file.stat()
      const start = Math.max(0, info.size - 32768)
      const buffer = Buffer.alloc(info.size - start)
      await file.read(buffer, 0, buffer.length, start)
      return buffer.toString('utf8').split('\n').filter(Boolean).slice(-lines)
    } catch { return [] } finally { await file.close().catch(() => {}) }
  }
  async clear() {
    await this.#pending?.catch(() => {})
    const files = [this.file, ...Array.from({ length: this.keep }, (_, index) => `${this.file}.${index + 1}`)]
    await Promise.all(files.map(file => rm(file, { force: true })))
    this.#size = 0
  }
  static async list(file) {
    return readdir(path.dirname(file)).catch(() => [])
  }
}
