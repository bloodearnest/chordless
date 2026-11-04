/**
 * Where a note sits on a chart, and finding that place again (docs/NOTES.md). An anchor names a
 * section by label and a spot by the lyrics around it, so it holds across transposing, hidden
 * chords and screen sizes; if the chart changed under it, the text around it is searched for, and
 * a note that cannot be placed is orphaned, never dropped.
 */
import type { ChartNote, ChartSection, NoteAnchor } from '../data-types.ts'

/** How many characters of lyrics either side of a spot an anchor remembers */
const CONTEXT = 12

/** The lyrics of a line as one string, chords left out */
export function lineLyrics(section: ChartSection, line: number): string {
  return section.lines[line]?.segments.map((s) => s.lyrics).join('') ?? ''
}

function nthOfLabel(sections: ChartSection[], index: number): number {
  const label = (sections[index] as ChartSection).label
  let nth = 0
  for (let i = 0; i < index; i++) if ((sections[i] as ChartSection).label === label) nth++
  return nth
}

function findSection(sections: ChartSection[], label: string | null, nth: number): number {
  let seen = 0
  for (let i = 0; i < sections.length; i++) {
    if ((sections[i] as ChartSection).label !== label) continue
    if (seen === nth) return i
    seen++
  }
  return -1
}

/** The anchor for a section's title */
export function sectionAnchor(sections: ChartSection[], section: number): NoteAnchor {
  return {
    kind: 'section',
    label: (sections[section] as ChartSection).label,
    nth: nthOfLabel(sections, section),
  }
}

/** The anchor for a spot `offset` characters into a line's lyrics */
export function textAnchor(sections: ChartSection[], section: number, line: number, offset: number): NoteAnchor {
  const text = lineLyrics(sections[section] as ChartSection, line)
  const at = Math.max(0, Math.min(offset, text.length))
  return {
    kind: 'text',
    label: (sections[section] as ChartSection).label,
    nth: nthOfLabel(sections, section),
    line,
    offset: at,
    before: text.slice(Math.max(0, at - CONTEXT), at),
    after: text.slice(at, at + CONTEXT),
  }
}

/**
 * The nearest place in a line a note can sensibly start, to an approximate offset: the start of a
 * word, or of a segment (where a chord is). Offsets worked out from lyrics as drawn (with the
 * chords hidden, hyphens and spaces are folded) can be a few characters off the chart's own.
 */
export function snapOffset(section: ChartSection, line: number, approx: number): number {
  const text = lineLyrics(section, line)
  const starts = new Set<number>([0])
  let at = 0
  for (const segment of section.lines[line]?.segments ?? []) {
    starts.add(at)
    at += segment.lyrics.length
  }
  for (let i = 1; i < text.length; i++) {
    if (/\S/.test(text[i] as string) && /[\s-]/.test(text[i - 1] as string)) starts.add(i)
  }
  let best = 0
  for (const start of starts) {
    if (Math.abs(start - approx) < Math.abs(best - approx)) best = start
  }
  return Math.min(best, text.length)
}

/** Where a note has been placed on the chart as it is now */
export type Placement =
  | { place: 'song' }
  | { place: 'section'; section: number }
  | { place: 'text'; section: number; line: number; offset: number }
  /** Its place is gone from the chart: shown with the song's notes, marked */
  | { place: 'orphan' }

type TextAnchor = Extract<NoteAnchor, { kind: 'text' }>

/** Whether `anchor` still reads true at `offset` of `text` */
function holdsAt(text: string, offset: number, anchor: TextAnchor): boolean {
  return (
    offset <= text.length &&
    text.slice(Math.max(0, offset - anchor.before.length), offset) === anchor.before &&
    text.slice(offset, offset + anchor.after.length) === anchor.after
  )
}

/** Searches one section's lines for the anchor's text, the line nearest the old one first */
function searchSection(section: ChartSection, sectionIndex: number, anchor: TextAnchor): Placement | null {
  const wanted = anchor.before + anchor.after
  if (!wanted) return null
  const lines = section.lines.map((_, i) => i).sort((a, b) => Math.abs(a - anchor.line) - Math.abs(b - anchor.line))
  for (const line of lines) {
    const at = lineLyrics(section, line).indexOf(wanted)
    if (at >= 0) return { place: 'text', section: sectionIndex, line, offset: at + anchor.before.length }
  }
  return null
}

export function resolveAnchor(sections: ChartSection[], anchor: NoteAnchor): Placement {
  if (anchor.kind === 'song') return { place: 'song' }
  const found = findSection(sections, anchor.label, anchor.nth)
  if (anchor.kind === 'section') return found >= 0 ? { place: 'section', section: found } : { place: 'orphan' }

  const section = sections[found]
  if (section) {
    const text = lineLyrics(section, anchor.line)
    if (anchor.line < section.lines.length && holdsAt(text, anchor.offset, anchor)) {
      return { place: 'text', section: found, line: anchor.line, offset: anchor.offset }
    }
    const here = searchSection(section, found, anchor)
    if (here) return here
  }
  // Moved to another section, or the section is gone: look through the whole chart
  for (let i = 0; i < sections.length; i++) {
    if (i === found) continue
    const there = searchSection(sections[i] as ChartSection, i, anchor)
    if (there) return there
  }
  return section ? { place: 'section', section: found } : { place: 'orphan' }
}

export interface PlacedNote {
  note: ChartNote
  placement: Placement
}

export function placeNotes(sections: ChartSection[], notes: ChartNote[]): PlacedNote[] {
  return notes.map((note) => ({ note, placement: resolveAnchor(sections, note.anchor) }))
}
