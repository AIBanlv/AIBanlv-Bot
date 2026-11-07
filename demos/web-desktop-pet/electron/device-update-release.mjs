import path from 'node:path'
import { DEFAULT_UPDATE_URL, updateSource, updateManifest } from './device-update.mjs'

export function releaseManifest(build, { feedUrl = DEFAULT_UPDATE_URL, notes = '' } = {}) {
  const filename = `AIBanlv-${build.version}-win-x64-Setup.exe`
  if (path.basename(build.installer) !== filename) throw new Error('Installer filename does not match the release version')
  let blockmap
  if (build.blockmap) {
    if (path.basename(build.blockmap.file) !== `${filename}.blockmap`) throw new Error('Blockmap filename does not match installer')
    blockmap = { url: new URL(`${filename}.blockmap`, updateSource(feedUrl)).href,
      bytes: build.blockmap.bytes, sha256: build.blockmap.sha256 }
  }
  return updateManifest({ version: build.version, platform: 'win32', arch: 'x64',
    url: new URL(filename, updateSource(feedUrl)).href, sha256: build.sha256, bytes: build.bytes, notes,
    ...(blockmap ? { blockmap } : {}) }, feedUrl)
}
