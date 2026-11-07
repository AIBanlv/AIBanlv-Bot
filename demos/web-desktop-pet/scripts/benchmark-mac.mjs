import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { selectMacBackend } from '../electron/platform/mac-lam-backends.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = path.join(root, 'artifacts/mac')
const result = await selectMacBackend({ worker: path.join(directory, process.arch, 'lam-worker'),
  model: path.join(directory, 'lam_audio2exp_streaming.mlmodelc'), names: path.join(directory, 'names.json'),
  cacheFile: path.join(directory, `lam-backend-${process.arch}.json`), signal: new AbortController().signal,
  mode: 'auto', refresh: true })
await mkdir(path.join(root, 'artifacts'), { recursive: true })
await writeFile(path.join(root, 'artifacts', `mac-benchmark-${process.arch}.json`), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
