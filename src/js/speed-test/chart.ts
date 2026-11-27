/**
 * The songs the speed test draws (docs/SPEED_TEST.md): made up, so that nothing of anyone's is in a
 * result, and the same on every device and every run (no randomness), so that two devices are
 * timed on the same work. Each is about the size of a real chart: four sections of six lines, eight
 * words to a line, and a chord over every other word.
 */
import type { ChartLine, ChartSection, ParsedChart } from '../data-types.ts'

/** Words with a shape like lyrics: short and long, so the lines wrap where a real chart's would */
const WORDS = [
  'holy',
  'is',
  'the',
  'lord',
  'almighty',
  'who',
  'was',
  'and',
  'is',
  'to',
  'come',
  'we',
  'lift',
  'our',
  'voices',
  'high',
  'your',
  'mercy',
  'never',
  'fails',
  'us',
  'every',
  'morning',
  'brings',
  'new',
  'glory',
  'forever',
  'amen',
]

/** A progression with the kinds of chord a worship chart has: slashes, sevenths, added notes */
const CHORDS = ['G', 'D/F#', 'Em7', 'Cadd9', 'G/B', 'Am7', 'D', 'C']

const SECTIONS = ['Verse 1', 'Chorus', 'Verse 2', 'Bridge']
const LINES_PER_SECTION = 6
const WORDS_PER_LINE = 8

export interface SyntheticOptions {
  /** Whether the chords are on the lines (lyrics only without) */
  chords: boolean
}

function line(song: number, section: number, row: number, chords: boolean): ChartLine {
  const start = song * 7 + section * 11 + row * 5
  return {
    segments: Array.from({ length: WORDS_PER_LINE }, (_, word) => ({
      chord: chords && word % 2 === 0 ? (CHORDS[(start + word / 2) % CHORDS.length] as string) : '',
      lyrics: `${WORDS[(start + word * 3) % WORDS.length]} `,
    })),
  }
}

/** The song at this place in the setlist */
export function syntheticChart(index: number, { chords }: SyntheticOptions): ParsedChart {
  const sections: ChartSection[] = SECTIONS.map((label, section) => ({
    type: 'section',
    label,
    lines: Array.from({ length: LINES_PER_SECTION }, (_, row) => line(index, section, row, chords)),
  }))
  return { metadata: { title: `Test song ${index + 1}`, key: 'G' }, sections }
}

/** A setlist of this many songs */
export function syntheticSetlist(songs: number, options: SyntheticOptions): ParsedChart[] {
  return Array.from({ length: songs }, (_, index) => syntheticChart(index, options))
}
