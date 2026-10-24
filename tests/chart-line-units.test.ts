import { expect } from '@open-wc/testing'
import type { ChartSegment } from '../src/js/data-types.ts'
import { groupSegmentsIntoUnits } from '../src/js/utils/chart-line-units.ts'

const { describe, it } = window

/** A unit as [chord, lyrics] pairs, to compare */
const shape = (units: { chord: string; lyrics: string }[][]) =>
  units.map(unit => unit.map(piece => [piece.chord, piece.lyrics]))

/** Where a line may break, with no room kept for chords wider than their words */
const breakRules = (segments: ChartSegment[]) =>
  groupSegmentsIntoUnits(segments, { reserveChords: false })

describe('groupSegmentsIntoUnits: where a line may break', () => {
  it('splits a chord’s tail into words, the first keeping the chord', () => {
    const units = breakRules([{ chord: 'G', lyrics: 'sit down by the water' }])
    expect(shape(units)).to.deep.equal([
      [['G', 'sit ']],
      [['', 'down ']],
      [['', 'by ']],
      [['', 'the ']],
      [['', 'water']],
    ])
  })

  it('gives the space before a chord’s word to the word before it, so no row starts with a space', () => {
    const units = breakRules([
      { chord: '', lyrics: 'I walk along the ' },
      { chord: 'Am7(4)', lyrics: 'river ' },
      { chord: 'C2', lyrics: ' and I just' },
    ])
    expect(shape(units)).to.deep.equal([
      [['', 'I ']],
      [['', 'walk ']],
      [['', 'along ']],
      [['', 'the ']],
      [['Am7(4)', 'river  ']],
      [['C2', 'and ']],
      [['', 'I ']],
      [['', 'just']],
    ])
  })

  it('leaves a space where there is no word before it to take it', () => {
    expect(shape(breakRules([{ chord: 'G', lyrics: ' word' }]))).to.deep.equal([[['G', ' word']]])
    expect(
      shape(
        breakRules([
          { chord: 'G', lyrics: '' },
          { chord: 'C', lyrics: ' word' },
        ])
      )
    ).to.deep.equal([
      [
        ['G', ''],
        ['C', ' word'],
      ],
    ])
  })

  it('does not break a word that a chord is in the middle of', () => {
    const units = breakRules([
      { chord: '', lyrics: 'full of ' },
      { chord: 'Am7(4)', lyrics: 'won' },
      { chord: 'C2', lyrics: 'der and I' },
    ])
    expect(shape(units)).to.deep.equal([
      [['', 'full ']],
      [['', 'of ']],
      [
        ['Am7(4)', 'won'],
        ['C2', 'der '],
      ],
      [['', 'and ']],
      [['', 'I']],
    ])
  })

  it('keeps a chord at the end of a word with it', () => {
    const units = breakRules([
      { chord: 'G', lyrics: 'never' },
      { chord: 'D', lyrics: '' },
      { chord: '', lyrics: ' and' },
    ])
    expect(shape(units)).to.deep.equal([
      [
        ['G', 'never'],
        ['D', ''],
      ],
      [['', ' and']],
    ])
  })

  it('keeps a chord over a gap with the word after it (a bracket split over two chords)', () => {
    const units = breakRules([
      { chord: 'G', lyrics: 'You ' },
      { chord: '(Gsus', lyrics: ' ' },
      { chord: 'G)', lyrics: ' (To Bridge)' },
    ])
    expect(shape(units)).to.deep.equal([
      [['G', 'You ']],
      [
        ['(Gsus', '  '],
        ['G)', '(To '],
      ],
      [['', 'Bridge)']],
    ])
  })

  it('keeps the chords left at the end of a line with the last word', () => {
    const units = breakRules([
      { chord: 'G', lyrics: 'leave    ' },
      { chord: 'Gsus', lyrics: '    ' },
      { chord: 'G', lyrics: '' },
    ])
    expect(shape(units)).to.deep.equal([
      [
        ['G', 'leave    '],
        ['Gsus', '    '],
        ['G', ''],
      ],
    ])
  })

  it('lets a line of chords alone break between them', () => {
    const units = breakRules([
      { chord: 'G', lyrics: '  ' },
      { chord: 'C', lyrics: '  ' },
      { chord: 'D', lyrics: '' },
    ])
    expect(shape(units)).to.deep.equal([[['G', '  ']], [['C', '  ']], [['D', '']]])
  })

  it('keeps what a segment says about its chord (valid, transposed) on the chord’s piece only', () => {
    const [first, second] = breakRules([
      { chord: 'H7', lyrics: 'one two', valid: false, transposed: true },
    ])
    expect(first[0]).to.deep.equal({ chord: 'H7', lyrics: 'one ', valid: false, transposed: true })
    expect(second[0]).to.deep.equal({ chord: '', lyrics: 'two' })
  })

  it('drops a segment with no chord and no words, and copes with no segments', () => {
    expect(breakRules([{ chord: '', lyrics: '' }])).to.deep.equal([])
    expect(breakRules([])).to.deep.equal([])
  })

  it('joins words that lyrics-only mode marked as one (no space between)', () => {
    // hidden chords: "Ho" "san" "na" come as "Ho", " san" and "na"
    const units = breakRules([
      { chord: 'A', lyrics: 'Ho' },
      { chord: 'B', lyrics: ' san' },
      { chord: 'C', lyrics: 'na' },
    ])
    expect(shape(units)).to.deep.equal([
      [['A', 'Ho ']],
      [
        ['B', 'san'],
        ['C', 'na'],
      ],
    ])
  })
})

describe('groupSegmentsIntoUnits: room for the chords', () => {
  it('keeps a chord wider than its word over the words after it, up to the next chord', () => {
    const units = groupSegmentsIntoUnits([
      { chord: 'Am7(4)', lyrics: 'it is a wonderful day ' },
      { chord: 'C2', lyrics: 'now' },
    ])
    expect(shape(units)).to.deep.equal([
      [
        ['Am7(4)', 'it '],
        ['', 'is '],
        ['', 'a '],
        ['', 'wonderful '],
      ],
      [['', 'day ']],
      [['C2', 'now']],
    ])
  })

  it('does not hold the words back when they are wide enough, or the chord is short', () => {
    expect(shape(groupSegmentsIntoUnits([{ chord: 'G', lyrics: 'sit here today' }]))).to.deep.equal(
      [[['G', 'sit ']], [['', 'here ']], [['', 'today']]]
    )
    expect(
      shape(groupSegmentsIntoUnits([{ chord: 'Am7(4)', lyrics: 'wonderful day' }]))
    ).to.deep.equal([[['Am7(4)', 'wonderful ']], [['', 'day']]])
  })

  it('counts narrow letters as narrow: a chord over " I " needs more than three characters', () => {
    const units = groupSegmentsIntoUnits([
      { chord: 'C2', lyrics: ' I just want ' },
      { chord: 'G', lyrics: 'to' },
    ])
    expect(shape(units)[0]).to.deep.equal([
      ['C2', ' I '],
      ['', 'just '],
    ])
  })

  it('stops at the next chord, and at the end of the line', () => {
    const units = groupSegmentsIntoUnits([
      { chord: 'Am7(4)', lyrics: 'I ' },
      { chord: 'Em7', lyrics: 'a' },
    ])
    expect(shape(units)).to.deep.equal([[['Am7(4)', 'I ']], [['Em7', 'a']]])
    expect(shape(groupSegmentsIntoUnits([{ chord: 'Am7(4)', lyrics: 'I' }]))).to.deep.equal([
      [['Am7(4)', 'I']],
    ])
  })
})
