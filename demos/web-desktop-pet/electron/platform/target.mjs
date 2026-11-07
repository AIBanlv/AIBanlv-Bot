export function desktopTarget({ platform = process.platform, arch = process.arch } = {}) {
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) return { platform, arch, engine: 'coreml-ios' }
  if (platform === 'win32' && arch === 'x64') return { platform, arch, engine: 'pytorch-original-tar' }
  throw new Error(`Unsupported desktop target: ${platform}-${arch}`)
}

export function buildTarget(args = process.argv.slice(2), env = process.env) {
  const option = name => args.find(value => value.startsWith(`--${name}=`))?.split('=')[1]
  return desktopTarget({ platform: option('platform') || env.DEVICE_PLATFORM || process.platform,
    arch: option('arch') || env.DEVICE_ARCH || process.arch })
}
