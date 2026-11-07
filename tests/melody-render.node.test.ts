import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Melody, MelodyNote } from '../src/js/melody.ts'
import { midiOf } from '../src/js/melody.ts'
import { writeMusicXml } from '../src/js/melody-musicxml.ts'
import { renderMelody } from '../src/js/melody-render.ts'

const note = (step: MelodyNote['step'], start: number, syllable: string): MelodyNote => ({
  kind: 'note',
  id: `n${start}`,
  step,
  alter: 0,
  octave: 4,
  midi: midiOf(step, 0, 4),
  start,
  duration: 1,
  tupletRatio: 1,
  tieStart: false,
  tieStop: false,
  cue: false,
  syllables: [syllable],
  withPrevious: false,
})

const melody: Melody = {
  title: 'A Song',
  notice: [],
  measures: [
    {
      number: 1,
      voices: [[note('C', 0, 'Ho-'), note('D', 1, 'ly'), note('E', 2, 'is'), note('F', 3, 'He')]],
      chords: [{ start: 0, text: 'C' }],
      section: 'VERSE',
      barline: 'final',
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

describe('engraving a melody with Verovio', () => {
  it('turns our MusicXML into SVG with the staff, the notes and the words', async () => {
    const out = await renderMelody(writeMusicXml(melody))
    assert.ok(out)
    assert.equal(out.pages.length, 1)
    const svg = out.pages[0] as string
    assert.match(svg, /^<svg /)
    assert.equal((svg.match(/class="notehead"/g) ?? []).length, 4)
    assert.equal((svg.match(/class="syl"/g) ?? []).length, 4)
  })

  it('says null for what is not MusicXML', async () => {
    assert.equal(await renderMelody('this is not music'), null)
  })
})
