/**
 * Moves the notes on a line to where pack.ts says (docs/NOTES.md): measures them where CSS put
 * them (above their word), then sets each one's offset, row and wrap. All reads come before all
 * writes, so a line is laid out twice, not once per note.
 */
import { type NoteBox, type NotePlace, packNotes } from './pack.ts'

/** Space kept between two notes on a row, in pixels */
const GAP = 8

interface Measured {
  el: HTMLElement
  box: NoteBox
  /** Where the word's segment starts along the line */
  segmentX: number
  /** The visual row of the line (which wrapped row of lyrics) it is above */
  band: number
}

function reset(el: HTMLElement) {
  el.style.left = ''
  el.style.bottom = ''
  el.style.width = ''
  el.style.whiteSpace = ''
}

/** Lay out the notes of one `.chord-line.has-notes`; returns how many rows of notes it needs */
export function nudgeLine(line: HTMLElement): number {
  const groups = Array.from(line.querySelectorAll<HTMLElement>('.segment-notes'))
  for (const el of groups) reset(el)

  const lineRect = line.getBoundingClientRect()
  const measured: Measured[] = groups.map((el) => {
    const rect = el.getBoundingClientRect()
    const segment = (el.closest('.chord-segment') as HTMLElement).getBoundingClientRect()
    return {
      el,
      box: { x: rect.left - lineRect.left, w: rect.width },
      segmentX: segment.left - lineRect.left,
      band: Math.round(segment.top),
    }
  })

  // The notes over one wrapped row of the line are packed together, apart from the others
  const bands = new Map<number, Measured[]>()
  for (const each of measured) bands.set(each.band, [...(bands.get(each.band) ?? []), each])

  let rows = 1
  const writes: (() => void)[] = []
  for (const members of bands.values()) {
    const places = packNotes(
      members.map((each) => each.box),
      lineRect.width,
      GAP
    )
    members.forEach((each, i) => {
      const place = places[i] as NotePlace
      rows = Math.max(rows, place.row + 1)
      writes.push(() => {
        each.el.style.left = `${place.x - each.segmentX}px`
        if (place.row) each.el.style.bottom = `calc(100% + ${place.row} * var(--note-row))`
        if (place.wrap) {
          each.el.style.width = `${lineRect.width}px`
          each.el.style.whiteSpace = 'normal'
        }
      })
    })
  }
  for (const write of writes) write()
  line.style.setProperty('--note-rows', String(rows))
  return rows
}
