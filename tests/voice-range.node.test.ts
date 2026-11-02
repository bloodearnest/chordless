/**
 * Whether a melody can be sung in a key (src/js/voice-range.ts, docs/RANGE.md).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  describeRange,
  type NoteRange,
  type RangeStatus,
  rangeStatus,
} from '../src/js/voice-range.ts'

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** MIDI number of a note name like 'D4', 'F#5' or 'Bb3' */
function midi(name: string): number {
  const [, letter, accidental, octave] = /^([A-G])([#b]?)(\d)$/.exec(name) ?? []
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
  return 12 * (Number(octave) + 1) + SEMITONES[letter] + shift
}

const range = (low: string, high: string): NoteRange => ({ low: midi(low), high: midi(high) })

test('the highest note: green to C#5, yellow from D5 to E5, red from F5', () => {
  const cases: [string, RangeStatus][] = [
    ['G4', 'green'],
    ['C#5', 'green'],
    ['D5', 'yellow'],
    ['E5', 'yellow'],
    ['F5', 'red'],
    ['F#5', 'red'],
    ['C6', 'red'],
  ]
  for (const [high, expected] of cases) {
    const check = rangeStatus(range('D4', high))
    assert.equal(check.high, expected, `high ${high}`)
    assert.equal(check.low, 'green')
    assert.equal(check.status, expected)
  }
})

test('the lowest note: green from B3, yellow from G3 to A#3, red below G3', () => {
  const cases: [string, RangeStatus][] = [
    ['D4', 'green'],
    ['B3', 'green'],
    ['A#3', 'yellow'],
    ['G3', 'yellow'],
    ['F#3', 'red'],
    ['C3', 'red'],
  ]
  for (const [low, expected] of cases) {
    const check = rangeStatus(range(low, 'C5'))
    assert.equal(check.low, expected, `low ${low}`)
    assert.equal(check.high, 'green')
    assert.equal(check.status, expected)
  }
})

test('the song is as good as its worse end', () => {
  assert.deepEqual(rangeStatus(range('G3', 'F#5')), { status: 'red', low: 'yellow', high: 'red' })
  assert.deepEqual(rangeStatus(range('F#3', 'D5')), {
    status: 'red',
    low: 'red',
    high: 'yellow',
  })
  assert.deepEqual(rangeStatus(range('A#3', 'D5')), {
    status: 'yellow',
    low: 'yellow',
    high: 'yellow',
  })
})

test('a key is its distance from the key the range was written in', () => {
  // Washed, written in G: D4 to E5
  const washed = range('D4', 'E5')
  const byKey: [number, RangeStatus][] = [
    [+2, 'red'], // A: F#5
    [0, 'yellow'], // G: E5
    [-2, 'yellow'], // F: D5
    [-3, 'green'], // E: C#5
    [-7, 'yellow'], // C: low G3... the top is fine, the bottom is the edge
    [-8, 'red'], // B: low F#3
  ]
  for (const [semitones, expected] of byKey) {
    assert.equal(rangeStatus(washed, semitones).status, expected, `${semitones} semitones`)
  }
})

test('a song that starts red is red in its own key and green in a lower one', () => {
  // 10,000 Reasons, written in G: D4 to F#5
  const reasons = range('D4', 'F#5')
  assert.equal(rangeStatus(reasons).status, 'red')
  assert.equal(rangeStatus(reasons, -3).high, 'yellow')
  assert.equal(rangeStatus(reasons, -5).high, 'green')
})

test('a check is told in a tone, a direction and words, so colour is never the only sign', () => {
  assert.deepEqual(describeRange(rangeStatus(range('D4', 'C5'))), {
    tone: 'green',
    direction: 'none',
    words: '',
  })
  assert.deepEqual(describeRange(rangeStatus(range('D4', 'E5'))), {
    tone: 'yellow',
    direction: 'high',
    words: 'high',
  })
  assert.deepEqual(describeRange(rangeStatus(range('A#3', 'C5'))), {
    tone: 'yellow',
    direction: 'low',
    words: 'low',
  })
  assert.deepEqual(describeRange(rangeStatus(range('D4', 'F#5'))), {
    tone: 'red',
    direction: 'high',
    words: 'too high',
  })
  assert.deepEqual(describeRange(rangeStatus(range('F#3', 'C5'))), {
    tone: 'red',
    direction: 'low',
    words: 'too low',
  })
  assert.deepEqual(describeRange(rangeStatus(range('G3', 'F#5'))), {
    tone: 'red',
    direction: 'both',
    words: 'too high, low',
  })
})

test('an end that is red says too, an end that is yellow does not, and both ends are named', () => {
  assert.equal(describeRange(rangeStatus(range('G3', 'F#5'))).words, 'too high, low')
  assert.equal(describeRange(rangeStatus(range('F#3', 'D5'))).words, 'high, too low')
  assert.equal(describeRange(rangeStatus(range('A#3', 'D5'))).words, 'high, low')
  assert.equal(describeRange(rangeStatus(range('F#3', 'F#5'))).words, 'too high, too low')
})
