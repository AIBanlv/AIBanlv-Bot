import assert from 'node:assert/strict'
import test from 'node:test'
import { get } from 'node:http'
import { createDemoServer, resolveDemoFiles } from '../server.mjs'

test('uses an explicit asset path without exposing its parent directory', () => {
  const files = resolveDemoFiles({ avatarPath: 'F:/private/avatar.zip' })
  assert.equal(files.get('/assets/avatar.zip'), 'F:/private/avatar.zip')
  assert.equal(files.has('/assets/other.zip'), false)
  assert.equal(files.has('/package.json'), false)
  assert.equal(files.has('/assets/speech-control.json'), true)
  assert.equal(files.has('/control/renderer/tools/ali-native-shell-ui/src/presentation-pose.js'), true)
  assert.equal(files.has('/control/renderer/lam-renderer-rewrite/src/skeleton/skeleton-math.js'), true)
  assert.equal(files.has('/control/renderer/tools/ali-native-shell-ui/src/main.js'), false)
  assert.equal(files.has('/scripts/ControlPostprocess.java'), false)
})

test('serves only allowlisted paths, supports HEAD and rejects writes', async (t) => {
  const server = createDemoServer(new Map([['/fixture', new URL(import.meta.url)]]))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  assert.equal((await fetch(`${base}/fixture`)).status, 200)
  assert.equal((await fetch(`${base}/fixture`, { method: 'HEAD' })).status, 200)
  assert.equal((await fetch(`${base}/fixture`, { method: 'POST' })).status, 405)
  assert.equal((await fetch(`${base}/server.mjs`)).status, 404)
  assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404)
  // Node fetch normalizes Host; use the HTTP client to exercise DNS rebinding protection.
  const status = await new Promise((resolve, reject) => {
    get(`${base}/fixture`, { headers: { Host: 'attacker.example' } }, (response) => {
      response.resume()
      resolve(response.statusCode)
    }).on('error', reject)
  })
  assert.equal(status, 403)
})

test('desktop private server requires its per-session token for pages and inference', async (t) => {
  const server = createDemoServer(new Map([['/fixture', new URL(import.meta.url)]]), { accessToken: 'test-token' })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  assert.equal((await fetch(`${base}/fixture`)).status, 403)
  assert.equal((await fetch(`${base}/api/previews`, { method: 'POST' })).status, 403)
  assert.equal((await fetch(`${base}/fixture`, { headers: { 'X-Pet-Token': 'test-token' } })).status, 200)
})
