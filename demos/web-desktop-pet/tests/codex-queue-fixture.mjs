import { appendFile } from 'node:fs/promises'

if (process.argv[2] === 'queue') {
  if (process.env.QUEUE_FIXTURE_MODE === 'fail') {
    process.stderr.write('unexpected argument --message private-message')
    process.exit(2)
  }
  if (process.env.QUEUE_FIXTURE_MODE === 'wait') setInterval(() => {}, 1000)
  else {
    const args = process.argv.slice(3)
    await appendFile(process.env.QUEUE_FIXTURE_INBOX, JSON.stringify({
      thread: args[args.indexOf('--thread') + 1], text: args[args.indexOf('--message') + 1],
    }) + '\n')
  }
} else await import('./codex-app-server-fixture.mjs')
