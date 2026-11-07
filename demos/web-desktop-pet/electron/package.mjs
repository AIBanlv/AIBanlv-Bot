import { packager } from '@electron/packager'
import { downloadArtifact } from '@electron/get'
import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDemoFiles } from '../server.mjs'
import { controlToolchain } from '../scripts/prepare-control.mjs'
import { bundleEntry } from '../scripts/bundle-entry.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.resolve(root, '../../..')
const control = path.resolve(root, '../..')
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const builds = path.join(root, 'dist')
await mkdir(builds, { recursive: true })
const build = await mkdtemp(path.join(builds, 'build-'))
const stage = path.join(build, 'source')
const checksums = JSON.parse(await readFile(path.join(root, 'node_modules/electron/checksums.json'), 'utf8'))
const version = manifest.devDependencies.electron
// Use the same pinned artifact and checksums as the reviewed Electron installer.
const archive = await downloadArtifact({ version, artifactName: 'electron', platform: 'win32', arch: 'x64',
  checksums, mirrorOptions: { mirror: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/' } })

async function copy(source, relative = path.relative(workspace, source)) {
  const target = path.resolve(stage, relative)
  if (!target.startsWith(`${stage}${path.sep}`)) throw new Error('Bundle source outside workspace')
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(source, target)
}
const bundle = new Set(resolveDemoFiles().values())
bundle.add(path.join(root, 'server.mjs'))
bundle.add(path.join(root, 'package.json'))
bundle.add(path.join(control, 'static/logo.png'))
for (const folder of ['src', 'scripts', 'electron']) {
  for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
    if (entry.isFile() && /\.(mjs|cjs|py|java|html|css)$/.test(entry.name) && entry.name !== 'package.mjs') {
      bundle.add(path.join(root, folder, entry.name))
    }
  }
}
const tools = await controlToolchain()
for (const source of tools.sources) bundle.add(source)
bundle.add(tools.library)
for (const file of bundle) {
  const avatar = resolveDemoFiles().get('/assets/avatar.zip')
  await copy(file, file === avatar ? 'android-framework-new/photo/benny-avatar.zip' : undefined)
}
await copy(tools.jar, 'lib/gson-2.11.0.jar')
const appManifest = { name: 'control-desktop-pet', productName: 'Control Desktop Pet',
  version: manifest.version, private: true, type: 'module',
  main: bundleEntry(root, 'main.mjs') }
await writeFile(path.join(stage, 'package.json'), JSON.stringify(appManifest, null, 2))
const executable = (name) => execFileSync('where.exe', [name], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]
const runtime = {
  PET_PYTHON: process.env.PET_PYTHON || path.join(workspace, '.venv-lam-coreml/Scripts/python.exe'),
  PET_TTS_PYTHON: process.env.PET_TTS_PYTHON || 'F:/Miniconda/python.exe',
  PET_LAM_SOURCE: process.env.PET_LAM_SOURCE || path.join(workspace, 'LAM_Audio2Expression-main/LAM_Audio2Expression-main'),
  JAVA: process.env.JAVA || executable('java'), JAVAC: process.env.JAVAC || executable('javac'),
  GSON_JAR: './lib/gson-2.11.0.jar',
}
await writeFile(path.join(stage, 'runtime.local.json'), JSON.stringify(runtime, null, 2))

// ICO supports PNG payloads; wrap the existing Control brand asset without redrawing it.
const png = await readFile(path.join(control, 'static/logo.png'))
const icon = Buffer.alloc(22)
icon.writeUInt16LE(1, 2)
icon.writeUInt16LE(1, 4)
icon[6] = png.readUInt32BE(16) % 256
icon[7] = png.readUInt32BE(20) % 256
icon.writeUInt16LE(1, 10)
icon.writeUInt16LE(32, 12)
icon.writeUInt32LE(png.length, 14)
icon.writeUInt32LE(22, 18)
const iconPath = path.join(build, 'control.ico')
await writeFile(iconPath, Buffer.concat([icon, png]))
const outputs = await packager({
  dir: stage, out: build, name: 'ControlDesktopPet', executableName: 'ControlDesktopPet',
  platform: 'win32', arch: 'x64', electronVersion: version, electronZipDir: path.dirname(archive),
  appVersion: manifest.version, icon: iconPath, asar: false, prune: false, overwrite: false,
  win32metadata: { CompanyName: 'Control', FileDescription: 'Control Desktop Pet Demo', ProductName: 'Control Desktop Pet' },
})
await writeFile(path.join(outputs[0], 'README.txt'),
  'Control Desktop Pet Demo\r\n\r\nLaunch ControlDesktopPet.exe. Keep the entire folder together.\r\n' +
  'Avatar, renderer and Control postprocessing sources are bundled.\r\n' +
  'Original TAR, Python environments and JDK remain external.\r\n' +
  'Machine paths: resources/app/runtime.local.json\r\n' +
  'No installer, signing, automatic updates or startup registration.\r\n')
await writeFile(path.join(builds, 'latest.json'), JSON.stringify({ directory: outputs[0],
  executable: path.join(outputs[0], 'ControlDesktopPet.exe') }, null, 2))
console.log(`Windows executable: ${path.join(outputs[0], 'ControlDesktopPet.exe')}`)
