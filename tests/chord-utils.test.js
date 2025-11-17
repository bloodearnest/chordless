import { convertAccidentalsToSymbols } from '../js/utils/chord-utils.js';

let testCount = 0;
let passCount = 0;
let failCount = 0;

function assertEquals(actual, expected, message) {
  testCount++;
  if (actual === expected) {
    passCount++;
    console.log(`✓ ${message}`);
  } else {
    failCount++;
    console.error(`✗ ${message} (expected: ${expected}, got: ${actual})`);
  }
}

console.log('Running chord-utils tests...\n');

assertEquals(convertAccidentalsToSymbols('F#maj7'), 'F♯maj7', 'Convert sharp root to symbol');
assertEquals(convertAccidentalsToSymbols('Bb'), 'B♭', 'Convert flat root to symbol');
assertEquals(convertAccidentalsToSymbols('C7b9'), 'C7♭9', 'Convert flat extension');
assertEquals(convertAccidentalsToSymbols('9#11'), '9♯11', 'Convert sharp extension');
assertEquals(convertAccidentalsToSymbols('C##'), 'C♯♯', 'Support double sharp');
assertEquals(convertAccidentalsToSymbols('Gbb'), 'G♭♭', 'Support double flat');
assertEquals(convertAccidentalsToSymbols('#4'), '♯4', 'Convert standalone sharp Nashville degree');
assertEquals(convertAccidentalsToSymbols('b6'), '♭6', 'Convert standalone flat Nashville degree');
assertEquals(convertAccidentalsToSymbols('dim'), 'dim', 'Do not touch plain text');
assertEquals(
  convertAccidentalsToSymbols('G#sus4/Bb'),
  'G♯sus4/B♭',
  'Convert both root and slash bass'
);

console.log(`\n${passCount}/${testCount} assertions passed.`);
if (failCount > 0) {
  process.exit(1);
}
