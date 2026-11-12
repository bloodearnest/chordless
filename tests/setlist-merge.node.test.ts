/**
 * Settling a setlist both sides changed (src/js/sync/setlist-merge.ts): the leader's version is the
 * base, and the other adds its new songs and its annotations. Nothing of keys, tempos, order or
 * details comes from the other.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Person, SharedChartAnnotation } from '../src/js/data-types.ts'
import { leadsIt, mergeSetlists, shapeOf } from '../src/js/sync/setlist-merge.ts'
import { makeEntry, makeSetlist } from './builders.ts'

const note = (id: string, text: string): SharedChartAnnotation => ({
  id,
  anchor: { kind: 'song' } as SharedChartAnnotation['anchor'],
  body: { kind: 'text', text },
  modified: '2026-10-11T10:00:00.000Z',
})
const entry = (songId: string, extra: Record<string, unknown> = {}) =>
  makeEntry({ songId, songUuid: `u-${songId}`, ...extra })
const setlist = (...entries: ReturnType<typeof entry>[]) =>
  makeSetlist({ songs: entries.map((each, order) => ({ ...each, order })) })
const ids = (s: { songs: { songId: string }[] }) => s.songs.map(each => each.songId)

describe('merging a setlist both sides changed', () => {
  test('takes the songs the other side added, after the song they followed', () => {
    const winner = setlist(entry('a'), entry('b'), entry('c'))
    const other = setlist(entry('a'), entry('x'), entry('b'), entry('y'))
    const { merged, songsAdded } = mergeSetlists(
      winner,
      other,
      shapeOf(setlist(entry('a'), entry('b'), entry('c')))
    )
    assert.deepEqual(ids(merged), ['a', 'x', 'b', 'y', 'c'])
    assert.deepEqual(songsAdded, ['x', 'y'])
    assert.deepEqual(
      merged.songs.map(each => each.order),
      [0, 1, 2, 3, 4]
    )
  })

  test('puts an added song last when the song before it is not in the winner', () => {
    const winner = setlist(entry('a'))
    const other = setlist(entry('gone'), entry('x'))
    // (it was in the base, so the winner removed it)
    const { merged } = mergeSetlists(winner, other, shapeOf(setlist(entry('a'), entry('gone'))))
    assert.deepEqual(ids(merged), ['a', 'x'])
  })

  test('leaves out a song the winner removed, and brings back one the other removed', () => {
    const base = shapeOf(setlist(entry('a'), entry('b'), entry('c')))
    // (the winner removed b; the other removed c, which the winner still has)
    const { merged } = mergeSetlists(
      setlist(entry('a'), entry('c')),
      setlist(entry('a'), entry('b')),
      base
    )
    assert.deepEqual(ids(merged), ['a', 'c'])
  })

  test('without a base, takes every song the other side has that the winner lacks', () => {
    const { merged } = mergeSetlists(setlist(entry('a')), setlist(entry('a'), entry('b')), null)
    assert.deepEqual(ids(merged), ['a', 'b'])
  })

  test('takes the key, tempo, order and details from the winner', () => {
    const winner = { ...setlist(entry('a', { key: 'G', tempo: 80 }), entry('b')), name: 'Mine' }
    const other = { ...setlist(entry('b'), entry('a', { key: 'A', tempo: 100 })), name: 'Theirs' }
    const { merged } = mergeSetlists(winner, other, shapeOf(winner))
    assert.deepEqual(ids(merged), ['a', 'b'])
    assert.equal(merged.songs[0].key, 'G')
    assert.equal(merged.songs[0].tempo, 80)
    assert.equal(merged.name, 'Mine')
  })

  test('knows a song twice in a setlist as two', () => {
    const winner = setlist(entry('a'))
    const other = setlist(entry('a'), entry('a'))
    const { merged } = mergeSetlists(winner, other, shapeOf(winner))
    assert.deepEqual(ids(merged), ['a', 'a'])
  })

  test('keeps the annotations the other side added, and not one the winner removed', () => {
    const base = setlist(entry('a', { annotations: [note('removed', 'old')] }))
    const winner = setlist(entry('a', { annotations: [note('kept', 'x')] }))
    const other = setlist(
      entry('a', { annotations: [note('removed', 'old'), note('new', 'repeat 4 times')] })
    )
    const { merged, annotationsAdded } = mergeSetlists(winner, other, {
      songs: ['a#0'],
      annotations: { ...shapeOf(base).annotations, kept: shapeOf(winner).annotations.kept },
    })
    assert.deepEqual(
      merged.songs[0].annotations?.map(each => each.id),
      ['kept', 'new']
    )
    assert.equal(annotationsAdded, 1)
  })

  test('takes the other side’s edit of an annotation the winner did not edit, and keeps a clash as two', () => {
    const base = shapeOf(setlist(entry('a', { annotations: [note('n', 'original')] })))
    const edited = (text: string) => setlist(entry('a', { annotations: [note('n', text)] }))
    // (only the other edited it)
    const taken = mergeSetlists(edited('original'), edited('their words'), base).merged
    assert.deepEqual(
      taken.songs[0].annotations?.map(each => (each.body as { text: string }).text),
      ['their words']
    )
    // (both did: the winner's stays and the other's is kept beside it)
    const clash = mergeSetlists(edited('my words'), edited('their words'), base).merged
    const texts = clash.songs[0].annotations?.map(each => (each.body as { text: string }).text)
    assert.deepEqual(texts, ['my words', 'their words'])
    // (and the same clash made on another device is the same annotation, not another)
    const again = mergeSetlists(clash, edited('their words'), base).merged
    assert.equal(again.songs[0].annotations?.length, 2)
    // (only the winner edited it, or both the same: nothing to add)
    assert.equal(
      mergeSetlists(edited('my words'), edited('original'), base).merged.songs[0].annotations
        ?.length,
      1
    )
    assert.equal(
      mergeSetlists(edited('same'), edited('same'), base).merged.songs[0].annotations?.length,
      1
    )
  })

  test('puts a song the other side added first at the start, and leaves a song with no annotations as it is', () => {
    const base = shapeOf(setlist(entry('a', { annotations: [note('removed', 'old')] })))
    const winner = setlist(entry('a'))
    const other = setlist(entry('x'), entry('a', { annotations: [note('removed', 'old')] }))
    const { merged } = mergeSetlists(winner, other, base)
    // (x was not in the base, so it was added; the annotation was, so the winner removed it)
    assert.deepEqual(ids(merged), ['x', 'a'])
    assert.equal(merged.songs[1].annotations, undefined)
    // (a song with no annotations that the other side gave one)
    const given = mergeSetlists(
      winner,
      setlist(entry('a', { annotations: [note('new', 'hi')] })),
      shapeOf(winner)
    )
    assert.equal(given.merged.songs[0].annotations?.[0].id, 'new')
  })

  test('adds annotations to a song the other side added with its own, unchanged', () => {
    const winner = setlist(entry('a'))
    const other = setlist(entry('a'), entry('x', { annotations: [note('n', 'drop out here')] }))
    const { merged } = mergeSetlists(winner, other, shapeOf(winner))
    assert.equal(merged.songs[1].annotations?.[0].id, 'n')
  })
})

describe('who leads a setlist', () => {
  const people: Person[] = [
    { id: 'ann', name: 'Ann', emails: ['ann@example.com'], modifiedDate: '' },
    { id: 'old', name: 'Old Ann', emails: [], mergedInto: 'ann', modifiedDate: '' },
    { id: 'bob', name: 'Bob', emails: ['bob@example.com'], modifiedDate: '' },
  ]
  const none = { email: null, chosenPersonId: null }

  test('is the person whose address is the signed-in account’s', () => {
    assert.equal(leadsIt({ leaderId: 'ann' }, people, { ...none, email: 'Ann@Example.com' }), true)
    assert.equal(leadsIt({ leaderId: 'bob' }, people, { ...none, email: 'ann@example.com' }), false)
  })

  test('is the person the device was told is its user, and follows a merged person', () => {
    assert.equal(leadsIt({ leaderId: 'ann' }, people, { ...none, chosenPersonId: 'ann' }), true)
    assert.equal(leadsIt({ leaderId: 'old' }, people, { ...none, chosenPersonId: 'ann' }), true)
    assert.equal(leadsIt({ leaderId: 'bob' }, people, { ...none, chosenPersonId: 'ann' }), false)
  })

  test('is nobody when no one is signed in, or there is no leader or the leader is not known', () => {
    assert.equal(leadsIt({ leaderId: 'ann' }, people, none), false)
    assert.equal(leadsIt({}, people, { ...none, email: 'ann@example.com' }), false)
    assert.equal(
      leadsIt({ leaderId: 'nobody' }, people, { ...none, email: 'ann@example.com' }),
      false
    )
  })
})
