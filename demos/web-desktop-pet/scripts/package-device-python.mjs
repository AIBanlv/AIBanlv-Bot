import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { preparePythonCrt } from './device-package-tools.mjs'

const execute = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.resolve(root, '../../..')
const buildPython = process.env.DEVICE_BUILD_PYTHON || path.join(workspace, '.venv-lam-coreml/Scripts/python.exe')
const modelSource = process.env.DEVICE_MODEL_SOURCE || path.join(workspace, 'LAM_Audio2Expression-main/LAM_Audio2Expression-main')
const checkpoint = 'pretrained_models/LAM_audio2exp_streaming.tar'
export const checkpointSha256 = '38084d471966381f2e52d9f59e5654c9b8cde6fa36d4c6f18fc02cbaf593d157'

// Acceptance: relocatable win32-x64 Python + unchanged TAR, no pip/install step,
// RECORD-owned inference closure only, licenses retained, no caller-owned overwrite.
// Source: Astral's 20261013 GitHub release asset digest (not a venv or Conda copy).
export const PYTHON_BUILD = Object.freeze({
  version: '3.11.17',
  url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261013/cpython-3.11.17%2B20261013-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
  sha256: '54a38c5e7cc1a5fd2b0182b495f29606dc1455d18ebfd3b5bf0a3c09253b5031',
  bytes: 25240347,
})
export const DEPENDENCIES = Object.freeze({
  addict: '2.4.0', certifi: '2026.7.22', 'charset-normalizer': '3.4.9', colorama: '0.4.6',
  filelock: '3.32.2', fsspec: '2026.7.0', 'huggingface-hub': '0.36.2', idna: '3.18',
  'importlib-metadata': '9.0.0', jinja2: '3.1.6', markupsafe: '3.0.3', mpmath: '1.3.0',
  networkx: '3.6.1', numpy: '1.26.3', packaging: '26.2', platformdirs: '4.11.0',
  pyyaml: '6.0.3', regex: '2026.7.19', requests: '2.34.2', safetensors: '0.8.0',
  sympy: '1.14.0', tokenizers: '0.15.2', tomli: '2.4.1', torch: '2.2.0',
  torchaudio: '2.2.0', tqdm: '4.70.0', transformers: '4.36.2',
  'typing-extensions': '4.16.0', urllib3: '2.7.0', yapf: '0.40.1', zipp: '4.1.0',
})
const roots = ['numpy', 'torch', 'torchaudio', 'transformers', 'addict', 'yapf']
const tokenizerLicense = Object.freeze({
  url: 'https://api.github.com/repos/huggingface/tokenizers/contents/LICENSE?ref=v0.15.2',
  sha256: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
  bytes: 11357,
})
const modelFiles = [
  'LICENSE', 'configs/lam_audio2exp_config_streaming.py', 'configs/wav2vec2_config.json',
  'models/__init__.py', 'models/builder.py', 'models/default.py', 'models/network.py',
  'models/utils.py', 'models/encoder/wav2vec.py', 'models/encoder/wavlm.py',
  'models/losses/__init__.py', 'models/losses/builder.py', 'models/losses/misc.py',
  'models/losses/lovasz.py', 'utils/__init__.py', 'utils/config.py', 'utils/misc.py',
  'utils/path.py', 'utils/registry.py', checkpoint,
]

export function dependencyClosure(rows, requested = roots) {
  const indexed = new Map(), found = new Map(), pending = [...requested]
  for (const row of rows) {
    if (indexed.has(row.name)) throw new Error(`Duplicate distribution: ${row.name}`)
    indexed.set(row.name, row)
  }
  while (pending.length) {
    const name = pending.pop()
    if (found.has(name)) continue
    if (!Object.hasOwn(DEPENDENCIES, name)) throw new Error(`Dependency outside allowlist: ${name}`)
    const row = indexed.get(name)
    if (!row) throw new Error(`Missing dependency: ${name}`)
    if (row.version !== DEPENDENCIES[name]) throw new Error(`Dependency version changed: ${name}`)
    found.set(name, row)
    pending.push(...row.requires)
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function relativeFile(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || /[:\x00-\x1f]/.test(name) ||
      name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('Unsafe package path')
  }
  return name
}

export function runtimeRecordPath(name) {
  // Wheel console launchers refer to their original interpreter; never ship them.
  if (/^\.\.\/\.\.\/Scripts\/[^/]+\.(exe|exe\.manifest|py|pyw)$/.test(name)) return null
  if (name === '../../share/man/man1/isympy.1') return null
  relativeFile(name)
  const parts = name.split('/')
  if (parts.includes('__pycache__') || parts.includes('tests') || /\.(pyc|pyo|pth|lib|pdb)$/i.test(name) ||
      name.startsWith('torch/include/') || /\.(exe|bat|cmd)$/i.test(name) ||
      /\.dist-info\/(direct_url\.json|RECORD|INSTALLER|REQUESTED)$/.test(name)) return null
  return name
}

async function digest(file) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(file)) hash.update(bytes)
  return hash.digest('hex')
}

