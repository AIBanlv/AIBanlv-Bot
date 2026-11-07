import { open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { readChunk, sha256, verifyInstaller } from './device-update-io.mjs'
import { parseBlockmap, deltaPlan, loadBaseline, copyBaselineRange } from './device-update-delta.mjs'

// Same security policy for full, blockmap and range requests. In particular a
// cancelled or timed-out differential attempt must never start a full download.
export async function downloadInstaller({ directory, manifest, fetchImpl, signal: outerSignal,
  idleMs = 30000, onProgress = () => {} }) {
  const controller = new AbortController()
  const signal = AbortSignal.any([outerSignal, controller.signal])
  let idle, received = 0, networkBytes = 0, reusedBytes = 0, mode = 'full', fallback = false
  const partial = path.join(directory, 'setup.exe.part')
  let blockmap = null
  const emit = () => onProgress({ received, networkBytes, reusedBytes, mode, fallback })
  const touch = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(new DOMException('Download idle timeout', 'TimeoutError')), idleMs) }
  const options = headers => ({ signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity', ...headers } })
  const request = async (url, expected, headers, consume, range) => {
    signal.throwIfAborted(); touch()
    const response = await fetchImpl(url, options(headers))
    const reader = response.body?.getReader()
    let count = 0
    try {
      if (!reader || response.status !== (range ? 206 : 200) || range && response.headers.get('content-range') !== range
        || response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') throw new Error('Invalid range or response')
      const length = response.headers.get('content-length')
      if (length !== null && (!/^\d+$/.test(length) || Number(length) !== expected)) throw new Error('Incorrect response length')
      for (;;) {
        const { done, value } = await readChunk(reader, signal)
        if (done) break
        count += value.length; networkBytes += value.length
        // At most one bounded failed delta plus one complete transfer and map.
        if (count > expected || networkBytes > manifest.bytes * 2 + (manifest.blockmap?.bytes || 0)) throw new Error('Download exceeds budget')
        await consume(value); touch(); emit()
      }
      if (count !== expected) throw new Error('Truncated response')
    } finally { void reader?.cancel().catch(() => {}) }
  }
  const removePartial = () => unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error })
  const write = async operation => {
    const file = await open(partial, 'wx', 0o600)
    try { await operation(file); signal.throwIfAborted(); await file.sync() }
    finally { await file.close() }
    await verifyInstaller(partial, manifest, { signal, onBytes: touch })
  }
  try {
    touch(); await removePartial()
    if (manifest.blockmap) {
      try {
        emit()
        const chunks = []
        await request(manifest.blockmap.url, manifest.blockmap.bytes, {}, value => { chunks.push(value) })
        const data = Buffer.concat(chunks)
        if (sha256(data) !== manifest.blockmap.sha256) throw new Error('Invalid blockmap digest')
        const newMap = parseBlockmap(data, manifest.bytes)
        blockmap = data
        const baseline = await loadBaseline(directory, { signal, onBytes: touch })
        const plan = deltaPlan(baseline.map, newMap, baseline.bytes, manifest.bytes)
        if (!plan.reusedBytes || plan.downloadBytes + data.length >= manifest.bytes) throw new Error('No differential benefit')
        mode = 'differential'; emit()
        await write(async output => {
          for (const op of plan.operations) {
            signal.throwIfAborted()
            if (op.kind === 0) {
              await copyBaselineRange(baseline.file, output, op.start, op.end, { signal, touch,
                progress: bytes => { received += bytes; reusedBytes += bytes; emit() } })
            } else {
              // Bound each response so a large changed region does not depend
              // on one long-lived CDN stream. Keep the same final-file hash.
              for (let start = op.start; start < op.end; start += 1024 ** 2) {
                const end = Math.min(start + 1024 ** 2, op.end)
                await request(manifest.url, end - start, { Range: `bytes=${start}-${end - 1}` },
                  async value => { await output.writeFile(value); received += value.length },
                  `bytes ${start}-${end - 1}/${manifest.bytes}`)
              }
            }
          }
        })
        signal.throwIfAborted()
        return { mode, received, networkBytes, reusedBytes, blockmap, fallback }
      } catch {
        // Abort includes idle timeout; resuming with a full transfer would make
        // cancellation ineffective and could unexpectedly consume gigabytes.
        signal.throwIfAborted()
        fallback = true; await removePartial()
      }
    }
    mode = 'full'; received = 0; reusedBytes = 0; emit()
    await write(async file => {
      await request(manifest.url, manifest.bytes, {}, async value => { await file.writeFile(value); received += value.length })
    })
    signal.throwIfAborted()
    return { mode, received, networkBytes, reusedBytes, blockmap, fallback }
  } catch (error) {
    await removePartial().catch(() => {})
    throw error
  } finally { clearTimeout(idle) }
}
