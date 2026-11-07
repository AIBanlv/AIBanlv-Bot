import { access, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export function sourceRuntimeRequirement(lock, platform = process.platform, arch = process.arch) {
  const value = lock?.targets?.[`${platform}-${arch}`]
  if (!value) throw new Error(`当前平台 ${platform}-${arch} 的自动运行资源尚未发布，请参考源码运行环境文档配置本地环境。`)
  const url = new URL(value.url)
  if (lock.schema !== 1 || value.platform !== platform || value.arch !== arch ||
      !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(value.version) || !/^[a-f0-9]{64}$/.test(value.sha256) ||
      !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > 4 * 1024 ** 3 ||
      !Number.isSafeInteger(value.unpackedBytes) || value.unpackedBytes <= 0 || value.unpackedBytes > 8 * 1024 ** 3 ||
      url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('运行资源清单无效')
  return value
}

export const runtimeCacheDirectory = (env = process.env) => path.resolve(env.AIBANLV_RUNTIME_CACHE ||
  (process.platform === 'win32' ? path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'AIBanlv/runtimes')
    : path.join(os.homedir(), 'Library/Caches/AIBanlv/runtimes')))
export const runtimeDirectory = (requirement, cacheDirectory = runtimeCacheDirectory()) =>
  path.join(cacheDirectory, `${requirement.version}-${requirement.platform}-${requirement.arch}-${requirement.sha256.slice(0, 16)}`)

export function runtimeEnvironment(directory, env = process.env, platform = process.platform) {
  const defaults = { JAVA: path.join(directory, `java/bin/java${platform === 'win32' ? '.exe' : ''}`),
    JAVAC: path.join(directory, `java/bin/javac${platform === 'win32' ? '.exe' : ''}`), GSON_JAR: path.join(directory, 'control/gson.jar'),
    ...(platform === 'win32' ? { PET_PYTHON: path.join(directory, 'python/python.exe'), PET_LAM_SOURCE: path.join(directory, 'model') }
      : { PET_MAC_LAM_ROOT: path.join(directory, 'mac') }) }
  const supplied = Object.fromEntries(Object.entries(defaults).filter(([key]) => !env[key]))
  let previous = {}
  try { previous = JSON.parse(env.AIBANLV_MANAGED_DEFAULTS || '{}') } catch {}
  return { ...env, ...supplied, AIBANLV_MANAGED_DEFAULTS: JSON.stringify({ ...previous, ...supplied }) }
}

export async function readRuntimeOverrides(demo, env = process.env) {
  const result = { ...env }
  try {
    const config = JSON.parse(await readFile(path.join(demo, 'runtime.local.json'), 'utf8'))
    for (const key of ['PET_PYTHON', 'PET_TTS_PYTHON', 'PET_LAM_SOURCE', 'PET_MAC_LAM_ROOT', 'JAVA', 'JAVAC', 'GSON_JAR']) {
      if (!result[key] && typeof config[key] === 'string' && config[key]) {
        result[key] = config[key].startsWith('./') ? path.resolve(demo, config[key]) : config[key]
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid runtime.local.json') }
  return result
}

export const customRuntimeComplete = (env, platform = process.platform) =>
  ['JAVA', 'JAVAC', 'GSON_JAR', ...(platform === 'win32' ? ['PET_PYTHON', 'PET_LAM_SOURCE'] : ['PET_MAC_LAM_ROOT'])].every(key => Boolean(env[key]))

export async function runtimeReady(requirement, directory) {
  try {
    const receipt = JSON.parse(await readFile(path.join(directory, '.ready.json'), 'utf8'))
    if (receipt.sha256 !== requirement.sha256 || receipt.version !== requirement.version) return false
    await checkRuntimeFiles(directory, requirement.platform)
    return true
  } catch { return false }
}

export async function checkRuntimeFiles(directory, platform) {
  const env = runtimeEnvironment(directory, {}, platform)
  await Promise.all([env.JAVA, env.JAVAC, env.GSON_JAR,
    ...(platform === 'win32' ? [env.PET_PYTHON, path.join(env.PET_LAM_SOURCE, 'pretrained_models/LAM_audio2exp_streaming.tar')]
      : ['lam-worker', 'names.json', 'model-manifest.json', 'lam_audio2exp_streaming.mlmodelc'].map(name => path.join(env.PET_MAC_LAM_ROOT, name)))].map(file => access(file)))
}

// Startup only reads completed caches. Large downloads belong to Setup/update.
export async function loadSourceRuntime(demo, env = process.env, onMissing = message => console.warn(`[AIBanlv] ${message}`)) {
  const overrides = await readRuntimeOverrides(demo, env)
  if (customRuntimeComplete(overrides)) return overrides
  const lock = JSON.parse(await readFile(path.resolve(demo, '../../source-runtime.lock.json'), 'utf8'))
  if (!lock.targets?.[`${process.platform}-${process.arch}`]) return overrides
  const requirement = sourceRuntimeRequirement(lock), directory = runtimeDirectory(requirement, runtimeCacheDirectory(overrides))
  if (await runtimeReady(requirement, directory)) return runtimeEnvironment(directory, overrides)
  onMissing('本地推理环境尚未准备，请执行源码根目录中的 Setup AIBanlv.cmd 或 npm run runtime:prepare。')
  return overrides
}
