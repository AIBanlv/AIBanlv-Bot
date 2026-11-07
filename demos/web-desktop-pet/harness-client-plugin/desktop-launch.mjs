import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

export const pluginDirectory = path.dirname(fileURLToPath(import.meta.url))
export const launchDirectory = () => process.env.PET_DEVICE_USER_DATA || path.join(process.env.APPDATA ||
  (process.platform === 'darwin' ? path.join(homedir(), 'Library/Application Support') : path.join(homedir(), '.config')), 'Control Device')
const configFile = directory => path.join(directory, 'desktop-launch.json')
const pauseFile = directory => path.join(directory, 'desktop-launch-paused')

async function readSettings(directory) {
  let file
  try {
    file = await open(configFile(directory), 'r')
    const bytes = Buffer.alloc(8193), { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead > 8192) throw new Error('INVALID_LAUNCH_TARGET')
    const value = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'))
    if (value?.version !== 1 || !['source', 'app'].includes(value.kind) || typeof value.autoStart !== 'boolean') throw new Error('INVALID_LAUNCH_TARGET')
    return value
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  finally { await file?.close() }
}

async function writeRegistrationFile(file, content) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { mode: 0o600 })
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, file); break }
      catch (error) {
        // Windows may briefly deny replacement while another host reads/replaces it.
        if (attempt === 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error
        await delay(20 * (attempt + 1))
      }
    }
  } finally { await rm(temporary, { force: true }) }
}

export async function resolveLaunchTarget(value, platform = process.platform) {
  let executable, args = [], cwd
  if (value?.kind === 'source' && typeof value.root === 'string' && path.isAbsolute(value.root)) {
    cwd = value.root
    executable = path.join(cwd, 'node_modules/electron/dist', platform === 'win32' ? 'electron.exe'
      : platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron')
    args = [path.join(cwd, 'electron/device-main.mjs')]
    let manifest
    try { manifest = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')) }
    catch { throw new Error('LAUNCH_TARGET_MISSING') }
    if (manifest.name !== 'control-web-desktop-pet-demo') throw new Error('INVALID_LAUNCH_TARGET')
  } else if (value?.kind === 'app' && typeof value.executable === 'string' && path.isAbsolute(value.executable) &&
      path.basename(value.executable) === (platform === 'win32' ? 'AIBanlv.exe' : 'AIBanlv')) {
    executable = value.executable; cwd = path.dirname(executable)
  } else throw new Error('INVALID_LAUNCH_TARGET')
  for (const file of [executable, ...args]) {
    if (!(await stat(file).catch(() => null))?.isFile()) throw new Error('LAUNCH_TARGET_MISSING')
  }
  return { executable, args, cwd }
}

export async function registerDesktop({ directory = launchDirectory(), root, executable = process.execPath,
  isPackaged, automatic = false, platform = process.platform }) {
  const previous = await readSettings(directory)
  const value = { version: 1, ...(isPackaged ? { kind: 'app', executable } : { kind: 'source', root }), autoStart: previous?.autoStart ?? true }
  const target = await resolveLaunchTarget(value, platform)
  await writeRegistrationFile(configFile(directory), JSON.stringify(value, null, 2))
  // Bootstrap scripts can use the bundled Node runtime without requiring Node on PATH.
  await writeRegistrationFile(path.join(directory, 'desktop-launch-runtime'), target.executable)
  await writeRegistrationFile(path.join(directory, 'desktop-mcp-config.json'), JSON.stringify({ mcpServers: { aibanlv: {
    command: target.executable, args: [path.join(pluginDirectory, 'desktop-mcp.mjs')],
    env: { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '', ELECTRON_NO_ASAR: '' },
  } } }, null, 2))
  if (!automatic) await rm(pauseFile(directory), { force: true })
  return value
}

export function pauseAutomaticLaunch(directory = launchDirectory()) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(pauseFile(directory), 'Manually open AIBanlv to resume host launch.\n', { mode: 0o600 })
}

export async function setAutomaticLaunch(enabled, directory = launchDirectory()) {
  const value = await readSettings(directory)
  if (!value) throw new Error('LAUNCH_NOT_CONFIGURED')
  await writeRegistrationFile(configFile(directory), JSON.stringify({ ...value, autoStart: Boolean(enabled) }, null, 2))
  if (enabled) await rm(pauseFile(directory), { force: true })
}

export async function launchStatus(directory = launchDirectory()) {
  const value = await readSettings(directory)
  return { configured: Boolean(value), kind: value?.kind || null, autoStart: value?.autoStart ?? false, paused: existsSync(pauseFile(directory)) }
}

export async function launchDesktop({ automatic = false, source = false, directory = launchDirectory(),
  sourceRoot = path.resolve(pluginDirectory, '..'), platform = process.platform, env = process.env, spawnImpl = spawn } = {}) {
  const value = source ? { kind: 'source', root: sourceRoot } : await readSettings(directory)
  if (automatic) {
    if (!value) return { status: 'unconfigured' }
    if (!value.autoStart) return { status: 'disabled' }
    if (existsSync(pauseFile(directory))) return { status: 'paused' }
  }
  if (!value) throw new Error('LAUNCH_NOT_CONFIGURED')
  if (value.kind === 'source') {
    const updaterFile = path.join(value.root, 'electron/device-source-update.mjs')
    if (existsSync(updaterFile)) {
      const { resumeSourceUpdate, sourceUpdateActive } = await import(pathToFileURL(updaterFile).href)
      const updates = path.join(directory, 'updates')
      if (await sourceUpdateActive(updates)) return { status: 'updating' }
      if (!automatic && await resumeSourceUpdate(updates, path.resolve(value.root, '../..'))) return { status: 'updating' }
    }
  }
  const target = await resolveLaunchTarget(value, platform)
  const childEnv = { ...env }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_NO_ASAR']) delete childEnv[key]
  if (!automatic) await rm(pauseFile(directory), { force: true })
  const child = spawnImpl(target.executable, [...target.args, ...(automatic ? ['--aibanlv-auto-start'] : [])],
    { cwd: target.cwd, env: childEnv, shell: false, windowsHide: true, detached: true, stdio: 'ignore' })
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve) })
  child.unref()
  return { status: 'launched' }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--register-source')) await registerDesktop({ root: path.resolve(pluginDirectory, '..'), isPackaged: false })
    else if (process.argv.includes('--enable-auto-start')) await setAutomaticLaunch(true)
    else if (process.argv.includes('--disable-auto-start')) await setAutomaticLaunch(false)
    else await launchDesktop({ automatic: process.argv.includes('--auto'), source: process.argv.includes('--source') })
  } catch (error) {
    console.error(`[AIBanlv] ${error.code || error.message}. Run source setup or open the installed app once.`)
    process.exitCode = 1
  }
}
