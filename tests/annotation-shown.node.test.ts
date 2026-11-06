/**
 * Annotations as they are drawn (src/js/annotations/shown.ts): placed on sections and lines, and put into the
 * lines by cutting a segment where a annotation falls, so chords and annotations are laid out together.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sectionAnchor, textAnchor } from '../src/js/annotations/anchor.ts'
import { annotationsBySection, attachAnnotations } from '../src/js/annotations/shown.ts'
import { noSources, putAnnotation } from '../src/js/annotations/store.ts'
import type { ChartAnnotation, ChartLine, ChartSection } from '../src/js/data-types.ts'

const line = (...parts: [string, string][]): ChartLine => ({
  segments: parts.map(([chord, lyrics]) => ({ chord, lyrics })),
})
const annotation = (id: string, anchor: ChartAnnotation['anchor'], text = id): ChartAnnotation => ({
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

test('a annotation at a segment start rides that segment, with its chord', () => {
  const lines = attachAnnotations(sections[0].lines, [
    { line: 0, offset: 8, annotation: shown('a') },
  ])
  assert.deepEqual(lines[0].segments, [
    { chord: 'C', lyrics: 'Amazing ' },
    { chord: 'G', lyrics: 'grace how sweet', annotations: [shown('a')] },
  ])
})

test('a annotation inside a segment cuts it, the new piece with no chord carrying the annotation', () => {
  const lines = attachAnnotations(sections[0].lines, [
    { line: 0, offset: 14, annotation: shown('a') },
  ])
  assert.deepEqual(lines[0].segments, [
    { chord: 'C', lyrics: 'Amazing ' },
    { chord: 'G', lyrics: 'grace ' },
    { chord: '', lyrics: 'how sweet', annotations: [shown('a')] },
  ])
})

test('two annotations in one segment, and one at the start of the line', () => {
  const lines = attachAnnotations(sections[0].lines, [
    { line: 0, offset: 14, annotation: shown('b') },
    { line: 0, offset: 0, annotation: shown('a') },
    { line: 0, offset: 8, annotation: shown('c') },
  ])
  assert.deepEqual(
    lines[0].segments.map(s => [s.chord, s.lyrics, s.annotations?.map(n => n.id)]),
    [
      ['C', 'Amazing ', ['a']],
      ['G', 'grace ', ['c']],
      ['', 'how sweet', ['b']],
    ]
  )
})

test('a annotation at or past the end of a line is carried by a piece with no lyrics', () => {
  const lines = attachAnnotations(sections[0].lines, [
    { line: 0, offset: 99, annotation: shown('a') },
  ])
  assert.deepEqual(lines[0].segments.at(-1), { chord: '', lyrics: '', annotations: [shown('a')] })
  assert.equal(lines[0].segments.map(s => s.lyrics).join(''), 'Amazing grace how sweet')
})

test('a annotation on a chord with no lyrics rides the chord, once', () => {
  const lines = attachAnnotations(
    [line(['C', 'Hi'], ['G', ''], ['', 'there'])],
    [{ line: 0, offset: 2, annotation: shown('a') }]
  )
  assert.deepEqual(
    lines[0].segments.map(s => [s.chord, s.lyrics, s.annotations?.length ?? 0]),
    [
      ['C', 'Hi', 0],
      ['G', '', 1],
      ['', 'there', 0],
    ]
  )
})

test('a blank line takes a annotation on a segment of its own, and the chart’s lines are not changed', () => {
  const blank: ChartLine = { segments: [] }
  const original = sections[0].lines
  const before = JSON.stringify(original)
  assert.deepEqual(
    attachAnnotations([blank], [{ line: 0, offset: 0, annotation: shown('a') }])[0].segments,
    [{ chord: '', lyrics: '', annotations: [shown('a')] }]
  )
  const lines = attachAnnotations(
    [...original, line(['A', 'x'])],
    [{ line: 1, offset: 0, annotation: shown('a') }]
  )
  assert.equal(lines[0], original[0])
  assert.notEqual(lines[1], undefined)
  assert.equal(JSON.stringify(original), before)
  assert.equal(attachAnnotations(original, []), original)
})

test('annotations are placed on titles, lines, the song and (when their place is gone) the song, marked', () => {
  let s = putAnnotation(noSources(), annotation('title', sectionAnchor(sections, 1)), {
    scope: 'setlist',
    reach: 'shared',
  })
  s = putAnnotation(s, annotation('spot', textAnchor(sections, 1, 1, 0)), {
    scope: 'setlist',
    reach: 'private',
  })
  s = putAnnotation(s, annotation('whole', { kind: 'song' }), { scope: 'song', reach: 'private' })
  s = putAnnotation(s, annotation('lost', { kind: 'section', label: 'Bridge', nth: 0 }), {
    scope: 'setlist',
    reach: 'private',
  })
  const placed = annotationsBySection(sections, s)
  assert.deepEqual(placed.sections[1].title, [shown('title', true)])
  assert.deepEqual(placed.sections[1].lines, [{ line: 1, offset: 0, annotation: shown('spot') }])
  assert.deepEqual(placed.sections[0], { title: [], lines: [] })
  // (this setlist’s annotations come before the song’s own)
  assert.deepEqual(placed.song, [{ ...shown('lost'), orphan: true }, shown('whole')])
})

test('annotations can be left out by who they are from, and drawings are not drawn yet', () => {
  let s = putAnnotation(noSources(), annotation('team', { kind: 'song' }), {
    scope: 'setlist',
    reach: 'shared',
  })
  s = putAnnotation(s, annotation('mine', { kind: 'song' }), { scope: 'setlist', reach: 'private' })
  s = putAnnotation(
    s,
    { ...annotation('ink', { kind: 'song' }), body: { kind: 'ink', strokes: [], w: 1, h: 1 } },
    { scope: 'song', reach: 'private' }
  )
  assert.deepEqual(
    annotationsBySection(sections, s).song.map(n => n.id),
    ['team', 'mine']
  )
  assert.deepEqual(
    annotationsBySection(sections, s, { shared: false, mine: true }).song.map(n => n.id),
    ['mine']
  )
  assert.deepEqual(
    annotationsBySection(sections, s, { shared: true, mine: false }).song.map(n => n.id),
    ['team']
  )
})
