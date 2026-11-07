import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRequestedFile } from '../electron/device-file-request.mjs'

test('exact user-named files resolve directly, missing/ambiguous/private files never cause an arbitrary send', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'control-send-request-')))
  t.after(() => rm(root, { force: true, recursive: true }))
  const desktop = path.join(root, 'Desktop'), downloads = path.join(root, 'Downloads')
  await mkdir(desktop); await mkdir(downloads)
  await writeFile(path.join(desktop, '报价.pdf'), 'synthetic')
  const roots = [{ directory: desktop, label: '桌面' }, { directory: downloads, label: '下载' }]
  assert.equal(await resolveRequestedFile('把桌面的报价.pdf发给我', roots), path.join(desktop, '报价.pdf'))
  await assert.rejects(resolveRequestedFile('发送文件到手机', roots), /完整文件名/)
  await writeFile(path.join(downloads, '报价.pdf'), 'another synthetic file')
  await assert.rejects(resolveRequestedFile('发送报价.pdf到手机', roots), /多个同名/)
  assert.equal(await resolveRequestedFile('发送桌面的报价.pdf到手机', roots), path.join(desktop, '报价.pdf'))
  await writeFile(path.join(desktop, 'passwords.txt'), 'synthetic')
  await assert.rejects(resolveRequestedFile('把passwords.txt发给我', roots), /完整文件名/)
  await assert.rejects(resolveRequestedFile('把不存在.txt发给我', roots), /完整文件名/)
})
