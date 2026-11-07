import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { copyFile, mkdtemp, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { names } from '../src/expression.mjs'
import { PYTHON_BUILD, DEPENDENCIES } from '../scripts/package-device-python.mjs'

const execute = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtime = path.resolve(process.argv[2] || path.join(root, 'artifacts/device-python-portable/runtime'))
const manifest = JSON.parse(await readFile(path.join(runtime, 'python-runtime.json'), 'utf8'))
assert.equal(manifest.pythonVersion, PYTHON_BUILD.version)
assert.equal(manifest.pythonBuild.sha256, PYTHON_BUILD.sha256)
assert.equal(manifest.engine, 'pytorch-original-tar')
assert.deepEqual(Object.fromEntries(manifest.dependencies.map(row => [row.name, row.version])), DEPENDENCIES)
const artifacts = await realpath(path.join(root, 'artifacts'))
assert.ok(runtime.startsWith(artifacts + path.sep), 'Relocation test only owns a runtime under ignored artifacts')
const relocated = runtime + ' relocation check'
const scratch = await mkdtemp(path.join(os.tmpdir(), 'device-python-portable-'))
const windows = process.env.SystemRoot || 'C:\\Windows'
const env = {
  SystemRoot: windows, WINDIR: windows, PATH: path.join(windows, 'System32'),
  TEMP: scratch, TMP: scratch, USERPROFILE: scratch, HOME: scratch,
  PYTHONHOME: '', PYTHONPATH: '', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
  HF_HOME: path.join(scratch, 'hf'), HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
  HF_HUB_DISABLE_TELEMETRY: '1', TORCH_HOME: path.join(scratch, 'torch'),
}
let moved = false
try {
  // A rename, not another large copy. Spaces and a different install location
  // exercise relocation without touching the build venv or original model.
  await rename(runtime, relocated)
  moved = true
  const python = path.join(relocated, 'python/python.exe')
  const model = path.join(relocated, 'model')
  const options = { cwd: scratch, env, windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 }
  const { stdout: auditOutput } = await execute(python, ['-B', '-c', `
import sys, json, ctypes, importlib.metadata as metadata
from pathlib import Path
import torch, torchaudio, transformers, numpy, addict, yapf
from ctypes import wintypes
base = Path(sys.executable).parent.resolve()
outside = [p for p in sys.path if p and not Path(p).resolve().is_relative_to(base)]
modules = [str(m.__file__) for m in list(sys.modules.values())
           if getattr(m, '__file__', None) and not str(m.__file__).startswith('<')]
outside += [p for p in modules if not Path(p).resolve().is_relative_to(base)]
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
psapi = ctypes.WinDLL('psapi', use_last_error=True)
kernel.GetCurrentProcess.restype = wintypes.HANDLE
psapi.EnumProcessModules.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.HMODULE),
                                    wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
psapi.GetModuleFileNameExW.argtypes = [wintypes.HANDLE, wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD]
handles = (wintypes.HMODULE * 1024)()
needed = wintypes.DWORD()
process = kernel.GetCurrentProcess()
assert psapi.EnumProcessModules(process, handles, ctypes.sizeof(handles), ctypes.byref(needed))
native = []
for handle in handles[:needed.value // ctypes.sizeof(wintypes.HMODULE)]:
    value = ctypes.create_unicode_buffer(32768)
    assert psapi.GetModuleFileNameExW(process, handle, value, len(value))
    native.append(value.value)
crt = [p for p in native if Path(p).name.lower().startswith(('msvcp140', 'vcruntime140', 'libiomp'))]
print(json.dumps({'version': sys.version.split()[0], 'prefix': sys.prefix, 'basePrefix': sys.base_prefix,
                  'isolated': sys.flags.isolated, 'outsideModules': outside,
                  'externalCrt': [p for p in crt if not Path(p).resolve().is_relative_to(base)],
                  'crt': [Path(p).name for p in crt],
                  'distributions': {d.metadata['Name'].lower().replace('_', '-'):d.version for d in metadata.distributions()}}))
`], options)
  const audit = JSON.parse(auditOutput)
  assert.equal(audit.version, PYTHON_BUILD.version)
  assert.equal(audit.isolated, 1)
  assert.deepEqual(audit.outsideModules, [])
  assert.deepEqual(audit.externalCrt, [], 'VC runtime must not be supplied by the build machine')
  assert.deepEqual(audit.distributions, DEPENDENCIES, 'No pip, CoreML, or unrelated packages')
  for (const dependency of manifest.dependencies) {
    assert.ok(dependency.licenses.length > 0)
    for (const license of dependency.licenses) {
      assert.ok((await stat(path.join(relocated, 'python/Lib/site-packages', license))).size > 0)
    }
  }
  const { stdout: fixtureOutput } = await execute(python, ['-B', '-c', `
import base64, json, sys, wave
import numpy as np
import torch
from torchaudio.transforms import Resample
torch.set_num_threads(4)
resample = Resample(16000, 24000)
result = []
for filename in sys.argv[1:]:
    with wave.open(filename, 'rb') as audio:
        assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, 16000)
        samples = np.frombuffer(audio.readframes(16000), dtype='<i2').astype(np.float32)
    samples = resample(torch.from_numpy(samples)).numpy()
    window = np.zeros(51200, dtype='<i2')
    window[27200:27200 + len(samples)] = np.rint(samples).clip(-32768,32767).astype('<i2')
    result.append(base64.b64encode(window.tobytes()).decode('ascii'))
print(json.dumps(result))
`, path.join(root, 'assets/phrase-0.wav'), path.join(root, 'assets/phrase-1.wav')], options)
  const [first, second] = JSON.parse(fixtureOutput)
  assert.notEqual(first, second)
  const worker = path.join(scratch, 'device_lam_worker.py')
  await copyFile(path.join(root, 'scripts/device_lam_worker.py'), worker)
  const began = performance.now()
  const child = spawn(python, ['-B', '-u', '-c', `
import runpy, sys
def guard(event, args):
    if event in ('socket.connect', 'socket.getaddrinfo'):
        raise RuntimeError('Network access is forbidden in portable inference')
sys.addaudithook(guard)
sys.argv = [sys.argv[1], '--source', sys.argv[2]]
runpy.run_path(sys.argv[0], run_name='__main__')
`, worker, model], { cwd: scratch, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', stderr = '', readyMs, pipeError
  const timer = setTimeout(() => { pipeError = new Error('Portable inference timed out'); child.kill() }, 120000)
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    output += chunk
    if (readyMs === undefined && output.includes('\n')) readyMs = Math.round(performance.now() - began)
    if (output.length > 1024 * 1024) { pipeError = new Error('Oversized worker output'); child.kill() }
  })
  child.stderr.on('data', chunk => { if (stderr.length < 16384) stderr += chunk.toString() })
  child.stdin.on('error', error => { pipeError = error })
  try {
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', code => resolve(code))
    })
    child.stdin.end([first, second, first].map((pcm, index) => JSON.stringify({ id: index + 1, pcm })).join('\n') + '\n')
    assert.equal(await closed, 0, `Portable worker failed: ${stderr}`)
    assert.equal(pipeError, undefined)
  } finally {
    clearTimeout(timer)
  }
  const messages = output.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(messages.length, 4)
  const {backend,benchmark,...ready}=messages[0]
  assert.ok(['cpu','cuda'].includes(backend));assert.equal(typeof benchmark,'object')
  assert.deepEqual(ready, { type: 'ready', engine: 'pytorch-original-tar', fps: 30, names,
    checkpointSha256: manifest.checkpointSha256 })
  for (const [index, message] of messages.slice(1).entries()) {
    assert.equal(message.id, index + 1)
    assert.equal(message.frames.length, 30)
    assert.ok(message.frames.every(frame => frame.length === 52 && frame.every(value =>
      Number.isFinite(value) && value >= 0 && value <= 1)))
    assert.ok(Number.isFinite(message.inferenceMs) && message.inferenceMs >= 0)
  }
  assert.deepEqual(messages[1].frames, messages[3].frames)
  const a = messages[1].frames.flat(), b = messages[2].frames.flat()
  const maximumDifference = Math.max(...a.map((value, index) => Math.abs(value - b[index])))
  assert.ok(maximumDifference > 0.0001)
  assert.ok(!(await readdir(model)).some(name => name.endsWith('.wav')))
  console.log(JSON.stringify({ runtimeRoot: runtime, pythonVersion: audit.version,
    dependencies: manifest.dependencies.length, bytes: manifest.bytes, checkpointSha256: manifest.checkpointSha256,
    startupMs: readyMs, inferenceMs: messages.slice(1).map(message => message.inferenceMs), maximumDifference,
    deterministicReplay: true, relocated: true, networkDenied: true, isolated: true, crt: audit.crt }, null, 2))
} finally {
  if (moved) {
    assert.ok((await realpath(relocated)).startsWith(artifacts + path.sep))
    await rename(relocated, runtime)
  }
  assert.equal(path.dirname(await realpath(scratch)).toLowerCase(), (await realpath(os.tmpdir())).toLowerCase())
  await rm(scratch, { recursive: true, force: true })
}
