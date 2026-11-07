import test from 'node:test'
import assert from 'node:assert/strict'
import { moveApprovalHtml } from '../electron/device-assistant-approval.mjs'

test('approval renders every exact move as escaped text with deny-focused commands', () => {
  const html = moveApprovalHtml({ name: 'organize_desktop', entries: [
    { from: 'Desktop/<script>alert(1)</script>.txt', to: 'Desktop/Organized/report.txt' },
  ] })
  assert.doesNotMatch(html, /<script>|onclick=|nodeIntegration/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /script-src 'none'/)
  assert.match(html, /autofocus/)
  assert.match(html, /overflow:auto/)
  assert.match(html, /Desktop\/Organized\/report.txt/)
})
