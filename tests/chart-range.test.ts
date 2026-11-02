/**
 * A chart's melody range as a ChordPro directive (src/js/chart-range.ts).
 */
import { expect } from '@open-wc/testing'
import {
  describeSignature,
  formatRange,
  noteName,
  parseRange,
  rangeOfChart,
  rangeOfMetadata,
  rangeSpan,
  semitonesBetween,
  signatureMatchesKey,
  withRange,
} from '../src/js/chart-range.ts'
import type { NoteRange } from '../src/js/voice-range.ts'

const { describe, it } = window

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

describe('chart-range', () => {
  it('spells notes the way the key spells them', () => {
    expect(formatRange(range('D4', 'F#5'), 'G')).to.equal('D4-F#5')
    expect(formatRange(range('Bb3', 'Eb5'), 'Bb')).to.equal('Bb3-Eb5')
    expect(formatRange(range('G#3', 'C#5'), 'A')).to.equal('G#3-C#5')
    expect(formatRange(range('Ab3', 'Db5'), 'Ab')).to.equal('Ab3-Db5')
    // a note outside the key keeps the key's usual spelling
    expect(formatRange(range('Bb3', 'F#5'), 'C')).to.equal('Bb3-F#5')
    // B is Cb in a very flat key, and the octave number follows the name
    expect(formatRange(range('B3', 'C5'), 'Gb')).to.equal('Cb4-C5')
  })

  it('reads a range from the chart, in sharps or flats, with either dash', () => {
    expect(rangeOfChart('{x_chordless_range: D4-F#5}')).to.deep.equal(range('D4', 'F#5'))
    expect(rangeOfChart('{x_chordless_range:Bb3–Eb5}')).to.deep.equal(range('Bb3', 'Eb5'))
    expect(rangeOfChart('{key: C}\n  {x_chordless_range: C♯4 - F♯5}\n')).to.deep.equal(
      range('C#4', 'F#5')
    )
    expect(rangeOfChart('{x_chordless_range: Db4-Eb5}')).to.deep.equal(range('Db4', 'Eb5'))
  })

  it('says none for a chart with no range, or one that is not a range', () => {
    expect(rangeOfChart(CHART)).to.equal(null)
    for (const bad of ['', 'D4', 'D4-', 'H4-E5', 'E5-D4', 'D-E5', 'low-high']) {
      expect(rangeOfChart(`{x_chordless_range: ${bad}}`), bad).to.equal(null)
    }
  })

  it('puts the range in after the key', () => {
    const result = withRange(CHART, range('D4', 'E5'), 'G')
    expect(result).to.equal(
      `{title: Washed}\n{artist: Elevation Rhythm}\n{key: G}\n{x_chordless_range: D4-E5}\n{tempo: 139}\n\n[G]I've been washed\n`
    )
    expect(rangeOfChart(result)).to.deep.equal(range('D4', 'E5'))
  })

  it('replaces a range already in the chart where it stands', () => {
    const once = withRange(CHART, range('D4', 'E5'), 'G')
    const twice = withRange(once, range('E4', 'D5'), 'G')
    expect(twice.split('x_chordless_range')).to.have.length(2)
    expect(twice).to.equal(once.replace('D4-E5', 'E4-D5'))
  })

  it('replaces a range on the last line, with no line ending after it', () => {
    const chart = '{key: G}\n{x_chordless_range: D4-E5}'
    expect(withRange(chart, range('E4', 'D5'), 'G')).to.equal(
      '{key: G}\n{x_chordless_range: E4-D5}'
    )
  })

  it('gives a chart with no key one, and puts the range after the directives it opens with', () => {
    const chart = '{title: Song}\n{artist: Someone}\n\n[C]La la\n'
    expect(withRange(chart, range('C4', 'G4'), 'C')).to.equal(
      '{title: Song}\n{artist: Someone}\n{key: C}\n{x_chordless_range: C4-G4}\n\n[C]La la\n'
    )
    expect(withRange('[C]La la\n', range('C4', 'G4'), 'C')).to.equal(
      '{key: C}\n{x_chordless_range: C4-G4}\n[C]La la\n'
    )
  })

  it('writes a range from another key in the chart key, the near way round', () => {
    // the song now in A, where D4-E5 in G sounds a tone up
    expect(withRange(CHART, range('E4', 'F#5'), 'A')).to.contain('{x_chordless_range: D4-E5}')
    // down a tone: the chart says A, the song is in G
    const inA = CHART.replace('{key: G}', '{key: A}')
    expect(withRange(inA, range('D4', 'E5'), 'G')).to.contain('{x_chordless_range: E4-F#5}')
    // B to C is up one, not down eleven
    const inC = CHART.replace('{key: G}', '{key: C}')
    expect(withRange(inC, range('B3', 'B4'), 'B')).to.contain('{x_chordless_range: C4-C5}')
  })

  it('names a note in a key', () => {
    expect(noteName(midi('F#5'), 'G')).to.equal('F#5')
    expect(noteName(midi('Eb4'), 'Bb')).to.equal('Eb4')
  })

  it('says a key signature in words', () => {
    expect(describeSignature(0)).to.equal('no sharps or flats (C major or A minor)')
    expect(describeSignature(1)).to.equal('1 sharp (G major or E minor)')
    expect(describeSignature(3)).to.equal('3 sharps (A major or F# minor)')
    expect(describeSignature(-1)).to.equal('1 flat (F major or D minor)')
    expect(describeSignature(-2)).to.equal('2 flats (Bb major or G minor)')
  })

  it('knows which key a key signature is, major or minor, by pitch', () => {
    const cases: [number, string, boolean][] = [
      [1, 'G', true],
      [1, 'Em', true],
      [0, 'C', true],
      [0, 'Am', true],
      [-2, 'Bb', true],
      [-2, 'Gm', true],
      [3, 'A', true],
      [3, 'F#m', true],
      [3, 'F♯m', true],
      [-5, 'Db', true],
      [7, 'C#', true], // (the same pitch as D flat)
      [0, 'G', false],
      [1, 'A', false],
      [-2, 'Bm', false],
      [3, 'Am', false],
      [1, 'Gm', false],
    ]
    for (const [signature, key, expected] of cases) {
      expect(signatureMatchesKey(signature, key), `${signature} and ${key}`).to.equal(expected)
    }
  })

  it('takes a key it cannot read to match, as there is no telling', () => {
    expect(signatureMatchesKey(2, 'Hm')).to.equal(true)
    expect(signatureMatchesKey(2, '')).to.equal(true)
  })

  it('reads a range from a directive value, and from the metadata of a parsed chart', () => {
    expect(parseRange('Bb3-Eb5')).to.deep.equal(range('Bb3', 'Eb5'))
    expect(parseRange('nonsense')).to.equal(null)
    expect(rangeOfMetadata({ key: 'G', x_chordless_range: 'D4-E5' })).to.deep.equal(
      range('D4', 'E5')
    )
    expect(rangeOfMetadata({ key: 'G' })).to.equal(null)
    expect(rangeOfMetadata(undefined)).to.equal(null)
  })

  it('counts the semitones between keys the near way round, as the key picker lists them', () => {
    expect(semitonesBetween('G', 'A')).to.equal(2)
    expect(semitonesBetween('G', 'E')).to.equal(-3)
    expect(semitonesBetween('B', 'C')).to.equal(1)
    expect(semitonesBetween('C', 'B')).to.equal(-1)
    expect(semitonesBetween('G', 'G')).to.equal(0)
    expect(semitonesBetween('Em', 'Am')).to.equal(5)
  })

  it('says how wide a range is, in the scale tones it covers and in semitones', () => {
    // D to E an octave up: nine notes of the scale, a 9th
    expect(rangeSpan(range('D4', 'E5'), 'G')).to.deep.equal({ notes: 9, semitones: 14 })
    // an octave is eight notes, twelve semitones
    expect(rangeSpan(range('C4', 'C5'), 'C')).to.deep.equal({ notes: 8, semitones: 12 })
    expect(rangeSpan(range('Bb3', 'Eb5'), 'Bb')).to.deep.equal({ notes: 11, semitones: 17 })
    expect(rangeSpan(range('G4', 'G4'), 'G')).to.deep.equal({ notes: 1, semitones: 0 })
    // (counted by the notes of the key: the same range a tone up, in the key a tone up, is as wide)
    expect(rangeSpan(range('E4', 'F#5'), 'A')).to.deep.equal({ notes: 9, semitones: 14 })
  })

  it('keeps Windows line endings', () => {
    const chart = '{title: Song}\r\n{key: G}\r\n\r\n[G]La\r\n'
    const once = withRange(chart, range('D4', 'E5'), 'G')
    expect(once).to.equal(
      '{title: Song}\r\n{key: G}\r\n{x_chordless_range: D4-E5}\r\n\r\n[G]La\r\n'
    )
    expect(withRange(once, range('E4', 'F#5'), 'G')).to.equal(
      '{title: Song}\r\n{key: G}\r\n{x_chordless_range: E4-F#5}\r\n\r\n[G]La\r\n'
    )
  })
})
