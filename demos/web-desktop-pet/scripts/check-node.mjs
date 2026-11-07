import * as zlib from 'node:zlib'
if (Number(process.versions.node.split('.')[0]) < 24 || typeof zlib.createZstdCompress !== 'function') {
  throw new Error(`Harness requires Node.js 24+ with native Zstd support; current Node is ${process.versions.node}. Packaged Electron supplies its own runtime.`)
}
