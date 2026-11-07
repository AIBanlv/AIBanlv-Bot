import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { MailSettings } from '../electron/device-mail-settings.mjs'

async function fixture(t) {
  await mkdir('artifacts', { recursive: true })
  const root = await mkdtemp(path.resolve('artifacts/mail-settings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = { file: path.join(root, 'mail.json'), encryption: {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value).map(byte => byte ^ 173),
    decryptString: value => Buffer.from(value).map(byte => byte ^ 173).toString(),
  } }
  return { options, settings: new MailSettings(options) }
}
const account = { provider: 'qq', user: 'fixture@qq.com', password: 'fixture-auth-code' }

test('mail credentials are memory-only by default and snapshots never expose the code', async t => {
  const { settings, options } = await fixture(t)
  await settings.load()
  await settings.configure(account)
  assert.equal(settings.snapshot().enabled, true)
  assert.equal(settings.credentials().password, account.password)
  assert.doesNotMatch(JSON.stringify(settings.snapshot()), /fixture-auth-code|password|encrypted/)
  assert.deepEqual(JSON.parse(await readFile(options.file, 'utf8')), {})
  await assert.rejects(settings.configure({ provider: 'qq', user: 'new@qq.com' }), /MAIL_SETTINGS_INVALID/)
  assert.equal(settings.credentials().user, account.user)
})

test('opt-in encrypted mail configuration restores activation after restart and forget erases it', async t => {
  const { settings, options } = await fixture(t)
  await settings.configure({ ...account, remember: true, notifications: true })
  const stored = await readFile(options.file, 'utf8')
  assert.doesNotMatch(stored, /fixture-auth-code|fixture@qq.com/)
  const restarted = new MailSettings(options)
  await restarted.load()
  assert.equal(restarted.snapshot().enabled, true)
  assert.equal(restarted.snapshot().configured, true)
  assert.equal(restarted.credentials().user, account.user)
  await restarted.configure({})
  assert.equal(restarted.credentials().user, account.user)
  await restarted.forget()
  assert.equal(restarted.snapshot().configured, false)
  assert.deepEqual(JSON.parse(await readFile(options.file, 'utf8')), {})
})

test('a saved explicit mail pause survives restart, while legacy encrypted accounts reconnect', async t => {
  const { settings, options } = await fixture(t)
  await settings.configure({ ...account, remember: true, enabled: false })
  const restarted = new MailSettings(options)
  await restarted.load()
  assert.equal(restarted.snapshot().enabled, false)
  assert.throws(() => restarted.credentials(), /MAIL_DISABLED/)
  const legacy = JSON.parse(await readFile(options.file, 'utf8'))
  delete legacy.enabled
  await settings.write(legacy)
  const upgraded = new MailSettings(options)
  await upgraded.load()
  assert.equal(upgraded.snapshot().enabled, true)
})

test('mail settings fail closed for unknown hosts, provider mismatch and unavailable encryption', async t => {
  const { settings, options } = await fixture(t)
  for (const value of [{ ...account, host: '127.0.0.1' }, { ...account, provider: 'custom' },
    { ...account, user: 'fixture@163.com' }, { ...account, password: 'bad\ncode' }]) {
    await assert.rejects(settings.configure(value), /MAIL_SETTINGS_INVALID/)
  }
  options.encryption.isEncryptionAvailable = () => false
  await assert.rejects(settings.configure({ ...account, remember: true }), /MAIL_STORAGE_UNAVAILABLE/)
  assert.equal(settings.snapshot().configured, false)
})

test('mail content sharing is off for existing accounts and persists only after explicit opt-in', async t => {
  const {settings,options}=await fixture(t)
  await settings.configure({...account,remember:true,notifications:true})
  assert.equal(settings.snapshot().contentAnnouncements,false)
  await assert.rejects(settings.configure({contentAnnouncements:'true'}),/MAIL_SETTINGS_INVALID/)
  await settings.configure({contentAnnouncements:true})
  const restarted=new MailSettings(options);await restarted.load()
  assert.equal(restarted.snapshot().contentAnnouncements,true)
  await restarted.configure({enabled:false});assert.equal(restarted.snapshot().enabled,false)
  await restarted.forget();assert.equal(restarted.snapshot().contentAnnouncements,false)
})
