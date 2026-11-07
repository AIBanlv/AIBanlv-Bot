const PIPELINE = 'ios-expression-v1-2e75b5f'
const STATES = new Set(['speaking', 'idle', 'listening', 'closing'])
const POSE_COMPONENTS = ['pitch', 'yaw', 'roll', 'gazeX', 'gazeY', 'depth']

function validPresentation(value) {
  return value?.version === 1 && Number.isSafeInteger(value.generation)
    && value.generation >= 0 && value.pipeline === PIPELINE
    && STATES.has(value.state) && typeof value.clip === 'string'
    && Array.isArray(value.frame) && value.frame.length === 52
    && value.frame.every((number) => Number.isFinite(number) && Number.isFinite(Math.fround(number)))
    && value.pose?.version === 1 && value.pose.owned === true
    && POSE_COMPONENTS.every((key) => Number.isFinite(value.pose[key]) && Math.abs(value.pose[key]) <= 1)
}

// Only an explicit disabled response selects legacy. Bad packets cannot revive it.
export function createNativePresentationReader() {
  const frame = new Float32Array(52)
  let generation = -1
  let accepted = null
  let active = false
  return {
    sample() {
      let raw
      try {
        const host = globalThis.lamNativeAudio
        raw = typeof host?.samplePresentationV1 === 'function' ? host.samplePresentationV1() : ''
      } catch {
        raw = null
      }
      if (raw === '') {
        active = false
        accepted = null
        frame.fill(0)
        return null
      }
      active = true
      try {
        const value = typeof raw === 'string' ? JSON.parse(raw) : null
        if (validPresentation(value) && value.generation >= generation) {
          generation = value.generation
          frame.set(value.frame)
          accepted = Object.freeze({ version: 1, generation, frame,
            pose: Object.freeze({ ...value.pose }), state: value.state,
            clip: value.clip, pipeline: value.pipeline })
        }
      } catch {
        // Retain the last coherent face/pose pair until the provider recovers.
      }
      return frame
    },
    get active() { return active },
    get accepted() { return accepted },
    get frame() { return frame },
  }
}
import {
  isOwnedPresentationPose,
  presentationBoneBindings,
} from '../../../lam-renderer-rewrite/src/skeleton/presentation-pose.js'


function namedNativeFrame(bridge, output, rigScale) {
  const frame = bridge.getNativePresentationValues?.()
  if (!frame) return null
  for (let i = 0; i < bridge.channelNames.length; i++) {
    const name = bridge.channelNames[i]
    const scale = rigScale?.[name]
    // Keep the rig's mouth reductions, but do not add its enlargement to native speech.
    output[name] = (name === 'jawOpen' || name.startsWith('mouth'))
      && Number.isFinite(scale) && scale >= 0 && scale < 1 ? frame[i] * scale : frame[i]
  }
  return output
}

// LocalExpressionSource may neutralize a paused native frame. Keep its legacy
// path, but return the accepted native sample without pulling the host twice.
export function withPresentationSampling(options, bridge, afterSample = () => {}) {
  const named = {}
  return { ...options,
    getExpressionData() {
      const legacy = options.getExpressionData?.()
      const result = namedNativeFrame(bridge, named) ?? legacy
      afterSample()
      return result
    },
    getPresentationPoseV1: () => bridge.getPresentationPoseV1?.() ?? null,
  }
}

function bindRotation(bone, skeleton) {
  const index = skeleton?.bones.indexOf(bone) ?? -1
  const inverse = skeleton?.boneInverses?.[index]
  if (!inverse) return bone.rotation.clone()
  const local = inverse.clone().invert()
  const parentIndex = skeleton.bones.indexOf(bone.parent)
  const parentInverse = parentIndex >= 0 ? skeleton.boneInverses[parentIndex]
    : bone.parent?.matrixWorld?.clone().invert()
  if (parentInverse) local.premultiply(parentInverse)
  const quaternion = bone.quaternion.clone()
  local.decompose(bone.position.clone(), quaternion, bone.scale.clone())
  return bone.rotation.clone().setFromQuaternion(quaternion, bone.rotation.order)
}

