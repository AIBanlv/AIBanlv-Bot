import test from 'node:test'
import assert from 'node:assert/strict'
import { ImapFlow } from 'imapflow'
import { withReadOnlyInbox } from '../electron/device-mail-client.mjs'
import { mailImapFixture } from './mail-imap-fixture.mjs'

const account = { provider: 'qq', user: 'fixture@qq.com', password: 'fixture-code' }
const signal = () => new AbortController().signal

function localClient(fixture, captured) {
  return options => {
    captured.push(options)
    return new ImapFlow({ ...options, host: '127.0.0.1', port: fixture.port,
      secure: false, doSTARTTLS: false, servername: undefined })
  }
}

test('mail reads use EXAMINE and BODY.PEEK and preserve unread flags over real IMAP', { timeout: 10000 }, async t => {
  const fixture = await mailImapFixture()
  t.after(() => fixture.close())
  const captured = []
  const message = await withReadOnlyInbox(account,
    { signal: signal(), clientFactory: localClient(fixture, captured) },
    client => client.fetchOne('1', { source: true, flags: true }, { uid: true }))

  assert.deepEqual(message.source, fixture.source)
  assert.equal(message.flags.has('\\Seen'), false)
  assert.equal(fixture.seen, false)
  assert.ok(fixture.commands.some(line => /^\S+ EXAMINE "?INBOX"?$/i.test(line)))
  assert.ok(fixture.commands.some(line => /\bUID FETCH\b.*\bBODY\.PEEK\[\]/i.test(line)))
  assert.equal(fixture.commands.some(line => /^\S+ (?:SELECT|STORE|UID STORE|APPEND|MOVE|COPY|EXPUNGE|AUTHENTICATE XOAUTH2)\b/i.test(line)), false)
  await fixture.waitFor(state => state.closed === 1)
  assert.equal(captured.length, 1)
})

test('production client options enforce preset TLS, certificate validation, bounded responses and disabled logging', { timeout: 10000 }, async t => {
  const fixture = await mailImapFixture()
  t.after(() => fixture.close())
  const captured = []
  await withReadOnlyInbox({ ...account, host: '127.0.0.1', port: 143, secure: false, tls: { rejectUnauthorized: false } },
    { signal: signal(), clientFactory: localClient(fixture, captured) }, async () => 'done')

  const options = captured[0]
  assert.equal(options.host, 'imap.qq.com')
  assert.equal(options.port, 993)
  assert.equal(options.secure, true)
  assert.notEqual(options.tls?.rejectUnauthorized, false)
  assert.equal(options.logger, false)
  assert.notEqual(options.logRaw, true)
  assert.notEqual(options.emitLogs, true)
  assert.equal(options.disableAutoIdle, true)
  assert.deepEqual(options.auth, { user: account.user, pass: account.password })
  for (const name of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
    assert.ok(Number.isFinite(options[name]) && options[name] > 0 && options[name] <= 30000, `${name} must be bounded`)
  }
  for (const name of ['maxLineLength', 'maxLiteralSize']) {
    assert.ok(Number.isFinite(options[name]) && options[name] > 0 && options[name] <= 2 * 1024 * 1024, `${name} must be bounded`)
  }
  assert.ok(Number.isFinite(options.maxResponseSize) && options.maxResponseSize >= options.maxLiteralSize && options.maxResponseSize <= 4 * 1024 * 1024)
})

test('cancelling an in-flight IMAP fetch closes the socket without mutating mail', { timeout: 10000 }, async t => {
  const fixture = await mailImapFixture({ holdFetch: true })
  t.after(() => fixture.close())
  const abort = new AbortController()
  const pending = withReadOnlyInbox(account,
    { signal: abort.signal, clientFactory: localClient(fixture, []) },
    client => client.fetchOne('1', { source: true }, { uid: true }))
  const cancelled = assert.rejects(pending, /abort|cancel/i)
  await fixture.waitFor(state => state.commands.some(line => /\bUID FETCH\b/i.test(line)))
  abort.abort()
  await cancelled
  await fixture.waitFor(state => state.closed === 1)
  assert.equal(fixture.seen, false)
  assert.equal(fixture.commands.some(line => /^\S+ (?:SELECT|STORE|UID STORE|APPEND|MOVE|COPY|EXPUNGE)\b/i.test(line)), false)
})

test('already cancelled requests create no IMAP connection', async () => {
  const abort = new AbortController()
  abort.abort()
  let clients = 0
  await assert.rejects(withReadOnlyInbox(account, { signal: abort.signal,
    clientFactory: () => { clients++; throw new Error('Should not connect') } }, async () => {}), /abort|cancel/i)
  assert.equal(clients, 0)
})
