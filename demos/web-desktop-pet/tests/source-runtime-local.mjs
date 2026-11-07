// Explicit real-model check; never included in the fast/offline unit suite.
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSourceRuntime, runtimeCacheDirectory } from '../scripts/source-runtime.mjs'

const execute = promisify(execFile), demo = fileURLToPath(new URL('../', import.meta.url)), root = path.resolve(demo, '../..')
await mkdir(path.join(demo, 'artifacts'), { recursive: true })
const scratch = await mkdtemp(path.join(demo, 'artifacts/source runtime 独立 & '))
try {
  const copyRoot = path.join(scratch, 'checkout'), copyDemo = path.join(copyRoot, 'demos/web-desktop-pet')
  for (const name of ['source-runtime.lock.json', 'android-native/lam-expression-common/src/main/java',
    'android-native/digitalhuman-core/src/main/java/com/zhanlv/digitalhuman/playback',
    'android-native/digitalhuman-core/src/main/assets/AIBANLVKeyframeFace.json']) {
    const destination = path.join(copyRoot, name); await mkdir(path.dirname(destination), { recursive: true })
    await cp(path.join(root, name), destination, { recursive: true })
  }
  for (const name of ['scripts/source-runtime.mjs', 'scripts/verify-source-runtime.mjs', 'scripts/prepare-control.mjs',
    'scripts/ControlLamStream.java', 'scripts/ControlPostprocess.java', 'scripts/ControlPreview.java', 'scripts/device_lam_worker.py',
    'electron/device-source-git.mjs', 'electron/device-lam-engine.mjs', 'electron/device-lam-worker.mjs',
    'electron/platform/mac-lam-backends.mjs', 'electron/platform/windows-lam-worker.mjs',
    'src/expression.mjs', 'src/control.mjs', 'src/lam-track.mjs']) {
    const destination = path.join(copyDemo, name); await mkdir(path.dirname(destination), { recursive: true })
    await cp(path.join(demo, name), destination)
  }
  const windows = process.env.SystemRoot || 'C:\\Windows'
  const env = await loadSourceRuntime(copyDemo, {
    SystemRoot: windows, WINDIR: windows, PATH: process.platform === 'win32' ? path.join(windows, 'System32') : '/usr/bin:/bin',
    HOME: scratch, USERPROFILE: scratch, TEMP: scratch, TMP: scratch,
    AIBANLV_RUNTIME_CACHE: runtimeCacheDirectory(), PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
  })
  assert.ok(env.JAVAC, 'Setup must have prepared the cache before this check')
  const { stdout } = await execute(process.execPath, [path.join(copyDemo, 'scripts/verify-source-runtime.mjs'), '--check'],
    { cwd: scratch, env, windowsHide: true, timeout: 180000 })
  assert.match(stdout, /LAM inference and current Java sources verified/)
  assert.ok((await readdir(path.join(copyDemo, 'artifacts/device-lam-java'))).includes('ControlLamStream.class'))
  await writeFile(path.join(copyDemo, 'scripts/ControlLamStream.java'), 'invalid Java source')
  await assert.rejects(execute(process.execPath, [path.join(copyDemo, 'scripts/verify-source-runtime.mjs'), '--check'],
    { cwd: scratch, env, windowsHide: true, timeout: 45000 }), { code: 2 })
  console.log('PASS: isolated checkout compiled current Java and ran original LAM using only the managed runtime; no system Python/Java/Gradle paths.')
} finally { await rm(scratch, { recursive: true, force: true, maxRetries: 4 }) }
