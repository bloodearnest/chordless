/**
 * Where annotations sit on a chart and finding the place again (src/js/annotations/anchor.ts): by section
 * label and the lyrics around a spot, so an edited chart moves an annotation rather than losing it.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  placeAnnotations,
  resolveAnchor,
  sectionAnchor,
  snapOffset,
  textAnchor,
} from '../src/js/annotations/anchor.ts'
import type { ChartSection } from '../src/js/data-types.ts'

const section = (label: string | null, ...lines: string[][]): ChartSection => ({
  type: 'section',
  label,
  lines: lines.map(segments => ({
    segments: segments.map((lyrics, i) => ({ chord: i ? 'G' : 'C', lyrics })),
  })),
})

const chart = [
  section('Verse', ['Amazing ', 'grace how sweet'], ['the sound that saved']),
  section('Chorus', ['My chains are gone']),
  section('Verse', ['Twas grace that taught']),
]

test('a spot is remembered by its lyrics, not by its chords', () => {
  const anchor = textAnchor(chart, 0, 0, 8)
  assert.deepEqual(anchor, {
    kind: 'text',
    label: 'Verse',
    nth: 0,
    line: 0,
    offset: 8,
    before: 'Amazing ',
    after: 'grace how sw',
  })
  assert.deepEqual(resolveAnchor(chart, anchor), { place: 'text', section: 0, line: 0, offset: 8 })
})

test('the second section with the same label is found as the second', () => {
  assert.deepEqual(sectionAnchor(chart, 2), { kind: 'section', label: 'Verse', nth: 1 })
  assert.deepEqual(resolveAnchor(chart, sectionAnchor(chart, 2)), { place: 'section', section: 2 })
})

test('a song annotation is the song', () => {
  assert.deepEqual(resolveAnchor(chart, { kind: 'song' }), { place: 'song' })
})

test('an edited line moves the annotation with its text', () => {
  const anchor = textAnchor(chart, 0, 1, 4)
  const edited = [
    section('Verse', ['A new first line'], ['the sound that saved']),
    ...chart.slice(1),
  ]
  assert.deepEqual(resolveAnchor(edited, anchor), { place: 'text', section: 0, line: 1, offset: 4 })
  const moved = [
    section('Verse', ['A new first line'], ['an extra'], ['the sound that saved']),
    ...chart.slice(1),
  ]
  assert.deepEqual(resolveAnchor(moved, anchor), { place: 'text', section: 0, line: 2, offset: 4 })
})

test('a section that was renamed is searched for the text, in the whole chart', () => {
  const anchor = textAnchor(chart, 1, 0, 3)
  const renamed = [
    chart[0] as ChartSection,
    section('Refrain', ['My chains are gone']),
    chart[2] as ChartSection,
  ]
  assert.deepEqual(resolveAnchor(renamed, anchor), {
    place: 'text',
    section: 1,
    line: 0,
    offset: 3,
  })
})

test('text gone from a section that is still there falls back to the section', () => {
  const anchor = textAnchor(chart, 1, 0, 3)
  const rewritten = [
    chart[0] as ChartSection,
    section('Chorus', ['Something else entirely']),
    chart[2] as ChartSection,
  ]
  assert.deepEqual(resolveAnchor(rewritten, anchor), { place: 'section', section: 1 })
})

test('an annotation whose section and text are both gone is orphaned, not dropped', () => {
  assert.deepEqual(resolveAnchor([chart[0] as ChartSection], textAnchor(chart, 1, 0, 3)), {
    place: 'orphan',
  })
  assert.deepEqual(resolveAnchor([chart[0] as ChartSection], sectionAnchor(chart, 1)), {
    place: 'orphan',
  })
})

test('a spot on a blank line that is gone falls back to its section: there is no text to search for', () => {
  const blank = [section('Intro', [''])]
  const anchor = textAnchor(blank, 0, 0, 0)
  assert.deepEqual(
    resolveAnchor([section('Intro', ['one'])], { ...anchor, line: 3 } as typeof anchor),
    {
      place: 'section',
      section: 0,
    }
  )
})

test('an offset past the end is clamped, and a blank line still holds its annotation', () => {
  const blank = [section('Intro', [''])]
  const anchor = textAnchor(blank, 0, 0, 40)
  assert.equal(anchor.kind === 'text' && anchor.offset, 0)
  assert.deepEqual(resolveAnchor(blank, anchor), { place: 'text', section: 0, line: 0, offset: 0 })
})

test('every annotation is placed, in the order given', () => {
  const annotations = [
    {
      id: 'a',
      anchor: sectionAnchor(chart, 1),
      body: { kind: 'text', text: 'build' },
      modified: '',
    },
    { id: 'b', anchor: { kind: 'song' }, body: { kind: 'text', text: 'fast' }, modified: '' },
  ] as const
  assert.deepEqual(
    placeAnnotations(chart, [...annotations]).map(({ annotation, placement }) => [
      annotation.id,
      placement.place,
    ]),
    [
      ['a', 'section'],
      ['b', 'song'],
    ]
  )
})

test('an approximate spot snaps to the nearest start of a word or segment', () => {
  const verse = chart[0] as ChartSection
  // "Amazing " | "grace how sweet": words start at 0, 8, 14, 18; the segment at 8
  assert.equal(snapOffset(verse, 0, 0), 0)
  assert.equal(snapOffset(verse, 0, 7), 8)
  assert.equal(snapOffset(verse, 0, 10), 8)
  assert.equal(snapOffset(verse, 0, 16), 14)
  assert.equal(snapOffset(verse, 0, 99), 18)
  assert.equal(snapOffset(verse, 5, 3), 0)
  assert.equal(snapOffset(section('Hy', ['Maj - ', 'es - ', 'ty']), 0, 7), 6)
})
