import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.resolve('../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
const source = await readFile('electron/device-direct-peer.mjs', 'utf8')
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/peer.mjs' ? 'text/javascript' : 'text/html')
  res.end(req.url === '/peer.mjs' ? source : '<!doctype html><title>Local direct-transfer fixture</title>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync)
  browser = await chromium.launch({ executablePath, headless: true })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const result = await page.evaluate(async () => {
    const { DirectPeer, digest } = await import('/peer.mjs')
    const bytes = new Uint8Array(128 * 1024 + 19).map((_, i) => i % 251)
    const run = async (corrupt, stalled = false) => {
      const states = [], signals = []
      let file
      const createPeer = config => {
        const peer = new RTCPeerConnection(config)
        if (stalled) Object.defineProperty(peer, 'iceGatheringState', { get: () => 'gathering' })
        return peer
      }
      const receiver = new DirectPeer({ iceServers: [], timeoutMs: 10000, createPeer, gatherMs: 100,
        signal: async value => { signals.push(value); await sender.handle(value) }, onFile: value => { file = value }, onState: value => states.push(value.status) })
      const sender = new DirectPeer({ iceServers: [], timeoutMs: 10000, createPeer, gatherMs: 100,
        signal: async value => { signals.push(value); await receiver.accept(value) } })
      const meta = { transferId: crypto.randomUUID(), name: 'fixture.bin', size: bytes.length, sha256: await digest(bytes) }
      try {
        await sender.send(meta, (offset, length) => {
          const chunk = bytes.slice(offset, offset + length)
          if (corrupt && offset === 0) chunk[0] ^= 1
          return chunk
        })
        return { ok: true, matched: await digest(file.bytes) === meta.sha256, states, signallingBytes: JSON.stringify(signals).length }
      } catch { return { ok: false, received: states.includes('received'), file: Boolean(file) } }
      finally { sender.fail(); receiver.fail() }
    }
    return { valid: await run(false), corrupt: await run(true), stalled: await run(false, true) }
  })
  assert.equal(result.valid.ok, true); assert.equal(result.valid.matched, true)
  assert.ok(result.valid.signallingBytes < 24576)
  assert.deepEqual(result.corrupt, { ok: false, received: false, file: false })
  assert.equal(result.stalled.ok, true); assert.equal(result.stalled.matched, true)
  console.log('Local WebRTC DataChannel: real chunks, SHA-256 receipt, corrupted transfer rejected, incomplete gathering with valid addresses still transfers; no production connections.')
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
