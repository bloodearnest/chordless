import {
  normalizeSegmentsForHiddenChords,
  segmentHasVisibleLyrics,
  formatHiddenLyricsText,
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
  assert(matches, `${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
}

console.log('Running lyrics-normalizer tests...');

assert(!segmentHasVisibleLyrics({ lyrics: ' - ' }), 'Hyphen-only lyrics hidden');
assert(segmentHasVisibleLyrics({ lyrics: 'Ho - ' }), 'Lyrics containing text are detected');

const segments = [
  { lyrics: 'Ho - ' },
  { lyrics: ' san - ' },
  { lyrics: ' na ' },
];
const normalized = normalizeSegmentsForHiddenChords(segments);
assertEquals(normalized.map(s => s.lyrics), ['Ho', 'san', 'na'], 'Normalize lyrics strips glue markers');
assertEquals(
  normalized.map(s => !!s.__joinWithPrev),
  [false, true, true],
  'Normalize lyrics marks join-with-previous flags'
);

const formatted1 = formatHiddenLyricsText('san', true, false);
assertEquals(formatted1, ' san', 'Formatter inserts leading space between words');
const formatted2 = formatHiddenLyricsText('na', true, true);
assertEquals(formatted2, 'na', 'Formatter suppresses space when line should join');

console.log(`\n${passCount}/${testCount} assertions passed. Failures: ${failCount}`);
if (failCount > 0) {
  process.exit(1);
}
