import { expect } from '@open-wc/testing'
import type { ParsedChart } from '../src/js/data-types.ts'
import { makeChart } from './builders.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

import {
  convertChordToNashville,
  convertNashvilleChordToStandard,
  getAvailableKeys,
  getKeyOffset,
  isNashvilleChord,
  parseChord,
  transposeChord,
  transposeChordBySemitones,
  transposeKeyName,
  transposeNote,
  transposeSong,
} from '../src/js/transpose.ts'

function assert(condition, message) {
  expect(condition, message).to.be.true
}

function assertEquals(actual, expected, message) {
  expect(actual, message).to.deep.equal(expected)
}

describe('parseChord', () => {
  // Basic chords
  it("parseChord('C')", () => {
    const parsed = parseChord('C')
    assertEquals(parsed.root, 'C', 'Parse C root')
    assertEquals(parsed.extensions, '', 'Parse C extensions')
    assertEquals(parsed.bass, null, 'Parse C bass')
    assert(parsed.isValid, 'Parse C valid')
  })
  it("parseChord('G#')", () => {
    const parsed = parseChord('G#')
    assertEquals(parsed.root, 'G#', 'Parse G# root')
  })
  it("parseChord('Bb')", () => {
    const parsed = parseChord('Bb')
    assertEquals(parsed.root, 'Bb', 'Parse Bb root')
  })

  // Chords with extensions
  it("parseChord('Cmaj7')", () => {
    const parsed = parseChord('Cmaj7')
    assertEquals(parsed.root, 'C', 'Parse Cmaj7 root')
    assertEquals(parsed.extensions, 'maj7', 'Parse Cmaj7 extensions')
  })
  it("parseChord('Am7')", () => {
    const parsed = parseChord('Am7')
    assertEquals(parsed.root, 'A', 'Parse Am7 root')
    assertEquals(parsed.extensions, 'm7', 'Parse Am7 extensions')
  })
  it("parseChord('Dsus4')", () => {
    const parsed = parseChord('Dsus4')
    assertEquals(parsed.root, 'D', 'Parse Dsus4 root')
    assertEquals(parsed.extensions, 'sus4', 'Parse Dsus4 extensions')
  })
  it("parseChord('F#m7b5')", () => {
    const parsed = parseChord('F#m7b5')
    assertEquals(parsed.root, 'F#', 'Parse F#m7b5 root')
    assertEquals(parsed.extensions, 'm7b5', 'Parse F#m7b5 extensions')
  })
  it("parseChord('Eadd9')", () => {
    const parsed = parseChord('Eadd9')
    assertEquals(parsed.root, 'E', 'Parse Eadd9 root')
    assertEquals(parsed.extensions, 'add9', 'Parse Eadd9 extensions')
  })

  // Chords with bass notes
  it("parseChord('C/E')", () => {
    const parsed = parseChord('C/E')
    assertEquals(parsed.root, 'C', 'Parse C/E root')
    assertEquals(parsed.bass, 'E', 'Parse C/E bass')
  })
  it("parseChord('G/B')", () => {
    const parsed = parseChord('G/B')
    assertEquals(parsed.root, 'G', 'Parse G/B root')
    assertEquals(parsed.bass, 'B', 'Parse G/B bass')
  })
  it("parseChord('Dm7/F')", () => {
    const parsed = parseChord('Dm7/F')
    assertEquals(parsed.root, 'D', 'Parse Dm7/F root')
    assertEquals(parsed.extensions, 'm7', 'Parse Dm7/F extensions')
    assertEquals(parsed.bass, 'F', 'Parse Dm7/F bass')
  })
  it("parseChord('F#/C#')", () => {
    const parsed = parseChord('F#/C#')
    assertEquals(parsed.root, 'F#', 'Parse F#/C# root')
    assertEquals(parsed.bass, 'C#', 'Parse F#/C# bass')
  })

  // Special values
  it("parseChord('|')", () => {
    const parsed = parseChord('|')
    assert(parsed.isSpecial, 'Parse | as special')
    assert(parsed.isValid, 'Parse | as valid')
  })
  it("parseChord('||')", () => {
    const parsed = parseChord('||')
    assert(parsed.isSpecial, 'Parse || as special')
  })
  it("parseChord('N.C.')", () => {
    const parsed = parseChord('N.C.')
    assert(parsed.isSpecial, 'Parse N.C. as special')
  })
  it("parseChord('.')", () => {
    const parsed = parseChord('.')
    assert(parsed.isSpecial, 'Parse . as special')
  })

  // Invalid chords
  it("parseChord('X')", () => {
    const parsed = parseChord('X')
    assert(!parsed.isValid, 'Parse X as invalid')
  })
  it("parseChord('123')", () => {
    const parsed = parseChord('123')
    assert(!parsed.isValid, 'Parse 123 as invalid')
  })
  it("parseChord('(A2)')", () => {
    const parsed = parseChord('(A2)')
    assertEquals(parsed.wrapperPrefix, '(', 'Parse optional chord prefix')
    assertEquals(parsed.wrapperSuffix, ')', 'Parse optional chord suffix')
    assertEquals(parsed.root, 'A', 'Parse optional chord root')
    assertEquals(parsed.extensions, '2', 'Parse optional chord extension')
  })
})

