/**
 * A lead sheet as a PDF, drawn the way SongSelect draws one (the staff lines, and every notehead,
 * sharp and flat a shape in the page's drawing, not text), for melody-range.node.test.ts. The real
 * ones are CCLI's, which the repository does not keep.
 */

export interface SheetNote {
  /** Letter, octave and, for the tests of what the key signature does, nothing else: 'F5' */
  pitch: string
  /** Sung (the default), a ring (minim or semibreve) or instrumental: a small head */
  head?: 'solid' | 'ring' | 'cue'
}

export interface SheetStaff {
  /** Sharps (positive) or flats (negative) in the key signature */
  key?: number
  notes: SheetNote[]
  /** A sharp drawn right before the first note, as an accidental on that note, not the key */
  accidentalOnFirstNote?: boolean
}

export interface SheetOptions {
  /** The pages, each with its staves from the top */
  pages: SheetStaff[][]
  /** The size of a staff space in points (4.6 in SongSelect's) */
  space?: number
}

const LETTERS = 'CDEFGAB'

/** Steps above the bottom line of a treble staff (E4) for a pitch like 'D4' or 'A5' */
function steps(pitch: string): number {
  const place = LETTERS.indexOf(pitch[0]) + 7 * Number(pitch.slice(1))
  return place - (LETTERS.indexOf('E') + 7 * 4)
}

/** A page's content, in tenths of a point under a `0.1 cm`, as the real sheets have it */
const number = (value: number) => (value * 10).toFixed(1)

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5523
  const [a, b] = [rx * k, ry * k]
  return [
    `${number(cx + rx)} ${number(cy)} m`,
    `${number(cx + rx)} ${number(cy + b)} ${number(cx + a)} ${number(cy + ry)} ${number(cx)} ${number(cy + ry)} c`,
    `${number(cx - a)} ${number(cy + ry)} ${number(cx - rx)} ${number(cy + b)} ${number(cx - rx)} ${number(cy)} c`,
    `${number(cx - rx)} ${number(cy - b)} ${number(cx - a)} ${number(cy - ry)} ${number(cx)} ${number(cy - ry)} c`,
    `${number(cx + a)} ${number(cy - ry)} ${number(cx + rx)} ${number(cy - b)} ${number(cx + rx)} ${number(cy)} c`,
  ].join('\n')
}

/** The points round the outside of a box, corners first: a sharp's, and a flat's, outline */
function outline(cx: number, cy: number, width: number, height: number, count: number): string[] {
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
  const points = corners.map(([x, y]) => [cx + (x * width) / 2, cy + (y * height) / 2])
  for (let i = 4; i < count; i++) {
    const [x, y] = points[i % 4]
    points.push([x, y + ((i % 2 ? 1 : -1) * height) / 40])
  }
  return points.map(([x, y]) => `${number(x)} ${number(y)}`)
}

/** A sharp is straight lines; a flat has curves */
function accidental(cx: number, cy: number, space: number, sharp: boolean): string {
  if (sharp) {
    const [first, ...rest] = outline(cx, cy, 0.79 * space, 2.79 * space, 10)
    return `${first} m\n${rest.map(point => `${point} l`).join('\n')}\nh f`
  }
  const [first, ...rest] = outline(cx, cy, 0.8 * space, 2.59 * space, 11)
  return `${first} m\n${rest.map(point => `${point} ${point} ${point} c`).join('\n')}\nh f`
}

function staffContent(staff: SheetStaff, bottom: number, space: number): string {
  const out: string[] = []
  for (let line = 0; line < 5; line++) {
    const y = number(bottom + line * space)
    // drawn in two pieces, as a system's staff is
    out.push(
      `${number(50)} ${y} m ${number(280)} ${y} l S`,
      `${number(280)} ${y} m ${number(500)} ${y} l S`
    )
  }
  const count = Math.abs(staff.key ?? 0)
  for (let i = 0; i < count; i++) {
    out.push(accidental(70 + i * 1.09 * space, bottom + 2 * space, space, (staff.key ?? 0) > 0))
  }
  // the clef, a tall shape no notehead or accidental is like
  out.push(`${ellipse(62, bottom + 2 * space, 1.3 * space, 3.5 * space)} h f`)
  staff.notes.forEach((note, index) => {
    const x = 140 + index * 30
    const y = bottom + (steps(note.pitch) * space) / 2
    const head = note.head ?? 'solid'
    if (index === 0 && staff.accidentalOnFirstNote) out.push(accidental(x - 8, y, space, true))
    if (head === 'cue') {
      out.push(`${ellipse(x, y, 0.475 * space, 0.4 * space)} h f`)
    } else if (head === 'ring') {
      out.push(
        `${ellipse(x, y, 0.63 * space, 0.53 * space)}\n${ellipse(x, y, 0.45 * space, 0.3 * space)}\nh f*`
      )
    } else {
      out.push(`${ellipse(x, y, 0.63 * space, 0.53 * space)} h f`)
    }
    // a stem, and the stroke of a bar line: strokes that are not staff lines
    out.push(`${number(x + 3)} ${number(y)} m ${number(x + 3)} ${number(y + 3 * space)} l S`)
  })
  return out.join('\n')
}

export function leadSheetPdf({ pages, space = 4.6 }: SheetOptions): ArrayBuffer {
  const contents = pages.map(staves => {
    const body = staves
      .map((staff, index) => staffContent(staff, 700 - index * 12 * space, space))
      .join('\n')
    return `q 0.1 0 0 0.1 0 0 cm\n0.3 w\n${body}\nQ`
  })
  // objects: 1 catalog, 2 pages, then a page and its content stream for each, ahead of the last
  const pageObjects = pages.map((_, i) => 3 + i * 2)
  const objects: string[] = [
    '<</Type/Catalog/Pages 2 0 R>>',
    `<</Type/Pages/Kids[${pageObjects.map(n => `${n} 0 R`).join(' ')}]/Count ${pages.length}>>`,
  ]
  contents.forEach((stream, i) => {
    objects.push(
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents ${4 + i * 2} 0 R>>`,
      `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`
    )
  })
  let out = '%PDF-1.4\n'
  const offsets = objects.map((body, index) => {
    const offset = out.length
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out).buffer as ArrayBuffer
}
