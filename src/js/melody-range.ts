/**
 * The range of the tune in a SongSelect lead sheet (the PDF): its lowest and highest sung note.
 * ChordPro has no melody, but the lead sheet does, so this reads it from the page.
 *
 * The notes in these PDFs are not text. They are drawn shapes, each placed on the page, so this
 * walks the page's drawing operations (pdf.js, through unpdf) and reads the music from the shapes:
 *
 * - the staves are the runs of five long horizontal lines;
 * - a notehead is an ellipse the height of a staff space (filled, or a ring for a minim or
 *   semibreve). Its height above the bottom line gives the note's place on the staff, and the
 *   sheet's treble clef gives that place a letter and an octave;
 * - small noteheads are instrumental lines (the intro, a turnaround), not sung, so they do not
 *   count. Sizes are measured in staff spaces, so a sheet drawn bigger or smaller reads the same;
 * - the sharps or flats between the clef and the first note of a staff are its key signature.
 *
 * It reads the sheet, not the song as sung: an accidental on a single note is not read, a bass
 * clef is not expected, and a harmony line would count. The numbers are the pitch the sheet is
 * printed in (SongSelect prints a key per download): transposing the song moves them with it.
 *
 * A PDF that cannot be read, or has no music in it, gives null.
 */
import { getDocumentProxy, getResolvedPDFJS } from 'unpdf'
import type { NoteRange } from './voice-range.ts'

type Matrix = [number, number, number, number, number, number]

/** What pdf.js hands over for a path: the paint operation, the path, and its bounding box */
type PathArgs = [paint: number, paths: ArrayLike<number>[], box: ArrayLike<number>]

/** A drawn shape: its path and box in the units it was drawn in, and the matrix that puts them on the page */
interface Shape {
  paint: number
  path: ArrayLike<number>
  box: ArrayLike<number>
  matrix: Matrix
}

interface Staff {
  /** y of the bottom line: the page's y goes up, so higher notes have a larger y */
  bottom: number
  space: number
  /** x where the staff starts, which is where its clef and key signature are */
  left: number
}

/** A piece of a staff line */
interface Line {
  y: number
  left: number
}

interface Head {
  x: number
  y: number
}

interface Accidental {
  x: number
  y: number
  sharp: boolean
}

/** Pitch class of the white notes, by letter from C */
const SEMITONES = [0, 2, 4, 5, 7, 9, 11]
/** The letters (0 is C) that the key signature's sharps, and its flats, fall on, in order */
const SHARP_LETTERS = [3, 0, 4, 1, 5, 2, 6]
const FLAT_LETTERS = [6, 2, 5, 1, 4, 0, 3]

/** The letter number of the bottom line of a treble staff: E, two white notes above C */
const BOTTOM_LINE_LETTER = 2
/** The octave of that bottom line (E4), the C below it being middle C */
const BOTTOM_LINE_OCTAVE = 4

/** A place on the sheet, to find a note by: the page, and the staff counted from the top of it */
export interface Place {
  page: number
  staff: number
}

/** What was read from a sheet: the range, and enough of how to check it against the page */
export interface MelodyRead extends NoteRange {
  /** The key signature the sheet opens with: sharps (positive) or flats (negative) */
  keySignature: number
  /** Sung notes read, and the small instrumental ones left out */
  notes: number
  instrumental: number
  pages: number
  staves: number
  /** Where the lowest and highest notes are (the first, if there are several) */
  lowAt: Place
  highAt: Place
}

/** What one page gives */
interface PageRead {
  notes: { midi: number; staff: number }[]
  instrumental: number
  staves: number
  /** That of the staff at the top of the page */
  keySignature: number | null
}

