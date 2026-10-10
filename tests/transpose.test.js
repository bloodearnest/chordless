import { expect } from '@esm-bundle/chai'
import { suppressConsoleLogs } from './test-helpers.js'

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
} from '../src/js/transpose.js'

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

describe('transposeChord', () => {
  // Basic major chords C to D (sharps)
  it("transposeChord('C', 'C', 'D')", () => {
    const result = transposeChord('C', 'C', 'D')
    assertEquals(result.chord, 'D', 'Transpose C to D')
    assert(result.transposed, 'C to D transposed flag')
    assert(result.valid, 'C to D valid flag')
  })
  it("transposeChord('G', 'C', 'D')", () => {
    const result = transposeChord('G', 'C', 'D')
    assertEquals(result.chord, 'A', 'Transpose G (in C) to A (in D)')
  })
  it("transposeChord('F', 'C', 'D')", () => {
    const result = transposeChord('F', 'C', 'D')
    assertEquals(result.chord, 'G', 'Transpose F (in C) to G (in D)')
  })

  // Major chords C to F (flats)
  it("transposeChord('C', 'C', 'F')", () => {
    const result = transposeChord('C', 'C', 'F')
    assertEquals(result.chord, 'F', 'Transpose C to F')
  })
  it("transposeChord('G', 'C', 'F')", () => {
    const result = transposeChord('G', 'C', 'F')
    assertEquals(result.chord, 'C', 'Transpose G (in C) to C (in F)')
  })
  it("transposeChord('E', 'C', 'F')", () => {
    const result = transposeChord('E', 'C', 'F')
    assertEquals(result.chord, 'A', 'Transpose E (in C) to A (in F)')
  })

  // Chords with extensions
  it("transposeChord('Cmaj7', 'C', 'D')", () => {
    const result = transposeChord('Cmaj7', 'C', 'D')
    assertEquals(result.chord, 'Dmaj7', 'Transpose Cmaj7 to Dmaj7')
  })
  it("transposeChord('Am7', 'C', 'D')", () => {
    const result = transposeChord('Am7', 'C', 'D')
    assertEquals(result.chord, 'Bm7', 'Transpose Am7 to Bm7')
  })
  it("transposeChord('Dsus4', 'C', 'G')", () => {
    const result = transposeChord('Dsus4', 'C', 'G')
    assertEquals(result.chord, 'Asus4', 'Transpose Dsus4 to Asus4')
  })
  it("transposeChord('F#m7b5', 'D', 'E')", () => {
    const result = transposeChord('F#m7b5', 'D', 'E')
    assertEquals(result.chord, 'G#m7b5', 'Transpose F#m7b5 to G#m7b5')
  })

  // Chords with bass notes
  it("transposeChord('C/E', 'C', 'D')", () => {
    const result = transposeChord('C/E', 'C', 'D')
    assertEquals(result.chord, 'D/F#', 'Transpose C/E to D/F#')
  })
  it("transposeChord('G/B', 'C', 'F')", () => {
    const result = transposeChord('G/B', 'C', 'F')
    assertEquals(result.chord, 'C/E', 'Transpose G/B to C/E')
  })
  it("transposeChord('Dm7/F', 'C', 'D')", () => {
    const result = transposeChord('Dm7/F', 'C', 'D')
    assertEquals(result.chord, 'Em7/G', 'Transpose Dm7/F to Em7/G')
  })

  // Minor key transposition
  it("transposeChord('Am', 'Am', 'Em')", () => {
    const result = transposeChord('Am', 'Am', 'Em')
    assertEquals(result.chord, 'Em', 'Transpose Am to Em')
  })
  it("transposeChord('Dm', 'Am', 'Em')", () => {
    const result = transposeChord('Dm', 'Am', 'Em')
    assertEquals(result.chord, 'Am', 'Transpose Dm (in Am) to Am (in Em)')
  })
  it("transposeChord('F', 'Am', 'Em')", () => {
    const result = transposeChord('F', 'Am', 'Em')
    assertEquals(result.chord, 'C', 'Transpose F (in Am) to C (in Em)')
  })

  // Special values pass through
  it("transposeChord('|', 'C', 'D')", () => {
    const result = transposeChord('|', 'C', 'D')
    assertEquals(result.chord, '|', 'Bar symbol passes through')
    assert(result.transposed, 'Bar symbol marked as transposed')
  })
  it("transposeChord('N.C.', 'C', 'D')", () => {
    const result = transposeChord('N.C.', 'C', 'D')
    assertEquals(result.chord, 'N.C.', 'N.C. passes through')
  })
  it("transposeChord('.', 'C', 'D')", () => {
    const result = transposeChord('.', 'C', 'D')
    assertEquals(result.chord, '.', 'Dot passes through')
  })

  // Invalid chords
  it("transposeChord('X', 'C', 'D')", () => {
    const result = transposeChord('X', 'C', 'D')
    assertEquals(result.chord, 'X', 'Invalid chord X unchanged')
    assert(!result.transposed, 'Invalid chord not transposed')
    assert(!result.valid, 'Invalid chord marked invalid')
  })

  // No transposition (same key)
  it("transposeChord('C', 'D', 'D')", () => {
    const result = transposeChord('C', 'D', 'D')
    assertEquals(result.chord, 'C', 'C in D to D stays C')
  })

  // Flat to sharp keys
  it("transposeChord('Bb', 'F', 'G')", () => {
    const result = transposeChord('Bb', 'F', 'G')
    assertEquals(result.chord, 'C', 'Transpose Bb (in F) to C (in G)')
  })
  it("transposeChord('Eb', 'Bb', 'D')", () => {
    const result = transposeChord('Eb', 'Bb', 'D')
    assertEquals(result.chord, 'G', 'Transpose Eb (in Bb) to G (in D)')
  })

  // Sharp to flat keys
  it("transposeChord('F#', 'D', 'Bb')", () => {
    const result = transposeChord('F#', 'D', 'Bb')
    assertEquals(result.chord, 'D', 'Transpose F# (in D) to D (in Bb)')
  })
  it("transposeChord('C#', 'A', 'F')", () => {
    const result = transposeChord('C#', 'A', 'F')
    assertEquals(result.chord, 'A', 'Transpose C# (in A) to A (in F)')
  })

  // Complex real-world examples
  it("transposeChord('Esus4', 'E', 'D')", () => {
    const result = transposeChord('Esus4', 'E', 'D')
    assertEquals(result.chord, 'Dsus4', 'Transpose Esus4 (E) to Dsus4 (D)')
  })
  it("transposeChord('Cadd9/G', 'G', 'A')", () => {
    const result = transposeChord('Cadd9/G', 'G', 'A')
    assertEquals(result.chord, 'Dadd9/A', 'Transpose Cadd9/G (G) to Dadd9/A (A)')
  })
  it("transposeChord('Bm7', 'D', 'Eb')", () => {
    const result = transposeChord('Bm7', 'D', 'Eb')
    assertEquals(result.chord, 'Cm7', 'Transpose Bm7 (D) to Cm7 (Eb)')
  })

  // Very complex chords
  it("transposeChord('C#m7b5/E', 'A', 'C')", () => {
    const result = transposeChord('C#m7b5/E', 'A', 'C')
    assertEquals(result.chord, 'Em7b5/G', 'Transpose C#m7b5/E (A) to Em7b5/G (C)')
  })
  it("transposeChord('Eb7b9add13', 'Eb', 'D')", () => {
    const result = transposeChord('Eb7b9add13', 'Eb', 'D')
    assertEquals(result.chord, 'D7b9add13', 'Transpose Eb7b9add13 (Eb) to D7b9add13 (D)')
  })
  it("transposeChord('F#m7#11/A', 'D', 'E')", () => {
    const result = transposeChord('F#m7#11/A', 'D', 'E')
    assertEquals(result.chord, 'G#m7#11/B', 'Transpose F#m7#11/A (D) to G#m7#11/B (E)')
  })
  it("transposeChord('Bb9/Eb', 'Bb', 'G')", () => {
    const result = transposeChord('Bb9/Eb', 'Bb', 'G')
    assertEquals(result.chord, 'G9/C', 'Transpose Bb9/Eb (Bb) to G9/C (G)')
  })
  it("transposeChord('Aadd9#11', 'A', 'F')", () => {
    const result = transposeChord('Aadd9#11', 'A', 'F')
    assertEquals(result.chord, 'Fadd9#11', 'Transpose Aadd9#11 (A) to Fadd9#11 (F)')
  })

  // Borrowed/chromatic chords
  // bVII maj7 (borrowed from parallel minor)
  it("transposeChord('Bbmaj7', 'C', 'D')", () => {
    const result = transposeChord('Bbmaj7', 'C', 'D')
    assertEquals(result.chord, 'Cmaj7', 'Transpose Bbmaj7 (bVII in C) to Cmaj7 (bVII in D)')
  })
  it("transposeChord('Abmaj7', 'Bb', 'G')", () => {
    const result = transposeChord('Abmaj7', 'Bb', 'G')
    assertEquals(result.chord, 'Fmaj7', 'Transpose Abmaj7 (bVII in Bb) to Fmaj7 (bVII in G)')
  })

  // Major III (chromatic mediant)
  it("transposeChord('E', 'C', 'F')", () => {
    const result = transposeChord('E', 'C', 'F')
    assertEquals(result.chord, 'A', 'Transpose E (III in C) to A (III in F)')
  })
  it("transposeChord('C#', 'A', 'Eb')", () => {
    const result = transposeChord('C#', 'A', 'Eb')
    assertEquals(result.chord, 'G', 'Transpose C# (III in A) to G (III in Eb)')
  })

  // Minor iv (borrowed from parallel minor)
  it("transposeChord('Fm', 'C', 'G')", () => {
    const result = transposeChord('Fm', 'C', 'G')
    assertEquals(result.chord, 'Cm', 'Transpose Fm (iv in C) to Cm (iv in G)')
  })
  it("transposeChord('Bbm', 'F', 'D')", () => {
    const result = transposeChord('Bbm', 'F', 'D')
    assertEquals(result.chord, 'Gm', 'Transpose Bbm (iv in F) to Gm (iv in D)')
  })

  // Complex borrowed chords with bass notes
  it("transposeChord('Bbmaj7/D', 'C', 'Eb')", () => {
    const result = transposeChord('Bbmaj7/D', 'C', 'Eb')
    assertEquals(result.chord, 'Dbmaj7/F', 'Transpose Bbmaj7/D (C) to Dbmaj7/F (Eb) - uses flats')
  })

  // This case now stays sharp per Nashville defaults; keeping assertion for historical context
  it("transposeChord('E/G#', 'C', 'D')", () => {
    const result = transposeChord('E/G#', 'C', 'D')
    assertEquals(result.chord, 'F#/A#', 'Transpose E/G# (C) to F#/A# (D)')
  })
})

