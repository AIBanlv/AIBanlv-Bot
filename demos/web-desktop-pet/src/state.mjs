export function constrain(position, size, viewport) {
  const axis = (value, dimension, available) => {
    const margin = Math.min(12, Math.max(0, (available - dimension) / 2))
    return Math.min(Math.max(Number.isFinite(value) ? value : margin, margin), Math.max(margin, available - dimension - margin))
  }
  return { x: axis(position.x, size.width, viewport.width), y: axis(position.y, size.height, viewport.height) }
}

export function dragged(start, current) {
  return Math.hypot(current.x - start.x, current.y - start.y) >= 6
}

export function splitCaptions(text) {
  return String(text).split(/\r?\n/).flatMap((line) => {
    const characters = Array.from(line.trim())
    const chunks = []
    for (let offset = 0; offset < characters.length; offset += 32) chunks.push(characters.slice(offset, offset + 32).join(''))
    return chunks
  })
}

export function captionAt(lines, elapsed, loop) {
  if (!lines.length) return { text: '', index: 0, ended: true }
  const step = Math.floor(Math.max(0, elapsed) / 4500)
  const index = loop ? step % lines.length : Math.min(step, lines.length - 1)
  return { text: lines[index], index, ended: !loop && step >= lines.length }
}
