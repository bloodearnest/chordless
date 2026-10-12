/** The share bundle and its encryption (src/js/share-bundle.ts, share-crypto.ts) */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addDays,
  buildShareBundle,
  bundleHash,
  isExpired,
  parseShareBundle,
  type ShareSource,
  shareExpiry,
} from '../src/js/share-bundle.ts'
import {
  decryptBundle,
  encryptBundle,
  fromBase64Url,
  generateShareKey,
  parseShareUrl,
  shareUrl,
  toBase64Url,
} from '../src/js/share-crypto.ts'

const setlist = {
  date: '2026-10-11',
  time: '10:30',
  type: 'Church Service',
  name: '',
  owner: 'Ann Smith',
}

const source = (
  order: number,
  over: Partial<ShareSource['entry']> = {},
  chart = '{title: A}'
): ShareSource => ({
  entry: {
    order,
    songId: `s${order}`,
    songUuid: `u${order}`,
    key: null,
    tempo: null,
    notes: '',
    ...over,
  },
  title: `Song ${order}`,
  songKey: 'G',
  chordpro: chart,
})

const bundleOf = (sources: ShareSource[]) =>
  buildShareBundle(setlist, sources, { expires: '2026-10-25', updated: '2026-10-09T19:30:00Z' })

test('addDays is calendar arithmetic across months and years', () => {
  assert.equal(addDays('2026-10-11', 14), '2026-10-25')
  assert.equal(addDays('2026-12-25', 14), '2027-01-08')
  assert.equal(addDays('2028-02-20', 10), '2028-03-01')
  assert.equal(addDays('2026-03-29', 1), '2026-03-30')
  assert.throws(() => addDays('next week', 1))
})

test('a share ends two weeks after the setlist, or after it was shared if that is later', () => {
  assert.equal(shareExpiry('2026-10-11', '2026-10-05'), '2026-10-25')
  assert.equal(shareExpiry('2026-10-11', '2026-10-20'), '2026-11-03')
  assert.equal(isExpired('2026-10-25', '2026-10-25'), false, 'the last day still counts')
  assert.equal(isExpired('2026-10-25', '2026-10-26'), true)
})

test('the bundle has the songs in order, each with the setlist key, notes and edits', () => {
  const bundle = bundleOf([
    source(2, { key: 'A', notes: 'repeat 4x', tempo: 72 }, '{title: Two}'),
    source(1, {}, '{title: One}'),
    source(3, { chordproEdits: '{title: Three, fixed}' }, '{title: Three}'),
  ])
  assert.deepEqual(
    bundle.setlist.songs.map(s => [s.title, s.key, s.tempo, s.notes, s.chordpro]),
    [
      ['Song 1', 'G', null, '', '{title: One}'],
      ['Song 2', 'A', 72, 'repeat 4x', '{title: Two}'],
      ['Song 3', 'G', null, '', '{title: Three, fixed}'],
    ]
  )
  assert.equal(bundle.format, 'chordless-share')
  assert.equal(bundle.expires, '2026-10-25')
})

test('the bundle carries no ids, emails or sync fields', () => {
  const full = {
    ...setlist,
    id: 'setlist-uuid-1',
    ownerId: 'ann@example.com',
    driveFileId: 'drive-file-1',
    syncedContentHash: 'hash-1',
    share: { fileId: 'f', key: 'k', created: '', expires: '', bundleHash: '' },
  }
  const text = JSON.stringify(bundleOf([source(1)]).setlist)
  const withExtras = JSON.stringify(
    buildShareBundle(full, [source(1)], { expires: '2026-10-25' }).setlist
  )
  assert.equal(withExtras, text)
  for (const leak of ['uuid', 'example.com', 'drive-file', 'hash-1', 'songId', 'u1']) {
    assert.ok(!withExtras.includes(leak), leak)
  }
})

