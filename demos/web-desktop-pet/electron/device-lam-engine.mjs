import { spawn } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { controlToolchain } from '../scripts/prepare-control.mjs'
import { names } from '../src/expression.mjs'
import { pipeline } from '../src/control.mjs'
import { validateLamTrack } from '../src/lam-track.mjs'
import { LineWorker, lamError } from './device-lam-worker.mjs'
import { MacLamWorker } from './platform/mac-lam-backends.mjs'
import { WindowsLamWorker } from './platform/windows-lam-worker.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.resolve(root, '../../..')
let compiled

export function packagedLamPaths(runtimeRoot, platform = process.platform) {
  if (!path.isAbsolute(runtimeRoot)) throw lamError()
  return {
    python: platform === 'darwin' ? path.join(runtimeRoot, 'mac/lam-worker') : path.join(runtimeRoot, 'python/python.exe'),
    source: path.join(runtimeRoot, 'model'),
    java: path.join(runtimeRoot, platform === 'darwin' ? 'java/bin/java' : 'java/bin/java.exe'),
    classpath: [path.join(runtimeRoot, 'control/classes'), path.join(runtimeRoot, 'control/gson.jar')].join(path.delimiter),
    library: path.join(runtimeRoot, 'control/AIBANLVKeyframeFace.json'),
  }
}

export class LamEngine {
  constructor(python, java, provenance) { Object.assign(this, { python, java, provenance }) }
  async reset() {
    await this.python.ensureReady?.()
    if (this.python.dead || this.java.dead) throw lamError()
    await this.java.request({ action: 'reset' })
    if (this.python.dead || this.java.dead) throw lamError()
  }
  async infer(pcm) {
    if (!Buffer.isBuffer(pcm) || pcm.length !== 102400) throw lamError()
    const result = await this.python.request({ pcm: pcm.toString('base64') })
    if (!Array.isArray(result.frames) || result.frames.length !== 30 ||
        result.frames.some(frame => !Array.isArray(frame) || frame.length !== 52 ||
          frame.some(value => !Number.isFinite(value) || value < 0 || value > 1))) throw lamError()
    return result.frames
  }
  async process(frames, samples) {
    return validateLamTrack(await this.java.request({ action: 'process', frames, samples }), Math.ceil(samples / 800))
  }
  async reply(text, userText = '') {
    if (typeof text !== 'string' || text.length > 16000 ||
        typeof userText !== 'string' || userText.length > 1000) throw lamError()
    await this.java.request({ action: 'reply', text, userText })
  }
  async finish() { return validateLamTrack(await this.java.request({ action: 'finish' }), 30) }
  async dispose() { await Promise.allSettled([this.python.dispose(), this.java.dispose()]) }
}

async function compileControl(signal) {
  const tools = await controlToolchain()
  const output = path.join(root, 'artifacts/device-lam-java')
  await mkdir(output, { recursive: true })
  signal.throwIfAborted()
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.JAVAC || 'javac', ['-encoding', 'UTF-8', '-cp', tools.jar, '-d', output,
      ...tools.sources.filter(source => !source.includes(`${path.sep}tests${path.sep}`)),
      path.join(root, 'scripts/ControlLamStream.java')], { windowsHide: true, stdio: 'ignore' })
    let failed = false
    const stop = () => { failed = true; child.kill() }
    const timer = setTimeout(stop, 30000)
    signal.addEventListener('abort', stop, { once: true })
    child.on('error', () => { failed = true })
    child.on('close', code => {
      clearTimeout(timer); signal.removeEventListener('abort', stop)
      if (failed || signal.aborted || code !== 0) reject(lamError())
      else resolve()
    })
  })
  return { classpath: [output, tools.jar].join(path.delimiter), library: tools.library }
}

export async function createLamEngine(signal, { runtimeRoot, cacheDirectory = path.join(root, 'artifacts/mac') } = {}) {
  let python, java
  const stop = () => { python?.fail(); java?.fail() }
  signal.addEventListener('abort', stop, { once: true })
  try {
    signal.throwIfAborted()
    let tools
    if (runtimeRoot) {
      tools = packagedLamPaths(runtimeRoot)
      await Promise.all([tools.python, tools.java, tools.library, ...tools.classpath.split(path.delimiter),
        process.platform === 'darwin' ? path.join(runtimeRoot, 'mac/lam_audio2exp_streaming.mlmodelc') : path.join(tools.source, 'pretrained_models/LAM_audio2exp_streaming.tar')].map(file => access(file)))
    } else {
      if (!compiled) compiled = compileControl(signal).catch(error => { compiled = null; throw error })
      tools = await compiled
    }
    signal.throwIfAborted()
    const mac = process.platform === 'darwin'
    const macRoot = runtimeRoot ? path.join(runtimeRoot, 'mac') : process.env.PET_MAC_LAM_ROOT || path.join(root, 'artifacts/mac')
    python = mac
      ? new MacLamWorker({ worker: path.join(macRoot, ...(runtimeRoot || process.env.PET_MAC_LAM_ROOT ? [] : [process.arch]), 'lam-worker'),
        model: path.join(macRoot, 'lam_audio2exp_streaming.mlmodelc'), names: path.join(macRoot, 'names.json'),
        cacheFile: path.join(cacheDirectory, `lam-backend-${process.arch}.json`), signal })
      : new WindowsLamWorker(tools.python || process.env.PET_PYTHON || path.join(workspace, '.venv-lam-coreml/Scripts/python.exe'),
        ['-B', '-u', path.join(root, 'scripts/device_lam_worker.py'), '--source',
          tools.source || process.env.PET_LAM_SOURCE || path.join(workspace, 'LAM_Audio2Expression-main/LAM_Audio2Expression-main')], { signal })
    java = new LineWorker(tools.java || process.env.JAVA || 'java', ['-cp', tools.classpath, 'ControlLamStream', tools.library])
    const [provenance, control] = await Promise.all([python.ready, java.ready])
    const validNames = value => Array.isArray(value) && value.length === names.length &&
      value.every((name, index) => name === names[index])
    if (provenance.engine !== (mac ? 'coreml-ios' : 'pytorch-original-tar') || provenance.fps !== 30 ||
        (!mac && !/^[a-f0-9]{64}$/.test(provenance.checkpointSha256)) || !validNames(provenance.names) ||
        control.pipeline !== pipeline || !validNames(control.names)) throw lamError()
    signal.throwIfAborted()
    return new LamEngine(python, java, provenance)
  } catch {
    await Promise.allSettled([python?.dispose(), java?.dispose()])
    throw lamError()
  } finally { signal.removeEventListener('abort', stop) }
}
