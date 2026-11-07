import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { checkSourceUpdate, applySourceUpdate } from '../electron/device-source-git.mjs'
import { sourceFixture as fixture } from './source-update-fixture.mjs'

test('source check fetches without changing the checkout; apply fast-forwards and preserves local files', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.root, 'local.iml'), 'user file')
  await writeFile(path.join(f.root, 'runtime.local.json'), 'private configuration')
  await f.publish()
  const plan = await checkSourceUpdate(f.root)
  assert.equal(plan.available, true); assert.equal(plan.dependenciesChanged, false)
  assert.equal(await readFile(path.join(f.root, 'app.txt'), 'utf8'), 'old')
  await applySourceUpdate(plan)
  assert.equal(await readFile(path.join(f.root, 'app.txt'), 'utf8'), 'new')
  assert.equal(await readFile(path.join(f.root, 'local.iml'), 'utf8'), 'user file')
  assert.equal(await readFile(path.join(f.root, 'runtime.local.json'), 'utf8'), 'private configuration')
  assert.equal((await checkSourceUpdate(f.root)).available, false)
})

test('dependency changes are detected; dirty, detached and divergent branches cannot update', async t => {
  const f = await fixture(t)
  await f.publish('demos/web-desktop-pet/package-lock.json', '{}')
  assert.equal((await checkSourceUpdate(f.root)).dependenciesChanged, true)
  await writeFile(path.join(f.root, 'app.txt'), 'user edit')
  await assert.rejects(checkSourceUpdate(f.root), { code: 'SOURCE_DIRTY' })
  await f.git(f.root, 'add', '.'); await f.git(f.root, 'commit', '-qm', '本地改动')
  await assert.rejects(checkSourceUpdate(f.root), { code: 'SOURCE_DIVERGED' })
  await f.git(f.root, 'checkout', '--detach')
  await assert.rejects(checkSourceUpdate(f.root), { code: 'SOURCE_DETACHED' })
})

test('apply rechecks the branch and refuses edits or new commits made after checking', async t => {
  const f = await fixture(t); await f.publish()
  const plan = await checkSourceUpdate(f.root)
  await writeFile(path.join(f.root, 'app.txt'), 'user edit')
  await assert.rejects(applySourceUpdate(plan), { code: 'SOURCE_DIRTY' })
  await f.git(f.root, 'add', '.'); await f.git(f.root, 'commit', '-qm', '检查后的提交')
  await assert.rejects(applySourceUpdate(plan), { code: 'SOURCE_CHANGED' })
  assert.equal(await readFile(path.join(f.root, 'app.txt'), 'utf8'), 'user edit')
})

test('upstream files cannot overwrite ignored configuration and missing tracking is explicit', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.root, 'runtime.local.json'), 'keep')
  await f.publish('runtime.local.json', 'upstream')
  const plan = await checkSourceUpdate(f.root)
  await assert.rejects(applySourceUpdate(plan))
  assert.equal(await readFile(path.join(f.root, 'runtime.local.json'), 'utf8'), 'keep')
  await f.git(f.root, 'branch', '--unset-upstream')
  await assert.rejects(checkSourceUpdate(f.root), { code: 'SOURCE_NO_UPSTREAM' })
  const nested = path.join(f.root, 'nested'); await mkdir(nested)
  await assert.rejects(checkSourceUpdate(nested), { code: 'SOURCE_NOT_REPOSITORY' })
})
