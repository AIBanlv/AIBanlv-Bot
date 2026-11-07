import { cp, mkdir, mkdtemp, readdir, stat, writeFile, rename, rm, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadRuntime, extractRuntime, fileDigest } from './source-runtime-install.mjs'
import { verifySourceRuntime } from './verify-source-runtime.mjs'
import { stageDevicePython, checkpointSha256 } from './package-device-python.mjs'
import { writeMacBundleManifest } from './install-mac-source.mjs'

const execute = promisify(execFile), demo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const jdkRelease = 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/'
const jdkTargets = {
  'win32-x64': { name: 'OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip', bytes: 190817615, sha256: 'e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0' },
  'darwin-x64': { name: 'OpenJDK17U-jdk_x64_mac_hotspot_17.0.20.1_1.tar.gz', bytes: 180578248, sha256: 'c01975da12ed4235250ff891fe8bba73a9e73037d444b269c9d0922b5dbc8e0a' },
  'darwin-arm64': { name: 'OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.21_9.tar.gz', version: '17.0.21+9', bytes: 186192554,
    url: 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.21%2B9/OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.21_9.tar.gz',
    sha256: '78b08c7f5a0598242d5719c022e19479cb4a3aa45c37c19726a757a469ed1c15' },
}
const gson = { url: 'https://repo.maven.apache.org/maven2/com/google/code/gson/gson/2.11.0/gson-2.11.0.jar',
  bytes: 298435, sha256: '57928d6e5a6edeb2abd3770a8f95ba44dce45f3b23b7a9dc2b309c581552a78b' }
const gsonLicense = { url: 'https://raw.githubusercontent.com/google/gson/gson-parent-2.11.0/LICENSE',
  bytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' }

async function pinnedDownload(requirement, file) {
  if (await fileDigest(file).catch(() => null) === requirement.sha256) return
  const temporary = `${file}.download`
  await rm(temporary, { force: true })
  await downloadRuntime(requirement, temporary, { report: console.log, ranged: false,
    // Upstream GitHub release downloads redirect; published customer resources do not.
    fetch: (url, options) => fetch(url, { ...options, redirect: 'follow' }) })
  await rename(temporary, file)
}

async function treeBytes(directory) {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) total += await treeBytes(file)
    else if (entry.isFile()) total += (await stat(file)).size
    else throw new Error(`Runtime contains a link or special file: ${file}`)
  }
  return total
}

