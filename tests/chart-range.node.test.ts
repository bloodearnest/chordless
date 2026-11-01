/**
 * A chart's melody range as a ChordPro directive (src/js/chart-range.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatRange, rangeOfChart, withRange } from '../src/js/chart-range.ts'
import type { NoteRange } from '../src/js/voice-range.ts'

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** MIDI number of a note name like 'D4', 'F#5' or 'Bb3' */
function midi(name: string): number {
  const [, letter, accidental, octave] = /^([A-G])([#b]?)(\d)$/.exec(name) ?? []
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
  return 12 * (Number(octave) + 1) + SEMITONES[letter] + shift
}

const range = (low: string, high: string): NoteRange => ({ low: midi(low), high: midi(high) })

const CHART = `{title: Washed}
{artist: Elevation Rhythm}
{key: G}
{tempo: 139}

[G]I've been washed
`

test('notes are spelled the way the key spells them', () => {
  assert.equal(formatRange(range('D4', 'F#5'), 'G'), 'D4-F#5')
  assert.equal(formatRange(range('Bb3', 'Eb5'), 'Bb'), 'Bb3-Eb5')
  assert.equal(formatRange(range('G#3', 'C#5'), 'A'), 'G#3-C#5')
  assert.equal(formatRange(range('Ab3', 'Db5'), 'Ab'), 'Ab3-Db5')
  // a note outside the key keeps the key's usual spelling
  assert.equal(formatRange(range('Bb3', 'F#5'), 'C'), 'Bb3-F#5')
  assert.equal(formatRange(range('B3', 'C5'), 'Gb'), 'Cb4-C5')
})

test('a range is read from the chart, in sharps or flats, with either dash', () => {
  assert.deepEqual(rangeOfChart('{x_chordless_range: D4-F#5}'), range('D4', 'F#5'))
  assert.deepEqual(rangeOfChart('{x_chordless_range:Bb3–Eb5}'), range('Bb3', 'Eb5'))
  assert.deepEqual(
    rangeOfChart('{key: C}\n  {x_chordless_range: C♯4 - F♯5}\n'),
    range('C#4', 'F#5')
  )
})

test('a chart with no range, or one that is not a range, has none', () => {
  assert.equal(rangeOfChart(CHART), null)
  for (const bad of ['', 'D4', 'D4-', 'H4-E5', 'E5-D4', 'D-E5', 'low-high']) {
    assert.equal(rangeOfChart(`{x_chordless_range: ${bad}}`), null, bad)
  }
})

test('the range goes in after the key', () => {
  const result = withRange(CHART, range('D4', 'E5'), 'G')
  assert.equal(
    result,
    `{title: Washed}\n{artist: Elevation Rhythm}\n{key: G}\n{x_chordless_range: D4-E5}\n{tempo: 139}\n\n[G]I've been washed\n`
  )
  assert.deepEqual(rangeOfChart(result), range('D4', 'E5'))
})

test('a range already in the chart is replaced where it stands', () => {
  const once = withRange(CHART, range('D4', 'E5'), 'G')
  const twice = withRange(once, range('E4', 'D5'), 'G')
  assert.equal(twice.split('x_chordless_range').length, 2)
  assert.equal(twice, once.replace('D4-E5', 'E4-D5'))
})

test('a chart with no key is given one, and the range goes after the directives it opens with', () => {
  const chart = '{title: Song}\n{artist: Someone}\n\n[C]La la\n'
  assert.equal(
    withRange(chart, range('C4', 'G4'), 'C'),
    '{title: Song}\n{artist: Someone}\n{key: C}\n{x_chordless_range: C4-G4}\n\n[C]La la\n'
  )
  assert.equal(
    withRange('[C]La la\n', range('C4', 'G4'), 'C'),
    '{key: C}\n{x_chordless_range: C4-G4}\n[C]La la\n'
  )
})

test('a range in another key than the chart is written in the chart key, the near way round', () => {
  // the song now in A, where D4-E5 sounds a tone up; the chart says G
  assert.equal(
    withRange(CHART, range('E4', 'F#5'), 'A').includes('{x_chordless_range: D4-E5}'),
    true
  )
  // down a tone: the chart says A, the song is in G
  const inA = CHART.replace('{key: G}', '{key: A}')
  assert.equal(withRange(inA, range('D4', 'E5'), 'G').includes('{x_chordless_range: E4-F#5}'), true)
  // B to C is up one, not down eleven
  const inC = CHART.replace('{key: G}', '{key: C}')
  assert.equal(withRange(inC, range('B3', 'B4'), 'B').includes('{x_chordless_range: C4-C5}'), true)
})

test('Windows line endings are kept', () => {
  const chart = '{title: Song}\r\n{key: G}\r\n\r\n[G]La\r\n'
  assert.equal(
    withRange(chart, range('D4', 'E5'), 'G'),
    '{title: Song}\r\n{key: G}\r\n{x_chordless_range: D4-E5}\r\n\r\n[G]La\r\n'
  )
  const again = withRange(withRange(chart, range('D4', 'E5'), 'G'), range('E4', 'F#5'), 'G')
  assert.equal(again, '{title: Song}\r\n{key: G}\r\n{x_chordless_range: E4-F#5}\r\n\r\n[G]La\r\n')
})
