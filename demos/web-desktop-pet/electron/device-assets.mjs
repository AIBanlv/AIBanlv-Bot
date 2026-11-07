import yauzl from 'yauzl'
import { zip } from 'fflate'
import { setTimeout as delay } from 'node:timers/promises'

const MAX_DOWNLOAD = 64 * 1024 * 1024
const MAX_EXPANDED = 512 * 1024 * 1024
const HOSTS = ['qn.ieasysell.com', 'zhanlvgpt.ieasysell.com', 'scrm.ieasysell.com']

export function assetUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !HOSTS.includes(url.hostname) || url.port ||
      url.username || url.password || url.hash) throw new Error('Avatar URL is not allowed')
  return url
}

export async function downloadAvatar(value, { signal, fetcher = fetch, progress = () => {},
  attempts = 3, retryMs = 500, attemptMs = 15000, onRetry = () => {} } = {}) {
  const url = assetUrl(value)
  const combined = AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])])
  for (let attempt = 1; attempt <= Math.min(3, Math.max(1, attempts)); attempt++) {
    combined.throwIfAborted()
    try {
      return await downloadAttempt(url, { fetcher, progress,
        signal: AbortSignal.any([combined, AbortSignal.timeout(attemptMs)]) })
    } catch (error) {
      combined.throwIfAborted()
      const retryable = error.retryable || error.name === 'TimeoutError' ||
        ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.cause?.code || error.code)
      if (!retryable || attempt >= attempts || attempt >= 3) {
        if (retryable) throw Object.assign(new Error('Avatar resource connection failed', { cause: error }), { code: 'AVATAR_NETWORK' })
        throw error
      }
      onRetry({ attempt: attempt + 1, code: 'AVATAR_NETWORK' })
      progress(0)
      await delay(retryMs * attempt, undefined, { signal: combined })
    }
  }
}

async function downloadAttempt(url, { signal, fetcher, progress }) {
  const response = await fetcher(url, { redirect: 'error', signal, credentials: 'omit' })
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw Object.assign(new Error('Avatar resource HTTP failure'), {
      code: 'AVATAR_HTTP', retryable: response.status === 429 || response.status >= 500,
    })
  }
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_DOWNLOAD) {
    await response.body.cancel()
    throw new Error('Avatar download is too large')
  }
  const chunks = []
  let size = 0
  try {
    for await (const chunk of response.body) {
      signal.throwIfAborted()
      size += chunk.byteLength
      if (size > MAX_DOWNLOAD) throw new Error('Avatar download is too large')
      chunks.push(Buffer.from(chunk))
      progress(length ? Math.min(99, Math.round(size / length * 100)) : null)
    }
  } catch (error) {
    await response.body.cancel().catch(() => {})
    throw error
  }
  signal.throwIfAborted()
  const buffer = Buffer.concat(chunks)
  try { await validateAvatarZip(buffer, signal) }
  catch (error) {
    signal.throwIfAborted()
    throw Object.assign(new Error('Avatar archive validation failed', { cause: error }), { code: 'AVATAR_ARCHIVE' })
  }
  return buffer
}

export function validateAvatarZip(buffer, signal) {
  return readAvatarZip(buffer, signal)
}

function readAvatarZip(buffer, signal, retain = false) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_DOWNLOAD || buffer.length < 22) {
    return Promise.reject(new Error('Invalid avatar archive'))
  }
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
      if (error) { reject(new Error('Invalid avatar archive')); return }
      const files = new Set()
      const contents = retain ? Object.create(null) : null
      let expandedBytes = 0, entries = 0, finished = false, stream
      function finish(error) {
        if (finished) return
        finished = true
        signal?.removeEventListener('abort', abort)
        stream?.destroy()
        zip.close()
        if (error) reject(error)
        else resolve({ files: [...files], expandedBytes, ...(retain ? { contents } : {}) })
      }
      const abort = () => finish(new Error('Avatar validation canceled'))
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) { abort(); return }
      zip.on('error', () => finish(new Error('Invalid avatar archive')))
      zip.on('entry', entry => {
        if (finished) return
        entries++
        const name = entry.fileName
        expandedBytes += entry.uncompressedSize
        const symlink = ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
        if (entries > 256 || expandedBytes > MAX_EXPANDED || !name ||
            name.includes('\\') || name.split('/').includes('..') || name.startsWith('/') ||
            /^[a-z]:/i.test(name) || symlink || entry.isEncrypted() ||
            ![0, 8].includes(entry.compressionMethod) || files.has(name)) {
          finish(new Error('Unsafe avatar archive')); return
        }
        files.add(name)
        if (name.endsWith('/')) { zip.readEntry(); return }
        // Validate actual stream sizes; imports reuse these bytes instead of parsing the ZIP again.
        zip.openReadStream(entry, (error, readable) => {
          if (finished) { readable?.destroy(); return }
          if (error) { finish(new Error('Invalid avatar entry')); return }
          stream = readable
          const chunks = retain ? [] : null
          if (retain) readable.on('data', chunk => chunks.push(chunk))
          readable.on('error', () => finish(new Error('Invalid avatar entry size')))
          readable.on('end', () => {
            stream = null
            if (finished) return
            if (retain) contents[name] = Buffer.concat(chunks)
            zip.readEntry()
          })
          readable.resume()
        })
      })
      zip.on('end', () => {
        const roots = [...files].filter(name => name === 'skin.glb' || name.endsWith('/skin.glb')).map(name => name.slice(0, -8))
        if (roots.length !== 1 || !['skin.glb', 'animation.glb', 'offset.ply', 'vertex_order.json']
          .every(name => files.has(roots[0] + name))) {
          finish(Object.assign(new Error('LAM 资产包须在同一目录包含 skin.glb、animation.glb、offset.ply、vertex_order.json，且只能有一个角色'), { code: 'LAM_FILES_MISSING' })); return
        }
        finish()
      })
      zip.readEntry()
    })
  })
}

// The bundled renderer requires an explicit avatar directory and selects the last
// directory entry. Normalize imported packages only; never modify original files.
export async function prepareLocalAvatar(buffer, signal) {
  const checked = await readAvatarZip(buffer, signal, true)
  const root = checked.files.find(name => name === 'skin.glb' || name.endsWith('/skin.glb')).slice(0, -8)
  signal?.throwIfAborted()
  const entries = Object.create(null)
  for (const [name, data] of Object.entries(checked.contents)) {
    if (name.startsWith(root)) entries[`oac/${name.slice(root.length)}`] = data
  }
  entries['oac/'] = new Uint8Array()
  return new Promise((resolve, reject) => {
    let terminate, finished = false
    const finish = (error, result) => {
      if (finished) return
      finished = true; signal?.removeEventListener('abort', abort)
      error ? reject(error) : resolve(result)
    }
    const abort = () => { terminate?.(); finish(signal.reason || new Error('Avatar import cancelled')) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    terminate = zip(entries, { level: 6 }, (error, data) => {
      if (error) { finish(new Error('LAM 资产包整理失败')); return }
      if (data.byteLength > MAX_DOWNLOAD) { finish(new Error('整理后的 LAM 资产包超过 64 MiB，请压缩资产后重试')); return }
      finish(null, Buffer.from(data))
    })
  })
}
