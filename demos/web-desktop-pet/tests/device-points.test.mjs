import test from 'node:test'
import assert from 'node:assert/strict'
import { pointsRecord, pointsPage } from '../electron/device-points.mjs'

test('credit records follow mobile income, expense and after-balance semantics', () => {
  const income = pointsRecord({ id: '1', type: 2, amount: 1000, changedScore: 1234, remark: 'desktop-monthly:2026-10' })
  assert.equal(income.title, '积分收益'); assert.equal(income.income, true); assert.match(income.amount, /^\+1,?000$/)
  assert.equal(income.remark, '积分收益')
  const expense = pointsRecord({ id: '2', type: -3, amount: -8, changedScore: 0, createTime: '2026-10-29 10:20:30' })
  assert.equal(expense.title, '对话消耗'); assert.equal(expense.amount, '-8'); assert.equal(expense.balance, '0')
  assert.equal(expense.at, '2026-10-29 10:20:30')
  assert.equal(pointsRecord({ id: 3, type: 999 }).title, '积分变动')
  assert.equal(pointsRecord({ id: 4, type: -7 }).balance, '—')
})
test('ledger pages are bounded, validated and deduplicated without inventing an empty success', () => {
  assert.deepEqual(pointsPage({ total: 2, records: [{ id: '1' }, { id: '1' }, null] }), { total: 2, records: [{ id: '1' }] })
  for (const value of [{}, { total: -1, records: [] }, { total: 1, records: Array(21).fill({ id: 1 }) }]) {
    assert.throws(() => pointsPage(value), /Invalid points page/)
  }
  assert.deepEqual(pointsPage({ total: 0, records: [] }).records, [])
})
