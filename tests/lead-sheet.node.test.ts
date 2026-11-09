/** A lead sheet's range, and how it was read, from its melody (src/js/lead-sheet.ts) */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readOfMelody } from '../src/js/lead-sheet.ts'
import type { Step } from '../src/js/pitch.ts'
import type { ScoreEvent } from '../src/js/score.ts'
import { bar, melodyOf, note, rest } from './score-build.ts'

/** A note sung to `syllable`, or none; `cue` for a small one */
const sung = (step: Step, octave: number, syllable = '', cue = false) =>
  note(step, octave, { syllables: [syllable], cue })
/** A measure of a sheet in F (one flat), by the number the sheet prints */
const at = (number: number, events: ScoreEvent[]) => bar(events, { number, fifths: -1 })

test('the range of the sung notes, what was left out, and the bars of the two ends', () => {
  const read = readOfMelody(
    melodyOf(null, [
      // (a pickup, numbered 0 as the sheet prints it)
      at(0, [sung('C', 2, '', true), sung('C', 2, '', true)]),
      at(1, [sung('D', 4, 'Ho'), rest({ start: 1 }), sung('A', 5, 'ly')]),
      at(2, [sung('D', 4, 'ho'), sung('A', 5, 'ly')]),
      at(3, [sung('C', 6)]),
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
  assert.equal(readOfMelody(melodyOf(null, [at(1, [sung('C', 4, '', true)])])), null)
  assert.equal(readOfMelody(melodyOf(null, [])), null)
})
