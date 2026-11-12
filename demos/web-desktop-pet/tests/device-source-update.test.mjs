import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile, writeFile, mkdir, access, copyFile, symlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { sourceFixture } from './source-update-fixture.mjs'
import { checkSourceUpdate, runSourceCommand, sourceError } from '../electron/device-source-git.mjs'
import { performSourceUpdate, runSourceWorker, processAlive } from '../electron/device-source-update-worker.mjs'
import { prepareSourceHandoff, SourceUpdate, pendingSourceUpdate } from '../electron/device-source-update.mjs'
import { launchDesktop } from '../harness-client-plugin/desktop-launch.mjs'

const fakeLaunch = () => {
  const child = new EventEmitter(); child.unref = () => {}
  setImmediate(() => child.emit('spawn')); return child
}

test('runtime-only update keeps a failed preparation pending and restarts after retry without npm reinstall', async t => {
  const f = await sourceFixture(t)
  await f.publish('source-runtime.lock.json', '{"schema":1}')
  const config = await configFor(f)
  assert.equal(config.plan.runtimeChanged, true)
  assert.equal(config.plan.dependenciesChanged, false)
  const setup = path.join(f.root, 'demos/web-desktop-pet/scripts/setup-runtime.mjs')
  let launches = 0
  await runSourceWorker(config, { progress: false, retry: () => false,
    perform: (job, options) => performSourceUpdate(job, { ...options, run: async (node, args) => {
      assert.equal(node, config.node); assert.deepEqual(args, [setup]); throw Error('download failed')
    }, launch: () => { launches++; return fakeLaunch() } }) })
  assert.equal(launches, 0)
  assert.equal(JSON.parse(await readFile(config.receipt, 'utf8')).code, 'SOURCE_RUNTIME')
  const service = new SourceUpdate({ directory: path.dirname(config.receipt), sourceDirectory: f.root })
  assert.equal((await service.check()).status, 'available')
  assert.equal(service.plan.runtimeChanged, true, 'recovery retains resource requirement after HEAD moved')
  await performSourceUpdate({ ...config, plan: service.plan }, { resume: true, run: async (_node, args) => assert.deepEqual(args, [setup]),
    launch: () => { launches++; return fakeLaunch() } })
  assert.equal(launches, 1)
  assert.equal((await service.check()).status, 'current')
})
async function configFor(f) {
  const directory = path.join(f.directory, 'updates'); await mkdir(directory)
  const config = { plan: await checkSourceUpdate(f.root), token: 'fixture', parentId: 0, node: process.execPath, npm: 'npm-fixture', jobFile: path.join(directory, 'job.json'),
    executable: process.execPath, args: ['-e', ''], receipt: path.join(directory, 'source-update.json'), cancelFile: path.join(directory, 'cancel') }
  await writeFile(config.jobFile, JSON.stringify(config))
  return config
}

test('worker waits for app exit, skips unchanged dependencies and restarts only after fast-forward', async t => {
  const f = await sourceFixture(t); await f.publish()
  const config = await configFor(f)
  let alive = true, launches = 0
  const work = runSourceWorker(config, { alive: () => alive, progress: false, retry: () => false,
    perform: (job, options) => performSourceUpdate(job, { ...options, run: () => assert.fail('No dependency changes'),
      launch: () => { launches++; return fakeLaunch() } }) })
  await delay(200)
  assert.equal(await readFile(path.join(f.root, 'app.txt'), 'utf8'), 'old')
  assert.equal(launches, 0)
  alive = false; await work
  assert.equal(await readFile(path.join(f.root, 'app.txt'), 'utf8'), 'new')
  assert.equal(launches, 1)
  assert.equal(JSON.parse(await readFile(config.receipt, 'utf8')).status, 'done')
})

