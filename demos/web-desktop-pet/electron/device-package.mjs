import { packager } from '@electron/packager'
import { downloadArtifact } from '@electron/get'
import { access, copyFile, cp, mkdir, mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveTextFiles } from './text-server.mjs'
import { controlToolchain } from '../scripts/prepare-control.mjs'
import { prepareJava } from '../scripts/device-package-tools.mjs'
import { bundleEntry } from '../scripts/bundle-entry.mjs'
import { buildTarget } from './platform/target.mjs'
import { prepareMacJava, assertMacArchitecture } from '../scripts/mac-package-tools.mjs'
import { windowsIcon } from '../scripts/device-icon.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.resolve(root, '../../..')
const control = path.resolve(root, '../..')

export const hostPluginFiles = ['package.json', 'cordis.patch.yml', 'plugin.mjs', 'README.md',
  'desktop-launch.mjs', 'desktop-mcp.mjs', 'run.ps1', 'run.sh', 'source-node.ps1', 'source-node.json', '.codex-plugin/plugin.json', 'hooks/hooks.json']

export async function copyHostPlugin(directory) {
  for (const name of hostPluginFiles) {
    const destination = path.join(directory, 'harness-client-plugin', name)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(path.join(root, 'harness-client-plugin', name), destination)
  }
  const marketplace = JSON.parse(await readFile(path.join(control, '.agents/plugins/marketplace.json'), 'utf8'))
  marketplace.plugins[0].source.path = './harness-client-plugin'
  await mkdir(path.join(directory, '.agents/plugins'), { recursive: true })
  await writeFile(path.join(directory, '.agents/plugins/marketplace.json'), JSON.stringify(marketplace, null, 2))
}

