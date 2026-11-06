/**
 * Where a song's annotations are kept and who may share one (src/js/annotations/store.ts): three places, a
 * annotation moves between them keeping its id, and what cannot be shared is refused.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  allAnnotations,
  canShareAnnotations,
  changedSources,
  DEFAULT_ANNOTATION_KIND,
  kindAllowed,
  noSources,
  putAnnotation,
  removeAnnotation,
  withAnnotations,
} from '../src/js/annotations/store.ts'
import type { ChartAnnotation, Setlist, SetlistEntry } from '../src/js/data-types.ts'
import { setlistContentHash } from '../src/js/sync/setlist-hash.ts'

const annotation = (id: string, text = id): ChartAnnotation => ({
  id,
  anchor: { kind: 'song' },
  body: { kind: 'text', text },
  modified: '2026-11-01T00:00:00Z',
})
const ink: ChartAnnotation = {
  ...annotation('ink'),
  body: { kind: 'ink', strokes: [[0, 0, 1, 1]], w: 10, h: 10 },
}

test('a annotation goes where its kind says, and moves between kinds keeping its id', () => {
  let s = putAnnotation(noSources(), annotation('a'), { scope: 'setlist', reach: 'private' })
  assert.deepEqual(
    s.setlistPrivate.map(n => n.id),
    ['a']
  )
  s = putAnnotation(s, annotation('a', 'edited'), { scope: 'setlist', reach: 'shared' })
  assert.deepEqual(s.setlistPrivate, [])
  assert.deepEqual(
    s.shared.map(n => n.body),
    [{ kind: 'text', text: 'edited' }]
  )
  s = putAnnotation(s, annotation('a'), { scope: 'song', reach: 'private' })
  assert.deepEqual(s.shared, [])
  assert.deepEqual(
    s.songPrivate.map(n => n.id),
    ['a']
  )
})

test('the place a annotation is not moved from is left as it was (same array), so only changes are written', () => {
  const before = putAnnotation(noSources(), annotation('a'), { scope: 'setlist', reach: 'private' })
  const after = putAnnotation(before, annotation('b'), { scope: 'song', reach: 'private' })
  assert.deepEqual(changedSources(before, after), ['songPrivate'])
  assert.deepEqual(changedSources(before, before), [])
  assert.deepEqual(changedSources(after, removeAnnotation(after, 'a')), ['setlistPrivate'])
})

test('shared annotations are text on this setlist only: ink and shared-for-ever are refused', () => {
  assert.throws(() => putAnnotation(noSources(), ink, { scope: 'setlist', reach: 'shared' }))
  assert.throws(() =>
    putAnnotation(noSources(), annotation('a'), { scope: 'song', reach: 'shared' })
  )
  assert.doesNotThrow(() => putAnnotation(noSources(), ink, { scope: 'song', reach: 'private' }))
  assert.equal(kindAllowed({ scope: 'setlist', reach: 'shared' }, ink, true), false)
  assert.equal(kindAllowed({ scope: 'setlist', reach: 'shared' }, annotation('a'), false), false)
  assert.equal(kindAllowed({ scope: 'setlist', reach: 'shared' }, annotation('a'), true), true)
  assert.equal(kindAllowed({ scope: 'song', reach: 'shared' }, annotation('a'), true), false)
  assert.equal(kindAllowed({ scope: 'song', reach: 'private' }, ink, false), true)
})

test('every annotation shows once, with the kind it is kept as', () => {
  const s = {
    shared: [annotation('a') as never],
    setlistPrivate: [annotation('a'), annotation('b')],
    songPrivate: [annotation('c')],
  }
  assert.deepEqual(
    allAnnotations(s).map(({ annotation: n, kind }) => [n.id, kind.scope, kind.reach]),
    [
      ['a', 'setlist', 'shared'],
      ['b', 'setlist', 'private'],
      ['c', 'song', 'private'],
    ]
  )
})

test('who may share: those who can write the setlist, and not on a received one', () => {
  assert.equal(canShareAnnotations(undefined, {}), true)
  assert.equal(canShareAnnotations({}, {}), true)
  assert.equal(canShareAnnotations({ team: { role: 'owner' } }, {}), true)
  assert.equal(canShareAnnotations({ team: { role: 'admin' } }, {}), true)
  assert.equal(canShareAnnotations({ team: { role: 'writer' } }, {}), true)
  assert.equal(canShareAnnotations({ team: { role: 'reader' } }, {}), false)
  assert.equal(canShareAnnotations({ readOnly: true }, {}), false)
  assert.equal(canShareAnnotations({ team: { role: 'writer' }, readOnly: true }, {}), false)
  assert.equal(canShareAnnotations({}, { received: { fileId: 'x' } }), false)
})

test('an entry with no shared annotations is left as it was, so its hash does not change', () => {
  const entry = {
    songId: 's',
    songUuid: 'u',
    order: 0,
    key: null,
    tempo: null,
    notes: '',
  } as SetlistEntry
  const before = JSON.stringify(entry)
  withAnnotations(entry, [])
  assert.equal(JSON.stringify(entry), before)
  withAnnotations(entry, [annotation('a') as never])
  assert.equal(entry.annotations?.length, 1)
  withAnnotations(entry, [])
  assert.equal(JSON.stringify(entry), before)
})

test('a shared annotation changes the setlist’s content hash, so it syncs', () => {
  const entry = {
    songId: 's',
    songUuid: 'u',
    order: 0,
    key: null,
    tempo: null,
    notes: '',
  } as SetlistEntry
  const setlist = { id: 'x', date: '2026-11-01', songs: [entry] } as unknown as Setlist
  const before = setlistContentHash(setlist)
  withAnnotations(entry, [annotation('a') as never])
  assert.notEqual(setlistContentHash(setlist), before)
})

test('a new annotation is for this setlist and just the one person: nothing is shared by surprise', () => {
  assert.deepEqual(DEFAULT_ANNOTATION_KIND, { scope: 'setlist', reach: 'private' })
})