describe('transposeNote', () => {
  // Transposing with sharps
  it('C up 2 semitones = D', () => {
    assertEquals(transposeNote('C', 2, false), 'D', 'C up 2 semitones = D')
    assertEquals(transposeNote('D', 2, false), 'E', 'D up 2 semitones = E')
    assertEquals(transposeNote('E', 2, false), 'F#', 'E up 2 semitones = F#')
    assertEquals(transposeNote('C', 1, false), 'C#', 'C up 1 semitone = C#')
    assertEquals(transposeNote('F', 1, false), 'F#', 'F up 1 semitone = F#')
  })

  // Transposing with flats
  it('C up 2 semitones = D (flats)', () => {
    assertEquals(transposeNote('C', 2, true), 'D', 'C up 2 semitones = D (flats)')
    assertEquals(transposeNote('D', 2, true), 'E', 'D up 2 semitones = E (flats)')
    assertEquals(transposeNote('E', 2, true), 'Gb', 'E up 2 semitones = Gb (flats)')
    assertEquals(transposeNote('C', 1, true), 'Db', 'C up 1 semitone = Db (flats)')
    assertEquals(transposeNote('F', 1, true), 'Gb', 'F up 1 semitone = Gb (flats)')
  })

  // Transposing down
  it('D down 2 semitones = C', () => {
    assertEquals(transposeNote('D', -2, false), 'C', 'D down 2 semitones = C')
    assertEquals(transposeNote('E', -2, false), 'D', 'E down 2 semitones = D')
    assertEquals(transposeNote('C', -1, false), 'B', 'C down 1 semitone = B')
  })

  // Wrapping around octave
  it('B up 2 wraps to C#', () => {
    assertEquals(transposeNote('B', 2, false), 'C#', 'B up 2 wraps to C#')
    assertEquals(transposeNote('C', -2, false), 'A#', 'C down 2 wraps to A#')
  })
})

describe('getKeyOffset', () => {
  it('C to D = +2 semitones', () => {
    assertEquals(getKeyOffset('C', 'D'), 2, 'C to D = +2 semitones')
    assertEquals(getKeyOffset('C', 'G'), 7, 'C to G = +7 semitones')
    assertEquals(getKeyOffset('G', 'C'), -7, 'G to C = -7 semitones')
    assertEquals(getKeyOffset('E', 'E'), 0, 'E to E = 0 semitones')
    assertEquals(getKeyOffset('Am', 'Em'), -5, 'Am to Em = -5 semitones')
    assertEquals(getKeyOffset('Dm', 'Gm'), 5, 'Dm to Gm = +5 semitones')
  })
})

describe('getAvailableKeys', () => {
  it("getAvailableKeys('C')", () => {
    const keys = getAvailableKeys('C')
    assert(keys.includes('C'), 'C major includes C')
    assert(keys.includes('G'), 'C major includes G')
    assert(keys.includes('F'), 'C major includes F')
    assert(!keys.includes('Am'), 'C major excludes Am')
    assert(!keys.includes('Dm'), 'C major excludes Dm')
  })
  it("getAvailableKeys('Am')", () => {
    const keys = getAvailableKeys('Am')
    assert(keys.includes('Am'), 'A minor includes Am')
    assert(keys.includes('Em'), 'A minor includes Em')
    assert(keys.includes('Dm'), 'A minor includes Dm')
    assert(!keys.includes('C'), 'A minor excludes C')
    assert(!keys.includes('G'), 'A minor excludes G')
  })
})

