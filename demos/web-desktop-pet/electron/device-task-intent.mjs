// High-confidence imperative fallback, not a claim to classify arbitrary speech.
// Questions, quotations and negation stay with the conversational model.
export function isComputerCommand(text) {
  if (typeof text !== 'string') return false
  const value = text.trim()
  if (!value || /^[“"'「『]/.test(value) || /^(怎么|如何|为什么|怎样|什么是|教我|你能不能解释|他说|她说|假如|如果)/.test(value) ||
      /(不要|不用|不必|别再|别给|别帮|先别|暂时不|取消刚才的要求|不需要)/.test(value) || /\b(don't|do not|how to|how do|what is|if i|he said)\b/i.test(value)) return false
  const command = value.replace(/^(?:(?:请|帮我|给我|替我|麻烦你|麻烦|你|现在|直接|能不能|可以|能|一下|把|将)\s*)+/, '')
  return /^(打开|启动|运行|截屏|截图|截个图|截一张|拍一张屏幕|电脑截图|电脑截个图|电脑截屏|屏幕截图|搜索|查一下|查找|读取|查看.{0,10}(邮件|文件|任务|进度)|整理.{0,6}桌面|恢复.{0,6}桌面|发送|发.{0,12}(文件|邮件|图片|截图)|停止.{0,12}(任务|Codex|WorkBuddy)|让\s*(Codex|WorkBuddy)|用\s*(Codex|WorkBuddy))/i.test(command) ||
    /^(?:请|帮我|把|将|给我|替我|麻烦你|你).{1,160}(?:发给我|发送给我|发我)/.test(value) ||
    /^.{1,120}(发给|发送到|发到).{0,12}(手机|邮箱)/.test(command) ||
    /^(open|launch|screenshot|capture (my |the )?screen|send (a |the |this )?(file|email)|search for)\b/i.test(command) ||
    /^(?:提醒我|(?:创建|设置|添加|安排|查看|列出|查询|删除|取消).{0,40}(?:定时|提醒|闹钟))/.test(command) ||
    /^(?:今天|明天|后天|每天|今晚|下周|周[一二三四五六日天]|[一二三四五六七八九十百\d]+(?:分钟|小时|秒)后).{0,40}提醒我/.test(command)
}

export function fileTaskKind(text) {
  if (!isComputerCommand(text)) return ''
  const capture = /(截屏|截图|截个图|截一张|拍一张屏幕|screenshot|capture.{0,12}screen)/i.test(text)
  if (/(邮件|邮箱|email|e-mail)/i.test(text)) return ''
  const phone = /(发送到|发到|发给|传到|传给|send.{0,30}to).{0,12}(手机|phone)/i.test(text) || /发给我|发我|发送给我/.test(text)
  if (capture && /刚才|刚刚|最近|上一张/.test(text) && /发送|发给|发到|发我/.test(text)) return 'send_capture'
  return capture ? phone || /发送|发给|发到|发我|发.{0,4}截图/.test(text) ? 'capture_send' : 'capture'
    : (phone || /发送|发给|发到|发我/.test(text)) && /(文件|图片|file|image|\.[a-z0-9]{2,5}\b)/i.test(text) ? 'send' : ''
}

export function isReminderCommand(text) { return isComputerCommand(text) && /提醒|闹钟/.test(text) }

// Only server-authenticated mobile sessions can expose local tools. History and
// ordinary companion chat remain compatible with old control clients.
export function remoteTaskAccess(text, metadata) {
  const allowComputer = metadata?.computerAuthorized === true
  if (!allowComputer && isComputerCommand(text)) return { ok: false, code: 'REMOTE_AUTH_REQUIRED',
    message: '远程电脑操作尚未通过手机登录授权，请更新三端并保持手机远程对话页打开；旧绑定需解绑后重新扫码' }
  return { ok: true, allowComputer }
}
