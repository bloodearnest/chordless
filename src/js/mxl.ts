/**
 * `.mxl`, the compressed form of MusicXML that notation programs (MuseScore, Sibelius, Dorico)
 * write and read: a zip holding `META-INF/container.xml`, which names the score, and the score.
 * This is the file a melody is kept in in Drive (docs/LEAD_SHEETS.md): a 60 KB score is about 3 KB.
 *
 * The zip is read and written by hand, with the browser's own `CompressionStream` for the
 * deflate: a score is one small file, so there is no zip64, no encryption and no multi-disk. A
 * file that is not a plain zip is no `.mxl` (the reader says null). Sizes are checked as the
 * file is inflated, not taken from its header, so a small file cannot be made to inflate to
 * gigabytes.
 *
 * The bytes written are the same for the same score, so rewriting an unchanged score does not
 * make a different file: the zip's time is fixed, not the time it was written.
 */

/** The most a score may inflate to. The largest of 137 lead sheets is 150 KB. */
const MAX_SCORE = 16 * 1024 * 1024

const LOCAL_FILE = 0x04034b50
const CENTRAL_FILE = 0x02014b50
const END_OF_CENTRAL = 0x06054b50

/** 1 January 1980, 00:00: the zip's own epoch, so a file is the same whenever it is written */
const DOS_DATE = (0 << 9) | (1 << 5) | 1
const DOS_TIME = 0

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Bytes through a (de)compression stream, giving up if more than `limit` come out */
async function through(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit = Number.POSITIVE_INFINITY
): Promise<Uint8Array | null> {
  const reader = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    .getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles><rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`

interface Entry {
  name: Uint8Array
  data: Uint8Array
  compressed: Uint8Array
  crc: number
}

/** The `.mxl` of a MusicXML score */
export async function writeMxl(xml: string): Promise<Uint8Array> {
  const text = new TextEncoder()
  const entries: Entry[] = []
  for (const [name, content] of [
    ['META-INF/container.xml', CONTAINER],
    ['score.xml', xml],
  ] as const) {
    const data = text.encode(content)
    const compressed = (await through(data, new CompressionStream('deflate-raw'))) as Uint8Array
    entries.push({ name: text.encode(name), data, compressed, crc: crc32(data) })
  }

  const local = entries.map(entry => {
    const header = new DataView(new ArrayBuffer(30))
    header.setUint32(0, LOCAL_FILE, true)
    header.setUint16(4, 20, true) // version needed: 2.0, for deflate
    header.setUint16(6, 0x0800, true) // flags: the name is UTF-8
    header.setUint16(8, 8, true) // deflate
    header.setUint16(10, DOS_TIME, true)
    header.setUint16(12, DOS_DATE, true)
    header.setUint32(14, entry.crc, true)
    header.setUint32(18, entry.compressed.length, true)
    header.setUint32(22, entry.data.length, true)
    header.setUint16(26, entry.name.length, true)
    return header
  })

  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let offset = 0
  for (const [i, entry] of entries.entries()) {
    offsets.push(offset)
    for (const part of [
      new Uint8Array((local[i] as DataView).buffer),
      entry.name,
      entry.compressed,
    ]) {
      parts.push(part)
      offset += part.length
    }
  }
  const centralStart = offset
  for (const [i, entry] of entries.entries()) {
    const header = new DataView(new ArrayBuffer(46))
    header.setUint32(0, CENTRAL_FILE, true)
    header.setUint16(4, 20, true) // version made by
    header.setUint16(6, 20, true)
    header.setUint16(8, 0x0800, true)
    header.setUint16(10, 8, true)
    header.setUint16(12, DOS_TIME, true)
    header.setUint16(14, DOS_DATE, true)
    header.setUint32(16, entry.crc, true)
    header.setUint32(20, entry.compressed.length, true)
    header.setUint32(24, entry.data.length, true)
    header.setUint16(28, entry.name.length, true)
    header.setUint32(42, offsets[i] as number, true)
    for (const part of [new Uint8Array(header.buffer), entry.name]) {
      parts.push(part)
      offset += part.length
    }
  }
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, END_OF_CENTRAL, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, offset - centralStart, true)
  end.setUint32(16, centralStart, true)
  parts.push(new Uint8Array(end.buffer))

  const out = new Uint8Array(offset + 22)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  localOffset: number
}

/** The files a zip lists, from its central directory; null if it is not a zip we can read */
function listZip(bytes: Uint8Array): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // (the end record is the last thing in the file, before a comment of up to 64 KB)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL) {
      end = i
      break
    }
  }
  if (end < 0) return null
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_FILE) return null
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    if (at + 46 + nameLength > bytes.length) return null
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      localOffset: view.getUint32(at + 42, true),
    })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** A file's content: stored or deflated, at most `MAX_SCORE` once inflated */
async function contentOf(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const at = entry.localOffset
  if (at + 30 > bytes.length || view.getUint32(at, true) !== LOCAL_FILE) return null
  // (the lengths in the local header, not the central one: the extra fields can differ)
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true)
  const data = bytes.subarray(start, start + entry.compressedSize)
  if (data.length !== entry.compressedSize) return null
  if (entry.method === 0) return data.length <= MAX_SCORE ? data : null
  if (entry.method !== 8) return null
  try {
    return await through(data, new DecompressionStream('deflate-raw'), MAX_SCORE)
  } catch {
    return null
  }
}

/** The MusicXML text of an `.mxl`: the score `container.xml` names, else the first XML file; null if there is none */
export async function readMxl(bytes: Uint8Array): Promise<string | null> {
  const entries = listZip(bytes)
  if (!entries) return null
  const decode = (data: Uint8Array) => new TextDecoder().decode(data).replace(/^﻿/, '')
  const container = entries.find(entry => entry.name === 'META-INF/container.xml')
  let path: string | undefined
  if (container) {
    const data = await contentOf(bytes, container)
    path = data ? /full-path="([^"]+)"/.exec(decode(data))?.[1] : undefined
  }
  const score =
    entries.find(entry => entry.name === path) ??
    entries.find(
      entry => !entry.name.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(entry.name)
    )
  if (!score) return null
  const data = await contentOf(bytes, score)
  return data ? decode(data) : null
}

/** Whether bytes begin like a zip (a plain MusicXML file begins with `<`, or a byte order mark) */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

/**
 * The MusicXML text of a melody file, whichever form it is in: `.mxl` (what is written now) or
 * plain MusicXML (what the first version wrote, and what a text-only space keeps)
 */
export async function readScoreFile(bytes: Uint8Array): Promise<string | null> {
  if (isZip(bytes)) return readMxl(bytes)
  return new TextDecoder().decode(bytes).replace(/^﻿/, '')
}
