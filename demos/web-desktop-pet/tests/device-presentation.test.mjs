import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { installDevicePoseTransition } from '../src/device-presentation.mjs'

const require = createRequire(import.meta.url)
const { Bone, Skeleton, Quaternion, Euler } = require('../../../android-native/renderer/tools/ali-native-shell-ui/node_modules/three')

function fixture() {
  const bone = new Bone()
  bone.name = 'head'
  const skeleton = new Skeleton([bone])
  let active = false, now = 0, target = 0.6
  const mixer = { update() { bone.rotation.set(0, target, 0); bone.position.set(0, 0, active ? 0.1 : 0) } }
  const renderer = { mixer, viewer: { skinModel: { skeleton } } }
  const original = mixer.update
  const transition = installDevicePoseTransition(renderer, ['head'], () => active, () => now)
  const tick = (time, controlled = active, yaw = target) => {
    now = time; active = controlled; target = yaw; mixer.update()
    return bone.quaternion.clone()
  }
  return { bone, mixer, original, transition, tick }
}

test('idle-to-speech and speech-to-idle handoffs start from the last displayed rig pose', () => {
  const f = fixture()
  const idle = f.tick(0)
  assert.ok(idle.angleTo(f.tick(16, true, -0.3)) < 1e-6, 'Control ownership cannot snap to bind pose')
  let previous = f.bone.quaternion.clone()
  for (let time = 32; time <= 416; time += 16) {
    const current = f.tick(time)
    assert.ok(previous.angleTo(current) < 0.08, 'Handoff must stay continuous at display rate')
    previous = current
  }
  const expected = new Quaternion().setFromEuler(new Euler(0, -0.3, 0))
  assert.ok(previous.angleTo(expected) < 1e-6)
  assert.ok(previous.angleTo(f.tick(432, false, 0.6)) < 1e-6, 'Release cannot jump back to legacy animation')
  f.tick(848)
  assert.ok(f.bone.quaternion.angleTo(idle) < 1e-6)
  assert.equal(f.bone.position.z, 0)
  assert.equal(f.transition.getDiagnostics().handoffs, 2)
  f.transition.dispose()
  assert.equal(f.mixer.update, f.original)
})

test('mid-transition interruption continues from visible pose and steady speech is not resmoothed', () => {
  const f = fixture()
  f.tick(0)
  f.tick(16, true, -0.3)
  const before = f.tick(96)
  assert.ok(before.angleTo(f.tick(112, false, 0.5)) < 1e-6)
  f.tick(512)
  f.tick(528, true, -0.2)
  f.tick(928)
  const current = f.tick(944, true, -0.1)
  assert.ok(current.angleTo(new Quaternion().setFromEuler(new Euler(0, -0.1, 0))) < 1e-6)
  assert.equal(f.bone.position.z, 0.1)
  f.transition.dispose()
})

test('handoffs between two native owners still blend while steady speech keeps its timing', () => {
  const f = fixture()
  const idle = f.tick(0, 'ambient')
  assert.ok(idle.angleTo(f.tick(16, 'speech', -0.3)) < 1e-6)
  f.tick(416, 'speech', -0.3)
  const spoken = f.tick(432, 'speech', -0.1)
  assert.ok(spoken.angleTo(new Quaternion().setFromEuler(new Euler(0, -0.1, 0))) < 1e-6)
  assert.ok(spoken.angleTo(f.tick(448, 'ambient', 0.5)) < 1e-6)
  assert.equal(f.transition.getDiagnostics().handoffs, 3)
  f.transition.dispose()
})
