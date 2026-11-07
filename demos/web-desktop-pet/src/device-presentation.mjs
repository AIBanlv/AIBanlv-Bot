// Blend only ownership handoffs; steady LAM samples retain their audio timing.
export function installDevicePoseTransition(renderer, names, isControlled, now = () => performance.now()) {
  const skeleton = renderer.viewer?.skinModel?.skeleton || renderer.viewer?.avatarMesh?.skeleton
  const mixer = renderer.mixer
  const bindings = (skeleton?.bones || []).filter(bone => names.includes(bone.name)).map(bone => ({
    bone, targetQ: bone.quaternion.clone(), targetP: bone.position.clone(),
    shownQ: bone.quaternion.clone(), shownP: bone.position.clone(),
    fromQ: bone.quaternion.clone(), fromP: bone.position.clone(),
  }))
  const update = mixer?.update
  if (!update || !bindings.length) return { dispose() {}, getDiagnostics: () => ({ handoffs: 0 }) }
  let controlled = isControlled(), started = -Infinity, sampled = false, handoffs = 0, maximumStep = 0
  const refresh = () => {
    for (const { bone } of bindings) bone.updateWorldMatrix(true, true)
    skeleton.update()
  }
  const wrapped = function (...args) {
    // Do not feed a blended output back into the underlying mixer or pose adapter.
    if (sampled) for (const b of bindings) {
      b.bone.quaternion.copy(b.targetQ); b.bone.position.copy(b.targetP)
    }
    const result = update.apply(this, args)
    const time = now(), next = isControlled()
    if (next !== controlled) {
      controlled = next; started = time; handoffs++
      for (const b of bindings) { b.fromQ.copy(b.shownQ); b.fromP.copy(b.shownP) }
    }
    const progress = Math.min(1, Math.max(0, (time - started) / 350))
    const blend = progress * progress * (3 - 2 * progress)
    for (const b of bindings) {
      b.targetQ.copy(b.bone.quaternion); b.targetP.copy(b.bone.position)
      if (progress < 1) {
        b.bone.quaternion.slerpQuaternions(b.fromQ, b.targetQ, blend)
        b.bone.position.lerpVectors(b.fromP, b.targetP, blend)
        maximumStep = Math.max(maximumStep, b.shownQ.angleTo(b.bone.quaternion))
      }
      b.shownQ.copy(b.bone.quaternion); b.shownP.copy(b.bone.position)
    }
    sampled = true
    refresh()
    return result
  }
  mixer.update = wrapped
  return {
    getDiagnostics: () => ({ handoffs, transitionMaxRadians: maximumStep, transitioning: now() - started < 350,
      mixerHookActive: mixer.update === wrapped }),
    dispose() {
      if (mixer.update === wrapped) mixer.update = update
      for (const b of bindings) { b.bone.quaternion.copy(b.targetQ); b.bone.position.copy(b.targetP) }
      refresh()
    },
  }
}
