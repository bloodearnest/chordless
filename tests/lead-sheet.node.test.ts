/** A lead sheet's range, and how it was read, from its melody (src/js/lead-sheet.ts) */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readOfMelody } from '../src/js/lead-sheet.ts'
import type { Melody, MelodyMeasure, MelodyNote } from '../src/js/melody.ts'
import { midiOf } from '../src/js/pitch.ts'

const note = (
  step: MelodyNote['step'],
  octave: number,
  syllable = '',
  cue = false
): MelodyNote => ({
  kind: 'note',
  id: `${step}${octave}`,
  step,
  alter: 0,
  octave,
  midi: midiOf(step, 0, octave),
  start: 0,
  duration: 1,
  tupletRatio: 1,
  tieStart: false,
  tieStop: false,
  cue,
  syllables: [syllable],
  withPrevious: false,
})
const bar = (number: number, notes: MelodyNote[]): MelodyMeasure => ({
  number,
  voices: [notes],
  chords: [],
  section: null,
  barline: 'single',
  directions: [],
  repeatStart: false,
  ending: null,
  length: 4,
  full: true,
  fifths: -1,
  beats: 4,
  beatType: 4,
  tempo: null,
})
const sheet = (measures: MelodyMeasure[]): Melody => ({ title: null, notice: [], measures })

test('the range of the sung notes, what was left out, and the bars of the two ends', () => {
  const read = readOfMelody(
    sheet([
      // (a pickup, numbered 0 as the sheet prints it)
      bar(0, [note('C', 2, '', true), note('C', 2, '', true)]),
      bar(1, [note('D', 4, 'Ho'), note('A', 5, 'ly')]),
      bar(2, [note('D', 4, 'ho'), note('A', 5, 'ly')]),
      bar(3, [note('C', 6)]),
    ])
  )
  assert.deepEqual(read, {
    low: 62,
    high: 81,
    keySignature: -1,
    notes: 4,
    instrumental: 2,
    unsung: 1,
    bars: 4,
    lowAt: 1,
    highAt: 1,
  })
})

test('no range from a sheet with no sung note', () => {
  assert.equal(readOfMelody(sheet([bar(1, [note('C', 4, '', true)])])), null)
  assert.equal(readOfMelody(sheet([])), null)
})