export function deviceBundleFiles() {
  const files = new Set([...resolveTextFiles()].filter(([route]) =>
    !route.startsWith('/desktop/') && route !== '/assets/avatar.zip').map(([, file]) => file))
  for (const name of [
    'device-main.mjs', 'device-windows.mjs', 'device-branding.mjs', 'device-preload.cjs', 'device.html', 'device-pet.html',
    'device-local-workspace.mjs', 'device-online-roles.mjs', 'device-roles-view.mjs',
    'device-plugin-catalog.mjs', 'device-plugins-view.mjs',
    'device-view.mjs', 'device-settings-navigation.mjs', 'device-pet.mjs', 'device.css', 'device-chat.mjs', 'device-audio.mjs',
    'device-moments.mjs', 'device-moments-view.mjs', 'device-moments-upload.mjs',
    'device-pet-policy.mjs', 'device-assets.mjs', 'device-runtime.mjs', 'device-channel.mjs', 'device-default-profile.mjs', 'device-catalog.mjs',
    'device-session.mjs', 'device-billing.mjs', 'device-realtime.mjs', 'device-lam.mjs',
    'device-score.mjs', 'device-conversation.mjs', 'device-text-conversation.mjs', 'device-guest-history.mjs',
    'device-history.mjs', 'device-guest-memory.mjs',
    'device-hardware-id.mjs', 'device-guest-identity.mjs',
    'device-model-settings.mjs', 'device-model-control.mjs', 'device-model-view.mjs',
    'device-conversation-store.mjs', 'device-history-control.mjs',
    'device-lam-engine.mjs', 'device-lam-worker.mjs', 'policy.mjs', 'text-server.mjs',
    'desktop.css', 'device-preferences.mjs', 'device-media-policy.mjs',
    'device-microphone.mjs', 'device-microphone-worklet.mjs', 'device-voice.mjs', 'device-touch.mjs', 'device-touch-policy.mjs',
    'device-waveform.mjs', 'device-mood.mjs', 'device-mood-policy.mjs', 'device-face-bank.mjs',
    'device-assistant-service.mjs', 'device-assistant-process.mjs', 'device-assistant-policy.mjs', 'device-harness-client.mjs',
    'device-assistant-runtime.mjs', 'device-assistant-plugin.mjs', 'device-assistant-worker.mjs', 'device-assistant-view.mjs',
    'device-computer-use.mjs', 'device-computer-policy.mjs',
    'device-assistant-apps.mjs', 'device-assistant-desktop.mjs', 'device-assistant-windows.mjs', 'device-assistant-approval.mjs',
    'device-assistant-file-ops.cs',
    'device-mail-settings.mjs', 'device-mail-client.mjs', 'device-mail-service.mjs', 'device-mail-view.mjs',
    'device-workbuddy.mjs', 'device-workbuddy-view.mjs', 'device-assistant-log.mjs',
    'device-remote-replies.mjs', 'device-notifications.mjs', 'device-notification-sync.mjs', 'device-first-greeting.mjs',
    'device-codex.mjs', 'device-codex-rollout.mjs', 'device-codex-queue.mjs', 'device-codex-remote.mjs', 'device-remote-tools.mjs', 'device-ai-tools.mjs', 'device-codex-view.mjs', 'device-activity.mjs', 'device-activity-view.mjs',
    'device-task-dispatcher.mjs', 'device-task-routing.mjs', 'device-workbuddy-agent.mjs',
    'device-account.mjs',
    'device-update.mjs', 'device-update-install.mjs', 'device-update-install.ps1', 'device-update-view.mjs',
    'device-update-io.mjs', 'device-update-delta.mjs', 'device-update-download.mjs', 'device-update-mode.mjs',
    'device-source-git.mjs', 'device-source-update.mjs', 'device-source-update-worker.mjs', 'device-source-update-progress.ps1',
    'device-file-transfer.mjs', 'device-direct-peer.mjs', 'device-transfer-view.mjs', 'device-task-intent.mjs',
    'device-binding-proof.mjs', 'device-http-auth.mjs', 'device-binding-code.mjs', 'device-startup.mjs',
    'platform/target.mjs', 'platform/mac-lam-backends.mjs',
    'platform/windows-lam-worker.mjs', 'device-quality.mjs', 'device-task-outbox.mjs', 'device-avatar-cache.mjs', 'device-file-request.mjs',
    'device-desktop-services.mjs', 'device-refresh-cadence.mjs', 'device-reminders.mjs', 'device-services-view.mjs', 'device-points.mjs', 'device-points-view.mjs', 'device-i18n.mjs',
    'device-traditional.mjs', 'device-invite.mjs', 'device-invite-view.mjs', 'device-task-review.mjs',
  ]) files.add(path.join(root, 'electron', name))
  for (const name of ['src/lam-track.mjs', 'src/device-presentation.mjs', 'src/device-particles.mjs', 'src/device-idle.mjs', 'scripts/device_lam_worker.py', 'scripts/prepare-control.mjs', 'scripts/source-runtime.mjs', 'harness-client-plugin/desktop-launch.mjs', 'harness-client-plugin/desktop-mcp.mjs']) {
    files.add(path.join(root, name))
  }
  files.add(path.join(control, 'utils/voicePairs.js'))
  files.add(path.join(root,'src/natural-messages.mjs'))
  files.add(path.join(control, 'android-native/digitalhuman-core/src/main/assets/AIBANLVKeyframeFace.json'))
  files.add(path.join(control, 'static/aibanlv-logo.png'))
  files.add(path.join(control, 'static/aibanlv.ico'))
  files.add(path.join(control, 'android-native/renderer/tools/ali-native-shell-ui/node_modules/gaussian-splat-renderer-for-lam/LICENSE'))
  return [...files]
}

