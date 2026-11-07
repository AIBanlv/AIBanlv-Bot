import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises'
import { DesktopOrganizer } from '../electron/device-assistant-desktop.mjs'
import { moveWindowsFile } from '../electron/device-assistant-windows.mjs'

async function fixture(t) {
  await mkdir('artifacts', { recursive: true })
  const root = await mkdtemp(path.resolve('artifacts/desktop-organize-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const desktop = path.join(root, 'redirected-desktop'), history = path.join(root, 'history')
  await mkdir(desktop)
  const approvals = []
  const options = { desktop, history, approve: async action => { approvals.push(action); return true },
    moveFile: async (from, to) => { await link(from, to); await unlink(from) } }
  const organizer = new DesktopOrganizer(options)
  return { root, desktop, history, approvals, options, organizer }
}
const options = () => ({ signal: new AbortController().signal })

test('preview leaves all files unchanged and excludes folders, scripts, shortcuts and unsupported files', async t => {
  const f = await fixture(t)
  for (const name of ['report.pdf', 'photo.png', 'music.mp3', 'clip.mp4', 'archive.zip', 'desktop.ini',
    'app.lnk', 'run.exe', 'script.ps1', '.secret.txt', 'file.unknown']) await writeFile(path.join(f.desktop, name), name)
  await mkdir(path.join(f.desktop, 'Existing Folder'))
  const before = await readdir(f.desktop)
  const plan = await f.organizer.preview('desktop', options())
  assert.equal(plan.status, 'preview')
  assert.equal(plan.moves.length, 5)
  assert.deepEqual(await readdir(f.desktop), before)
  assert.equal(plan.skipped, 7)
  assert.equal(f.approvals[0].name, 'plan_desktop')
  await assert.rejects(f.organizer.preview(f.root, options()), /INVALID_ACTION/)
})

test('approved organization and restart-safe undo preserve bytes and original paths', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.desktop, 'notes.txt'), 'keep these bytes')
  const plan = await f.organizer.preview('desktop', options())
  const result = await f.organizer.apply(plan.planId, options())
  assert.equal(result.status, 'organized')
  assert.equal(result.moved, 1)
  const destination = path.join(f.desktop, plan.folder, plan.moves[0].to)
  assert.equal(await readFile(destination, 'utf8'), 'keep these bytes')
  await assert.rejects(readFile(path.join(f.desktop, 'notes.txt')), { code: 'ENOENT' })
  assert.ok(f.approvals[1].target.includes('notes.txt'))
  const restarted = new DesktopOrganizer(f.options)
  const restored = await restarted.undo('latest', options())
  assert.equal(restored.status, 'restored')
  assert.equal(restored.moved, 1)
  assert.equal(await readFile(path.join(f.desktop, 'notes.txt'), 'utf8'), 'keep these bytes')
  assert.equal((await readdir(f.desktop)).includes(plan.folder), false)
  assert.equal((await restarted.undo(result.batchId, options())).moved, 0)
})

test('denial, cancellation and changed source snapshots have no move side effects', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.desktop, 'notes.txt'), 'original')
  const plan = await f.organizer.preview('desktop', options())
  f.organizer.approve = async () => false
  await assert.rejects(f.organizer.apply(plan.planId, options()), /ACTION_DENIED/)
  f.organizer.approve = async () => { await writeFile(path.join(f.desktop, 'notes.txt'), 'changed'); return true }
  await assert.rejects(f.organizer.apply(plan.planId, options()), /TARGET_CHANGED/)
  assert.deepEqual(await readdir(f.desktop), ['notes.txt'])
  const next = await f.organizer.preview('desktop', options())
  const abort = new AbortController()
  f.organizer.approve = async () => { abort.abort(); return true }
  await assert.rejects(f.organizer.apply(next.planId, { signal: abort.signal }), /abort/i)
  assert.deepEqual(await readdir(f.desktop), ['notes.txt'])
})

test('restore never overwrites a new original file or moves an edited organized file', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.desktop, 'notes.txt'), 'original')
  const plan = await f.organizer.preview('desktop', options())
  await f.organizer.apply(plan.planId, options())
  await writeFile(path.join(f.desktop, 'notes.txt'), 'new user file')
  await assert.rejects(f.organizer.undo('latest', options()), /TARGET_CHANGED/)
  assert.equal(await readFile(path.join(f.desktop, 'notes.txt'), 'utf8'), 'new user file')
  await unlink(path.join(f.desktop, 'notes.txt'))
  await writeFile(path.join(f.desktop, plan.folder, plan.moves[0].to), 'edited organized file')
  await assert.rejects(f.organizer.undo('latest', options()), /TARGET_CHANGED/)
})

