import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createDesktopUpdate, sourceRevision } from '../electron/device-update-mode.mjs'
import { DeviceUpdate } from '../electron/device-update.mjs'

const execute = promisify(execFile)
test('source revision reads real Git branches, detached worktrees and rejects an enclosing repository', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'source-update-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const git = args => execute('git', args, { cwd: directory, windowsHide: true })
  await git(['init', '-q', '-b', 'fixture-branch'])
  await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
    'commit', '-q', '--allow-empty', '-m', 'fixture'])
  const commit = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  assert.deepEqual(await sourceRevision(directory), { branch: 'fixture-branch', commit, detached: false })
  const worktree = path.join(directory, 'worktree')
  await git(['worktree', 'add', '--detach', worktree, 'HEAD'])
  assert.deepEqual(await sourceRevision(worktree), { branch: '', commit, detached: true })
  const nested = path.join(directory, 'source-archive')
  await mkdir(nested)
  assert.equal(await sourceRevision(nested), null)
  assert.equal(await sourceRevision(directory, async () => { throw new Error('Git unavailable') }), null)
})

test('source mode checks and hands off Git updates without installer network, cache writes or installation', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'source-mode-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'setup.exe'), 'existing cache')
  const revision = { branch: 'master', commit: 'a'.repeat(40), detached: false }
  let prepared = 0, quit = 0
  const service = await createDesktopUpdate({ isPackaged: false, installed: true, platform: 'win32', arch: 'x64',
    directory, sourceDirectory: directory, version: '0.2.6',
    readRevision: async root => { assert.equal(root, directory); return revision },
    sourceCheck: async root => ({ root, branch: 'refs/heads/master', head: revision.commit, target: 'b'.repeat(40), available: true }),
    sourcePrepare: async ({ plan }) => { assert.equal(plan.target, 'b'.repeat(40)); prepared++ },
    sourceQuit: () => { quit++ },
    fetchImpl: () => assert.fail('Source mode must not fetch an installer feed'),
    handoff: () => assert.fail('Source mode must not launch an installer') })
  assert.equal(service.snapshot().runMode, 'source')
  assert.deepEqual(service.snapshot().source, revision)
  assert.equal(service.snapshot().canCheck, true)
  assert.equal(service.snapshot().canDownload, false)
  assert.equal((await service.install()).ok, false)
  assert.equal((await service.check()).status, 'available')
  assert.equal((await service.download()).ok, false)
  assert.equal((await service.install()).ok, true)
  assert.equal((await service.install()).ok, false)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(prepared, 1); assert.equal(quit, 1)
  assert.equal(await readFile(path.join(directory, 'setup.exe'), 'utf8'), 'existing cache')
})

test('installed Windows x64 uses the updater while portable and unsupported builds provide manual guidance', async () => {
  for (const [platform, arch, installed, mode] of [
    ['win32', 'x64', true, 'installed'], ['win32', 'x64', false, 'portable'],
    ['win32', 'arm64', true, 'unsupported'], ['darwin', 'arm64', false, 'unsupported'],
  ]) {
    const service = await createDesktopUpdate({ isPackaged: true, installed, platform, arch, version: '0.2.6',
      readRevision: () => assert.fail('Packaged app must not inspect Git'),
      fetchImpl: () => assert.fail('Manual mode must not check a feed') })
    assert.equal(service.snapshot().runMode, mode)
    assert.equal(service instanceof DeviceUpdate, mode === 'installed')
    if (mode !== 'installed') {
      assert.equal((await service.check()).canDownload, false)
      assert.equal((await service.download()).ok, false)
      assert.equal((await service.install()).ok, false)
    }
  }
})
