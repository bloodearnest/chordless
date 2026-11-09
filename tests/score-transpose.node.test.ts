/** A melody's range, its extremes, and moving it to another key (src/js/score-transpose.ts) */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fifthsOfKey, type Step } from '../src/js/pitch.ts'
import type { Score, ScoreNote } from '../src/js/score.ts'
import { melodyExtremes, melodyRange, transposeScore } from '../src/js/score-transpose.ts'
import { bar, melodyOf, note, rest } from './score-build.ts'

describe('transposing a melody', () => {
  const cue = (step: Step, octave: number) => note(step, octave, { cue: true })
  const tune = (notes: ScoreNote[], chord = 'G'): Score =>
    melodyOf(null, [bar(notes, { fifths: 1, chords: [{ start: 0, text: chord }] })])

  it('moves the notes, respells them, and gives the key signature and chords of the new key', () => {
    // G major, D4 to B4, up a fourth to C: G4 to E5, already in the green
    const out = transposeScore(tune([note('D', 4), note('B', 4)]), 'G', 'C')
    const events = out.measures[0].voices[0] as ScoreNote[]
    assert.deepEqual(
      events.map(n => [n.step, n.alter, n.octave]),
      [
        ['G', 0, 4],
        ['E', 0, 5],
      ]
    )
    assert.equal(out.measures[0].fifths, 0)
    assert.equal(out.measures[0].chords[0].text, 'C')
  })

  it('spells for the key: flats in a flat key, sharps in a sharp one', () => {
    const flat = transposeScore(tune([note('G', 4), note('A', 4)]), 'G', 'Bb')
    assert.deepEqual(
      (flat.measures[0].voices[0] as ScoreNote[]).map(n => [n.step, n.alter]),
      [
        ['B', -1],
        ['C', 0],
      ]
    )
    assert.equal(flat.measures[0].fifths, -2)
    const sharp = transposeScore(tune([note('G', 4), note('A', 4)]), 'G', 'E')
    assert.deepEqual(
      (sharp.measures[0].voices[0] as ScoreNote[]).map(n => [n.step, n.alter]),
      [
        ['E', 0],
        ['F', 1],
      ]
    )
    assert.equal(sharp.measures[0].fifths, 4)
  })

  it('takes the octave nearest the green range, not the nearest interval', () => {
    // C3 to G3 in C, to D: the nearest way is up two (D3 to A3, red); up fourteen is D4 to A4
    const low = transposeScore(tune([note('C', 3), note('G', 3)], 'C'), 'C', 'D')
    assert.deepEqual(
      (low.measures[0].voices[0] as ScoreNote[]).map(n => n.midi),
      [62, 69]
    )
    // and a high tune comes down: C6 to G6 in C, to D, is down twenty-two, not up two
    const high = transposeScore(tune([note('C', 6), note('G', 6)], 'C'), 'C', 'D')
    assert.deepEqual(
      (high.measures[0].voices[0] as ScoreNote[]).map(n => n.midi),
      [62, 69]
    )
  })

  it('leaves cue notes out of the range, and the melody alone for a key it cannot read', () => {
    const t = tune([note('C', 4), cue('C', 2)])
    assert.deepEqual(melodyRange(t), { low: 60, high: 60 })
    assert.equal(transposeScore(t, 'C', 'H'), t)
    assert.equal(fifthsOfKey('Em'), 1)
    assert.equal(fifthsOfKey('F#'), 6)
    assert.equal(fifthsOfKey('F♯'), 6)
    assert.equal(fifthsOfKey('B♭m'), -5)
  })

  it('totals the beats on the highest and lowest note across the song as played', () => {
    const held = { ...note('G', 4), duration: 2.5 }
    const t = tune([
      note('C', 4),
      held,
      { ...note('G', 4), duration: 0.5, tieStop: true },
      cue('C', 2),
    ])
    assert.deepEqual(melodyExtremes(t), { low: 60, high: 67, lowBeats: 1, highBeats: 3 })
    // a repeat plays the measure twice
    t.measures[0].repeatStart = true
    t.measures[0].barline = 'repeat-end'
    assert.deepEqual(melodyExtremes(t), { low: 60, high: 67, lowBeats: 2, highBeats: 6 })
    assert.equal(melodyExtremes(tune([cue('E', 2)])), null)
  })

  it('leaves out a full-size note in a bar with no lyric, unless it is tied over or the sheet has no lyrics', () => {
    const sung = (n: ScoreNote, syllable: string): ScoreNote => ({ ...n, syllables: [syllable] })
    const t = tune([sung(note('E', 4), 'Lord'), sung(note('G', 4), 'of')])
    // an instrumental bar printed full size, lower and higher, and a sung G tied into it
    t.measures.push({
      ...t.measures[0],
      number: 2,
      voices: [[note('C', 3), note('C', 6), { ...note('G', 4), tieStop: true, duration: 3 }]],
    })
    assert.deepEqual(melodyRange(t), { low: 64, high: 67 })
    assert.deepEqual(melodyExtremes(t), { low: 64, high: 67, lowBeats: 1, highBeats: 4 })
    // a sheet with no words at all goes by size alone
    const wordless = tune([note('E', 4)])
    wordless.measures.push({ ...wordless.measures[0], number: 2, voices: [[note('C', 3)]] })
    assert.deepEqual(melodyRange(wordless), { low: 48, high: 64 })
  })

  it('keeps rests, takes a melody with no sung note as it is, and moves a minor key', () => {
    const silence = rest({ start: 1 })
    const t = tune([note('E', 4)], 'Em')
    t.measures[0].voices[0].push(silence)
    const out = transposeScore(t, 'Em', 'Am')
    assert.equal(out.measures[0].voices[0][1], silence)
    assert.equal(out.measures[0].fifths, 0)
    assert.equal(out.measures[0].chords[0].text, 'Am')
    const cueOnly = tune([cue('E', 2)], 'Em')
    assert.equal(melodyRange(cueOnly), null)
    assert.equal(transposeScore(cueOnly, 'Em', 'Gm').measures[0].fifths, -2)
  })
})
