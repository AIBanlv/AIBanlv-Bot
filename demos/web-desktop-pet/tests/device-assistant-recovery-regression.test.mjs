import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, utimes, writeFile } from 'node:fs/promises'
import { DesktopOrganizer } from '../electron/device-assistant-desktop.mjs'
import { moveWindowsFile } from '../electron/device-assistant-windows.mjs'

const context = () => ({ signal: new AbortController().signal })
const fingerprint = value => ({ dev: String(value.dev), ino: String(value.ino),
  size: String(value.size), mtime: String(value.mtimeNs) })

async function fixture(t) {
  await mkdir('artifacts', { recursive: true })
  const root = await mkdtemp(path.resolve('artifacts/recovery-regression-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const desktop = path.join(root, 'desktop'), history = path.join(root, 'history')
  await mkdir(desktop)
  const options = { desktop, history, approve: async () => true,
    moveFile: async (source, target) => { await link(source, target); await unlink(source) } }
  return { root, desktop, history, options, organizer: new DesktopOrganizer(options) }
}

test('cancelling undo after its first move reports actual remaining files and permits restart recovery', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.desktop, 'a.txt'), 'first')
  await writeFile(path.join(f.desktop, 'b.txt'), 'second')
  const plan = await f.organizer.preview('desktop', context())
  await f.organizer.apply(plan.planId, context())
  const abort = new AbortController()
  f.organizer.moveFile = async (source, target) => {
    await f.options.moveFile(source, target)
    abort.abort()
  }

  await assert.rejects(f.organizer.undo(plan.planId, { signal: abort.signal }), /abort/i)
  assert.equal(f.organizer.lastOutcome?.batchId, plan.planId)
  assert.equal(f.organizer.lastOutcome?.moved, 1)
  assert.equal(f.organizer.lastOutcome?.remaining, 1)
  const recovered = await new DesktopOrganizer(f.options).undo('latest', context())
  assert.equal(recovered.moved, 1)
  assert.equal(await readFile(path.join(f.desktop, 'a.txt'), 'utf8'), 'first')
  assert.equal(await readFile(path.join(f.desktop, 'b.txt'), 'utf8'), 'second')
})

test('cancelling after the final undo move still records restoration before directory cleanup', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.desktop, 'a.txt'), 'first')
  const plan = await f.organizer.preview('desktop', context())
  await f.organizer.apply(plan.planId, context())
  const abort = new AbortController()
  f.organizer.moveFile = async (source, target) => {
    await f.options.moveFile(source, target)
    abort.abort()
  }

  await assert.rejects(f.organizer.undo(plan.planId, { signal: abort.signal }), /abort/i)
  assert.equal(f.organizer.lastOutcome?.batchId, plan.planId)
  assert.equal(f.organizer.lastOutcome?.moved, 1)
  assert.equal(f.organizer.lastOutcome?.remaining, 0)
  assert.equal(await readFile(path.join(f.desktop, 'a.txt'), 'utf8'), 'first')
  assert.equal((await new DesktopOrganizer(f.options).undo('latest', context())).moved, 0)
})

test('an interrupted unpublished history record cannot block latest valid recovery', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  await mkdir(f.history)
  const incomplete = path.join(f.history, `${'f'.repeat(32)}-0123456789abcdef.tmp`)
  await writeFile(incomplete, '{')
  await writeFile(path.join(f.desktop, 'notes.txt'), 'unchanged bytes')
  const plan = await f.organizer.preview('desktop', context())
  await f.organizer.apply(plan.planId, context())

  assert.equal(JSON.parse(await readFile(path.join(f.history, `${plan.planId}.json`), 'utf8')).id, plan.planId)
  assert.deepEqual((await readdir(f.history)).filter(name => name.endsWith('.tmp')), [path.basename(incomplete)])
  const recovered = await new DesktopOrganizer(f.options).undo('latest', context())
  assert.equal(recovered.batchId, plan.planId)
  assert.equal(recovered.moved, 1)
  assert.equal(await readFile(path.join(f.desktop, 'notes.txt'), 'utf8'), 'unchanged bytes')
  assert.equal(await readFile(incomplete, 'utf8'), '{')
})

test('native movement accepts the full Node fingerprint and preserves identity', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  const source = path.join(f.desktop, "文本 '[a]; $value.txt"), target = path.join(f.desktop, 'moved.txt')
  await writeFile(source, 'identity and bytes')
  const expected = fingerprint(await lstat(source, { bigint: true }))
  await moveWindowsFile(source, target, { ...context(), root: f.desktop, expected })
  assert.deepEqual(fingerprint(await lstat(target, { bigint: true })), expected)
  assert.equal(await readFile(target, 'utf8'), 'identity and bytes')
  await assert.rejects(lstat(source), { code: 'ENOENT' })
})

test('native movement rejects a substituted inode even with matching size and modification time', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  const source = path.join(f.desktop, 'notes.txt'), replacement = path.join(f.desktop, 'replacement.txt')
  const target = path.join(f.desktop, 'moved.txt')
  const time = new Date('2020-01-01T00:00:00Z')
  await writeFile(source, 'first')
  await utimes(source, time, time)
  const expected = fingerprint(await lstat(source, { bigint: true }))
  await writeFile(replacement, 'other')
  await utimes(replacement, time, time)
  await rename(source, path.join(f.desktop, 'original.txt'))
  await rename(replacement, source)
  const changed = fingerprint(await lstat(source, { bigint: true }))
  assert.equal(changed.size, expected.size)
  assert.equal(changed.mtime, expected.mtime)
  assert.notEqual(changed.ino, expected.ino)

  await assert.rejects(moveWindowsFile(source, target, { ...context(), root: f.desktop, expected }), /MOVE_FAILED/)
  assert.equal(await readFile(source, 'utf8'), 'other')
  await assert.rejects(lstat(target), { code: 'ENOENT' })
})
