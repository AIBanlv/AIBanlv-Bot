import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pauseAutomaticLaunch } from '../harness-client-plugin/desktop-launch.mjs'

const execute = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url))
test('Windows source setup produces a usable shortcut and MCP config; cached plugin runs real stdio', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibanlv 源码 & '))
  const heldProcesses = []
  t.after(async () => {
    for (const { child } of heldProcesses) child.stdin.end()
    await Promise.all(heldProcesses.map(({ exited }) => exited))
    await rm(directory, { recursive: true, force: true })
  })
  // A supplementary character exposes ANSI shortcut paths even on Chinese Windows.
  const profile = path.join(directory, 'profile'), desktop = path.join(directory, 'desktop-\u{1d11e}'), output = path.join(directory, 'config')
  const local = path.join(directory, 'local'), tools = path.join(local, 'AIBanlv/tools')
  await mkdir(tools, { recursive: true })
  await writeFile(path.join(tools, 'source-node.json'), JSON.stringify({ node: process.execPath }))
  // Simulate a new user with no Node/npm on PATH, including a cached host plugin.
  const env = { ...process.env, PET_DEVICE_USER_DATA: profile, LOCALAPPDATA: local, NODE_OPTIONS: '--require=C:\\missing-host-loader.cjs',
    PATH: [path.join(process.env.SystemRoot, 'System32'), path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')].join(path.delimiter) }; delete env.ELECTRON_RUN_AS_NODE
  const result = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/setup-source.ps1'),
    '-SkipInstall', '-DesktopDirectory', desktop, '-OutputDirectory', output], { env, windowsHide: true, timeout: 30000 })
  assert.match(result.stdout, /Desktop shortcut/)
  const config = JSON.parse(await readFile(path.join(output, 'workbuddy-mcp.json'), 'utf8'))
  assert.match(config.mcpServers.aibanlv.args[0], /desktop-mcp.mjs$/)
  assert.equal(config.mcpServers.aibanlv.env.ELECTRON_RUN_AS_NODE, '1')
  const settings = JSON.parse(await readFile(path.join(profile, 'desktop-launch.json'), 'utf8'))
  assert.equal(settings.kind, 'source')
  // PowerShell normalizes the drive letter to uppercase while import.meta.url keeps
  // the invocation casing; Windows paths compare case-insensitively.
  assert.equal(path.resolve(settings.root).toLowerCase(), path.resolve(root).toLowerCase())
  const inspect = path.join(directory, 'inspect.ps1')
  await writeFile(inspect, 'param($Link)\n$s = (New-Object -ComObject Shell.Application).NameSpace((Split-Path $Link)).ParseName((Split-Path $Link -Leaf)).GetLink\n$icon = ""\n$index = $s.GetIconLocation([ref]$icon)\n@{target=$s.Path; arguments=$s.Arguments; icon="$icon,$index"} | ConvertTo-Json\n')
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', inspect,
    path.join(desktop, 'AIBanlv Source.lnk')], { windowsHide: true })
  const shortcut = JSON.parse(stdout)
  assert.match(shortcut.target, /powershell.exe$/i); assert.match(shortcut.arguments, /-Source$/)
  assert.match(shortcut.icon, /aibanlv.ico,0$/)

  // Run the complete setup orchestration against a tiny offline checkout. The
  // real npm installs its empty lockfile and the setup child must inherit Node.
  const checkout = path.join(directory, 'fresh checkout'), demo = path.join(checkout, 'demos/web-desktop-pet')
  await mkdir(path.join(demo, 'scripts'), { recursive: true })
  for (const name of ['setup-source.ps1', 'check-source-idle.mjs']) {
    await cp(path.join(root, 'scripts', name), path.join(demo, 'scripts', name))
  }
  await cp(path.join(root, 'harness-client-plugin'), path.join(demo, 'harness-client-plugin'), { recursive: true })
  const repoManifest = JSON.parse(await readFile(path.resolve(root, '../../package.json'), 'utf8'))
  await writeFile(path.join(checkout, 'package.json'), JSON.stringify({ name: 'bootstrap-fixture', version: '1.0.0',
    scripts: { setup: 'node setup.cjs', 'setup:deps': repoManifest.scripts['setup:deps'] } }))
  await writeFile(path.join(checkout, 'package-lock.json'), JSON.stringify({ name: 'bootstrap-fixture', version: '1.0.0', lockfileVersion: 3,
    packages: { '': { name: 'bootstrap-fixture', version: '1.0.0' } } }))
  await writeFile(path.join(checkout, 'setup.cjs'), `require('fs').writeFileSync('used-node.json', JSON.stringify({file:process.execPath, major:Number(process.versions.node.split('.')[0])}))`)
  await writeFile(path.join(demo, 'package.json'), JSON.stringify({ name: 'control-web-desktop-pet-demo' }))
  await mkdir(path.join(demo, 'node_modules/electron/dist'), { recursive: true })
  await mkdir(path.join(demo, 'electron'))
  await writeFile(path.join(demo, 'node_modules/electron/dist/electron.exe'), '')
  await writeFile(path.join(demo, 'electron/device-main.mjs'), '')
  const git = (await execute('where.exe', ['git.exe'])).stdout.trim().split(/\r?\n/)[0]
  await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(demo, 'scripts/setup-source.ps1'),
    '-DesktopDirectory', path.join(directory, 'fresh-desktop'), '-OutputDirectory', path.join(directory, 'fresh-config')],
  { windowsHide: true, timeout: 30000, env: { ...env, PET_DEVICE_USER_DATA: path.join(directory, 'fresh-profile'),
    PATH: env.PATH + path.delimiter + path.dirname(git), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_offline: 'true' } })
  const usedNode = JSON.parse(await readFile(path.join(checkout, 'used-node.json'), 'utf8'))
  assert.ok(usedNode.major >= 24)
  assert.equal(usedNode.file.toLowerCase(), process.execPath.toLowerCase())

  // A running desktop or MCP process must be detected before npm ci removes
  // anything. Another checkout's Electron must not block this setup.
  const fixtureElectron = path.join(demo, 'node_modules/electron/dist/electron.exe')
  await cp(process.execPath, fixtureElectron)
  const foreignElectron = path.join(directory, 'other checkout/electron.exe')
  await mkdir(path.dirname(foreignElectron)); await cp(process.execPath, foreignElectron)
  async function hold(file) {
    const child = spawn(file, ['-e', 'process.stdout.write("ready");process.stdin.resume()'], { windowsHide: true })
    const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve) })
    heldProcesses.push({ child, exited })
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject) })
    return { child, exited }
  }
  const foreign = await hold(foreignElectron), owned = await hold(fixtureElectron)
  const marker = path.join(checkout, 'node_modules/setup-preserve.txt')
  await mkdir(path.dirname(marker), { recursive: true }); await writeFile(marker, 'keep')
  const setupArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(demo, 'scripts/setup-source.ps1'),
    '-DesktopDirectory', path.join(directory, 'fresh-desktop'), '-OutputDirectory', path.join(directory, 'fresh-config')]
  const setupOptions = { windowsHide: true, timeout: 30000, env: { ...env, PET_DEVICE_USER_DATA: path.join(directory, 'fresh-profile'),
    PATH: env.PATH + path.delimiter + path.dirname(git), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_offline: 'true' } }
  try {
    let failureLog
    await assert.rejects(execute('powershell.exe', setupArgs, setupOptions), error => {
      assert.match(error.stdout + error.stderr, /AIBANLV_SOURCE_IN_USE/)
      failureLog = error.stdout.match(/Setup log: ([^\r\n]+)/)?.[1]
      assert.ok(failureLog)
      return true
    })
    assert.match(await readFile(failureLog, 'utf8'), /AIBANLV_SOURCE_IN_USE/)
    const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    await assert.rejects(execute(process.execPath, [npm, 'run', 'setup:deps'], { cwd: checkout, windowsHide: true, timeout: 15000 }),
      error => { assert.match(error.stdout + error.stderr, /AIBANLV_SOURCE_IN_USE/); return true })
    assert.equal(await readFile(marker, 'utf8'), 'keep')
    assert.equal(owned.child.exitCode, null, 'setup must not terminate active work')
    owned.child.stdin.end(); await owned.exited
    await execute('powershell.exe', setupArgs, setupOptions)
    assert.equal(foreign.child.exitCode, null)
  } finally {
    owned.child.stdin.end(); foreign.child.stdin.end()
    await Promise.all([owned.exited, foreign.exited])
  }

  await writeFile(path.join(checkout, 'setup.cjs'), 'console.error("SETUP_FIXTURE_ROOT_CAUSE");process.exit(23)')
  let failureLog
  await assert.rejects(execute('powershell.exe', setupArgs, setupOptions), error => {
    assert.match(error.stdout, /setup failed:.*exit 23/)
    failureLog = error.stdout.match(/Setup log: ([^\r\n]+)/)?.[1]
    return true
  })
  assert.match(await readFile(failureLog, 'utf8'), /SETUP_FIXTURE_ROOT_CAUSE/)

  // A host installs a copy of the plugin, with no adjacent checkout. Paused startup
  // keeps this protocol check away from production services and real conversations.
  const cached = path.join(directory, 'cached plugin'); await mkdir(cached)
  await cp(path.join(root, 'harness-client-plugin'), cached, { recursive: true })
  pauseAutomaticLaunch(profile)
  const automatic = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(cached, 'run.ps1'), '-Automatic'],
    { env, windowsHide: true, timeout: 10000 })
  assert.equal(automatic.stderr, '')
  const hook = JSON.parse(await readFile(path.join(cached, 'hooks/hooks.json'), 'utf8')).hooks.SessionStart[0].hooks[0]
  const hookRun = await execute(shortcut.target, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', hook.commandWindows.split(' -EncodedCommand ')[1]],
    { env: { ...env, PLUGIN_ROOT: cached }, windowsHide: true, timeout: 10000 })
  assert.equal(hookRun.stderr, '', 'the exact Codex hook also works from a cached path')
  const child = spawn(config.mcpServers.aibanlv.command, [path.join(cached, 'desktop-mcp.mjs')],
    { env: { ...env, ...config.mcpServers.aibanlv.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  t.after(() => child.kill())
  let data = '', errors = ''; child.stdout.on('data', chunk => { data += chunk }); child.stderr.on('data', chunk => { errors += chunk })
  const exited = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
  const timeout = setTimeout(() => child.kill(), 10000)
  child.stdin.end('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aibanlv_status"}}\n')
  try { assert.equal(await exited, 0, `${errors}\nstdout: ${data}`) } finally { clearTimeout(timeout) }
  assert.equal(errors, '')
  const responses = data.trim().split('\n').map(JSON.parse)
  assert.equal(responses.length, 2)
  assert.deepEqual(JSON.parse(responses[1].result.content[0].text), { configured: true, kind: 'source', autoStart: true, paused: true })
})
