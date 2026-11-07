import vm from 'node:vm'
import path from 'node:path'
import { isBuiltin } from 'node:module'
import { readFile, realpath } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Parse and resolve the packaged main-process graph without evaluating it:
// build checks must never open windows, connect accounts or start inference.
export async function verifyDeviceEntry(entry, directory) {
  if (!vm.SourceTextModule) throw new Error('Entry verification requires --experimental-vm-modules')
  const root = await realpath(directory), visited = new Set(), packages = new Set()
  async function contained(file) {
    const actual = await realpath(file)
    const relative = path.relative(root, actual)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Packaged import escapes distribution: ${file}`)
    }
    return actual
  }
  async function visit(file) {
    file = await contained(file)
    if (visited.has(file)) return
    visited.add(file)
    const url = pathToFileURL(file).href
    const module = new vm.SourceTextModule(await readFile(file, 'utf8'), { identifier: url })
    for (const specifier of module.dependencySpecifiers) {
      // Electron is supplied by the packaged executable, not node_modules.
      if (isBuiltin(specifier) || specifier === 'electron') continue
      try {
        const resolved = import.meta.resolve(specifier, url)
        if (!resolved.startsWith('file:')) throw new Error('Unsupported runtime import URL')
        const target = await contained(fileURLToPath(resolved))
        if (target.split(path.sep).includes('node_modules')) packages.add(specifier)
        else if (/\.[cm]?js$/.test(target)) await visit(target)
      } catch (error) {
        throw new Error(`Packaged import ${JSON.stringify(specifier)} from ${path.relative(root, file)}: ${error.message}`, { cause: error })
      }
    }
  }
  await visit(entry)
  return { modules: visited.size, packages: [...packages].sort() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyDeviceEntry(process.argv[2], process.argv[3])))
}
