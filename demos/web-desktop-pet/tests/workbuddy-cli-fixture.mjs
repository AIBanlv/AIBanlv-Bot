// Local protocol-only fixture: no model, provider login, commands or file edits.
if (process.argv.includes('--help')) {
  console.log('--permission-mode <mode> choices: default, auto, dontAsk')
  process.exit(0)
}
if (process.argv[process.argv.indexOf('--permission-mode') + 1] !== 'dontAsk') {
  console.error('fixture refuses automatic permission grants')
  process.exit(2)
}
let input = ''
for await (const chunk of process.stdin) input += chunk
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
if (input === 'no result') process.exit(0)
send({ type: 'stream_event', _messageId: 'message-1', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'PRIVATE_RAW_REASONING' } } })
send({ type: 'stream_event', _messageId: 'message-1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '正在检查本地任务' } } })
send({ type: 'assistant', _messageId: 'message-1', message: { content: [{ type: 'text', text: '正在检查本地任务' }, { type: 'tool_use', id: 'tool-1', name: 'Read' }] } })
if (input === 'hold') await new Promise(resolve => setTimeout(resolve, 500))
send({ type: 'result', subtype: input === 'failure' ? 'error_during_execution' : 'success', is_error: input === 'failure',
  permission_denials: input === 'denied' ? [{ tool_name: 'Bash' }] : [],
  result: input === 'failure' ? 'private sk-fixture-secret-key' : '夹具任务已完成' })
