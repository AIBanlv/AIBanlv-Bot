import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
test('native Windows preflight detects an actual sharing lock and read-only file without changing contents',
  { skip: process.platform !== 'win32' }, async t => {
    const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url))
    await mkdir(artifacts, { recursive: true })
    const directory = await mkdtemp(path.join(artifacts, 'installer-native-probe-'))
    t.after(async () => {
      const relative = path.relative(artifacts, directory)
      assert.ok(relative.startsWith('installer-native-probe-') && !relative.includes(path.sep))
      await rm(directory, { recursive: true, force: true })
    })
    const file = path.join(directory, '中文 空格 $文件.txt'), content = 'old-installation-must-survive'
    await writeFile(file, content)
    let result
    try {
      result = await execute(process.env.PET_TEST_PYTHON || process.env.PET_PYTHON || 'python',
        [fileURLToPath(new URL('./device-installer-native-probe.py', import.meta.url)), directory],
        { windowsHide: true, timeout: 15000 })
    } catch (error) {
      if (error.code === 'ENOENT') { t.skip('Native probe fixture requires an existing Python runtime'); return }
      throw error
    }
    assert.deepEqual(JSON.parse(result.stdout), { unlocked: 0, locked: 32, afterUnlock: 0, readOnly: 5, missing: 2, missingDirectory: 3 })
    assert.equal(await readFile(file, 'utf8'), content)
    await assert.rejects(access(path.join(directory, 'missing.exe')), { code: 'ENOENT' })
    await assert.rejects(access(path.join(directory, 'absent')), { code: 'ENOENT' })
  })
