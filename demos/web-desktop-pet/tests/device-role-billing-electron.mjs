import assert from 'node:assert/strict'
import { waitForDeviceState } from './device-state-fixture.mjs'

export async function verifyRoleBilling({ page, pet, app, bind, messages, say }) {
  await page.evaluate(async () => {
    await window.controlDevice.configureAssistant({ apiKey: 'fixture-own-deepseek', enabled: false, remember: false })
    await window.controlDevice.configureModels({ apiKey: 'fixture-own-realtime', workspaceId: 'fixture-space' })
  })
  assert.equal((await pet.evaluate(() => window.controlDevice.chat('未扫码线上角色'))).code, 'BIND_REQUIRED')
  bind()
  await waitForDeviceState(pet, value => value.models.code === 'SCORE_DEPLETED')
  assert.equal((await pet.evaluate(() => window.controlDevice.chat('积分不足也不能用自有 Key'))).code, 'SCORE_DEPLETED')
  await app.evaluate(() => { globalThis.fixtureScore = 10 })
  // Respect the production refresh cadence's minimum interval, even for force.
  await new Promise(resolve => setTimeout(resolve, 3100))
  await page.evaluate(() => window.controlDevice.configureModels({ source: 'deepseek' }))
  await waitForDeviceState(pet, value => value.models.route === 'platform' && value.conversationState === 'ready')
  await say('线上角色按平台规则对话')
  await waitForDeviceState(pet, value => value.history.messages === 2 && value.history.pending === 0)
  assert.ok(messages.some(row => row.type === 'session_register'))
  assert.ok(messages.some(row => row.type === 'session_event' && row.eventType === 'usage'))
  const requests = await app.evaluate(() => globalThis.fixtureRequests)
  const grant = requests.find(row => row.url.endsWith('/desktop/metered-realtime/sessions'))
  assert.equal(JSON.parse(grant.body).agentId, 'public-waner')
  assert.equal(requests.some(row => row.url === 'https://api.deepseek.com/chat/completions'), false)

  // Grant failure keeps platform funding; it must not use either saved own Key.
  await app.evaluate(() => { globalThis.fixtureRejectSession = true })
  await page.evaluate(() => window.controlDevice.configureModels({ source: 'auto' }))
  await waitForDeviceState(pet, value => value.conversationState === 'error')
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).models.route, 'platform')
  assert.equal(messages.some(row => row.type === 'fixture-own-provider'), false)
  await page.evaluate(() => window.controlDevice.configureModels({ platformEnabled: false }))
  assert.equal((await pet.evaluate(() => window.controlDevice.chat('离线不能改用自己的额度'))).code, 'BIND_REQUIRED')
  console.log('role billing Electron: online role login/score gates, real fixture grant/billing/history, legacy source ignored and no own-Key fallback passed')
}
