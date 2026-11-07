import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { codexLaunch } from '../electron/device-codex.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'control-codex-layout-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const npm = path.join(root, 'npm'), pkg = path.join(npm, 'node_modules/@openai/codex')
  const native = path.join(pkg, 'node_modules/@openai/codex-win32-x64')
  const bin = path.join(native, 'vendor/x86_64-pc-windows-msvc/bin')
  await mkdir(path.join(pkg, 'bin'), { recursive: true }); await mkdir(bin, { recursive: true })
  await writeFile(path.join(pkg, 'bin/codex.js'), '// synthetic wrapper')
  await writeFile(path.join(native, 'package.json'), JSON.stringify({ name: '@openai/codex-win32-x64', exports: { './package.json': './package.json' } }))
  for (const file of [path.join(npm, 'codex.exe'), path.join(bin, 'codex.exe'), path.join(bin, 'codex-code-mode-host.exe')]) await writeFile(file, 'synthetic executable, never run')
  return { root, npm, bin, options: { env: { APPDATA: root, PATH: '' }, platform: 'win32', arch: 'x64' } }
}
test('Codex launch prefers complete npm native toolchain over an orphan executable in npm root', async t => {
  const f = await fixture(t)
  assert.equal((await codexLaunch(f.options)).command, path.join(f.bin, 'codex.exe'))
})
test('explicit Codex path is never silently replaced and missing code-mode helper is diagnosed before creating a task', async t => {
  const f = await fixture(t)
  await assert.rejects(codexLaunch({ ...f.options, env: { ...f.options.env, PET_CODEX_BIN: path.join(f.npm, 'codex.exe') } }), /配套|code-mode/)
  const launch = await codexLaunch({ ...f.options, env: { ...f.options.env, PET_CODEX_BIN: path.join(f.bin, 'codex.exe') } })
  assert.equal(launch.command, path.join(f.bin, 'codex.exe'))
})

test('incomplete native packages are rejected rather than launched via a wrapper that hides missing tools', async t => {
  const f = await fixture(t)
  await rm(path.join(f.bin, 'codex-code-mode-host.exe'))
  await assert.rejects(codexLaunch(f.options), /配套执行程序缺失/)
})

test('non-Windows npm launch retains its Node wrapper without requiring a Windows helper', async t => {
  const f = await fixture(t)
  const launch = await codexLaunch({ ...f.options, platform: 'darwin' })
  assert.equal(launch.command, process.execPath)
  assert.equal(launch.args[0], path.join(f.npm, 'node_modules/@openai/codex/bin/codex.js'))
  assert.equal(launch.env.ELECTRON_RUN_AS_NODE, '1')
})