export function verifyDigest(bytes, expected = PYTHON_BUILD) {
  if (bytes.length !== expected.bytes) throw new Error('Python archive size mismatch')
  if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
    throw new Error('Python archive hash mismatch')
  }
}

function inside(parent, target) {
  const relative = path.relative(parent, target)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

export async function copyOwnedFiles(source, target, records) {
  source = await realpath(source)
  let bytes = 0, files = 0
  for (const record of records) {
    const name = runtimeRecordPath(record.path)
    if (!name) continue
    const from = path.join(source, name), to = path.join(target, name)
    if (!inside(source, await realpath(from)) || !(await lstat(from)).isFile()) {
      throw new Error('Package path escapes its source or is not a regular file')
    }
    await mkdir(path.dirname(to), { recursive: true })
    await copyFile(from, to, constants.COPYFILE_EXCL)
    if (record.sha256 && await digest(to) !== record.sha256) throw new Error(`Installed file hash mismatch: ${name}`)
    bytes += (await stat(to)).size
    files++
  }
  return { bytes, files }
}

async function pythonJson(script, args = []) {
  const { stdout } = await execute(buildPython, ['-I', '-B', '-c', script, ...args], {
    windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}

async function installedDependencies() {
  const rows = await pythonJson(`
import importlib.metadata as m, json, sys
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
assert sys.version_info[:2] == (3, 11) and sys.platform == 'win32'
rows = []
for d in m.distributions():
    requirements = [Requirement(s) for s in d.requires or []]
    active = [r for r in requirements if not r.marker or r.marker.evaluate({'extra': ''})]
    rows.append({'name': canonicalize_name(d.metadata['Name']), 'version': d.version,
                 'requires': [canonicalize_name(r.name) for r in active]})
print(json.dumps(rows))
`)
  const selected = dependencyClosure(rows)
  const inventory = await pythonJson(`
import importlib.metadata as m, json, sys
from pathlib import Path
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
rows = []
for name in sys.argv[1:]:
    d = m.distribution(name)
    for text in d.requires or []:
        r = Requirement(text)
        if (not r.marker or r.marker.evaluate({'extra': ''})) and m.version(r.name) not in r.specifier:
            raise ValueError('Unsatisfied dependency: ' + name)
    files = []
    for f in d.files or []:
        h = f.hash
        files.append({'path': str(f).replace('\\\\', '/'),
                      'hash': h.value if h and h.mode == 'sha256' else None})
    rows.append({'name': name, 'source': str(Path(d.locate_file('')).resolve()), 'files': files})
print(json.dumps(rows))
`, selected.map(row => row.name))
  const site = await realpath(process.env.DEVICE_BUILD_SITE_PACKAGES || path.join(workspace, '.venv-lam-coreml/Lib/site-packages'))
  return selected.map(row => {
    const entry = inventory.find(item => item.name === row.name)
    if (!entry || entry.source.toLowerCase() !== site.toLowerCase()) throw new Error('Dependency is outside the build venv')
    const files = entry.files.filter(file => runtimeRecordPath(file.path)).map(file => {
      if (!file.hash) throw new Error(`Missing wheel hash: ${row.name}/${file.path}`)
      return { path: file.path, sha256: Buffer.from(file.hash, 'base64url').toString('hex') }
    })
    if (row.name !== 'tokenizers' && !files.some(file => /(^|\/)(licen[cs]e|copying|notice)/i.test(file.path))) {
      throw new Error(`Missing distribution license: ${row.name}`)
    }
    return { ...row, source: site, files }
  })
}

async function pythonArchive() {
  const cache = path.join(root, 'artifacts/device-python-downloads')
  await mkdir(cache, { recursive: true })
  const file = path.join(cache, `${PYTHON_BUILD.sha256}.tar.gz`)
  let bytes
  try { bytes = await readFile(file) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const temporary = await mkdtemp(path.join(cache, '.download-'))
    const download = path.join(temporary, 'python.tar.gz')
    try {
      // Use Windows' TLS/proxy stack, with no profile or new build dependency.
      const literal = value => `'${value.replaceAll("'", "''")}'`
      const script = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(120)
$response = $client.GetAsync(${literal(PYTHON_BUILD.url)}, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
$response.EnsureSuccessStatusCode() | Out-Null
$reader = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
$writer = [IO.File]::Open(${literal(download)}, [IO.FileMode]::CreateNew)
try {
  $buffer = New-Object byte[] 65536
  $size = 0
  while ($size -lt ${PYTHON_BUILD.bytes}) {
    $count = $reader.Read($buffer, 0, [Math]::Min($buffer.Length, ${PYTHON_BUILD.bytes} - $size))
    if ($count -eq 0) { break }
    $size += $count
    $writer.Write($buffer, 0, $count)
  }
} finally { $writer.Dispose(); $reader.Dispose(); $response.Dispose(); $client.Dispose() }`
      const downloading = execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { windowsHide: true, timeout: 150000, maxBuffer: 65536 })
      downloading.child.stdin.end()
      await downloading
      bytes = await readFile(download)
      verifyDigest(bytes)
      await writeFile(file, bytes, { flag: 'wx' })
    } finally {
      if (!inside(await realpath(cache), await realpath(temporary))) throw new Error('Unsafe download cleanup path')
      await rm(temporary, { recursive: true, force: true })
    }
  }
  verifyDigest(bytes)
  return file
}

async function completeTokenizerLicense(python, summaries) {
  const response = await fetch(tokenizerLicense.url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`License download HTTP ${response.status}`)
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 65536) throw new Error('License response exceeds size limit')
    chunks.push(chunk)
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (data.encoding !== 'base64' || typeof data.content !== 'string') throw new Error('Invalid license response')
  const bytes = Buffer.from(data.content, 'base64')
  verifyDigest(bytes, tokenizerLicense)
  const relative = 'tokenizers-0.15.2.dist-info/LICENSE'
  await writeFile(path.join(python, 'Lib/site-packages', relative), bytes, { flag: 'wx' })
  const summary = summaries.find(row => row.name === 'tokenizers')
  summary.licenses.push(relative)
  summary.licenseSource = tokenizerLicense
  summary.files++
  summary.bytes += bytes.length
}

async function unpackPython(archive, target) {
  // Only regular files from the pinned archive. No pip, headers, scripts, tests,
  // .pth startup hooks, or bytecode referring to the distributor's build machine.
  await pythonJson(`
import json, tarfile, sys, shutil
from pathlib import Path, PurePosixPath
target = Path(sys.argv[2]).resolve()
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for item in archive:
        name = PurePosixPath(item.name)
        if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0] != 'python':
            raise ValueError('Unsafe Python archive path')
        if item.isdir():
            continue
        if not item.isfile() or '\\\\' in item.name or ':' in item.name:
            raise ValueError('Unsafe Python archive member')
        rel = name.relative_to('python')
        parts = rel.parts
        if not parts:
            continue
        if parts[0] in ('include', 'libs', 'Scripts', 'tcl') or '__pycache__' in parts:
            continue
        if parts[:2] in (('Lib', 'site-packages'), ('Lib', 'test'), ('Lib', 'ensurepip'), ('Lib', 'idlelib')):
            continue
        if rel.suffix.lower() in ('.pyc', '.pyo', '.pth', '.pdb', '.lib'):
            continue
        dest = target.joinpath(*parts)
        if not dest.resolve().is_relative_to(target):
            raise ValueError('Unsafe Python archive destination')
        dest.parent.mkdir(parents=True, exist_ok=True)
        with archive.extractfile(item) as reader, dest.open('xb') as writer:
            shutil.copyfileobj(reader, writer)
print('{}')
`, [archive, target])
  await access(path.join(target, 'python.exe'))
  await access(path.join(target, 'python311.dll'))
  await writeFile(path.join(target, 'python311._pth'), '.\nDLLs\nLib\nLib/site-packages\n', { flag: 'wx' })
}

async function treeSize(directory) {
  let bytes = 0, files = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const child = await treeSize(file)
      bytes += child.bytes
      files += child.files
    } else if (entry.isFile()) {
      bytes += (await stat(file)).size
      files++
    } else throw new Error('Runtime cannot contain symbolic links')
  }
  return { bytes, files }
}

/**
 * Build-only. Owns python/, model/ and python-runtime.json inside runtimeRoot.
 * Rejects existing outputs, leaves siblings (e.g. java/) alone. No system install.
 * Returns absolute paths plus a serializable size/version/license/provenance manifest.
 */
export async function stageDevicePython(runtimeRoot) {
  if (typeof runtimeRoot !== 'string' || !path.isAbsolute(runtimeRoot)) throw new Error('An absolute runtimeRoot is required')
  await mkdir(runtimeRoot, { recursive: true })
  runtimeRoot = await realpath(runtimeRoot)
  const outputs = ['python', 'model', 'python-runtime.json']
  for (const name of outputs) {
    try {
      await lstat(path.join(runtimeRoot, name))
      throw new Error(`Runtime output already exists: ${name}`)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build requires Windows x64')
  const dependencies = await installedDependencies()
  const archive = await pythonArchive()
  const stage = await mkdtemp(path.join(runtimeRoot, '.python-stage-'))
  const published = []
  try {
    const python = path.join(stage, 'python'), model = path.join(stage, 'model')
    await unpackPython(archive, python)
    const nativeRuntime = await preparePythonCrt(python)
    const summaries = []
    for (const dependency of dependencies) {
      const size = await copyOwnedFiles(dependency.source, path.join(python, 'Lib/site-packages'), dependency.files)
      summaries.push({ name: dependency.name, version: dependency.version, ...size,
        licenses: dependency.files.filter(file => /(^|\/)(licen[cs]e|copying|notice)/i.test(file.path)).map(file => file.path) })
    }
    await completeTokenizerLicense(python, summaries)
    const modelRecords = []
    for (const file of modelFiles) {
      const hash = await digest(path.join(modelSource, file))
      if (file === checkpoint && hash !== checkpointSha256) throw new Error('Original TAR hash mismatch')
      modelRecords.push({ path: file, sha256: hash })
    }
    await copyOwnedFiles(modelSource, model, modelRecords)
    const pythonSize = await treeSize(python), modelSize = await treeSize(model)
    const manifest = {
      schema: 1, platform: 'win32-x64', engine: 'pytorch-original-tar', pythonVersion: PYTHON_BUILD.version,
      pythonBuild: PYTHON_BUILD, nativeRuntime, checkpointSha256, dependencies: summaries, modelFiles: modelRecords,
      bytes: { python: pythonSize.bytes, model: modelSize.bytes, total: pythonSize.bytes + modelSize.bytes },
      files: { python: pythonSize.files, model: modelSize.files },
    }
    await writeFile(path.join(stage, 'python-runtime.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
    for (const name of outputs) {
      await rename(path.join(stage, name), path.join(runtimeRoot, name))
      published.push(name)
    }
    return { ...manifest, runtimeRoot, pythonExecutable: path.join(runtimeRoot, 'python/python.exe'),
      modelRoot: path.join(runtimeRoot, 'model'), manifestPath: path.join(runtimeRoot, 'python-runtime.json') }
  } catch (error) {
    for (const name of published) await rm(path.join(runtimeRoot, name), { recursive: true, force: true })
    throw error
  } finally {
    if (!inside(runtimeRoot, await realpath(stage))) throw new Error('Unsafe staging cleanup path')
    await rm(stage, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/package-device-python.mjs ABSOLUTE_RUNTIME_ROOT')
  console.log(JSON.stringify(await stageDevicePython(path.resolve(process.argv[2])), null, 2))
}
