import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { appBuilderPath } from 'app-builder-bin'
import { boundedFile, sha256 } from './device-update-io.mjs'
import { parseBlockmap, MAX_BLOCKMAP_BYTES } from './device-update-delta.mjs'

// Build-time only. Supplying --output generates a gzip sidecar without changing
// the signed/hashed installer bytes. Never invoke the embedded-map append mode.
// https://github.com/develar/app-builder/blob/master/pkg/blockmap/blockmap.go
export async function createInstallerBlockmap(file) {
  if (!path.isAbsolute(appBuilderPath)) throw new Error('Use the pinned app-builder binary')
  const output = `${file}.blockmap`
  const before = await lstat(file)
  if (!before.isFile() || before.size <= 0 || before.size > 8 * 1024 ** 3) throw new Error('Invalid installer for blockmap')
  await promisify(execFile)(appBuilderPath, ['blockmap', '--input', file, '--output', output],
    { shell: false, windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 })
  const data = await boundedFile(output, MAX_BLOCKMAP_BYTES)
  parseBlockmap(data, before.size)
  const after = await lstat(file)
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('Installer changed while generating blockmap')
  return { file: output, bytes: data.length, sha256: sha256(data) }
}
