import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, copyFile, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceTools } from '../electron/device-source-update.mjs'
import { createServer } from 'node:http'

const execute = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url))
const helper = path.join(root, 'harness-client-plugin/source-node.ps1')
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibanlv node 测试 & '))
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 3 }))
  const cache = path.join(directory, 'tools'), node = path.join(cache, 'ready/node.exe')
  await mkdir(path.join(cache, 'ready/node_modules/npm/bin'), { recursive: true })
  await copyFile(process.execPath, node)
  await writeFile(path.join(cache, 'ready/node_modules/npm/bin/npm-cli.js'), 'console.error("fixture npm warning"); console.log("10.9.2")')
  const script = path.join(directory, 'check.ps1')
  const run = async code => {
    await writeFile(script, '\ufeffparam($Helper, $Cache, $Node)\n$ErrorActionPreference = "Stop"\n[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)\n. $Helper\n' + code)
    return execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, helper, cache, node],
      { windowsHide: true, timeout: 20000 })
  }
  return { directory, cache, node, run }
}

test('Windows Node bootstrap reuses a verified external runtime without changing PATH or requiring a system Node', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  const { stdout } = await f.run('$before = $env:PATH\n$env:NODE_OPTIONS = "--require=C:\\missing-host-loader.cjs"\n$first = Get-AIBanlvSourceNode -Install -CacheDirectory $Cache -Candidates @($Node)\n$lock = [IO.File]::Open((Join-Path $Cache "source-node.lock"), "Open", "ReadWrite", "None")\ntry { $second = Get-AIBanlvSourceNode -CacheDirectory $Cache -Candidates @() } finally { $lock.Dispose() }\nif ($env:PATH -ne $before -or $env:NODE_OPTIONS -ne "--require=C:\\missing-host-loader.cjs") { throw "Environment changed" }\n@{first=$first; second=$second} | ConvertTo-Json')
  assert.deepEqual(JSON.parse(stdout), { first: f.node, second: f.node })
  assert.equal(JSON.parse(await readFile(path.join(f.cache, 'source-node.json'), 'utf8')).node, f.node)
})

test('Windows Node bootstrap rejects corrupt archives and does not register an incomplete runtime', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  await assert.rejects(f.run('$bad = Join-Path $Cache "bad.zip"\n[IO.File]::WriteAllText($bad, "invalid archive")\nGet-AIBanlvSourceNode -Install -CacheDirectory $Cache -Candidates @() -Archive $bad'), /size|SHA-256/)
  await assert.rejects(f.run('$bad = Join-Path $Cache "bad.zip"\n$expected = Get-Content (Join-Path (Split-Path $Helper) "source-node.json") -Raw | ConvertFrom-Json\n$stream = [IO.File]::OpenWrite($bad)\ntry { $stream.SetLength($expected.bytes) } finally { $stream.Dispose() }\nGet-AIBanlvSourceNode -Install -CacheDirectory $Cache -Candidates @() -Archive $bad'), /SHA-256/)
  await assert.rejects(readFile(path.join(f.cache, 'source-node.json')), { code: 'ENOENT' })
})

test('Windows Node probe stops a hanging npm instead of blocking setup indefinitely', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  await writeFile(path.join(path.dirname(f.node), 'node_modules/npm/bin/npm-cli.js'), 'setInterval(() => {}, 1000)')
  const { stdout } = await f.run('Test-AIBanlvSourceNode $Node | ConvertTo-Json')
  assert.equal(JSON.parse(stdout), false)
})

test('Node download has a total body deadline and refuses incomplete payloads', { skip: process.platform !== 'win32' }, async t => {
  let requests = 0
  const f = await fixture(t), server = createServer((_req, response) => {
    requests++
    response.writeHead(200, { 'Content-Length': 16 }); response.write('partial')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  await assert.rejects(f.run(`Save-AIBanlvNodeArchive -Uri 'http://127.0.0.1:${server.address().port}' -File (Join-Path $Cache 'pending.zip') -Bytes 16 -TimeoutSeconds 1`))
  assert.equal(requests, 1)
  await assert.rejects(readFile(path.join(f.cache, 'pending.zip')), { code: 'ENOENT' })
})

test('source updater uses the registered Node/npm without PATH and rejects tools inside the checkout', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), local = path.join(f.directory, 'local'), tools = path.join(local, 'AIBanlv/tools')
  const alias = path.join(f.directory, 'node-alias')
  await symlink(path.dirname(f.node), alias, 'junction')
  f.node = path.join(alias, 'node.exe')
  await mkdir(tools, { recursive: true })
  await writeFile(path.join(tools, 'source-node.json'), JSON.stringify({ node: f.node }))
  const env = { ...process.env, LOCALAPPDATA: local, PATH: path.join(process.env.SystemRoot, 'System32') }
  const selected = await sourceTools(root, env)
  assert.equal(selected.node, await realpath(f.node))
  assert.equal(selected.npm, await realpath(path.join(path.dirname(f.node), 'node_modules/npm/bin/npm-cli.js')))
  await assert.rejects(sourceTools(f.cache, env), { code: 'SOURCE_NODE' })
})
