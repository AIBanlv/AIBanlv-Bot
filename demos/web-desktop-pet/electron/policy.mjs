import { names } from '../src/expression.mjs'
import { pipeline } from '../src/control.mjs'

export function petSize(width) {
  if (!Number.isInteger(width) || width < 240 || width > 440) throw new Error('Invalid pet size')
  return { width, height: 120 + Math.round(width * 1.05) + 56 }
}

export function constrainBounds(bounds, area) {
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height)
  return { width, height,
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))) }
}

export function hitPet(x, y, width) {
  const avatarHeight = Math.round(width * 1.05)
  const insideFigure = ((x - width / 2) / (width * 0.43)) ** 2 +
    ((y - 120 - avatarHeight / 2) / (avatarHeight * 0.49)) ** 2 <= 1
  const insideTools = Math.abs(x - width / 2) <= 85 && y >= 120 + avatarHeight + 8 &&
    y <= 120 + avatarHeight + 48
  return insideFigure || insideTools
}

export function trustedSender(event, window, url) {
  return Boolean(window && !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === url)
}

export function validRelay(data) {
  if (!data || typeof data !== 'object') return false
  if (data.type === 'caption') return typeof data.text === 'string' && [...data.text].length <= 32 &&
    typeof data.label === 'string' && data.label.length <= 40
  if (data.type !== 'expression' || typeof data.speaking !== 'boolean' ||
      !['raw', pipeline].includes(data.pipeline) || !data.weights ||
      typeof data.weights !== 'object' || Array.isArray(data.weights)) return false
  if (Object.entries(data.weights).some(([key, value]) => !names.includes(key) ||
      !Number.isFinite(value) || value < 0 || value > 1)) return false
  if (data.pipeline === 'raw') return data.pose === null
  return data.pose?.version === 1 && data.pose.owned === true &&
    ['pitch', 'yaw', 'roll', 'gazeX', 'gazeY', 'depth'].every((key) =>
      Number.isFinite(data.pose[key]) && Math.abs(data.pose[key]) <= 1)
}
