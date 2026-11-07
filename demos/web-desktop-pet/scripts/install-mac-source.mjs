import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const fileHash = async file => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
const manifestName = 'runtime-files.json'
const required = ['mac/lam-worker', 'mac/names.json', 'mac/model-manifest.json', 'java/bin/java', 'java/bin/javac',
  'control/gson.jar', 'tools/node/bin/node', 'tools/node/lib/node_modules/npm/bin/npm-cli.js', 'source-runtime.json']
const quote = value => `'${value.replaceAll("'", "'\\''")}'`

async function filesIn(root, directory = root) {
  const files = []
  for (const name of (await readdir(directory)).sort()) {
    const file = path.join(directory, name), info = await lstat(file)
    const relative = path.relative(root, file).split(path.sep).join('/')
    if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory()) throw new Error(`资源包含链接或特殊文件：${relative}`)
    if (info.isDirectory()) files.push(...await filesIn(root, file))
    else if (![manifestName, '.ready.json'].includes(relative)) files.push({ path: relative, bytes: info.size,
      sha256: await fileHash(file), executable: Boolean(info.mode & 0o111) })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'))
}

export async function writeMacBundleManifest(directory) {
  await writeFile(path.join(directory, manifestName), JSON.stringify({ schema: 1, files: await filesIn(directory) }, null, 2) + '\n')
}

export async function verifyMacBundle(directory) {
  const manifestFile = path.join(directory, manifestName)
  if ((await stat(manifestFile)).size > 8 * 1024 ** 2) throw new Error('资源清单过大')
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  if (manifest.schema !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 50000) throw new Error('资源清单无效')
  const expected = new Map()
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || file.path.split('/').some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part)) ||
        expected.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) ||
        typeof file.executable !== 'boolean') throw new Error('资源清单路径或校验信息无效')
    expected.set(file.path, file)
  }
  for (const name of required) if (!expected.has(name)) throw new Error(`运行资源不完整：${name}`)
  if (![...expected.keys()].some(name => name.startsWith('mac/lam_audio2exp_streaming.mlmodelc/'))) throw new Error('缺少 Core ML 模型')
  const actual = await filesIn(directory)
  if (actual.length !== expected.size || actual.some(file => {
    const value = expected.get(file.path)
    return !value || file.bytes !== value.bytes || file.sha256 !== value.sha256 || file.executable !== value.executable
  })) throw new Error('运行资源文件校验失败，请重新解压完整 ZIP')
  const metadata = JSON.parse(await readFile(path.join(directory, 'source-runtime.json'), 'utf8'))
  if (metadata.schema !== 1 || metadata.target !== 'darwin-arm64' || metadata.minimumMacOS !== '15.0' ||
      !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(metadata.version)) throw new Error('运行资源目标平台无效')
  return { metadata, identity: await fileHash(manifestFile), files: actual.length }
}

export function requireMacHost({ platform = process.platform, arch = process.arch,
  macOS = process.platform === 'darwin' ? execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim() : '' } = {}) {
  if (platform !== 'darwin' || arch !== 'arm64') throw new Error('此完整环境包仅用于原生 Apple Silicon Mac，请在 M 芯片原生终端运行，勿使用 Rosetta')
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(macOS) || Number(macOS.split('.')[0]) < 15) throw new Error('完整环境需要 macOS 15 或更新系统')
}

export async function runInstallCommand(executable, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, stdio: 'inherit', shell: false })
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`安装步骤超时：${path.basename(executable)}`)) }, 20 * 60 * 1000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`安装步骤失败：${path.basename(executable)} (${code})`)) })
  })
}

async function atomicJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, file) }
  finally { await rm(temporary, { force: true }) }
}
async function readConfig(file) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid configuration')
    return value
  } catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('runtime.local.json 无效，已保留原文件，请先修复') }
}
async function setupLock(directory) {
  const port = 20000 + parseInt(createHash('sha256').update(directory).digest('hex').slice(0, 8), 16) % 40000
  const deadline = Date.now() + 30 * 60 * 1000
  for (;;) {
    const server = createServer(socket => socket.destroy())
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve) })
      return () => new Promise(resolve => server.close(resolve))
    } catch (error) {
      server.close()
      if (error.code !== 'EADDRINUSE' || Date.now() >= deadline) throw error
      await delay(500)
    }
  }
}

