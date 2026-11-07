import assert from 'node:assert/strict'

// Poll IPC results in Node. This fixture's Playwright waitForFunction treats an
// async predicate as truthy before its IPC Promise has resolved.
export async function waitForDeviceState(page, accept) {
  const deadline = Date.now() + 30000
  let state
  while (Date.now() < deadline) {
    state = await page.evaluate(() => window.controlDevice.state())
    if (accept(state)) return state
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(`Device state did not settle: ${JSON.stringify({ phase: state?.phase, current: state?.current, models: state?.models, history: state?.history })}`)
}