describe('transposeChord: comprehensive transpositions', () => {
  // Comprehensive transposition tests
  // Basic major chords (I) - transposing C to various keys
  it("transposeChord('C', 'C', 'D')", () => {
    const result = transposeChord('C', 'C', 'D')
    assertEquals(result.chord, 'D', 'C (I in C) to D (I in D)')
  })
  it("transposeChord('C', 'C', 'Eb')", () => {
    const result = transposeChord('C', 'C', 'Eb')
    assertEquals(result.chord, 'Eb', 'C (I in C) to Eb (I in Eb)')
  })
  it("transposeChord('C', 'C', 'F#')", () => {
    const result = transposeChord('C', 'C', 'F#')
    assertEquals(result.chord, 'F#', 'C (I in C) to F# (I in F#)')
  })
  it("transposeChord('C', 'C', 'Bb')", () => {
    const result = transposeChord('C', 'C', 'Bb')
    assertEquals(result.chord, 'Bb', 'C (I in C) to Bb (I in Bb)')
  })

  // Minor chords (ii) - D minor in C to various keys
  it("transposeChord('Dm', 'C', 'D')", () => {
    const result = transposeChord('Dm', 'C', 'D')
    assertEquals(result.chord, 'Em', 'Dm (ii in C) to Em (ii in D)')
  })
  it("transposeChord('Dm', 'C', 'G')", () => {
    const result = transposeChord('Dm', 'C', 'G')
    assertEquals(result.chord, 'Am', 'Dm (ii in C) to Am (ii in G)')
  })
  it("transposeChord('Dm', 'C', 'F')", () => {
    const result = transposeChord('Dm', 'C', 'F')
    assertEquals(result.chord, 'Gm', 'Dm (ii in C) to Gm (ii in F)')
  })

  // Minor chords (iii) - E minor in C to various keys
  it("transposeChord('Em', 'C', 'D')", () => {
    const result = transposeChord('Em', 'C', 'D')
    assertEquals(result.chord, 'F#m', 'Em (iii in C) to F#m (iii in D)')
  })
  it("transposeChord('Em', 'C', 'A')", () => {
    const result = transposeChord('Em', 'C', 'A')
    assertEquals(result.chord, 'C#m', 'Em (iii in C) to C#m (iii in A)')
  })
  it("transposeChord('Em', 'C', 'Eb')", () => {
    const result = transposeChord('Em', 'C', 'Eb')
    assertEquals(result.chord, 'Gm', 'Em (iii in C) to Gm (iii in Eb)')
  })

  // Major chords (IV) - F in C to various keys
  it("transposeChord('F', 'C', 'D')", () => {
    const result = transposeChord('F', 'C', 'D')
    assertEquals(result.chord, 'G', 'F (IV in C) to G (IV in D)')
  })
  it("transposeChord('F', 'C', 'A')", () => {
    const result = transposeChord('F', 'C', 'A')
    assertEquals(result.chord, 'D', 'F (IV in C) to D (IV in A)')
  })
  it("transposeChord('F', 'C', 'Bb')", () => {
    const result = transposeChord('F', 'C', 'Bb')
    assertEquals(result.chord, 'Eb', 'F (IV in C) to Eb (IV in Bb)')
  })

  // Major chords (V) - G in C to various keys
  it("transposeChord('G', 'C', 'D')", () => {
    const result = transposeChord('G', 'C', 'D')
    assertEquals(result.chord, 'A', 'G (V in C) to A (V in D)')
  })
  it("transposeChord('G', 'C', 'F')", () => {
    const result = transposeChord('G', 'C', 'F')
    assertEquals(result.chord, 'C', 'G (V in C) to C (V in F)')
  })
  it("transposeChord('G', 'C', 'E')", () => {
    const result = transposeChord('G', 'C', 'E')
    assertEquals(result.chord, 'B', 'G (V in C) to B (V in E)')
  })

  // Minor chords (vi) - A minor in C to various keys
  it("transposeChord('Am', 'C', 'D')", () => {
    const result = transposeChord('Am', 'C', 'D')
    assertEquals(result.chord, 'Bm', 'Am (vi in C) to Bm (vi in D)')
  })
  it("transposeChord('Am', 'C', 'G')", () => {
    const result = transposeChord('Am', 'C', 'G')
    assertEquals(result.chord, 'Em', 'Am (vi in C) to Em (vi in G)')
  })
  it("transposeChord('Am', 'C', 'Bb')", () => {
    const result = transposeChord('Am', 'C', 'Bb')
    assertEquals(result.chord, 'Gm', 'Am (vi in C) to Gm (vi in Bb)')
  })

  // Diminished chords (vii°) - B diminished in C to various keys
  it("transposeChord('Bdim', 'C', 'D')", () => {
    const result = transposeChord('Bdim', 'C', 'D')
    assertEquals(result.chord, 'C#dim', 'Bdim (vii° in C) to C#dim (vii° in D)')
  })
  it("transposeChord('Bdim', 'C', 'F')", () => {
    const result = transposeChord('Bdim', 'C', 'F')
    assertEquals(result.chord, 'Edim', 'Bdim (vii° in C) to Edim (vii° in F)')
  })
  it("transposeChord('Bdim', 'C', 'Ab')", () => {
    const result = transposeChord('Bdim', 'C', 'Ab')
    assertEquals(result.chord, 'Gdim', 'Bdim (vii° in C) to Gdim (vii° in Ab)')
  })

  // Minor IV (iv) - borrowed chord
  it("transposeChord('Fm', 'C', 'D')", () => {
    const result = transposeChord('Fm', 'C', 'D')
    assertEquals(result.chord, 'Gm', 'Fm (iv in C) to Gm (iv in D)')
  })
  it("transposeChord('Fm', 'C', 'A')", () => {
    const result = transposeChord('Fm', 'C', 'A')
    assertEquals(result.chord, 'Dm', 'Fm (iv in C) to Dm (iv in A)')
  })
  it("transposeChord('Fm', 'C', 'E')", () => {
    const result = transposeChord('Fm', 'C', 'E')
    assertEquals(result.chord, 'Am', 'Fm (iv in C) to Am (iv in E)')
  })

  // Major III (III) - borrowed chord
  it("transposeChord('E', 'C', 'D')", () => {
    const result = transposeChord('E', 'C', 'D')
    assertEquals(result.chord, 'F#', 'E (III in C) to F# (III in D)')
  })
  it("transposeChord('E', 'C', 'G')", () => {
    const result = transposeChord('E', 'C', 'G')
    assertEquals(result.chord, 'B', 'E (III in C) to B (III in G)')
  })
  it("transposeChord('E', 'C', 'F')", () => {
    const result = transposeChord('E', 'C', 'F')
    assertEquals(result.chord, 'A', 'E (III in C) to A (III in F)')
  })

  // Flat-7 major 7 (bVIImaj7) - borrowed chord
  it("transposeChord('Bbmaj7', 'C', 'D')", () => {
    const result = transposeChord('Bbmaj7', 'C', 'D')
    assertEquals(result.chord, 'Cmaj7', 'Bbmaj7 (bVII in C) to Cmaj7 (bVII in D)')
  })
  it("transposeChord('Bbmaj7', 'C', 'E')", () => {
    const result = transposeChord('Bbmaj7', 'C', 'E')
    assertEquals(result.chord, 'Dmaj7', 'Bbmaj7 (bVII in C) to Dmaj7 (bVII in E)')
  })
  it("transposeChord('Bbmaj7', 'C', 'Ab')", () => {
    const result = transposeChord('Bbmaj7', 'C', 'Ab')
    assertEquals(result.chord, 'Gbmaj7', 'Bbmaj7 (bVII in C) to Gbmaj7 (bVII in Ab)')
  })

  // Complex chords with extensions and alterations
  it("transposeChord('C#m7#11/Eb', 'A', 'B')", () => {
    const result = transposeChord('C#m7#11/Eb', 'A', 'B')
    assertEquals(result.chord, 'D#m7#11/F', 'C#m7#11/Eb (A) to D#m7#11/F (B)')
  })
  it("transposeChord('C#m7#11/Eb', 'A', 'C')", () => {
    const result = transposeChord('C#m7#11/Eb', 'A', 'C')
    assertEquals(result.chord, 'Em7#11/Gb', 'C#m7#11/Eb (A) to Em7#11/Gb (C)')
  })
  it("transposeChord('Dm9', 'C', 'Eb')", () => {
    const result = transposeChord('Dm9', 'C', 'Eb')
    assertEquals(result.chord, 'Fm9', 'Dm9 (C) to Fm9 (Eb)')
  })
  it("transposeChord('G7b9', 'C', 'F')", () => {
    const result = transposeChord('G7b9', 'C', 'F')
    assertEquals(result.chord, 'C7b9', 'G7b9 (C) to C7b9 (F)')
  })
  it("transposeChord('Fmaj9', 'C', 'D')", () => {
    const result = transposeChord('Fmaj9', 'C', 'D')
    assertEquals(result.chord, 'Gmaj9', 'Fmaj9 (C) to Gmaj9 (D)')
  })

  // Seventh chords across keys
  it("transposeChord('Dm7', 'C', 'A')", () => {
    const result = transposeChord('Dm7', 'C', 'A')
    assertEquals(result.chord, 'Bm7', 'Dm7 (C) to Bm7 (A)')
  })
  it("transposeChord('G7', 'C', 'Bb')", () => {
    const result = transposeChord('G7', 'C', 'Bb')
    assertEquals(result.chord, 'F7', 'G7 (C) to F7 (Bb)')
  })
  it("transposeChord('Cmaj7', 'C', 'E')", () => {
    const result = transposeChord('Cmaj7', 'C', 'E')
    assertEquals(result.chord, 'Emaj7', 'Cmaj7 (C) to Emaj7 (E)')
  })

  // Sharp and flat keys
  it("transposeChord('F#m', 'D', 'Eb')", () => {
    const result = transposeChord('F#m', 'D', 'Eb')
    assertEquals(result.chord, 'Gm', 'F#m (D) to Gm (Eb)')
  })
  it("transposeChord('Db', 'Ab', 'A')", () => {
    const result = transposeChord('Db', 'Ab', 'A')
    assertEquals(result.chord, 'D', 'Db (Ab) to D (A)')
  })
  it("transposeChord('C#', 'E', 'F')", () => {
    const result = transposeChord('C#', 'E', 'F')
    assertEquals(result.chord, 'D', 'C# (E) to D (F)')
  })

  // Slash chords (inversions)
  it("transposeChord('C/E', 'C', 'D')", () => {
    const result = transposeChord('C/E', 'C', 'D')
    assertEquals(result.chord, 'D/F#', 'C/E (C) to D/F# (D)')
  })
  it("transposeChord('Am/C', 'C', 'G')", () => {
    const result = transposeChord('Am/C', 'C', 'G')
    assertEquals(result.chord, 'Em/G', 'Am/C (C) to Em/G (G)')
  })
  it("transposeChord('G7/B', 'C', 'F')", () => {
    const result = transposeChord('G7/B', 'C', 'F')
    assertEquals(result.chord, 'C7/E', 'G7/B (C) to C7/E (F)')
  })

  // Suspended chords
  it("transposeChord('Dsus4', 'C', 'E')", () => {
    const result = transposeChord('Dsus4', 'C', 'E')
    assertEquals(result.chord, 'F#sus4', 'Dsus4 (C) to F#sus4 (E)')
  })
  it("transposeChord('Gsus2', 'C', 'A')", () => {
    const result = transposeChord('Gsus2', 'C', 'A')
    assertEquals(result.chord, 'Esus2', 'Gsus2 (C) to Esus2 (A)')
  })

  // Augmented and diminished with 7ths
  it("transposeChord('Gaug', 'C', 'D')", () => {
    const result = transposeChord('Gaug', 'C', 'D')
    assertEquals(result.chord, 'Aaug', 'Gaug (C) to Aaug (D)')
  })
  it("transposeChord('Bdim7', 'C', 'F')", () => {
    const result = transposeChord('Bdim7', 'C', 'F')
    assertEquals(result.chord, 'Edim7', 'Bdim7 (C) to Edim7 (F)')
  })

  // Edge cases - same key (no transposition)
  it("transposeChord('C#m7#11/Eb', 'A', 'A')", () => {
    const result = transposeChord('C#m7#11/Eb', 'A', 'A')
    assertEquals(result.chord, 'C#m7#11/Eb', 'C#m7#11/Eb (A to A) - no change')
  })
  it("transposeChord('Fmaj7', 'C', 'C')", () => {
    const result = transposeChord('Fmaj7', 'C', 'C')
    assertEquals(result.chord, 'Fmaj7', 'Fmaj7 (C to C) - no change')
  })

  // Full circle of fifths
  it("transposeChord('D', 'C', 'G')", () => {
    const result = transposeChord('D', 'C', 'G')
    assertEquals(result.chord, 'A', 'D (C) to A (G) - circle of fifths')
  })
  it("transposeChord('A', 'G', 'D')", () => {
    const result = transposeChord('A', 'G', 'D')
    assertEquals(result.chord, 'E', 'A (G) to E (D) - circle of fifths')
  })
  it("transposeChord('E', 'D', 'A')", () => {
    const result = transposeChord('E', 'D', 'A')
    assertEquals(result.chord, 'B', 'E (D) to B (A) - circle of fifths')
  })

  // Enharmonic choices - should use flats in flat keys
  it("transposeChord('D', 'C', 'Db')", () => {
    const result = transposeChord('D', 'C', 'Db')
    assertEquals(result.chord, 'Eb', 'D (C) to Eb (Db) - not D#')
  })
  it("transposeChord('A', 'C', 'Bb')", () => {
    const result = transposeChord('A', 'C', 'Bb')
    assertEquals(result.chord, 'G', 'A (C) to G (Bb) - uses flats')
  })
  it("transposeChord('E', 'C', 'Ab')", () => {
    const result = transposeChord('E', 'C', 'Ab')
    assertEquals(result.chord, 'C', 'E (C) to C (Ab) - not B#')
  })
  it("transposeChord('B', 'C', 'Eb')", () => {
    const result = transposeChord('B', 'C', 'Eb')
    assertEquals(result.chord, 'D', 'B (C) to D (Eb) - uses flats')
  })
  it("transposeChord('F#', 'D', 'Db')", () => {
    const result = transposeChord('F#', 'D', 'Db')
    assertEquals(result.chord, 'F', 'F# (D) to F (Db) - not E#')
  })
  it("transposeChord('C#', 'A', 'Ab')", () => {
    const result = transposeChord('C#', 'A', 'Ab')
    assertEquals(result.chord, 'C', 'C# (A) to C (Ab) - not B#')
  })
  it("transposeChord('G#m', 'E', 'Eb')", () => {
    const result = transposeChord('G#m', 'E', 'Eb')
    assertEquals(result.chord, 'Gm', 'G#m (E) to Gm (Eb) - not F##m')
  })

  // Enharmonic choices - should use sharps in sharp keys
  it("transposeChord('Bb', 'C', 'D')", () => {
    const result = transposeChord('Bb', 'C', 'D')
    assertEquals(result.chord, 'C', 'Bb (C) to C (D) - natural note')
  })
  it("transposeChord('Eb', 'C', 'E')", () => {
    const result = transposeChord('Eb', 'C', 'E')
    assertEquals(result.chord, 'G', 'Eb (C) to G (E) - natural note')
  })
  it("transposeChord('Ab', 'C', 'A')", () => {
    const result = transposeChord('Ab', 'C', 'A')
    assertEquals(result.chord, 'F', 'Ab (C) to F (A) - natural note')
  })
  it("transposeChord('Db', 'C', 'B')", () => {
    const result = transposeChord('Db', 'C', 'B')
    assertEquals(result.chord, 'C', 'Db (C) to C (B) - natural note')
  })
  it("transposeChord('Gb', 'Db', 'D')", () => {
    const result = transposeChord('Gb', 'Db', 'D')
    assertEquals(result.chord, 'G', 'Gb (Db) to G (D) - not F##')
  })
  it("transposeChord('Bbm', 'Db', 'E')", () => {
    const result = transposeChord('Bbm', 'Db', 'E')
    assertEquals(result.chord, 'Dbm', 'Bbm (Db) to Dbm (E)')
  })
  it("transposeChord('Ebm', 'Gb', 'A')", () => {
    const result = transposeChord('Ebm', 'Gb', 'A')
    assertEquals(result.chord, 'Gbm', 'Ebm (Gb) to Gbm (A)')
  })

  // Mixed - flat note in sharp key context
  it("transposeChord('Bb7', 'F', 'G')", () => {
    const result = transposeChord('Bb7', 'F', 'G')
    assertEquals(result.chord, 'C7', 'Bb7 (F) to C7 (G) - not B#7')
  })
  it("transposeChord('Ebmaj7', 'Bb', 'E')", () => {
    const result = transposeChord('Ebmaj7', 'Bb', 'E')
    assertEquals(result.chord, 'Amaj7', 'Ebmaj7 (Bb) to Amaj7 (E) - not G##maj7')
  })
  it("transposeChord('Abm', 'Db', 'D')", () => {
    const result = transposeChord('Abm', 'Db', 'D')
    assertEquals(result.chord, 'Am', 'Abm (Db) to Am (D) - not G##m')
  })

  // Mixed - sharp note in flat key context
  it("transposeChord('F#', 'D', 'Db')", () => {
    const result = transposeChord('F#', 'D', 'Db')
    assertEquals(result.chord, 'F', 'F# (D) to F (Db) - not E#')
  })
  it("transposeChord('C#m7', 'A', 'Ab')", () => {
    const result = transposeChord('C#m7', 'A', 'Ab')
    assertEquals(result.chord, 'Cm7', 'C#m7 (A) to Cm7 (Ab) - not B#m7')
  })
  it("transposeChord('G#dim', 'E', 'Eb')", () => {
    const result = transposeChord('G#dim', 'E', 'Eb')
    assertEquals(result.chord, 'Gdim', 'G#dim (E) to Gdim (Eb) - not F##dim')
  })

  // Key signature awareness for diatonic chords
  it("transposeChord('F', 'C', 'Gb')", () => {
    const result = transposeChord('F', 'C', 'Gb')
    assertEquals(result.chord, 'Cb', 'F (C) to Cb (Gb) - not B')
  })
  it("transposeChord('B', 'C', 'Db')", () => {
    const result = transposeChord('B', 'C', 'Db')
    assertEquals(result.chord, 'C', 'B (C) to C (Db) - uses flats')
  })
  it("transposeChord('E', 'C', 'Bb')", () => {
    const result = transposeChord('E', 'C', 'Bb')
    assertEquals(result.chord, 'D', 'E (C) to D (Bb) - uses flats')
  })
  it("transposeChord('A', 'C', 'Eb')", () => {
    const result = transposeChord('A', 'C', 'Eb')
    assertEquals(result.chord, 'C', 'A (C) to C (Eb) - not B#')
  })

  // Slash chords with enharmonic considerations
  it("transposeChord('Bb/D', 'F', 'E')", () => {
    const result = transposeChord('Bb/D', 'F', 'E')
    assertEquals(result.chord, 'A/C#', 'Bb/D (F) to A/C# (E) - not A/Db')
  })
  it("transposeChord('C#/E#', 'A', 'Ab')", () => {
    const result = transposeChord('C#/E#', 'A', 'Ab')
    assertEquals(result.chord, 'C/E', 'C#/E# (A) to C/E (Ab) - not C/Fb')
  })
  it("transposeChord('Eb/G', 'Bb', 'B')", () => {
    const result = transposeChord('Eb/G', 'Bb', 'B')
    assertEquals(result.chord, 'E/G#', 'Eb/G (Bb) to E/G# (B) - not E/Ab')
  })
  it("transposeChord('F#/A#', 'D', 'Db')", () => {
    const result = transposeChord('F#/A#', 'D', 'Db')
    assertEquals(result.chord, 'F/A', 'F#/A# (D) to F/A (Db) - natural A')
  })

  // Complex chords with enharmonic considerations
  it("transposeChord('Bbm7b5', 'Db', 'D')", () => {
    const result = transposeChord('Bbm7b5', 'Db', 'D')
    assertEquals(result.chord, 'Bm7b5', 'Bbm7b5 (Db) to Bm7b5 (D) - not A##m7b5')
  })
  it("transposeChord('C#maj7#11', 'A', 'Bb')", () => {
    const result = transposeChord('C#maj7#11', 'A', 'Bb')
    assertEquals(result.chord, 'Dmaj7#11', 'C#maj7#11 (A) to Dmaj7#11 (Bb) - not Ebmaj7#11')
  })
  it("transposeChord('Ebm9', 'Gb', 'G')", () => {
    const result = transposeChord('Ebm9', 'Gb', 'G')
    assertEquals(result.chord, 'Em9', 'Ebm9 (Gb) to Em9 (G) - not D##m9')
  })
  it("transposeChord('F#7b9', 'B', 'Bb')", () => {
    const result = transposeChord('F#7b9', 'B', 'Bb')
    assertEquals(result.chord, 'F7b9', 'F#7b9 (B) to F7b9 (Bb) - not E#7b9')
  })
  it("transposeChord('Abmaj9', 'Eb', 'E')", () => {
    const result = transposeChord('Abmaj9', 'Eb', 'E')
    assertEquals(result.chord, 'Amaj9', 'Abmaj9 (Eb) to Amaj9 (E) - not G##maj9')
  })
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
  const parsedSong = (...sections) => ({
    sections: sections.map(chords => ({
      lines: [{ segments: chords.map(chord => ({ chord, lyrics: 'la ' })) }],
    })),
  })
  const chordsOf = parsed =>
    parsed.sections.map(section => section.lines[0].segments.map(segment => segment.chord))

  it('transposes every chord in every section, in place', () => {
    const parsed = parsedSong(['G', 'C', 'D/F#'], ['Em7', 'Cmaj7'])
    expect(transposeSong(parsed, 'G', 'A')).to.equal(undefined)
    expect(chordsOf(parsed)).to.deep.equal([
      ['A', 'D', 'E/G#'],
      ['F#m7', 'Dmaj7'],
    ])
  })

  it("turns Nashville numbers into chords in the target key, using the song's key", () => {
    const parsed = parsedSong(['1', '4', '5/7', '6m'])
    transposeSong(parsed, 'D', 'D')
    expect(chordsOf(parsed)).to.deep.equal([['D', 'G', 'A/C#', 'Bm']])
  })

  it('marks chords it cannot read as not valid, leaving the rest', () => {
    const parsed = parsedSong(['G', 'H7'])
    transposeSong(parsed, 'G', 'A')
    const [good, bad] = parsed.sections[0].lines[0].segments
    expect(good).to.include({ chord: 'A', valid: true })
    expect(bad.valid).to.equal(false)
  })

  it('leaves lines without chords, and charts without sections, alone', () => {
    const parsed = { sections: [{ lines: [{ segments: [{ chord: '', lyrics: 'Just words' }] }] }] }
    transposeSong(parsed, 'G', 'A')
    expect(parsed.sections[0].lines[0].segments[0]).to.deep.equal({
      chord: '',
      lyrics: 'Just words',
    })
    expect(() => transposeSong({}, 'G', 'A')).to.not.throw()
    expect(() => transposeSong(null, 'G', 'A')).to.not.throw()
  })
})
