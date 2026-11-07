import { lstat, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

const allowed = /\.(?:txt|md|csv|log|pdf|docx?|xlsx?|pptx?|png|jpe?g|webp|gif|zip|7z|mp3|mp4|wav)$/i
const privateName = /(?:^\.|credential|password|secret|token|id_rsa|id_ed25519|密码|密钥|凭据)/i
// Resolve only a file the user actually named in the original instruction.
// Never interpret file contents, a model-provided path or "latest" as consent.
export async function resolveRequestedFile(request, roots, signal) {
  if (typeof request !== 'string' || !request.trim() || request.length > 2000) throw new Error('请说明要发送的文件名，例如“把桌面的报价.pdf发到手机”')
  const matches = new Map()
  for (const root of roots) {
    signal?.throwIfAborted()
    const label = typeof root === 'object' ? root.label : ''
    const namedRoot = ['桌面', '文档', '下载'].find(value => request.includes(value + '目录') || request.includes(value + '上') || request.includes(value + '的') || request.includes(value + '里'))
    if (label && namedRoot && label !== namedRoot) continue
    let base, entries
    try { base = await realpath(typeof root === 'object' ? root.directory : root); entries = await readdir(base, { withFileTypes: true }) } catch { continue }
    for (const entry of entries.slice(0, 2000)) {
      if (!entry.isFile() || !allowed.test(entry.name) || privateName.test(entry.name)) continue
      const index = request.toLowerCase().indexOf(entry.name.toLowerCase())
      if (index < 0 || /[\w.\-]/.test(request[index - 1] || '') || /[\w.\-]/.test(request[index + entry.name.length] || '')) continue
      const file = path.join(base, entry.name)
      if (!(await lstat(file)).isFile() || await realpath(file) !== file) continue
      matches.set(file, file)
    }
  }
  signal?.throwIfAborted()
  if (matches.size !== 1) throw new Error(matches.size
    ? '找到多个同名文件，请说明准确位置或使用不同的文件名；未发送文件'
    : '请提供桌面、文档或下载目录中要发送的完整文件名（含后缀）；不会弹出文件选择窗口，也不会自动挑选私人文件')
  return matches.values().next().value
}