test('the hash changes with the content and not with the build time', async () => {
  const base = await bundleHash(bundleOf([source(1), source(2)]))
  const later = buildShareBundle(setlist, [source(1), source(2)], {
    expires: '2026-10-25',
    updated: '2027-01-01T00:00:00Z',
  })
  assert.equal(await bundleHash(later), base)
  assert.notEqual(await bundleHash(bundleOf([source(1)])), base, 'a song removed')
  assert.notEqual(
    await bundleHash(bundleOf([source(2), source(1, { order: 3 })])),
    base,
    'reordered'
  )
  assert.notEqual(await bundleHash(bundleOf([source(1, { key: 'D' }), source(2)])), base, 'a key')
  assert.notEqual(
    await bundleHash(bundleOf([source(1, { notes: 'x' }), source(2)])),
    base,
    'a note'
  )
  assert.notEqual(
    await bundleHash(bundleOf([source(1, {}, '{title: fixed}'), source(2)])),
    base,
    'a chart'
  )
  const dateChanged = buildShareBundle({ ...setlist, date: '2026-10-18' }, [source(1), source(2)], {
    expires: '2026-10-25',
  })
  assert.notEqual(await bundleHash(dateChanged), base, 'the date')
})

test('keys are 43 base64url characters, and different every time', () => {
  const a = generateShareKey()
  assert.match(a, /^[\w-]{43}$/)
  assert.notEqual(generateShareKey(), a)
})

test('base64url round trips every byte value, with no padding or + or /', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
  const text = toBase64Url(bytes)
  assert.match(text, /^[\w-]+$/)
  assert.deepEqual(fromBase64Url(text), bytes)
  assert.throws(() => fromBase64Url('a+b/'))
})

test('encrypting then decrypting gives the bundle back, in much less space', async () => {
  const chart = `{title: Hymn}\n${'[G]Amazing [C]grace how [G]sweet the sound\n'.repeat(40)}`
  const bundle = bundleOf([source(1, {}, chart), source(2, { key: 'A' }, chart)])
  const key = generateShareKey()
  const file = await encryptBundle(key, bundle)
  assert.deepEqual(await decryptBundle(key, file), bundle)
  assert.ok(file.length < JSON.stringify(bundle).length / 4, `${file.length} bytes`)
})

test('every upload has a fresh IV', async () => {
  const key = generateShareKey()
  const bundle = bundleOf([source(1)])
  const [a, b] = [await encryptBundle(key, bundle), await encryptBundle(key, bundle)]
  assert.notDeepEqual(a.slice(0, 12), b.slice(0, 12))
})

test('a wrong key, a changed file or a truncated one fails to decrypt', async () => {
  const key = generateShareKey()
  const file = await encryptBundle(key, bundleOf([source(1)]))
  await assert.rejects(decryptBundle(generateShareKey(), file), 'wrong key')

  const flipped = file.slice()
  flipped[flipped.length - 1] ^= 1
  await assert.rejects(decryptBundle(key, flipped), 'tampered')

  await assert.rejects(decryptBundle(key, file.slice(0, 12)), 'truncated')
  await assert.rejects(decryptBundle('too-short', file), 'bad key')
})

test('decrypted data must be a bundle this version can show', () => {
  const good = bundleOf([source(1)])
  assert.deepEqual(parseShareBundle(JSON.parse(JSON.stringify(good))), good)
  assert.throws(() => parseShareBundle({ ...good, format: 'other' }), /Not a Chordless share/)
  assert.throws(() => parseShareBundle({ ...good, version: 99 }), /newer Chordless/)
  assert.throws(() => parseShareBundle({ ...good, setlist: { songs: [{ title: 1 }] } }), /damaged/)
  assert.throws(() => parseShareBundle(null))
})

test('links hold the file id and the key after the #, and read back', () => {
  const key = generateShareKey()
  const url = shareUrl('https://chordless.app', '1gaujHBXmLfJDPtBn5plrCrTukHnkIB8Y', key)
  assert.equal(url, `https://chordless.app/s/1gaujHBXmLfJDPtBn5plrCrTukHnkIB8Y#${key}`)
  assert.deepEqual(parseShareUrl(url), { fileId: '1gaujHBXmLfJDPtBn5plrCrTukHnkIB8Y', key })
  assert.deepEqual(parseShareUrl(`/s/abc-DEF_123#${key}`), { fileId: 'abc-DEF_123', key })
  assert.equal(parseShareUrl('https://chordless.app/s/abc'), null, 'no key')
  assert.equal(parseShareUrl(`https://chordless.app/songs/abc#${key}`), null, 'not a share path')
  assert.equal(parseShareUrl('https://chordless.app/s/abc#short'), null, 'bad key')
})
