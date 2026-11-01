/**
 * Where notes go along a line so they do not run off its edge or into each other (docs/NOTES.md).
 * Pure: the boxes are measured by the caller, which then moves the notes. A note sits where its
 * word is if it can; else it is pushed along, then back from the edge; if the row has no room for
 * all of them, the rest go in a row above.
 */

/** A note as measured: where it would start, along the line, and how wide it is (pixels) */
export interface NoteBox {
  x: number
  w: number
}

export interface NotePlace {
  x: number
  /** 0 is the row next to the chord; each above it is one more */
  row: number
  /** Wider than the line: it is set in the line's width, over more lines */
  wrap: boolean
}

/** Positions for the boxes of one row in order, or null if they do not fit in `width` together */
function fitRow(boxes: NoteBox[], width: number, gap: number): number[] | null {
  const total = boxes.reduce((sum, box) => sum + box.w, 0) + gap * Math.max(boxes.length - 1, 0)
  if (total > width) return null
  const xs: number[] = []
  // pushed along from the left...
  boxes.forEach((box, i) => {
    const wanted = Math.max(box.x, 0)
    xs.push(i ? Math.max(wanted, (xs[i - 1] as number) + (boxes[i - 1] as NoteBox).w + gap) : wanted)
  })
  // ...then back from the right edge
  for (let i = boxes.length - 1; i >= 0; i--) {
    const limit = i === boxes.length - 1 ? width : (xs[i + 1] as number) - gap
    xs[i] = Math.min(xs[i] as number, limit - (boxes[i] as NoteBox).w)
  }
  return xs
}

export function packNotes(boxes: NoteBox[], width: number, gap: number): NotePlace[] {
  const order = boxes.map((_, i) => i).sort((a, b) => (boxes[a] as NoteBox).x - (boxes[b] as NoteBox).x)
  const rows: number[][] = []
  const result: NotePlace[] = []
  for (const index of order) {
    const box = boxes[index] as NoteBox
    if (box.w > width) {
      // Alone in a row of its own, in the line's width
      rows.push([index])
      result[index] = { x: 0, row: rows.length - 1, wrap: true }
      continue
    }
    let row = rows.findIndex(
      (members) =>
        !members.some((member) => result[member]?.wrap) &&
        fitRow([...members, index].map((i) => boxes[i] as NoteBox), width, gap)
    )
    if (row < 0) {
      rows.push([])
      row = rows.length - 1
    }
    ;(rows[row] as number[]).push(index)
    result[index] = { x: 0, row, wrap: false }
  }
  rows.forEach((members, row) => {
    if (members.some((member) => result[member]?.wrap)) return
    const xs = fitRow(members.map((i) => boxes[i] as NoteBox), width, gap) as number[]
    members.forEach((member, at) => {
      result[member] = { x: xs[at] as number, row, wrap: false }
    })
  })
  return result
}