async function main() {
  const version = process.argv.find(arg => arg.startsWith('--version='))?.slice(10)
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version || '')) throw new Error('Usage: npm run runtime:package -- --version=1.0.0')
  const arch = process.argv.find(arg => arg.startsWith('--arch='))?.slice(7) || process.arch
  const prepareOnly = process.argv.includes('--prepare-only')
  if (arch !== process.arch && (process.platform !== 'darwin' || !prepareOnly)) throw new Error('Cross-build only supports Mac --prepare-only candidates; native validation is required before publication')
  if (prepareOnly && !version.includes('-')) throw new Error('Unverified payloads require a prerelease version, for example 1.0.0-candidate.20261105')
  const target = `${process.platform}-${arch}`, jdk = jdkTargets[target]
  if (!jdk) throw new Error('Build on a supported native Windows/Mac target')
  const output = path.join(demo, 'artifacts/source-runtimes', version, target)
  await mkdir(output, { recursive: true })
  const zip = path.join(output, `AIBanlv-runtime-${version}-${target}.zip`)
  if (await stat(zip).catch(() => null)) throw new Error('Runtime archive exists; use a new version or a clean output directory')
  const stage = await mkdtemp(path.join(output, 'stage-'))
  const cache = path.join(demo, 'artifacts/distribution-cache/source-runtime'); await mkdir(cache, { recursive: true })
  try {
    const runtime = path.join(stage, 'runtime'); await mkdir(runtime)
    if (process.platform === 'win32') {
      if (process.env.DEVICE_PYTHON_STAGE) {
        const source = path.resolve(process.env.DEVICE_PYTHON_STAGE)
        for (const name of ['python', 'model', 'python-runtime.json']) await cp(path.join(source, name), path.join(runtime, name), { recursive: true, dereference: true })
      } else await stageDevicePython(runtime)
      if (await fileDigest(path.join(runtime, 'model/pretrained_models/LAM_audio2exp_streaming.tar')) !== checkpointSha256) throw new Error('Original LAM checkpoint mismatch')
    } else {
      const source = path.join(demo, 'artifacts/mac'), mac = path.join(runtime, 'mac'); await mkdir(mac)
      for (const name of ['lam_audio2exp_streaming.mlmodelc', 'names.json', 'model-manifest.json']) await cp(path.join(source, name), path.join(mac, name), { recursive: true, dereference: true })
      await cp(path.join(source, arch, 'lam-worker'), path.join(mac, 'lam-worker'))
      const { assertMacArchitecture } = await import('./mac-package-tools.mjs')
      await assertMacArchitecture(path.join(mac, 'lam-worker'), arch)
    }
    const jdkArchive = path.join(cache, jdk.name)
    const jdkURL = jdk.url || jdkRelease + jdk.name
    await pinnedDownload({ ...jdk, url: jdkURL }, jdkArchive)
    const javaStage = path.join(stage, 'jdk'); await mkdir(javaStage)
    if (process.platform === 'win32') await extractRuntime(jdkArchive, javaStage, 1024 ** 3)
    else await execute('/usr/bin/tar', ['-xzf', jdkArchive, '-C', javaStage], { timeout: 120000 })
    const homes = await readdir(javaStage)
    if (homes.length !== 1) throw new Error('Unexpected JDK archive structure')
    await cp(path.join(javaStage, homes[0], ...(process.platform === 'darwin' ? ['Contents/Home'] : [])), path.join(runtime, 'java'), { recursive: true, dereference: true })
    if (process.platform === 'darwin') {
      const { assertMacArchitecture } = await import('./mac-package-tools.mjs')
      for (const name of ['java', 'javac']) await assertMacArchitecture(path.join(runtime, 'java/bin', name), arch)
    }
    await mkdir(path.join(runtime, 'control'))
    const gsonFile = path.join(cache, 'gson-2.11.0.jar'); await pinnedDownload(gson, gsonFile)
    await cp(gsonFile, path.join(runtime, 'control/gson.jar'))
    await mkdir(path.join(runtime, 'licenses'))
    if (process.platform === 'darwin') {
      await cp(path.resolve(demo, '../../LICENSE'), path.join(runtime, 'licenses/AIBANLV-LICENSE'))
      await mkdir(path.join(runtime, 'sources'))
      await cp(path.join(demo, 'scripts/mac-lam-worker.swift'), path.join(runtime, 'sources/mac-lam-worker.swift'))
      await writeFile(path.join(runtime, 'sources/BUILD.md'), `# Core ML worker corresponding source\n\nThe included mac-lam-worker.swift is the exact source used for this payload. On macOS with Xcode command-line tools:\n\n    xcrun swiftc -O -target ${arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0 mac-lam-worker.swift -o lam-worker\n\nAIBanlv source: https://github.com/AIBanlv/AIBanlv-Bot\nSee ../licenses/AIBANLV-LICENSE. Models retain their own license.\n`)
    }
    const lamSource = process.platform === 'win32' ? path.join(runtime, 'model') : process.env.DEVICE_MODEL_SOURCE ||
      path.resolve(demo, '../../../LAM_Audio2Expression-main/LAM_Audio2Expression-main')
    await cp(path.join(lamSource, 'LICENSE'), path.join(runtime, 'licenses/LAM-LICENSE'))
    const gsonLicenseFile = path.join(cache, 'GSON-LICENSE'); await pinnedDownload(gsonLicense, gsonLicenseFile)
    await cp(gsonLicenseFile, path.join(runtime, 'licenses/GSON-LICENSE'))
    await writeFile(path.join(runtime, 'THIRD-PARTY.txt'), `LAM: https://github.com/aigc3d/LAM_Audio2Expression (Apache-2.0). See licenses/LAM-LICENSE and Python distribution licenses where included.\nGson 2.11.0: https://github.com/google/gson (Apache-2.0), see licenses/GSON-LICENSE.\nEclipse Temurin JDK ${jdk.version || '17.0.20.1+1'}: https://adoptium.net; see java/legal and java/NOTICE.\n${process.platform === 'darwin' ? 'AIBanlv Core ML worker: Apache-2.0; corresponding source in sources/, license in licenses/AIBANLV-LICENSE.\n' : ''}${target === 'darwin-arm64' ? 'Node.js 24.22.2/npm: see tools/node/LICENSE and dependency license files.\n' : ''}`)
    const macArm = target === 'darwin-arm64'
    let node
    if (macArm) {
      node = { version: '24.22.2', name: 'node-v24.22.2-darwin-arm64.tar.gz',
        sha256: 'aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a' }
      const nodeArchive = path.join(cache, node.name)
      if (await fileDigest(nodeArchive).catch(() => null) !== node.sha256) throw new Error(`Download the official pinned Node archive to ${nodeArchive} before packaging`)
      node.bytes = (await stat(nodeArchive)).size
      node.url = `https://nodejs.org/dist/v${node.version}/${node.name}`
      const nodeStage = path.join(stage, 'node'); await mkdir(nodeStage)
      await execute('/usr/bin/tar', ['-xzf', nodeArchive, '-C', nodeStage], { timeout: 120000 })
      const nodeRoot = path.join(runtime, 'tools/node')
      await cp(path.join(nodeStage, `node-v${node.version}-darwin-arm64`), nodeRoot, { recursive: true, dereference: true })
      // Runtime ZIP extraction intentionally rejects symlinks. Supply working
      // command wrappers instead of dereferenced npm scripts with wrong imports.
      for (const [name, entry] of [['npm', 'npm-cli.js'], ['npx', 'npx-cli.js']]) await writeFile(path.join(nodeRoot, 'bin', name),
        `#!/bin/sh\nset -eu\nbin=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)\nexec "$bin/node" "$bin/../lib/node_modules/npm/bin/${entry}" "$@"\n`, { mode: 0o755 })
      const { assertMacArchitecture } = await import('./mac-package-tools.mjs')
      await assertMacArchitecture(path.join(nodeRoot, 'bin/node'), arch)
      await cp(path.join(demo, 'scripts/install-mac-source.mjs'), path.join(runtime, 'install-mac-source.mjs'))
      const nodeHash = await fileDigest(path.join(nodeRoot, 'bin/node'))
      await writeFile(path.join(runtime, 'Install AIBanlv.command'), `#!/bin/sh\nset -eu\nroot=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)\nif [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then\n  echo 'Apple Silicon native macOS required; do not use Rosetta.' >&2; exit 1\nfi\nmajor=$(/usr/bin/sw_vers -productVersion | /usr/bin/cut -d. -f1)\nif [ "$major" -lt 15 ]; then echo 'macOS 15 or newer is required.' >&2; exit 1; fi\nactual=$(/usr/bin/shasum -a 256 "$root/tools/node/bin/node" | /usr/bin/cut -d' ' -f1)\nif [ "$actual" != '${nodeHash}' ]; then echo 'Node integrity check failed; extract the complete archive again.' >&2; exit 1; fi\nunset NODE_OPTIONS ELECTRON_RUN_AS_NODE ELECTRON_NO_ASAR\nexec "$root/tools/node/bin/node" "$root/install-mac-source.mjs" "$@"\n`, { mode: 0o755 })
      await cp(path.join(demo, '../../docs/MAC_SOURCE_BUNDLE.md'), path.join(runtime, 'INSTALL_FOR_AGENTS.md'))
    }
    await writeFile(path.join(runtime, 'source-runtime.json'), JSON.stringify({ schema: 1, version, target,
      jdk: { ...jdk, url: jdkURL }, gson, ...(node ? { node, minimumMacOS: '15.0' } : {}),
      validation: prepareOnly ? 'pending-native' : 'native-engine-verified',
      engine: process.platform === 'win32' ? 'pytorch-original-tar' : 'coreml-ios' }, null, 2))
    const cleanEnv = { ...process.env }
    for (const key of ['JAVA', 'JAVAC', 'GSON_JAR', 'PET_PYTHON', 'PET_LAM_SOURCE', 'PET_MAC_LAM_ROOT']) delete cleanEnv[key]
    if (prepareOnly) console.log('CANDIDATE ONLY: no target-machine inference was run. Do not publish as a verified automatic runtime.')
    else {
      console.log('Verifying original LAM and current Java source with staged runtime…')
      await verifySourceRuntime(runtime, cleanEnv)
    }
    if (macArm) await writeMacBundleManifest(runtime)
    const unpackedBytes = await treeBytes(runtime)
    console.log('Creating runtime archive…')
    await execute(process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32/tar.exe') : '/usr/bin/tar',
      ['--format', 'zip', '-cf', zip + '.tmp', '-C', runtime, ...await readdir(runtime)], { windowsHide: true, timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024 })
    await rename(zip + '.tmp', zip)
    const requirement = { version, platform: process.platform, arch,
      url: `https://download.aibanlv.ai/desktop-runtimes/${version}/${target}/${path.basename(zip)}`,
      bytes: (await stat(zip)).size, unpackedBytes, sha256: await fileDigest(zip) }
    await writeFile(path.join(output, 'requirement.json'), JSON.stringify(requirement, null, 2) + '\n')
    await writeFile(path.join(output, 'validation.json'), JSON.stringify({ target, buildHost: `${process.platform}-${process.arch}`,
      nativeEngineVerified: !prepareOnly, automaticRuntimePublished: false,
      modelIdentity: process.platform === 'darwin' ? JSON.parse(await readFile(path.join(runtime, 'mac/model-manifest.json'), 'utf8')) : undefined }, null, 2) + '\n')
    console.log(JSON.stringify({ archive: zip, requirement }, null, 2))
  } finally { await rm(stage, { recursive: true, force: true, maxRetries: 4 }) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
