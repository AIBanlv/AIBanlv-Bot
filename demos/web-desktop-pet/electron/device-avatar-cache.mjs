import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, rename, rm, utimes } from 'node:fs/promises'
import path from 'node:path'
import { assetUrl, validateAvatarZip } from './device-assets.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const MAX_FILE = 64 * 1024 * 1024
// Only called with profiles already authorized by the current catalog/channel.
// Keys include the account scope and full URL, but neither is stored in plaintext.
export class DeviceAvatarCache {
  constructor({ directory, maxBytes = 256 * 1024 * 1024, maxEntries = 12 }) {
    Object.assign(this, { directory, maxBytes, maxEntries })
    this.queue = Promise.resolve()
  }
  key(url, scope) { assetUrl(url); return hash(`${scope}\n${url}`) }
  async get(url, scope, signal) {
    signal?.throwIfAborted()
    const key = this.key(url, scope)
    let handle
    try {
      const entries = await readdir(this.directory)
      const name = entries.find(name => name.startsWith(key + '-') && /^[a-f0-9]{64}-[a-f0-9]{64}\.zip$/.test(name))
      if (!name) return null
      const file = path.join(this.directory, name)
      if (!(await lstat(file)).isFile()) return null
      handle = await open(file, 'r')
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > MAX_FILE || stat.size < 22) throw new Error('Invalid cached avatar')
      const data = Buffer.alloc(stat.size + 1)
      let offset = 0
      while (offset < data.length) {
        signal?.throwIfAborted()
        const part = await handle.read(data, offset, data.length - offset, offset)
        if (!part.bytesRead) break
        offset += part.bytesRead
      }
      const bytes = data.subarray(0, offset)
      if (offset !== stat.size || hash(bytes) !== name.slice(65, 129)) throw new Error('Invalid cached avatar')
      await validateAvatarZip(bytes, signal)
      signal?.throwIfAborted()
      await utimes(file, new Date(), new Date()).catch(() => {})
      return bytes
    } catch {
      signal?.throwIfAborted()
      return null // Corrupt/unavailable cache is a miss, never a broken startup.
    } finally { await handle?.close() }
  }
  put(url, scope, bytes, signal) {
    const key = this.key(url, scope)
    const job = this.queue.catch(() => {}).then(async () => {
      signal?.throwIfAborted()
      await validateAvatarZip(bytes, signal)
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const temp = path.join(this.directory, `${randomUUID()}.tmp`)
      let handle
      try {
        handle = await open(temp, 'wx', 0o600)
        await handle.writeFile(bytes); await handle.close(); handle = null
        signal?.throwIfAborted()
        const name = `${key}-${hash(bytes)}.zip`
        await rename(temp, path.join(this.directory, name))
        const entries = []
        for (const candidate of await readdir(this.directory)) {
          if (!/^[a-f0-9]{64}-[a-f0-9]{64}\.zip$/.test(candidate)) continue
          const file = path.join(this.directory, candidate)
          if (candidate.startsWith(key + '-') && candidate !== name) { await rm(file, { force: true }); continue }
          const stat = await lstat(file)
          entries.push({ file, size: stat.size, time: stat.mtimeMs })
        }
        entries.sort((a, b) => b.time - a.time)
        let size = 0
        for (const [index, entry] of entries.entries()) {
          size += entry.size
          if (index >= this.maxEntries || size > this.maxBytes) await rm(entry.file, { force: true })
        }
      } finally { await handle?.close(); await rm(temp, { force: true }) }
    })
    this.queue = job
    return job
  }
}