/** The range of the sung notes of a lead sheet (MIDI note numbers, 60 is middle C), and how it was read */
export async function readMelodyRange(pdf: ArrayBuffer): Promise<MelodyRead | null> {
  try {
    const pdfjs = await getResolvedPDFJS()
    const document = await getDocumentProxy(new Uint8Array(pdf))
    let low: { midi: number; at: Place } | undefined
    let high: { midi: number; at: Place } | undefined
    let keySignature: number | null = null
    let notes = 0
    let instrumental = 0
    let staves = 0
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      const { fnArray, argsArray } = await page.getOperatorList()
      const read = readPage(shapesOf(fnArray, argsArray, pdfjs.OPS), pdfjs.OPS)
      keySignature ??= read.keySignature
      instrumental += read.instrumental
      staves += read.staves
      notes += read.notes.length
      for (const { midi, staff } of read.notes) {
        if (!low || midi < low.midi) low = { midi, at: { page: number, staff } }
        if (!high || midi > high.midi) high = { midi, at: { page: number, staff } }
      }
    }
    if (!low || !high) return null
    return {
      low: low.midi,
      high: high.midi,
      // (a note was read, so a page with staves was, and gave it)
      keySignature: keySignature as number,
      notes,
      instrumental,
      pages: document.numPages,
      staves,
      lowAt: low.at,
      highAt: high.at,
    }
  } catch (error) {
    console.warn('Could not read the melody of a PDF:', error)
    return null
  }
}

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** Every path the page paints, with the matrix in force when it was drawn */
function shapesOf(fnArray: number[], argsArray: unknown[], ops: Record<string, number>): Shape[] {
  const shapes: Shape[] = []
  const saved: Matrix[] = []
  let matrix: Matrix = [1, 0, 0, 1, 0, 0]
  for (let i = 0; i < fnArray.length; i++) {
    const op = fnArray[i]
    if (op === ops.save) saved.push(matrix)
    else if (op === ops.restore) matrix = saved.pop() ?? matrix
    else if (op === ops.transform) matrix = multiply(matrix, argsArray[i] as Matrix)
    else if (op === ops.constructPath) {
      const [paint, paths, box] = argsArray[i] as PathArgs
      shapes.push({ paint, path: paths.flatMap(path => Array.from(path)), box, matrix })
    }
  }
  return shapes
}

/** How many of each kind of segment a path has */
function segments(path: ArrayLike<number>): { moves: number; lines: number; curves: number } {
  const count = { moves: 0, lines: 0, curves: 0 }
  // pdf.js's path: a code (0 move, 1 line, 2 curve, 3 quadratic curve, 4 close), then its numbers
  const lengths = [2, 2, 6, 4, 0]
  for (let i = 0; i < path.length; i += 1 + lengths[path[i]]) {
    if (path[i] === 0) count.moves++
    else if (path[i] === 1) count.lines++
    else if (path[i] === 2) count.curves++
  }
  return count
}

/** The page's staves: each a run of five horizontal lines one staff space apart */
function findStaves(shapes: Shape[], ops: Record<string, number>): Staff[] {
  const pieces: Line[] = []
  for (const { paint, path, matrix } of shapes) {
    // a stroked line: move, line
    if (paint !== ops.stroke || path.length !== 6 || path[0] !== 0 || path[3] !== 1) continue
    const [x0, y0] = apply(matrix, path[1], path[2])
    const [x1, y1] = apply(matrix, path[4], path[5])
    if (Math.abs(y0 - y1) < 0.05 && Math.abs(x1 - x0) > 30) {
      pieces.push({ y: y0, left: Math.min(x0, x1) })
    }
  }
  pieces.sort((a, b) => a.y - b.y)
  // a staff line is drawn in pieces, so collapse the pieces at one height
  const lines: Line[] = []
  for (const piece of pieces) {
    const last = lines[lines.length - 1]
    if (last && piece.y - last.y <= 0.5) last.left = Math.min(last.left, piece.left)
    else lines.push({ ...piece })
  }

  const gaps = lines.slice(1).map((line, i) => Math.round((line.y - lines[i].y) * 10) / 10)
  const counts = new Map<number, number>()
  for (const gap of gaps) counts.set(gap, (counts.get(gap) ?? 0) + 1)
  const space = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!space) return []

  const staves: Staff[] = []
  let run = [lines[0]]
  const closeRun = () => {
    if (run.length === 5) {
      staves.push({ bottom: run[0].y, space, left: Math.min(...run.map(line => line.left)) })
    }
  }
  for (const line of lines.slice(1)) {
    if (Math.abs(line.y - run[run.length - 1].y - space) <= space * 0.15) {
      run.push(line)
    } else {
      closeRun()
      run = [line]
    }
  }
  closeRun()
  return staves
}

