import { randomBytes } from 'node:crypto'
import { link, lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'
import { prepareWindowsDesktopDirectories, removeWindowsEmptyDirectory } from './device-assistant-windows.mjs'

const failure = code => Object.assign(new Error(code), { code })
const idPattern = /^[a-f0-9]{32}$/
const categories = {
  Documents: 'pdf doc docx rtf txt md odt xls xlsx csv ods ppt pptx odp',
  Images: 'jpg jpeg png gif webp bmp tif tiff heic svg',
  Audio: 'mp3 wav flac aac ogg m4a',
  Video: 'mp4 mov mkv avi webm m4v',
  Archives: 'zip rar 7z tar gz bz2 xz',
}
const categoryOf = name => Object.entries(categories).find(([, extensions]) =>
  extensions.split(' ').includes(path.extname(name).slice(1).toLowerCase()))?.[0]
const safeName = name => typeof name === 'string' && name.length <= 255 && name.length > 0 &&
  !/[\\/:*?"<>|\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(name) &&
  !/^[.~]/.test(name) && !/[. ]$/.test(name)
const fingerprint = info => ({ dev: String(info.dev), ino: String(info.ino),
  size: String(info.size), mtime: String(info.mtimeNs) })
const sameFile = (a, b) => a && b && ['dev', 'ino', 'size', 'mtime'].every(key => a[key] === b[key])
async function info(file) {
  try {
    const value = await lstat(file, { bigint: true })
    if (!value.isFile() || value.isSymbolicLink()) throw failure('TARGET_CHANGED')
    return fingerprint(value)
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function absent(file) {
  try { await lstat(file); return false }
  catch (error) { if (error.code === 'ENOENT') return true; throw error }
}
async function directory(file) {
  const value = await lstat(file)
  if (!value.isDirectory() || value.isSymbolicLink()) throw failure('TARGET_CHANGED')
}
function validateRecord(record, id) {
  if (!record || record.version !== 1 || record.id !== id || !idPattern.test(id) ||
      typeof record.root !== 'string' || !path.isAbsolute(record.root) ||
      record.folder !== `AIBanlv-Desktop-${id.slice(0, 8)}` ||
      !Number.isSafeInteger(record.createdAt) || !Array.isArray(record.moves) || record.moves.length > 100) {
    throw failure('HISTORY_INVALID')
  }
  const names = new Set()
  for (const move of record.moves) {
    if (!move || !safeName(move.from) || !categoryOf(move.from) ||
        move.to !== `${categoryOf(move.from)}/${move.from}` || names.has(move.from.toLowerCase()) ||
        !move.snapshot || !['dev', 'ino', 'size', 'mtime'].every(key =>
          typeof move.snapshot[key] === 'string' && /^\d{1,24}$/.test(move.snapshot[key]))) throw failure('HISTORY_INVALID')
    names.add(move.from.toLowerCase())
  }
  return record
}

export class DesktopOrganizer {
  constructor({ desktop, history, approve, moveFile, attributes = async () => [],
    removeEmpty = removeWindowsEmptyDirectory, prepareDirectories = prepareWindowsDesktopDirectories }) {
    Object.assign(this, { desktop, history, approve, moveFile, attributes, removeEmpty, prepareDirectories })
    this.pending = new Map()
  }
  reset() { this.pending.clear() }
  async root(expected) {
    const root = await realpath(this.desktop)
    await directory(root)
    if (expected && root !== expected) throw failure('TARGET_CHANGED')
    return root
  }
  async consent(action, signal) {
    signal.throwIfAborted()
    if (!await this.approve(action, signal)) throw failure('ACTION_DENIED')
    signal.throwIfAborted()
  }
  async preview(target, { signal }) {
    if (target !== 'desktop') throw failure('INVALID_ACTION')
    const root = await this.root()
    await this.consent({ name: 'plan_desktop', target: root }, signal)
    await this.root(root)
    const excluded = new Set(await this.attributes(root, { signal }))
    const entries = await readdir(root, { withFileTypes: true })
    if (entries.length > 5000) throw failure('DESKTOP_TOO_LARGE')
    const moves = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      signal.throwIfAborted()
      if (!entry.isFile() || entry.isSymbolicLink() || !safeName(entry.name) || excluded.has(entry.name)) continue
      const category = categoryOf(entry.name)
      if (!category) continue
      const snapshot = await info(path.join(root, entry.name))
      if (!snapshot) throw failure('TARGET_CHANGED')
      moves.push({ from: entry.name, to: `${category}/${entry.name}`, snapshot })
      if (moves.length > 100) throw failure('DESKTOP_TOO_LARGE')
    }
    const id = randomBytes(16).toString('hex')
    const plan = { version: 1, id, root, createdAt: Date.now(), folder: `AIBanlv-Desktop-${id.slice(0, 8)}`, moves }
    this.pending.clear()
    this.pending.set(id, plan)
    return { status: 'preview', planId: id, folder: plan.folder, skipped: entries.length - moves.length,
      moves: moves.map(({ from, to }) => ({ from, to })) }
  }
  async historyDirectory(create = false) {
    if (create) await mkdir(this.history, { recursive: true })
    let root
    try { root = await realpath(this.history) }
    catch (error) { if (error.code === 'ENOENT') throw failure('NO_DESKTOP_HISTORY'); throw error }
    if (this.historyRoot && this.historyRoot !== root) throw failure('HISTORY_INVALID')
    await directory(root)
    this.historyRoot = root
    return root
  }
  async load(id) {
    if (id !== 'latest' && (typeof id !== 'string' || !idPattern.test(id))) throw failure('INVALID_ACTION')
    const root = await this.historyDirectory()
    if (id === 'latest') {
      const names = (await readdir(root)).filter(name => /^[a-f0-9]{32}\.json$/.test(name))
      if (!names.length) throw failure('NO_DESKTOP_HISTORY')
      let latest
      for (const name of names) {
        const record = await this.load(name.slice(0, -5))
        if (!latest || record.createdAt > latest.createdAt) latest = record
      }
      return latest
    }
    const file = path.join(root, `${id}.json`)
    if (await absent(file)) throw failure('PLAN_EXPIRED')
    await info(file)
    const handle = await open(file, 'r')
    try {
      const bytes = Buffer.alloc(262145)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      if (bytesRead > 262144) throw failure('HISTORY_INVALID')
      let record
      try { record = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')) }
      catch { throw failure('HISTORY_INVALID') }
      return validateRecord(record, id)
    } finally { await handle.close() }
  }
  async save(plan) {
    const root = await this.historyDirectory(true)
    const temporary = path.join(root, `${plan.id}-${randomBytes(8).toString('hex')}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      try { await handle.writeFile(JSON.stringify(plan)); await handle.sync() }
      finally { await handle.close() }
      // Publish only a complete record, without replacing an existing batch.
      await link(temporary, path.join(root, `${plan.id}.json`))
    } finally { await unlink(temporary) }
  }
  async paths(plan, move) {
    await this.root(plan.root)
    const base = path.join(plan.root, plan.folder)
    for (const parent of [base, path.join(base, categoryOf(move.from))]) {
      if (!await absent(parent)) await directory(parent)
    }
    return { source: path.join(plan.root, move.from), target: path.join(base, move.to) }
  }
  async inspect(plan) {
    const placed = [], conflicts = []
    await this.root(plan.root)
    for (const move of plan.moves) {
      const { source, target } = await this.paths(plan, move)
      const from = await info(source), to = await info(target)
      if (!from && sameFile(to, move.snapshot)) placed.push(move)
      else if (to || !from) conflicts.push(move.from)
    }
    return { placed, conflicts }
  }
  approval(plan, moves, undo = false) {
    const base = path.join(plan.root, plan.folder)
    const entries = moves.map(move => undo
      ? { from: path.join(base, move.to), to: path.join(plan.root, move.from) }
      : { from: path.join(plan.root, move.from), to: path.join(base, move.to) })
    return { name: undo ? 'undo_desktop' : 'organize_desktop',
      target: entries.map(move => `${move.from}\n -> ${move.to}`).join('\n\n'), entries }
  }
  async transfer(plan, moves, signal, undo = false) {
    for (const move of moves) {
      signal.throwIfAborted()
      const paths = await this.paths(plan, move)
      const from = undo ? paths.target : paths.source, to = undo ? paths.source : paths.target
      if (!sameFile(await info(from), move.snapshot) || !await absent(to)) throw failure('TARGET_CHANGED')
      await this.moveFile(from, to, { signal, root: plan.root, expected: move.snapshot })
    }
  }
  async apply(id, { signal }) {
    this.lastOutcome = null
    if (typeof id !== 'string' || !idPattern.test(id)) throw failure('INVALID_ACTION')
    const plan = this.pending.get(id)
    if (!plan) {
      const recorded = await this.load(id)
      const state = await this.inspect(recorded)
      return { status: 'already_recorded', batchId: id, moved: state.placed.length, conflicts: state.conflicts }
    }
    if (!plan.moves.length) return { status: 'nothing_to_organize', moved: 0 }
    await this.consent(this.approval(plan, plan.moves), signal)
    await this.root(plan.root)
    const base = path.join(plan.root, plan.folder)
    if (!await absent(base)) throw failure('TARGET_CHANGED')
    const excluded = new Set(await this.attributes(plan.root, { signal }))
    for (const move of plan.moves) {
      if (excluded.has(move.from) || !sameFile(await info(path.join(plan.root, move.from)), move.snapshot)) throw failure('TARGET_CHANGED')
    }
    signal.throwIfAborted()
    // This immutable record is durable before any directory creation or move.
    // Recovery inspects actual locations, including a move whose reply was lost.
    await this.save(plan)
    this.pending.delete(id)
    try {
      signal.throwIfAborted()
      await this.prepareDirectories(base, [...new Set(plan.moves.map(move => categoryOf(move.from)))],
        { root: plan.root, signal })
      await this.transfer(plan, plan.moves, signal)
    } catch (error) {
      const state = await this.inspect(plan)
      this.lastOutcome = { status: 'partial', operation: 'organize', batchId: id, moved: state.placed.length, conflicts: state.conflicts,
        code: error.code === 'TARGET_CHANGED' ? error.code : 'MOVE_FAILED' }
      signal.throwIfAborted()
      return this.lastOutcome
    }
    const state = await this.inspect(plan)
    this.lastOutcome = { status: state.placed.length === plan.moves.length ? 'organized' : 'partial', operation: 'organize',
      batchId: id, moved: state.placed.length, conflicts: state.conflicts }
    signal.throwIfAborted()
    return this.lastOutcome
  }
  async undo(id, { signal }) {
    this.lastOutcome = null
    signal.throwIfAborted()
    const plan = await this.load(id)
    const before = await this.inspect(plan)
    if (before.conflicts.length) throw failure('TARGET_CHANGED')
    if (!before.placed.length) return { status: 'restored', batchId: plan.id, moved: 0 }
    await this.consent(this.approval(plan, before.placed, true), signal)
    const current = await this.inspect(plan)
    if (current.conflicts.length || JSON.stringify(current.placed) !== JSON.stringify(before.placed)) throw failure('TARGET_CHANGED')
    try { await this.transfer(plan, [...current.placed].reverse(), signal, true) }
    catch (error) {
      const after = await this.inspect(plan)
      this.lastOutcome = { status: 'partial', operation: 'undo', batchId: plan.id, moved: before.placed.length - after.placed.length,
        remaining: after.placed.length, conflicts: after.conflicts,
        code: error.code === 'TARGET_CHANGED' ? error.code : 'MOVE_FAILED' }
      signal.throwIfAborted()
      return this.lastOutcome
    }
    const after = await this.inspect(plan)
    this.lastOutcome = { status: after.placed.length ? 'partial' : 'restored', operation: 'undo',
      batchId: plan.id, moved: before.placed.length - after.placed.length, remaining: after.placed.length,
      conflicts: after.conflicts }
    signal.throwIfAborted()
    // Non-recursive removal never removes newly added user files.
    const base = path.join(plan.root, plan.folder)
    for (const name of [...new Set(plan.moves.map(move => categoryOf(move.from))), '']) {
      const folder = path.join(base, name)
      if (await absent(folder)) continue
      await this.removeEmpty(folder, { root: plan.root, signal })
    }
    return this.lastOutcome
  }
}
