/** A one-measure melody for tests (C4, then G4 held three beats): the MusicXML score, and a record of it */
import type { Melody, MelodyNote } from '../src/js/melody.ts'
import { writeMusicXml } from '../src/js/melody-musicxml.ts'
import { melodyRecord } from '../src/js/melody-record.ts'
import { midiOf } from '../src/js/pitch.ts'

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

export const sampleMelody: Melody = {
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

/** C4 to G4: low C for 1 beat, high G for 3 */
export const sampleRecord = (uuid: string, key: string | null = 'C') =>
  melodyRecord(uuid, writeMusicXml(sampleMelody), key)
