import { spawn } from 'node:child_process'
import { homedir } from 'node:os'

// Use the owner's inbox rather than acquiring a second writer for its thread.
export async function queueCodexMessage({ launch, threadId, text, signal,
  timeoutMs = 20000, spawnProcess = spawn }) {
  signal?.throwIfAborted()
  const index = launch?.args?.lastIndexOf('app-server') ?? -1
  if (index < 0) throw new Error('Codex 排队入口不可用，请重新连接完整 CLI。')
  const args = [...launch.args.slice(0, index), 'queue', '--thread', threadId, '--message', text]
  await new Promise((resolve, reject) => {
    let timer, problem
    const child = spawnProcess(launch.command, args, { cwd: launch.cwd || homedir(),
      env: launch.env || process.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const abort = () => {
      problem = Object.assign(new Error('排队提交结果尚未确认，请到 Codex 原窗口核对，不要重复发送。'), { submissionUncertain: true })
      child.kill()
    }
    const finish = error => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    // Command output can include the prompt; never log it or return it to chat.
    child.stdout.resume(); child.stderr.resume()
    child.once('error', () => finish(new Error('Codex 排队入口启动失败，请检查本机 CLI 安装。')))
    child.once('close', (code, killedBy) => finish(problem || (killedBy
      ? Object.assign(new Error('排队进程意外结束，提交结果尚未确认，请在原窗口核对。'), { submissionUncertain: true })
      : code === 0 ? null : new Error('Codex 消息排队失败，请检查 CLI 是否支持 queue 命令及原会话是否存在。'))))
    timer = setTimeout(abort, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}
