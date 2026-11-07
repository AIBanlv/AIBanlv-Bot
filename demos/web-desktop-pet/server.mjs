import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPreviewHandler } from './scripts/preview-service.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const control = path.resolve(root, '../..')
const rendererRoot = path.join(control, 'android-native/renderer/tools/ali-native-shell-ui')
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.zip': 'application/zip', '.ttf': 'font/ttf', '.wav': 'audio/wav', '.json': 'application/json; charset=utf-8',
}

export function resolveDemoFiles({ avatarPath = process.env.PET_AVATAR_ZIP } = {}) {
  const files = new Map()
  for (const file of ['index.html', 'avatar.html', 'src/host.mjs', 'src/avatar.mjs', 'src/state.mjs', 'src/style.css', 'src/speech.mjs', 'src/preview.mjs', 'src/expression.mjs', 'src/control.mjs', 'assets/speech.wav', 'assets/speech.json', 'assets/speech-control.json']) {
    files.set(`/${file}`, path.join(root, file))
  }
  files.set('/', files.get('/index.html'))
  files.set('/assets/avatar.zip', avatarPath || path.resolve(control, '../android-framework-new/photo/benny-avatar.zip'))
  files.set('/vendor/lam.js', path.join(rendererRoot, 'node_modules/gaussian-splat-renderer-for-lam/build/gaussian-splat-renderer-for-lam.module.js'))
  files.set('/vendor/uniicons.ttf', path.join(control, 'node_modules/@dcloudio/uni-ui/lib/uni-icons/uniicons.ttf'))
  for (const file of ['tools/ali-native-shell-ui/src/presentation-pose.js',
    'lam-renderer-rewrite/src/skeleton/presentation-pose.js',
    'lam-renderer-rewrite/src/skeleton/skeleton-math.js']) {
    files.set(`/control/renderer/${file}`, path.join(control, 'android-native/renderer', file))
  }
  return files
}

export function createDemoServer(files = resolveDemoFiles(), { generatePreview, accessToken } = {}) {
  const preview = createPreviewHandler(generatePreview)
  return createServer(async (request, response) => {
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.host || '')) {
      response.writeHead(403).end('Local access only')
      return
    }
    if (accessToken && request.headers['x-pet-token'] !== accessToken) {
      response.writeHead(403).end('Private desktop session')
      return
    }
    let pathname
    try { pathname = new URL(request.url, 'http://localhost').pathname } catch {
      response.writeHead(400).end()
      return
    }
    if (pathname === '/api/previews') { await preview(request, response); return }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    const file = files.get(pathname)
    if (!file) {
      response.writeHead(pathname === '/favicon.ico' ? 204 : 404).end()
      return
    }
    try {
      const info = await stat(file)
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(String(file))] || 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'microphone=(), camera=(), geolocation=()',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'none'",
      })
      if (request.method === 'HEAD') { response.end(); return }
      const stream = createReadStream(file)
      stream.on('error', () => response.destroy())
      response.on('close', () => stream.destroy())
      stream.pipe(response)
    } catch {
      response.writeHead(404).end('Demo resource unavailable')
    }
  })
}

async function start() {
  const files = resolveDemoFiles()
  const optionalSpeech = new Set(['speech.wav', 'speech.json', 'speech-control.json'].map((file) => files.get(`/assets/${file}`)))
  for (const file of new Set(files.values())) {
    if (optionalSpeech.has(file)) continue
    if (!(await stat(file)).isFile()) throw new Error(`Missing demo resource: ${file}`)
  }
  const server = createDemoServer(files)
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') server.listen(0, '127.0.0.1')
    else { console.error(error.message); process.exitCode = 1 }
  })
  server.on('listening', () => console.log(`Desktop pet: http://127.0.0.1:${server.address().port}/`))
  server.listen(Number(process.env.PORT || 5178), '127.0.0.1')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
