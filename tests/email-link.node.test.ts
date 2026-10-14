/**
 * The link the email Worker replies with (src/js/email-link.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeImport, encodeImport } from '../src/js/email-link.ts'
import type { ImportedSetlist, ImportedSong } from '../src/js/email-setlist.ts'
import { makeImportedSong } from './builders.ts'

const song = (title: string, over: Partial<ImportedSong> = {}) =>
  makeImportedSong(title, {
    key: 'G',
    tempo: 72,
    time: '4/4',
    ccli: '1234567',
    chartFilename: `${title}.pdf`,
    listed: title,
    notes: 'drop out at the bridge',
    ...over,
  })

const setlist: ImportedSetlist = {
  name: 'Sunday 25th October',
  date: '2026-10-25',
  dateWarning: null,
  sentDate: '2026-10-11',
  orderFromList: true,
  leader: { name: 'Leader One', email: 'one@example.com' },
  songs: [song('Alpha Song'), song('Bravo Song', { pairedBy: 'elimination', ccli: null })],
  unlisted: [song('Extra Song')],
}

const hostile = async (value: unknown) => {
  const { Buffer } = await import('node:buffer')
  const { deflateRawSync } = await import('node:zlib')
  const bytes = deflateRawSync(Buffer.from(JSON.stringify(value)))
  return bytes.toString('base64url')
}

test('a setlist survives the trip through a link', async () => {
  const fragment = await encodeImport(setlist)
  assert.match(fragment, /^[\w-]+$/, 'safe in a URL')
  assert.deepEqual(await decodeImport(fragment), setlist)
  assert.deepEqual(await decodeImport(`#${fragment}`), setlist)
})

test('a link for a setlist of a dozen songs is short enough to send', async () => {
  const many = { ...setlist, songs: Array.from({ length: 12 }, (_, i) => song(`Song number ${i}`)) }
  assert.ok((await encodeImport(many)).length < 1500)
})

test('what is not a setlist is refused', async () => {
  await assert.rejects(decodeImport('not-a-link!'))
  await assert.rejects(decodeImport(await hostile({ songs: 'no' })))
  await assert.rejects(decodeImport(await hostile({ songs: [] })))
})

test('a made-up link is cut down to what the page can trust', async () => {
  const wild = await decodeImport(
    await hostile({
      name: 'x'.repeat(5000),
      date: '25/10/2026',
      leader: { name: 'A\nB', email: 'ONE@Example.com', extra: 'ignored' },
      songs: [
        { title: '<img src=x onerror=alert(1)>', tempo: 'fast', ccli: 'abc', key: 'D' },
        { title: '' },
        ...Array.from({ length: 500 }, (_, i) => ({ title: `S${i}` })),
      ],
    })
  )
  assert.equal(wild.name.length, 500)
  assert.equal(wild.date, '')
  assert.deepEqual(wild.leader, { name: 'A B', email: 'one@example.com' })
  assert.ok(wild.songs.length <= 100 && wild.songs.length >= 99)
  assert.equal(wild.songs[0].tempo, null)
  assert.equal(wild.songs[0].ccli, null)
  assert.equal(wild.songs[0].key, 'D')
  assert.ok(wild.songs.every(each => each.title && each.titles.length))
})
