/**
 * Notes as they are drawn (src/js/notes/shown.ts): placed on sections and lines, and put into the
 * lines by cutting a segment where a note falls, so chords and notes are laid out together.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChartLine, ChartNote, ChartSection } from '../src/js/data-types.ts'
import { sectionAnchor, textAnchor } from '../src/js/notes/anchor.ts'
import { attachNotes, notesBySection } from '../src/js/notes/shown.ts'
import { noSources, putNote } from '../src/js/notes/store.ts'

const line = (...parts: [string, string][]): ChartLine => ({
  segments: parts.map(([chord, lyrics]) => ({ chord, lyrics })),
})
const note = (id: string, anchor: ChartNote['anchor'], text = id): ChartNote => ({
  id,
  anchor,
  body: { kind: 'text', text },
  modified: '',
})
const shown = (id: string, shared = false) => ({ id, text: id, shared })
const sections: ChartSection[] = [
  { type: 'section', label: 'Verse', lines: [line(['C', 'Amazing '], ['G', 'grace how sweet'])] },
  { type: 'section', label: 'Chorus', lines: [line(['', 'Oh how']), line(['D', 'free'])] },
]

test('a note at a segment start rides that segment, with its chord', () => {
  const lines = attachNotes(sections[0].lines, [{ line: 0, offset: 8, note: shown('a') }])
  assert.deepEqual(lines[0].segments, [
    { chord: 'C', lyrics: 'Amazing ' },
    { chord: 'G', lyrics: 'grace how sweet', notes: [shown('a')] },
  ])
})

test('a note inside a segment cuts it, the new piece with no chord carrying the note', () => {
  const lines = attachNotes(sections[0].lines, [{ line: 0, offset: 14, note: shown('a') }])
  assert.deepEqual(lines[0].segments, [
    { chord: 'C', lyrics: 'Amazing ' },
    { chord: 'G', lyrics: 'grace ' },
    { chord: '', lyrics: 'how sweet', notes: [shown('a')] },
  ])
})

test('two notes in one segment, and one at the start of the line', () => {
  const lines = attachNotes(sections[0].lines, [
    { line: 0, offset: 14, note: shown('b') },
    { line: 0, offset: 0, note: shown('a') },
    { line: 0, offset: 8, note: shown('c') },
  ])
  assert.deepEqual(
    lines[0].segments.map(s => [s.chord, s.lyrics, s.notes?.map(n => n.id)]),
    [
      ['C', 'Amazing ', ['a']],
      ['G', 'grace ', ['c']],
      ['', 'how sweet', ['b']],
    ]
  )
})

test('a note at or past the end of a line is carried by a piece with no lyrics', () => {
  const lines = attachNotes(sections[0].lines, [{ line: 0, offset: 99, note: shown('a') }])
  assert.deepEqual(lines[0].segments.at(-1), { chord: '', lyrics: '', notes: [shown('a')] })
  assert.equal(lines[0].segments.map(s => s.lyrics).join(''), 'Amazing grace how sweet')
})

test('a note on a chord with no lyrics rides the chord, once', () => {
  const lines = attachNotes(
    [line(['C', 'Hi'], ['G', ''], ['', 'there'])],
    [{ line: 0, offset: 2, note: shown('a') }]
  )
  assert.deepEqual(
    lines[0].segments.map(s => [s.chord, s.lyrics, s.notes?.length ?? 0]),
    [
      ['C', 'Hi', 0],
      ['G', '', 1],
      ['', 'there', 0],
    ]
  )
})

test('a blank line takes a note on a segment of its own, and the chart’s lines are not changed', () => {
  const blank: ChartLine = { segments: [] }
  const original = sections[0].lines
  const before = JSON.stringify(original)
  assert.deepEqual(attachNotes([blank], [{ line: 0, offset: 0, note: shown('a') }])[0].segments, [
    { chord: '', lyrics: '', notes: [shown('a')] },
  ])
  const lines = attachNotes(
    [...original, line(['A', 'x'])],
    [{ line: 1, offset: 0, note: shown('a') }]
  )
  assert.equal(lines[0], original[0])
  assert.notEqual(lines[1], undefined)
  assert.equal(JSON.stringify(original), before)
  assert.equal(attachNotes(original, []), original)
})

test('notes are placed on titles, lines, the song and (when their place is gone) the song, marked', () => {
  let s = putNote(noSources(), note('title', sectionAnchor(sections, 1)), {
    scope: 'setlist',
    reach: 'shared',
  })
  s = putNote(s, note('spot', textAnchor(sections, 1, 1, 0)), {
    scope: 'setlist',
    reach: 'private',
  })
  s = putNote(s, note('whole', { kind: 'song' }), { scope: 'song', reach: 'private' })
  s = putNote(s, note('lost', { kind: 'section', label: 'Bridge', nth: 0 }), {
    scope: 'setlist',
    reach: 'private',
  })
  const placed = notesBySection(sections, s)
  assert.deepEqual(placed.sections[1].title, [shown('title', true)])
  assert.deepEqual(placed.sections[1].lines, [{ line: 1, offset: 0, note: shown('spot') }])
  assert.deepEqual(placed.sections[0], { title: [], lines: [] })
  // (this setlist’s notes come before the song’s own)
  assert.deepEqual(placed.song, [{ ...shown('lost'), orphan: true }, shown('whole')])
})

test('notes can be left out by who they are from, and drawings are not drawn yet', () => {
  let s = putNote(noSources(), note('team', { kind: 'song' }), {
    scope: 'setlist',
    reach: 'shared',
  })
  s = putNote(s, note('mine', { kind: 'song' }), { scope: 'setlist', reach: 'private' })
  s = putNote(
    s,
    { ...note('ink', { kind: 'song' }), body: { kind: 'ink', strokes: [], w: 1, h: 1 } },
    { scope: 'song', reach: 'private' }
  )
  assert.deepEqual(
    notesBySection(sections, s).song.map(n => n.id),
    ['team', 'mine']
  )
  assert.deepEqual(
    notesBySection(sections, s, { shared: false, mine: true }).song.map(n => n.id),
    ['mine']
  )
  assert.deepEqual(
    notesBySection(sections, s, { shared: true, mine: false }).song.map(n => n.id),
    ['team']
  )
})
