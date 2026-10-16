/** Renumbering what a setlist keeps per song when a song is moved or removed */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { afterMove, afterRemoval, renumberSongs } from '../src/js/setlist/local-state.ts'

const places = (remap: (index: number) => number | null, count = 5) =>
  Array.from({ length: count }, (_, index) => remap(index))

test('moving a song down shifts the songs it passes up by one', () => {
  assert.deepEqual(places(afterMove(1, 3)), [0, 3, 1, 2, 4])
})

test('moving a song up shifts the songs it passes down by one', () => {
  assert.deepEqual(places(afterMove(3, 1)), [0, 2, 3, 1, 4])
})

test('removing a song drops it and shifts the ones after it up', () => {
  assert.deepEqual(places(afterRemoval(2)), [0, 1, null, 2, 3])
})

test('a record is renumbered by its keys, as numbers or as the text they were saved as', () => {
  assert.deepEqual(renumberSongs({ 0: 'a', 1: 'b', '2': 'c' }, afterRemoval(1)), { 0: 'a', 1: 'c' })
})
