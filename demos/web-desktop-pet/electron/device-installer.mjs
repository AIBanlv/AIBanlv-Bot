import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareNsis } from '../scripts/device-package-tools.mjs'
import { releaseManifest } from './device-update-release.mjs'
import { createInstallerBlockmap } from './device-update-blockmap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function installerPath(file) {
  if (typeof file !== 'string' || !file || path.win32.isAbsolute(file) || /[\x00-\x1f"*?:]/.test(file)) throw new Error('Unsafe installer path')
  const parts = file.split(/[/\\]/)
  if (parts.some(part => !part || part === '..' || part === '.')) throw new Error('Unsafe installer path')
  const escape = value => value.replace(/\$/g, () => '$$')
  return { parts, target: `"$INSTDIR\\${escape(parts.join('\\'))}"` }
}

export function installPreflightCommands(files) {
  // Check main executables first, then every bundled DLL/runtime/data file.
  // An exited Electron parent does not imply its inference workers have exited.
  const owned = new Set(['AIBanlv.exe', 'ControlDevice.exe', 'Uninstall.exe', '.control-device-install', ...files])
  return [...owned].map(file => {
    const { target } = installerPath(file)
    return `Push ${target}\nCall CheckInstallFileWritable\nStrCmp $LockedFile "" +2\nReturn`
  }).join('\n')
}

export function uninstallCommands(files) {
  const directories = new Set()
  const escape = value => value.replace(/\$/g, () => '$$')
  const commands = files.map(file => {
    const { parts, target } = installerPath(file)
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('\\'))
    return `IfFileExists ${target} 0 +5\nClearErrors\nDelete ${target}\nIfErrors 0 +2\nStrCpy $R9 1`
  })
  for (const directory of [...directories].sort((a, b) => b.split('\\').length - a.split('\\').length)) {
    commands.push(`RMDir "$INSTDIR\\${escape(directory)}"`)
  }
  return commands.join('\n')
}

async function buildInstaller() {
  const build = JSON.parse(await readFile(path.join(root, 'dist/device-latest-win32-x64.json'), 'utf8')
    .catch(error => { if (error.code !== 'ENOENT') throw error; return readFile(path.join(root, 'dist/device-latest.json'), 'utf8') }))
  if (build.target && (build.target.platform !== 'win32' || build.target.arch !== 'x64') || !/\.exe$/i.test(build.executable || '')) {
    throw new Error('Windows installer requires a Windows x64 distribution')
  }
  const files = []
  let installedBytes = 0
  async function walk(directory, prefix = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + item.name
      if (item.isDirectory()) await walk(path.join(directory, item.name), `${relative}/`)
      else if (item.isFile()) {
        files.push(relative)
        installedBytes += (await stat(path.join(directory, item.name))).size
      } else throw new Error('Unexpected package link')
    }
  }
  await walk(build.directory)
  const include = path.join(build.build, 'uninstall-files.nsh')
  await writeFile(include, uninstallCommands(files))
  const preflight = path.join(build.build, 'install-preflight.nsh')
  await writeFile(preflight, installPreflightCommands(files))
  const installer = path.join(root, `dist/AIBanlv-${build.version}-win-x64-Setup.exe`)
  execFileSync(await prepareNsis(), ['/INPUTCHARSET', 'UTF8', '/V2',
    `/DAPPDIR=${path.toNamespacedPath(build.directory)}`, `/DOUTPUT=${installer}`, `/DICON=${build.icon}`, `/DVERSION=${build.version}`,
    `/DSIZE=${Math.ceil(installedBytes / 1024)}`, `/DUNINSTALL_FILES=${include}`, `/DPREFLIGHT_FILES=${preflight}`,
    path.join(root, 'electron/device-installer.nsi')], { windowsHide: true, stdio: 'inherit' })
  const blockmap = await createInstallerBlockmap(installer)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(installer)) hash.update(chunk)
  const result = { installer, bytes: (await stat(installer)).size, installedBytes, sha256: hash.digest('hex'),
    version: build.version, unsigned: true, blockmap }
  await writeFile(`${installer}.sha256`, `${result.sha256}  ${path.basename(installer)}\n`)
  await writeFile(path.join(root, 'dist/device-installer.json'), JSON.stringify(result, null, 2))
  await writeFile(path.join(root, 'dist/latest.json'), JSON.stringify(releaseManifest(result, {
    feedUrl: process.env.PET_DESKTOP_UPDATE_URL, notes: process.env.PET_DESKTOP_UPDATE_NOTES || '',
  }), null, 2))
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildInstaller()