/** Every sung note on the page, with its staff counted from the top, and the page's key signature */
function readPage(shapes: Shape[], ops: Record<string, number>): PageRead {
  const staves = findStaves(shapes, ops)
  if (staves.length === 0) return { notes: [], instrumental: 0, staves: 0, keySignature: null }
  const space = staves[0].space

  const heads: Head[] = []
  let instrumental = 0
  const accidentals: Accidental[] = []
  for (const { paint, path, box, matrix } of shapes) {
    if (paint !== ops.fill && paint !== ops.eoFill) continue
    const width = Math.hypot(matrix[0], matrix[1]) * (box[2] - box[0])
    const height = Math.hypot(matrix[2], matrix[3]) * (box[3] - box[1])
    const [x, y] = apply(matrix, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
    const { moves, lines, curves } = segments(path)

    // a filled notehead is one ellipse; a minim or semibreve is a ring, so an ellipse and a hole.
    // Sung heads are 1.06 staff spaces tall and the instrumental ones 0.8: 0.9 sorts them
    const solid = moves === 1 && curves === 4
    const ring = moves === 2 && curves >= 8 && curves <= 12
    if ((solid || ring) && height > 0.9 * space && height < 1.25 * space) {
      if (width > space && width < 2.2 * space) heads.push({ x, y })
    } else if ((solid || ring) && height > 0.6 * space && height <= 0.9 * space) {
      instrumental++
    } else if (width > 0.7 * space && width < 0.9 * space) {
      // a sharp is straight-sided and about 2.8 spaces tall; a flat has curves and is 2.6
      if (curves === 0 && lines >= 8 && height > 2.6 * space && height < 3.0 * space) {
        accidentals.push({ x, y, sharp: true })
      } else if (curves >= 8 && height > 2.3 * space && height < 2.8 * space) {
        accidentals.push({ x, y, sharp: false })
      }
    }
  }

  const middle = (staff: Staff) => staff.bottom + 2 * staff.space
  const notes: PageRead['notes'] = []
  const headsOf = new Map<Staff, Head[]>()
  for (const head of heads) {
    const staff = staves.reduce((a, b) =>
      Math.abs(middle(a) - head.y) <= Math.abs(middle(b) - head.y) ? a : b
    )
    // up to three ledger lines away
    if (Math.abs(middle(staff) - head.y) > 5 * staff.space) continue
    headsOf.set(staff, [...(headsOf.get(staff) ?? []), head])
  }
  for (const [staff, staffHeads] of headsOf) {
    const { offsets } = keySignature(
      staff,
      accidentals,
      Math.min(...staffHeads.map(head => head.x))
    )
    // (the staves go up the page, so the top one is the last)
    const number = staves.length - staves.indexOf(staff)
    for (const head of staffHeads) notes.push({ midi: midiOf(staff, head, offsets), staff: number })
  }
  // the staff at the top opens the song, even if it has only an instrumental line
  const top = staves[staves.length - 1]
  return {
    notes,
    instrumental,
    staves: staves.length,
    keySignature: keySignature(top, accidentals, Infinity).count,
  }
}

/**
 * The semitones the staff's key signature adds to each letter (0 is C). It is the sharps or
 * flats at the start of the staff: just after the clef, left of the first note, and packed in a
 * run (an accidental on the first note itself is not part of it).
 */
function keySignature(
  staff: Staff,
  accidentals: Accidental[],
  firstHeadX: number
): { offsets: number[]; count: number } {
  const start = accidentals
    .filter(
      accidental =>
        accidental.x < firstHeadX &&
        accidental.y > staff.bottom - 2 * staff.space &&
        accidental.y < staff.bottom + 6 * staff.space
    )
    .sort((a, b) => a.x - b.x)
  const run: Accidental[] = []
  for (const accidental of start) {
    const previous = run[run.length - 1]
    // the first must be just after the clef, and each next one close behind the one before
    if (
      previous
        ? accidental.x - previous.x > 1.6 * staff.space
        : accidental.x > staff.left + 8 * staff.space
    )
      break
    run.push(accidental)
  }
  const sharps = run.filter(accidental => accidental.sharp).length
  const flats = run.length - sharps
  const offsets = [0, 0, 0, 0, 0, 0, 0]
  if (flats === 0) for (const letter of SHARP_LETTERS.slice(0, sharps)) offsets[letter] = 1
  else if (sharps === 0) for (const letter of FLAT_LETTERS.slice(0, flats)) offsets[letter] = -1
  return { offsets, count: sharps - flats }
}

/** The MIDI number of the note a head draws on a treble staff */
function midiOf(staff: Staff, head: Head, offsets: number[]): number {
  // a step is a line to the next space: half a staff space
  const steps = Math.round((head.y - staff.bottom) / (staff.space / 2))
  const place = BOTTOM_LINE_LETTER + steps
  const letter = ((place % 7) + 7) % 7
  const octave = BOTTOM_LINE_OCTAVE + Math.floor(place / 7)
  return 12 * (octave + 1) + SEMITONES[letter] + offsets[letter]
}
