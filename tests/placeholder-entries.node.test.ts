/** The entries the first folder import made for files with no chart, read for the song they were */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPlaceholderEntry, placeholderSong } from '../src/js/placeholder-entries.ts'

const inline = (file: string) => `ChordPro inline: ${file}`

test("reads the song and key from the file's name, as the import named them", () => {
  const cases: [string, string, string | null][] = [
    ['in-your-presence-G.txt', 'in your presence', 'G'],
    ['the-highest-and-the-greatest-Bb.txt', 'the highest and the greatest', 'Bb'],
    ['4-My-Hope-D.txt', 'My Hope', 'D'],
    ['2gonna-trust-in-god-E.txt', 'gonna trust in god', 'E'],
    ['7king-of-wonders-chords-E.txt', 'king of wonders', 'E'],
    ['3King Of Wonders-chords-G.txt', 'King Of Wonders', 'G'],
    ['6When Words Are Not Enough-chords-D.txt', 'When Words Are Not Enough', 'D'],
    ['F#m-song-F#m.txt', 'F#m song', 'F#m'],
  ]
  for (const [file, title, key] of cases)
    assert.deepEqual(placeholderSong(inline(file)), { title, key }, file)
})

test('a name with no key is all title, and notes that name no file are no song', () => {
  assert.deepEqual(placeholderSong(inline('amazing-grace.txt')), {
    title: 'amazing grace',
    key: null,
  })
  assert.deepEqual(placeholderSong(inline('G.txt')), { title: 'G', key: null })
  assert.equal(placeholderSong('Repeat the chorus'), null)
  assert.equal(placeholderSong(inline('12.txt')), null)
})

test('is an entry of the import only with both its id and its notes', () => {
  assert.equal(isPlaceholderEntry({ songId: 'placeholder-hash-1', notes: inline('a.txt') }), true)
  assert.equal(isPlaceholderEntry({ songId: 'placeholder-hash-1', notes: 'mine' }), false)
  assert.equal(isPlaceholderEntry({ songId: 'ccli-1', notes: inline('a.txt') }), false)
  assert.equal(isPlaceholderEntry({ songId: 'placeholder-hash-1' }), false)
})
