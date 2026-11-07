import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const audit = (entry, root) => execFileSync(process.execPath, ['--experimental-vm-modules', '--experimental-import-meta-resolve',
  path.resolve('scripts/verify-device-entry.mjs'), entry, root], { encoding: 'utf8', stdio: 'pipe', windowsHide: true })

test('distribution entry audit resolves local imports without executing application code or needing Electron installed', async t => {
  const stage = await mkdtemp(path.join(tmpdir(), 'device-entry-'))
  t.after(() => rm(stage, { recursive: true, force: true }))
  await writeFile(path.join(stage, 'entry.mjs'), "import 'node:fs'; import 'electron'; import './child.mjs'; throw new Error('Application code must not execute')")
  await writeFile(path.join(stage, 'child.mjs'), "export { value } from './leaf.mjs'")
  await writeFile(path.join(stage, 'leaf.mjs'), 'export const value = 1')
  assert.deepEqual(JSON.parse(audit(path.join(stage, 'entry.mjs'), stage)), { modules: 3, packages: [] })
})

test('distribution entry audit rejects missing modules and imports resolved outside the distribution', async t => {
  const stage = await mkdtemp(path.join(tmpdir(), 'device-entry-errors-'))
  t.after(() => rm(stage, { recursive: true, force: true }))
  const bundle = path.join(stage, 'bundle'), entry = path.join(bundle, 'entry.mjs')
  await mkdir(bundle)
  await writeFile(entry, "import './missing.mjs'")
  assert.throws(() => audit(entry, bundle), error => error.stderr.includes('missing.mjs') && error.stderr.includes('ENOENT'))
  await writeFile(path.join(stage, 'outside.mjs'), 'export const value = 1')
  await writeFile(entry, "import '../outside.mjs'")
  assert.throws(() => audit(entry, bundle), error => error.stderr.includes('escapes distribution'))
})
