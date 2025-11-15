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
