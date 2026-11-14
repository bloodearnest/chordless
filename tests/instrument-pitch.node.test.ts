/** The pitch of a transposing instrument (src/js/instrument-pitch.ts) */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  normalizePitch,
  PITCHES,
  pitchLabel,
  pitchSemitones,
  pitchShort,
} from '../src/js/instrument-pitch.ts'

describe('instrument pitch', () => {
  test('is concert pitch, B♭, E♭ or F, and concert pitch for anything else', () => {
    assert.deepEqual(
      PITCHES.map(each => each.id),
      ['concert', 'bb', 'eb', 'f']
    )
    assert.equal(normalizePitch('eb'), 'eb')
    assert.equal(normalizePitch('nope'), 'concert')
    assert.equal(normalizePitch(null), 'concert')
    assert.equal(normalizePitch(undefined), 'concert')
  })

  test('moves the chords up as the instrument reads them: a whole step, a sixth, a fifth', () => {
    assert.equal(pitchSemitones('concert'), 0)
    assert.equal(pitchSemitones('bb'), 2)
    assert.equal(pitchSemitones('eb'), 9)
    assert.equal(pitchSemitones('f'), 7)
    assert.equal(pitchSemitones('nope'), 0)
  })

  test('is named in words, and short for the header', () => {
    assert.equal(pitchLabel('concert'), 'Concert pitch')
    assert.equal(pitchLabel('eb'), 'E♭ (alto or baritone sax)')
    assert.equal(pitchShort('concert'), 'Concert')
    assert.equal(pitchShort('bb'), 'B♭')
    assert.equal(pitchShort('eb'), 'E♭')
    assert.equal(pitchShort('f'), 'F')
    assert.equal(pitchShort('nope'), 'Concert')
  })
})
