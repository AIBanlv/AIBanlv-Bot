import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { zipSync } from 'fflate'
import { ensureSourceRuntime } from '../scripts/source-runtime-install.mjs'
import { runtimeEnvironment, readRuntimeOverrides, sourceRuntimeRequirement } from '../scripts/source-runtime.mjs'
import { sourceEnvironment } from '../electron/device-source-git.mjs'

async function fixture(t, files = { 'java/bin/java.exe': 'java', 'java/bin/javac.exe': 'javac',
  'control/gson.jar': 'gson', 'python/python.exe': 'python', 'model/pretrained_models/LAM_audio2exp_streaming.tar': 'model' }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibanlv 资源 & '))
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 4 }))
  const bytes = Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, Buffer.from(value)]))))
  const archive = path.join(directory, 'runtime.zip'); await writeFile(archive, bytes)
  const requirement = { version: '1.0.0', platform: 'win32', arch: 'x64', url: 'https://download.aibanlv.ai/fixture.zip',
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, unpackedBytes: 100000 }
  return { archive, requirement, cacheDirectory: path.join(directory, 'cache') }
}

test('runtime publishes only after verification, reuses cache across concurrent callers and retries a failed verification', async t => {
  const f = await fixture(t)
  await assert.rejects(ensureSourceRuntime(f.requirement, { ...f, verify: async () => { throw Error('model failed') } }), /model failed/)
  let verified = 0
  const options = { ...f, verify: async directory => {
    assert.equal(await readFile(path.join(directory, 'python/python.exe'), 'utf8'), 'python'); verified++
  } }
  const roots = await Promise.all([ensureSourceRuntime(f.requirement, options), ensureSourceRuntime(f.requirement, options)])
  assert.equal(roots[0], roots[1]); assert.equal(verified, 2)
  await rm(f.archive)
  assert.equal(await ensureSourceRuntime(f.requirement, options), roots[0], 'ready cache needs no network/archive')
})

test('explicit setup repairs a damaged cache instead of trusting its ready receipt', async t => {
  const f = await fixture(t)
  const verify = async root => assert.equal(await readFile(path.join(root, 'python/python.exe'), 'utf8'), 'python')
  const root = await ensureSourceRuntime(f.requirement, { ...f, verify })
  await writeFile(path.join(root, 'python/python.exe'), 'corrupted')
  assert.equal(await ensureSourceRuntime(f.requirement, { ...f, verify }), root)
  assert.equal(await readFile(path.join(root, 'python/python.exe'), 'utf8'), 'python')
  await assert.rejects(ensureSourceRuntime(f.requirement, { cacheDirectory: f.cacheDirectory,
    fetch: () => assert.fail('A source compile error must not redownload the runtime'),
    verify: async () => { throw Object.assign(Error('bad source'), { code: 'SOURCE_RUNTIME_CODE' }) } }), { code: 'SOURCE_RUNTIME_CODE' })
})

test('wrong archive checksum/size and traversal are rejected before executing runtime', async t => {
  const f = await fixture(t)
  const options = { ...f, verify: () => assert.fail('Must not execute unverified files') }
  await assert.rejects(ensureSourceRuntime({ ...f.requirement, sha256: '0'.repeat(64) }, options), /校验/)
  await assert.rejects(ensureSourceRuntime({ ...f.requirement, bytes: 1 }, options), /大小/)
  const malicious = await fixture(t, { '../escaped': 'payload' })
  await assert.rejects(ensureSourceRuntime(malicious.requirement, { ...malicious, verify: options.verify }), /路径|relative path/)
  await assert.rejects(access(path.join(malicious.cacheDirectory, 'escaped')))
})

test('streamed download enforces pinned data and leaves a previous version usable on failure', async t => {
  const f = await fixture(t), bytes = await readFile(f.archive)
  const oldRoot = await ensureSourceRuntime(f.requirement, { ...f, verify: async () => {} })
  const next = { ...f.requirement, version: '1.0.1' }
  await assert.rejects(ensureSourceRuntime(next, { cacheDirectory: f.cacheDirectory,
    fetch: async () => new Response(bytes.subarray(0, 10)), verify: () => assert.fail('Truncated response') }), /大小/)
  await access(path.join(oldRoot, '.ready.json'))
  const newRoot = await ensureSourceRuntime(next, { cacheDirectory: f.cacheDirectory,
    fetch: async () => new Response(bytes), verify: async () => {} })
  assert.notEqual(oldRoot, newRoot)
})

