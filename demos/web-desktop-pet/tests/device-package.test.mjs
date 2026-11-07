import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deviceBundleFiles, copyDeviceDependencies, validateMacNativeDependencies, deviceDependencyNames, copyHostPlugin, hostPluginFiles } from '../electron/device-package.mjs'

test('external host plugin distribution contains the complete runtime and relocatable marketplace', async t => {
  const stage = await mkdtemp(path.join(tmpdir(), 'aibanlv-plugin-package-'))
  t.after(() => rm(stage, { recursive: true, force: true }))
  await copyHostPlugin(stage)
  for (const name of hostPluginFiles) await access(path.join(stage, 'harness-client-plugin', name))
  const marketplace = JSON.parse(await readFile(path.join(stage, '.agents/plugins/marketplace.json'), 'utf8'))
  await access(path.join(stage, marketplace.plugins[0].source.path, '.codex-plugin/plugin.json'))
})
import { AssistantProcess } from '../electron/device-assistant-process.mjs'

test('Mac distribution rejects missing or wrong-architecture native plugin dependencies before packaging', async () => {
  const inspected = []
  const options = { resolve: name => path.join('/fixture', name), list: async () => ['bin/system.node'],
    inspect: (file, arch) => inspected.push([file, arch]) }
  await validateMacNativeDependencies('arm64', options)
  assert.equal(inspected.length, 2)
  assert.ok(inspected.every(([file, arch]) => file.includes('darwin-arm64') && arch === 'arm64'))
  await assert.rejects(validateMacNativeDependencies('arm64', { ...options, resolve: () => { throw new Error('missing') } }), /Missing target native dependency/)
  await assert.rejects(validateMacNativeDependencies('arm64', { ...options, inspect: () => { throw new Error('wrong architecture') } }), /wrong architecture/)
})

test('device distribution includes its complete entry but no private profiles or offline preview entry', async () => {
  const repository = fileURLToPath(new URL('../../../', import.meta.url))
  const files = deviceBundleFiles()
  const names = files.map(file => path.basename(file))
  for (const name of ['device-main.mjs', 'device-pet.html', 'device-chat.mjs', 'device-lam-engine.mjs',
    'device-plugin-catalog.mjs', 'device-plugins-view.mjs',
    'device-hardware-id.mjs', 'device-guest-identity.mjs',
    'device-update.mjs', 'device-update-io.mjs', 'device-update-delta.mjs', 'device-update-download.mjs', 'device-update-mode.mjs',
    'device_lam_worker.py', 'lam-track.mjs', 'voicePairs.js', 'device-preload.cjs', 'device-default-profile.mjs', 'device-catalog.mjs', 'device-http-auth.mjs',
    'device-particles.mjs', 'device-idle.mjs', 'AIBANLVKeyframeFace.json', 'device-preferences.mjs', 'device-voice.mjs', 'device-microphone.mjs',
    'device-microphone-worklet.mjs', 'device-media-policy.mjs', 'device-touch.mjs', 'device-touch-policy.mjs',
    'device-waveform.mjs', 'device-mood.mjs', 'device-mood-policy.mjs', 'device-face-bank.mjs',
    'device-assistant-service.mjs', 'device-assistant-runtime.mjs', 'device-assistant-process.mjs', 'device-task-routing.mjs',
    'device-assistant-policy.mjs', 'device-assistant-plugin.mjs', 'device-assistant-worker.mjs', 'device-assistant-view.mjs',
    'device-assistant-apps.mjs', 'device-assistant-desktop.mjs', 'device-assistant-windows.mjs',
    'device-assistant-approval.mjs', 'device-assistant-file-ops.cs',
    'device-mail-settings.mjs', 'device-mail-client.mjs', 'device-mail-service.mjs', 'device-mail-view.mjs', 'aibanlv-logo.png', 'desktop-launch.mjs']) {
    assert.ok(names.includes(name), `${name} must be bundled`)
  }
  for (const name of ['main.mjs', 'package.mjs', 'device-update-blockmap.mjs', 'device-gaze.mjs', 'text-controller.mjs', 'runtime.local.json', 'device-identity.json', 'benny-avatar.zip',
    'device-local-profile.mjs', 'device-local-engine.mjs', 'local-avatar.html', 'local-avatar.css', 'local-avatar.mjs']) {
    assert.equal(names.includes(name), false, `${name} must not enter the device distribution`)
  }
  assert.ok(files.every(file => !/[/\\](artifacts|dist|avatars-[^/\\]*)[/\\]/.test(file)))
  for (const file of files) {
    const relative = path.relative(repository, file)
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), file)
    await access(file)
  }
})

