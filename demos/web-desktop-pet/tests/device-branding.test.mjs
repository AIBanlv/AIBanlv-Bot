import test from 'node:test'
import assert from 'node:assert/strict'
import { aibanlvAppId, repairOwnedShortcuts } from '../electron/device-branding.mjs'

test('AIBanlv has a stable taskbar identity separate from old Control and source Electron', () => {
  assert.equal(aibanlvAppId(true), 'com.zhanlv.aibanlv.desktop')
  assert.equal(aibanlvAppId(false), 'com.zhanlv.aibanlv.desktop.source')
})

test('shortcut repair updates only existing links owned by this installation', () => {
  const executable = 'C:\\Apps\\AIBanlv\\AIBanlv.exe', writes = []
  const shell = {
    readShortcutLink(file) {
      return { target: file.includes('Desktop') ? executable.toLowerCase() : 'C:\\Other\\AIBanlv.exe', args: '' }
    },
    writeShortcutLink(file, operation, options) { writes.push({ file, operation, options }); return true },
  }
  repairOwnedShortcuts({ shell, executable, desktop: 'C:\\Desktop', appData: 'C:\\Profile' })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].operation, 'update')
  assert.equal(writes[0].options.appUserModelId, aibanlvAppId(true))
  assert.equal(writes[0].options.icon, executable)
  assert.ok(!writes[0].file.includes('User Pinned'))
  assert.doesNotThrow(() => repairOwnedShortcuts({ shell: { readShortcutLink() { throw new Error('missing') } },
    executable, desktop: 'C:\\Desktop', appData: 'C:\\Profile' }))
})
