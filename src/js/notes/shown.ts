/**
 * Notes as they are drawn on a chart (docs/NOTES.md): each placed on the section or the spot in
 * a line it belongs to, and put into the lines as segments that carry them, so the layout that
 * handles chords handles notes with the same pieces.
 */
import type { ChartLine, ChartSection, ChartSegment, ShownNote } from '../data-types.ts'
import { type PlacedNote, placeNotes } from './anchor.ts'
import { allNotes, type NoteSources } from './store.ts'

/** Which notes to draw (a preference: both are drawn when editing) */
export interface NoteVisibility {
  shared: boolean
  mine: boolean
}

export interface LineNote {
  line: number
  offset: number
  note: ShownNote
}

export interface SectionNotes {
  /** On the section's title */
  title: ShownNote[]
  /** At a spot in a line */
  lines: LineNote[]
}

export interface ChartNotes {
  sections: SectionNotes[]
  /** For the song as a whole, and those whose place on the chart is gone (the latter marked) */
  song: (ShownNote & { orphan?: boolean })[]
}

/** The notes of every kind for a song, placed on its sections */
export function notesBySection(
  sections: ChartSection[],
  sources: NoteSources,
  visible: NoteVisibility = { shared: true, mine: true }
): ChartNotes {
  const kept = allNotes(sources).filter(({ kind }) => (kind.reach === 'shared' ? visible.shared : visible.mine))
  const shownBy = new Map<string, ShownNote>()
  const texts = kept.flatMap(({ note, kind }) => {
    // (a drawing is not drawn yet)
    if (note.body.kind !== 'text') return []
    shownBy.set(note.id, { id: note.id, text: note.body.text, shared: kind.reach === 'shared' })
    return [note]
  })
  const result: ChartNotes = { sections: sections.map(() => ({ title: [], lines: [] })), song: [] }
  const place = (placed: PlacedNote) => {
    const note = shownBy.get(placed.note.id) as ShownNote
    const { placement } = placed
    if (placement.place === 'song') result.song.push(note)
    else if (placement.place === 'orphan') result.song.push({ ...note, orphan: true })
    else if (placement.place === 'section') result.sections[placement.section]?.title.push(note)
    else result.sections[placement.section]?.lines.push({ line: placement.line, offset: placement.offset, note })
  }
  for (const placed of placeNotes(sections, texts)) place(placed)
  return result
}

/**
 * The lines with their notes put in: a segment is cut where a note falls inside it, and the piece
 * that starts there carries the note. Lines without notes are the same objects as before; the
 * rest are new, so the parsed chart is not changed.
 */
export function attachNotes(lines: ChartLine[], notes: LineNote[]): ChartLine[] {
  if (!notes.length) return lines
  return lines.map((line, index) => {
    const here = notes.filter(each => each.line === index)
    return here.length ? { segments: attachToSegments(line.segments, here) } : line
  })
}

function attachToSegments(segments: ChartSegment[], notes: LineNote[]): ChartSegment[] {
  if (!segments.length) return [{ chord: '', lyrics: '', notes: notes.map(each => each.note) }]
  const claimed = new Set<LineNote>()
  const out: ChartSegment[] = []
  let start = 0
  segments.forEach((segment, at) => {
    const { lyrics } = segment
    const end = start + lyrics.length
    const last = at === segments.length - 1
    // A note belongs to the segment it starts in; one at the line's end, or past it, to the last
    const mine = notes.filter(
      each =>
        !claimed.has(each) &&
        each.offset >= start &&
        (each.offset < end || each.offset === start || last)
    )
    for (const each of mine) claimed.add(each)
    const local = (each: LineNote) => Math.min(each.offset - start, lyrics.length)
    const starts = [...new Set([0, ...mine.map(local)])].sort((a, b) => a - b)
    starts.forEach((from, piece) => {
      const carried = mine.filter(each => local(each) === from).map(each => each.note)
      const text = lyrics.slice(from, starts[piece + 1] ?? lyrics.length)
      const base = piece === 0 ? { ...segment, lyrics: text } : { chord: '', lyrics: text }
      out.push(carried.length ? { ...base, notes: [...(segment.notes ?? []), ...carried] } : base)
    })
    start = end
  })
  return out
}