test('device startup graph and embedded Harness load with only distribution dependencies outside the source tree', async t => {
  const stage = await mkdtemp(path.join(tmpdir(), 'control-harness-package-'))
  t.after(() => rm(stage, { recursive: true, force: true }))
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const workspace = path.resolve('../../..')
  const targetFor = source => path.join(stage, path.relative(workspace, source))
  const packagedRoot = targetFor(path.resolve('.'))
  await copyDeviceDependencies(deviceDependencyNames(manifest, process.platform), targetFor)
  for (const source of deviceBundleFiles()) {
    const target = targetFor(source)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(source, target)
  }
  await writeFile(path.join(stage, 'package.json'), '{"type":"module"}')
  const audit = execFileSync(process.execPath, ['--experimental-vm-modules', '--experimental-import-meta-resolve',
    path.resolve('scripts/verify-device-entry.mjs'), path.join(packagedRoot, 'electron/device-main.mjs'), stage],
  { encoding: 'utf8', windowsHide: true, stdio: 'pipe' })
  assert.ok(JSON.parse(audit).packages.includes('ws'), 'Realtime WebSocket must resolve without development dependencies')
  const differential = await import(pathToFileURL(path.join(packagedRoot, 'electron/device-update-delta.mjs')).href)
  assert.equal(typeof differential.deltaPlan, 'function', 'Pinned differential algorithm must load outside the source tree')
  execFileSync(process.execPath, ['-e', "require('koffi')"], { cwd: packagedRoot, windowsHide: true, stdio: 'pipe' })
  execFileSync(process.execPath, ['-e', "require('sharp')"], { cwd: packagedRoot, windowsHide: true, stdio: 'pipe' })
  if (process.platform === 'win32') execFileSync(process.execPath, ['-e', "require('dsh-computer-use-mode')"], { cwd: packagedRoot, windowsHide: true, stdio: 'pipe' })
  const { prepareHarnessLaunch } = await import(pathToFileURL(path.join(packagedRoot, 'electron/device-assistant-runtime.mjs')).href)
  const launch = await prepareHarnessLaunch({ home: path.join(stage, 'private'), apiKey: 'fixture-only-key',
    endpoint: 'http://127.0.0.1:1/tools', token: 'a'.repeat(64) })
  const assistant = new AssistantProcess({ launch, startMs: 10000 })
  t.after(() => assistant.close())
  await assistant.start()
  assert.ok(assistant.sessionId)
  await assistant.close()
})

test('packaged ACP loads its required peer without package.json export access', async t => {
  await mkdir('artifacts', { recursive: true })
  const stage = await mkdtemp(path.resolve('artifacts/dependency-stage-'))
  t.after(() => rm(stage, { recursive: true, force: true }))
  await copyDeviceDependencies(['@agentclientprotocol/sdk'], source => path.join(stage, path.relative(path.resolve('.'), source)))
  const acp = await import(pathToFileURL(path.join(stage, 'node_modules/@agentclientprotocol/sdk/dist/acp.js')).href)
  assert.equal(acp.PROTOCOL_VERSION, 1)
  await access(path.join(stage, 'node_modules/zod/package.json'))
})
