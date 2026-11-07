import { randomUUID } from 'node:crypto'

const escape = value => String(value).replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

export function moveApprovalHtml(action) {
  const title = action.name === 'undo_desktop' ? '恢复桌面整理' : '确认桌面整理'
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; form-action https://assistant.invalid">
<title>${title}</title><style>
*{box-sizing:border-box;letter-spacing:0}body{margin:0;padding:20px;font:14px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;color:#202428;background:#fff;display:flex;flex-direction:column;height:100vh;gap:16px}
h1{font-size:20px;margin:0}p{margin:4px 0 0;color:#50585e}main{flex:1;min-height:0;overflow:auto;border-top:1px solid #d8dddf;border-bottom:1px solid #d8dddf}
table{width:100%;table-layout:fixed;border-collapse:collapse}th{text-align:left;background:#f3f5f5;position:sticky;top:0}th,td{padding:10px;vertical-align:top;overflow-wrap:anywhere;border-bottom:1px solid #e4e8e8}
footer{display:flex;justify-content:flex-end;gap:12px;flex-shrink:0}form{margin:0}button{font:inherit;padding:8px 20px;min-height:40px;border:1px solid #778086;border-radius:6px;background:#fff;color:#202428;cursor:pointer}
button:focus-visible{outline:3px solid #06734e;outline-offset:3px}.allow{background:#126648;border-color:#126648;color:#fff}
@media(max-width:480px){body{padding:12px}th,td{padding:8px}}
</style></head><body><header><h1>${title}</h1><p>${action.entries.length} 个文件</p></header>
<main tabindex="0" aria-label="文件移动清单"><table><thead><tr><th scope="col">当前位置</th><th scope="col">目标位置</th></tr></thead><tbody>
${action.entries.map(entry => `<tr><td>${escape(entry.from)}</td><td>${escape(entry.to)}</td></tr>`).join('')}
</tbody></table></main><footer>
<form action="https://assistant.invalid/deny"><button autofocus>拒绝</button></form>
<form action="https://assistant.invalid/allow"><button class="allow">允许一次</button></form>
</footer></body></html>`
}

export async function showMoveApproval(parent, action, signal) {
  signal.throwIfAborted()
  const { BrowserWindow } = await import('electron')
  signal.throwIfAborted()
  const window = new BrowserWindow({ parent, modal: true, width: 800, height: 600,
    minWidth: 320, minHeight: 320, show: false, autoHideMenuBar: true,
    backgroundColor: '#ffffff', webPreferences: { nodeIntegration: false, contextIsolation: true,
      sandbox: true, partition: `assistant-approval-${randomUUID()}` } })
  return new Promise(resolve => {
    let settled = false
    const finish = allowed => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', cancel)
      if (!window.isDestroyed()) window.destroy()
      resolve(allowed && !signal.aborted)
    }
    const cancel = () => finish(false)
    window.once('closed', cancel)
    signal.addEventListener('abort', cancel, { once: true })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      finish(url === 'https://assistant.invalid/allow' || url === 'https://assistant.invalid/allow?')
    })
    window.webContents.on('will-redirect', event => event.preventDefault())
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); cancel() }
    })
    window.once('ready-to-show', () => { if (!settled) window.show() })
    window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(moveApprovalHtml(action))}`).catch(cancel)
  })
}
