import test from 'node:test'
import assert from 'node:assert/strict'
import { RefreshCadence } from '../electron/device-refresh-cadence.mjs'

test('thousands of state events do not turn failed score reads into a request loop', () => {
  let now = 0
  const cadence = new RefreshCadence({ now: () => now })
  for (const wait of [15000, 30000, 60000, 120000, 240000, 300000, 300000]) {
    assert.equal(cadence.begin('account-A'), true)
    cadence.finish('account-A', { ok: false })
    assert.equal(cadence.nextAt - now, wait)
    for (let i = 0; i < 10000; i++) assert.equal(cadence.begin('account-A'), false)
    now += wait
  }
})
test('a known zero balance is refreshed once a minute, not treated as a failed lookup', () => {
  let now = 0
  const cadence = new RefreshCadence({ now: () => now })
  assert.equal(cadence.begin('A'), true)
  cadence.finish('A', { ok: true, empty: true })
  for (now = 5000; now < 60000; now += 5000) assert.equal(cadence.begin('A'), false)
  assert.equal(cadence.begin('A'), true)
  cadence.finish('A', { ok: true })
  now += 29999; assert.equal(cadence.begin('A'), false)
  now++; assert.equal(cadence.begin('A'), true)
})
test('binding changes reset the schedule and late old-account results cannot alter it', () => {
  let now = 0
  const cadence = new RefreshCadence({ now: () => now })
  cadence.begin('A'); cadence.finish('A', { ok: false })
  assert.equal(cadence.begin('B'), true)
  const next = cadence.nextAt
  cadence.finish('A', { ok: false }); assert.equal(cadence.nextAt, next)
  assert.equal(cadence.begin('B', { force: true }), false)
  now = 3000; assert.equal(cadence.begin('B', { force: true }), true)
  cadence.finish('B', { ok: true }); assert.equal(cadence.failures, 0)
})
