/**
 * Reading and writing zip files, with what the browser has: CompressionStream and
 * DecompressionStream for deflate, and a CRC-32 here. Enough for the files Chordless makes and
 * reads (a backup, a pad set): stored or deflated entries, no encryption, nothing over 4 GB.
 */

/** One entry of a zip file, as its central directory lists it */
export interface ZipEntry {
  fileName: string
  flags: number
  compression: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

/** A zip file read far enough to find its entries; `read` gives one entry's bytes */
export interface ZipArchive {
  entries: ZipEntry[]
  read(entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>>
}

/** A file to put in a zip. Compressed unless `compress` is false (an mp3 is already) */
export interface ZipFile {
  name: string
  data: Uint8Array | string
  compress?: boolean
}

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const UTF8_NAMES = 0x0800
const MAX_ZIP32 = 0xffffffff

export async function readZip(file: Blob): Promise<ZipArchive> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  const eocdOffset = findEndOfCentralDirectory(bytes)
  if (eocdOffset < 0) {
    throw new Error('Invalid ZIP file (EOCD not found)')
  }

  const centralDirOffset = view.getUint32(eocdOffset + 16, true)
  const totalEntries = view.getUint16(eocdOffset + 10, true)

  const entries: ZipEntry[] = []
  let cursor = centralDirOffset

  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(cursor, true) !== CENTRAL_HEADER) break

    const flags = view.getUint16(cursor + 8, true)
    const compression = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const fileNameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localHeaderOffset = view.getUint32(cursor + 42, true)

    const fileName = new TextDecoder().decode(
      bytes.slice(cursor + 46, cursor + 46 + fileNameLength)
    )
    entries.push({
      fileName,
      flags,
      compression,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })
    cursor += 46 + fileNameLength + extraLength + commentLength
  }

  return { entries, read: entry => readEntry(bytes, view, entry) }
}

async function readEntry(
  bytes: Uint8Array,
  view: DataView,
  entry: ZipEntry
): Promise<Uint8Array<ArrayBuffer>> {
  const { localHeaderOffset } = entry
  if (view.getUint32(localHeaderOffset, true) !== LOCAL_HEADER) {
    throw new Error('Invalid ZIP local header')
  }

  const fileNameLength = view.getUint16(localHeaderOffset + 26, true)
  const extraLength = view.getUint16(localHeaderOffset + 28, true)
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength
  const compressedData = bytes.slice(dataStart, dataStart + entry.compressedSize)

  if (entry.compression === 0) return compressedData
  if (entry.compression === 8) return await inflateRaw(compressedData)
  throw new Error(`Unsupported ZIP compression method: ${entry.compression}`)
}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const blob = new Blob([data])
  const streams: CompressionFormat[] = ['deflate-raw', 'deflate']

  for (const algo of streams) {
    try {
      const decompressedStream = blob.stream().pipeThrough(new DecompressionStream(algo))
      const arrayBuffer = await new Response(decompressedStream).arrayBuffer()
      return new Uint8Array(arrayBuffer)
    } catch {
      // Try next algorithm
    }
  }

  throw new Error('Browser does not support deflate decompression for ZIP uploads')
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i
    }
  }
  return -1
}

// ==================== Writing ====================

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The date and time as a zip header holds them (MS-DOS format, local time) */
function dosDateTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day:
      ((Math.max(date.getFullYear(), 1980) - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  }
}

/** Make a zip file of these files, in this order */
export async function writeZip(files: ZipFile[], now = new Date()): Promise<Blob> {
  const encoder = new TextEncoder()
  const { time, day } = dosDateTime(now)
  const parts: BlobPart[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0

  for (const file of files) {
    const name = encoder.encode(file.name) as Uint8Array<ArrayBuffer>
    const plain = new Uint8Array(
      typeof file.data === 'string' ? encoder.encode(file.data) : file.data
    ) as Uint8Array<ArrayBuffer>
    const deflated = file.compress === false ? null : await deflateRaw(plain)
    // (a file that does not shrink is stored, as zip tools do)
    const stored = !deflated || deflated.length >= plain.length
    const data = stored ? plain : deflated
    const method = stored ? 0 : 8
    const crc = crc32(plain)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, LOCAL_HEADER, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, UTF8_NAMES, true)
    local.setUint16(8, method, true)
    local.setUint16(10, time, true)
    local.setUint16(12, day, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, plain.length, true)
    local.setUint16(26, name.length, true)
    parts.push(local.buffer, name, data)

    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, CENTRAL_HEADER, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, UTF8_NAMES, true)
    entry.setUint16(10, method, true)
    entry.setUint16(12, time, true)
    entry.setUint16(14, day, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, data.length, true)
    entry.setUint32(24, plain.length, true)
    entry.setUint16(28, name.length, true)
    entry.setUint32(42, offset, true)
    central.push(new Uint8Array(entry.buffer), name)

    offset += 30 + name.length + data.length
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0)
  if (offset + centralSize + 22 > MAX_ZIP32 || files.length > 0xffff) {
    throw new Error('Too much for one ZIP file: leave out the pad sets')
  }

  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, END_OF_CENTRAL_DIRECTORY, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' })
}
