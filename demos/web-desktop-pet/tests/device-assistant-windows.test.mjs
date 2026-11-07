import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { moveWindowsFile, listWindowsApps } from '../electron/device-assistant-windows.mjs'

test('native discovery returns current Windows app entries without invoking them', { skip: process.platform !== 'win32' }, async () => {
  const apps = await listWindowsApps({ signal: new AbortController().signal })
  assert.ok(Array.isArray(apps))
  assert.ok(apps.length > 0)
  assert.ok(apps.every(app => typeof app.name === 'string' && typeof app.id === 'string'))
})

test('native move preserves literal names and refuses existing destinations', { skip: process.platform !== 'win32' }, async t => {
  await mkdir('artifacts', { recursive: true })
  const root = await mkdtemp(path.resolve('artifacts/windows-move-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, "literal '[test]; $value.txt"), target = path.join(root, 'target.txt')
  await writeFile(source, 'original')
  await writeFile(target, 'existing')
  await assert.rejects(moveWindowsFile(source, target, { signal: new AbortController().signal }), /MOVE_FAILED/)
  assert.equal(await readFile(source, 'utf8'), 'original')
  assert.equal(await readFile(target, 'utf8'), 'existing')
  const next = path.join(root, 'moved.txt')
  await moveWindowsFile(source, next, { signal: new AbortController().signal })
  assert.equal(await readFile(next, 'utf8'), 'original')
  await assert.rejects(readFile(source), { code: 'ENOENT' })
})
