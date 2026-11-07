import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { windowsIcon } from '../scripts/device-icon.mjs'

test('Windows taskbar icon has standard sizes, valid DIBs and nonempty alpha without changing artwork', async () => {
  const png = await readFile(new URL('../../../static/aibanlv-logo.png', import.meta.url))
  const before = Buffer.from(png), ico = windowsIcon(png)
  assert.deepEqual(png, before)
  assert.equal(ico.readUInt16LE(4), 9)
  for (let i = 0; i < 9; i++) {
    const entry = 6 + i*16, size = ico[entry] || 256, offset = ico.readUInt32LE(entry+12)
    assert.equal(ico.readUInt32LE(offset), 40)
    assert.equal(ico.readUInt32LE(offset+4), size)
    assert.equal(ico.readUInt32LE(offset+8), size*2)
    assert.ok(Array.from({ length: size*size }, (_, pixel) => ico[offset+40+pixel*4+3]).some(alpha => alpha > 0))
  }
  assert.throws(() => windowsIcon(Buffer.from('bad')), /Invalid/)
})
