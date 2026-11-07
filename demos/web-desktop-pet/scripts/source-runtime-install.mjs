import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import yauzl from 'yauzl'
import { checkRuntimeFiles, runtimeCacheDirectory, runtimeDirectory, runtimeReady, sourceRuntimeRequirement } from './source-runtime.mjs'

export async function fileDigest(file) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(file)) hash.update(bytes)
  return hash.digest('hex')
}

async function* networkRuntimeChunks(requirement, request, signal, ranged) {
  const chunkBytes = 1024 ** 2
  const options = (signal, headers = {}) => ({ signal, redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { 'Accept-Encoding': 'identity', ...headers } })
  const part = async start => {
    const end = Math.min(start + chunkBytes, requirement.bytes) - 1
    for (let attempt = 0; ; attempt++) {
      const partSignal = AbortSignal.any([signal, AbortSignal.timeout(45000)])
      let response
      try {
        response = await request(requirement.url, options(partSignal, { Range: `bytes=${start}-${end}` }))
        if (start === 0 && response.status === 200) return null // Server has no range support.
        if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${requirement.bytes}` ||
            response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') throw new Error('运行资源分块响应无效')
        let size = 0; const chunks = []
        for await (const chunk of Readable.fromWeb(response.body, { signal: partSignal })) {
          size += chunk.length
          if (size > end - start + 1) throw new Error('运行资源分块大小超限')
          chunks.push(chunk)
        }
        if (size !== end - start + 1) throw new Error('运行资源分块大小不匹配')
        return Buffer.concat(chunks)
      } catch (error) {
        signal.throwIfAborted()
        if (attempt === 2) throw error
        await delay(200 * (attempt + 1), undefined, { signal })
      } finally { await response?.body?.cancel().catch(() => {}) }
    }
  }
  if (ranged) {
    const first = await part(0)
    if (first) {
      yield first
      for (let start = first.length; start < requirement.bytes; start += chunkBytes * 4) {
        const offsets = Array.from({ length: Math.min(4, Math.ceil((requirement.bytes - start) / chunkBytes)) }, (_, i) => start + i * chunkBytes)
        const batch = await Promise.allSettled(offsets.map(part))
        for (const result of batch) { if (result.status === 'rejected') throw result.reason; yield result.value }
      }
      return
    }
  }
  const response = await request(requirement.url, options(signal))
  if (response.status !== 200 || !response.body) { await response.body?.cancel().catch(() => {}); throw new Error(`资源下载失败 (${response.status})`) }
  yield* Readable.fromWeb(response.body, { signal })
}

export async function downloadRuntime(requirement, file, { archive, fetch: request = globalThis.fetch, signal, ranged = true, report = () => {} } = {}) {
  const hash = createHash('sha256'); let size = 0, lastReport = 0
  const timeout = AbortSignal.timeout(30 * 60 * 1000)
  signal = signal ? AbortSignal.any([signal, timeout]) : timeout
  let source
  if (archive) source = createReadStream(archive)
  else {
    report('正在下载本地推理运行资源…')
    source = Readable.from(networkRuntimeChunks(requirement, request, signal, ranged))
  }
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    size += chunk.length
    if (size > requirement.bytes) { callback(new Error('运行资源大小校验失败')); return }
    hash.update(chunk)
    if (Date.now() - lastReport > 2000) {
      lastReport = Date.now(); report(`正在下载运行资源：${Math.floor(size / requirement.bytes * 100)}% (${Math.ceil(size / 1024 ** 2)} / ${Math.ceil(requirement.bytes / 1024 ** 2)} MB)`)
    }
    callback(null, chunk)
  } })
  await pipeline(source, meter, createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal })
  if (size !== requirement.bytes) throw new Error('运行资源大小校验失败')
  if (hash.digest('hex') !== requirement.sha256) throw new Error('运行资源 SHA-256 校验失败')
}

export async function extractRuntime(archive, directory, maxBytes, signal) {
  const zip = await new Promise((resolve, reject) => yauzl.open(archive, { lazyEntries: true, strictFileNames: true }, (error, value) => error ? reject(error) : resolve(value)))
  let total = 0, count = 0
  const seen = new Set()
  try {
    await new Promise((resolve, reject) => {
      const fail = error => { zip.close(); reject(error) }
      zip.on('error', fail); zip.on('end', resolve)
      zip.on('entry', entry => {
        void (async () => {
          signal?.throwIfAborted()
          const name = entry.fileName.replace(/\/$/, ''), parts = name.split('/'), mode = entry.externalFileAttributes >>> 16
          if (!name || parts.some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f<>"|?*]/.test(part) || /[. ]$/.test(part) ||
              /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)) || path.isAbsolute(name) ||
              seen.has(name.toLowerCase()) || name === '.ready.json' ||
              (mode & 0o170000) && ![0o100000, 0o040000].includes(mode & 0o170000)) throw new Error('运行资源 ZIP 路径无效或包含链接')
          seen.add(name.toLowerCase()); total += entry.uncompressedSize
          if (++count > 100000 || !Number.isSafeInteger(total) || total > maxBytes) throw new Error('运行资源解压大小超限')
          const destination = path.join(directory, ...parts)
          if (entry.fileName.endsWith('/')) await mkdir(destination, { recursive: true })
          else {
            await mkdir(path.dirname(destination), { recursive: true })
            const stream = await new Promise((yes, no) => zip.openReadStream(entry, (error, reader) => error ? no(error) : yes(reader)))
            await pipeline(stream, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal })
            if (process.platform !== 'win32') await chmod(destination, mode & 0o111 ? 0o755 : 0o644)
          }
          zip.readEntry()
        })().catch(fail)
      })
      zip.readEntry()
    })
  } finally { zip.close() }
}

async function lockRuntime(directory, signal, report) {
  const hash = createHash('sha256').update(process.platform === 'win32' ? directory.toLowerCase() : directory).digest('hex')
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\aibanlv-runtime-${hash}`
    : { host: '127.0.0.1', port: 20000 + parseInt(hash.slice(0, 8), 16) % 40000, exclusive: true }
  const deadline = Date.now() + 35 * 60 * 1000; let notified = false
  for (;;) {
    signal?.throwIfAborted()
    const server = createServer(socket => socket.destroy())
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(address, resolve) })
      return () => new Promise(resolve => server.close(resolve))
    } catch (error) {
      server.close()
      if (error.code !== 'EADDRINUSE' || Date.now() >= deadline) throw error
      if (!notified) { notified = true; report('另一份源码正在准备此运行资源，等待完成…') }
      await delay(250, undefined, { signal })
    }
  }
}

