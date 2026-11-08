import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Melody, MelodyNote } from '../src/js/melody.ts'
import { writeMusicXml } from '../src/js/melody-musicxml.ts'
import { renderMelodyHere, withoutStyle } from '../src/js/melody-render-engine.ts'
import { midiOf } from '../src/js/pitch.ts'

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
    const out = await renderMelodyHere(writeMusicXml(melody))
    assert.ok(out)
    assert.equal(out.pages.length, 1)
    const svg = out.pages[0] as string
    assert.match(svg, /^<svg /)
    assert.equal((svg.match(/class="notehead"/g) ?? []).length, 4)
    assert.equal((svg.match(/class="syl"/g) ?? []).length, 4)
  })

  it('leaves no <style> element in the pages, which the page’s policy would not allow', async () => {
    const out = await renderMelodyHere(writeMusicXml(melody))
    assert.ok(out)
    for (const page of out.pages) assert.doesNotMatch(page, /<style/i)
  })

  it('takes every <style> element out, including one made by taking another out', () => {
    assert.equal(
      withoutStyle('<svg><style>a{}</style><g/><style>b{}</style></svg>'),
      '<svg><g/></svg>'
    )
    assert.equal(withoutStyle('<svg><sty<style>x</style>le>y</style></svg>'), '<svg></svg>')
    assert.equal(withoutStyle('<svg><g/></svg>'), '<svg><g/></svg>')
  })

  it('says null for what is not MusicXML', async () => {
    assert.equal(await renderMelodyHere('this is not music'), null)
  })
})
