import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { prepareHarnessLaunch } from '../electron/device-assistant-runtime.mjs'
import { AssistantProcess } from '../electron/device-assistant-process.mjs'

test('embedded worker uses the owning executable and private config without external discovery or inherited hooks', async t => {
  await mkdir('artifacts', { recursive: true })
  const home = await mkdtemp(path.resolve('artifacts/embedded-launch-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const old = process.env.NODE_OPTIONS
  process.env.NODE_OPTIONS = '--require=untrusted.cjs'
  t.after(() => { if (old === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = old })
  const launch = await prepareHarnessLaunch({ home, apiKey: 'fixture-private-key',
    endpoint: 'http://127.0.0.1:12345/tools', token: 'a'.repeat(64), runtimePath: 'Z:/missing-external-harness' })
  assert.equal(launch.command, process.execPath)
  assert.equal(path.basename(launch.args[1]), 'device-assistant-worker.mjs')
  assert.equal(launch.cwd, path.join(home, 'work'))
  assert.equal(launch.env.NODE_OPTIONS, undefined)
  assert.equal(launch.env.DSH_HOME, home)
  assert.equal(launch.env.DEEPSEEK_API_KEY, 'fixture-private-key')
  assert.doesNotMatch(JSON.stringify(launch.args), /fixture-private-key|missing-external/)
  const config = await readFile(launch.args[2], 'utf8')
  assert.doesNotMatch(config, /fixture-private-key|tool-fs|tool-bash|tool-pwsh|subprocess|terminal|sdk-jsonrpc|sdk-app/)
  const entries = JSON.parse(config)
  assert.ok(entries.some(entry => entry.id === 'acp'))
  assert.ok(entries.some(entry => entry.id === 'control-desktop-tools'))
  assert.ok(entries.every(entry => entry.name.startsWith('file:')))
})

test('worker cannot open an ACP session when its local execution guard is missing', async t => {
  await mkdir('artifacts', { recursive: true })
  const home = await mkdtemp(path.resolve('artifacts/embedded-guard-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const launch = await prepareHarnessLaunch({ home, apiKey: 'fixture-only-key',
    endpoint: 'http://127.0.0.1:1/tools', token: 'a'.repeat(64) })
  const config = launch.args[2]
  const entries = JSON.parse(await readFile(config, 'utf8'))
  await writeFile(config, JSON.stringify(entries.filter(entry => entry.id !== 'control-desktop-tools')))
  const assistant = new AssistantProcess({ launch, startMs: 5000 })
  t.after(() => assistant.close())
  await assert.rejects(assistant.start(), /HARNESS_UNAVAILABLE/)
  assert.equal(assistant.sessionId, undefined)
})
