import { execFile } from 'node:child_process'
import { access, realpath } from 'node:fs/promises'
import path from 'node:path'

export const sourceError = code => Object.assign(new Error(code), { code })
export function sourceEnvironment(env = process.env) {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !/^GIT_/i.test(key) &&
    !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR'].includes(key.toUpperCase())))
  // Managed defaults from the old app are not developer overrides for the next revision.
  try {
    const supplied = JSON.parse(clean.AIBANLV_MANAGED_DEFAULTS || '{}')
    for (const key of ['JAVA', 'JAVAC', 'GSON_JAR', 'PET_PYTHON', 'PET_LAM_SOURCE', 'PET_MAC_LAM_ROOT']) {
      if (supplied[key] && clean[key] === supplied[key]) delete clean[key]
    }
  } catch {}
  delete clean.AIBANLV_MANAGED_DEFAULTS
  return { ...clean, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', npm_config_update_notifier: 'false' }
}

// Commands and working directories are supplied by main/its private job, never by a renderer.
export function runSourceCommand(file, args, { cwd, signal, timeout = 15000, env = sourceEnvironment() } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(sourceError('SOURCE_CANCELLED')); return }
    let failure
    const child = execFile(file, args, { cwd, env, windowsHide: true, shell: false,
      detached: process.platform !== 'win32', maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel)
      if (failure || error) reject(Object.assign(sourceError(failure || (error.code === 'ENOENT' ? 'SOURCE_TOOL_MISSING' : 'SOURCE_COMMAND')), { exitCode: error?.code }))
      else resolve(stdout)
    })
    const stop = code => {
      if (failure) return
      failure = code
      if (!child.pid) return
      if (process.platform === 'win32') {
        execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => {})
      } else { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
    }
    const cancel = () => stop('SOURCE_CANCELLED')
    const timer = setTimeout(() => stop('SOURCE_TIMEOUT'), timeout)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
  })
}

const git = (root, args, options) => runSourceCommand('git',
  ['-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, ...args], { ...options, cwd: root })
const digest = value => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
const dependencyFiles = ['package.json', 'package-lock.json', 'demos/web-desktop-pet/package.json',
  'demos/web-desktop-pet/package-lock.json', 'android-native/renderer/tools/ali-native-shell-ui/package.json',
  'android-native/renderer/tools/ali-native-shell-ui/package-lock.json']

export async function sourceCheckout(root, options) {
  let topLevel
  try { topLevel = (await git(root, ['rev-parse', '--show-toplevel'], options)).trim() }
  catch (error) { if (error.exitCode === 128) throw sourceError('SOURCE_NOT_REPOSITORY'); throw error }
  if (await realpath(topLevel) !== await realpath(root)) throw sourceError('SOURCE_NOT_REPOSITORY')
  let branch
  try { branch = (await git(root, ['symbolic-ref', '--quiet', 'HEAD'], options)).trim() }
  catch (error) { if (error.exitCode === 1) throw sourceError('SOURCE_DETACHED'); throw error }
  if (!branch.startsWith('refs/heads/') || /[\x00-\x20\x7f]/.test(branch)) throw sourceError('SOURCE_DETACHED')
  if ((await git(root, ['status', '--porcelain=v1', '--untracked-files=no'], options)).trim()) throw sourceError('SOURCE_DIRTY')
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG']) {
    const file = (await git(root, ['rev-parse', '--git-path', marker], options)).trim()
    if (await access(path.resolve(root, file)).then(() => true, () => false)) throw sourceError('SOURCE_IN_PROGRESS')
  }
  const head = (await git(root, ['rev-parse', '--verify', 'HEAD'], options)).trim()
  if (!digest(head)) throw sourceError('SOURCE_NOT_REPOSITORY')
  return { root, branch, head }
}

export async function checkSourceUpdate(root, options) {
  const current = await sourceCheckout(root, options)
  const tracking = (await git(root, ['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)', current.branch], options)).trim().split('\0')
  const [remote, reference, upstream] = tracking
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(remote || '') || !reference?.startsWith('refs/heads/') ||
      !upstream?.startsWith(`refs/remotes/${remote}/`) || tracking.some(value => /[\x00-\x20\x7f]/.test(value))) throw sourceError('SOURCE_NO_UPSTREAM')
  await git(root, ['fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--', remote, `${reference}:${upstream}`], { ...options, timeout: 90000 })
  const target = (await git(root, ['rev-parse', '--verify', `${upstream}^{commit}`], options)).trim()
  if (!digest(target)) throw sourceError('SOURCE_COMMAND')
  const [ahead, behind] = (await git(root, ['rev-list', '--left-right', '--count', `${current.head}...${target}`], options)).trim().split(/\s+/).map(Number)
  if (ahead && behind) throw sourceError('SOURCE_DIVERGED')
  const changed = behind ? (await git(root, ['diff', '--name-only', current.head, target, '--', ...dependencyFiles, 'source-runtime.lock.json'], options)).trim().split(/\r?\n/) : []
  return { ...current, target, available: behind > 0, dependenciesChanged: changed.some(file => dependencyFiles.includes(file)),
    runtimeChanged: changed.includes('source-runtime.lock.json') }
}

export async function applySourceUpdate(plan, { resume = false, ...options } = {}) {
  const current = await sourceCheckout(plan.root, options)
  if (current.branch !== plan.branch || !digest(plan.target) ||
      (current.head !== plan.head && !(resume && current.head === plan.target))) throw sourceError('SOURCE_CHANGED')
  if (current.head === plan.target) return
  await git(plan.root, ['merge', '--ff-only', '--no-edit', '--no-stat', '--no-overwrite-ignore', plan.target], options)
  if ((await git(plan.root, ['rev-parse', 'HEAD'], options)).trim() !== plan.target) throw sourceError('SOURCE_CHANGED')
}
