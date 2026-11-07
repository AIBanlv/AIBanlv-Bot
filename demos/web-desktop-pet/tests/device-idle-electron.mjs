import assert from 'node:assert/strict'
import path from 'node:path'

export async function verifyIdleExpressions({ app, page, pet, artifacts, pixels, roleA, send,
  waitApplied, providerTexts, billingEvents, setBound }) {
  const avatar = () => pet.frames().find(frame => frame.url().includes('/avatar.html'))
  const diagnostics = () => avatar().evaluate(() => JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics))
  const waitOwner = (...owners) => avatar().waitForFunction(owners => {
    const value = JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics || '{}')
    return value.idle?.status === 'ready' && owners.includes(value.idle.owner)
  }, owners)
  const seen = [], faces = [], hashes = []
  await waitOwner('idle', 'gaze')
  await pet.waitForFunction(() => document.querySelector('#drag-surface').dataset.bank === 'clips')
  // Local mood gestures may interrupt ambient clips; require three real captures
  // without counting time owned by a foreground reaction as idle playback.
  const started = Date.now(), deadline = started + 25000
  let ambientSince = Date.now()
  while (Date.now() < deadline && (seen.length < 3 || Date.now() - started < 12000)) {
    const value = await diagnostics()
    if (value.idle.owner === 'foreground') ambientSince = Date.now()
    else if (Date.now() - ambientSince > 300) {
      assert.equal(value.face.jawOpen, 0)
      faces.push(value.face)
    }
    if (value.idle.clipId && value.idle.clipId !== seen.at(-1)) {
      assert.equal(seen.includes(value.idle.clipId), false)
      seen.push(value.idle.clipId)
      hashes.push((await pixels()).hash)
      await pet.screenshot({ path: path.join(artifacts, `idle-${seen.length}.png`), omitBackground: true })
    }
    await pet.waitForTimeout(200)
  }
  assert.ok(seen.length >= 3)
  assert.ok(new Set(hashes).size >= 2)
  assert.ok(faces.some(face => face.browInnerUp > .005 || face.mouthSmileLeft > .005))
  assert.equal(providerTexts.length, 0)
  assert.equal(billingEvents.some(event => event.eventType === 'usage'), false)

  // Exercise the real main-process cursor subscription and native pose wrapper.
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find(win => win.webContents.getURL().endsWith('/device/device-pet.html')).getBounds())
  await app.evaluate(({ screen }, point) => {
    globalThis.idleOriginalCursor = screen.getCursorScreenPoint
    globalThis.idleCursor = point
    screen.getCursorScreenPoint = () => ({ ...globalThis.idleCursor })
  }, { x: bounds.x - 300, y: bounds.y })
  try {
    await pet.evaluate(() => {
      window.idlePointerSubscription = window.desktopPet.onPointer(value => { window.idlePointer = value })
    })
    await pet.waitForTimeout(3000)
    await app.evaluate((_electron, x) => { globalThis.idleCursor.x = x }, bounds.x + bounds.width + 600)
    await pet.waitForFunction(() => window.idlePointer?.x > 0.9)
    const pointer = await pet.evaluate(() => window.idlePointer)
    assert.deepEqual(Object.keys(pointer).sort(), ['distance', 'idle', 'inside', 'x', 'y'])
    assert.equal(pointer.inside, false)
    await waitOwner('gaze')
    await pet.waitForTimeout(300)
    const following = await diagnostics()
    assert.equal(following.poseApplied, true)
    assert.ok(following.face.browInnerUp > 0 || following.face.mouthSmileLeft > 0,
      'Native gaze wrapper must retain the idle face instead of replacing it with zeroes')
    assert.equal(following.face.jawOpen, 0)
    await pet.screenshot({ path: path.join(artifacts, 'idle-with-gaze.png'), omitBackground: true })
    await waitOwner('idle', 'gaze')
    await pet.locator('#drag-surface').focus(); await pet.keyboard.down('Space')
    await waitOwner('foreground')
    await avatar().waitForFunction(() => {
      const value = JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics || '{}')
      return value.face?.mouthSmileLeft > .05 && value.poseApplied
    })
    // Cancel touch before release so this part remains a local-only interaction.
    await page.locator('#click-through').check(); await pet.keyboard.up('Space')
    await page.locator('#click-through').uncheck()
    await waitOwner('idle', 'gaze')
    assert.equal(providerTexts.length, 0)

    await app.evaluate(() => { globalThis.failNextSession = false })
    await pet.locator('#chat-text').fill('待机轮换后测试正常说话')
    await pet.locator('#chat-text').press('Enter')
    await avatar().waitForFunction(() => {
      const value = JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics || '{}')
      return value.idle?.owner === 'foreground' && value.face?.jawOpen > .02
    }, null, { timeout: 20000 })
    await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled, null, { timeout: 20000 })
    await waitOwner('idle', 'gaze')
    await avatar().waitForFunction(() => JSON.parse(document.querySelector('#avatar-stage').dataset.poseDiagnostics).face.jawOpen === 0)

    await page.locator('#visible').uncheck(); await pet.waitForTimeout(400)
    const hidden = await diagnostics()
    await pet.waitForTimeout(1300)
    assert.deepEqual((await diagnostics()).idle, hidden.idle)
    await page.locator('#visible').check(); await waitOwner('idle', 'gaze')
    const resumed = await diagnostics()
    assert.equal(resumed.idle.clipId, hidden.idle.clipId)
    assert.ok(resumed.idle.positionMs - hidden.idle.positionMs < 800)
  } finally {
    await pet.evaluate(() => window.idlePointerSubscription?.())
    await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = globalThis.idleOriginalCursor })
  }

  const oldFrame = avatar()
  send({ ...roleA, agentId: 'Idle Role', agentName: 'Idle Role', profileVersion: 2 }); await waitApplied('Idle Role')
  await waitOwner('idle', 'gaze')
  assert.notEqual(avatar(), oldFrame)
  assert.equal(oldFrame.isDetached(), true)
  assert.ok((await diagnostics()).idle.positionMs < 1500)
  assert.ok((await pixels()).visible > 100)
  setBound(false); send({ type: 'bind_lost' })
  await page.waitForFunction(() => !document.querySelector('#qr').hidden)
  assert.equal(await pet.locator('#avatar-host iframe').count(), 0)
  return { clips: seen, changedPixels: new Set(hashes).size, articulationClosed: true,
    noIdleGeneration: true, gazeKeepsFace: true, touchPriority: true, speechPriority: true,
    hidePausesClock: true, switchResetsPlayer: true, unbindDisposesPlayer: true }
}
