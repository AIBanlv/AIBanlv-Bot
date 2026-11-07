import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { controlToolchain } from './prepare-control.mjs'
import { validateClip } from '../src/expression.mjs'
import { validateControl } from '../src/control.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.resolve(root, '../../..')
const jobs = path.join(process.env.PET_ARTIFACTS || path.join(root, 'artifacts'), 'preview-jobs')
const failure = (status, code, message) => Object.assign(new Error(message), { status, code })

function run(file, args, signal, stage) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: 'ignore', cwd: root })
    const abort = () => child.kill()
    signal.addEventListener('abort', abort, { once: true })
    let spawnError = false
    child.on('error', () => { spawnError = true })
    // Wait for close, not AbortError, so cleanup cannot race an exiting writer.
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason)
      else if (spawnError || code !== 0) reject(failure(503, 'DEPENDENCY_UNAVAILABLE', `${stage}失败，请检查 README 中的本地依赖`))
      else resolve()
    })
  })
}

export function createPreviewGenerator() {
  let prepared = null
  return async (text, signal) => {
    await mkdir(jobs, { recursive: true })
    const directory = await mkdtemp(path.join(jobs, 'job-'))
    const file = (name) => path.join(directory, name)
    try {
      if (!prepared) {
        const tools = await controlToolchain()
        await run(process.env.JAVAC || 'javac', ['-encoding', 'UTF-8', '-cp', tools.jar,
          '-d', tools.output, ...tools.sources], signal, 'Control 编译')
        prepared = tools
      }
      const java = (name, args) => run(process.env.JAVA || 'java', ['-cp', prepared.classpath, name, ...args], signal, 'Control 后处理')
      await writeFile(file('request.json'), JSON.stringify({ text }))
      await java('ControlPreview', [file('request.json'), file('behavior.json')])
      const behavior = JSON.parse(await readFile(file('behavior.json'), 'utf8'))
      if (behavior.error) throw failure(400, 'INVALID_TAGS', '标签不支持、同类重复或没有台词，请检查输入')
      await run(process.env.PET_TTS_PYTHON || 'F:/Miniconda/python.exe',
        [path.join(root, 'scripts/silent_tts.py'), '--assets', directory], signal, '离线普通话生成')
      await run(process.env.PET_PYTHON || path.join(workspace, '.venv-lam-coreml/Scripts/python.exe'),
        [path.join(root, 'scripts/infer_speech.py'), '--source',
          process.env.PET_LAM_SOURCE || path.join(workspace, 'LAM_Audio2Expression-main/LAM_Audio2Expression-main'),
          '--assets', directory, '--lines', file('lines.json')], signal, '原始 TAR 推理')
      await java('ControlPostprocess', [file('speech.json'), prepared.library, file('bank.json'), file('behavior.json')])
      const raw = await readFile(file('speech.json'))
      const clip = validateClip(JSON.parse(raw.toString('utf8')))
      const bank = JSON.parse(await readFile(file('bank.json'), 'utf8'))
      bank.sourceSha256 = createHash('sha256').update(raw).digest('hex')
      validateControl(bank, bank.sourceSha256, clip.duration, ['natural'])
      return { version: 1, clip, bank, behavior }
    } finally {
      const resolved = await realpath(directory)
      if (path.dirname(resolved) !== await realpath(jobs) || !path.basename(resolved).startsWith('job-')) {
        throw new Error('Refusing cleanup outside preview jobs')
      }
      await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
}

function readBody(request, signal) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    const finish = (error) => {
      clearTimeout(timer)
      request.removeListener('data', data)
      request.removeListener('end', end)
      request.removeListener('error', fail)
      signal.removeEventListener('abort', abort)
      if (error) { request.resume(); reject(error) }
      else resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const data = (chunk) => {
      size += chunk.length
      if (size > 4096) finish(failure(413, 'BODY_TOO_LARGE', '请求超过 4 KiB'))
      else chunks.push(chunk)
    }
    const end = () => finish()
    const fail = () => finish(failure(400, 'INVALID_BODY', '请求未完整接收'))
    const abort = () => finish(signal.reason)
    const timer = setTimeout(() => finish(failure(408, 'BODY_TIMEOUT', '请求接收超时')), 5000)
    request.on('data', data).once('end', end).once('error', fail)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export function createPreviewHandler(generate = createPreviewGenerator()) {
  let busy = false
  return async (request, response) => {
    const json = (status, data) => {
      if (!response.destroyed) response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      }).end(JSON.stringify(data))
    }
    const error = (status, code, message) => json(status, { error: { code, message } })
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); error(405, 'METHOD', '仅接受 POST'); return }
    if (request.headers.origin !== `http://${request.headers.host}`) { error(403, 'ORIGIN', '仅允许同源请求'); return }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) { error(415, 'CONTENT_TYPE', '仅接受 JSON'); return }
    if (busy) { error(409, 'BUSY', '已有生成任务，请稍后重试'); return }
    busy = true
    const controller = new AbortController()
    const abort = () => controller.abort()
    response.once('close', abort)
    const timer = setTimeout(() => controller.abort(failure(504, 'TIMEOUT', '生成超时，请缩短台词后重试')), 120000)
    try {
      const raw = await readBody(request, controller.signal)
      let body
      try { body = JSON.parse(raw) } catch { throw failure(400, 'INVALID_JSON', 'JSON 格式错误') }
      if (!body || Object.keys(body).length !== 1 || typeof body.text !== 'string' ||
          !body.text.trim() || [...body.text].length > 160 || /[\x00-\x08\x0b-\x1f]/.test(body.text)) {
        throw failure(400, 'INVALID_TEXT', '请输入 1–160 字的台词（含标签）')
      }
      const result = await generate(body.text, controller.signal)
      controller.signal.throwIfAborted()
      json(200, result)
    } catch (cause) {
      error(cause.status || 503, cause.status ? cause.code : 'GENERATION_FAILED',
        cause.status ? cause.message : '生成失败，请检查本地依赖后重试')
    } finally {
      clearTimeout(timer)
      response.removeListener('close', abort)
      busy = false
    }
  }
}
