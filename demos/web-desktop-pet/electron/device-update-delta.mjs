import { gunzipSync } from 'node:zlib'
import { open, link, copyFile, writeFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { boundedFile, sha256, validDigest, verifyInstaller } from './device-update-io.mjs'

export const MAX_BLOCKMAP_BYTES = 8 * 1024 ** 2
const require = createRequire(import.meta.url)
// Internal upstream API: pinned to 6.8.11 and covered by real blockmap tests.
// https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/differentialDownloader
const { computeOperations, OperationKind } = require('electron-updater/out/differentialDownloader/downloadPlanBuilder.js')

export function parseBlockmap(bytes, fileBytes) {
  if (bytes.length > MAX_BLOCKMAP_BYTES) throw new Error('Blockmap exceeds limit')
  const map = JSON.parse(gunzipSync(bytes, { maxOutputLength: 32 * 1024 ** 2 }).toString('utf8'))
  if (map?.version !== '2' || !Array.isArray(map.files) || map.files.length !== 1) throw new Error('Unsupported blockmap')
  const file = map.files[0]
  if (file?.name !== 'file' || file.offset !== 0 || !Array.isArray(file.sizes) || !Array.isArray(file.checksums)
    || !file.sizes.length || file.sizes.length > 1000000 || file.sizes.length !== file.checksums.length) throw new Error('Invalid blockmap file')
  let total = 0
  for (let i = 0; i < file.sizes.length; i++) {
    const size = file.sizes[i]
    if (!Number.isSafeInteger(size) || size <= 0 || size > 32768 || typeof file.checksums[i] !== 'string'
      || !/^[A-Za-z0-9+/]{24}$/.test(file.checksums[i])) throw new Error('Invalid blockmap block')
    total += size
  }
  if (total !== fileBytes) throw new Error('Incomplete blockmap')
  return map
}

export function deltaPlan(oldMap, newMap, oldBytes, newBytes) {
  const operations = computeOperations(oldMap, newMap, { info() {}, warn() {} })
  let downloadBytes = 0, reusedBytes = 0, ranges = 0
  for (const op of operations) {
    if (![OperationKind.COPY, OperationKind.DOWNLOAD].includes(op.kind) || !Number.isSafeInteger(op.start)
      || !Number.isSafeInteger(op.end) || op.start < 0 || op.end <= op.start
      || op.end > (op.kind === OperationKind.COPY ? oldBytes : newBytes)) throw new Error('Invalid differential plan')
    if (op.kind === OperationKind.COPY) reusedBytes += op.end - op.start
    else { downloadBytes += op.end - op.start; ranges++ }
  }
  if (downloadBytes + reusedBytes !== newBytes || ranges > 4096) throw new Error('Differential plan exceeds limit')
  return { operations, downloadBytes, reusedBytes }
}

export async function loadBaseline(directory, options) {
  const meta = JSON.parse((await boundedFile(path.join(directory, 'base.json'), 65536)).toString('utf8'))
  if (!Number.isSafeInteger(meta.bytes) || meta.bytes <= 0 || meta.bytes > 8 * 1024 ** 3 || !validDigest(meta.sha256)
    || !Number.isSafeInteger(meta.blockmap?.bytes) || meta.blockmap.bytes <= 0 || meta.blockmap.bytes > MAX_BLOCKMAP_BYTES
    || !validDigest(meta.blockmap.sha256)) throw new Error('Invalid baseline metadata')
  const blockmap = await boundedFile(path.join(directory, 'base.blockmap'), MAX_BLOCKMAP_BYTES)
  if (blockmap.length !== meta.blockmap.bytes || sha256(blockmap) !== meta.blockmap.sha256) throw new Error('Invalid baseline blockmap')
  const map = parseBlockmap(blockmap, meta.bytes)
  const file = path.join(directory, 'base.exe')
  await verifyInstaller(file, meta, options)
  return { file, bytes: meta.bytes, map }
}

export async function saveBaseline({ directory, manifest, blockmap }) {
  if (!blockmap || !manifest.blockmap) return false
  const base = name => path.join(directory, name)
  const remove = file => unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
  try {
    await remove(base('base.next.exe'))
    try { await link(base('setup.exe'), base('base.next.exe')) }
    catch (error) {
      if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error
      await copyFile(base('setup.exe'), base('base.next.exe'))
    }
    await writeFile(base('base.next.blockmap'), blockmap, { mode: 0o600 })
    await writeFile(base('base.next.json'), JSON.stringify({ bytes: manifest.bytes, sha256: manifest.sha256,
      blockmap: { bytes: blockmap.length, sha256: sha256(blockmap) } }), { mode: 0o600 })
    // Publish the metadata last. Interrupted rotations fail verification and
    // trigger a full download; they can never authorize a partial installer.
    for (const name of ['exe', 'blockmap', 'json']) {
      await remove(base(`base.${name}`)); await rename(base(`base.next.${name}`), base(`base.${name}`))
    }
    return true
  } catch { return false }
  finally { for (const name of ['exe', 'blockmap', 'json']) await remove(base(`base.next.${name}`)).catch(() => {}) }
}

export async function copyBaselineRange(file, output, start, end, { signal, touch, progress }) {
  const buffer = Buffer.allocUnsafe(65536)
  const input = await open(file, 'r')
  try {
    while (start < end) {
      signal.throwIfAborted()
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, end - start), start)
      if (!bytesRead) throw new Error('Truncated baseline')
      await output.writeFile(buffer.subarray(0, bytesRead)); start += bytesRead
      touch(); progress(bytesRead)
    }
  } finally { await input.close() }
}
