import type { ChartSegment } from '../data-types.ts'

/** Whether a piece has anything but spaces */
const hasWords = (piece: ChartSegment): boolean => /\S/.test(piece.lyrics)

/**
 * Group a line's chord/lyric segments into units that must not be broken apart: the line wraps
 * between units, never inside one. A segment's lyrics are cut into words (a word keeps the space
 * after it, and the space before a chord's word goes to the word before), the first keeping the chord. Pieces are then joined where a break would
 * be wrong:
 * - a chord in the middle of a word, or at the end of one, stays with the word
 * - a chord over a gap stays with the word after it
 * - the chords left at the end of the line stay with the last word, unless the whole line is chords
 */
export function groupSegmentsIntoUnits(
  segments: ChartSegment[],
  { reserveChords = true }: { reserveChords?: boolean } = {}
): ChartSegment[][] {
  const pieces: ChartSegment[] = []
  for (const segment of segments) {
    let lyrics = segment.lyrics
    // The space before a word belongs to the word before it, so a word that starts a row does not
    // start with a space (unless there is no word before it to take the space). A segment of
    // spaces alone is the gap after its chord, which stays.
    const previous = pieces[pieces.length - 1]
    const gap = lyrics.match(/^\s+/)?.[0]
    if (gap && /\S/.test(lyrics) && previous?.lyrics) {
      previous.lyrics += gap
      lyrics = lyrics.slice(gap.length)
    }
    if (!lyrics) {
      if (segment.chord) pieces.push({ ...segment, lyrics })
      continue
    }
    // (every character is a space or not, so non-empty lyrics always match)
    const words = lyrics.match(/\s*\S+\s*|\s+/g) as string[]
    words.forEach((word, index) => {
      pieces.push(index === 0 ? { ...segment, lyrics: word } : { chord: '', lyrics: word })
    })
  }

  const lastWord = pieces.findLastIndex(hasWords)
  const units: ChartSegment[][] = []
  pieces.forEach((piece, index) => {
    const previous = pieces[index - 1]
    const joins =
      previous !== undefined &&
      ((/\S$/.test(previous.lyrics) && (piece.lyrics === '' || /^\S/.test(piece.lyrics))) ||
        (!hasWords(previous) &&
          previous.chord !== '' &&
          hasWords(piece) &&
          units[units.length - 1].length === 1) ||
        (lastWord >= 0 && index > lastWord))
    if (joins) units[units.length - 1].push(piece)
    else units.push([piece])
  })
  return reserveChords ? giveChordsRoom(units) : units
}

/** Letters and marks that take about half the room of an average letter */
const NARROW = /[iIljtfr.,'!|:;()\s]/

/** About how wide some lyrics are, in letters */
function lyricsWidth(text: string): number {
  let width = 0
  for (const char of text) width += /\s/.test(char) ? 0.35 : NARROW.test(char) ? 0.45 : 1
  return width
}

/** About how wide a chord is, in letters: bold, and with its padding */
function chordWidth(chord: string): number {
  let width = chord ? 0.5 : 0
  for (const char of chord) width += NARROW.test(char) ? 0.5 : /[A-G]/.test(char) ? 1.1 : 0.9
  return width
}

/**
 * A chord is as wide as it is, whatever it is over: one wider than the words under it pushes what
 * follows away. Give it more words to sit over (up to the next chord) until they are as wide.
 */
function giveChordsRoom(units: ChartSegment[][]): ChartSegment[][] {
  const result: ChartSegment[][] = []
  for (let index = 0; index < units.length; index++) {
    const unit = [...units[index]]
    const chords = unit.reduce((sum, piece) => sum + chordWidth(piece.chord), 0)
    let words = unit.reduce((sum, piece) => sum + lyricsWidth(piece.lyrics), 0)
    while (words < chords && index + 1 < units.length && !units[index + 1][0].chord) {
      index++
      for (const piece of units[index]) {
        unit.push(piece)
        words += lyricsWidth(piece.lyrics)
      }
    }
    result.push(unit)
  }
  return result
}
