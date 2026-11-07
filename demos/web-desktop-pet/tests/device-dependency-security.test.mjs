import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execute = promisify(execFile)
const cwd = fileURLToPath(new URL('../', import.meta.url))
// Vulnerable parsers must never hang or crash the test runner itself.
const isolated = source => execute(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e', source],
  { cwd, timeout: 6000, maxBuffer: 65536, windowsHide: true })

test('malformed ZIP64 extra fields reject within a bounded child process', async () => {
  await isolated(`
    import assert from 'node:assert/strict'
    import { unzipSync } from 'fflate'
    import { validateAvatarZip } from './electron/device-assets.mjs'
    const data = Buffer.alloc(200), central = 56, end = 178
    data.writeUInt32LE(0x06064b50, 0)
    data.writeUInt32LE(1, 32); data.writeUInt32LE(central, 48)
    data.writeUInt32LE(0x02014b50, central)
    data.writeUInt32LE(0xffffffff, central + 20)
    data.writeUInt16LE(1, central + 28); data.writeUInt16LE(4, central + 30)
    data.write('a', central + 46)
    data.writeUInt16LE(2, central + 47); data.writeUInt16LE(65535, central + 49)
    data.writeUInt32LE(0x06054b50, end)
    data.writeUInt16LE(65535, end + 8); data.writeUInt32LE(0xffffffff, end + 16)
    // fflate permits some incomplete archives; the security guarantee here is
    // bounded completion. The application's stricter yauzl gate must reject it.
    unzipSync(data)
    await assert.rejects(validateAvatarZip(data))
  `)
})

test('Harness HTTP fetch survives an excessive encoding response followed by early close', async () => {
  const { stdout } = await isolated(`
    import assert from 'node:assert/strict'
    import { createRequire } from 'node:module'
    import { createServer } from 'node:net'
    const require = createRequire(import.meta.url)
    const harness = createRequire(require.resolve('@deepseek-ai/dsh-web-fetch-http'))
    const { fetch, Agent } = harness('undici'), dispatcher = new Agent()
    const server = createServer(socket => socket.once('data', () => socket.end(
      'HTTP/1.1 200 OK\\r\\nContent-Encoding: gzip, gzip, gzip, gzip, gzip, gzip\\r\\nContent-Length: 100\\r\\nConnection: close\\r\\n\\r\\n')))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      await assert.rejects(fetch('http://127.0.0.1:' + server.address().port, { dispatcher }))
      await new Promise(resolve => setTimeout(resolve, 100))
      console.log('survived')
    } finally { await dispatcher.close(); await new Promise(resolve => server.close(resolve)) }
  `)
  assert.match(stdout, /survived/)
})

test('avatar imports reject duplicate paths and oversized expansion before allocating output', async () => {
  await isolated(`
    import assert from 'node:assert/strict'
    import { archiveFixture } from './tests/avatar-fixture.mjs'
    import { prepareLocalAvatar } from './electron/device-assets.mjs'
    await assert.rejects(prepareLocalAvatar(archiveFixture('oac/', ['skin.glb', 'skin.glb', 'animation.glb', 'offset.ply', 'vertex_order.json'])))
    const large = archiveFixture(), central = large.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    assert.ok(central >= 0)
    large.writeUInt32LE(513 * 1024 * 1024, central + 24)
    await assert.rejects(prepareLocalAvatar(large))
  `)
})

test('every Harness constrained collection rejects oversized input before visiting elements', async () => {
  await isolated(`
    import assert from 'node:assert/strict'
    import { createRequire } from 'node:module'
    const require = createRequire(import.meta.url)
    for (const name of ['dsh-agent-loop', 'dsh-commands', 'dsh-llm-retry', 'dsh-llm',
      'dsh-sandbox-policy', 'dsh-session-projection', 'dsh-token-meter']) {
      const { z } = createRequire(require.resolve('@deepseek-ai/' + name))('zod')
      let visits = 0
      const element = z.string().superRefine(() => { visits++ })
      for (const [schema, value] of [
        [z.array(element).max(1), Array(1000).fill('x')],
        [z.set(element).max(1), new Set(Array.from({length:1000}, (_, i) => String(i)))],
        [z.map(z.string(), element).max(1), new Map(Array.from({length:1000}, (_, i) => [String(i), 'x']))]
      ]) {
        assert.equal(schema.safeParse(value).success, false)
        assert.equal(visits, 0, name + ' must enforce size before element parsing')
      }
      assert.deepEqual(z.array(z.string()).max(1).parse(['ok']), ['ok'])
    }
  `)
})
