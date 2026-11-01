/**
 * Where a song's notes are kept and who may share one (src/js/notes/store.ts): three places, a
 * note moves between them keeping its id, and what cannot be shared is refused.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChartNote, Setlist, SetlistEntry } from '../src/js/data-types.ts'
import {
  allNotes,
  canShareNotes,
  changedSources,
  DEFAULT_NOTE_KIND,
  kindAllowed,
  noSources,
  putNote,
  removeNote,
  withAnnotations,
} from '../src/js/notes/store.ts'
import { setlistContentHash } from '../src/js/sync/setlist-hash.ts'

const note = (id: string, text = id): ChartNote => ({
  id,
  anchor: { kind: 'song' },
  body: { kind: 'text', text },
  modified: '2026-11-01T00:00:00Z',
})
const ink: ChartNote = {
  ...note('ink'),
  body: { kind: 'ink', strokes: [[0, 0, 1, 1]], w: 10, h: 10 },
}

test('a note goes where its kind says, and moves between kinds keeping its id', () => {
  let s = putNote(noSources(), note('a'), { scope: 'setlist', reach: 'private' })
  assert.deepEqual(
    s.setlistPrivate.map(n => n.id),
    ['a']
  )
  s = putNote(s, note('a', 'edited'), { scope: 'setlist', reach: 'shared' })
  assert.deepEqual(s.setlistPrivate, [])
  assert.deepEqual(
    s.shared.map(n => n.body),
    [{ kind: 'text', text: 'edited' }]
  )
  s = putNote(s, note('a'), { scope: 'song', reach: 'private' })
  assert.deepEqual(s.shared, [])
  assert.deepEqual(
    s.songPrivate.map(n => n.id),
    ['a']
  )
})

test('the place a note is not moved from is left as it was (same array), so only changes are written', () => {
  const before = putNote(noSources(), note('a'), { scope: 'setlist', reach: 'private' })
  const after = putNote(before, note('b'), { scope: 'song', reach: 'private' })
  assert.deepEqual(changedSources(before, after), ['songPrivate'])
  assert.deepEqual(changedSources(before, before), [])
  assert.deepEqual(changedSources(after, removeNote(after, 'a')), ['setlistPrivate'])
})

test('shared notes are text on this setlist only: ink and shared-for-ever are refused', () => {
  assert.throws(() => putNote(noSources(), ink, { scope: 'setlist', reach: 'shared' }))
  assert.throws(() => putNote(noSources(), note('a'), { scope: 'song', reach: 'shared' }))
  assert.doesNotThrow(() => putNote(noSources(), ink, { scope: 'song', reach: 'private' }))
  assert.equal(kindAllowed({ scope: 'setlist', reach: 'shared' }, ink, true), false)
  assert.equal(kindAllowed({ scope: 'setlist', reach: 'shared' }, note('a'), false), false)
  assert.equal(kindAllowed({ scope: 'setlist', reach: 'shared' }, note('a'), true), true)
  assert.equal(kindAllowed({ scope: 'song', reach: 'shared' }, note('a'), true), false)
  assert.equal(kindAllowed({ scope: 'song', reach: 'private' }, ink, false), true)
})

test('every note shows once, with the kind it is kept as', () => {
  const s = {
    shared: [note('a') as never],
    setlistPrivate: [note('a'), note('b')],
    songPrivate: [note('c')],
  }
  assert.deepEqual(
    allNotes(s).map(({ note: n, kind }) => [n.id, kind.scope, kind.reach]),
    [
      ['a', 'setlist', 'shared'],
      ['b', 'setlist', 'private'],
      ['c', 'song', 'private'],
    ]
  )
})

test('who may share: those who can write the setlist, and not on a received one', () => {
  assert.equal(canShareNotes(undefined, {}), true)
  assert.equal(canShareNotes({}, {}), true)
  assert.equal(canShareNotes({ team: { role: 'owner' } }, {}), true)
  assert.equal(canShareNotes({ team: { role: 'admin' } }, {}), true)
  assert.equal(canShareNotes({ team: { role: 'writer' } }, {}), true)
  assert.equal(canShareNotes({ team: { role: 'reader' } }, {}), false)
  assert.equal(canShareNotes({ readOnly: true }, {}), false)
  assert.equal(canShareNotes({ team: { role: 'writer' }, readOnly: true }, {}), false)
  assert.equal(canShareNotes({}, { received: { fileId: 'x' } }), false)
})

test('an entry with no shared notes is left as it was, so its hash does not change', () => {
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
  withAnnotations(entry, [note('a') as never])
  assert.equal(entry.annotations?.length, 1)
  withAnnotations(entry, [])
  assert.equal(JSON.stringify(entry), before)
})

test('a shared note changes the setlist’s content hash, so it syncs', () => {
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
  withAnnotations(entry, [note('a') as never])
  assert.notEqual(setlistContentHash(setlist), before)
})

test('a new note is for this setlist and just the one person: nothing is shared by surprise', () => {
  assert.deepEqual(DEFAULT_NOTE_KIND, { scope: 'setlist', reach: 'private' })
})
