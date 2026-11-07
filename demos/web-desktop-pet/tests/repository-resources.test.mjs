import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { deviceBundleFiles } from '../electron/device-package.mjs'
import { resolveDemoFiles } from '../server.mjs'
import { resolveTextFiles } from '../electron/text-server.mjs'

const repository = fileURLToPath(new URL('../../../', import.meta.url))

test('the Windows taskbar icon contains the AIBanlv logo and is bundled', async () => {
  const iconPath = path.join(repository, 'static/aibanlv.ico')
  assert.ok(deviceBundleFiles().includes(iconPath))
  const ico = await readFile(iconPath)
  const png = await readFile(path.join(repository, 'static/aibanlv-logo.png'))
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 1)
  assert.equal(ico.readUInt32LE(14), png.length)
  assert.deepEqual(ico.subarray(ico.readUInt32LE(18)), png)
})

test('web and text entries share the repository-owned renderer and icons', async () => {
  for (const files of [resolveDemoFiles(), resolveTextFiles()]) {
    for (const [route, file] of files) {
      if (!route.startsWith('/vendor/') && !route.startsWith('/control/renderer/')) continue
      const relative = path.relative(repository, file)
      assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), route)
      await access(file)
    }
  }
})
