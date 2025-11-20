import { expect } from '@esm-bundle/chai'
import { suppressConsoleLogs } from './test-helpers.js'

const { describe, it } = window

suppressConsoleLogs()

import { convertAccidentalsToSymbols } from '../js/utils/chord-utils.js'

describe('convertAccidentalsToSymbols', () => {
  it('converts sharp root to symbol', () => {
    expect(convertAccidentalsToSymbols('F#maj7')).to.equal('F♯maj7')
  })

  it('converts flat root to symbol', () => {
    expect(convertAccidentalsToSymbols('Bb')).to.equal('B♭')
  })

  it('converts altered extensions', () => {
    expect(convertAccidentalsToSymbols('C7b9')).to.equal('C7♭9')
    expect(convertAccidentalsToSymbols('9#11')).to.equal('9♯11')
  })

  it('supports double accidentals', () => {
    expect(convertAccidentalsToSymbols('C##')).to.equal('C♯♯')
    expect(convertAccidentalsToSymbols('Gbb')).to.equal('G♭♭')
  })

  it('handles standalone Nashville degrees', () => {
    expect(convertAccidentalsToSymbols('#4')).to.equal('♯4')
    expect(convertAccidentalsToSymbols('b6')).to.equal('♭6')
  })

  it('leaves plain text unchanged', () => {
    expect(convertAccidentalsToSymbols('dim')).to.equal('dim')
  })

  it('converts root and slash bass accidentals', () => {
    expect(convertAccidentalsToSymbols('G#sus4/Bb')).to.equal('G♯sus4/B♭')
  })
})
