import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { DesktopOrganizer } from '../electron/device-assistant-desktop.mjs'
import { moveWindowsFile } from '../electron/device-assistant-windows.mjs'

test('a base-directory junction substituted after validation cannot create categories outside the desktop', { skip: process.platform !== 'win32' }, async () => {
  await fs.mkdir('artifacts', { recursive: true })
  const root = await fs.mkdtemp(path.resolve('artifacts/desktop-directory-regression-'))
  const desktop = path.join(root, 'desktop'), outside = path.join(root, 'outside')
  await fs.mkdir(desktop)
  await fs.mkdir(outside)
  await fs.writeFile(path.join(desktop, 'notes.txt'), 'original fixture bytes')
  const organizer = new DesktopOrganizer({ desktop, history: path.join(root, 'history'),
    approve: async () => true, moveFile: moveWindowsFile })
  const context = { signal: new AbortController().signal }
  const plan = await organizer.preview('desktop', context)
  const base = path.join(desktop, plan.folder)
  const original = fs.lstat
  let substituted = false
  // Deterministically reproduce the race after a real, successful directory
  // stat. Only this isolated test process changes the built-in binding.
  fs.lstat = async (file, ...args) => {
    const result = await original(file, ...args)
    // realpath normalizes the drive letter casing, so compare like Windows does.
    if (typeof file === 'string' && file.toLowerCase() === base.toLowerCase() && result.isDirectory() && !substituted) {
      substituted = true
      await fs.rename(file, `${base}-original`)
      await fs.symlink(outside, file, 'junction')
    }
    return result
  }
  syncBuiltinESMExports()
  try {
    await assert.rejects(organizer.apply(plan.planId, context), /TARGET_CHANGED|MOVE_FAILED/)
    assert.equal(substituted, true, 'the directory substitution must reach the checked boundary')
    assert.deepEqual(await fs.readdir(outside), [], 'no category may be created through the junction')
    assert.equal(await fs.readFile(path.join(desktop, 'notes.txt'), 'utf8'), 'original fixture bytes')
  } finally {
    fs.lstat = original
    syncBuiltinESMExports()
    const resolved = path.resolve(root)
    assert.ok(resolved.startsWith(`${path.resolve('artifacts')}${path.sep}`))
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
