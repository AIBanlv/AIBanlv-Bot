import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { bundleEntry } from '../scripts/bundle-entry.mjs'

test('packaged entries follow the checkout name rather than the original control directory', () => {
  for (const folder of ['control', 'control-windows', 'another checkout']) {
    const root = path.resolve(folder, 'demos/web-desktop-pet')
    for (const entry of ['main.mjs', 'device-main.mjs']) {
      const main = bundleEntry(root, entry)
      assert.equal(main, `${folder}/demos/web-desktop-pet/electron/${entry}`)
      assert.equal(path.resolve(root, '../../..', main), path.join(root, 'electron', entry))
    }
  }
})
