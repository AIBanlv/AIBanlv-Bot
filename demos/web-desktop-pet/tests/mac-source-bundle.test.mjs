import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { installMacSource, requireMacHost, verifyMacBundle, writeMacBundleManifest } from '../scripts/install-mac-source.mjs'

const host = { platform: 'darwin', arch: 'arm64', macOS: '15.0' }
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'aibanlv Mac 环境 & '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bundle = path.join(root, 'bundle'), repository = path.join(root, "源码 ' quoted"), demo = path.join(repository, 'demos/web-desktop-pet')
  const files = ['mac/lam-worker', 'mac/names.json', 'mac/model-manifest.json', 'mac/lam_audio2exp_streaming.mlmodelc/weights.bin',
    'java/bin/java', 'java/bin/javac', 'control/gson.jar', 'tools/node/bin/node', 'tools/node/lib/node_modules/npm/bin/npm-cli.js']
  for (const name of files) {
    const file = path.join(bundle, name); await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, name, { mode: name.includes('/bin/') || name === 'mac/lam-worker' ? 0o755 : 0o644 })
  }
  await writeFile(path.join(bundle, 'source-runtime.json'), JSON.stringify({ schema: 1, target: 'darwin-arm64', minimumMacOS: '15.0', version: '1.0.0-candidate.1' }))
  await writeMacBundleManifest(bundle)
  await mkdir(demo, { recursive: true })
  await writeFile(path.join(repository, 'package.json'), '{"name":"control-windows"}')
  await writeFile(path.join(demo, 'package.json'), '{"name":"control-web-desktop-pet-demo"}')
  return { root, bundle, repository, demo, cacheDirectory: path.join(root, 'cache'), desktopDirectory: path.join(root, 'desktop'), host }
}

test('Mac resource integrity rejects damaged, extra, linked and incomplete files before executing tools', async t => {
  const f = await fixture(t)
  assert.ok((await verifyMacBundle(f.bundle)).files > 5)
  const model = path.join(f.bundle, 'mac/model-manifest.json')
  await writeFile(model, 'changed')
  await assert.rejects(verifyMacBundle(f.bundle), /校验失败/)
  await writeMacBundleManifest(f.bundle)
  const extra = path.join(f.bundle, 'unexpected-key')
  await writeFile(extra, 'must not be bundled')
  await assert.rejects(verifyMacBundle(f.bundle), /校验失败/)
  await rm(extra)
  await rm(model)
  await writeMacBundleManifest(f.bundle)
  await assert.rejects(verifyMacBundle(f.bundle), /不完整/)
  if (process.platform !== 'win32') {
    await symlink('../source-runtime.json', path.join(f.bundle, 'mac/linked'))
    await assert.rejects(writeMacBundleManifest(f.bundle), /链接/)
  }
})

test('Mac installer rejects Intel, Rosetta and older macOS rather than claiming ARM validation', () => {
  assert.doesNotThrow(() => requireMacHost(host))
  for (const value of [{ ...host, arch: 'x64' }, { ...host, platform: 'win32' }, { ...host, macOS: '14.9' }]) {
    assert.throws(() => requireMacHost(value), /Apple Silicon|macOS 15/)
  }
})

test('failed target inference leaves settings unchanged, publishes no ready state and supports a successful retry', async t => {
  const f = await fixture(t), config = path.join(f.demo, 'runtime.local.json'), calls = []
  const cache = f.cacheDirectory
  await mkdir(cache)
  f.cacheDirectory = path.join(f.root, 'cache-alias')
  await symlink(cache, f.cacheDirectory, 'junction')
  await writeFile(config, '{"unrelated":"preserved"}')
  const run = async (...args) => { calls.push(args) }
  await assert.rejects(installMacSource({ ...f, run, verify: async () => { throw Error('native inference failed') } }), /native inference failed/)
  assert.equal(await readFile(config, 'utf8'), '{"unrelated":"preserved"}')
  assert.deepEqual(await readdir(f.cacheDirectory), [])
  assert.equal(calls.length, 2, 'Registration and shortcut creation must wait for actual verification')
  let checked = 0
  const result = await installMacSource({ ...f, run, verify: async directory => {
    checked++
    assert.equal(path.dirname(directory), await realpath(f.cacheDirectory))
    assert.ok((await readFile(path.join(directory, 'mac/model-manifest.json'), 'utf8')).length)
  } })
  assert.equal(checked, 1)
  const ready = JSON.parse(await readFile(path.join(result.target, '.ready.json'), 'utf8'))
  assert.equal(ready.nativeVerified, true)
  const saved = JSON.parse(await readFile(config, 'utf8'))
  assert.equal(saved.unrelated, 'preserved')
  assert.equal(saved.JAVAC, path.join(result.target, 'java/bin/javac'))
  const shortcut = await readFile(result.shortcut, 'utf8')
  assert.ok(shortcut.includes("'\\''"), 'A quoted checkout path must be shell escaped')
  assert.ok(shortcut.includes('export PATH='))
  assert.ok(calls.at(-1)[1].includes('--register-source'))
})

test('existing model/tool overrides remain intact and are verified as a complete environment', async t => {
  const f = await fixture(t), config = path.join(f.demo, 'runtime.local.json')
  await writeFile(config, '{"GSON_JAR":"./custom/gson.jar","keep":true}')
  const checks = []
  await installMacSource({ ...f, run: async () => {}, verify: async (directory, env) => { checks.push({ directory, env }) } })
  assert.equal(checks.length, 2)
  assert.equal(checks[1].directory, null)
  assert.equal(checks[1].env.GSON_JAR, path.join(f.demo, 'custom/gson.jar'))
  const saved = JSON.parse(await readFile(config, 'utf8'))
  assert.equal(saved.GSON_JAR, './custom/gson.jar')
  assert.equal(saved.keep, true)
})
