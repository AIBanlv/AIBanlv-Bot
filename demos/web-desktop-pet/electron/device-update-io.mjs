import { createReadStream } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)

export async function boundedFile(file, maximum) {
  const info = await lstat(file)
  if (!info.isFile() || info.size > maximum) throw new Error('Invalid cached file')
  const bytes = await readFile(file)
  if (bytes.length > maximum) throw new Error('Cached file exceeds limit')
  return bytes
}

export async function verifyInstaller(file, manifest, { signal, onBytes = () => {} } = {}) {
  signal?.throwIfAborted()
  const info = await lstat(file)
  if (!info.isFile() || info.size !== manifest.bytes) throw new Error('安装包大小不匹配')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file, { signal })) { hash.update(chunk); onBytes() }
  if (hash.digest('hex') !== manifest.sha256) throw new Error('安装包校验失败')
}

export function readChunk(reader, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
