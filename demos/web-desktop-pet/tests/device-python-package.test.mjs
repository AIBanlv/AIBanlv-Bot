import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  PYTHON_BUILD, DEPENDENCIES, dependencyClosure, runtimeRecordPath,
  copyOwnedFiles, verifyDigest, stageDevicePython,
} from '../scripts/package-device-python.mjs'

const sha = value => createHash('sha256').update(value).digest('hex')
async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'device-python-unit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('portable Python is a pinned x64 CPython 3.11 build, never a local venv', () => {
  assert.equal(PYTHON_BUILD.version, '3.11.17')
  assert.match(PYTHON_BUILD.url, /^https:\/\/github\.com\/astral-sh\/python-build-standalone\/releases\/download\/20261013\//)
  assert.match(PYTHON_BUILD.url, /x86_64-pc-windows-msvc-install_only_stripped\.tar\.gz$/)
  assert.match(PYTHON_BUILD.sha256, /^[a-f0-9]{64}$/)
  assert.equal(PYTHON_BUILD.bytes, 25240347)
})

test('dependency closure includes only reachable approved packages and checks versions', () => {
  const rows = [
    { name: 'torch', version: DEPENDENCIES.torch, requires: ['filelock'] },
    { name: 'filelock', version: DEPENDENCIES.filelock, requires: [] },
    { name: 'coremltools', version: '9.0', requires: [] },
  ]
  assert.deepEqual(dependencyClosure(rows, ['torch']).map(row => row.name), ['filelock', 'torch'])
  assert.throws(() => dependencyClosure(rows, ['coremltools']), /allowlist/i)
  assert.throws(() => dependencyClosure([{ ...rows[0], version: '0.0' }, rows[1]], ['torch']), /version/i)
  assert.throws(() => dependencyClosure([rows[0]], ['torch']), /missing/i)
  assert.throws(() => dependencyClosure([...rows, rows[0]], ['torch']), /duplicate/i)
})

test('RECORD policy retains native runtime and licenses, not build tools or origin metadata', () => {
  for (const name of ['torch/lib/torch_cpu.dll', 'numpy.libs/blas.dll', 'numpy/core/_multiarray.pyd',
    'numpy-1.26.3.dist-info/LICENSE.txt', 'certifi/cacert.pem', 'torch/__init__.py']) {
    assert.equal(runtimeRecordPath(name), name)
  }
  for (const name of ['../../Scripts/yapf.exe', '../../share/man/man1/isympy.1', 'torch/include/ATen.h', 'torch/lib/dnnl.lib',
    'torch/lib/torch_cpu.pdb', 'numpy/__pycache__/a.pyc', 'torch-2.2.0.dist-info/direct_url.json',
    'torch-2.2.0.dist-info/RECORD', 'distutils-precedence.pth']) {
    assert.equal(runtimeRecordPath(name), null)
  }
})

test('RECORD paths reject traversal, absolute paths, ADS and Windows aliases', () => {
  for (const name of ['../private.key', '/outside.py', 'C:/outside.py', 'x\\..\\outside.py',
    'torch/file:stream', 'torch/../outside.py', 'torch/CON', 'torch/name. ', 'torch//file']) {
    assert.throws(() => runtimeRecordPath(name), /path/i, name)
  }
})

test('owned-file copy does not sweep untracked secrets or caches and preserves licenses', async t => {
  const root = await temporary(t)
  const source = path.join(root, 'source'), target = path.join(root, 'target')
  await mkdir(path.join(source, 'pkg'), { recursive: true })
  await mkdir(path.join(source, 'pkg-1.dist-info'))
  await writeFile(path.join(source, 'pkg/code.py'), 'value = 1\n')
  await writeFile(path.join(source, 'pkg/private.key'), 'not-package-owned')
  await writeFile(path.join(source, 'pkg-1.dist-info/LICENSE'), 'license')
  const files = ['pkg/code.py', 'pkg-1.dist-info/LICENSE'].map(name => ({ path: name }))
  await copyOwnedFiles(source, target, files)
  assert.deepEqual(await readdir(path.join(target, 'pkg')), ['code.py'])
  assert.equal(await readFile(path.join(target, 'pkg-1.dist-info/LICENSE'), 'utf8'), 'license')
})

test('owned-file copy rejects modified installed bytes rather than silently repackaging them', async t => {
  const root = await temporary(t)
  await writeFile(path.join(root, 'module.py'), 'modified')
  await assert.rejects(copyOwnedFiles(root, path.join(root, 'out'), [
    { path: 'module.py', sha256: sha('original') },
  ]), /hash/i)
})

test('archive verification rejects wrong length and content even for a cached download', () => {
  const bytes = Buffer.from('archive')
  verifyDigest(bytes, { sha256: sha(bytes), bytes: bytes.length })
  assert.throws(() => verifyDigest(bytes, { sha256: sha('different'), bytes: bytes.length }), /hash/i)
  assert.throws(() => verifyDigest(bytes, { sha256: sha(bytes), bytes: 0 }), /size/i)
})

test('staging refuses to overwrite somebody else\'s existing runtime before network access', async t => {
  const root = await temporary(t)
  await mkdir(path.join(root, 'python'))
  await writeFile(path.join(root, 'python/keep.txt'), 'owned-by-caller')
  await assert.rejects(stageDevicePython(root), /exists/i)
  assert.equal(await readFile(path.join(root, 'python/keep.txt'), 'utf8'), 'owned-by-caller')
})
