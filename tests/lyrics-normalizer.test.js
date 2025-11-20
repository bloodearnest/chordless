import { expect } from '@esm-bundle/chai'
import { suppressConsoleLogs } from './test-helpers.js'

const { describe, it } = window

suppressConsoleLogs()

import {
  formatHiddenLyricsText,
  normalizeSegmentsForHiddenChords,
  segmentHasVisibleLyrics,
  splitChordDisplaySegments,
} from '../js/utils/lyrics-normalizer.js'

describe('lyrics-normalizer utilities', () => {
  it('detects visible lyrics and normalizes glue markers', () => {
    expect(segmentHasVisibleLyrics({ lyrics: ' - ' })).to.be.false
    expect(segmentHasVisibleLyrics({ lyrics: 'Ho - ' })).to.be.true

    const segments = [{ lyrics: 'Ho - ' }, { lyrics: ' san - ' }, { lyrics: ' na ' }]
    const normalized = normalizeSegmentsForHiddenChords(segments)
    expect(normalized.map(s => s.lyrics)).to.deep.equal(['Ho', 'san', 'na'])
    expect(normalized.map(s => !!s.__joinWithPrev)).to.deep.equal([false, true, true])
  })

  it('formats lyrics when chords are hidden', () => {
    expect(formatHiddenLyricsText('san', true, false)).to.equal(' san')
    expect(formatHiddenLyricsText('na', true, true)).to.equal('na')
  })

  it('splits chord extensions correctly', () => {
    expect(splitChordDisplaySegments('Emaj7sus4add9')).to.deep.equal([
      { type: 'base', value: 'E' },
      { type: 'extension', value: 'maj7' },
      { type: 'extension', value: 'sus4' },
      { type: 'extension', value: 'add9' },
    ])

    expect(splitChordDisplaySegments('Bsus(2)')).to.deep.equal([
      { type: 'base', value: 'B' },
      { type: 'extension', value: 'sus' },
      { type: 'extension', value: '(2)' },
    ])

    expect(splitChordDisplaySegments('(A2)')).to.deep.equal([
      { type: 'base', value: '(' },
      { type: 'base', value: 'A' },
      { type: 'extension', value: '2' },
      { type: 'base', value: ')' },
    ])
  })

  it('keeps minor quality markers inline', () => {
    expect(splitChordDisplaySegments('Bm')).to.deep.equal([
      { type: 'base', value: 'B' },
      { type: 'base', value: 'm' },
    ])

    expect(splitChordDisplaySegments('Am7')).to.deep.equal([
      { type: 'base', value: 'A' },
      { type: 'base', value: 'm' },
      { type: 'extension', value: '7' },
    ])

    expect(splitChordDisplaySegments('Cm7').slice(1)).to.deep.equal([
      { type: 'base', value: 'm' },
      { type: 'extension', value: '7' },
    ])
  })

  it('recognizes diminished/augmented symbols and altered extensions', () => {
    expect(splitChordDisplaySegments('B°')).to.deep.equal([
      { type: 'base', value: 'B' },
      { type: 'extension', value: '°' },
    ])

    expect(splitChordDisplaySegments('F°7')).to.deep.equal([
      { type: 'base', value: 'F' },
      { type: 'extension', value: '°7' },
    ])

    expect(splitChordDisplaySegments('Eø7')).to.deep.equal([
      { type: 'base', value: 'E' },
      { type: 'extension', value: 'ø7' },
    ])

    expect(splitChordDisplaySegments('Cm7b5')).to.deep.equal([
      { type: 'base', value: 'C' },
      { type: 'base', value: 'm' },
      { type: 'extension', value: '7b5' },
    ])

    expect(splitChordDisplaySegments('Cm9#11')).to.deep.equal([
      { type: 'base', value: 'C' },
      { type: 'base', value: 'm' },
      { type: 'extension', value: '9#11' },
    ])

    expect(splitChordDisplaySegments('C(#11)')).to.deep.equal([
      { type: 'base', value: 'C' },
      { type: 'base', value: '(' },
      { type: 'extension', value: '#11' },
      { type: 'base', value: ')' },
    ])

    expect(splitChordDisplaySegments('Caug')).to.deep.equal([
      { type: 'base', value: 'C' },
      { type: 'extension', value: 'aug' },
    ])

    expect(splitChordDisplaySegments('C+')).to.deep.equal([
      { type: 'base', value: 'C' },
      { type: 'extension', value: '+' },
    ])

    expect(splitChordDisplaySegments('Caug7')).to.deep.equal([
      { type: 'base', value: 'C' },
      { type: 'extension', value: 'aug7' },
    ])

    expect(splitChordDisplaySegments('C+7')).to.deep.equal([
      { type: 'base', value: 'C' },
      { type: 'extension', value: '+7' },
    ])
  })
})
