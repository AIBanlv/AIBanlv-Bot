import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { hardwareFingerprint } from '../electron/device-hardware-id.mjs'

const uuid = '6f9619ff-8b86-d011-b42d-00c04fc964ff'
const expected = platform => createHash('sha256').update(`control-desktop-hardware-v1\n${platform}\n${uuid}`).digest('hex')
const unavailable = { code: 'HARDWARE_ID_UNAVAILABLE' }
const output = (platform, value) => platform === 'darwin'
  ? `+-o IOPlatformExpertDevice\n  {\n    "IOPlatformUUID" = "${value}"\n  }\n` : `${value}\r\n`

test('Windows hardware UUID casing and surrounding whitespace produce the same fingerprint', async () => {
  for (const value of [uuid, `  ${uuid.toUpperCase()}  `]) {
    const result = await hardwareFingerprint({ platform: 'win32', run: async (file, args) => {
      assert.match(file, /(?:^|[\\/])powershell\.exe$/i)
      assert.match(args.join(' '), /Get-CimInstance\b/)
      assert.match(args.join(' '), /Win32_ComputerSystemProduct\b/)
      return { stdout: output('win32', value) }
    } })
    assert.equal(result, expected('win32'))
    assert.match(result, /^[a-f0-9]{64}$/)
  }
})

test('Mac uses IOPlatformUUID and a distinct platform namespace', async () => {
  for (const value of [uuid, uuid.toUpperCase()]) {
    const result = await hardwareFingerprint({ platform: 'darwin', run: async (file, args) => {
      assert.equal(file, '/usr/sbin/ioreg')
      assert.deepEqual(args, ['-rd1', '-c', 'IOPlatformExpertDevice'])
      return { stdout: output('darwin', value) }
    } })
    assert.equal(result, expected('darwin'))
    assert.notEqual(result, expected('win32'))
  }
})

test('missing, malformed and placeholder UUIDs never become a guest fingerprint', async () => {
  for (const platform of ['win32', 'darwin']) {
    for (const value of ['', 'not-a-uuid', '00000000-0000-0000-0000-000000000000', 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF']) {
      await assert.rejects(hardwareFingerprint({ platform, run: async () => ({ stdout: output(platform, value) }) }), unavailable)
    }
    await assert.rejects(hardwareFingerprint({ platform, run: async () => ({}) }), unavailable)
  }
  await assert.rejects(hardwareFingerprint({ platform: 'darwin', run: async () => ({ stdout: `"OtherUUID" = "${uuid}"` }) }), unavailable)
})

test('hardware command failures return the same unavailable code without generating a replacement', async () => {
  for (const platform of ['win32', 'darwin']) {
    await assert.rejects(hardwareFingerprint({ platform, run: async () => {
      throw Object.assign(new Error('fixture hardware query failed'), { code: 'ENOENT' })
    } }), unavailable)
  }
})

test('unsupported platforms fail without running a hardware command', async () => {
  await assert.rejects(hardwareFingerprint({ platform: 'linux', run: async () => assert.fail('Unsupported platform must not run commands') }), unavailable)
})
