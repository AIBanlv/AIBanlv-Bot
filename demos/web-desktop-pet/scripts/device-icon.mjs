import { inflateSync } from 'node:zlib'

// Convert the repository-owned RGBA PNG into standard multi-size Windows DIB icons.
// No runtime image dependency, downloaded artwork or modification of the source PNG.
export function windowsIcon(png, sizes = [16, 20, 24, 32, 40, 48, 64, 192, 256]) {
  if (!Buffer.isBuffer(png) || png.length < 33 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid icon PNG')
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
  if (!width || !height || width > 2048 || height > 2048 || png[24] !== 8 || png[25] !== 6 || png[28] !== 0) throw new Error('Icon requires non-interlaced 8-bit RGBA PNG')
  const chunks = []
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset)
    if (offset + length + 12 > png.length) throw new Error('Truncated icon PNG')
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const stride = width * 4, raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height })
  if (raw.length !== (stride + 1) * height) throw new Error('Invalid icon pixel size')
  const rgba = Buffer.alloc(stride * height)
  const paeth = (a, b, c) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c }
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    if (filter > 4) throw new Error('Invalid icon PNG filter')
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? rgba[i - 4] : 0, b = y ? rgba[i - stride] : 0, c = y && x >= 4 ? rgba[i - stride - 4] : 0
      rgba[i] = (raw[y * (stride + 1) + 1 + x] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) & 255
    }
  }
  const images = sizes.map(size => {
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error('Invalid ICO size')
    const maskStride = Math.ceil(size / 32) * 4
    const dib = Buffer.alloc(40 + size * size * 4 + maskStride * size)
    dib.writeUInt32LE(40, 0); dib.writeInt32LE(size, 4); dib.writeInt32LE(size * 2, 8)
    dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(size * size * 4, 20)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const sx = Math.max(0, (x + .5) * width / size - .5), sy = Math.max(0, (y + .5) * height / size - .5)
      const x0 = Math.min(width - 1, Math.floor(sx)), y0 = Math.min(height - 1, Math.floor(sy)), dx = sx - x0, dy = sy - y0
      const samples = [[x0, y0, (1-dx)*(1-dy)], [Math.min(width-1,x0+1), y0, dx*(1-dy)],
        [x0, Math.min(height-1,y0+1), (1-dx)*dy], [Math.min(width-1,x0+1), Math.min(height-1,y0+1), dx*dy]]
      const pixel = [0, 0, 0, 0]
      for (const [xx, yy, weight] of samples) {
        const i = (yy * width + xx) * 4, alpha = rgba[i+3] / 255
        for (let c = 0; c < 3; c++) pixel[c] += rgba[i+c] * alpha * weight
        pixel[3] += alpha * weight
      }
      const target = 40 + ((size - 1 - y) * size + x) * 4
      for (let c = 0; c < 3; c++) dib[target + 2 - c] = pixel[3] ? Math.round(pixel[c] / pixel[3]) : 0
      dib[target+3] = Math.round(pixel[3] * 255)
      if (!dib[target+3]) dib[40 + size*size*4 + (size-1-y)*maskStride + Math.floor(x/8)] |= 128 >> (x%8)
    }
    return dib
  })
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  for (let i = 0; i < sizes.length; i++) {
    const entry = 6 + i * 16
    header[entry] = header[entry+1] = sizes[i] % 256
    header.writeUInt16LE(1, entry+4); header.writeUInt16LE(32, entry+6)
    header.writeUInt32LE(images[i].length, entry+8); header.writeUInt32LE(offset, entry+12)
    offset += images[i].length
  }
  return Buffer.concat([header, ...images])
}