describe('transposeChord: one chord from one key to another', () => {
  // [chord, from key, to key, result]
  const cases: [string, string, string, string][] = [
    ['G', 'C', 'D', 'A'],
    ['F', 'C', 'D', 'G'],
    ['C', 'C', 'F', 'F'],
    ['G', 'C', 'F', 'C'],
    ['E', 'C', 'F', 'A'],
    ['Cmaj7', 'C', 'D', 'Dmaj7'],
    ['Am7', 'C', 'D', 'Bm7'],
    ['Dsus4', 'C', 'G', 'Asus4'],
    ['F#m7b5', 'D', 'E', 'G#m7b5'],
    ['C/E', 'C', 'D', 'D/F#'],
    ['G/B', 'C', 'F', 'C/E'],
    ['Dm7/F', 'C', 'D', 'Em7/G'],
    ['Am', 'Am', 'Em', 'Em'],
    ['Dm', 'Am', 'Em', 'Am'],
    ['F', 'Am', 'Em', 'C'],
    ['N.C.', 'C', 'D', 'N.C.'],
    ['.', 'C', 'D', '.'],
    ['C', 'D', 'D', 'C'],
    ['Bb', 'F', 'G', 'C'],
    ['Eb', 'Bb', 'D', 'G'],
    ['F#', 'D', 'Bb', 'D'],
    ['C#', 'A', 'F', 'A'],
    ['Esus4', 'E', 'D', 'Dsus4'],
    ['Cadd9/G', 'G', 'A', 'Dadd9/A'],
    ['Bm7', 'D', 'Eb', 'Cm7'],
    ['C#m7b5/E', 'A', 'C', 'Em7b5/G'],
    ['Eb7b9add13', 'Eb', 'D', 'D7b9add13'],
    ['F#m7#11/A', 'D', 'E', 'G#m7#11/B'],
    ['Bb9/Eb', 'Bb', 'G', 'G9/C'],
    ['Aadd9#11', 'A', 'F', 'Fadd9#11'],
    ['Bbmaj7', 'C', 'D', 'Cmaj7'],
    ['Abmaj7', 'Bb', 'G', 'Fmaj7'],
    ['C#', 'A', 'Eb', 'G'],
    ['Fm', 'C', 'G', 'Cm'],
    ['Bbm', 'F', 'D', 'Gm'],
    ['Bbmaj7/D', 'C', 'Eb', 'Dbmaj7/F'],
    ['E/G#', 'C', 'D', 'F#/A#'],
    ['C', 'C', 'D', 'D'],
    ['C', 'C', 'Eb', 'Eb'],
    ['C', 'C', 'F#', 'F#'],
    ['C', 'C', 'Bb', 'Bb'],
    ['Dm', 'C', 'D', 'Em'],
    ['Dm', 'C', 'G', 'Am'],
    ['Dm', 'C', 'F', 'Gm'],
    ['Em', 'C', 'D', 'F#m'],
    ['Em', 'C', 'A', 'C#m'],
    ['Em', 'C', 'Eb', 'Gm'],
    ['F', 'C', 'A', 'D'],
    ['F', 'C', 'Bb', 'Eb'],
    ['G', 'C', 'E', 'B'],
    ['Am', 'C', 'D', 'Bm'],
    ['Am', 'C', 'G', 'Em'],
    ['Am', 'C', 'Bb', 'Gm'],
    ['Bdim', 'C', 'D', 'C#dim'],
    ['Bdim', 'C', 'F', 'Edim'],
    ['Bdim', 'C', 'Ab', 'Gdim'],
    ['Fm', 'C', 'D', 'Gm'],
    ['Fm', 'C', 'A', 'Dm'],
    ['Fm', 'C', 'E', 'Am'],
    ['E', 'C', 'D', 'F#'],
    ['E', 'C', 'G', 'B'],
    ['Bbmaj7', 'C', 'E', 'Dmaj7'],
    ['Bbmaj7', 'C', 'Ab', 'Gbmaj7'],
    ['C#m7#11/Eb', 'A', 'B', 'D#m7#11/F'],
    ['C#m7#11/Eb', 'A', 'C', 'Em7#11/Gb'],
    ['Dm9', 'C', 'Eb', 'Fm9'],
    ['G7b9', 'C', 'F', 'C7b9'],
    ['Fmaj9', 'C', 'D', 'Gmaj9'],
    ['Dm7', 'C', 'A', 'Bm7'],
    ['G7', 'C', 'Bb', 'F7'],
    ['Cmaj7', 'C', 'E', 'Emaj7'],
    ['F#m', 'D', 'Eb', 'Gm'],
    ['Db', 'Ab', 'A', 'D'],
    ['C#', 'E', 'F', 'D'],
    ['Am/C', 'C', 'G', 'Em/G'],
    ['G7/B', 'C', 'F', 'C7/E'],
    ['Dsus4', 'C', 'E', 'F#sus4'],
    ['Gsus2', 'C', 'A', 'Esus2'],
    ['Gaug', 'C', 'D', 'Aaug'],
    ['Bdim7', 'C', 'F', 'Edim7'],
    ['C#m7#11/Eb', 'A', 'A', 'C#m7#11/Eb'],
    ['Fmaj7', 'C', 'C', 'Fmaj7'],
    ['D', 'C', 'G', 'A'],
    ['A', 'G', 'D', 'E'],
    ['E', 'D', 'A', 'B'],
    ['D', 'C', 'Db', 'Eb'],
    ['A', 'C', 'Bb', 'G'],
    ['E', 'C', 'Ab', 'C'],
    ['B', 'C', 'Eb', 'D'],
    ['F#', 'D', 'Db', 'F'],
    ['C#', 'A', 'Ab', 'C'],
    ['G#m', 'E', 'Eb', 'Gm'],
    ['Bb', 'C', 'D', 'C'],
    ['Eb', 'C', 'E', 'G'],
    ['Ab', 'C', 'A', 'F'],
    ['Db', 'C', 'B', 'C'],
    ['Gb', 'Db', 'D', 'G'],
    ['Bbm', 'Db', 'E', 'Dbm'],
    ['Ebm', 'Gb', 'A', 'Gbm'],
    ['Bb7', 'F', 'G', 'C7'],
    ['Ebmaj7', 'Bb', 'E', 'Amaj7'],
    ['Abm', 'Db', 'D', 'Am'],
    ['C#m7', 'A', 'Ab', 'Cm7'],
    ['G#dim', 'E', 'Eb', 'Gdim'],
    ['F', 'C', 'Gb', 'Cb'],
    ['B', 'C', 'Db', 'C'],
    ['E', 'C', 'Bb', 'D'],
    ['A', 'C', 'Eb', 'C'],
    ['Bb/D', 'F', 'E', 'A/C#'],
    ['C#/E#', 'A', 'Ab', 'C/E'],
    ['Eb/G', 'Bb', 'B', 'E/G#'],
    ['F#/A#', 'D', 'Db', 'F/A'],
    ['Bbm7b5', 'Db', 'D', 'Bm7b5'],
    ['C#maj7#11', 'A', 'Bb', 'Dmaj7#11'],
    ['Ebm9', 'Gb', 'G', 'Em9'],
    ['F#7b9', 'B', 'Bb', 'F7b9'],
    ['Abmaj9', 'Eb', 'E', 'Amaj9'],
  ]
  for (const [chord, from, to, want] of cases) {
    it(`${chord} in ${from} becomes ${want} in ${to}`, () => {
      expect(transposeChord(chord, from, to).chord).to.equal(want)
    })
  }
})