export async function ensureSourceRuntime(requirement, { cacheDirectory = runtimeCacheDirectory(), verify, report = () => {}, signal, ...download } = {}) {
  sourceRuntimeRequirement({ schema: 1, targets: { [`${requirement.platform}-${requirement.arch}`]: requirement } }, requirement.platform, requirement.arch)
  if (typeof verify !== 'function') throw new Error('运行资源必须进行实际引擎验证')
  await mkdir(cacheDirectory, { recursive: true }); cacheDirectory = await realpath(cacheDirectory)
  const destination = runtimeDirectory(requirement, cacheDirectory)
  const release = await lockRuntime(destination, signal, report)
  let temporary
  try {
    if (await runtimeReady(requirement, destination)) {
      report('正在检查已缓存的本地推理环境…')
      try { await verify(destination); report('本地推理运行资源已就绪。'); return destination }
      catch (error) {
        if (error.code === 'SOURCE_RUNTIME_CODE') throw error
        signal?.throwIfAborted()
        report('缓存验证失败，正在重新准备运行资源…')
      }
    }
    temporary = await mkdtemp(path.join(cacheDirectory, '.prepare-'))
    const archive = path.join(temporary, 'runtime.zip'), payload = path.join(temporary, 'payload')
    await mkdir(payload)
    await downloadRuntime(requirement, archive, { ...download, signal, report })
    report('校验通过，正在解压运行资源…')
    await extractRuntime(archive, payload, requirement.unpackedBytes, signal)
    await checkRuntimeFiles(payload, requirement.platform)
    report('正在验证本地模型与 Java 编译器…')
    await verify(payload)
    signal?.throwIfAborted()
    await writeFile(path.join(payload, '.ready.json'), JSON.stringify({ version: requirement.version, sha256: requirement.sha256 }), { flag: 'wx' })
    // Preserve incomplete/damaged older directories, which another process may still hold.
    await rename(destination, `${destination}.invalid-${randomUUID()}`).catch(error => { if (error.code !== 'ENOENT') throw error })
    await rename(payload, destination)
    report('本地推理运行资源准备完成。')
    return destination
  } finally {
    try { if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 3 }) }
    finally { await release() }
  }
}