export async function copyDeviceDependencies(names, targetFor) {
  const copied = new Set()
  async function copyDependency(name, from = root, optional = false) {
    const resolver = createRequire(path.join(from, 'package.json'))
    let json
    try { json = resolver.resolve(`${name}/package.json`) }
    catch (error) {
      if (optional && error.code === 'MODULE_NOT_FOUND') return
      if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
      // Native packages such as @img/sharp-* export only a binary subpath,
      // not their root or package.json. Follow Node's normal package roots.
      for (const directory of resolver.resolve.paths(name) || []) {
        const candidate = path.join(directory, name, 'package.json')
        const manifest = await readFile(candidate, 'utf8').then(JSON.parse).catch(() => null)
        if (manifest?.name === name) { json = candidate; break }
      }
      if (!json) throw new Error(`Cannot resolve dependency root: ${name}`)
    }
    const source = path.dirname(json)
    if (copied.has(source)) return
    copied.add(source)
    await cp(source, targetFor(source), { recursive: true,
      filter: file => !path.relative(source, file).split(path.sep).includes('node_modules') })
    const dependency = JSON.parse(await readFile(json, 'utf8'))
    const peers = Object.keys(dependency.peerDependencies || {}).filter(child => !dependency.peerDependenciesMeta?.[child]?.optional)
    for (const child of new Set([...Object.keys(dependency.dependencies || {}), ...peers])) await copyDependency(child, source)
    // npm installs only optional native packages matching this host. Copy those
    // that exist (Koffi and Loader bindings); never fetch binaries at runtime.
    for (const child of Object.keys(dependency.optionalDependencies || {})) await copyDependency(child, source, true)
  }
  for (const name of names) await copyDependency(name)
}

export function deviceDependencyNames(manifest, platform) {
  return [...Object.keys(manifest.dependencies),
    ...(platform === 'win32' ? ['dsh-computer-use-mode'] : [])]
}

export async function validateMacNativeDependencies(arch, { resolve = createRequire(path.join(root, 'package.json')).resolve,
  list = directory => readdir(directory, { recursive: true }), inspect = assertMacArchitecture } = {}) {
  for (const name of [`@koromix/koffi-darwin-${arch}`, `@deepseek-ai/node-addon-system-darwin-${arch}`]) {
    let directory
    try { directory = path.dirname(resolve(`${name}/package.json`)) }
    catch { throw new Error(`Missing target native dependency ${name}; install locked optional dependencies for ${arch} or build on the target Mac`) }
    const binaries = (await list(directory)).filter(file => file.endsWith('.node'))
    if (!binaries.length) throw new Error(`Missing native binary in ${name}`)
    for (const file of binaries) inspect(path.join(directory, file), arch)
  }
}