test('partial moves keep recovery records and can be restored after restart', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.desktop, 'a.txt'), 'first')
  await writeFile(path.join(f.desktop, 'b.txt'), 'second')
  const plan = await f.organizer.preview('desktop', options())
  let count = 0
  f.organizer.moveFile = async (from, to) => {
    if (++count === 2) throw new Error('fixture failure')
    await f.options.moveFile(from, to)
  }
  const result = await f.organizer.apply(plan.planId, options())
  assert.equal(result.status, 'partial')
  assert.equal(result.moved, 1)
  const restarted = new DesktopOrganizer(f.options)
  assert.equal((await restarted.undo(result.batchId, options())).moved, 1)
  assert.equal(await readFile(path.join(f.desktop, 'a.txt'), 'utf8'), 'first')
  assert.equal(await readFile(path.join(f.desktop, 'b.txt'), 'utf8'), 'second')
})

test('tampered history and replaced destination junctions are refused', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.desktop, 'a.txt'), 'first')
  const plan = await f.organizer.preview('desktop', options())
  await f.organizer.apply(plan.planId, options())
  const recordPath = path.join(f.history, `${plan.planId}.json`)
  const record = JSON.parse(await readFile(recordPath, 'utf8'))
  record.moves[0].from = '..\\outside.txt'
  await writeFile(recordPath, JSON.stringify(record))
  await assert.rejects(f.organizer.undo(plan.planId, options()), /HISTORY_INVALID/)
  const other = await fixture(t)
  await writeFile(path.join(other.desktop, 'a.txt'), 'first')
  const next = await other.organizer.preview('desktop', options())
  await mkdir(path.join(other.root, 'outside'))
  await symlink(path.join(other.root, 'outside'), path.join(other.desktop, next.folder), 'junction')
  await assert.rejects(other.organizer.apply(next.planId, options()), /TARGET_CHANGED/)
  assert.deepEqual(await readdir(path.join(other.root, 'outside')), [])
})

test('undo cleanup cannot traverse a substituted parent junction', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.desktop, 'a.txt'), 'keep')
  const plan = await f.organizer.preview('desktop', options())
  await f.organizer.apply(plan.planId, options())
  const outside = path.join(f.root, 'outside')
  await mkdir(path.join(outside, 'Documents'), { recursive: true })
  f.organizer.moveFile = async (from, to) => {
    await f.options.moveFile(from, to)
    await rename(path.join(f.desktop, plan.folder), path.join(f.desktop, `${plan.folder}-old`))
    await symlink(outside, path.join(f.desktop, plan.folder), 'junction')
  }
  await assert.rejects(f.organizer.undo('latest', options()), /TARGET_CHANGED|MOVE_FAILED/)
  assert.deepEqual(await readdir(outside), ['Documents'])
  assert.equal(await readFile(path.join(f.desktop, 'a.txt'), 'utf8'), 'keep')
})

test('native move refuses a replacement with matching size and time but different file identity', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  const original = path.join(f.desktop, 'a.txt')
  await writeFile(original, 'first')
  const time = new Date('2020-01-01T00:00:00Z')
  await utimes(original, time, time)
  const plan = await f.organizer.preview('desktop', options())
  f.organizer.moveFile = async (from, to, context) => {
    const replacement = path.join(f.root, 'replacement.txt')
    await writeFile(replacement, 'other')
    await utimes(replacement, time, time)
    await rename(from, path.join(f.root, 'original.txt'))
    await rename(replacement, from)
    await moveWindowsFile(from, to, context)
  }
  assert.equal((await f.organizer.apply(plan.planId, options())).status, 'partial')
  assert.equal(await readFile(original, 'utf8'), 'other')
  await assert.rejects(readFile(path.join(f.desktop, plan.folder, plan.moves[0].to)), { code: 'ENOENT' })
})

test('cancellation after movement reconciles actual locations and remains recoverable', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.desktop, 'a.txt'), 'first')
  await writeFile(path.join(f.desktop, 'b.txt'), 'second')
  const plan = await f.organizer.preview('desktop', options())
  const abort = new AbortController()
  f.organizer.moveFile = async (from, to) => { await f.options.moveFile(from, to); abort.abort() }
  await assert.rejects(f.organizer.apply(plan.planId, { signal: abort.signal }), /abort|cancel/i)
  assert.equal(f.organizer.lastOutcome.moved, 1)
  assert.equal(f.organizer.lastOutcome.batchId, plan.planId)
  assert.equal((await new DesktopOrganizer(f.options).undo('latest', options())).moved, 1)
})

test('hidden or system eligibility is checked again after approval', async t => {
  const f = await fixture(t)
  let excluded = []
  f.organizer.attributes = async () => excluded
  await writeFile(path.join(f.desktop, 'private.txt'), 'keep')
  const plan = await f.organizer.preview('desktop', options())
  f.organizer.approve = async () => { excluded = ['private.txt']; return true }
  await assert.rejects(f.organizer.apply(plan.planId, options()), /TARGET_CHANGED/)
  assert.deepEqual(await readdir(f.desktop), ['private.txt'])
})
