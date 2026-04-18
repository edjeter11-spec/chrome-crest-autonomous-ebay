// Pure-Node 1200x630 OG image generator. No deps.
// Black background, red F1 badge, "F1 Card Hub" title, tagline, stats strip.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../public/og-image.png')
mkdirSync(dirname(OUT), { recursive: true })

const W = 1200, H = 630

// Colors
const BG = [10, 10, 10]        // #0a0a0a
const RED = [220, 38, 38]      // #dc2626
const RED_DARK = [140, 20, 20]
const WHITE = [255, 255, 255]
const GRAY = [170, 170, 175]
const DARK_GRAY = [50, 50, 55]

// 5x7 pixel font
const GLYPHS = {
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'B': ['11110','10001','10001','11110','10001','10001','11110'],
  'C': ['01111','10000','10000','10000','10000','10000','01111'],
  'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'],
  'F': ['11111','10000','10000','11110','10000','10000','10000'],
  'G': ['01111','10000','10000','10111','10001','10001','01111'],
  'H': ['10001','10001','10001','11111','10001','10001','10001'],
  'I': ['01110','00100','00100','00100','00100','00100','01110'],
  'J': ['00111','00010','00010','00010','00010','10010','01100'],
  'K': ['10001','10010','10100','11000','10100','10010','10001'],
  'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'M': ['10001','11011','10101','10101','10001','10001','10001'],
  'N': ['10001','11001','10101','10101','10101','10011','10001'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'Q': ['01110','10001','10001','10001','10101','10010','01101'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
  'U': ['10001','10001','10001','10001','10001','10001','01110'],
  'V': ['10001','10001','10001','10001','10001','01010','00100'],
  'W': ['10001','10001','10001','10101','10101','11011','10001'],
  'X': ['10001','10001','01010','00100','01010','10001','10001'],
  'Y': ['10001','10001','01010','00100','00100','00100','00100'],
  'Z': ['11111','00001','00010','00100','01000','10000','11111'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  '.': ['00000','00000','00000','00000','00000','00000','00100'],
  ',': ['00000','00000','00000','00000','00000','00100','01000'],
  '$': ['00100','01111','10100','01110','00101','11110','00100'],
  "'": ['00100','00100','00000','00000','00000','00000','00000'],
  '-': ['00000','00000','00000','01110','00000','00000','00000'],
  '!': ['00100','00100','00100','00100','00100','00000','00100'],
  '·': ['00000','00000','00000','00100','00000','00000','00000'],
  'k': ['00000','10000','10000','10010','10100','11000','10100'],
  'K': ['10001','10010','10100','11000','10100','10010','10001'],
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

// Pixel buffer
const px = new Uint8Array(W * H * 3)
function setPx(x, y, c) {
  if (x < 0 || x >= W || y < 0 || y >= H) return
  const i = (y * W + x) * 3
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]
}
function fillRect(x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++)
      setPx(x, y, c)
}
function fillRounded(x0, y0, w, h, r, c) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inCorner =
        (x < r && y < r && (r - x) ** 2 + (r - y) ** 2 > r * r) ||
        (x >= w - r && y < r && (x - (w - r - 1)) ** 2 + (r - y) ** 2 > r * r) ||
        (x < r && y >= h - r && (r - x) ** 2 + (y - (h - r - 1)) ** 2 > r * r) ||
        (x >= w - r && y >= h - r && (x - (w - r - 1)) ** 2 + (y - (h - r - 1)) ** 2 > r * r)
      if (inCorner) continue
      setPx(x0 + x, y0 + y, c)
    }
  }
}
function drawText(text, x, y, scale, color) {
  const ch = text.toUpperCase()
  const gw = 5 * scale, gh = 7 * scale, gap = scale
  for (let i = 0; i < ch.length; i++) {
    const glyph = GLYPHS[ch[i]] || GLYPHS[text[i]] || GLYPHS[' ']
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] === '1') {
          for (let sy = 0; sy < scale; sy++)
            for (let sx = 0; sx < scale; sx++)
              setPx(x + i * (gw + gap) + gx * scale + sx, y + gy * scale + sy, color)
        }
      }
    }
  }
  return x + ch.length * (gw + gap) - gap
}
function textWidth(text, scale) {
  const gw = 5 * scale, gap = scale
  return text.length * (gw + gap) - gap
}

// --- Compose ---
// Background
fillRect(0, 0, W, H, BG)

// Subtle red gradient strip on left edge
for (let y = 0; y < H; y++) {
  for (let x = 0; x < 8; x++) {
    setPx(x, y, RED)
  }
}

// Red badge top-left
fillRounded(70, 70, 160, 160, 28, RED)
// "F1" on badge — huge
{
  const scale = 10
  const label = 'F1'
  const tw = textWidth(label, scale)
  const th = 7 * scale
  drawText(label, 70 + Math.floor((160 - tw) / 2), 70 + Math.floor((160 - th) / 2), scale, WHITE)
}

// Main title "F1 CARD HUB" — huge
{
  const title = 'F1 CARD HUB'
  const scale = 18
  const tw = textWidth(title, scale)
  drawText(title, Math.floor((W - tw) / 2), 280, scale, WHITE)
}

// Subtitle
{
  const sub = '2025 TOPPS CHROME F1 TRACKER'
  const scale = 6
  const tw = textWidth(sub, scale)
  drawText(sub, Math.floor((W - tw) / 2), 430, scale, GRAY)
}

// Gradient accent bar
fillRect(Math.floor(W / 2) - 200, 495, 400, 4, RED)

// Stats strip bottom
{
  const stats = '3172 SALES  ·  $89K TRACKED  ·  45 GRADED  ·  EVERY DRIVER'
  const scale = 4
  const tw = textWidth(stats, scale)
  drawText(stats, Math.floor((W - tw) / 2), 555, scale, GRAY)
}

// --- PNG encode ---
const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

const raw = Buffer.alloc(H * (W * 3 + 1))
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0
  for (let x = 0; x < W * 3; x++) {
    raw[y * (W * 3 + 1) + 1 + x] = px[y * W * 3 + x]
  }
}
const idat = deflateSync(raw)

const buf = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(OUT, buf)
console.log('wrote', OUT, buf.length, 'bytes', `(${W}x${H})`)
