// Explicit snapshot of Control's immersive-background.js particle palette/path.
// Desktop adapter: particles emerge from the actual alpha silhouette, opt-in lifecycle.
export function avatarBottomEdge(data, width, height) {
  const bottoms = Array(width).fill(null)
  let left = width, right = 0
  for (let x = 0; x < width; x++) {
    for (let y = height - 1; y >= 0; y--) {
      if (data[(y * width + x) * 4 + 3] < 32) continue
      bottoms[x] = (y + 1) / height
      left = Math.min(left, x); right = Math.max(right, x + 1)
      break
    }
  }
  return right > left ? { left: left / width, right: right / width, bottoms } : null
}

export function createDeviceParticles({ canvas, getFootprint, window = globalThis.window, document = globalThis.document }) {
  const context = canvas.getContext('2d')
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 32
  const brush = sprite.getContext('2d')
  if (brush) {
    const glow = brush.createRadialGradient(16, 16, 0, 16, 16, 16)
    glow.addColorStop(0, 'rgba(255,249,244,1)')
    glow.addColorStop(0.24, 'rgba(255,230,219,.82)')
    glow.addColorStop(1, 'rgba(225,146,132,0)')
    brush.fillStyle = glow; brush.beginPath(); brush.arc(16, 16, 16, 0, Math.PI * 2); brush.fill()
  }
  let width = 1, height = 1, particles = [], frame = 0, last = null, disposed = false, pageVisible = true
  let state = { enabled: false, visible: false, ready: false }
  let silhouette = null
  function bottomAt(x) {
    if (!silhouette) return height * 0.65
    const index = Math.max(0, Math.min(95, Math.floor(x / width * 96)))
    return (silhouette.top || 0) + (silhouette.bottoms[index] ??
      Math.max(...silhouette.bottoms.filter(value => value !== null))) * silhouette.height
  }
  const active = () => !disposed && context && brush && state.enabled && state.visible && state.ready && !document.hidden && pageVisible
  function clear() { context?.clearRect(0, 0, width, height) }
  function render(now, advance = false) {
    clear()
    if (getFootprint) {
      if (!media?.matches || !silhouette) silhouette = getFootprint()
      canvas.dataset.anchored = String(Boolean(silhouette))
      if (!silhouette) return
    }
    if (media?.matches) now = 0
    const seconds = now * 0.001
    const delta = advance ? (last === null ? 1 / 30 : Math.min(0.08, (now - last) * 0.001)) : 0
    for (const p of particles) {
      p.y += p.speed * delta
      if (p.y > 1) { p.y -= 1; p.x = Math.random() - 0.5 }
      const remaining = 1 - p.y
      const convergence = 0.07 + Math.pow(remaining, 1.3) * 0.93
      const left = (silhouette?.left ?? 0.1) * width, right = (silhouette?.right ?? 0.9) * width
      const center = (left + right) / 2
      const sourceX = center + p.x * (right - left) * 0.82
      const x = center + (sourceX - center) * convergence + Math.sin(seconds * 1.15 + p.phase) * 2
      const diameter = p.size * 4
      const sourceY = bottomAt(sourceX)
      const y = Math.max(bottomAt(x) + diameter / 2, sourceY + p.y * (height * 0.98 - sourceY))
      context.globalAlpha = Math.max(0, p.alpha * (0.62 + Math.sin(seconds * 2 + p.phase) * 0.24) * Math.sin(Math.PI * (0.1 + p.y * 0.9)))
      context.drawImage(sprite, x - diameter / 2, y - diameter / 2, diameter, diameter)
    }
    context.globalAlpha = 1
  }
  function stop() { window.cancelAnimationFrame(frame); frame = 0; last = null }
  function draw(now) {
    frame = 0
    if (!active() || media?.matches) return
    if (last === null || now - last >= 30) { render(now, true); last = now }
    frame = window.requestAnimationFrame(draw)
  }
  function sync() {
    stop()
    canvas.hidden = !active()
    clear()
    if (!active()) return
    render(window.performance.now())
    if (!media?.matches) frame = window.requestAnimationFrame(draw)
  }
  function resize() {
    if (disposed) return
    silhouette = null
    canvas.hidden = !active()
    if (!active()) { sync(); return }
    const bounds = canvas.getBoundingClientRect()
    width = Math.max(1, bounds.width); height = Math.max(1, bounds.height)
    const ratio = Math.min(1.5, Math.max(1, Number(window.devicePixelRatio) || 1))
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio)
    context?.setTransform(ratio, 0, 0, ratio, 0, 0)
    particles = Array.from({ length: Math.max(48, Math.min(72, Math.round(width / 5))) }, () => ({
      x: Math.random() - 0.5, y: Math.random(), size: 0.65 + Math.random() * 1.75,
      speed: 0.08 + Math.random() * 0.18, phase: Math.random() * Math.PI * 2, alpha: 0.28 + Math.random() * 0.62,
    }))
    sync()
  }
  function hide() { pageVisible = false; sync() }
  function show() { pageVisible = true; resize() }
  // Observe the parent: a hidden canvas has zero layout size.
  const observer = window.ResizeObserver ? new window.ResizeObserver(resize) : null
  observer?.observe(canvas.parentElement)
  window.addEventListener('resize', resize)
  window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show)
  document.addEventListener('visibilitychange', resize)
  media?.addEventListener('change', sync)
  resize()
  return {
    refresh() {
      if (active() && !(media?.matches && silhouette)) render(window.performance.now())
    },
    update(next) {
      if (disposed) return
      if (state.enabled === next.enabled && state.visible === next.visible && state.ready === next.ready) return
      state = next
      resize()
    },
    dispose() {
      if (disposed) return
      disposed = true; stop(); clear(); canvas.hidden = true
      observer?.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show)
      document.removeEventListener('visibilitychange', resize)
      media?.removeEventListener('change', sync)
    },
  }
}
