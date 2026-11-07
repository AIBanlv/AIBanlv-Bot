import { writeFile } from 'node:fs/promises'
import path from 'node:path'

export function registerHistoryControls({ ipcMain, windows, store, dialog, changed, beforeClear = () => {}, resume = () => {} }) {
  let clearing = false
  ipcMain.handle('device:history-export', async event => {
    if (!windows.fromController(event)) return { ok: false }
    const scope = JSON.stringify(store.scope)
    const rows = await store.export()
    const selected = await dialog.showSaveDialog(windows.controller, { title: '导出当前身份的本地记录', defaultPath: 'conversation-history.json',
      filters: [{ name: '会话记录', extensions: ['json'] }] })
    if (selected.canceled || !selected.filePath) return { ok: false, message: '已取消导出' }
    if (scope !== JSON.stringify(store.scope)) return { ok: false, message: '身份已改变，请重新操作' }
    const relative = path.relative(path.dirname(store.file), path.resolve(selected.filePath))
    if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return { ok: false, message: '请选择应用数据目录之外的导出位置' }
    try {
      const exported = rows.map(({ agentId, messageId, messageRole, text, timestamp }) => ({ agentId, messageId, role: messageRole, text, timestamp }))
      await writeFile(selected.filePath, JSON.stringify(exported, null, 2), { mode: 0o600 })
      return { ok: true, message: `已导出 ${rows.length} 条记录；导出文件包含明文对话，请自行保管` }
    } catch { return { ok: false, message: '导出失败，请检查所选位置' } }
  })
  ipcMain.handle('device:history-clear', async event => {
    if (!windows.fromController(event)) return { ok: false }
    if (clearing) return { ok: false, message: '正在清除本地记录，请稍候' }
    clearing = true
    try {
      const scope = JSON.stringify(store.scope)
      const result = await dialog.showMessageBox(windows.controller, { type: 'warning', title: '清除本地记录',
        message: '清除当前身份的本地记录和待同步消息？已同步的云端记录不会删除，其他账号的本地记录会保留。',
        buttons: ['取消', '清除'], defaultId: 0, cancelId: 0 })
      if (result.response !== 1) return { ok: false, message: '已取消清除' }
      if (scope !== JSON.stringify(store.scope)) return { ok: false, message: '身份已改变，请重新操作' }
      try {
        await beforeClear()
        await store.queue
        if (scope !== JSON.stringify(store.scope)) return { ok: false, message: '身份已改变，请重新操作' }
        await store.clear()
        changed()
        return { ok: true, message: '当前身份的本地记录已清除' }
      }
      catch { return { ok: false, message: '清除失败，请检查本机存储后重试' } }
      finally { resume() }
    } finally { clearing = false }
  })
}
