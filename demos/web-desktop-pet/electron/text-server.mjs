import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const control = path.resolve(root, '../..')
export function resolveTextFiles() {
  const files = new Map()
  for (const name of ['avatar.html', 'src/style.css', 'src/avatar.mjs', 'src/avatar-quality.mjs', 'src/expression.mjs', 'src/control.mjs', 'src/text-motion.mjs']) {
    files.set(`/${name}`, path.join(root, name))
  }
  for (const name of ['pet.html', 'pet.mjs', 'desktop.css', 'text-controller.html', 'text-controller.mjs']) {
    const route = name.replace('text-controller', 'controller')
    files.set(`/desktop/${route}`, path.join(root, 'electron', name))
  }
  files.set('/assets/avatar.zip', path.resolve(control, '../android-framework-new/photo/benny-avatar.zip'))
  files.set('/vendor/lam.js', path.join(control, 'android-native/renderer/tools/ali-native-shell-ui/node_modules/gaussian-splat-renderer-for-lam/build/gaussian-splat-renderer-for-lam.module.js'))
  files.set('/vendor/uniicons.ttf', path.join(control, 'node_modules/@dcloudio/uni-ui/lib/uni-icons/uniicons.ttf'))
  for (const name of ['tools/ali-native-shell-ui/src/presentation-pose.js', 'lam-renderer-rewrite/src/skeleton/presentation-pose.js', 'lam-renderer-rewrite/src/skeleton/skeleton-math.js']) {
    files.set(`/control/renderer/${name}`, path.join(control, 'android-native/renderer', name))
  }
  return files
}

export function createTextServer(files, { accessToken, microphone = false }) {
  return createServer(async (request, response) => {
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.host || '') || request.headers['x-pet-token'] !== accessToken) {
      response.writeHead(403).end('Private desktop session'); return
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return }
    let pathname
    try { pathname = new URL(request.url, 'http://localhost').pathname } catch { response.writeHead(400).end(); return }
    const file = files.get(pathname)
    if (!file) { response.writeHead(pathname === '/favicon.ico' ? 204 : 404).end(); return }
    try {
      const info = await stat(file)
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.zip': 'application/zip' }
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': info.size,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': `microphone=${microphone && pathname === '/device/device-pet.html' ? '(self)' : '()'}, camera=(), geolocation=()`,
        'Content-Security-Policy': `default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:${pathname === '/device/device.html' ? ' https://zhanlvgpt.ieasysell.com https://qn.ieasysell.com https://scrm.ieasysell.com' : ''}; connect-src 'self' blob:; worker-src 'self' blob:; media-src ${pathname === '/device/device.html' ? 'blob: https://zhanlvgpt.ieasysell.com' : "'none'"}; frame-ancestors 'self'; object-src 'none'; base-uri 'none'`,
      })
      if (request.method === 'HEAD') { response.end(); return }
      const stream = createReadStream(file)
      stream.on('error', () => response.destroy())
      response.on('close', () => stream.destroy())
      stream.pipe(response)
    } catch { response.writeHead(404).end('Resource unavailable') }
  })
}
