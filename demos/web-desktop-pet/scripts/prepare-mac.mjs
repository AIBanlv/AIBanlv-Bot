import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { names } from '../src/expression.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export async function prepareMac({ arch = process.arch, model = process.env.PET_COREML_MODEL ||
  path.resolve(root, '../../../latest/5.15/SDK/HBuilder-Hello/UTSPlugins/AIBANLVDigitalHuman/app-ios/Resources/lam_audio2exp_streaming.mlpackage') } = {}) {
  if (process.platform !== 'darwin' || !['x64', 'arm64', 'all'].includes(arch)) throw new Error('Mac preparation needs macOS and x64/arm64/all')
  const output = path.join(root, 'artifacts/mac')
  await mkdir(output, { recursive: true })
  const cache = path.join(root, 'artifacts/swift-cache')
  const run = args => execFileSync('xcrun', args, { stdio: 'inherit' })
  for (const target of arch === 'all' ? ['x64', 'arm64'] : [arch]) {
    await mkdir(path.join(output, target), { recursive: true })
    run(['swiftc', '-O', '-target', `${target === 'x64' ? 'x86_64' : 'arm64'}-apple-macos13.0`,
      '-module-cache-path', cache, path.join(root, 'scripts/mac-lam-worker.swift'), '-o', path.join(output, target, 'lam-worker')])
  }
  await writeFile(path.join(output, 'names.json'), JSON.stringify(names))
  const identity = { schema: 1,
    model: hash(await readFile(path.join(model, 'Data/com.apple.CoreML/model.mlmodel'))),
    weights: hash(await readFile(path.join(model, 'Data/com.apple.CoreML/weights/weight.bin'))) }
  const compiled = path.join(output, 'lam_audio2exp_streaming.mlmodelc')
  let previous
  try { previous = JSON.parse(await readFile(path.join(output, 'model-manifest.json'), 'utf8')); await access(compiled) } catch { previous = null }
  if (JSON.stringify(previous) !== JSON.stringify(identity)) {
    const temporary = `${compiled}.preparing`
    await rm(temporary, { recursive: true, force: true })
    run(['swift', '-module-cache-path', cache, path.join(root, 'scripts/mac-compile-model.swift'), model, temporary])
    await rm(compiled, { recursive: true, force: true })
    await (await import('node:fs/promises')).rename(temporary, compiled)
    await writeFile(path.join(output, 'model-manifest.json'), JSON.stringify(identity))
  }
  console.log(`Core ML prepared for ${arch}: ${output}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareMac({ arch: process.argv.slice(2).find(value => value.startsWith('--arch='))?.split('=')[1] || process.env.DEVICE_ARCH || process.arch })
}
