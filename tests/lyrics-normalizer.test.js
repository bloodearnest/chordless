import {
  normalizeSegmentsForHiddenChords,
  segmentHasVisibleLyrics,
  formatHiddenLyricsText,
  splitChordDisplaySegments,
} from '../js/utils/lyrics-normalizer.js';

let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  testCount++;
  if (condition) {
    passCount++;
    console.log(`\u2713 ${message}`);
  } else {
    failCount++;
    console.error(`\u2717 ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  const matches = JSON.stringify(actual) === JSON.stringify(expected);
  assert(
    matches,
    `${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`
  );
}

console.log('Running lyrics-normalizer tests...');

assert(!segmentHasVisibleLyrics({ lyrics: ' - ' }), 'Hyphen-only lyrics hidden');
assert(segmentHasVisibleLyrics({ lyrics: 'Ho - ' }), 'Lyrics containing text are detected');

const segments = [{ lyrics: 'Ho - ' }, { lyrics: ' san - ' }, { lyrics: ' na ' }];
const normalized = normalizeSegmentsForHiddenChords(segments);
assertEquals(
  normalized.map(s => s.lyrics),
  ['Ho', 'san', 'na'],
  'Normalize lyrics strips glue markers'
);
assertEquals(
  normalized.map(s => !!s.__joinWithPrev),
  [false, true, true],
  'Normalize lyrics marks join-with-previous flags'
);

const formatted1 = formatHiddenLyricsText('san', true, false);
assertEquals(formatted1, ' san', 'Formatter inserts leading space between words');
const formatted2 = formatHiddenLyricsText('na', true, true);
assertEquals(formatted2, 'na', 'Formatter suppresses space when line should join');

const chordSegments = splitChordDisplaySegments('Emaj7sus4add9');
assertEquals(
  chordSegments,
  [
    { type: 'base', value: 'E' },
    { type: 'extension', value: 'maj7' },
    { type: 'extension', value: 'sus4' },
    { type: 'extension', value: 'add9' },
  ],
  'Split chained extensions into base + extensions'
);

const bracketChord = splitChordDisplaySegments('Bsus(2)');
assertEquals(
  bracketChord,
  [
    { type: 'base', value: 'B' },
    { type: 'extension', value: 'sus' },
    { type: 'extension', value: '(2)' },
  ],
  'Split bracketed extension tokens'
);

const optionalChord = splitChordDisplaySegments('(A2)');
assertEquals(
  optionalChord,
  [
    { type: 'base', value: '(' },
    { type: 'base', value: 'A' },
    { type: 'extension', value: '2' },
    { type: 'base', value: ')' },
  ],
  'Split wrapped optional chord tokens'
);

const minorTriad = splitChordDisplaySegments('Bm');
assertEquals(
  minorTriad,
  [
    { type: 'base', value: 'B' },
    { type: 'base', value: 'm' },
  ],
  'Minor chord keeps quality marker outside extension'
);

const minorSeventh = splitChordDisplaySegments('Am7');
assertEquals(
  minorSeventh,
  [
    { type: 'base', value: 'A' },
    { type: 'base', value: 'm' },
    { type: 'extension', value: '7' },
  ],
  'Minor 7 chord only wraps numeric extension'
);

const minorSeventhExtensionOnly = splitChordDisplaySegments('Cm7').slice(1);
assertEquals(
  minorSeventhExtensionOnly,
  [
    { type: 'base', value: 'm' },
    { type: 'extension', value: '7' },
  ],
  'Nashville chord helpers (which drop the root) still keep minor quality inline'
);

console.log(`\n${passCount}/${testCount} assertions passed. Failures: ${failCount}`);
if (failCount > 0) {
  process.exit(1);
}
