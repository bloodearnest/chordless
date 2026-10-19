import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crc32, readZip, writeZip } from '../src/js/utils/zip.ts'

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('zip files', () => {
  it('has the CRC-32 that zip tools have', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
    assert.equal(crc32(new Uint8Array()), 0)
  })

  it('reads back what it wrote, in order, with names that are not ASCII', async () => {
    const big = 'la la la '.repeat(2000)
    const zip = await readZip(
      await writeZip([
        { name: 'manifest.json', data: '{"a":1}' },
        { name: 'songs/Ünïcode – song.cho', data: big },
        { name: 'pads/set/C.mp3', data: new Uint8Array([1, 2, 3, 4, 5]), compress: false },
        { name: 'empty.txt', data: '' },
      ])
    )
    assert.deepEqual(
      zip.entries.map(entry => entry.fileName),
      ['manifest.json', 'songs/Ünïcode – song.cho', 'pads/set/C.mp3', 'empty.txt']
    )
    assert.equal(text(await zip.read(zip.entries[0] as never)), '{"a":1}')
    assert.equal(text(await zip.read(zip.entries[1] as never)), big)
    assert.deepEqual([...(await zip.read(zip.entries[2] as never))], [1, 2, 3, 4, 5])
    assert.equal((await zip.read(zip.entries[3] as never)).length, 0)
  })

  it('deflates what shrinks, and stores what does not or was asked not to', async () => {
    const random = crypto.getRandomValues(new Uint8Array(64))
    const zip = await readZip(
      await writeZip([
        { name: 'text', data: 'x'.repeat(1000) },
        { name: 'random', data: random },
        { name: 'asked', data: 'y'.repeat(1000), compress: false },
      ])
    )
    const [shrunk, kept, asked] = zip.entries
    assert.equal(shrunk?.compression, 8)
    assert.ok((shrunk?.compressedSize ?? 0) < 100)
    assert.equal(kept?.compression, 0)
    assert.equal(asked?.compression, 0)
    assert.equal(asked?.compressedSize, 1000)
  })

  it('refuses what is not a zip file, and a local header that is not there', async () => {
    await assert.rejects(readZip(new Blob(['not a zip at all, just text'])), /Invalid ZIP/)
    const zip = await readZip(await writeZip([{ name: 'a', data: 'hello' }]))
    const entry = zip.entries[0]
    assert.ok(entry)
    await assert.rejects(zip.read({ ...entry, localHeaderOffset: 5 }), /local header/)
    await assert.rejects(zip.read({ ...entry, compression: 12 }), /compression method/)
  })

  it('refuses more files than one zip can list', async () => {
    const many = Array.from({ length: 0x10000 }, (_, n) => ({
      name: `f${n}`,
      data: '',
      compress: false,
    }))
    await assert.rejects(writeZip(many), /Too much for one ZIP/)
  })

  it('puts the time the file is given in the headers', async () => {
    const blob = await writeZip([{ name: 'a', data: 'x' }], new Date(2026, 9, 19, 21, 36, 10))
    const view = new DataView(await blob.arrayBuffer())
    assert.equal(view.getUint16(10, true), (21 << 11) | (36 << 5) | 5)
    assert.equal(view.getUint16(12, true), ((2026 - 1980) << 9) | (10 << 5) | 19)
  })
})
