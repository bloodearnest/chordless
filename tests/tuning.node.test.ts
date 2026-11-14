/** How a guitar is tuned (src/js/tuning.ts), and how that joins the capo */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { transposeKeyName } from '../src/js/transpose.ts'
import { normalizeTuning, shapesFor, TUNINGS, tuningLabel } from '../src/js/tuning.ts'

describe('tuning', () => {
  test('is standard, a half step down or a whole step down, and standard for anything else', () => {
    assert.deepEqual(
      TUNINGS.map(each => each.semitones),
      [0, 1, 2]
    )
    assert.equal(normalizeTuning(1), 1)
    assert.equal(normalizeTuning('2'), 2)
    assert.equal(normalizeTuning(3), 0)
    assert.equal(normalizeTuning(-1), 0)
    assert.equal(normalizeTuning('nope'), 0)
    assert.equal(normalizeTuning(null), 0)
    assert.equal(normalizeTuning(undefined), 0)
  })

  test('is named in words', () => {
    assert.equal(tuningLabel(0), 'Standard')
    assert.equal(tuningLabel(1), 'Half step down')
    assert.equal(tuningLabel(2), 'Whole step down')
    assert.equal(tuningLabel('x'), 'Standard')
  })

  test('moves the chords up by the tuning and down by the capo, as one capo and the key to spell by', () => {
    const key = (semitones: number) => transposeKeyName('G', semitones)
    assert.deepEqual(shapesFor(0, 0, key), { capo: 0, key: '' })
    // (the capo alone is as it was)
    assert.deepEqual(shapesFor(0, 2, key), { capo: 2, key: 'F' })
    // (tuned a half step down, the shapes go up one: the same as a capo at 11)
    assert.deepEqual(shapesFor(1, 0, key), { capo: 11, key: key(1) })
    assert.deepEqual(shapesFor(2, 0, key), { capo: 10, key: 'A' })
    // (and a capo on top of it: tuned a half step down with a capo 2 plays as a capo 1)
    assert.deepEqual(shapesFor(1, 2, key), { capo: 1, key: key(-1) })
    // (the two cancel when they are equal)
    assert.deepEqual(shapesFor(2, 2, key), { capo: 0, key: '' })
  })

  test('takes a capo that is not a fret as none', () => {
    const key = (semitones: number) => transposeKeyName('G', semitones)
    assert.deepEqual(shapesFor(0, -1, key), { capo: 0, key: '' })
    assert.deepEqual(shapesFor(1, 0.4, key), { capo: 11, key: key(1) })
  })
})