test('failed dependency installation retries after HEAD moved and is still pending on a later check', async t => {
  const f = await sourceFixture(t); await f.publish('package.json', '{}')
  const config = await configFor(f), calls = []
  await runSourceWorker(config, { progress: false, retry: () => false,
    perform: (job, options) => performSourceUpdate(job, { ...options,
      run: async () => { throw new Error('fixture install failure') }, launch: () => assert.fail('Must not restart') }) })
  assert.equal((await f.git(f.root, 'rev-parse', 'HEAD')).stdout.trim(), config.plan.target)
  const service = new SourceUpdate({ directory: path.dirname(config.receipt), sourceDirectory: f.root })
  const state = await service.check()
  assert.equal(state.status, 'available'); assert.equal(state.dependenciesChanged, true)
  assert.match(state.message, /上次更新/)
  // Another handoff failure must not replace the immutable pending job/receipt.
  const receipt = JSON.parse(await readFile(config.receipt, 'utf8')); receipt.pid = 2147483647
  await writeFile(config.receipt, JSON.stringify(receipt))
  await assert.rejects(prepareSourceHandoff({ plan: service.plan, directory: path.dirname(config.receipt),
    tools: { node: process.execPath, npm: 'unused' }, launch: fakeLaunch, timeout: 40 }), { code: 'SOURCE_HANDOFF' })
  assert.equal((await service.check()).status, 'available')
  const recovery = { ...config, plan: service.plan, resume: true }
  await writeFile(config.jobFile, JSON.stringify(recovery))
  await runSourceWorker(recovery, { alive: () => true, waitMs: 0, progress: false, perform: () => assert.fail('Must wait') })
  assert.ok(await pendingSourceUpdate(path.dirname(config.receipt), f.root), 'cancelled recovery must remain pending')
  await performSourceUpdate(config, { resume: true, launch: fakeLaunch, run: async (file, args, options) => {
    calls.push(args.slice(1)); assert.equal(file, process.execPath); assert.equal(options.cwd, f.root)
  } })
  assert.deepEqual(calls, [['ci', '--no-audit', '--no-fund'], ['run', 'setup']])
  assert.equal((await service.check()).status, 'current')
})

test('worker timeout/cancellation leaves code untouched', async t => {
  const f = await sourceFixture(t); await f.publish()
  const config = await configFor(f)
  await runSourceWorker(config, { alive: () => true, waitMs: 0, progress: false, perform: () => assert.fail('Must not apply') })
  assert.equal(JSON.parse(await readFile(config.receipt, 'utf8')).status, 'cancelled')
  await writeFile(config.cancelFile, '')
  await runSourceWorker(config, { progress: false, perform: () => assert.fail('Cancelled handoff') })
  assert.equal(await readFile(path.join(f.root, 'app.txt'), 'utf8'), 'old')
})

test('concurrent recovery workers serialize the same checkout and release ownership after failure', async t => {
  const f = await sourceFixture(t), config = await configFor(f)
  let entered = 0
  const perform = async () => { entered++; await delay(200); throw sourceError('fixture') }
  await Promise.all(Array.from({ length: 12 }, () => runSourceWorker(config, { progress: false, perform, retry: () => false })))
  assert.equal(entered, 1)
  await runSourceWorker(config, { progress: false, perform, retry: () => false })
  assert.equal(entered, 2)
})

