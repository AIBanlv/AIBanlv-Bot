import { ImapFlow } from 'imapflow'
import { mailProviders } from './device-mail-settings.mjs'

export async function withReadOnlyInbox(account, { signal, clientFactory = options => new ImapFlow(options) }, work) {
  signal.throwIfAborted()
  const provider = Object.hasOwn(mailProviders, account.provider) ? mailProviders[account.provider] : null
  if (!provider) throw Object.assign(new Error('MAIL_SETTINGS_INVALID'), { code: 'MAIL_SETTINGS_INVALID' })
  const client = clientFactory({ host: provider.host, port: 993, secure: true,
    auth: { user: account.user, pass: account.password }, logger: false, logRaw: false,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    disableAutoIdle: true, disableCompression: true,
    clientInfo: { name: 'AIBanlv', version: '0.1.4', vendor: 'Control' },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
    maxLiteralSize: 2 * 1024 * 1024, maxResponseSize: 4 * 1024 * 1024, maxLineLength: 128 * 1024 })
  const timeout = AbortSignal.timeout(30000)
  const abort = AbortSignal.any([signal, timeout])
  const close = () => client.close()
  client.on('error', () => {}) // errors reject operations; never log server data
  abort.addEventListener('abort', close, { once: true })
  try {
    abort.throwIfAborted()
    await client.connect()
    abort.throwIfAborted()
    await client.mailboxOpen('INBOX', { readOnly: true })
    const result = await work(client)
    abort.throwIfAborted()
    return result
  } catch (error) {
    signal.throwIfAborted()
    const code = timeout.aborted ? 'MAIL_TIMEOUT' : /^MAIL_[A-Z_]+$/.test(error.code || '') ? error.code : 'MAIL_CONNECTION_FAILED'
    throw Object.assign(new Error(code), { code })
  } finally {
    abort.removeEventListener('abort', close)
    client.close()
  }
}
