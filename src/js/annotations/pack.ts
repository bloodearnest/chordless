/**
 * Where annotations go along a line so they do not run off its edge or into each other (docs/ANNOTATIONS.md).
 * Pure: the boxes are measured by the caller, which then moves the annotations. An annotation sits where its
 * word is if it can; else it is pushed along, then back from the edge; if the row has no room for
 * all of them, the rest go in a row above.
 */

/** An annotation as measured: where it would start, along the line, and how wide it is (pixels) */
export interface AnnotationBox {
  x: number
  w: number
}

export interface AnnotationPlace {
  x: number
  /** 0 is the row next to the chord; each above it is one more */
  row: number
  /** Wider than the line: it is set in the line's width, over more lines */
  wrap: boolean
}

/** Positions for the boxes of one row in order, or null if they do not fit in `width` together */
function fitRow(boxes: AnnotationBox[], width: number, gap: number): number[] | null {
  const total = boxes.reduce((sum, box) => sum + box.w, 0) + gap * Math.max(boxes.length - 1, 0)
  if (total > width) return null
  const xs: number[] = []
  // pushed along from the left...
  boxes.forEach((box, i) => {
    const wanted = Math.max(box.x, 0)
    xs.push(
      i ? Math.max(wanted, (xs[i - 1] as number) + (boxes[i - 1] as AnnotationBox).w + gap) : wanted
    )
  })
  // ...then back from the right edge
  for (let i = boxes.length - 1; i >= 0; i--) {
    const limit = i === boxes.length - 1 ? width : (xs[i + 1] as number) - gap
    xs[i] = Math.min(xs[i] as number, limit - (boxes[i] as AnnotationBox).w)
  }
  return xs
}

export function packAnnotations(
  boxes: AnnotationBox[],
  width: number,
  gap: number
): AnnotationPlace[] {
  const order = boxes
    .map((_, i) => i)
    .sort((a, b) => (boxes[a] as AnnotationBox).x - (boxes[b] as AnnotationBox).x)
  const rows: number[][] = []
  const result: AnnotationPlace[] = []
  for (const index of order) {
    const box = boxes[index] as AnnotationBox
    if (box.w > width) {
      // Alone in a row of its own, in the line's width
      rows.push([index])
      result[index] = { x: 0, row: rows.length - 1, wrap: true }
      continue
    }
    let row = rows.findIndex(
      members =>
        !members.some(member => result[member]?.wrap) &&
        fitRow(
          [...members, index].map(i => boxes[i] as AnnotationBox),
          width,
          gap
        )
    )
    if (row < 0) {
      rows.push([])
      row = rows.length - 1
    }
    ;(rows[row] as number[]).push(index)
    result[index] = { x: 0, row, wrap: false }
  }
  rows.forEach((members, row) => {
    if (members.some(member => result[member]?.wrap)) return
    const xs = fitRow(
      members.map(i => boxes[i] as AnnotationBox),
      width,
      gap
    ) as number[]
    members.forEach((member, at) => {
      result[member] = { x: xs[at] as number, row, wrap: false }
    })
  })
  return result
}

// ==================== On the chord row ====================

/** What is on one wrapped row of a line, as measured (pixels along the line) */
export type RowItem =
  /** A chord, where it is and how wide its text is; `segment` says which piece of the line it is over */
  | { kind: 'chord'; x: number; w: number; segment: number }
  /** An annotation, where its word is and how wide it is */
  | { kind: 'annotation'; x: number; w: number }

export interface RowPlacement {
  /** How far the annotation moves from where its word is (negative: left) */
  shift: number
  /** The chords after it are pushed right by this much, by room after the piece before this chord's */
  push?: { segment: number; amount: number }
  /** 0 is in the chord row; each above it is one more. Only for one that cannot fit the row */
  above: number
  /** Wider than the line: set in the line's width, over more lines */
  wrap: boolean
}

/** A push of more than this fraction of the line is too much to ask of its words: the annotation goes above instead */
const MOST_PUSH = 0.4

/**
 * Where annotations go on a row that has chords (docs/ANNOTATIONS.md): in the row, level with the chords,
 * starting at their word and no nearer than the end of the chord before them. One that would run into
 * the next chord pushes it, and what follows, right by the shortfall (more of the room is for the
 * words). If it cannot be had (it is wider than the line, the push would be too much, or there is no
 * room at the line's end) it goes in a row above. Pure: measured by the caller, which moves things and
 * measures again, since a push can change where the row wraps. Placements are by the index of the
 * annotation in `items` (chords have none).
 */
export function placeOnChordRow(
  items: RowItem[],
  width: number,
  gap: number
): (RowPlacement | undefined)[] {
  const order = items
    .map((_, i) => i)
    .sort((a, b) => {
      const x = (items[a] as RowItem).x - (items[b] as RowItem).x
      if (x) return x
      // (a chord is at its word before an annotation is)
      return (items[a]?.kind === 'chord' ? 0 : 1) - (items[b]?.kind === 'chord' ? 0 : 1) || a - b
    })
  const result: (RowPlacement | undefined)[] = []
  let shift = 0
  let cursor = 0
  let above = 0

  order.forEach((index, at) => {
    const item = items[index] as RowItem
    const here = item.x + shift
    if (item.kind === 'chord') {
      cursor = Math.max(cursor, here + item.w + gap)
      return
    }
    const aboveRow = (wrap: boolean): RowPlacement => {
      above += 1
      return { shift: Math.min(Math.max(here, 0), Math.max(width - item.w, 0)) - here, above, wrap }
    }
    if (item.w > width) {
      result[index] = { ...aboveRow(true), shift: -here }
      return
    }
    let start = Math.max(here, cursor)
    const next = order
      .slice(at + 1)
      .map(i => ({ i, item: items[i] as RowItem }))
      .find(each => each.item.kind === 'chord')
    // At the line's end, with nothing after to push: back from the edge, if the chord before allows
    if (!next && start + item.w > width) {
      start = Math.max(cursor, width - item.w)
      if (start + item.w > width) {
        result[index] = aboveRow(false)
        return
      }
    }
    let push: RowPlacement['push']
    if (next && next.item.kind === 'chord') {
      const room = next.item.x + shift
      const short = start + item.w + gap - room
      if (short > 0) {
        if (short > width * MOST_PUSH || start + item.w > width) {
          result[index] = aboveRow(false)
          return
        }
        push = { segment: next.item.segment, amount: short }
        shift += short
      }
    }
    cursor = start + item.w + gap
    result[index] = { shift: start - here, push, above: 0, wrap: false }
  })
  return result
}