describe('transposeChord', () => {
  // Basic major chords C to D (sharps)
  it("transposeChord('C', 'C', 'D')", () => {
    const result = transposeChord('C', 'C', 'D')
    assertEquals(result.chord, 'D', 'Transpose C to D')
    assert(result.transposed, 'C to D transposed flag')
    assert(result.valid, 'C to D valid flag')
  })

  // Major chords C to F (flats)

  // Chords with extensions

  // Chords with bass notes

  // Minor key transposition

  // Special values pass through
  it("transposeChord('|', 'C', 'D')", () => {
    const result = transposeChord('|', 'C', 'D')
    assertEquals(result.chord, '|', 'Bar symbol passes through')
    assert(result.transposed, 'Bar symbol marked as transposed')
  })

  // Invalid chords
  it("transposeChord('X', 'C', 'D')", () => {
    const result = transposeChord('X', 'C', 'D')
    assertEquals(result.chord, 'X', 'Invalid chord X unchanged')
    assert(!result.transposed, 'Invalid chord not transposed')
    assert(!result.valid, 'Invalid chord marked invalid')
  })

  // No transposition (same key)

  // Flat to sharp keys

  // Sharp to flat keys

  // Complex real-world examples

  // Very complex chords

  // Borrowed/chromatic chords
  // bVII maj7 (borrowed from parallel minor)

  // Major III (chromatic mediant)

  // Minor iv (borrowed from parallel minor)

  // Complex borrowed chords with bass notes

  // This case now stays sharp per Nashville defaults; keeping assertion for historical context
})

