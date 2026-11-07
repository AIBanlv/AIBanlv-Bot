import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, access, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cache = path.join(root, 'artifacts/distribution-cache')

async function download(name, url, sha256) {
  await mkdir(cache, { recursive: true })
  const file = path.join(cache, name)
  let bytes
  try { bytes = await readFile(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!bytes) {
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) })
    if (!response.ok) throw new Error(`Tool download failed: ${name} (${response.status})`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error(`Tool checksum mismatch: ${name}`)
  await writeFile(file, bytes)
  return file
}

export async function prepareJava() {
  if (process.env.DEVICE_JAVA_HOME) return path.resolve(process.env.DEVICE_JAVA_HOME)
  const directory = path.join(cache, 'temurin17')
  const home = path.join(directory, 'jdk-17.0.20.1+1-jre')
  try { await access(path.join(home, 'bin/java.exe')); return home } catch {}
  const zip = await download('temurin17.zip',
    'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jre_x64_windows_hotspot_17.0.20.1_1.zip',
    'bc21a93923103cdaac93ee337b0ae4365e739fde36df823dd456bc67c8a9d352')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Expand-Archive -LiteralPath $env:CONTROL_TOOL_ARCHIVE -DestinationPath $env:CONTROL_TOOL_OUTPUT'],
  { windowsHide: true, stdio: 'inherit', env: { ...process.env, CONTROL_TOOL_ARCHIVE: zip, CONTROL_TOOL_OUTPUT: directory } })
  return home
}

export async function preparePythonCrt(python) {
  const source = path.join(await prepareJava(), 'bin/msvcp140.dll')
  const sha256 = 'a4c2229bdc2a2a630acdc095b4d86008e5c3e3bc7773174354f3da4f5beb9cde'
  if (createHash('sha256').update(await readFile(source)).digest('hex') !== sha256) {
    throw new Error('MSVC runtime checksum mismatch')
  }
  const licenseUrl = 'https://visualstudio.microsoft.com/wp-content/uploads/2021/09/Visual-C-Runtime-2015-2022-License-1.docx'
  const license = await download('MSVC-LICENSE.docx', licenseUrl,
    'f1e3d56ceb2ad68aae0711b910375009e651ac5530fa0760f0dea6e81e54fae1')
  await copyFile(source, path.join(python, 'msvcp140.dll'))
  await copyFile(license, path.join(python, 'MSVC-LICENSE.docx'))
  return { file: 'msvcp140.dll', sha256, source: 'Eclipse Temurin JRE 17.0.20.1+1',
    license: 'MSVC-LICENSE.docx', licenseUrl }
}

export async function prepareNsis() {
  if (process.env.MAKENSIS) return path.resolve(process.env.MAKENSIS)
  const directory = path.join(cache, 'nsis')
  const compiler = path.join(directory, 'Bin/makensis.exe')
  try { await access(compiler); return compiler } catch {}
  const archive = await download('nsis-3.0.4.1.7z',
    'https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z',
    '9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa')
  const sevenZip = await download('7zr.exe', 'https://www.7-zip.org/a/7zr.exe',
    '256feca8e274e5da655e2a284fabafd9f554365eb164862089dacd4e8276d282')
  execFileSync(sevenZip, ['x', archive, `-o${directory}`, '-y'], { windowsHide: true, stdio: 'inherit' })
  return compiler
}
