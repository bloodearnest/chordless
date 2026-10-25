/**
 * MD5 of a string's UTF-8 bytes, as lower-case hex: the same value Google Drive reports as a
 * file's md5Checksum. WebCrypto has no MD5 (it is broken for security), but here it only checks
 * that Drive stored the bytes we sent, so it is fine.
 */
import { toHex } from './bytes.ts'

const SHIFTS = [
  ...Array(4).fill([7, 12, 17, 22]).flat(),
  ...Array(4).fill([5, 9, 14, 20]).flat(),
  ...Array(4).fill([4, 11, 16, 23]).flat(),
  ...Array(4).fill([6, 10, 15, 21]).flat(),
]
const CONSTANTS = Array.from(
  { length: 64 },
  (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0
)

export function md5Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const length = bytes.length
  // The bytes, a 1 bit, zeros, then the length in bits as 64 bits, to a multiple of 64 bytes
  const padded = new Uint8Array((((length + 8) >> 6) + 1) << 6)
  padded.set(bytes)
  padded[length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, (length << 3) >>> 0, true)
  view.setUint32(padded.length - 4, length >>> 29, true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89 | 0
  let c0 = 0x98badcfe | 0
  let d0 = 0x10325476
  for (let offset = 0; offset < padded.length; offset += 64) {
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      f = (f + a + CONSTANTS[i] + view.getUint32(offset + g * 4, true)) | 0
      a = d
      d = c
      c = b
      b = (b + ((f << SHIFTS[i]) | (f >>> (32 - SHIFTS[i])))) | 0
    }
    a0 = (a0 + a) | 0
    b0 = (b0 + b) | 0
    c0 = (c0 + c) | 0
    d0 = (d0 + d) | 0
  }

  const out = new DataView(new ArrayBuffer(16))
  for (const [i, word] of [a0, b0, c0, d0].entries()) out.setInt32(i * 4, word, true)
  return toHex(new Uint8Array(out.buffer))
}
