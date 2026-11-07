import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// npm ci removes node_modules first. On Windows an open desktop or MCP process
// holds Electron files, so reject before either dependency tree is modified.
if (process.platform === 'win32') {
  try {
    const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', `
        $ErrorActionPreference = 'Stop'
        $target = [IO.Path]::GetFullPath($env:AIBANLV_SETUP_ELECTRON)
        $ids = @(foreach ($running in [Diagnostics.Process]::GetProcessesByName('electron')) {
          try {
            $processPath = $running.MainModule.FileName
            if (!$processPath) { throw 'Electron path is unavailable' }
            if ([IO.Path]::GetFullPath($processPath) -eq $target) { $running.Id }
          } catch {
            if (!$running.HasExited) { throw }
          } finally { $running.Dispose() }
        })
        ConvertTo-Json -InputObject $ids -Compress
      `], { windowsHide: true, timeout: 10000, maxBuffer: 64 * 1024,
        env: { ...process.env, AIBANLV_SETUP_ELECTRON: fileURLToPath(new URL('../node_modules/electron/dist/electron.exe', import.meta.url)) } })
    const ids = JSON.parse(stdout)
    if (ids.length) {
      console.error(`[AIBANLV_SOURCE_IN_USE] 当前源码目录的 Electron 仍在运行（PID: ${ids.join(', ')}）。请从 AIBanlv 托盘菜单选择“退出”；如已退出，请断开使用此源码目录的 WorkBuddy/MCP 连接，然后重新运行 Setup。关闭窗口只会隐藏程序。`)
      process.exitCode = 1
    }
  } catch {
    console.error('[AIBANLV_SOURCE_CHECK_FAILED] 无法确认源码程序是否已退出，已停止依赖安装。请退出正在运行的 Electron 程序及其 MCP 连接后重试。')
    process.exitCode = 1
  }
}
