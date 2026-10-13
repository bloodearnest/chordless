/**
 * What an email changes in a setlist that has its date already (src/js/import-setlist.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Setlist } from '../src/js/data-types.ts'
import type { ImportedSong } from '../src/js/email-setlist.ts'
import { changesTo, hasChanges, type ReviewedSong } from '../src/js/import-setlist.ts'

const entry = (id: string, order: number, key: string | null = 'G') => ({
  order,
  songId: id,
  songUuid: `uuid-${id}`,
  key,
  tempo: null,
  notes: '',
})
const setlist = {
  id: 's',
  songs: [entry('a', 0), entry('b', 1, 'D'), entry('c', 2)],
} as unknown as Setlist
const titleOf = (id: string) => `Song ${id.toUpperCase()}`
const reviewed = (id: string, key: string | null = null): ReviewedSong => ({
  song: { title: titleOf(id) } as ImportedSong,
  key,
  notes: '',
  library: { uuid: `uuid-${id}`, id, title: titleOf(id), ccli: null },
})

test('the same songs, in the same order, change nothing', () => {
  const changes = changesTo(setlist, [reviewed('a'), reviewed('b', 'D'), reviewed('c')], titleOf)
  assert.equal(hasChanges(changes), false)
})

test('added and removed songs, and key changes, are listed by title', () => {
  const changes = changesTo(setlist, [reviewed('a', 'A'), reviewed('d'), reviewed('c')], titleOf)
  assert.deepEqual(changes.added, ['Song D'])
  assert.deepEqual(changes.removed, [{ songId: 'b', title: 'Song B' }])
  assert.deepEqual(changes.keys, [{ title: 'Song A', from: 'G', to: 'A' }])
  assert.equal(changes.reordered, false)
  assert.equal(hasChanges(changes), true)
})

test('songs in a new order are said to be, but a song added or removed is not a reordering', () => {
  assert.equal(
    changesTo(setlist, [reviewed('c'), reviewed('a'), reviewed('b')], titleOf).reordered,
    true
  )
  assert.equal(
    changesTo(setlist, [reviewed('a'), reviewed('x'), reviewed('b'), reviewed('c')], titleOf)
      .reordered,
    false
  )
})

test('a key the email does not give is not a change', () => {
  assert.deepEqual(changesTo(setlist, [reviewed('a', null)], titleOf).keys, [])
})
