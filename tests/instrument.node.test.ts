/** My instrument (src/js/instrument.ts): an offset in semitones, and how it joins the capo */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  INSTRUMENT_OPTIONS,
  instrumentLabel,
  normalizeInstrument,
  shapesFor,
} from '../src/js/instrument.ts'
import { transposeKeyName } from '../src/js/transpose.ts'

describe('My instrument', () => {
  test('is a whole number of semitones from 0 to 11, wrapped, and none for anything else', () => {
    assert.equal(normalizeInstrument(2), 2)
    assert.equal(normalizeInstrument('9'), 9)
    assert.equal(normalizeInstrument(12), 0)
    assert.equal(normalizeInstrument(14), 2)
    assert.equal(normalizeInstrument(-3), 9)
    assert.equal(normalizeInstrument(2.4), 2)
    assert.equal(normalizeInstrument('nope'), 0)
    assert.equal(normalizeInstrument(null), 0)
    assert.equal(normalizeInstrument(undefined), 0)
    assert.equal(normalizeInstrument(Number.POSITIVE_INFINITY), 0)
  })

  test('has an option for every offset, named for what it suits', () => {
    assert.deepEqual(
      INSTRUMENT_OPTIONS.map(each => each.semitones),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    )
    assert.equal(instrumentLabel(0), 'Concert pitch')
    assert.equal(instrumentLabel(9), '+9 (E♭ instrument)')
    assert.equal(instrumentLabel(2), '+2 (B♭ instrument; guitar tuned a whole step down)')
    assert.equal(instrumentLabel(4), '+4')
    assert.equal(instrumentLabel(-3), '+9 (E♭ instrument)')
  })

  test('moves the chords by the instrument and then the capo, as one capo and the key to spell by', () => {
    const key = (semitones: number) => transposeKeyName('G', semitones)
    assert.deepEqual(shapesFor(0, 0, key), { capo: 0, key: '' })
    // (the capo alone is as it was)
    assert.deepEqual(shapesFor(0, 2, key), { capo: 2, key: 'F' })
    // (a B♭ instrument reads a G chart in A, which is the same as a capo at 10)
    assert.deepEqual(shapesFor(2, 0, key), { capo: 10, key: 'A' })
    // (the two cancel when they are equal)
    assert.deepEqual(shapesFor(2, 2, key), { capo: 0, key: '' })
    // (an E♭ instrument reads up 9, which is down 3: the same as a capo at 3; a capo 3 on top is down 6)
    assert.deepEqual(shapesFor(9, 0, key), { capo: 3, key: 'E' })
    assert.deepEqual(shapesFor(9, 3, key), { capo: 6, key: key(-6) })
  })

  test('takes a capo that is not a fret as none', () => {
    const key = (semitones: number) => transposeKeyName('G', semitones)
    assert.deepEqual(shapesFor(0, -1, key), { capo: 0, key: '' })
    assert.deepEqual(shapesFor(2, 0.4, key), { capo: 10, key: 'A' })
  })
})
