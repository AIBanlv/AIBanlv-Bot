const types = { 1: '积分充值', 2: '积分收益', 3: '套餐变更', '-1': '形象训练', '-2': '音色训练',
  '-3': '对话消耗', '-4': '脚本合成', '-5': '脚本生成', '-6': '套餐变更', '-7': '积分扣除' }
export function pointsRecord(row, translate = text => text) {
  const type = Number(row.type), income = type > 0
  const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? Math.trunc(Number(value)).toLocaleString() : '—'
  let remark = typeof row.remark === 'string' ? row.remark.slice(0, 1000) : ''
  if (remark === 'aibanlv-self-registration:v1') remark = row.starProductName || translate('套餐变更')
  if (/^aibanlv-guest-(device|first):/.test(remark) || /^desktop-monthly:\d{4}-\d{2}$/.test(remark)) remark = translate('积分收益')
  return { id: String(row.id), title: translate(types[type] || '积分变动'), income,
    amount: `${income ? '+' : '-'}${number(row.amount == null ? null : Math.abs(Number(row.amount)))}`,
    balance: number(row.changedScore ?? row.changed_score ?? row.balance ?? row.score),
    at: typeof row.createTime === 'string' ? row.createTime.slice(0, 64) : '—', remark }
}
export function pointsPage(data) {
  if (!data || !Array.isArray(data.records) || data.records.length > 20 ||
      !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('Invalid points page')
  const ids = new Set()
  return { total: data.total, records: data.records.filter(row => {
    if (!row || typeof row !== 'object' || !['string', 'number'].includes(typeof row.id) || !String(row.id) || ids.has(String(row.id))) return false
    ids.add(String(row.id)); return true
  }) }
}