export function installThreePresentationPose(renderer, bridge) {
  let mixer = null, skeleton = null, undoMixer = null, disposed = false
  let installedUpdate = null, poseSnapshot = null
  const diagnostics = { installed: false, reason: 'renderer-or-mixer-not-ready', depthApplied: false }
  const named = {}
  const setExpression = renderer.setExpression
  const updateBS = renderer.updateBS
  const wrappedSet = function (...args) {
    if (bridge.isNativePresentationActive?.()) {
      this.expressionData = namedNativeFrame(bridge, named, this.motioncfg?.scale)
        ?? this.expressionData
    }
    return setExpression.apply(this, args)
  }
  const wrappedBS = function (frame, ...args) {
    return bridge.isNativePresentationActive?.() ? frame : updateBS.call(this, frame, ...args)
  }
  if (typeof setExpression === 'function') renderer.setExpression = wrappedSet
  if (typeof updateBS === 'function') renderer.updateBS = wrappedBS

  const controller = {
    diagnostics,
    getDiagnostics() {
      return {
        ...diagnostics,
        installed: !disposed && diagnostics.installed,
        reason: disposed ? 'disposed' : diagnostics.reason,
        mixerHookActive: Boolean(!disposed && installedUpdate
          && renderer.mixer === mixer && mixer.update === installedUpdate),
        controlledBones: [...(diagnostics.controlledBones || [])],
        ...(poseSnapshot?.() ?? { poseApplied: false, appliedBoneAngles: [] }),
      }
    },
    sync() {
      if (disposed) return
      const viewer = renderer.viewer
      const nextSkeleton = viewer?.skinModel?.skeleton || viewer?.avatarMesh?.skeleton
      if (mixer === renderer.mixer && skeleton === nextSkeleton && undoMixer) return
      undoMixer?.()
      undoMixer = null
      installedUpdate = null
      poseSnapshot = null
      diagnostics.depthApplied = false
      diagnostics.controlledBones = []
      mixer = renderer.mixer
      skeleton = nextSkeleton
      if (!mixer?.update || !viewer || viewer.useFlame === true) {
        diagnostics.installed = false
        diagnostics.reason = viewer?.useFlame ? 'flame-rig-not-supported' : 'renderer-or-mixer-not-ready'
        return
      }
      const candidates = []
      const add = (bone) => { if (bone?.isBone && bone.rotation && !candidates.includes(bone)) candidates.push(bone) }
      skeleton?.bones.forEach(add)
      for (const root of [viewer.boneRoot, mixer.getRoot?.(), viewer.avatarMesh]) root?.traverse?.(add)
      const bindings = presentationBoneBindings(candidates.map((bone) => bone.name)).map((binding) => {
        const bone = candidates[binding.index]
        return { ...binding, bone, rest: bindRotation(bone, skeleton),
          rotation: bone.rotation.clone(), position: bone.position.clone() }
      })
      if (!bindings.length) {
        diagnostics.installed = false
        diagnostics.reason = 'head-bone-not-found'
        return
      }
      const controlled = bindings.filter((binding) => binding.stabilize)
      const depthBone = controlled.find(({ bone, role }) => role === 'neck'
        && !controlled.some((other) => other.bone === bone.parent))?.bone
        || controlled.find((binding) => binding.role === 'head').bone
      const neckLength = controlled.reduce((sum, binding) => sum + binding.bone.position.length(), 0)
      const direction = depthBone.position.clone()
      const parentInverse = depthBone.matrixWorld.clone()
      const roots = candidates.filter((bone) => !candidates.includes(bone.parent))
      let applied = false
      const refresh = () => {
        for (const root of roots) root.updateWorldMatrix(true, true)
        skeleton?.update()
      }
      const restore = () => {
        if (!applied) return
        for (const binding of bindings) {
          binding.bone.rotation.copy(binding.rotation)
          binding.bone.position.copy(binding.position)
        }
        applied = false
      }
      const targetMixer = mixer, update = mixer.update
      const wrapped = function (...args) {
        restore()
        const result = update.apply(this, args)
        const pose = bridge.getPresentationPoseV1?.()
        diagnostics.depthApplied = false
        if (isOwnedPresentationPose(pose)) {
          for (const binding of bindings) {
            const { bone, rest, gains, stabilize } = binding
            binding.rotation.copy(bone.rotation)
            binding.position.copy(bone.position)
            if (stabilize) bone.rotation.copy(rest)
            bone.rotation.x += pose.pitch * gains[0]
            bone.rotation.y += pose.yaw * gains[1]
            bone.rotation.z += pose.roll * gains[2]
          }
          applied = true
          const camera = renderer.getCamera?.()
          if (pose.depth !== 0 && neckLength > 0 && depthBone.parent && camera?.getWorldDirection) {
            depthBone.parent.updateWorldMatrix(true, false)
            camera.getWorldDirection(direction).negate()
            parentInverse.copy(depthBone.parent.matrixWorld).invert()
            direction.transformDirection(parentInverse)
            depthBone.position.addScaledVector(direction, pose.depth * neckLength * 0.10)
            diagnostics.depthApplied = true
          }
        }
        // The bundled viewer copies skeleton matrices before its own world update.
        refresh()
        return result
      }
      targetMixer.update = wrapped
      installedUpdate = wrapped
      // Read current local Euler angles (radians) only on a diagnostic request.
      poseSnapshot = () => ({
        poseApplied: applied,
        appliedBoneAngles: bindings.map(({ bone, role }) => ({
          name: bone.name, role, x: bone.rotation.x, y: bone.rotation.y,
          z: bone.rotation.z, order: bone.rotation.order,
        })),
      })
      undoMixer = () => {
        restore()
        refresh()
        if (targetMixer.update === wrapped) targetMixer.update = update
      }
      diagnostics.installed = true
      diagnostics.reason = 'ok'
      diagnostics.controlledBones = bindings.map((binding) => binding.bone.name)
    },
    dispose() {
      if (disposed) return
      disposed = true
      undoMixer?.()
      if (renderer.setExpression === wrappedSet) renderer.setExpression = setExpression
      if (renderer.updateBS === wrappedBS) renderer.updateBS = updateBS
    },
  }
  controller.sync()
  return controller
}
