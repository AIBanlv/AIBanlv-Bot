// Local microphone energy meter. It never records or uploads audio itself.
const clamp = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
const ratioOf = () => Math.min(2, globalThis.devicePixelRatio || 1)

export function installVoiceWaveform(container, canvas, { bars = 36, color = '#246749' } = {}) {
  const context = canvas.getContext('2d')
  const energy = new Float32Array(bars)
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
  let level = 0, active = false, frame = 0, previous = 0, width = 1, height = 1

  const resize = () => {
    const ratio = ratioOf()
    width = Math.max(1, canvas.clientWidth)
    height = Math.max(1, canvas.clientHeight)
    const backingWidth = Math.round(width * ratio), backingHeight = Math.round(height * ratio)
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth; canvas.height = backingHeight
    }
    return ratio
  }
  const paint = ratio => {
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    const gap = 3, barWidth = 2
    const total = bars * barWidth + (bars - 1) * gap
    const left = (width - total) / 2, middle = height / 2
    const maxHeight = Math.max(6, Math.min(18, height - 8))
    const gradient = context.createLinearGradient(left, 0, left + total, 0)
    gradient.addColorStop(0, color)
    gradient.addColorStop(0.55, '#4c9772')
    gradient.addColorStop(1, '#8fc9a9')
    context.fillStyle = gradient
    context.globalAlpha = 0.16
    context.fillRect(left, middle - 0.5, total, 1)
    for (let index = 0; index < bars; index++) {
      const value = energy[index]
      const barHeight = Math.max(1.5, value * maxHeight)
      context.globalAlpha = 0.32 + value * 0.62
      context.beginPath()
      context.roundRect(left + index * (barWidth + gap), middle - barHeight / 2, barWidth, barHeight, barWidth / 2)
      context.fill()
    }
    context.globalAlpha = 1
  }
  const advance = (time, delta) => {
    for (let index = 0; index < bars; index++) {
      // The phase spread keeps neighbouring bars from rising as one block.
      const wave = 0.35 + 0.65 * Math.abs(Math.sin(index * 1.7 + time / (260 + index * 9)))
      const goal = Math.max(level > 0.015 ? 0.06 : 0.015, level * wave)
      energy[index] += (goal - energy[index]) * Math.min(1, delta * 12)
    }
  }
  const staticBars = () => {
    for (let index = 0; index < bars; index++) {
      energy[index] = Math.max(0.015, level * (0.35 + 0.65 * Math.abs(Math.sin(index * 1.7))))
    }
  }
  const tick = time => {
    if (!active) return
    const delta = previous ? Math.min(0.05, (time - previous) / 1000) : 0.016
    previous = time
    advance(time, delta)
    paint(ratioOf())
    frame = requestAnimationFrame(tick)
  }
  const setActive = value => {
    const next = Boolean(value)
    container.hidden = !next
    if (next === active) return
    active = next
    cancelAnimationFrame(frame); frame = 0; previous = 0
    if (!active) {
      level = 0; energy.fill(0); canvas.dataset.level = '0'
      return
    }
    canvas.dataset.level = level.toFixed(3)
    const ratio = resize()
    if (reduced?.matches) { staticBars(); paint(ratio) }
    else frame = requestAnimationFrame(tick)
  }
  const setLevel = value => {
    level = clamp(value)
    canvas.dataset.level = level.toFixed(3)
    if (!active) return
    if (reduced?.matches) { const ratio = resize(); staticBars(); paint(ratio) }
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (!active || !reduced?.matches) return
    staticBars(); paint(resize())
  }) : null
  observer?.observe(canvas)
  container.hidden = true
  return {
    level: setLevel,
    setActive,
    dispose() { setActive(false); observer?.disconnect() },
  }
}
