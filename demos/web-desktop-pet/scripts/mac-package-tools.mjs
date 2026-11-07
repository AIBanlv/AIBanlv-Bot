import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cache = path.join(root, 'artifacts/distribution-cache')
const runtimes = {
  x64: { name: 'x64', sha: '333cb81123c36568586646c73c8fa2326dab8badc43f5ea388a90fff59c9df27' },
  arm64: { name: 'aarch64', sha: '190480874ccceb358cbc840393207f77ac3e63a4c5f8129d0e23e9518b96ad05' },
}

export async function prepareMacJava(arch) {
  if (!runtimes[arch]) throw new Error('Unsupported Mac Java architecture')
  if (process.env.DEVICE_JAVA_HOME) {
    const home = path.resolve(process.env.DEVICE_JAVA_HOME)
    assertMacArchitecture(path.join(home, 'bin/java'), arch)
    return home
  }
  const target = path.join(cache, `temurin17-mac-${arch}`)
  const home = path.join(target, 'jdk-17.0.20.1+1-jre/Contents/Home')
  try { await access(path.join(home, 'bin/java')) } catch {
    const spec = runtimes[arch]
    const name = `OpenJDK17U-jre_${spec.name}_mac_hotspot_17.0.20.1_1.tar.gz`
    const archive = path.join(cache, name)
    await mkdir(cache, { recursive: true })
    let bytes
    try { bytes = await readFile(archive) } catch {
      // macOS ships curl; it uses the host's proxy settings and can resume a
      // slow download without accepting an incomplete archive into the cache.
      execFileSync('curl', ['--fail', '--location', '--retry', '2', '--connect-timeout', '20', '--max-time', '900',
        '--continue-at', '-', '--output', `${archive}.part`,
        process.env.DEVICE_JAVA_MIRROR
          ? `${process.env.DEVICE_JAVA_MIRROR.replace(/\/$/, '')}/${spec.name}/mac/${name}`
          : `https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/${name}`], { stdio: 'inherit' })
      bytes = await readFile(`${archive}.part`)
      if (createHash('sha256').update(bytes).digest('hex') !== spec.sha) throw new Error('Mac Java checksum mismatch')
      await rename(`${archive}.part`, archive)
    }
    if (createHash('sha256').update(bytes).digest('hex') !== spec.sha) throw new Error('Mac Java checksum mismatch')
    await mkdir(target, { recursive: true })
    execFileSync('tar', ['-xzf', archive, '-C', target], { stdio: 'inherit' })
  }
  assertMacArchitecture(path.join(home, 'bin/java'), arch)
  assertMacArchitecture(path.join(home, 'lib/server/libjvm.dylib'), arch)
  return home
}

export function assertMacArchitecture(file, arch) {
  const architectures = execFileSync('lipo', ['-archs', file], { encoding: 'utf8' }).trim().split(/\s+/)
  if (!architectures.includes(arch === 'x64' ? 'x86_64' : arch)) throw new Error(`Wrong ${arch} runtime: ${file}`)
}
