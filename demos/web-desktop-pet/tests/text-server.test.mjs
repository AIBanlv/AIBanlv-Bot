import assert from 'node:assert/strict'
import test from 'node:test'
import { createTextServer, resolveTextFiles } from '../electron/text-server.mjs'

test('text edition only exposes packaged assets and has no inference or audio API', async () => {
  const files = resolveTextFiles()
  assert.ok([...files.values()].every(file => !/\.wav$|speech\.json$|\.py$|\.java$|\.tar$/.test(file)))
  const server = createTextServer(files, {accessToken:'test-token'})
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = {'x-pet-token':'test-token'}
  try {
    assert.equal((await fetch(`${base}/desktop/controller.html`)).status,403)
    assert.equal((await fetch(`${base}/desktop/controller.html`,{headers})).status,200)
    assert.equal((await fetch(`${base}/api/previews`,{headers,method:'POST'})).status,405)
    assert.equal((await fetch(`${base}/assets/speech.wav`,{headers})).status,404)
    assert.equal((await fetch(`${base}/scripts/infer_speech.py`,{headers})).status,404)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('only the settings document permits narrow remote moment images and media; scripts and connections stay local', async () => {
  const files = resolveTextFiles(), file = files.get('/desktop/controller.html')
  files.set('/device/device.html', file); files.set('/device/device-pet.html', file)
  const server = createTextServer(files, { accessToken: 'fixture' })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${server.address().port}`, headers = { 'X-Pet-Token': 'fixture' }
    const settings = (await fetch(`${base}/device/device.html`, { headers })).headers.get('content-security-policy')
    const pet = (await fetch(`${base}/device/device-pet.html`, { headers })).headers.get('content-security-policy')
    assert.match(settings, /media-src blob: https:\/\/zhanlvgpt\.ieasysell\.com;/)
    assert.match(settings, /connect-src 'self' blob:;/)
    assert.doesNotMatch(pet, /https:/); assert.match(pet, /media-src 'none'/)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
