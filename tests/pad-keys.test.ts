import { expect } from '@open-wc/testing'
import { extractPadKeyFromFilename, normalizePadKey, PAD_FILE_KEYS } from '../src/js/pad-keys.ts'

const { describe, it } = window

describe('normalizePadKey', () => {
  it('gives each pad key as itself', () => {
    for (const key of PAD_FILE_KEYS) expect(normalizePadKey(key), key).to.equal(key)
  })

  it('reads flats, sharps and the words for them, in any case', () => {
    expect(normalizePadKey('Db')).to.equal('C#')
    expect(normalizePadKey('c#')).to.equal('C#')
    expect(normalizePadKey('A♭')).to.equal('G#')
    expect(normalizePadKey('F♯')).to.equal('F#')
    expect(normalizePadKey('Esharp')).to.equal('F')
    expect(normalizePadKey('Bflat')).to.equal('A#')
    expect(normalizePadKey(' g ')).to.equal('G')
  })

  it('gives the pad key of every letter with a sharp or flat', () => {
    for (const letter of 'ABCDEFG') {
      for (const accidental of ['', '#', 'b']) {
        expect(PAD_FILE_KEYS, `${letter}${accidental}`).to.include(
          normalizePadKey(`${letter}${accidental}`)
        )
      }
    }
  })

  it('gives nothing for what is not a key', () => {
    expect(normalizePadKey(null)).to.equal(null)
    expect(normalizePadKey(undefined)).to.equal(null)
    expect(normalizePadKey('')).to.equal(null)
    expect(normalizePadKey('H')).to.equal(null)
    expect(normalizePadKey('xyz')).to.equal(null)
  })
})

describe('extractPadKeyFromFilename', () => {
  it('takes the key from the end of the name of the file, in or out of a folder', () => {
    expect(extractPadKeyFromFilename('Warm Pad - C#.mp3')).to.equal('C#')
    expect(extractPadKeyFromFilename('Pads/Warm_Pad_Bb.wav')).to.equal('A#')
    expect(extractPadKeyFromFilename('Warm Pad (F♯).mp3')).to.equal('F#')
  })

  it('takes the last key when the name has several', () => {
    expect(extractPadKeyFromFilename('A Warm Pad in G.mp3')).to.equal('G')
  })

  it('looks anywhere in the name when no word is a key', () => {
    expect(extractPadKeyFromFilename('Cool Pad.mp3')).to.equal('C')
    expect(extractPadKeyFromFilename('Atmosphere.mp3')).to.equal('A')
  })

  it('gives nothing for a name without one, or no name', () => {
    expect(extractPadKeyFromFilename('Warm Pad.mp3')).to.equal(null)
    expect(extractPadKeyFromFilename('xyz.mp3')).to.equal(null)
    expect(extractPadKeyFromFilename('')).to.equal(null)
    expect(extractPadKeyFromFilename(null)).to.equal(null)
    expect(extractPadKeyFromFilename(undefined)).to.equal(null)
  })

  it('uses the whole name when it ends in a slash', () => {
    expect(extractPadKeyFromFilename('Pads - D/')).to.equal('D')
  })
})