describe('Nashville numbers', () => {
  it('Detect Nashville chord 1m7', () => {
    assert(isNashvilleChord('1m7'), 'Detect Nashville chord 1m7')
    assert(!isNashvilleChord('Cmaj7'), 'Do not detect normal chords as Nashville')
  })
  it("convertNashvilleChordToStandard('1', 'C')", () => {
    const converted = convertNashvilleChordToStandard('1', 'C')
    assertEquals(converted, 'C', 'Nashville 1 in C -> C')
  })
  it("convertNashvilleChordToStandard('#4sus', 'C')", () => {
    const converted = convertNashvilleChordToStandard('#4sus', 'C')
    assertEquals(converted, 'F#sus', 'Nashville #4sus in C -> F#sus')
  })
  it("convertChordToNashville('F#sus', 'C')", () => {
    const nashville = convertChordToNashville('F#sus', 'C')
    assertEquals(nashville, '#4sus', 'Chord to Nashville with accidental')
  })
  it("convertChordToNashville('(A2)', 'A')", () => {
    const nashville = convertChordToNashville('(A2)', 'A')
    assertEquals(nashville, '(12)', 'Bracketed chord retains wrapper when converting to Nashville')
  })
  const diatonicInA = [
    { chord: 'A', nashville: '1' },
    { chord: 'Bm', nashville: '2m' },
    { chord: 'C#m', nashville: '3m' },
    { chord: 'D', nashville: '4' },
    { chord: 'E', nashville: '5' },
    { chord: 'F#m', nashville: '6m' },
    { chord: 'G#dim', nashville: '7dim' },
  ]
  diatonicInA.forEach(({ chord, nashville: expected }, index) => {
    it(`A major diatonic chord ${index + 1} converts to Nashville`, () => {
      assertEquals(
        convertChordToNashville(chord, 'A'),
        expected,
        `A major diatonic chord ${index + 1} converts to Nashville`
      )
      assertEquals(
        convertNashvilleChordToStandard(expected, 'A'),
        chord,
        `A major Nashville chord ${index + 1} converts back to letter names`
      )
    })
  })
  it('Slash chords convert both root and bass to Nashville numbers', () => {
    assertEquals(
      convertChordToNashville('E/G#', 'A'),
      '5/7',
      'Slash chords convert both root and bass to Nashville numbers'
    )
    assertEquals(
      convertNashvilleChordToStandard('5/7', 'A'),
      'E/G#',
      'Slash Nashville chords convert back to original root/bass notes'
    )
  })
  it('Common A major progression converts to expected Nashville sequence', () => {
    const keyAProgression = ['A', 'A/C#', 'D', 'D/F#', 'E/G#', 'A']
    const expectedNashville = ['1', '1/3', '4', '4/6', '5/7', '1']
    const convertedProgression = keyAProgression.map(chord => convertChordToNashville(chord, 'A'))
    assertEquals(
      convertedProgression,
      expectedNashville,
      'Common A major progression converts to expected Nashville sequence'
    )
  })
  it('Borrowed ♭6 uses flat accidental', () => {
    assertEquals(convertChordToNashville('Ab', 'C'), 'b6', 'Borrowed ♭6 uses flat accidental')
    assertEquals(convertChordToNashville('Bb', 'C'), 'b7', 'Borrowed ♭7 uses flat accidental')
    assertEquals(convertChordToNashville('Eb', 'C'), 'b3', 'Borrowed ♭3 uses flat accidental')
    assertEquals(
      convertChordToNashville('F#7', 'C'),
      '#47',
      'Secondary dominant uses sharp accidental'
    )
    assertEquals(
      convertChordToNashville('D#dim', 'C'),
      '#2dim',
      'Secondary leading-tone uses sharp accidental'
    )
    assertEquals(convertChordToNashville('G#7', 'C'), '#57', 'V/vi defaults to sharp accidental')
    assertEquals(convertChordToNashville('F#', 'C'), '#4', 'No #3 is produced for F#')
    assertEquals(convertChordToNashville('Cb', 'C'), '7', 'No ♭1 is produced for C♭')
  })
})

