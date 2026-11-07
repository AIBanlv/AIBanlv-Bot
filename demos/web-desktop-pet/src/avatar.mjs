import { names } from './expression.mjs'
import { pipeline } from './control.mjs'
import { avatarPixelRatio } from './avatar-quality.mjs'
import { installThreePresentationPose } from '/control/renderer/tools/ali-native-shell-ui/src/presentation-pose.js'

const channel = 'control-desktop-pet-v1'
const stage = document.querySelector('#avatar-stage')
const deviceAvatar = new URLSearchParams(location.search).get('asset')?.startsWith('/assets/device-')
let renderer
let ready = false
let paused = false
let failed = false
let weights = {}
let speaking = false
let receivedAt = 0
let pose = null
let poseController
let poseTransition
let controlled = false
let particlesRequested = false
let disposeParticleSampling
let idleExpressions
let qualityTier = new URLSearchParams(location.search).get('quality') || 'balanced'
let appliedRatio = 0
let idleStatus = 'disabled'
let expressionSource = ''
let presentedWeights
const idleAbort = new AbortController()
const poseKeys = ['pitch', 'yaw', 'roll', 'gazeX', 'gazeY', 'depth']
const controlActive = () => controlled && performance.now() - receivedAt < 300
const presentationOwner = () => !controlActive() ? 'idle' : speaking ? 'speech'
  : ['ambient', 'gaze', 'mood'].includes(expressionSource) ? 'ambient' : 'touch'
let resolveLoaded
const loaded = new Promise((resolve) => { resolveLoaded = resolve })

function send(type, detail = {}) {
  window.parent.postMessage({ channel, type, ...detail }, window.location.origin)
}

function fail() {
  if (failed) return
  failed = true
  renderer?.viewer?.stop()
  send('error', { text: '形象加载失败，请检查资源后重试' })
}

function syncPaused() {
  idleExpressions?.pause()
  if (!ready || !renderer || failed) return
  if (paused || document.hidden) renderer.viewer.stop()
  else if (!renderer.viewer.selfDrivenModeRunning) {
    renderer.clock.getDelta()
    renderer.render()
  }
}

function resize() {
  if (!renderer?.viewer) return
  const { width, height } = stage.getBoundingClientRect()
  if (!width || !height) return
  const camera = renderer.getCamera()
  camera.aspect = width / height
  // The portrait canvas covers the whole window; keep the figure inside it
  // instead of filling the width and cropping the shoulders.
  camera.zoom = Math.min(deviceAvatar ? 1.1 : 2, 2 * height / width / 1.05)
  camera.updateProjectionMatrix()
  const ratio = avatarPixelRatio(qualityTier, window.devicePixelRatio)
  if (ratio !== appliedRatio) {
    renderer.viewer.renderer.setPixelRatio(ratio)
    renderer.viewer.devicePixelRatio = ratio
    if (renderer.viewer.splatMesh) renderer.viewer.splatMesh.devicePixelRatio = ratio
    appliedRatio = ratio
  }
  stage.dataset.quality = qualityTier
  stage.dataset.pixelRatio = String(ratio)
  renderer.viewer.renderer.setSize(width, height)
  renderer.viewer.forceRenderNextFrame()
}

function waitForVisibleFrame(context) {
  return new Promise((resolve, reject) => {
    const inspect = () => {
      if (failed) { reject(new Error('Avatar first frame timed out')); return }
      if (renderer.viewer.splatRenderReady) {
        const data = new Uint8Array(context.drawingBufferWidth * context.drawingBufferHeight * 4)
        context.readPixels(0, 0, context.drawingBufferWidth, context.drawingBufferHeight, context.RGBA, context.UNSIGNED_BYTE, data)
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 10) { resolve(); return }
        }
      }
      requestAnimationFrame(inspect)
    }
    requestAnimationFrame(inspect)
  })
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.origin !== location.origin || event.data?.channel !== channel) return
  if (event.data.type === 'quality' && event.data.tier !== qualityTier && ['low', 'balanced', 'high'].includes(event.data.tier)) {
    qualityTier = event.data.tier
    resize()
  }
  if (event.data.type === 'particle-sampling' && typeof event.data.enabled === 'boolean') particlesRequested = event.data.enabled
  if (event.data.type === 'pause' && typeof event.data.paused === 'boolean') {
    paused = event.data.paused
    syncPaused()
  }
  if (event.data.type === 'expression' && typeof event.data.speaking === 'boolean') {
    const value = event.data.weights
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    if (Object.entries(value).some(([name, weight]) => !names.includes(name) ||
        !Number.isFinite(weight) || weight < 0 || weight > 1)) return
    weights = value
    expressionSource = ['gaze', 'ambient', 'mood'].includes(event.data.source) ? event.data.source : ''
    const nextPose = event.data.pose
    controlled = event.data.pipeline === pipeline && nextPose?.version === 1 && nextPose.owned === true &&
      poseKeys.every((key) => Number.isFinite(nextPose[key]) && Math.abs(nextPose[key]) <= 1)
    pose = controlled ? nextPose : null
    speaking = event.data.speaking
    receivedAt = performance.now()
  }
})
document.addEventListener('visibilitychange', syncPaused)
window.addEventListener('error', fail)
window.addEventListener('unhandledrejection', fail)
window.addEventListener('pagehide', () => { idleAbort.abort(); idleExpressions = null; disposeParticleSampling?.(); poseTransition?.dispose(); poseController?.dispose(); renderer?.dispose() }, { once: true })