test('source shortcut continues failed npm installation even when Electron is missing', async t => {
  const f = await sourceFixture(t); await f.publish('package.json', '{}')
  const config = await configFor(f), updates = path.dirname(config.receipt)
  const calls = path.join(f.directory, 'npm-calls'), marker = path.join(f.directory, 'started')
  config.npm = path.join(f.directory, 'npm-fixture.cjs')
  config.args = ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`]
  await writeFile(config.npm, `const fs=require('node:fs'), file=${JSON.stringify(calls)};
    const first=!fs.existsSync(file); fs.appendFileSync(file, process.argv.slice(2).join(' ')+'\\n'); if(first) process.exit(1);`)
  await assert.rejects(performSourceUpdate(config), { code: 'SOURCE_DEPENDENCIES' })
  await writeFile(config.receipt, JSON.stringify({ token: config.token, job: config.jobFile, pid: 2147483647, status: 'error' }))
  await writeFile(config.jobFile, JSON.stringify(config))
  for (const name of ['device-source-git.mjs', 'device-source-update-worker.mjs']) {
    await copyFile(new URL(`../electron/${name}`, import.meta.url), path.join(updates, name))
  }
  await writeFile(path.join(updates, 'device-source-update-progress.ps1'), '\ufeff' + await readFile(new URL('../electron/device-source-update-progress.ps1', import.meta.url), 'utf8'))
  const demo = path.join(f.root, 'demos/web-desktop-pet'); await mkdir(path.join(demo, 'electron'), { recursive: true })
  await writeFile(path.join(demo, 'electron/device-source-update.mjs'),
    `export { resumeSourceUpdate, sourceUpdateActive } from ${JSON.stringify(new URL('../electron/device-source-update.mjs', import.meta.url).href)}`)
  assert.equal((await launchDesktop({ source: true, sourceRoot: demo, directory: f.directory })).status, 'updating')
  const deadline = Date.now() + 15000
  while (!await access(marker).then(() => true, () => false)) {
    assert.ok(Date.now() < deadline, 'shortcut did not resume installation'); await delay(80)
  }
  assert.deepEqual((await readFile(calls, 'utf8')).trim().split(/\r?\n/), ['ci --no-audit --no-fund', 'ci --no-audit --no-fund', 'run setup'])
  while (processAlive(JSON.parse(await readFile(config.receipt, 'utf8')).pid)) { assert.ok(Date.now() < deadline); await delay(80) }
})

test('source checking can be cancelled and handoff failure keeps the app open', async () => {
  let quit = false
  const service = new SourceUpdate({ sourceDirectory: 'fixture', sourceQuit: () => { quit = true },
    sourceCheck: (_root, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(sourceError('SOURCE_CANCELLED')))),
    sourcePrepare: async () => { throw sourceError('SOURCE_NODE') } })
  const check = service.check(); service.cancel()
  assert.equal((await check).ok, false); assert.match(service.snapshot().message, /取消/)
  service.plan = { available: true }
  assert.equal((await service.install()).ok, false); assert.equal(quit, false)
  assert.match(service.snapshot().message, /Node.js 24/)
})

test('detached staged helper survives parent exit and launches the updated fixture', async t => {
  const f = await sourceFixture(t); await f.publish()
  const config = await configFor(f), marker = path.join(f.directory, 'restarted')
  const temporary = path.join(f.directory, 'temporary'), alias = path.join(f.directory, 'temporary-alias')
  await mkdir(temporary); await symlink(temporary, alias, 'junction')
  const parent = path.join(f.directory, 'parent.mjs')
  const module = new URL('../electron/device-source-update.mjs', import.meta.url).href
  await writeFile(parent, `import { prepareSourceHandoff } from ${JSON.stringify(module)};
    process.env.TEMP = process.env.TMPDIR = ${JSON.stringify(alias)};
    await prepareSourceHandoff(${JSON.stringify({ plan: config.plan, directory: path.dirname(config.receipt), tools: { node: process.execPath, npm: 'unused' },
      executable: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`] })});
    await new Promise(resolve => setTimeout(resolve, 200));`)
  await runSourceCommand(process.execPath, [parent], { timeout: 15000 })
  const deadline = Date.now() + 15000
  while (!await access(marker).then(() => true, () => false)) {
    assert.ok(Date.now() < deadline, 'detached helper never restarted the fixture'); await delay(80)
  }
  assert.equal(await readFile(path.join(f.root, 'app.txt'), 'utf8'), 'new')
  while (processAlive(JSON.parse(await readFile(config.receipt, 'utf8')).pid)) { assert.ok(Date.now() < deadline); await delay(80) }
})

test('stalled handoff marks cancellation so a late helper cannot apply code', async t => {
  const f = await sourceFixture(t); await f.publish()
  const config = await configFor(f)
  let jobFile
  await assert.rejects(prepareSourceHandoff({ plan: config.plan, directory: path.dirname(config.receipt),
    tools: { node: process.execPath, npm: 'unused' }, launch: (_file, args) => { jobFile = args[1]; return fakeLaunch() }, timeout: 40 }), { code: 'SOURCE_HANDOFF' })
  const job = JSON.parse(await readFile(jobFile, 'utf8'))
  await access(job.cancelFile)
  await runSourceWorker(job, { progress: false, perform: () => assert.fail('Late helper must not update') })
  assert.equal(await readFile(path.join(f.root, 'app.txt'), 'utf8'), 'old')
})