describe('transposeChordBySemitones', () => {
  it("transposeChordBySemitones('C', -2, 'Bb')", () => {
    const result = transposeChordBySemitones('C', -2, 'Bb')
    assertEquals(result.chord, 'Bb', 'C down 2 semitones = Bb')
  })
  it("transposeChordBySemitones('G/B', -1, 'F#')", () => {
    const result = transposeChordBySemitones('G/B', -1, 'F#')
    assertEquals(result.chord, 'F#/A#', 'G/B down 1 semitone = F#/A#')
  })
  it("transposeChordBySemitones('Am7', -3, 'F#m')", () => {
    const result = transposeChordBySemitones('Am7', -3, 'F#m')
    assertEquals(result.chord, 'F#m7', 'Am7 down 3 semitones = F#m7')
  })
})

describe('transposeKeyName', () => {
  it('C down 1 semitone = B', () => {
    assertEquals(transposeKeyName('C', -1), 'B', 'C down 1 semitone = B')
    assertEquals(transposeKeyName('G', -1), 'F#', 'G down 1 semitone = F#')
    assertEquals(transposeKeyName('Eb', -1), 'D', 'Eb down 1 semitone = D')
    assertEquals(transposeKeyName('Am', -3), 'F#m', 'Am down 3 semitones = F#m')
  })
})

describe('transposeSong', () => {
  /** A parsed chart: sections of lines of {chord, lyrics} segments */
  const chordsOf = parsed =>
    parsed.sections.map(section => section.lines[0].segments.map(segment => segment.chord))

  it('transposes every chord in every section, in place', () => {
    const parsed = makeChart(['G', 'C', 'D/F#'], ['Em7', 'Cmaj7'])
    expect(transposeSong(parsed, 'G', 'A')).to.equal(undefined)
    expect(chordsOf(parsed)).to.deep.equal([
      ['A', 'D', 'E/G#'],
      ['F#m7', 'Dmaj7'],
    ])
  })

  it("turns Nashville numbers into chords in the target key, using the song's key", () => {
    const parsed = makeChart(['1', '4', '5/7', '6m'])
    transposeSong(parsed, 'D', 'D')
    expect(chordsOf(parsed)).to.deep.equal([['D', 'G', 'A/C#', 'Bm']])
  })

  it('marks chords it cannot read as not valid, leaving the rest', () => {
    const parsed = makeChart(['G', 'H7'])
    transposeSong(parsed, 'G', 'A')
    const [good, bad] = parsed.sections[0].lines[0].segments
    expect(good).to.include({ chord: 'A', valid: true })
    expect(bad.valid).to.equal(false)
  })

  it('leaves lines without chords, and charts without sections, alone', () => {
    const parsed = makeChart([''])
    parsed.sections[0].lines[0].segments[0].lyrics = 'Just words'
    transposeSong(parsed, 'G', 'A')
    expect(parsed.sections[0].lines[0].segments[0]).to.deep.equal({
      chord: '',
      lyrics: 'Just words',
    })
    expect(() => transposeSong({} as unknown as ParsedChart, 'G', 'A')).to.not.throw()
    expect(() => transposeSong(null, 'G', 'A')).to.not.throw()
  })
})
