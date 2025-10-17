// Unit tests for transpose.js
// Run this file with: node transpose.test.js
// Or load in browser console

import {
    parseChord,
    transposeNote,
    transposeChord,
    getAvailableKeys,
    getKeyOffset
} from './transpose.js';

// Simple test framework
let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
    testCount++;
    if (condition) {
        passCount++;
        console.log(`✓ ${message}`);
    } else {
        failCount++;
        console.error(`✗ ${message}`);
    }
}

function assertEquals(actual, expected, message) {
    const matches = JSON.stringify(actual) === JSON.stringify(expected);
    assert(matches, `${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
}

console.log('Running transpose.js tests...\n');

// ===== Test parseChord =====
console.log('=== Testing parseChord ===');

// Basic chords
let parsed = parseChord('C');
assertEquals(parsed.root, 'C', 'Parse C root');
assertEquals(parsed.extensions, '', 'Parse C extensions');
assertEquals(parsed.bass, null, 'Parse C bass');
assert(parsed.isValid, 'Parse C valid');

parsed = parseChord('G#');
assertEquals(parsed.root, 'G#', 'Parse G# root');

parsed = parseChord('Bb');
assertEquals(parsed.root, 'Bb', 'Parse Bb root');

// Chords with extensions
parsed = parseChord('Cmaj7');
assertEquals(parsed.root, 'C', 'Parse Cmaj7 root');
assertEquals(parsed.extensions, 'maj7', 'Parse Cmaj7 extensions');

parsed = parseChord('Am7');
assertEquals(parsed.root, 'A', 'Parse Am7 root');
assertEquals(parsed.extensions, 'm7', 'Parse Am7 extensions');

parsed = parseChord('Dsus4');
assertEquals(parsed.root, 'D', 'Parse Dsus4 root');
assertEquals(parsed.extensions, 'sus4', 'Parse Dsus4 extensions');

parsed = parseChord('F#m7b5');
assertEquals(parsed.root, 'F#', 'Parse F#m7b5 root');
assertEquals(parsed.extensions, 'm7b5', 'Parse F#m7b5 extensions');

parsed = parseChord('Eadd9');
assertEquals(parsed.root, 'E', 'Parse Eadd9 root');
assertEquals(parsed.extensions, 'add9', 'Parse Eadd9 extensions');

// Chords with bass notes
parsed = parseChord('C/E');
assertEquals(parsed.root, 'C', 'Parse C/E root');
assertEquals(parsed.bass, 'E', 'Parse C/E bass');

parsed = parseChord('G/B');
assertEquals(parsed.root, 'G', 'Parse G/B root');
assertEquals(parsed.bass, 'B', 'Parse G/B bass');

parsed = parseChord('Dm7/F');
assertEquals(parsed.root, 'D', 'Parse Dm7/F root');
assertEquals(parsed.extensions, 'm7', 'Parse Dm7/F extensions');
assertEquals(parsed.bass, 'F', 'Parse Dm7/F bass');

parsed = parseChord('F#/C#');
assertEquals(parsed.root, 'F#', 'Parse F#/C# root');
assertEquals(parsed.bass, 'C#', 'Parse F#/C# bass');

// Special values
parsed = parseChord('|');
assert(parsed.isSpecial, 'Parse | as special');
assert(parsed.isValid, 'Parse | as valid');

parsed = parseChord('||');
assert(parsed.isSpecial, 'Parse || as special');

parsed = parseChord('N.C.');
assert(parsed.isSpecial, 'Parse N.C. as special');

parsed = parseChord('.');
assert(parsed.isSpecial, 'Parse . as special');

// Invalid chords
parsed = parseChord('X');
assert(!parsed.isValid, 'Parse X as invalid');

parsed = parseChord('123');
assert(!parsed.isValid, 'Parse 123 as invalid');

// ===== Test transposeNote =====
console.log('\n=== Testing transposeNote ===');

// Transposing with sharps
assertEquals(transposeNote('C', 2, false), 'D', 'C up 2 semitones = D');
assertEquals(transposeNote('D', 2, false), 'E', 'D up 2 semitones = E');
assertEquals(transposeNote('E', 2, false), 'F#', 'E up 2 semitones = F#');
assertEquals(transposeNote('C', 1, false), 'C#', 'C up 1 semitone = C#');
assertEquals(transposeNote('F', 1, false), 'F#', 'F up 1 semitone = F#');

// Transposing with flats
assertEquals(transposeNote('C', 2, true), 'D', 'C up 2 semitones = D (flats)');
assertEquals(transposeNote('D', 2, true), 'E', 'D up 2 semitones = E (flats)');
assertEquals(transposeNote('E', 2, true), 'Gb', 'E up 2 semitones = Gb (flats)');
assertEquals(transposeNote('C', 1, true), 'Db', 'C up 1 semitone = Db (flats)');
assertEquals(transposeNote('F', 1, true), 'Gb', 'F up 1 semitone = Gb (flats)');

// Transposing down
assertEquals(transposeNote('D', -2, false), 'C', 'D down 2 semitones = C');
assertEquals(transposeNote('E', -2, false), 'D', 'E down 2 semitones = D');
assertEquals(transposeNote('C', -1, false), 'B', 'C down 1 semitone = B');

// Wrapping around octave
assertEquals(transposeNote('B', 2, false), 'C#', 'B up 2 wraps to C#');
assertEquals(transposeNote('C', -2, false), 'A#', 'C down 2 wraps to A#');

// ===== Test getKeyOffset =====
console.log('\n=== Testing getKeyOffset ===');

assertEquals(getKeyOffset('C', 'D'), 2, 'C to D = +2 semitones');
assertEquals(getKeyOffset('C', 'G'), 7, 'C to G = +7 semitones');
assertEquals(getKeyOffset('G', 'C'), -7, 'G to C = -7 semitones');
assertEquals(getKeyOffset('E', 'E'), 0, 'E to E = 0 semitones');
assertEquals(getKeyOffset('Am', 'Em'), -5, 'Am to Em = -5 semitones');
assertEquals(getKeyOffset('Dm', 'Gm'), 5, 'Dm to Gm = +5 semitones');

// ===== Test getAvailableKeys =====
console.log('\n=== Testing getAvailableKeys ===');

let keys = getAvailableKeys('C');
assert(keys.includes('C'), 'C major includes C');
assert(keys.includes('G'), 'C major includes G');
assert(keys.includes('F'), 'C major includes F');
assert(!keys.includes('Am'), 'C major excludes Am');
assert(!keys.includes('Dm'), 'C major excludes Dm');

keys = getAvailableKeys('Am');
assert(keys.includes('Am'), 'A minor includes Am');
assert(keys.includes('Em'), 'A minor includes Em');
assert(keys.includes('Dm'), 'A minor includes Dm');
assert(!keys.includes('C'), 'A minor excludes C');
assert(!keys.includes('G'), 'A minor excludes G');

// ===== Test transposeChord =====
console.log('\n=== Testing transposeChord ===');

// Basic major chords C to D (sharps)
let result = transposeChord('C', 'C', 'D');
assertEquals(result.chord, 'D', 'Transpose C to D');
assert(result.transposed, 'C to D transposed flag');
assert(result.valid, 'C to D valid flag');

result = transposeChord('G', 'C', 'D');
assertEquals(result.chord, 'A', 'Transpose G (in C) to A (in D)');

result = transposeChord('F', 'C', 'D');
assertEquals(result.chord, 'G', 'Transpose F (in C) to G (in D)');

// Major chords C to F (flats)
result = transposeChord('C', 'C', 'F');
assertEquals(result.chord, 'F', 'Transpose C to F');

result = transposeChord('G', 'C', 'F');
assertEquals(result.chord, 'C', 'Transpose G (in C) to C (in F)');

result = transposeChord('E', 'C', 'F');
assertEquals(result.chord, 'A', 'Transpose E (in C) to A (in F)');

// Chords with extensions
result = transposeChord('Cmaj7', 'C', 'D');
assertEquals(result.chord, 'Dmaj7', 'Transpose Cmaj7 to Dmaj7');

result = transposeChord('Am7', 'C', 'D');
assertEquals(result.chord, 'Bm7', 'Transpose Am7 to Bm7');

result = transposeChord('Dsus4', 'C', 'G');
assertEquals(result.chord, 'Asus4', 'Transpose Dsus4 to Asus4');

result = transposeChord('F#m7b5', 'D', 'E');
assertEquals(result.chord, 'G#m7b5', 'Transpose F#m7b5 to G#m7b5');

// Chords with bass notes
result = transposeChord('C/E', 'C', 'D');
assertEquals(result.chord, 'D/F#', 'Transpose C/E to D/F#');

result = transposeChord('G/B', 'C', 'F');
assertEquals(result.chord, 'C/E', 'Transpose G/B to C/E');

result = transposeChord('Dm7/F', 'C', 'D');
assertEquals(result.chord, 'Em7/G', 'Transpose Dm7/F to Em7/G');

// Minor key transposition
result = transposeChord('Am', 'Am', 'Em');
assertEquals(result.chord, 'Em', 'Transpose Am to Em');

result = transposeChord('Dm', 'Am', 'Em');
assertEquals(result.chord, 'Am', 'Transpose Dm (in Am) to Am (in Em)');

result = transposeChord('F', 'Am', 'Em');
assertEquals(result.chord, 'C', 'Transpose F (in Am) to C (in Em)');

// Special values pass through
result = transposeChord('|', 'C', 'D');
assertEquals(result.chord, '|', 'Bar symbol passes through');
assert(result.transposed, 'Bar symbol marked as transposed');

result = transposeChord('N.C.', 'C', 'D');
assertEquals(result.chord, 'N.C.', 'N.C. passes through');

result = transposeChord('.', 'C', 'D');
assertEquals(result.chord, '.', 'Dot passes through');

// Invalid chords
result = transposeChord('X', 'C', 'D');
assertEquals(result.chord, 'X', 'Invalid chord X unchanged');
assert(!result.transposed, 'Invalid chord not transposed');
assert(!result.valid, 'Invalid chord marked invalid');

// No transposition (same key)
result = transposeChord('C', 'D', 'D');
assertEquals(result.chord, 'C', 'C in D to D stays C');

// Flat to sharp keys
result = transposeChord('Bb', 'F', 'G');
assertEquals(result.chord, 'C', 'Transpose Bb (in F) to C (in G)');

result = transposeChord('Eb', 'Bb', 'D');
assertEquals(result.chord, 'G', 'Transpose Eb (in Bb) to G (in D)');

// Sharp to flat keys
result = transposeChord('F#', 'D', 'Bb');
assertEquals(result.chord, 'D', 'Transpose F# (in D) to D (in Bb)');

result = transposeChord('C#', 'A', 'F');
assertEquals(result.chord, 'A', 'Transpose C# (in A) to A (in F)');

// Complex real-world examples
result = transposeChord('Esus4', 'E', 'D');
assertEquals(result.chord, 'Dsus4', 'Transpose Esus4 (E) to Dsus4 (D)');

result = transposeChord('Cadd9/G', 'G', 'A');
assertEquals(result.chord, 'Dadd9/A', 'Transpose Cadd9/G (G) to Dadd9/A (A)');

result = transposeChord('Bm7', 'D', 'Eb');
assertEquals(result.chord, 'Cm7', 'Transpose Bm7 (D) to Cm7 (Eb)');

// Very complex chords
result = transposeChord('C#m7b5/E', 'A', 'C');
assertEquals(result.chord, 'Em7b5/G', 'Transpose C#m7b5/E (A) to Em7b5/G (C)');

result = transposeChord('Eb7b9add13', 'Eb', 'D');
assertEquals(result.chord, 'D7b9add13', 'Transpose Eb7b9add13 (Eb) to D7b9add13 (D)');

result = transposeChord('F#m7#11/A', 'D', 'E');
assertEquals(result.chord, 'G#m7#11/B', 'Transpose F#m7#11/A (D) to G#m7#11/B (E)');

result = transposeChord('Bb9/Eb', 'Bb', 'G');
assertEquals(result.chord, 'G9/C', 'Transpose Bb9/Eb (Bb) to G9/C (G)');

result = transposeChord('Aadd9#11', 'A', 'F');
assertEquals(result.chord, 'Fadd9#11', 'Transpose Aadd9#11 (A) to Fadd9#11 (F)');

// Borrowed/chromatic chords
// bVII maj7 (borrowed from parallel minor)
result = transposeChord('Bbmaj7', 'C', 'D');
assertEquals(result.chord, 'Cmaj7', 'Transpose Bbmaj7 (bVII in C) to Cmaj7 (bVII in D)');

result = transposeChord('Abmaj7', 'Bb', 'G');
assertEquals(result.chord, 'Fmaj7', 'Transpose Abmaj7 (bVII in Bb) to Fmaj7 (bVII in G)');

// Major III (chromatic mediant)
result = transposeChord('E', 'C', 'F');
assertEquals(result.chord, 'A', 'Transpose E (III in C) to A (III in F)');

result = transposeChord('C#', 'A', 'Eb');
assertEquals(result.chord, 'G', 'Transpose C# (III in A) to G (III in Eb)');

// Minor iv (borrowed from parallel minor)
result = transposeChord('Fm', 'C', 'G');
assertEquals(result.chord, 'Cm', 'Transpose Fm (iv in C) to Cm (iv in G)');

result = transposeChord('Bbm', 'F', 'D');
assertEquals(result.chord, 'Gm', 'Transpose Bbm (iv in F) to Gm (iv in D)');

// Complex borrowed chords with bass notes
result = transposeChord('Bbmaj7/D', 'C', 'Eb');
assertEquals(result.chord, 'Dbmaj7/F', 'Transpose Bbmaj7/D (C) to Dbmaj7/F (Eb) - uses flats');

result = transposeChord('E/G#', 'C', 'D');
assertEquals(result.chord, 'F#/A#', 'Transpose E/G# (C) to F#/A# (D) - uses sharps');

// Comprehensive transposition tests
console.log('\n=== Testing Comprehensive Transpositions ===');

// Basic major chords (I) - transposing C to various keys
result = transposeChord('C', 'C', 'D');
assertEquals(result.chord, 'D', 'C (I in C) to D (I in D)');

result = transposeChord('C', 'C', 'Eb');
assertEquals(result.chord, 'Eb', 'C (I in C) to Eb (I in Eb)');

result = transposeChord('C', 'C', 'F#');
assertEquals(result.chord, 'F#', 'C (I in C) to F# (I in F#)');

result = transposeChord('C', 'C', 'Bb');
assertEquals(result.chord, 'Bb', 'C (I in C) to Bb (I in Bb)');

// Minor chords (ii) - D minor in C to various keys
result = transposeChord('Dm', 'C', 'D');
assertEquals(result.chord, 'Em', 'Dm (ii in C) to Em (ii in D)');

result = transposeChord('Dm', 'C', 'G');
assertEquals(result.chord, 'Am', 'Dm (ii in C) to Am (ii in G)');

result = transposeChord('Dm', 'C', 'F');
assertEquals(result.chord, 'Gm', 'Dm (ii in C) to Gm (ii in F)');

// Minor chords (iii) - E minor in C to various keys
result = transposeChord('Em', 'C', 'D');
assertEquals(result.chord, 'F#m', 'Em (iii in C) to F#m (iii in D)');

result = transposeChord('Em', 'C', 'A');
assertEquals(result.chord, 'C#m', 'Em (iii in C) to C#m (iii in A)');

result = transposeChord('Em', 'C', 'Eb');
assertEquals(result.chord, 'Gm', 'Em (iii in C) to Gm (iii in Eb)');

// Major chords (IV) - F in C to various keys
result = transposeChord('F', 'C', 'D');
assertEquals(result.chord, 'G', 'F (IV in C) to G (IV in D)');

result = transposeChord('F', 'C', 'A');
assertEquals(result.chord, 'D', 'F (IV in C) to D (IV in A)');

result = transposeChord('F', 'C', 'Bb');
assertEquals(result.chord, 'Eb', 'F (IV in C) to Eb (IV in Bb)');

// Major chords (V) - G in C to various keys
result = transposeChord('G', 'C', 'D');
assertEquals(result.chord, 'A', 'G (V in C) to A (V in D)');

result = transposeChord('G', 'C', 'F');
assertEquals(result.chord, 'C', 'G (V in C) to C (V in F)');

result = transposeChord('G', 'C', 'E');
assertEquals(result.chord, 'B', 'G (V in C) to B (V in E)');

// Minor chords (vi) - A minor in C to various keys
result = transposeChord('Am', 'C', 'D');
assertEquals(result.chord, 'Bm', 'Am (vi in C) to Bm (vi in D)');

result = transposeChord('Am', 'C', 'G');
assertEquals(result.chord, 'Em', 'Am (vi in C) to Em (vi in G)');

result = transposeChord('Am', 'C', 'Bb');
assertEquals(result.chord, 'Gm', 'Am (vi in C) to Gm (vi in Bb)');

// Diminished chords (vii°) - B diminished in C to various keys
result = transposeChord('Bdim', 'C', 'D');
assertEquals(result.chord, 'C#dim', 'Bdim (vii° in C) to C#dim (vii° in D)');

result = transposeChord('Bdim', 'C', 'F');
assertEquals(result.chord, 'Edim', 'Bdim (vii° in C) to Edim (vii° in F)');

result = transposeChord('Bdim', 'C', 'Ab');
assertEquals(result.chord, 'Gdim', 'Bdim (vii° in C) to Gdim (vii° in Ab)');

// Minor IV (iv) - borrowed chord
result = transposeChord('Fm', 'C', 'D');
assertEquals(result.chord, 'Gm', 'Fm (iv in C) to Gm (iv in D)');

result = transposeChord('Fm', 'C', 'A');
assertEquals(result.chord, 'Dm', 'Fm (iv in C) to Dm (iv in A)');

result = transposeChord('Fm', 'C', 'E');
assertEquals(result.chord, 'Am', 'Fm (iv in C) to Am (iv in E)');

// Major III (III) - borrowed chord
result = transposeChord('E', 'C', 'D');
assertEquals(result.chord, 'F#', 'E (III in C) to F# (III in D)');

result = transposeChord('E', 'C', 'G');
assertEquals(result.chord, 'B', 'E (III in C) to B (III in G)');

result = transposeChord('E', 'C', 'F');
assertEquals(result.chord, 'A', 'E (III in C) to A (III in F)');

// Flat-7 major 7 (bVIImaj7) - borrowed chord
result = transposeChord('Bbmaj7', 'C', 'D');
assertEquals(result.chord, 'Cmaj7', 'Bbmaj7 (bVII in C) to Cmaj7 (bVII in D)');

result = transposeChord('Bbmaj7', 'C', 'E');
assertEquals(result.chord, 'Dmaj7', 'Bbmaj7 (bVII in C) to Dmaj7 (bVII in E)');

result = transposeChord('Bbmaj7', 'C', 'Ab');
assertEquals(result.chord, 'Gbmaj7', 'Bbmaj7 (bVII in C) to Gbmaj7 (bVII in Ab)');

// Complex chords with extensions and alterations
result = transposeChord('C#m7#11/Eb', 'A', 'B');
assertEquals(result.chord, 'D#m7#11/F', 'C#m7#11/Eb (A) to D#m7#11/F (B)');

result = transposeChord('C#m7#11/Eb', 'A', 'C');
assertEquals(result.chord, 'Em7#11/F#', 'C#m7#11/Eb (A) to Em7#11/F# (C)');

result = transposeChord('Dm9', 'C', 'Eb');
assertEquals(result.chord, 'Fm9', 'Dm9 (C) to Fm9 (Eb)');

result = transposeChord('G7b9', 'C', 'F');
assertEquals(result.chord, 'C7b9', 'G7b9 (C) to C7b9 (F)');

result = transposeChord('Fmaj9', 'C', 'D');
assertEquals(result.chord, 'Gmaj9', 'Fmaj9 (C) to Gmaj9 (D)');

// Seventh chords across keys
result = transposeChord('Dm7', 'C', 'A');
assertEquals(result.chord, 'Bm7', 'Dm7 (C) to Bm7 (A)');

result = transposeChord('G7', 'C', 'Bb');
assertEquals(result.chord, 'F7', 'G7 (C) to F7 (Bb)');

result = transposeChord('Cmaj7', 'C', 'E');
assertEquals(result.chord, 'Emaj7', 'Cmaj7 (C) to Emaj7 (E)');

// Sharp and flat keys
result = transposeChord('F#m', 'D', 'Eb');
assertEquals(result.chord, 'Gm', 'F#m (D) to Gm (Eb)');

result = transposeChord('Db', 'Ab', 'A');
assertEquals(result.chord, 'D', 'Db (Ab) to D (A)');

result = transposeChord('C#', 'E', 'F');
assertEquals(result.chord, 'D', 'C# (E) to D (F)');

// Slash chords (inversions)
result = transposeChord('C/E', 'C', 'D');
assertEquals(result.chord, 'D/F#', 'C/E (C) to D/F# (D)');

result = transposeChord('Am/C', 'C', 'G');
assertEquals(result.chord, 'Em/G', 'Am/C (C) to Em/G (G)');

result = transposeChord('G7/B', 'C', 'F');
assertEquals(result.chord, 'C7/E', 'G7/B (C) to C7/E (F)');

// Suspended chords
result = transposeChord('Dsus4', 'C', 'E');
assertEquals(result.chord, 'F#sus4', 'Dsus4 (C) to F#sus4 (E)');

result = transposeChord('Gsus2', 'C', 'A');
assertEquals(result.chord, 'Esus2', 'Gsus2 (C) to Esus2 (A)');

// Augmented and diminished with 7ths
result = transposeChord('Gaug', 'C', 'D');
assertEquals(result.chord, 'Aaug', 'Gaug (C) to Aaug (D)');

result = transposeChord('Bdim7', 'C', 'F');
assertEquals(result.chord, 'Edim7', 'Bdim7 (C) to Edim7 (F)');

// Edge cases - same key (no transposition)
result = transposeChord('C#m7#11/Eb', 'A', 'A');
assertEquals(result.chord, 'C#m7#11/Eb', 'C#m7#11/Eb (A to A) - no change');

result = transposeChord('Fmaj7', 'C', 'C');
assertEquals(result.chord, 'Fmaj7', 'Fmaj7 (C to C) - no change');

// Full circle of fifths
result = transposeChord('D', 'C', 'G');
assertEquals(result.chord, 'A', 'D (C) to A (G) - circle of fifths');

result = transposeChord('A', 'G', 'D');
assertEquals(result.chord, 'E', 'A (G) to E (D) - circle of fifths');

result = transposeChord('E', 'D', 'A');
assertEquals(result.chord, 'B', 'E (D) to B (A) - circle of fifths');

// Enharmonic choices - should use flats in flat keys
result = transposeChord('D', 'C', 'Db');
assertEquals(result.chord, 'Eb', 'D (C) to Eb (Db) - not D#');

result = transposeChord('A', 'C', 'Bb');
assertEquals(result.chord, 'G', 'A (C) to G (Bb) - uses flats');

result = transposeChord('E', 'C', 'Ab');
assertEquals(result.chord, 'C', 'E (C) to C (Ab) - not B#');

result = transposeChord('B', 'C', 'Eb');
assertEquals(result.chord, 'D', 'B (C) to D (Eb) - uses flats');

result = transposeChord('F#', 'D', 'Db');
assertEquals(result.chord, 'F', 'F# (D) to F (Db) - not E#');

result = transposeChord('C#', 'A', 'Ab');
assertEquals(result.chord, 'C', 'C# (A) to C (Ab) - not B#');

result = transposeChord('G#m', 'E', 'Eb');
assertEquals(result.chord, 'Gm', 'G#m (E) to Gm (Eb) - not F##m');

// Enharmonic choices - should use sharps in sharp keys
result = transposeChord('Bb', 'C', 'D');
assertEquals(result.chord, 'C', 'Bb (C) to C (D) - natural note');

result = transposeChord('Eb', 'C', 'E');
assertEquals(result.chord, 'G', 'Eb (C) to G (E) - natural note');

result = transposeChord('Ab', 'C', 'A');
assertEquals(result.chord, 'F', 'Ab (C) to F (A) - natural note');

result = transposeChord('Db', 'C', 'B');
assertEquals(result.chord, 'C', 'Db (C) to C (B) - natural note');

result = transposeChord('Gb', 'Db', 'D');
assertEquals(result.chord, 'G', 'Gb (Db) to G (D) - not F##');

result = transposeChord('Bbm', 'Db', 'E');
assertEquals(result.chord, 'C#m', 'Bbm (Db) to C#m (E) - not Dbm');

result = transposeChord('Ebm', 'Gb', 'A');
assertEquals(result.chord, 'F#m', 'Ebm (Gb) to F#m (A) - not Gbm');

// Mixed - flat note in sharp key context
result = transposeChord('Bb7', 'F', 'G');
assertEquals(result.chord, 'C7', 'Bb7 (F) to C7 (G) - not B#7');

result = transposeChord('Ebmaj7', 'Bb', 'E');
assertEquals(result.chord, 'Amaj7', 'Ebmaj7 (Bb) to Amaj7 (E) - not G##maj7');

result = transposeChord('Abm', 'Db', 'D');
assertEquals(result.chord, 'Am', 'Abm (Db) to Am (D) - not G##m');

// Mixed - sharp note in flat key context
result = transposeChord('F#', 'D', 'Db');
assertEquals(result.chord, 'F', 'F# (D) to F (Db) - not E#');

result = transposeChord('C#m7', 'A', 'Ab');
assertEquals(result.chord, 'Cm7', 'C#m7 (A) to Cm7 (Ab) - not B#m7');

result = transposeChord('G#dim', 'E', 'Eb');
assertEquals(result.chord, 'Gdim', 'G#dim (E) to Gdim (Eb) - not F##dim');

// Key signature awareness for diatonic chords
result = transposeChord('F', 'C', 'Gb');
assertEquals(result.chord, 'Cb', 'F (C) to Cb (Gb) - not B');

result = transposeChord('B', 'C', 'Db');
assertEquals(result.chord, 'C', 'B (C) to C (Db) - uses flats');

result = transposeChord('E', 'C', 'Bb');
assertEquals(result.chord, 'D', 'E (C) to D (Bb) - uses flats');

result = transposeChord('A', 'C', 'Eb');
assertEquals(result.chord, 'C', 'A (C) to C (Eb) - not B#');

// Slash chords with enharmonic considerations
result = transposeChord('Bb/D', 'F', 'E');
assertEquals(result.chord, 'A/C#', 'Bb/D (F) to A/C# (E) - not A/Db');

result = transposeChord('C#/E#', 'A', 'Ab');
assertEquals(result.chord, 'C/E', 'C#/E# (A) to C/E (Ab) - not C/Fb');

result = transposeChord('Eb/G', 'Bb', 'B');
assertEquals(result.chord, 'E/G#', 'Eb/G (Bb) to E/G# (B) - not E/Ab');

result = transposeChord('F#/A#', 'D', 'Db');
assertEquals(result.chord, 'F/A', 'F#/A# (D) to F/A (Db) - natural A');

// Complex chords with enharmonic considerations
result = transposeChord('Bbm7b5', 'Db', 'D');
assertEquals(result.chord, 'Bm7b5', 'Bbm7b5 (Db) to Bm7b5 (D) - not A##m7b5');

result = transposeChord('C#maj7#11', 'A', 'Bb');
assertEquals(result.chord, 'Dmaj7#11', 'C#maj7#11 (A) to Dmaj7#11 (Bb) - not Ebmaj7#11');

result = transposeChord('Ebm9', 'Gb', 'G');
assertEquals(result.chord, 'Em9', 'Ebm9 (Gb) to Em9 (G) - not D##m9');

result = transposeChord('F#7b9', 'B', 'Bb');
assertEquals(result.chord, 'F7b9', 'F#7b9 (B) to F7b9 (Bb) - not E#7b9');

result = transposeChord('Abmaj9', 'Eb', 'E');
assertEquals(result.chord, 'Amaj9', 'Abmaj9 (Eb) to Amaj9 (E) - not G##maj9');

// ===== Summary =====
console.log('\n=== Test Summary ===');
console.log(`Total tests: ${testCount}`);
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);

if (failCount === 0) {
    console.log('\n✓ All tests passed!');
} else {
    console.error(`\n✗ ${failCount} test(s) failed`);
    process.exit(1);
}
