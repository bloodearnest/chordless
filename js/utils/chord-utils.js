/**
 * Utility functions for chord processing
 */

/**
 * Check if a chord string is a bar marker
 * @param {string} chord - Chord text to check
 * @returns {boolean} True if chord is a bar marker (|, ||, ||:, :||)
 */
export function isBarMarker(chord) {
  return chord === '|' || chord === '||' || chord === '||:' || chord === ':||';
}

/**
 * Convert ASCII accidentals (#, b) to their musical symbol equivalents (♯, ♭)
 * without affecting non-accidental text like "dim" or "aug".
 * @param {string} text
 * @returns {string}
 */
export function convertAccidentalsToSymbols(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let result = text;

  // Replace accidentals immediately following note letters (e.g., Bb, C##)
  result = result.replace(/([A-G])([#b]+)/g, (_, note, accidentals) => {
    const converted = accidentals.replace(/#/g, '♯').replace(/b/g, '♭');
    return `${note}${converted}`;
  });

  // Replace accidentals following digits (e.g., 7b5, 9#11)
  result = result.replace(/(\d)([#b]+)/g, (_, digit, accidentals) => {
    const converted = accidentals.replace(/#/g, '♯').replace(/b/g, '♭');
    return `${digit}${converted}`;
  });

  // Replace standalone accidentals before digits (e.g., #4, b7)
  result = result.replace(/#(?=\d)/g, '♯');
  result = result.replace(/b(?=\d)/g, '♭');

  return result;
}
