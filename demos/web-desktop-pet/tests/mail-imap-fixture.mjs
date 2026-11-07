import { createServer } from 'node:net'
import { EventEmitter } from 'node:events'

// Test-only, loopback IMAP server. It intentionally supports no write commands.
export async function mailImapFixture({ holdFetch = false } = {}) {
  const events = new EventEmitter()
  const sockets = new Set()
  const source = Buffer.from('From: sender@example.com\r\nTo: fixture@qq.com\r\nSubject: Local fixture\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nUnread message bytes.\r\n')
  const state = { commands: [], seen: false, connections: 0, closed: 0, source }
  const server = createServer(socket => {
    sockets.add(socket)
    state.connections++
    let buffer = '', readOnly = false
    socket.on('error', () => {})
    socket.on('close', () => { sockets.delete(socket); state.closed++; events.emit('change') })
    socket.write('* OK local fixture ready\r\n')
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')
      let end
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        state.commands.push(line)
        events.emit('change')
        const match = /^(\S+)\s+(.*)$/.exec(line)
        if (!match) continue
        const [, tag, command] = match
        const ok = message => socket.write(`${tag} OK ${message}\r\n`)
        if (/^CAPABILITY(?:\s|$)/i.test(command)) {
          socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR\r\n'); ok('capabilities')
        } else if (/^(AUTHENTICATE PLAIN|LOGIN)(?:\s|$)/i.test(command)) {
          ok('authenticated')
        } else if (/^(LIST|LSUB)(?:\s|$)/i.test(command)) {
          socket.write('* LIST (\\Inbox) "/" "INBOX"\r\n'); ok('listed')
        } else if (/^(EXAMINE|SELECT)(?:\s|$)/i.test(command)) {
          readOnly = /^EXAMINE/i.test(command)
          socket.write('* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 77] stable\r\n* OK [UIDNEXT 2] next\r\n')
          ok(`[${readOnly ? 'READ-ONLY' : 'READ-WRITE'}] inbox opened`)
        } else if (/^(?:UID )?FETCH(?:\s|$)/i.test(command)) {
          if (holdFetch) continue
          if (!readOnly && /BODY\[/i.test(command)) state.seen = true
          const flags = state.seen ? '\\Seen' : ''
          socket.write(`* 1 FETCH (UID 1 FLAGS (${flags}) BODY[] {${source.length}}\r\n`)
          socket.write(source)
          socket.write(')\r\n'); ok('fetched')
        } else if (/^LOGOUT(?:\s|$)/i.test(command)) {
          socket.end(`* BYE fixture closing\r\n${tag} OK logged out\r\n`)
        } else if (/^(NOOP|CLOSE|UNSELECT)(?:\s|$)/i.test(command)) {
          ok('done')
        } else {
          socket.write(`${tag} BAD unsupported fixture command\r\n`)
        }
      }
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  state.port = server.address().port
  state.waitFor = predicate => new Promise((resolve, reject) => {
    if (predicate(state)) { resolve(); return }
    const timer = setTimeout(() => { events.off('change', changed); reject(new Error('Fixture condition timed out')) }, 5000)
    function changed() {
      if (!predicate(state)) return
      clearTimeout(timer); events.off('change', changed); resolve()
    }
    events.on('change', changed)
  })
  state.close = async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
  }
  return state
}
