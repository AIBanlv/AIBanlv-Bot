import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import { AssistantSettings, validateLocalAction, executeLocalAction } from '../electron/device-assistant-policy.mjs'

async function fixture(t) {
  const parent = path.resolve('artifacts')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(path.join(parent, 'control-assistant-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value.split('').reverse().join('')),
  decryptString: value => value.toString().split('').reverse().join(''),
}

test('key stays private and persists only with explicit encrypted storage', async t => {
  const file = path.join(await fixture(t), 'settings.json')
  const settings = new AssistantSettings({ file, encryption })
  await settings.load()
  await settings.configure({ apiKey: 'fixture-private-key', enabled: true, remember: false })
  assert.equal(settings.key(), 'fixture-private-key')
  assert.equal(JSON.stringify(settings.snapshot()).includes('fixture-private-key'), false)
  assert.equal((await readFile(file, 'utf8')).includes('fixture-private-key'), false)
  await settings.configure({ enabled: true, remember: true })
  const restored = new AssistantSettings({ file, encryption })
  await restored.load()
  assert.equal(restored.key(), 'fixture-private-key')
  // Storing the Key is the authorisation, so the switch survives a restart.
  assert.equal(restored.snapshot().enabled, true)
  await restored.forget()
  assert.equal(restored.key(), '')
  assert.equal((await readFile(file, 'utf8')).includes('encryptedKey'), false)
})

test('saving only the key activates the embedded assistant without storing it or accepting a runtime path', async t => {
  const file = path.join(await fixture(t), 'settings.json')
  const settings = new AssistantSettings({ file, encryption })
  await settings.configure({ apiKey: 'fixture-private-key' })
  assert.deepEqual(settings.snapshot(), { enabled: true, configured: true, remember: false, keyHint: 'fix… 共 19 个字符' })
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {})
  await assert.rejects(settings.configure({ runtimePath: 'Z:/external' }), /INVALID_SETTINGS/)
  await settings.forget()
  assert.equal(settings.snapshot().enabled, false)
  await assert.rejects(settings.configure({ apiKey: '' }), /KEY_REQUIRED/)
})

test('legacy external path is discarded while encrypted keys still require explicit activation after restart', async t => {
  const file = path.join(await fixture(t), 'settings.json')
  await writeFile(file, JSON.stringify({ runtimePath: 'Z:/external',
    encryptedKey: encryption.encryptString('fixture-private-key').toString('base64') }))
  const settings = new AssistantSettings({ file, encryption })
  await settings.load()
  assert.deepEqual(settings.snapshot(), { enabled: false, configured: true, remember: true, keyHint: 'fix… 共 19 个字符' })
  await settings.configure({ apiKey: '' })
  assert.equal(settings.snapshot().enabled, true)
  assert.equal('runtimePath' in JSON.parse(await readFile(file, 'utf8')), false)
})

test('a pasted key sheds the wrappers that made DeepSeek reject it', async t => {
  const file = path.join(await fixture(t), 'settings.json')
  const settings = new AssistantSettings({ file, encryption })
  const clean = 'sk-0123456789abcdef0123456789abcdef'
  // Every one of these is printable ASCII, so they all passed validation and were
  // sent to DeepSeek verbatim — which answered "the api key is invalid".
  for (const pasted of [
    `"${clean}"`,
    `'${clean}'`,
    `\`${clean}\``,
    `\u201c${clean}\u201d`,
    `  ${clean}  `,
    `" ${clean} "`,
    `DEEPSEEK_API_KEY=${clean}`,
    `DEEPSEEK_API_KEY="${clean}"`,
    `api-key = ${clean}`,
    `Bearer ${clean}`,
    `Bearer  ${clean}`,
    `"Bearer ${clean}"`,
    `${clean.slice(0, 12)}\n${clean.slice(12)}`,
    `${clean.slice(0, 12)}\u200b${clean.slice(12)}`,
    clean,
  ]) {
    await settings.configure({ apiKey: pasted })
    assert.equal(settings.key(), clean, `normalised from ${JSON.stringify(pasted)}`)
  }
  // An emptied field keeps the working key instead of demanding a new one.
  await settings.configure({ apiKey: '   ' })
  assert.equal(settings.key(), clean)
  // Repair happens before validation, so a wrapper can no longer smuggle a short
  // value past the length rule.
  await assert.rejects(settings.configure({ apiKey: '"abc def"' }), /INVALID_KEY/)
  assert.equal(settings.key(), clean, 'a refused save never replaces the working key')
})

test('normalised keys are what gets persisted and what a legacy install repairs on load', async t => {
  const root = await fixture(t)
  const file = path.join(root, 'settings.json')
  const clean = 'sk-0123456789abcdef0123456789abcdef'
  const settings = new AssistantSettings({ file, encryption })
  await settings.configure({ apiKey: `DEEPSEEK_API_KEY="${clean}"`, remember: true })
  const restored = new AssistantSettings({ file, encryption })
  await restored.load()
  assert.equal(restored.key(), clean)
  // Rows written before normalisation existed are repaired in memory; the file on
  // disk is only rewritten on the next explicit save.
  const legacy = path.join(root, 'legacy.json')
  await writeFile(legacy, JSON.stringify({
    encryptedKey: encryption.encryptString(`"${clean}"`).toString('base64') }))
  const repaired = new AssistantSettings({ file: legacy, encryption })
  await repaired.load()
  assert.equal(repaired.key(), clean)
  assert.equal(repaired.snapshot().configured, true)
})


test('a remembered key keeps the assistant on across restarts; a memory-only one cannot', async t => {
  const root = await fixture(t)
  const clean = 'sk-0123456789abcdef0123456789abcdef'
  // Remembered: the switch rides along with the stored Key.
  const stored = path.join(root, 'remembered.json')
  const settings = new AssistantSettings({ file: stored, encryption })
  await settings.configure({ apiKey: clean, remember: true, enabled: true })
  assert.deepEqual(JSON.parse(await readFile(stored, 'utf8')), { enabled: true,
    encryptedKey: encryption.encryptString(clean).toString('base64') })
  const restored = new AssistantSettings({ file: stored, encryption })
  await restored.load()
  assert.equal(restored.snapshot().enabled, true)
  assert.equal(restored.snapshot().configured, true)
  // Forgetting erases both halves of the authorisation, not just the Key.
  await restored.forget()
  assert.deepEqual(JSON.parse(await readFile(stored, 'utf8')), {})
  const afterForget = new AssistantSettings({ file: stored, encryption })
  await afterForget.load()
  assert.equal(afterForget.snapshot().enabled, false)
  // Memory-only: there is nothing to restore, so a restart stays off.
  const memory = path.join(root, 'memory.json')
  const session = new AssistantSettings({ file: memory, encryption })
  await session.configure({ apiKey: clean, remember: false })
  assert.equal(session.snapshot().enabled, true)
  const reloaded = new AssistantSettings({ file: memory, encryption })
  await reloaded.load()
  assert.equal(reloaded.snapshot().enabled, false, 'a key that was never stored cannot come back on')
  assert.equal(reloaded.snapshot().configured, false)
})

test('unavailable encryption never falls back to plaintext or changes active settings', async t => {
  const settings = new AssistantSettings({ file: path.join(await fixture(t), 'key.json'),
    encryption: { isEncryptionAvailable: () => false } })
  await assert.rejects(settings.configure({ apiKey: 'fixture-private-key', remember: true, enabled: true }), /KEY_STORAGE_UNAVAILABLE/)
  assert.equal(settings.key(), '')
  await assert.rejects(settings.configure({ enabled: true }), /KEY_REQUIRED/)
})

test('local targets reject arbitrary commands, network paths, credential files and unsafe URLs', async t => {
  const root = await fixture(t)
  await mkdir(path.join(root, '.ssh'))
  await writeFile(path.join(root, '.ssh', 'secret.txt'), 'secret')
  for (const action of [
    { name: 'powershell', target: 'Get-ChildItem' },
    { name: 'open_folder', target: '\\\\server\\share' },
    { name: 'open_url', target: 'file:///C:/Windows/System32/cmd.exe' },
    { name: 'open_url', target: 'https://user:password@example.com' },
    { name: 'open_url', target: 'https://127.0.0.1' },
    { name: 'open_url', target: 'https://localhost' },
    { name: 'open_url', target: 'https://example.com:443/?x=1', extra: true },
    { name: 'read_text', target: path.join(root, '.ssh', 'secret.txt') },
  ]) await assert.rejects(validateLocalAction(action), /INVALID_ACTION|TARGET_DENIED/)
})

test('file content is read only after exact target approval; cancellation prevents OS dispatch', async t => {
  const file = path.join(await fixture(t), 'notes.txt')
  await writeFile(file, 'meeting notes')
  const spec = await validateLocalAction({ name: 'read_text', target: file })
  await assert.rejects(executeLocalAction(spec, { approve: async () => false, signal: new AbortController().signal }), /ACTION_DENIED/)
  const result = await executeLocalAction(spec, { approve: async request => {
    assert.equal(request.target, spec.target)
    return true
  }, signal: new AbortController().signal })
  assert.equal(result.text, 'meeting notes')
  const abort = new AbortController()
  let opened = false
  await assert.rejects(executeLocalAction({ name: 'open_folder', target: path.dirname(file) }, {
    signal: abort.signal, approve: async () => { abort.abort(); return true },
    openPath: async () => { opened = true; return '' },
  }), /abort/i)
  assert.equal(opened, false)
})

test('oversized, binary and unsupported files do not reach the model', async t => {
  const root = await fixture(t)
  const options = { approve: async () => true, signal: new AbortController().signal }
  for (const [name, contents] of [['large.txt', Buffer.alloc(65537, 65)], ['binary.txt', Buffer.from([0, 1, 2])], ['run.exe', 'text']]) {
    const file = path.join(root, name)
    await writeFile(file, contents)
    await assert.rejects(async () => executeLocalAction(await validateLocalAction({ name: 'read_text', target: file }), options),
      /FILE_UNSUPPORTED|FILE_TOO_LARGE/)
  }
})

test('public URL names cannot resolve to private networks, including after approval', async () => {
  const action = { name: 'open_url', target: 'https://public.example.com/' }
  const resolveHost = async () => [{ address: '127.0.0.1', family: 4 }]
  await assert.rejects(validateLocalAction(action, { resolveHost }), /TARGET_DENIED/)
  let opened = false
  const spec = await validateLocalAction(action, { resolveHost: async () => [{ address: '8.8.8.8', family: 4 }] })
  await assert.rejects(executeLocalAction(spec, { signal: new AbortController().signal, approve: async () => true,
    resolveHost, openExternal: async () => { opened = true } }), /TARGET_DENIED/)
  assert.equal(opened, false)
})
