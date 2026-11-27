/**
 * The ways the speed test draws a setlist (docs/SPEED_TEST.md). The same made-up songs, so that what
 * differs between two is the way of drawing them, and the difference says where the time goes:
 *
 * - `real`: as Chordless draws a setlist: a `song-display` for each song, a `song-section` for each
 *   section, a `chord-display` for each chord. Lit components, each with a shadow root of its own.
 * - `lyrics`: the same components, with the chords left off the songs: the cost of the chords.
 * - `plain`: the same words and chords as ordinary elements, with the same sizes and layout, and no
 *   custom elements at all: the cost of the text itself, with none of the components'.
 */
import '../../components/song-display.ts'
import type { ChartLine, ParsedChart } from '../data-types.ts'

export type VariantId = 'real' | 'lyrics' | 'plain'

export interface Variant {
  id: VariantId
  /** Whether the songs it draws have their chords (the runner makes the songs, so that making them is not timed) */
  chords: boolean
  /** Put the songs in the stage */
  draw(stage: HTMLElement, charts: ParsedChart[]): void
}

function drawComponents(stage: HTMLElement, charts: ParsedChart[]): void {
  const songs = document.createDocumentFragment()
  charts.forEach((parsed, index) => {
    const song = document.createElement('song-display')
    song.songIndex = index
    song.parsed = parsed
    songs.append(song)
  })
  stage.append(songs)
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const made = document.createElement(tag)
  made.className = className
  if (text !== undefined) made.textContent = text
  return made
}

/** A line as the section draws it: a unit for each piece, which holds the chord over its words */
function plainLine(line: ChartLine): HTMLElement {
  const row = element('div', 'chord-line')
  const hasChords = line.segments.some(segment => segment.chord)
  for (const segment of line.segments) {
    const unit = element('span', 'chord-unit')
    const piece = element('span', 'chord-segment')
    if (hasChords) {
      const chord = element('span', segment.chord ? 'chord' : 'chord chord-empty')
      chord.append(element('span', 'chord-text', segment.chord || ' '))
      piece.append(chord)
    }
    piece.append(element('span', 'lyrics', segment.lyrics))
    unit.append(piece)
    row.append(unit)
  }
  return row
}

function drawPlain(stage: HTMLElement, charts: ParsedChart[]): void {
  const songs = document.createDocumentFragment()
  for (const chart of charts) {
    const song = element('div', 'plain-song')
    for (const section of chart.sections) {
      const block = element('div', 'plain-section')
      block.append(element('h3', 'section-title', section.label ?? ''))
      for (const line of section.lines) block.append(plainLine(line))
      song.append(block)
    }
    songs.append(song)
  }
  stage.append(songs)
}

/** The three, in the order they are timed */
export const VARIANTS: Variant[] = [
  { id: 'real', chords: true, draw: drawComponents },
  { id: 'lyrics', chords: false, draw: drawComponents },
  { id: 'plain', chords: true, draw: drawPlain },
]