async function start() {
  const timeout = setTimeout(fail, 45000)
  try {
    const asset = new URLSearchParams(location.search).get('asset') || '/assets/avatar.zip'
    if (asset !== '/assets/avatar.zip' && !/^\/assets\/device-[a-f0-9-]{36}\.zip$/.test(asset)) {
      throw new Error('Invalid avatar asset')
    }
    if (asset.startsWith('/assets/device-')) {
      idleStatus = 'loading'
      // Existing local captures load alongside the avatar, independently of LAM/cloud warmup.
      void Promise.all([import('./device-idle.mjs'), fetch('/assets/idle-expressions.json', { signal: idleAbort.signal })
        .then(response => { if (!response.ok) throw new Error('Idle library unavailable'); return response.json() })])
        .then(([{ IdleExpressions }, library]) => {
          if (idleAbort.signal.aborted) return
          idleExpressions = new IdleExpressions(library)
          idleStatus = 'ready'
        }).catch(() => { idleStatus = 'unavailable' })
    }
    const { GaussianSplatRenderer } = await import('/vendor/lam.js')
    // The shared canvas must acquire an alpha context BEFORE Three.js uses it.
    const context = GaussianSplatRenderer._canvas.getContext('webgl2', { alpha: true, antialias: false })
    if (!context?.getContextAttributes()?.alpha) throw new Error('Transparent WebGL2 unavailable')
    renderer = await GaussianSplatRenderer.getInstance(stage, asset, {
      getChatState: () => speaking && performance.now() - receivedAt < 300 ? 'Responding' : 'Idle',
      getExpressionData: () => {
        const expression = renderer?.updateBS(null) || {}
        const current = speaking && performance.now() - receivedAt > 300 ? {} : weights
        if (idleExpressions) {
          const active = controlActive() || speaking && performance.now() - receivedAt < 300
          const owner = !active || !speaking && expressionSource === 'ambient' ? 'idle'
            : !speaking && expressionSource === 'gaze' ? 'gaze' : 'foreground'
          presentedWeights = idleExpressions.sample(performance.now(), {
            owner, weights: current,
          })
          return presentedWeights
        }
        if (controlActive()) return { ...current }
        const time = performance.now() % 4800
        const blink = time < 180 ? Math.sin(time / 180 * Math.PI) : 0
        return { ...expression, ...current,
          eyeBlinkLeft: Math.max(current.eyeBlinkLeft || 0, blink),
          eyeBlinkRight: Math.max(current.eyeBlinkRight || 0, blink) }
      },
      downloadProgress: (value) => send('loading', { text: `读取形象 ${Math.round(value * 100)}%` }),
      loadProgress: (value) => {
        if (value === 1) resolveLoaded()
        else send('loading', { text: `准备画面 ${Math.round(value * 100)}%` })
      },
    })
    if (!renderer) throw new Error('Renderer initialization failed')
    renderer.viewer.renderer.setClearColor(0x000000, 0)
    renderer.viewer.threeScene.background = null
    renderer.viewer.controls && (renderer.viewer.controls.enabled = false)
    await loaded
    if (failed) { renderer.dispose(); return }
    resize()
    poseController = installThreePresentationPose(renderer, {
      channelNames: names,
      isNativePresentationActive: controlActive,
      getNativePresentationValues: () => controlActive() ? names.map((name) => (idleExpressions ? presentedWeights : weights)?.[name] || 0) : null,
      getPresentationPoseV1: () => controlActive() ? pose : null,
    })
    if (asset.startsWith('/assets/device-')) {
      const { installDevicePoseTransition } = await import('./device-presentation.mjs')
      poseTransition = installDevicePoseTransition(renderer, poseController.getDiagnostics().controlledBones, presentationOwner)
      const { avatarBottomEdge } = await import('./device-particles.mjs')
      const sample = document.createElement('canvas')
      sample.width = sample.height = 96
      const reader = sample.getContext('2d', { willReadFrequently: true })
      const original = renderer.viewer.render
      let lastSample = -Infinity
      // Sample immediately after drawing: WebGL clears its non-preserved buffer
      // before another window's animation callback can read it.
      renderer.viewer.render = function (...args) {
        const result = original.apply(this, args)
        const now = performance.now()
        if (reader && particlesRequested && !document.hidden && now - lastSample >= 250) {
          lastSample = now
          reader.clearRect(0, 0, 96, 96)
          reader.drawImage(context.canvas, 0, 0, 96, 96)
          const edge = avatarBottomEdge(reader.getImageData(0, 0, 96, 96).data, 96, 96)
          if (edge) send('avatar-edge', { edge })
        }
        return result
      }
      disposeParticleSampling = () => { renderer.viewer.render = original }
    }
    // The existing adapter exposes diagnostics without reaching into private rig state.
    const diagnostics = setInterval(() => {
      stage.dataset.poseDiagnostics = JSON.stringify({ ...poseController.getDiagnostics(),
        idle: { status: idleStatus, ...idleExpressions?.diagnostics() },
        ...poseTransition?.getDiagnostics(), face: Object.fromEntries(
          ['browInnerUp', 'browOuterUpLeft', 'eyeWideLeft', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight'].map(name => [name, renderer.expressionData?.[name] || 0])) })
    }, 200)
    window.addEventListener('pagehide', () => clearInterval(diagnostics), { once: true })
    await waitForVisibleFrame(context)
    ready = true
    new ResizeObserver(resize).observe(stage)
    syncPaused()
    send('ready')
  } catch (error) {
    console.error('[desktop-pet]', error.message)
    fail()
  } finally {
    clearTimeout(timeout)
  }
}

start()
