/**
 * Moves the annotations on a line to where pack.ts says (docs/ANNOTATIONS.md): measures them where
 * CSS put them (at their word), then sets each one's offset, row and wrap. All reads come before all
 * writes, so a line is laid out a few times, not once per annotation.
 *
 * A line whose chord row is shown (`annotations-on-chords`) has them in that row, after the chord
 * at their word, and pushes the chords after them right where they would not fit. Any other line
 * (chords hidden, or none) has a row of its own above the lyrics.
 */
import {
  type AnnotationBox,
  type AnnotationPlace,
  packAnnotations,
  placeOnChordRow,
  type RowItem,
  type RowPlacement,
} from './pack.ts'

/** Space kept between two annotations, or an annotation and a chord, on a row, in pixels */
const GAP = 8

/** How many times a row is laid out again because pushing changed where it wraps, at the most */
const PASSES = 6

interface Measured {
  el: HTMLElement
  box: AnnotationBox
  /** Where the word's segment starts along the line */
  segmentX: number
  /** The visual row of the line (which wrapped row of lyrics) it is above */
  band: number
}

function reset(el: HTMLElement) {
  el.style.left = ''
  el.style.top = ''
  el.style.bottom = ''
  el.style.width = ''
  el.style.whiteSpace = ''
  el.classList.remove('wrap')
}

/** How many rows of the height made for annotations one takes (more than one when it has wrapped) */
function rowsTaken(el: HTMLElement): number {
  const line = Number.parseFloat(getComputedStyle(el).lineHeight)
  // (the row made for them is a little taller than their line: --annotation-row is 1.1 of the size, a line 1.05)
  return Math.max(1, Math.ceil(el.getBoundingClientRect().height / ((line * 1.1) / 1.05) - 0.05))
}

/** Lay out the annotations of one line that has them, wherever its chord row is or is not */
export function nudgeLine(line: HTMLElement): void {
  if (line.classList.contains('annotations-on-chords')) nudgeChordRow(line)
  else nudgeOwnRow(line)
}

/** A line with no chord row: its annotations have a row of their own above; returns how many rows that needs */
function nudgeOwnRow(line: HTMLElement): number {
  const groups = Array.from(line.querySelectorAll<HTMLElement>('.segment-annotations'))
  for (const el of groups) reset(el)

  const lineRect = line.getBoundingClientRect()
  const measured: Measured[] = groups.map(el => {
    const rect = el.getBoundingClientRect()
    const segment = (el.closest('.chord-segment') as HTMLElement).getBoundingClientRect()
    return {
      el,
      box: { x: rect.left - lineRect.left, w: rect.width },
      segmentX: segment.left - lineRect.left,
      band: Math.round(segment.top),
    }
  })

  // The annotations over one wrapped row of the line are packed together, apart from the others
  const bands = new Map<number, Measured[]>()
  for (const each of measured) bands.set(each.band, [...(bands.get(each.band) ?? []), each])

  const writes: (() => void)[] = []
  const placed: { el: HTMLElement; row: number }[] = []
  for (const members of bands.values()) {
    const places = packAnnotations(
      members.map(each => each.box),
      lineRect.width,
      GAP
    )
    members.forEach((each, i) => {
      const place = places[i] as AnnotationPlace
      placed.push({ el: each.el, row: place.row })
      writes.push(() => {
        each.el.style.left = `${place.x - each.segmentX}px`
        if (place.row) each.el.style.bottom = `calc(100% + ${place.row} * var(--annotation-row))`
        if (place.wrap) {
          each.el.style.width = `${lineRect.width}px`
          each.el.style.whiteSpace = 'normal'
          each.el.classList.add('wrap')
        }
      })
    })
  }
  for (const write of writes) write()
  // (what has wrapped is taller than a row: measured once it is written)
  const rows = Math.max(1, ...placed.map(each => each.row + rowsTaken(each.el)))
  line.style.setProperty('--annotation-rows', String(rows))
  return rows
}

/**
 * A line with a chord row: annotations go in it. Each pass measures the chords and annotations of each
 * wrapped row, places them, and pushes the chords that would be run into; the pushes can change how
 * the row wraps, so it is measured again until nothing needs pushing (or the passes run out).
 */
function nudgeChordRow(line: HTMLElement) {
  const segments = Array.from(line.querySelectorAll<HTMLElement>('.chord-segment'))
  const groups = Array.from(line.querySelectorAll<HTMLElement>('.segment-annotations'))
  for (const el of groups) reset(el)
  for (const segment of segments) segment.style.paddingRight = ''

  let writes: (() => void)[] = []
  let above: { el: HTMLElement; row: number }[] = []
  for (let pass = 0; pass < PASSES; pass++) {
    writes = []
    above = []
    const pushes = new Map<number, number>()
    const lineRect = line.getBoundingClientRect()

    // What is where, by wrapped row of the line
    const bands = new Map<number, { items: RowItem[]; els: (HTMLElement | undefined)[] }>()
    const band = (top: number) => {
      const key = Math.round(top)
      const found = bands.get(key) ?? { items: [], els: [] }
      bands.set(key, found)
      return found
    }
    segments.forEach((segment, index) => {
      const chord = segment.querySelector<HTMLElement>('.chord:not(.chord-empty)')
      if (!chord) return
      // (the text itself: a chord over words that go on has no width of its own)
      const text = (chord.querySelector('chord-display') as Element).getBoundingClientRect()
      const here = band(segment.getBoundingClientRect().top)
      here.items.push({
        kind: 'chord',
        x: text.left - lineRect.left,
        w: text.width,
        segment: index,
      })
      here.els.push(undefined)
    })
    for (const el of groups) {
      const segment = el.closest('.chord-segment') as HTMLElement
      const segmentRect = segment.getBoundingClientRect()
      const rect = el.getBoundingClientRect()
      const here = band(segmentRect.top)
      here.items.push({ kind: 'annotation', x: segmentRect.left - lineRect.left, w: rect.width })
      here.els.push(el)
    }

    for (const { items, els } of bands.values()) {
      const places = placeOnChordRow(items, lineRect.width, GAP)
      places.forEach((place, i) => {
        // (only annotations have a placement: forEach skips the holes the chords leave)
        const { above: row, push, shift, wrap } = place as RowPlacement
        const el = els[i] as HTMLElement
        if (row) above.push({ el, row })
        if (push) pushes.set(push.segment, (pushes.get(push.segment) ?? 0) + push.amount)
        writes.push(() => {
          el.style.left = `${shift}px`
          if (row) {
            el.style.top = 'auto'
            el.style.bottom = `calc(100% + ${row - 1} * var(--annotation-row))`
          }
          if (wrap) {
            el.style.width = `${lineRect.width}px`
            el.style.whiteSpace = 'normal'
            el.classList.add('wrap')
          }
        })
      })
    }
    if (!pushes.size) break
    // Room for the annotation is made after the piece before the chord it would run into
    for (const [chordSegment, amount] of pushes) {
      const before = segments[chordSegment - 1]
      if (before)
        before.style.paddingRight = `${Number.parseFloat(before.style.paddingRight || '0') + amount}px`
    }
  }
  for (const write of writes) write()
  // The rows above the chord row it needs: those above, and the lines of one that has wrapped
  const needed = Math.max(0, ...above.map(each => each.row - 1 + rowsTaken(each.el)))
  if (needed) line.style.setProperty('--annotation-above', String(needed))
  else line.style.removeProperty('--annotation-above')
}
