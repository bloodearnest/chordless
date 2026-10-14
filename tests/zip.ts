/** A ZIP file for tests: what a user's pad set download is, built by hand */

export interface ZipEntry {
  name: string
  data?: Uint8Array
  /** How it is stored; deflate is what most zip tools do to anything that compresses */
  method?: 'store' | 'deflate'
  /** The general purpose flags, e.g. 1 for an encrypted entry */
  flags?: number
  /** Written as the entry's compression method, whatever the data is, to make an unreadable file */
  rawMethod?: number
}

async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Build a zip file (the CRCs are left at zero: the reader in the app does not check them) */
export async function buildZip(entries: ZipEntry[], name = 'pads.zip'): Promise<File> {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const fileName = encoder.encode(entry.name)
    const raw = entry.data ?? new Uint8Array()
    const method = entry.rawMethod ?? (entry.method === 'deflate' ? 8 : 0)
    const stored = entry.method === 'deflate' ? await deflateRaw(raw) : raw
    const flags = entry.flags ?? 0

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, flags, true)
    local.setUint16(8, method, true)
    local.setUint32(18, stored.length, true)
    local.setUint32(22, raw.length, true)
    local.setUint16(26, fileName.length, true)
    parts.push(new Uint8Array(local.buffer), fileName, stored)

    const header = new DataView(new ArrayBuffer(46))
    header.setUint32(0, 0x02014b50, true)
    header.setUint16(4, 20, true)
    header.setUint16(6, 20, true)
    header.setUint16(8, flags, true)
    header.setUint16(10, method, true)
    header.setUint32(20, stored.length, true)
    header.setUint32(24, raw.length, true)
    header.setUint16(28, fileName.length, true)
    header.setUint32(42, offset, true)
    central.push(new Uint8Array(header.buffer), fileName)

    offset += 30 + fileName.length + stored.length
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  return new File([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], name, {
    type: 'application/zip',
  })
}