async function packageDevice() {
  const target = buildTarget()
  if (target.platform !== process.platform) throw new Error('Build Windows packages on Windows; Mac packages on macOS')
  const mac = target.platform === 'darwin'
  if (mac) await validateMacNativeDependencies(target.arch)
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const dist = path.join(root, 'dist')
  await mkdir(dist, { recursive: true })
  const build = await mkdtemp(path.join(dist, 'device-'))
  const stage = path.join(build, 'source'), runtime = path.join(stage, 'runtime')
  await mkdir(runtime, { recursive: true })
  const targetFor = source => {
    const relative = path.relative(workspace, source)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Bundle source outside workspace')
    return path.join(stage, relative)
  }
  for (const source of deviceBundleFiles()) {
    const target = targetFor(source)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(source, target)
  }
  await copyDeviceDependencies(deviceDependencyNames(manifest, target.platform), targetFor)
  if (mac) {
    const source = path.join(root, 'artifacts/mac')
    await mkdir(path.join(runtime, 'mac'), { recursive: true })
    assertMacArchitecture(path.join(source, target.arch, 'lam-worker'), target.arch)
    await copyFile(path.join(source, target.arch, 'lam-worker'), path.join(runtime, 'mac/lam-worker'))
    for (const name of ['lam_audio2exp_streaming.mlmodelc', 'names.json', 'model-manifest.json']) {
      await cp(path.join(source, name), path.join(runtime, 'mac', name), { recursive: true, mode: constants.COPYFILE_FICLONE })
    }
  } else if (process.env.DEVICE_PYTHON_STAGE) {
    const prepared = path.resolve(process.env.DEVICE_PYTHON_STAGE)
    for (const name of ['python', 'model', 'python-runtime.json']) {
      await access(path.join(prepared, name))
      await cp(path.join(prepared, name), path.join(runtime, name), { recursive: true })
    }
  } else {
    const { stageDevicePython } = await import('../scripts/package-device-python.mjs')
    await stageDevicePython(runtime)
  }
  const tools = await controlToolchain()
  const classes = path.join(runtime, 'control/classes')
  await mkdir(classes, { recursive: true })
  execFileSync(process.env.JAVAC || 'javac', ['-encoding', 'UTF-8', '--release', '17', '-cp', tools.jar, '-d', classes,
    ...tools.sources.filter(source => !source.includes(`${path.sep}tests${path.sep}`)),
    path.join(root, 'scripts/ControlLamStream.java')], { windowsHide: true, stdio: 'inherit' })
  await copyFile(tools.jar, path.join(runtime, 'control/gson.jar'))
  await copyFile(tools.library, path.join(runtime, 'control/AIBANLVKeyframeFace.json'))
  await cp(mac ? await prepareMacJava(target.arch) : await prepareJava(), path.join(runtime, 'java'), { recursive: true, dereference: mac })
  await writeFile(path.join(stage, 'package.json'), JSON.stringify({
    name: 'aibanlv', productName: 'AIBanlv', version: manifest.version,
    private: true, type: 'module', main: bundleEntry(root, 'device-main.mjs'),
  }, null, 2))
  execFileSync(process.execPath, ['--experimental-vm-modules', '--experimental-import-meta-resolve',
    path.join(root, 'scripts/verify-device-entry.mjs'), path.join(stage, bundleEntry(root, 'device-main.mjs')), stage],
  { stdio: 'inherit', windowsHide: true })
  const iconPath = path.join(build, 'aibanlv.ico')
  await writeFile(iconPath, windowsIcon(await readFile(path.join(control, 'static/aibanlv-logo.png'))))
  const version = manifest.devDependencies.electron
  const checksums = JSON.parse(await readFile(path.join(root, 'node_modules/electron/checksums.json'), 'utf8'))
  const archive = await downloadArtifact({ version, artifactName: 'electron', platform: target.platform, arch: target.arch, checksums,
    mirrorOptions: { mirror: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/' } })
  const [directory] = await packager({ dir: stage, out: build, name: 'AIBanlv', executableName: 'AIBanlv',
    platform: target.platform, arch: target.arch, electronVersion: version, electronZipDir: path.dirname(archive),
    appVersion: manifest.version, icon: mac ? undefined : iconPath, asar: false, prune: false, overwrite: false,
    win32metadata: { CompanyName: 'Ieasysell Limited', FileDescription: 'AIBanlv 桌面伴侣', ProductName: 'AIBanlv' },
  })
  await copyFile(mac ? path.join(control, 'MAC-TEST.md') : path.join(root, 'electron/device-test-readme.txt'), path.join(directory, 'Readme.txt'))
  await copyHostPlugin(directory)
  if (mac) {
    assertMacArchitecture(path.join(directory, 'AIBanlv.app/Contents/MacOS/AIBanlv'), target.arch)
    const licenses = path.join(directory, 'AIBanlv.app/Contents/Resources/licenses')
    await mkdir(licenses, { recursive: true })
    for (const name of ['LICENSE', 'LICENSES.chromium.html']) await copyFile(path.join(directory, name), path.join(licenses, name))
  }
  const result = { directory, executable: path.join(directory, mac ? 'AIBanlv.app' : 'AIBanlv.exe'),
    icon: iconPath, version: manifest.version, build, target }
  await writeFile(path.join(dist, `device-latest-${target.platform}-${target.arch}.json`), JSON.stringify(result, null, 2))
  await writeFile(path.join(dist, 'device-latest.json'), JSON.stringify(result, null, 2))
  await rm(stage, { recursive: true, force: true })
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await packageDevice()
