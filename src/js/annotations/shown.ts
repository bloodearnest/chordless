/**
 * Annotations as they are drawn on a chart (docs/ANNOTATIONS.md): each placed on the section or the spot in
 * a line it belongs to, and put into the lines as segments that carry them, so the layout that
 * handles chords handles annotations with the same pieces.
 */
import type { ChartLine, ChartSection, ChartSegment, ShownAnnotation } from '../data-types.ts'
import { type PlacedAnnotation, placeAnnotations } from './anchor.ts'
import { type AnnotationSources, allAnnotations } from './store.ts'

/** Which annotations to draw (a preference: both are drawn when editing) */
export interface AnnotationVisibility {
  shared: boolean
  mine: boolean
}

export interface LineAnnotation {
  line: number
  offset: number
  annotation: ShownAnnotation
}

export interface SectionAnnotations {
  /** On the section's title */
  title: ShownAnnotation[]
  /** At a spot in a line */
  lines: LineAnnotation[]
}

export interface ChartAnnotations {
  sections: SectionAnnotations[]
  /** For the song as a whole, and those whose place on the chart is gone (the latter marked) */
  song: (ShownAnnotation & { orphan?: boolean })[]
}

/** The annotations of every kind for a song, placed on its sections */
export function annotationsBySection(
  sections: ChartSection[],
  sources: AnnotationSources,
  visible: AnnotationVisibility = { shared: true, mine: true }
): ChartAnnotations {
  const kept = allAnnotations(sources).filter(({ kind }) =>
    kind.reach === 'shared' ? visible.shared : visible.mine
  )
  const shownBy = new Map<string, ShownAnnotation>()
  const texts = kept.flatMap(({ annotation, kind }) => {
    // (a drawing is not drawn yet)
    if (annotation.body.kind !== 'text') return []
    shownBy.set(annotation.id, {
      id: annotation.id,
      text: annotation.body.text,
      shared: kind.reach === 'shared',
    })
    return [annotation]
  })
  const result: ChartAnnotations = {
    sections: sections.map(() => ({ title: [], lines: [] })),
    song: [],
  }
  const place = (placed: PlacedAnnotation) => {
    const annotation = shownBy.get(placed.annotation.id) as ShownAnnotation
    const { placement } = placed
    if (placement.place === 'song') result.song.push(annotation)
    else if (placement.place === 'orphan') result.song.push({ ...annotation, orphan: true })
    else if (placement.place === 'section')
      result.sections[placement.section]?.title.push(annotation)
    else
      result.sections[placement.section]?.lines.push({
        line: placement.line,
        offset: placement.offset,
        annotation,
      })
  }
  for (const placed of placeAnnotations(sections, texts)) place(placed)
  return result
}

/**
 * The lines with their annotations put in: a segment is cut where a annotation falls inside it, and the piece
 * that starts there carries the annotation. Lines without annotations are the same objects as before; the
 * rest are new, so the parsed chart is not changed.
 */
export function attachAnnotations(lines: ChartLine[], annotations: LineAnnotation[]): ChartLine[] {
  if (!annotations.length) return lines
  return lines.map((line, index) => {
    const here = annotations.filter(each => each.line === index)
    return here.length ? { segments: attachToSegments(line.segments, here) } : line
  })
}

function attachToSegments(segments: ChartSegment[], annotations: LineAnnotation[]): ChartSegment[] {
  if (!segments.length)
    return [{ chord: '', lyrics: '', annotations: annotations.map(each => each.annotation) }]
  const claimed = new Set<LineAnnotation>()
  const out: ChartSegment[] = []
  let start = 0
  segments.forEach((segment, at) => {
    const { lyrics } = segment
    const end = start + lyrics.length
    const last = at === segments.length - 1
    // A annotation belongs to the segment it starts in; one at the line's end, or past it, to the last
    const mine = annotations.filter(
      each =>
        !claimed.has(each) &&
        each.offset >= start &&
        (each.offset < end || each.offset === start || last)
    )
    for (const each of mine) claimed.add(each)
    const local = (each: LineAnnotation) => Math.min(each.offset - start, lyrics.length)
    const starts = [...new Set([0, ...mine.map(local)])].sort((a, b) => a - b)
    starts.forEach((from, piece) => {
      const carried = mine.filter(each => local(each) === from).map(each => each.annotation)
      const text = lyrics.slice(from, starts[piece + 1] ?? lyrics.length)
      const base = piece === 0 ? { ...segment, lyrics: text } : { chord: '', lyrics: text }
      out.push(
        carried.length
          ? { ...base, annotations: [...(segment.annotations ?? []), ...carried] }
          : base
      )
    })
    start = end
  })
  return out
}
