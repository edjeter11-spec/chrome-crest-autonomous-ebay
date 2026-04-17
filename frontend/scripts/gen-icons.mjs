// Minimal PNG encoder - no deps. Generates a solid black square icon with a red
// block + white "F1" rendered via a tiny pixel font. Output size configurable.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/icons')
mkdirSync(OUT_DIR, { recursive: true })

// 5x7 pixel font glyphs (1 = on)
const GLYPHS = {
  F: [
    '11111',
    '10000',
    '10000',
    '11110',
    '10000',
    '10000',
    '10000',
  ],
  '1': [
    '00100',
    '01100',
    '00100',
    '00100',
    '00100',
    '00100',
    '01110',
  ],
}

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function makePng(size) {
  // build pixel grid: [size][size][3] (R,G,B)
  const BG = [10, 10, 10]       // #0a0a0a
  const RED = [220, 38, 38]     // #dc2626
  const WHITE = [255, 255, 255]

  const px = new Uint8Array(size * size * 3)
  // fill bg
  for (let i = 0; i < size * size; i++) {
    px[i * 3] = BG[0]; px[i * 3 + 1] = BG[1]; px[i * 3 + 2] = BG[2]
  }

  // draw red rounded-ish square centered, 70% size
  const sq = Math.floor(size * 0.7)
  const off = Math.floor((size - sq) / 2)
  const r = Math.floor(sq * 0.18) // corner radius (simple)
  for (let y = 0; y < sq; y++) {
    for (let x = 0; x < sq; x++) {
      // rounded corner check
      const inCorner =
        (x < r && y < r && (r - x) ** 2 + (r - y) ** 2 > r * r) ||
        (x >= sq - r && y < r && (x - (sq - r - 1)) ** 2 + (r - y) ** 2 > r * r) ||
        (x < r && y >= sq - r && (r - x) ** 2 + (y - (sq - r - 1)) ** 2 > r * r) ||
        (x >= sq - r && y >= sq - r && (x - (sq - r - 1)) ** 2 + (y - (sq - r - 1)) ** 2 > r * r)
      if (inCorner) continue
      const idx = ((y + off) * size + (x + off)) * 3
      px[idx] = RED[0]; px[idx + 1] = RED[1]; px[idx + 2] = RED[2]
    }
  }

  // draw "F1" in white on top (centered)
  const text = 'F1'
  const scale = Math.max(2, Math.floor(size / 22))
  const glyphW = 5 * scale
  const glyphH = 7 * scale
  const gap = scale
  const totalW = text.length * glyphW + (text.length - 1) * gap
  const startX = Math.floor((size - totalW) / 2)
  const startY = Math.floor((size - glyphH) / 2)
  for (let gi = 0; gi < text.length; gi++) {
    const g = GLYPHS[text[gi]]
    const gx = startX + gi * (glyphW + gap)
    for (let gy = 0; gy < 7; gy++) {
      for (let gxi = 0; gxi < 5; gxi++) {
        if (g[gy][gxi] === '1') {
          // paint scale x scale block
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px_x = gx + gxi * scale + sx
              const px_y = startY + gy * scale + sy
              if (px_x < 0 || px_x >= size || px_y < 0 || px_y >= size) continue
              const idx = (px_y * size + px_x) * 3
              px[idx] = WHITE[0]; px[idx + 1] = WHITE[1]; px[idx + 2] = WHITE[2]
            }
          }
        }
      }
    }
  }

  // PNG encode
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 2   // color type: RGB
  ihdr[10] = 0  // compression
  ihdr[11] = 0  // filter
  ihdr[12] = 0  // interlace

  // build scanlines with filter byte 0 per row
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    for (let x = 0; x < size * 3; x++) {
      raw[y * (size * 3 + 1) + 1 + x] = px[y * size * 3 + x]
    }
  }
  const idat = deflateSync(raw)

  const buf = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return buf
}

for (const size of [192, 512]) {
  const png = makePng(size)
  const out = resolve(OUT_DIR, `icon-${size}.png`)
  writeFileSync(out, png)
  console.log('wrote', out, png.length, 'bytes')
}
