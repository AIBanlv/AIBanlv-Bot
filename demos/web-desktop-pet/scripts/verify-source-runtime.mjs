import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { runtimeEnvironment } from './source-runtime.mjs'
import { runSourceCommand } from '../electron/device-source-git.mjs'

export async function verifySourceRuntime(directory, env = process.env) {
  const isolated = { ...env, PYTHONHOME: '', PYTHONPATH: '', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' }
  // A shared cache must be validated with its own files, never a developer override.
  if (directory) for (const key of ['JAVA', 'JAVAC', 'GSON_JAR', 'PET_PYTHON', 'PET_LAM_SOURCE', 'PET_MAC_LAM_ROOT']) delete isolated[key]
  if (directory) {
    const { fileDigest } = await import('./source-runtime-install.mjs')
    const manifest = JSON.parse(await readFile(path.join(directory, 'source-runtime.json'), 'utf8'))
    assert.equal(await fileDigest(path.join(directory, 'control/gson.jar')), manifest.gson.sha256, 'Gson cache integrity')
  }
  delete isolated.NODE_OPTIONS; delete isolated.ELECTRON_RUN_AS_NODE
  await runSourceCommand(process.execPath, [fileURLToPath(import.meta.url), '--check'], {
    env: directory ? runtimeEnvironment(directory, isolated) : isolated, timeout: 180000,
  }).catch(error => {
    if (error.exitCode === 2) throw Object.assign(new Error('当前 Java 源码编译失败，请修复源码后重试；无需重新下载运行资源'), { code: 'SOURCE_RUNTIME_CODE' })
    throw new Error('本地模型或 Java 运行验证失败，请检查运行资源和自定义路径')
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--check')) throw new Error('Use setup-runtime.mjs to prepare and validate resources')
  const { createLamEngine } = await import('../electron/device-lam-engine.mjs')
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 150000)
  const scratch = await mkdtemp(path.join(tmpdir(), 'aibanlv-runtime-check-'))
  let engine
  try {
    const { controlToolchain } = await import('./prepare-control.mjs')
    const tools = await controlToolchain()
    await runSourceCommand(process.env.JAVAC || 'javac', ['-version'])
    try {
      await runSourceCommand(process.env.JAVAC || 'javac', ['-encoding', 'UTF-8', '-cp', tools.jar, '-d', scratch,
        ...tools.sources.filter(file => !file.includes(`${path.sep}tests${path.sep}`)),
        fileURLToPath(new URL('./ControlLamStream.java', import.meta.url))], { timeout: 30000 })
    } catch { throw Object.assign(new Error('Current Java source does not compile'), { code: 'SOURCE_RUNTIME_CODE' }) }
    engine = await createLamEngine(controller.signal, { cacheDirectory: scratch })
    await engine.reset()
    const silence = await engine.infer(Buffer.alloc(102400)), pcm = Buffer.alloc(102400)
    for (let sample = 27200; sample < 51200; sample++) pcm.writeInt16LE(Math.round(12000 * Math.sin(sample * 2 * Math.PI * 220 / 24000)), sample * 2)
    const voiced = await engine.infer(pcm)
    assert.notDeepEqual(silence, voiced, 'Model must respond to local audio')
    await engine.reply('本地运行环境验证')
    await engine.process(voiced, 24000)
    await engine.finish()
    console.log('LAM inference and current Java sources verified')
  } catch (error) {
    console.error(error.message)
    process.exitCode = error.code === 'SOURCE_RUNTIME_CODE' ? 2 : 1
  } finally {
    clearTimeout(timer); await engine?.dispose(); await rm(scratch, { recursive: true, force: true })
  }
}
