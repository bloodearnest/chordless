/**
 * Where a song's annotations are kept and who may share one (src/js/annotations/store.ts): two places,
 * an annotation moves between them keeping its id, and what cannot be shared is refused.
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

test('an annotation goes where its kind says, and moves between kinds keeping its id', () => {
  let s = putAnnotation(noSources(), annotation('a'), 'private')
  assert.deepEqual(
    s.private.map(each => each.id),
    ['a']
  )
  s = putAnnotation(s, annotation('a', 'edited'), 'shared')
  assert.deepEqual(s.private, [])
  assert.deepEqual(
    s.shared.map(each => each.body),
    [{ kind: 'text', text: 'edited' }]
  )
  s = putAnnotation(s, annotation('a'), 'private')
  assert.deepEqual(s.shared, [])
  assert.deepEqual(
    s.private.map(each => each.id),
    ['a']
  )
})

test('the place an annotation is not moved from is left as it was (same array), so only changes are written', () => {
  const before = putAnnotation(noSources(), annotation('a'), 'private')
  const after = putAnnotation(before, annotation('b'), 'shared')
  assert.deepEqual(changedSources(before, after), ['shared'])
  assert.deepEqual(changedSources(before, before), [])
  assert.deepEqual(changedSources(after, removeAnnotation(after, 'a')), ['private'])
})

test('shared annotations are text only: a drawing is refused, and stays private', () => {
  assert.throws(() => putAnnotation(noSources(), ink, 'shared'))
  assert.doesNotThrow(() => putAnnotation(noSources(), ink, 'private'))
  assert.equal(kindAllowed('shared', ink, true), false)
  assert.equal(kindAllowed('shared', annotation('a'), false), false)
  assert.equal(kindAllowed('shared', annotation('a'), true), true)
  assert.equal(kindAllowed('private', ink, false), true)
})

test('every annotation shows once, with the kind it is kept as', () => {
  const s = {
    shared: [annotation('a') as never],
    private: [annotation('a'), annotation('b')],
  }
  assert.deepEqual(
    allAnnotations(s).map(({ annotation: each, kind }) => [each.id, kind]),
    [
      ['a', 'shared'],
      ['b', 'private'],
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

test('a new annotation is just the user’s: nothing is shared by surprise', () => {
  assert.equal(DEFAULT_ANNOTATION_KIND, 'private')
})
