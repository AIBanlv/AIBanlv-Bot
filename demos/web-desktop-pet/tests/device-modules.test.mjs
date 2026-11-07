import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { deviceBundleFiles } from '../electron/device-package.mjs'

const electron = new URL('../electron/', import.meta.url)

async function servedRendererModules() {
  const source = await readFile(new URL('device-main.mjs', electron), 'utf8')
  const match = source.match(/for \(const name of \[([\s\S]*?)\]\) \{\s*files\.set\(`\/device\//)
  assert.ok(match, 'device renderer whitelist not found')
  return [...match[1].matchAll(/'([^']+\.mjs)'/g)].map(item => item[1])
}

test('every renderer import is served by the private device origin', async () => {
  const served = new Set(await servedRendererModules())
  const renderers = ['device-view.mjs', 'device-pet.mjs', 'device-voice.mjs', 'device-chat.mjs',
    'device-touch.mjs', 'device-audio.mjs', 'device-mood.mjs']
  for (const name of renderers) {
    const source = await readFile(new URL(name, electron), 'utf8')
    for (const match of source.matchAll(/from '(\.\/[^']+\.mjs)'/g)) {
      const dependency = match[1].slice(2)
      assert.ok(served.has(dependency), `${dependency} imported by ${name} must be served`)
    }
  }
  assert.ok(served.has('device-waveform.mjs'))
  for (const name of ['device-assistant-view.mjs', 'device-mail-view.mjs', 'device-workbuddy-view.mjs', 'device-codex-view.mjs', 'device-activity-view.mjs']) {
    assert.ok(served.has(name), `${name} must be served so settings initialization cannot fail`)
  }
  assert.equal(served.has('device-login-view.mjs'), false)
})

test('the packaged device keeps every served renderer module', async () => {
  const served = await servedRendererModules()
  const bundled = new Set(deviceBundleFiles().map(file => path.basename(file)))
  for (const name of served) assert.ok(bundled.has(name), `${name} must be bundled`)
  for (const name of ['device-login.mjs', 'device-login-view.mjs', 'device-registration.mjs'])
    assert.equal(bundled.has(name), false, 'Removed credential flows must not be distributed')
  assert.ok(bundled.has('device-binding-proof.mjs'))
  assert.ok(bundled.has('device-http-auth.mjs'))
  assert.ok(bundled.has('device-codex-rollout.mjs'), 'The external-task lifecycle reader must be bundled')
  assert.equal(new Set(served).has('device-codex-rollout.mjs'), false, 'Local rollout filesystem access stays in the main process')
  assert.ok(bundled.has('device-ai-tools.mjs'), 'Local tool discovery and onboarding must be bundled')
  assert.equal(new Set(served).has('device-ai-tools.mjs'), false, 'Local AI tool discovery stays in the main process')
})
