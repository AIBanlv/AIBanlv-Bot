export const computerTools = ['computer', 'computer_batch']
export const observationActions = new Set(['screenshot', 'screen_info', 'windows', 'cursor'])
const inputs = new Set(['focus_window', 'click', 'double_click', 'right_click', 'middle_click', 'move', 'drag', 'scroll', 'type', 'shortcut', 'key'])
export const blockedWindow = title => /powershell|pwsh|cmd\.exe|command prompt|命令提示符|\bterminal\b|终端|用户账户控制|user account control|windows security|windows 安全|password manager|密码管理/i.test(String(title))
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value
export const computerTarget = args => JSON.stringify(ordered(args))

export function validateComputer(name, args) {
  if (!computerTools.includes(name) || !args || typeof args !== 'object' || Array.isArray(args) || computerTarget(args).length > 4096) throw new Error('电脑操作参数无效')
  const actions = name === 'computer_batch' ? args.actions : [args]
  if (!Array.isArray(actions) || !actions.length || actions.length > 4) throw new Error('每批最多四次屏幕观察')
  for (const step of actions) {
    if (!step || !observationActions.has(step.action) && !inputs.has(step.action)) throw new Error('该电脑操作尚未开放，请使用单步观察与操作')
    if (name === 'computer_batch' && !observationActions.has(step.action)) throw new Error('批量仅支持屏幕观察，输入操作请逐步确认')
    if (step.tiles !== undefined && (!Number.isInteger(step.tiles) || step.tiles < 1 || step.tiles > 4)) throw new Error('最多四张局部截图')
    for (const key of ['sleep', 'duration', 'ms']) if (step[key] !== undefined && (!Number.isFinite(step[key]) || step[key] < 0 || step[key] > 500)) throw new Error('电脑操作等待时间超过上限')
    if (step.text !== undefined && (typeof step.text !== 'string' || step.text.length > 512 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(step.text))) throw new Error('单步输入最多 512 字')
    if (blockedWindow(step.title) || /win|meta|super|command|cmd/i.test(String(step.key || '') + String(step.shortcut || '') + JSON.stringify(step.keys || []))) throw new Error('不允许通过电脑工具打开命令行或安全授权界面')
  }
  if (actions.reduce((sum, step) => sum + (step.action === 'screenshot' ? step.tiles || 1 : 0), 0) > 4) throw new Error('单次调用最多四张截图')
  return { observation: actions.every(step => observationActions.has(step.action)), actions }
}
