// Private ACP worker launched by Control's own executable in Node mode.
import { auditStartupEntries, boot, installFailLoud } from '@deepseek-ai/dsh-app-boot'

let ctx, closing
const close = () => closing ||= (async () => { await ctx?.fiber.dispose() })()
installFailLoud('control-assistant', process, close)
process.stdin.once('end', () => { close().finally(() => process.exit(0)) })
process.once('SIGTERM', () => { close().finally(() => process.exit(0)) })
process.once('SIGINT', () => { close().finally(() => process.exit(0)) })
try {
  ctx = await boot('control-assistant', process.argv[2])
  await auditStartupEntries(ctx, 'control-assistant', () => { throw new Error('Embedded plugin did not activate') })
  if (closing) { await ctx.fiber.dispose(); process.exit(0) }
} catch {
  // Never serialize provider errors which may carry credential-bearing details.
  await close()
  process.exit(1)
}
