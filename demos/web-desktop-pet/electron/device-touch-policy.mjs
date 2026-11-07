// Control's touch-interaction.js thresholds and AvatarTouchPolicy face map.
export const touchGestures = new Set(['TAP', 'DOUBLE_TAP', 'LONG_PRESS', 'SWIPE_LEFT',
  'SWIPE_RIGHT', 'SWIPE_UP', 'SWIPE_DOWN', 'GENTLE_STROKE'])

export function classifyTouch(m) {
  if (!m || m.duration < 0 || m.samples < 2) return 'UNKNOWN'
  if (m.duration <= 260 && m.path <= 14 && m.excursion <= 14) return 'TAP'
  if (m.duration >= 650 && m.excursion <= 18 && m.path <= 36) return 'LONG_PRESS'
  if (m.distance >= 28 && m.duration <= 900 && m.speed >= 55 && m.distance / Math.max(1, m.path) >= 0.62) {
    return Math.abs(m.dx) >= Math.abs(m.dy) ? m.dx < 0 ? 'SWIPE_LEFT' : 'SWIPE_RIGHT' : m.dy < 0 ? 'SWIPE_UP' : 'SWIPE_DOWN'
  }
  if (m.duration >= 220 && m.path >= 22 && m.speed <= 550) return 'GENTLE_STROKE'
  return 'UNKNOWN'
}

const regions = { forehead: '额头', chin: '下巴', right_cheek: '右脸颊', left_cheek: '左脸颊', nose: '鼻尖' }
const region = ({ x, y }) => y < 0.35 ? 'forehead' : y > 0.65 ? 'chin' : x < 0.4 ? 'right_cheek' : x > 0.6 ? 'left_cheek' : 'nose'
const point = p => p && !Array.isArray(p) && [p.x, p.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)
const identifier = id => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,96}$/.test(id)

export function touchObservation(event, now = Date.now()) {
  if (!event || !identifier(event.event_id) || !identifier(event.interaction_id) ||
      !touchGestures.has(event.gesture_type) || !point(event.start_position) || !point(event.end_position) ||
      !Number.isFinite(event.timestamp) || Math.abs(now - event.timestamp) > 60000 ||
      ![event.duration, event.movement_distance, event.movement_speed].every(n => Number.isFinite(n) && n >= 0 && n <= 120000) ||
      !['none', 'left', 'right', 'up', 'down'].includes(event.movement_direction)) return null
  const from = region(event.start_position), to = region(event.end_position)
  const start = regions[from], end = regions[to], gesture = event.gesture_type
  const direction = ({ SWIPE_LEFT: 'left', SWIPE_RIGHT: 'right', SWIPE_UP: 'up', SWIPE_DOWN: 'down' })[gesture] || event.movement_direction
  const path = ({ left: '向你自身右侧', right: '向你自身左侧', up: '从下往上', down: '从上往下', none: '缓缓地' })[direction]
  let description, displayText
  if (gesture === 'TAP') {
    description = `用户轻轻点了点你的${end}`; displayText = `轻点数字人的${end}`
  } else if (gesture === 'DOUBLE_TAP') {
    description = `用户轻轻连续点了两下你的${end}`; displayText = `连续点了两下数字人的${end}`
  } else if (gesture === 'LONG_PRESS') {
    description = `用户轻轻停留触碰你的${end}`; displayText = `停留触碰数字人的${end}`
  } else {
    description = `用户${path}温柔地从你的${start}抚过${end}`
    displayText = `从数字人的${start}抚过${end}`
  }
  return { eventId: event.event_id, gesture, region: to, fromRegion: from, direction,
    description, displayText, perspective: 'character_own_sides' }
}
