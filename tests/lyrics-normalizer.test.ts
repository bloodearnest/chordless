import { expect } from '@open-wc/testing'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

import { lyricsOf } from '../src/js/utils/song-filter.ts'
import {
  formatHiddenLyricsText,
  normalizeSegmentsForHiddenChords,
  segmentHasVisibleLyrics,
  splitChordDisplaySegments,
} from '../src/js/utils/lyrics-normalizer.ts'

describe('lyrics-normalizer utilities', () => {
  it('detects visible lyrics and normalizes glue markers', () => {
    expect(segmentHasVisibleLyrics({ lyrics: ' - ' })).to.be.false
    expect(segmentHasVisibleLyrics({ lyrics: 'Ho - ' })).to.be.true

    const segments = [{ lyrics: 'Ho - ' }, { lyrics: ' san - ' }, { lyrics: ' na ' }]
    const normalized = normalizeSegmentsForHiddenChords(segments)
    expect(normalized.map(s => s.lyrics)).to.deep.equal(['Ho', 'san', 'na'])
    expect(normalized.map(s => !!s.__joinWithPrev)).to.deep.equal([false, true, true])
  })

  it('keeps a word whole when a chord falls inside it with no hyphen', () => {
    const normalized = normalizeSegmentsForHiddenChords([
      { lyrics: 'It soothes our sor' },
      { lyrics: 'rows, heals ' },
      { lyrics: 'our wounds' },
    ])
    expect(normalized.map(s => !!s.__joinWithPrev)).to.deep.equal([false, true, false])
  })

  it('hides hyphens that only place chords, and keeps those in a word', () => {
    const normalized = normalizeSegmentsForHiddenChords([
      { lyrics: 'The Three-in-One, Maj - es - ' },
      { lyrics: 'ty, Je' },
      { lyrics: '-sus' },
    ])
    expect(normalized.map(s => s.lyrics)).to.deep.equal([
      'The Three-in-One, Majes',
      'ty, Je',
      'sus',
    ])
    expect(normalized.map(s => !!s.__joinWithPrev)).to.deep.equal([false, true, true])
  })

  it('keeps a hyphen tight against the word before a chord', () => {
    const normalized = normalizeSegmentsForHiddenChords([
      { lyrics: 'our loving-' },
      { lyrics: 'kindness' },
    ])
    expect(normalized.map(s => s.lyrics)).to.deep.equal(['our loving-', 'kindness'])
    expect(normalized.map(s => !!s.__joinWithPrev)).to.deep.equal([false, true])
  })

  it('searches the words as the lyrics-only view shows them', () => {
    const parsed = {
      metadata: {},
      sections: [
        {
          type: 'section' as const,
          label: 'V',
          lines: [
            {
              segments: [
                { chord: 'D', lyrics: 'Je' },
                { chord: 'A', lyrics: '-sus our loving-' },
                { chord: 'G', lyrics: 'kindness' },
              ],
            },
          ],
        },
      ],
    }
    expect(lyricsOf(parsed as never).lines).to.deep.equal(['Jesus our loving-kindness'])
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

describe('lyrics-normalizer, with less to go on', () => {
  it('sees no visible lyrics in no segment, or one with none', () => {
    expect(segmentHasVisibleLyrics(null)).to.equal(false)
    expect(segmentHasVisibleLyrics(undefined)).to.equal(false)
    expect(segmentHasVisibleLyrics({})).to.equal(false)
    expect(segmentHasVisibleLyrics({ lyrics: null })).to.equal(false)
    expect(segmentHasVisibleLyrics({ lyrics: '' })).to.equal(false)
  })

  it('gives nothing for no segments', () => {
    expect(normalizeSegmentsForHiddenChords([])).to.deep.equal([])
  })

  it('joins across a segment with no lyrics, or only a glue mark, to the one after', () => {
    const normalized = normalizeSegmentsForHiddenChords([
      { lyrics: 'Ho' },
      { lyrics: null },
      { lyrics: ' - ' },
      { lyrics: 'san' },
      { lyrics: 'na' },
    ])
    expect(normalized.map(s => s.lyrics)).to.deep.equal(['Ho', '', '', 'san', 'na'])
    expect(normalized.map(s => s.__joinWithPrev)).to.deep.equal([false, false, true, true, true])
  })

  it('says nothing for no text, however the lyrics were joined', () => {
    expect(formatHiddenLyricsText('')).to.equal('')
    expect(formatHiddenLyricsText('', true, false)).to.equal('')
    expect(formatHiddenLyricsText('word')).to.equal('word')
  })

  it('splits no chord into no parts, and a chord in brackets with its brackets', () => {
    expect(splitChordDisplaySegments('')).to.deep.equal([])
    expect(splitChordDisplaySegments('(G)').map(s => s.value)).to.deep.equal(['(', 'G', ')'])
    expect(splitChordDisplaySegments('(Gsus4)')).to.deep.equal([
      { type: 'base', value: '(' },
      { type: 'base', value: 'G' },
      { type: 'extension', value: 'sus4' },
      { type: 'base', value: ')' },
    ])
  })

  it('keeps what is not a chord in brackets as it is, still bracketed', () => {
    expect(splitChordDisplaySegments('(x)').map(s => s.value)).to.deep.equal(['(', 'x', ')'])
    expect(splitChordDisplaySegments('N.C.')).to.deep.equal([{ type: 'base', value: 'N.C.' }])
  })

  it('keeps the plain text between and after extensions', () => {
    expect(splitChordDisplaySegments('Gm7/B').map(s => s.value)).to.deep.equal([
      'G',
      'm',
      '7',
      '/B',
    ])
  })
})
