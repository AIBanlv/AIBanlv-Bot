import path from 'node:path'

export function bundleEntry(root, entry) {
  return path.relative(path.resolve(root, '../../..'), path.join(root, 'electron', entry)).replaceAll('\\', '/')
}