export async function installMacSource({ bundle, repository = path.join(homedir(), 'Applications/AIBanlv Source'),
  cacheDirectory = path.join(homedir(), 'Library/Caches/AIBanlv/runtimes'), desktopDirectory = path.join(homedir(), 'Desktop'),
  env = process.env, host, run = runInstallCommand, verify } = {}) {
  requireMacHost(host)
  bundle = await realpath(bundle); repository = path.resolve(repository)
  const { metadata, identity } = await verifyMacBundle(bundle)
  await mkdir(cacheDirectory, { recursive: true }); cacheDirectory = await realpath(cacheDirectory)
  const relation = path.relative(repository, cacheDirectory)
  if (!relation || !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation)) throw new Error('运行缓存必须位于源码目录之外')
  const release = await setupLock(cacheDirectory)
  let stage
  try {
    const target = path.join(cacheDirectory, `${metadata.version}-darwin-arm64-${identity.slice(0, 16)}`)
    stage = await mkdtemp(path.join(cacheDirectory, '.mac-prepare-'))
    await cp(bundle, stage, { recursive: true, dereference: false, filter: source => path.basename(source) !== '.ready.json' })
    await verifyMacBundle(stage)
    const node = path.join(stage, 'tools/node/bin/node'), npm = path.join(stage, 'tools/node/lib/node_modules/npm/bin/npm-cli.js')
    const childEnv = { ...env, PATH: `${path.dirname(node)}:${env.PATH || '/usr/bin:/bin'}` }
    for (const key of ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR', 'npm_config_arch', 'npm_config_platform']) delete childEnv[key]
    if (!(await stat(repository).catch(() => null))) {
      await mkdir(path.dirname(repository), { recursive: true })
      await run('/usr/bin/git', ['clone', '--', 'https://github.com/AIBanlv/AIBanlv-Bot.git', repository], { env: childEnv })
    }
    const root = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'))
    const demo = path.join(repository, 'demos/web-desktop-pet')
    const manifest = JSON.parse(await readFile(path.join(demo, 'package.json'), 'utf8'))
    if (root.name !== 'control-windows' || manifest.name !== 'control-web-desktop-pet-demo') throw new Error('指定目录不是 AIBanlv 桌面源码，不会覆盖它')
    await readConfig(path.join(demo, 'runtime.local.json'))
    console.log('正在按源码锁文件安装 npm 和 Electron 依赖…')
    await run(node, [npm, 'ci'], { cwd: repository, env: childEnv })
    await run(node, [npm, 'run', 'setup:deps'], { cwd: repository, env: childEnv })
    verify ||= (await import(pathToFileURL(path.join(demo, 'scripts/verify-source-runtime.mjs')).href)).verifySourceRuntime
    console.log('正在此 Mac 上验证 Core ML 推理和当前 Java 源码…')
    await verify(stage, childEnv)
    // Publish only a verified payload. An older valid environment is retained.
    if (await stat(target).catch(() => null)) {
      if (await verifyMacBundle(target).then(value => value.identity === identity, () => false)) await rm(stage, { recursive: true, force: true })
      else { await rename(target, `${target}.invalid-${randomUUID()}`); await rename(stage, target) }
    } else await rename(stage, target)
    stage = null
    const finalNode = path.join(target, 'tools/node/bin/node')
    const finalEnv = { ...childEnv, PATH: `${path.dirname(finalNode)}:${env.PATH || '/usr/bin:/bin'}` }
    const configFile = path.join(demo, 'runtime.local.json'), previous = await readConfig(configFile)
    const defaults = { JAVA: path.join(target, 'java/bin/java'), JAVAC: path.join(target, 'java/bin/javac'),
      GSON_JAR: path.join(target, 'control/gson.jar'), PET_MAC_LAM_ROOT: path.join(target, 'mac') }
    const configured = { ...defaults, ...previous }
    if (Object.keys(defaults).some(key => previous[key] || env[key])) {
      const effective = { ...configured, ...finalEnv }
      for (const key of Object.keys(defaults)) if (!env[key] && typeof effective[key] === 'string' && effective[key].startsWith('./')) effective[key] = path.resolve(demo, effective[key])
      await verify(null, effective)
    }
    await atomicJSON(path.join(target, '.ready.json'), { schema: 1, payloadSHA256: identity, target: metadata.target, nativeVerified: true, verifiedAt: new Date().toISOString() })
    await atomicJSON(configFile, configured)
    const launch = path.join(demo, 'harness-client-plugin/desktop-launch.mjs')
    await run(finalNode, [launch, '--register-source'], { cwd: repository, env: finalEnv })
    await mkdir(desktopDirectory, { recursive: true })
    const shortcut = path.join(desktopDirectory, 'AIBanlv Source.command')
    await writeFile(shortcut, `#!/bin/sh\nset -eu\nexport PATH=${quote(path.dirname(finalNode))}:"$PATH"\nunset NODE_OPTIONS ELECTRON_RUN_AS_NODE ELECTRON_NO_ASAR\nexec ${quote(finalNode)} ${quote(launch)} --source\n`, { mode: 0o755 })
    console.log(`安装成功。桌面入口：${shortcut}\n源码：${repository}\n本地模型环境：${target}\n角色、扫码、Key 和系统授权请在应用中配置。`)
    return { target, shortcut, repository }
  } finally { try { if (stage) await rm(stage, { recursive: true, force: true }) } finally { await release() } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const bundle = path.dirname(fileURLToPath(import.meta.url))
    if (process.argv.includes('--verify-files')) console.log(JSON.stringify(await verifyMacBundle(bundle)))
    else await installMacSource({ bundle, repository: process.argv[2] || undefined })
  } catch (error) { console.error(`安装未完成：${error.message}。修复后可重新执行同一安装命令。`); process.exitCode = 1 }
}