test('large runtime download uses bounded ranges, retries a failed part and rejects wrong offsets', async t => {
  const f = await fixture(t), payload = randomBytes(3 * 1024 ** 2 + 29)
  const { downloadRuntime } = await import('../scripts/source-runtime-install.mjs')
  const requirement = { ...f.requirement, bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex') }
  let failures = 0, requests = 0
  const fetch = async (_url, { headers }) => {
    requests++
    assert.match(headers.Range, /^bytes=\d+-\d+$/)
    const [, start, end] = headers.Range.match(/^bytes=(\d+)-(\d+)$/).map(Number)
    assert.ok(end - start < 1024 ** 2)
    if (start === 1024 ** 2 && !failures++) return new Response('', { status: 503 })
    return new Response(payload.subarray(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${payload.length}` } })
  }
  const output = path.join(path.dirname(f.archive), 'ranged.zip')
  await downloadRuntime(requirement, output, { fetch })
  assert.deepEqual(await readFile(output), payload); assert.equal(requests, 5)
  await assert.rejects(downloadRuntime(requirement, output + '.invalid', { fetch: async () =>
    new Response(payload.subarray(0, 8), { status: 206, headers: { 'Content-Range': `bytes 1-8/${payload.length}` } }) }), /分块/)
})

test('environment preserves developer overrides and resolves managed Java without precompiled classes', () => {
  const root = path.resolve('fixture-runtime')
  const env = runtimeEnvironment(root, { PET_PYTHON: 'custom-python', JAVAC: 'custom-compiler' }, 'win32')
  assert.equal(env.PET_PYTHON, 'custom-python'); assert.equal(env.JAVAC, 'custom-compiler')
  assert.equal(env.JAVA, path.join(root, 'java/bin/java.exe'))
  assert.equal(env.GSON_JAR, path.join(root, 'control/gson.jar'))
  assert.equal(env.PET_LAM_SOURCE, path.join(root, 'model'))
  const updaterEnv = sourceEnvironment(env)
  assert.equal(updaterEnv.PET_PYTHON, 'custom-python')
  assert.equal(updaterEnv.JAVAC, 'custom-compiler')
  assert.equal(updaterEnv.JAVA, undefined, 'old automatically supplied paths must not pin the next runtime version')
  assert.equal(updaterEnv.GSON_JAR, undefined)
})

test('runtime.local.json paths stay relative to the demo and never replace explicit environment values', async t => {
  const f = await fixture(t), demo = path.dirname(f.archive)
  await writeFile(path.join(demo, 'runtime.local.json'), JSON.stringify({ PET_PYTHON: './python/python.exe', JAVA: 'custom-java' }))
  const env = await readRuntimeOverrides(demo, { JAVA: 'environment-java' })
  assert.equal(env.JAVA, 'environment-java')
  assert.equal(env.PET_PYTHON, path.join(demo, 'python/python.exe'))
})

test('runtime requirements reject unsupported targets, mutable/unsafe URLs and invalid digests', async t => {
  const f = await fixture(t), lock = { schema: 1, targets: { 'win32-x64': f.requirement } }
  assert.deepEqual(sourceRuntimeRequirement(lock, 'win32', 'x64'), f.requirement)
  assert.throws(() => sourceRuntimeRequirement(lock, 'darwin', 'arm64'), /尚未发布/)
  for (const patch of [{ url: 'http://download.aibanlv.ai/file.zip' }, { version: '../escape' }, { sha256: 'bad' }]) {
    assert.throws(() => sourceRuntimeRequirement({ ...lock, targets: { 'win32-x64': { ...f.requirement, ...patch } } }, 'win32', 'x64'))
  }
})
