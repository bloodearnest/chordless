import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Melody, MelodyNote } from '../src/js/melody.ts'
import { midiOf } from '../src/js/melody.ts'
import { formatBeats, songMelody } from '../src/js/melody-analysis.ts'
import { writeMusicXml } from '../src/js/melody-musicxml.ts'
import { melodyRecord } from '../src/js/melody-record.ts'

const note = (
  step: MelodyNote['step'],
  octave: number,
  start: number,
  duration: number
): MelodyNote => ({
  kind: 'note',
  id: `${step}${octave}-${start}`,
  step,
  alter: 0,
  octave,
  midi: midiOf(step, 0, octave),
  start,
  duration,
  tupletRatio: 1,
  tieStart: false,
  tieStop: false,
  cue: false,
  syllables: ['la'],
  withPrevious: false,
})

const melody: Melody = {
  title: 'Test',
  notice: [],
  measures: [
    {
      number: 1,
      voices: [[note('C', 4, 0, 1), note('G', 4, 1, 2.5), note('G', 4, 3.5, 0.5)]],
      chords: [],
      section: null,
      barline: 'single',
      directions: [],
      repeatStart: false,
      ending: null,
      length: 4,
      full: true,
      fifths: 0,
      beats: 4,
      beatType: 4,
      tempo: null,
    },
  ],
}
const record = melodyRecord('u1', writeMusicXml(melody), 'C')

describe('a song’s melody analysis', () => {
  it('reads the range and the beats on its ends from the stored score', () => {
    const found = songMelody({ key: 'C' } as never, record)
    assert.deepEqual(found?.range, { low: 60, high: 67 })
    assert.equal(found?.rangeKey, 'C')
    assert.equal(found?.extremes?.highBeats, 3)
    assert.equal(found?.extremes?.lowBeats, 1)
  })

  it('lets a range typed into the chart win, and still reports the melody’s own extremes', () => {
    const found = songMelody({ key: 'C', x_chordless_range: 'A3-C5' } as never, record)
    assert.deepEqual(found?.range, { low: 57, high: 72 })
    assert.equal(found?.extremes?.highBeats, 3)
  })

  it('has nothing for a song with no melody and no range, and the typed range alone for one with no melody', () => {
    assert.equal(songMelody({ key: 'C' } as never, undefined), null)
    const typed = songMelody({ key: 'C', x_chordless_range: 'A3-C5' } as never, undefined)
    assert.equal(typed?.extremes, null)
    assert.deepEqual(typed?.range, { low: 57, high: 72 })
  })

  it('says beats as people do', () => {
    assert.deepEqual([0, 0.25, 1, 2.5, 3.75, 3.9].map(formatBeats), [
      '0',
      '¼',
      '1',
      '2½',
      '3¾',
      '4',
    ])
  })
})
