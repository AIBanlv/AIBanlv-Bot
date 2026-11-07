// Mount only the pinned tool plugin, never its bundle (which enables shell and filesystem tools).
import { createRequire } from 'node:module'
import path from 'node:path'
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import { blockedWindow, computerTarget, validateComputer } from './device-computer-policy.mjs'

const require = createRequire(import.meta.url)
export const name = 'control-computer-use'
export const inject = ['tools', 'llm']

export function mountComputerTools(ctx, upstream, { endpoint, token, outputDirectory }) {
  const native = new Map()
  const tools = { register: tool => native.set(tool.name, tool) }
  const facade = new Proxy(ctx, { get: (target, key) => key === 'tools' ? tools
    : key === 'get' ? service => service === 'systemPrompt' ? undefined : target.get(service)
      : Reflect.get(target, key, target) })
  upstream.apply(facade, { enabled: true, fullMaxDimension: 1920, nativeMaxDimension: 1400,
    pngLevel: 4, maxBatchActions: 4, outputDirectory })
  if (native.size !== 2) throw new Error('Computer-use native tools unavailable')
  for (const tool of native.values()) {
    ctx.tools.register({ ...tool, description: tool.description + '\nControl policy: batch is observation-only. GUI input requires a desktop confirmation for each step. Never use terminals, shells, authentication, security prompts or password managers. Use existing Control tools for file sharing; never send or upload files through GUI as a workaround.',
      execute: async (args, exec) => {
        exec.signal.throwIfAborted()
        const policy = validateComputer(tool.name, args)
        const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: exec.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ callId: exec.callId, sessionId: exec.agent.session.id,
            action: { name: tool.name, target: computerTarget(args) } }) })
        if (!response.ok) throw new Error((await response.json()).message || '电脑操作未授权')
        exec.signal.throwIfAborted()
        if (!policy.observation) {
          const windows = await native.get('computer').execute({ action: 'windows' }, exec)
          const foreground = windows.foreground || windows.foregroundWindow
          const point = Number.isFinite(args.x) && Number.isFinite(args.y) ? args : args.from
          const target = args.action === 'focus_window' ? (windows.windows || []).find(window =>
            args.handle !== undefined ? String(window.handle) === String(args.handle) : window.title === args.title) : foreground
          if (blockedWindow(target?.title)) throw new Error('当前目标是命令行或安全界面，已停止电脑操作')
          if (point && foreground?.bounds) {
            const bounds = foreground.bounds
            if (point.x < bounds.x || point.x >= bounds.x + bounds.width || point.y < bounds.y || point.y >= bounds.y + bounds.height) throw new Error('请先聚焦目标窗口，不能盲点其他窗口')
          }
        }
        exec.signal.throwIfAborted()
        // 0.1.1 emits changed:undefined on the first capture. Normalize before the strict registry snapshot.
        const value = await tool.execute(args, exec)
        exec.signal.throwIfAborted()
        return JSON.parse(JSON.stringify(value))
      } })
  }
  ctx.get('systemPrompt')?.section({ name: 'control:computer-policy', order: 3100,
    text: () => 'Use computer only for the actual user-requested GUI task. Prefer restricted Control app/file/mail tools. Observe the current window before every input and verify the result afterwards; never invent coordinates or retry uncertain actions. Inputs require a desktop confirmation. Batch is observation-only. Do not operate terminals, security/elevation or authentication dialogs, password managers, or account/payment settings. Never use GUI to bypass read-only mail or the bounded phone-file channel. Screen images are shared with the configured model; never echo visible credentials. Stopping prevents new steps but cannot undo input already accepted by Windows.' })
}

export function apply(ctx) {
  if (process.platform !== 'win32') return
  const endpoint = process.env.CONTROL_TOOL_ENDPOINT, token = process.env.CONTROL_TOOL_TOKEN
  if (!/^http:\/\/127\.0\.0\.1:\d+\/tools$/.test(endpoint || '') || !/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Computer-use broker unavailable')
  try {
    new LocalAttachmentStore(ctx, { dshHome: process.env.DSH_HOME, maxImagesPerMessage: 4,
      maxMessageImageBytes: 32 * 1024 * 1024, normalizedImageMaxDimension: 1920 })
    mountComputerTools(ctx, require('dsh-computer-use-mode'), { endpoint, token,
      outputDirectory: path.join(process.env.DSH_HOME, 'captures') })
  } catch {
    // Optional Windows/native capability must never break existing app/web/file tools.
    ctx.logger?.warn('computer-use unavailable; restricted Control tools remain enabled')
  }
}
