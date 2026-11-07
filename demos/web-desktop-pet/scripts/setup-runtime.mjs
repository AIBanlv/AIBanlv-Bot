import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { customRuntimeComplete, readRuntimeOverrides, runtimeCacheDirectory, runtimeEnvironment, sourceRuntimeRequirement } from './source-runtime.mjs'
import { ensureSourceRuntime } from './source-runtime-install.mjs'
import { verifySourceRuntime } from './verify-source-runtime.mjs'

const demo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('请安装 Node.js 24 或更新版本')
  const env = await readRuntimeOverrides(demo)
  if (customRuntimeComplete(env)) {
    console.log('正在验证您配置的本地推理环境…')
    await verifySourceRuntime(null, env)
  } else {
    const lock = JSON.parse(await readFile(path.resolve(demo, '../../source-runtime.lock.json'), 'utf8'))
    if (process.platform === 'darwin' && !lock.targets?.[`darwin-${process.arch}`]) {
      console.log('此 Mac 架构的自动资源尚未发布，正在验证已有的 Core ML、Java 和 Gson 配置…')
      await verifySourceRuntime(null, env).catch(() => {
        throw new Error('Mac 自动资源尚未发布，且现有本地环境验证失败；请按 MAC-TEST.md 准备 Core ML、JDK 和 Gson')
      })
    } else {
      const requirement = sourceRuntimeRequirement(lock)
      const directory = await ensureSourceRuntime(requirement, { cacheDirectory: runtimeCacheDirectory(env), archive: env.AIBANLV_RUNTIME_ARCHIVE,
        verify: directory => verifySourceRuntime(directory, env), report: message => console.log(message) })
      if (['JAVA', 'JAVAC', 'GSON_JAR', 'PET_PYTHON', 'PET_LAM_SOURCE', 'PET_MAC_LAM_ROOT'].some(key => env[key])) {
        await verifySourceRuntime(null, runtimeEnvironment(directory, env))
      }
    }
  }
  console.log('本地推理环境已就绪，可以启动 AIBanlv。')
} catch (error) {
  console.error(`本地推理环境准备失败：${error.message}。修复后重新执行 Setup 或 npm run runtime:prepare 即可重试。`)
  process.exitCode = error.code === 'SOURCE_RUNTIME_CODE' ? 2 : 1
}
