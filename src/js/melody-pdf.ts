/**
 * Reads a SongSelect lead sheet PDF's drawing into the tree the preview's SVG gives
 * (`melody-read.ts` reads that), so the lengths, pitches and measure sums are worked out in one place.
 *
 * The PDF is IronPdf printing the same Verovio SVG, so its drawing keeps the SVG's own units and
 * path data. What it loses is the grouping and the names: a notehead is a filled shape, not a
 * `<g class="note">` holding a glyph reference. This puts both back:
 *
 * - **names**: each filled shape drawn flipped (a glyph is drawn upside down in a PDF's y-up space
 *   so it is the shape of a font glyph) is looked up by its hash in `melody-glyphs.ts`;
 * - **grouping**: staves are the sets of five lines, a measure is one such set (Verovio draws a
 *   staff line per measure); a head, its stem, flag, dots and accidental are found by where they sit.
 *
 * Input is the page as SVG text (what `mutool draw -F svg` writes: for the spike; in the app the same
 * shapes come from pdf.js's drawing operations, as `melody-range.ts` already reads them).
 */

import { parseDirection } from './melody-directions.ts'
import { GLYPHS } from './melody-glyphs.ts'
import { absolutePath, shapeHash } from './melody-path.ts'
import type { El } from './xml.ts'

export interface Line {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
}
export interface Glyph {
  code: string
  x: number
  y: number
  scale: number
  used: boolean
}
interface Poly {
  minX: number
  maxX: number
  minY: number
  maxY: number
  d: string
}

/** A word of the page's text, in the PDF's points: where it starts and ends, its baseline, its size, and its font's weight */
export interface TextRun {
  x0: number
  x1: number
  y: number
  size: number
  bold: boolean
  italic: boolean
  text: string
}

let counter = 0
const node = (name: string, attrs: Record<string, string>, children: El[] = []): El => ({
  name,
  attrs,
  children,
  text: '',
})
const group = (cls: string, children: El[] = []) =>
  node('g', { id: `s${counter++}`, class: cls }, children)
const useOf = (g: Glyph) =>
  node('use', {
    'xlink:href': `#${g.code}-pdf`,
    transform: `translate(${g.x}, ${g.y}) scale(${g.scale}, ${g.scale})`,
  })
const num = (n: number) => String(Math.round(n * 10) / 10)

const HEAD_WIDTH: Record<string, number> = { E0A2: 405, E0A3: 314, E0A4: 314, E0A9: 290 }
const HEADS = new Set(['E0A2', 'E0A3', 'E0A4', 'E0A9'])
const RESTS = new Set(['E4E3', 'E4E4', 'E4E5', 'E4E6', 'E4E7', 'E4E8'])
const FLAGS = new Set(['E240', 'E241', 'E242', 'E243', 'E244', 'E245'])
const ACCIDENTALS = new Set(['E260', 'E261', 'E262'])
const CLEFS = new Set(['E050', 'E062'])
const isDigit = (c: string) => /^E08[0-9AB]$/.test(c)
/** Glyphs the sheet draws that do not change what the notes are */
const IGNORED = new Set(['E4C0', 'E4C1', 'E07A', 'E1E7', 'E887'])

/** One page of the PDF's drawing as the tree `readMelodyTrees` reads, or null if no staff is found */
/** A shape the page paints: its path data (the font's units for a glyph), the matrix in force, and whether it is stroked (a line) or filled */
export interface DrawItem {
  d: string
  /** The matrix that puts the path on the page, y down (a, d, e, f: nothing here is rotated or skewed) */
  m: { a: number; d: number; e: number; f: number }
  stroked: boolean
  /** The line width in the path's own units, for a stroke */
  width: number
}

/**
 * One page of the PDF's drawing as the tree `readMelodyTrees` reads, or null if no staff is found.
 * `items` and `runs` come from `melody-pdfjs.ts` in the app (and from `mutool` in the spike's scripts).
 */
export function pdfPageToTree(
  items: DrawItem[],
  warnings: string[],
  runs: TextRun[] = []
): El | null {
  const lines: Line[] = []
  const hooks: { hookX: number; endX: number; y: number }[] = []
  const glyphs: Glyph[] = []
  const polys: Poly[] = []
  /** Short bars: the hyphens and extenders between syllables */
  const bars: Poly[] = []
  const dots: { x: number; y: number }[] = []
  const curves: { d: string; minX: number; maxX: number; minY: number; maxY: number }[] = []

  // The units of the original drawing: the staff lines are the stroked horizontals with the commonest matrix
  const votes = new Map<string, number>()
  for (const { stroked, m } of items) {
    const key = `${m.a}|${m.e}|${m.f}`
    if (stroked && m.d > 0) votes.set(key, (votes.get(key) ?? 0) + 1)
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0]
  if (!best) return null
  const [ua, ue, uf] = best[0].split('|').map(Number) as [number, number, number]
  /** The matrix is the drawing's own (a stretch of it may come out a little off in the last digit) */
  const inUnits = (a: number) => Math.abs(a - ua) <= ua * 1e-5

  for (const { d, m, stroked, width: w } of items) {
    if (stroked) {
      if (w <= 1) continue // the hairline drawn over a filled shape
      if (!inUnits(m.a) || m.d <= 0) continue
      const p = absolutePath(d)
      if (p.points.length === 3) {
        // a tuplet bracket's half: a hook down at one end and the line across
        const [a, b, c] = p.points as [number[], number[], number[]]
        if (a[0] === b[0])
          hooks.push({ hookX: a[0] as number, endX: c[0] as number, y: c[1] as number })
      } else if (p.points.length === 2) {
        const [a, b] = p.points as [number[], number[]]
        lines.push({
          x1: a[0] as number,
          y1: a[1] as number,
          x2: b[0] as number,
          y2: b[1] as number,
          width: w,
        })
      }
      continue
    }
    const p = absolutePath(d)
    if (m.d < 0) {
      // a glyph: named by its shape; its origin in the drawing's units
      const code = GLYPHS[shapeHash(p.key)]
      const g: Glyph = {
        code: code ?? '',
        x: (m.e - ue) / ua,
        y: (m.f - uf) / ua,
        scale: Math.abs(m.a) / ua,
        used: false,
      }
      if (!code) {
        warnings.push(
          `unknown glyph shape ${shapeHash(p.key)} (${num((p.box.maxX - p.box.minX) / 250)} x ${num((p.box.maxY - p.box.minY) / 250)} spaces) at ${num(g.x)},${num(g.y)}`
        )
        continue
      }
      glyphs.push(g)
    } else if (inUnits(m.a)) {
      const { box } = p
      const w = box.maxX - box.minX
      const h = box.maxY - box.minY
      const hasCurve = /C/.test(p.key)
      if (hasCurve && w < 80 && h < 80)
        dots.push({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 })
      else if (hasCurve)
        curves.push({
          d,
          minX: box.minX,
          maxX: box.maxX,
          minY: box.minY,
          maxY: box.maxY,
        })
      else
        polys.push({
          minX: box.minX,
          maxX: box.maxX,
          minY: box.minY,
          maxY: box.maxY,
          d,
        })
    }
  }

  // Staves: five horizontals of the same extent, evenly spaced
  const byExtent = new Map<string, Line[]>()
  for (const l of lines)
    if (l.y1 === l.y2 && l.width < 15)
      byExtent.set(`${l.x1}|${l.x2}`, [...(byExtent.get(`${l.x1}|${l.x2}`) ?? []), l])
  interface Staff {
    x0: number
    x1: number
    ys: number[]
    sys: number
  }
  const staves: Staff[] = []
  for (const [k, ls] of byExtent) {
    const ys = ls.map(l => l.y1).sort((a, b) => a - b)
    const [x0, x1] = k.split('|').map(Number) as [number, number]
    for (let i = 0; i + 5 <= ys.length; i++) {
      const five = ys.slice(i, i + 5)
      const sp = ((five[4] as number) - (five[0] as number)) / 4
      if (five.every((y, j) => Math.abs(y - (five[0] as number) - j * sp) < 2)) {
        staves.push({ x0, x1, ys: five, sys: 0 })
        i += 4
      }
    }
  }
  if (!staves.length) return null
  staves.sort((a, b) => (a.ys[4] as number) - (b.ys[4] as number) || a.x0 - b.x0)
  let sys = 0
  let prevBottom = staves[0]?.ys[4] ?? 0
  for (const s of staves) {
    if (Math.abs((s.ys[4] as number) - prevBottom) > 100) sys++
    prevBottom = s.ys[4] as number
    s.sys = sys
  }

  // Which staff something belongs to: the one whose x range holds it, and nearest in height
  const staffFor = (x: number, y: number): Staff | undefined => {
    let best: Staff | undefined
    let bestD = 1500
    for (const s of staves) {
      if (x < s.x0 - 1 || x > s.x1 + 1) continue
      const mid = ((s.ys[0] as number) + (s.ys[4] as number)) / 2
      const dd = Math.abs(y - mid)
      if (dd < bestD) {
        bestD = dd
        best = s
      }
    }
    return best
  }
  const perStaff = new Map<
    Staff,
    {
      glyphs: Glyph[]
      stems: Line[]
      dots: { x: number; y: number }[]
      polys: Poly[]
      curves: typeof curves
    }
  >()
  for (const s of staves)
    perStaff.set(s, { glyphs: [], stems: [], dots: [], polys: [], curves: [] })
  for (const g of glyphs) perStaff.get(staffFor(g.x, g.y) as Staff)?.glyphs.push(g)
  for (const l of lines) {
    if (l.x1 !== l.x2 || l.width < 10 || l.width > 21) continue
    const s = staffFor(l.x1, (l.y1 + l.y2) / 2)
    const top = Math.min(l.y1, l.y2)
    const bottom = Math.max(l.y1, l.y2)
    if (
      s &&
      !(Math.abs(top - (s.ys[0] as number)) < 2 && Math.abs(bottom - (s.ys[4] as number)) < 2)
    )
      perStaff.get(s)?.stems.push(l)
  }
  for (const d of dots) perStaff.get(staffFor(d.x, d.y) as Staff)?.dots.push(d)
  for (const p of polys) {
    if (p.maxY - p.minY < 50) {
      bars.push(p)
      continue
    }
    const s = staffFor((p.minX + p.maxX) / 2, (p.minY + p.maxY) / 2) // a beam
    if (s) perStaff.get(s)?.polys.push(p)
  }
  const tupletsOf = new Map<
    Staff,
    { x: number; y: number; from: number | null; to: number | null; g: Glyph }[]
  >()
  for (const g of glyphs.filter(x => x.code === 'E887')) {
    const s = staffFor(g.x, g.y)
    if (!s) continue
    // its bracket, if drawn: a half to each side of the number, and the hooks at the far ends
    const near = hooks.filter(h => Math.abs(h.y - g.y) < 400)
    const left = near
      .filter(h => h.hookX < g.x && h.endX > h.hookX)
      .sort((a, b) => b.hookX - a.hookX)[0]
    const right = near
      .filter(h => h.hookX > g.x && h.endX < h.hookX)
      .sort((a, b) => a.hookX - b.hookX)[0]
    tupletsOf.set(s, [
      ...(tupletsOf.get(s) ?? []),
      { x: g.x, y: g.y, from: left ? left.hookX : null, to: right ? right.hookX : null, g },
    ])
  }
  for (const c of curves) {
    const s = staffFor((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2)
    if (s) perStaff.get(s)?.curves.push(c)
  }

  const marks = signsOf(staves, lines, glyphs, runs, { a: ua, e: ue, f: uf })

  const page = group('page-margin')
  const words = placeText(runs, staves, bars, { a: ua, e: ue, f: uf })
  if (words.header) page.children.push(words.header)
  if (words.footer) page.children.push(words.footer)
  const systems: El[] = []
  for (const s of staves) {
    let sysEl = systems[s.sys]
    if (!sysEl) {
      sysEl = group('system')
      systems[s.sys] = sysEl
    }
    sysEl.children.push(
      buildMeasure(
        s,
        {
          ...(perStaff.get(s) as NonNullable<ReturnType<typeof perStaff.get>>),
          tuplets: tupletsOf.get(s) ?? [],
          words: words.perStaff.get(s) ?? { marks: [], syls: [] },
          signs: marks.get(s) ?? { bar: 'single', repeatStart: false, ending: null },
        },
        warnings
      )
    )
  }
  page.children.push(...systems)
  return node('svg', {}, [page])
}

export interface Staff {
  x0: number
  x1: number
  ys: number[]
}

/** What a measure's edges and the line over it say: how it ends, whether it starts a repeat, its numbered ending */
export interface StaffSigns {
  bar: 'single' | 'double' | 'final' | 'repeat-end'
  repeatStart: boolean
  ending: { label: string; start: boolean; stop: boolean; closed: boolean } | null
}

/** A barline is this thick (in the drawing's units) or thinner; a thick one is the heavy line of a final or repeat bar */
const THICK = 60
/** A repeat's dots are this near the bar they belong to */
const DOTS_NEAR = 450

/**
 * Repeat signs and numbered endings, read from where the lines and dots sit.
 * A repeat is dots beside a thick line: dots before it end a repeat (":|"), dots after it start one
 * ("|:"). A start sign at the end of a system belongs to the measure that follows. An ending is a
 * line over the staff with a hook down at its left end (and at its right if it is closed), and the
 * numbers it is for written under it.
 */
export function signsOf(
  staves: (Staff & { sys: number })[],
  lines: Line[],
  glyphs: Glyph[],
  runs: TextRun[],
  unit: { a: number; e: number; f: number }
): Map<Staff, StaffSigns> {
  const out = new Map<Staff, StaffSigns>()
  for (const s of staves) out.set(s, { bar: 'single', repeatStart: false, ending: null })
  const signs = (s: Staff) => out.get(s) as StaffSigns
  const top = (s: Staff) => s.ys[0] as number
  const bottom = (s: Staff) => s.ys[4] as number

  // Barlines: lines as tall as the staff, thin or thick
  const verticals = lines.filter(l => l.x1 === l.x2 && l.width >= 22 && l.width < 200)
  const barsOf = (s: Staff) =>
    verticals.filter(
      l =>
        Math.abs(Math.min(l.y1, l.y2) - top(s)) < 2 &&
        Math.abs(Math.max(l.y1, l.y2) - bottom(s)) < 2
    )

  const startsAtEnd = new Set<Staff>()
  for (const d of glyphs.filter(g => g.code === 'E1E7')) {
    const i = staves.findIndex(s => d.x >= s.x0 && d.x < s.x1 && d.y > top(s) && d.y < bottom(s))
    const s = staves[i]
    if (!s) continue
    const thick = barsOf(s)
      .filter(l => l.width >= THICK && Math.abs(l.x1 - d.x) < DOTS_NEAR)
      .sort((p, q) => Math.abs(p.x1 - d.x) - Math.abs(q.x1 - d.x))[0]
    if (!thick) continue
    if (thick.x1 > d.x) signs(s).bar = 'repeat-end'
    else if (d.x > s.x1 - DOTS_NEAR) {
      // ("|:" drawn at the end of a system: the repeat is the next measure's)
      startsAtEnd.add(s)
      const next = staves[i + 1]
      if (next) signs(next).repeatStart = true
    } else signs(s).repeatStart = true
  }
  for (const s of staves) {
    const here = signs(s)
    if (here.bar === 'repeat-end') continue
    const window = startsAtEnd.has(s) ? 30 : 200
    const bars = barsOf(s).filter(l => l.x1 >= s.x1 - window && l.x1 <= s.x1 + 50)
    if (bars.some(l => l.width >= THICK)) here.bar = 'final'
    else if (new Set(bars.map(l => Math.round(l.x1))).size >= 2) here.bar = 'double'
  }

  // Endings: a line over the staff, a hook down at its left end, and the numbers under it
  const hooks = lines.filter(l => l.x1 === l.x2 && l.width >= 10 && l.width <= 16)
  const labels = runs
    .filter(r => r.size >= 9 && /^\d+(\s*,\s*\d+)*$/.test(r.text.trim()))
    .map(r => ({
      x: (r.x0 - unit.e) / unit.a,
      y: (r.y - unit.f) / unit.a,
      text: r.text.replace(/\s+/g, ''),
    }))
  for (const l of lines) {
    if (l.y1 !== l.y2 || l.width < 10 || l.width > 16 || l.x2 - l.x1 < 600) continue
    const hookAt = (x: number) =>
      hooks.some(h => Math.abs(h.x1 - x) < 2 && Math.abs(Math.min(h.y1, h.y2) - l.y1) < 2)
    if (!hookAt(l.x1)) continue
    const label = labels.find(
      t => t.x >= l.x1 && t.x < l.x1 + 700 && t.y > l.y1 && t.y < l.y1 + 700
    )
    if (!label) continue
    const closed = hookAt(l.x2)
    for (const s of staves) {
      if (l.y1 > top(s) - 100 || l.y1 < top(s) - 1800) continue
      // (a system's first measure begins with its clef and key, so a bracket starts further in)
      const opening = !staves.some(o => o.sys === s.sys && o.x0 < s.x0)
      const starts = l.x1 >= s.x0 - 200 && l.x1 <= s.x0 + (opening ? 3000 : 200)
      if (s.x1 < l.x1 + 200 || s.x0 > l.x2 - 200) continue
      if (s.x0 < l.x1 - 200 && !starts && s.x1 > l.x2 + 200) continue
      signs(s).ending = {
        label: label.text,
        start: starts,
        // (the bracket stops short of a repeat's or a final bar, which is more than one line)
        stop: l.x2 >= s.x1 - 600 && l.x2 <= s.x1 + 200,
        closed,
      }
    }
  }
  return out
}

function buildMeasure(
  s: Staff,
  c: {
    tuplets: { x: number; y: number; from: number | null; to: number | null; g: Glyph }[]
    words: StaffWords
    signs: StaffSigns
    glyphs: Glyph[]
    stems: Line[]
    dots: { x: number; y: number }[]
    polys: Poly[]
    curves: { d: string; minX: number; maxX: number; minY: number; maxY: number }[]
  },
  warnings: string[]
): El {
  const space = ((s.ys[4] as number) - (s.ys[0] as number)) / 4
  const staffEl = group(
    'staff',
    s.ys.map(y => node('path', { d: `M${s.x0} ${y} L${s.x1} ${y}` }))
  )
  const measure = group('measure', [staffEl])
  const bar = group('barLine')
  bar.attrs['data-bar'] = c.signs.bar
  measure.children.push(bar)
  if (c.signs.repeatStart) measure.children.push(group('repeatStart'))
  if (c.signs.ending) {
    const e = group('ending')
    e.attrs['data-label'] = c.signs.ending.label
    e.attrs['data-start'] = c.signs.ending.start ? '1' : '0'
    e.attrs['data-stop'] = c.signs.ending.stop ? '1' : '0'
    e.attrs['data-closed'] = c.signs.ending.closed ? '1' : '0'
    measure.children.push(e)
  }

  const heads = c.glyphs.filter(g => HEADS.has(g.code))
  const rests = c.glyphs.filter(g => RESTS.has(g.code))
  const firstContentX = Math.min(...heads.map(g => g.x), ...rests.map(g => g.x), Infinity)

  // Clef, key signature and meter come before the first note
  const clef = c.glyphs.find(g => CLEFS.has(g.code))
  if (clef) staffEl.children.push(group('clef', [useOf(clef)]))

  const accidentals = c.glyphs.filter(g => ACCIDENTALS.has(g.code))
  const keyAcc: Glyph[] = []
  const noteAcc: Glyph[] = []
  for (const a of accidentals) {
    const right = a.x + 0.8 * 250 * a.scale
    const head = heads
      .filter(h => h.x >= right - 40)
      .sort((p, q) => p.x - q.x)
      .find(h => Math.abs(h.y - a.y) < 2.5 * space)
    if (head && head.x - right < 130 && !keyAccidentalRun(a, accidentals, space)) noteAcc.push(a)
    else keyAcc.push(a)
  }
  if (keyAcc.length)
    staffEl.children.push(
      group(
        'keySig',
        keyAcc.sort((p, q) => p.x - q.x).map(g => group('keyAccid', [useOf(g)]))
      )
    )
  const digits = c.glyphs.filter(g => isDigit(g.code))
  if (digits.length)
    staffEl.children.push(group('meterSig', digits.sort((p, q) => p.x - q.x).map(useOf)))
  void firstContentX

  // Attach what belongs to a head or a rest: a stem, a flag, a dot, an accidental
  const stems = c.stems.map(l => ({ ...l, taken: false }))
  const flags = c.glyphs.filter(g => FLAGS.has(g.code))
  const dotsLeft = [...c.dots]
  const takeDots = (x: number, y: number, right: number): El | null => {
    const mine = dotsLeft.filter(
      d => d.x >= right - 20 && d.x <= right + 1.6 * space && Math.abs(d.y - y) <= 0.8 * space
    )
    if (!mine.length) return null
    // the nearest column of dots, one per head
    mine.sort((p, q) => p.x - q.x)
    const first = mine[0] as { x: number; y: number }
    const row = mine.filter(d => d.x - first.x < 0.7 * space)
    // and a second dot a little to the right is a double dot
    const more = mine.filter(
      d =>
        d.x - first.x >= 0.7 * space && d.x - first.x < 2.2 * space && Math.abs(d.y - first.y) < 20
    )
    const used = [...row, ...more]
    for (const d of used) dotsLeft.splice(dotsLeft.indexOf(d), 1)
    void x
    return group(
      'dots',
      used.map(d => node('ellipse', { cx: num(d.x), cy: num(d.y), rx: '27', ry: '27' }))
    )
  }

  interface Item {
    x: number
    el: El
    stemX: number | null
    stemEnd: number | null
    /** Cue size: an instrumental line that sounds with the melody, so it is a voice of its own */
    cue: boolean
  }
  const items: Item[] = []

  // heads grouped by the stem they share
  const stemOf = (h: Glyph) => {
    const w = (HEAD_WIDTH[h.code] ?? 314) * h.scale
    return stems.find(
      l =>
        (Math.abs(l.x1 - (h.x + w)) <= 40 || Math.abs(l.x1 - h.x) <= 40) &&
        h.y >= Math.min(l.y1, l.y2) - 60 &&
        h.y <= Math.max(l.y1, l.y2) + 60
    )
  }
  const byStem = new Map<(typeof stems)[number] | undefined, Glyph[]>()
  for (const h of heads.sort((p, q) => p.x - q.x)) {
    const st = stemOf(h)
    byStem.set(st, [...(byStem.get(st) ?? []), h])
  }
  const noteEls: { x: number; el: El; cue: boolean }[] = []
  for (const [st, hs] of byStem) {
    const makeNote = (h: Glyph, own: El[]): El => {
      const note = group('note', [group('notehead', [useOf(h)]), ...own])
      noteEls.push({
        x: h.x + ((HEAD_WIDTH[h.code] ?? 314) * h.scale) / 2,
        el: note,
        cue: h.scale < 0.65,
      })
      const acc = noteAcc.find(
        a => Math.abs(a.y - h.y) < 2.5 * space && a.x < h.x && h.x - a.x < 700 && !a.used
      )
      if (acc) {
        acc.used = true
        note.children.push(group('accid', [useOf(acc)]))
      } else note.children.push(group('accid'))
      return note
    }
    const shared: El[] = []
    let stemX: number | null = null
    let stemEnd: number | null = null
    if (st) {
      st.taken = true
      stemX = st.x1
      // the end of the stem away from the heads is where its flag hangs
      const lowestHead = Math.max(...hs.map(h => h.y))
      const up =
        st.y1 < lowestHead - space * 2 || Math.min(st.y1, st.y2) < Math.min(...hs.map(h => h.y))
      stemEnd = up ? Math.min(st.y1, st.y2) : Math.max(st.y1, st.y2)
      shared.push(group('stem', [node('path', { d: `M${st.x1} ${st.y1} L${st.x2} ${st.y2}` })]))
      const flag = flags.find(
        f => Math.abs(f.x - st.x1) < 40 && Math.abs(f.y - (stemEnd as number)) < 700
      )
      if (flag) shared.push(group('flag', [useOf(flag)]))
    }
    const lead = hs[0] as Glyph
    const w = (HEAD_WIDTH[lead.code] ?? 314) * lead.scale
    const dotsEl = takeDots(
      lead.x,
      lead.y,
      Math.max(...hs.map(h => h.x + (HEAD_WIDTH[h.code] ?? 314) * h.scale))
    )
    void w
    if (hs.length === 1) {
      const own = [...shared, ...(dotsEl ? [dotsEl] : [])]
      items.push({ x: lead.x, el: makeNote(lead, own), stemX, stemEnd, cue: lead.scale < 0.65 })
    } else {
      const notes = hs.map(h => makeNote(h, []))
      items.push({
        x: lead.x,
        el: group('chord', [...shared, ...(dotsEl ? [dotsEl] : []), ...notes]),
        stemX,
        stemEnd,
        cue: lead.scale < 0.65,
      })
    }
  }
  for (const r of rests) {
    const right = r.x + 1.2 * 250 * r.scale
    const dotsEl = takeDots(r.x, r.y, right)
    items.push({
      x: r.x,
      el: group('rest', [useOf(r), ...(dotsEl ? [dotsEl] : [])]),
      stemX: null,
      stemEnd: null,
      cue: r.scale < 0.65,
    })
  }
  for (const it of items) it.el.attrs['data-x'] = String(Math.round(it.x))
  items.sort((p, q) => p.x - q.x)

  // Beams: polygons that overlap in x are one group holding the notes whose stems they run across
  const clusters: { minX: number; maxX: number; minY: number; maxY: number; polys: Poly[] }[] = []
  for (const p of [...c.polys].sort((a, b) => a.minX - b.minX)) {
    const cl = clusters.find(
      k =>
        p.minX <= k.maxX + 5 &&
        p.maxX >= k.minX - 5 &&
        p.minY <= k.maxY + 400 &&
        p.maxY >= k.minY - 400
    )
    if (cl) {
      cl.minX = Math.min(cl.minX, p.minX)
      cl.maxX = Math.max(cl.maxX, p.maxX)
      cl.minY = Math.min(cl.minY, p.minY)
      cl.maxY = Math.max(cl.maxY, p.maxY)
      cl.polys.push(p)
    } else clusters.push({ minX: p.minX, maxX: p.maxX, minY: p.minY, maxY: p.maxY, polys: [p] })
  }
  const buildLayer = (mine: Item[]): El => {
    const units: { x: number; el: El; members: Item[] }[] = []
    const placed = new Set<Item>()
    for (const it of mine) {
      if (placed.has(it)) continue
      const stemX = it.stemX as number
      const cl =
        it.stemX !== null
          ? clusters.find(
              k =>
                stemX >= k.minX - 25 &&
                stemX <= k.maxX + 25 &&
                Math.abs((it.stemEnd as number) - (k.minY + k.maxY) / 2) < 500
            )
          : undefined
      if (!cl) {
        units.push({ x: it.x, el: it.el, members: [it] })
        placed.add(it)
        continue
      }
      const inside = mine.filter(
        o =>
          !placed.has(o) &&
          ((o.stemX !== null &&
            o.stemX >= cl.minX - 25 &&
            o.stemX <= cl.maxX + 25 &&
            Math.abs((o.stemEnd as number) - (cl.minY + cl.maxY) / 2) < 500) ||
            (o.stemX === null && o.x >= cl.minX && o.x <= cl.maxX))
      )
      const beam = group('beam', [
        ...cl.polys.map(p => node('polygon', { points: polyPoints(p.d) })),
        ...inside.map(o => o.el),
      ])
      for (const o of inside) placed.add(o)
      units.push({ x: it.x, el: beam, members: inside })
    }
    // Tuplets: the units under a bracket, or, with no bracket drawn, the beamed group the number sits over
    for (const tu of c.tuplets) {
      let from = tu.from
      let to = tu.to
      if (from === null || to === null) {
        const under = units.filter(
          u =>
            u.el.attrs.class === 'beam' &&
            Math.abs(
              (Math.min(...u.members.map(m => m.x)) + Math.max(...u.members.map(m => m.x))) / 2 -
                tu.x
            ) < 400
        )
        const u = under.sort((p, q) => Math.abs(p.x - tu.x) - Math.abs(q.x - tu.x))[0]
        if (!u) continue
        from = Math.min(...u.members.map(m => m.x))
        to = Math.max(...u.members.map(m => m.x))
      }
      const mine2 = units.filter(u =>
        u.members.every(m => m.x >= (from as number) - 30 && m.x <= (to as number) + 30)
      )
      if (!mine2.length) continue
      const first = units.indexOf(mine2[0] as (typeof units)[number])
      const wrapped = {
        x: (mine2[0] as (typeof units)[number]).x,
        el: group('tuplet', [
          node('use', {
            'xlink:href': '#E083-pdf',
            transform: `translate(${tu.x}, ${tu.y}) scale(0.72, 0.72)`,
          }),
          ...mine2.map(u => u.el),
        ]),
        members: mine2.flatMap(u => u.members),
      }
      units.splice(first, mine2.length, wrapped)
    }
    return group(
      'layer',
      units.map(u => u.el)
    )
  }
  const voices = [items.filter(i => !i.cue), items.filter(i => i.cue)].filter(v => v.length)
  for (const v of voices) staffEl.children.push(buildLayer(v))

  // Words: the chords, section and tempo marks sit in the measure; each syllable goes to the head it is under
  for (const m of c.words.marks) measure.children.push(m)
  attachSyllables(c.words.syls, noteEls)

  // Curves that join two heads are ties (the reader checks the pitches)
  for (const cv of c.curves) measure.children.push(group('tie', [node('path', { d: cv.d })]))

  for (const g of c.glyphs) {
    if (
      !(
        HEADS.has(g.code) ||
        RESTS.has(g.code) ||
        FLAGS.has(g.code) ||
        ACCIDENTALS.has(g.code) ||
        CLEFS.has(g.code) ||
        isDigit(g.code) ||
        IGNORED.has(g.code)
      )
    )
      warnings.push(`glyph ${g.code} not read at ${num(g.x)},${num(g.y)}`)
  }
  return measure
}

/** A flat key signature or sharp one is a run of accidentals evenly spaced across the staff: the first of the measure */
function keyAccidentalRun(a: Glyph, all: Glyph[], space: number): boolean {
  // another accidental right beside it, a space or so on, with no head between, and nothing to its left
  return all.some(
    o =>
      o !== a &&
      Math.abs(o.x - a.x) < 1.3 * space &&
      Math.abs(o.x - a.x) > 0.3 * space &&
      Math.abs(o.y - a.y) < 3 * space &&
      o.code === a.code &&
      a.x < 1200
  )
}

/** "M1 2 3 4V5L1 5Z" as the SVG's "x,y x,y" points */
function polyPoints(d: string): string {
  const { points } = absolutePath(d)
  return points.map(p => `${num(p[0] as number)},${num(p[1] as number)}`).join(' ')
}

/** A syllable of the lyrics, in the drawing's units, with the verse row it is on and what is drawn after it */
interface Syl {
  x0: number
  x1: number
  row: number
  text: string
  connector: '' | 'hyphen' | 'extender'
}

/** What the text of a page puts on one staff: marks go in the measure (chords, section, tempo) and syllables go on notes */
interface StaffWords {
  marks: El[]
  syls: Syl[]
}

function node2(name: string, attrs: Record<string, string>, children: El[], text: string): El {
  return { name, attrs, children, text }
}

const textEl = (text: string, x: number, y: number) =>
  node2('text', { class: 'text', x: num(x), y: num(y) }, [], text)

/**
 * Puts the page's words where Verovio had them: above a staff the regular 405-unit words are chord
 * symbols, bold ones a section name (in its box) or the tempo, and below it they are lyrics, a row for each
 * verse. What is left on the page above the first staff or below the last is the title and the notice.
 */
function placeText(
  runs: TextRun[],
  staves: (Staff & { sys: number })[],
  bars: Poly[],
  u: { a: number; e: number; f: number }
): { perStaff: Map<Staff, StaffWords>; header: El | null; footer: El | null } {
  const perStaff = new Map<Staff, StaffWords>()
  for (const s of staves) perStaff.set(s, { marks: [], syls: [] })
  const units = runs.map(r => ({
    x0: (r.x0 - u.e) / u.a,
    x1: (r.x1 - u.e) / u.a,
    y: (r.y - u.f) / u.a,
    size: r.size / u.a,
    bold: r.bold,
    italic: r.italic,
    text: r.text.replace(/^[\ue000-\uf8ff]+/, '').trim(),
    raw: r.text,
  }))
  const top = Math.min(...staves.map(s => s.ys[0] as number))
  const bottom = Math.max(...staves.map(s => s.ys[4] as number))
  const inX = (s: Staff, x: number) => x >= s.x0 - 1 && x < s.x1
  const left: typeof units = []
  const rows = new Map<Staff, number[]>()
  const lyrics: { s: Staff & { sys: number }; r: (typeof units)[number] }[] = []
  const marks: { s: Staff; r: (typeof units)[number] }[] = []
  // Words that can be a lyric or a chord: each is kept with the staff above it and the staff below
  const between: {
    r: (typeof units)[number]
    above: Staff & { sys: number }
    below: Staff | undefined
  }[] = []
  for (const r of units) {
    if (!r.text || r.size < 370 || r.size > 440 || r.y < top - 1500) {
      left.push(r)
      continue
    }
    const below = staves
      .filter(
        s =>
          inX(s, r.x0 + (r.bold ? 100 : 0)) &&
          r.y < (s.ys[0] as number) + 60 &&
          (s.ys[0] as number) - r.y < 1900
      )
      .sort((p, q) => (p.ys[0] as number) - (q.ys[0] as number))[0]
    const above = staves
      .filter(
        s =>
          inX(s, (r.x0 + r.x1) / 2) && r.y > (s.ys[4] as number) && r.y - (s.ys[4] as number) < 5400
      )
      .sort((p, q) => (q.ys[4] as number) - (p.ys[4] as number))[0]
    // bold and italic words are never lyrics: a section name, the tempo, a direction
    if ((r.bold || r.italic || !above) && below) marks.push({ s: below, r })
    else if (r.bold || r.italic || !above) left.push(r)
    else between.push({ r, above, below })
  }
  // Under a system the rows run: the lyrics, one row for a verse, 580 units apart, the first near the staff, and then
  // (if the next system has chords) the row of chords, set apart. So from the top: a row within 2000 of the staff
  // starts the lyrics, and each row 640 or less below the last is another verse.
  const bySystem = new Map<number, typeof between>()
  for (const w of between) bySystem.set(w.above.sys, [...(bySystem.get(w.above.sys) ?? []), w])
  for (const [, ws] of bySystem) {
    const bottomOf = ws[0]?.above.ys[4] as number
    const ys = [...new Set(ws.map(w => Math.round(w.r.y / 40) * 40))].sort((a, b) => a - b)
    const lyricYs = new Set<number>()
    let prev: number | null = null
    for (const y of ys) {
      if (prev === null ? y - bottomOf <= 2000 : y - prev <= 640) {
        lyricYs.add(y)
        prev = y
      } else break
    }
    for (const w of ws) {
      if (lyricYs.has(Math.round(w.r.y / 40) * 40)) {
        lyrics.push({ s: w.above, r: w.r })
        rows.set(w.above, [...(rows.get(w.above) ?? []), w.r.y])
      } else if (w.below) marks.push({ s: w.below, r: w.r })
      else left.push(w.r)
    }
  }
  // Marks: chords are regular, a section name bold (its words joined), the tempo "=72"
  const bold = marks.filter(m => m.r.bold).sort((p, q) => p.r.x0 - q.r.x0)
  const chordMarks = marks.filter(m => !m.r.bold && !m.r.italic)
  for (const { s, r } of chordMarks)
    perStaff
      .get(s)
      ?.marks.push(group('harm', [node2('text', { x: num(r.x0), y: num(r.y) }, [], r.text)]))
  // Directions: italic words on a line are one instruction ("2nd time to Coda"), and a sign is a lone
  // character of the music font over the staff; each goes to the measure it ends over
  const dirAt = (s: Staff & { sys: number }, x: number) =>
    staves.find(o => o.sys === s.sys && inX(o, x)) ?? s
  const directions: { s: Staff & { sys: number }; text: string }[] = []
  const italics = marks.filter(m => m.r.italic && !m.r.bold).sort((p, q) => p.r.x0 - q.r.x0)
  const usedItalic = new Set<(typeof italics)[number]>()
  for (const first of italics) {
    if (usedItalic.has(first)) continue
    usedItalic.add(first)
    let text = first.r.raw
    let end = first.r.x1
    for (const next of italics) {
      if (
        usedItalic.has(next) ||
        Math.abs(next.r.y - first.r.y) > 30 ||
        next.r.x0 < end - 5 ||
        next.r.x0 - end > 250
      )
        continue
      usedItalic.add(next)
      text += ` ${next.r.raw}`
      end = next.r.x1
    }
    directions.push({ s: dirAt(first.s as Staff & { sys: number }, end - 100), text })
  }
  for (const u of units) {
    if (!/^[\ue047\ue048]+$/.test(u.raw.trim())) continue
    const above = staves
      .filter(
        s =>
          inX(s, u.x0 + 100) && u.y < (s.ys[0] as number) + 200 && (s.ys[0] as number) - u.y < 2600
      )
      .sort((p, q) => (p.ys[0] as number) - (q.ys[0] as number))[0]
    if (above) directions.push({ s: above, text: u.raw })
  }
  const dirSeen = new Set<string>()
  for (const { s, text } of directions) {
    const d = parseDirection(text)
    // (the coda's sign and its label are one direction, and so are a segno's)
    const sign = d?.kind === 'segno' || d?.kind === 'coda'
    const key = `${staves.indexOf(s)}|${d?.kind}|${d?.time}|${sign ? '' : d?.text}`
    if (!d || dirSeen.has(key)) continue
    dirSeen.add(key)
    const el = group('dir')
    el.attrs['data-kind'] = d.kind
    el.attrs['data-al'] = d.al ?? ''
    el.attrs['data-time'] = d.time === null ? '' : String(d.time)
    el.attrs['data-text'] = d.text
    perStaff.get(s)?.marks.push(el)
  }
  // Bold words on a line next to each other are one name; the box can run over a barline, so join before placing
  const used = new Set<(typeof bold)[number]>()
  for (const first of bold) {
    if (used.has(first)) continue
    used.add(first)
    let text = first.r.text
    let end = first.r.x1
    for (const next of bold) {
      if (
        used.has(next) ||
        Math.abs(next.r.y - first.r.y) > 30 ||
        next.r.x0 < end - 5 ||
        next.r.x0 - end > 250
      )
        continue
      used.add(next)
      text += ` ${next.r.text}`
      end = next.r.x1
    }
    if (/^=\s*\d+$/.test(text))
      perStaff
        .get(first.s)
        ?.marks.push(group('tempo', [node2('text', { x: num(first.r.x0) }, [], text)]))
    else if (!/^\(?[\d,\s]+\)?$/.test(text))
      perStaff
        .get(first.s)
        ?.marks.push(group('reh', [node2('text', { x: num(first.r.x0) }, [], text)])) // a bare number is the ending's
  }
  // Lyrics: a row of baselines for each verse under a system; a bar after a syllable is its hyphen or extender
  const systemRows = new Map<number, number[]>()
  for (const [s, ys] of rows) {
    const list = systemRows.get((s as Staff & { sys: number }).sys) ?? []
    for (const y of ys) if (!list.some(v => Math.abs(v - y) < 60)) list.push(y)
    systemRows.set(
      (s as Staff & { sys: number }).sys,
      list.sort((a, b) => a - b)
    )
  }
  for (const { s, r } of lyrics) {
    const list = systemRows.get((s as Staff & { sys: number }).sys) as number[]
    const row = list.findIndex(v => Math.abs(v - r.y) < 60)
    // the bar sits between this syllable and the next on its row (a hyphen is centred in the gap)
    const next = lyrics
      .filter(o => o.s.sys === s.sys && Math.abs(o.r.y - r.y) < 60 && o.r.x0 > r.x0 + 1)
      .reduce((m, o) => Math.min(m, o.r.x0), r.x1 + 1500)
    const bar = bars.find(
      b =>
        b.minX >= r.x0 + 0.3 * (r.x1 - r.x0) &&
        b.minX < next &&
        Math.abs((b.minY + b.maxY) / 2 - (r.y - 70)) < 120
    )
    perStaff.get(s)?.syls.push({
      x0: r.x0,
      x1: r.x1,
      row,
      text: r.text,
      connector: bar ? (bar.maxX - bar.minX > 150 ? 'extender' : 'hyphen') : '',
    })
  }
  // The title is the biggest word above the first staff; the rest above, and the words below the last, are the notice
  const head = left.filter(r => r.y < top - 1500).sort((a, b) => a.y - b.y || a.x0 - b.x0)
  const foot = left
    .filter(r => r.y > bottom + 1500 && r.size < 330)
    .sort((a, b) => a.y - b.y || a.x0 - b.x0)
  const lines = (rs: typeof units) => {
    const out: { y: number; x: number; text: string }[] = []
    for (const r of rs) {
      const l = out.find(o => Math.abs(o.y - r.y) < 30)
      if (l) l.text += ` ${r.text}`
      else out.push({ y: r.y, x: r.x0, text: r.text })
    }
    return out
  }
  const bigHead = head.reduce<(typeof units)[number] | null>(
    (b, r) => (!b || r.size > b.size ? r : b),
    null
  )
  const headEl =
    bigHead && bigHead.size > 550
      ? group('pgHead', [
          ...lines(
            head.filter(r => r === bigHead || (bigHead && Math.abs(r.y - bigHead.y) < 30))
          ).map(l => textEl(l.text, l.x, l.y)),
          ...lines(head.filter(r => !(bigHead && Math.abs(r.y - bigHead.y) < 30))).map(l =>
            textEl(l.text, l.x, l.y)
          ),
        ])
      : null
  const footEl = foot.length
    ? group(
        'pgFoot',
        lines(foot).map(l => textEl(l.text, l.x, l.y))
      )
    : null
  return { perStaff, header: headEl, footer: footEl }
}

/**
 * Each verse row's syllables go to the heads in order: the syllables left to right to the heads left to
 * right, with the least total distance between a syllable and its head (a syllable under a tied note, or a
 * note with no word, is skipped). Each row is a `verse` of its own on the note, as the SVG has it.
 */
function attachSyllables(syls: Syl[], notes: { x: number; el: El; cue: boolean }[]) {
  const sung = notes.filter(n => !n.cue).sort((p, q) => p.x - q.x)
  const words = syls.filter(s => !/^\d+\.$/.test(s.text))
  if (!words.length || !sung.length) return
  const rows = Math.max(...syls.map(s => s.row)) + 1
  const SKIP = 600
  const mine = new Map<El, Syl[]>()
  for (let row = 0; row < rows; row++) {
    const ss = words.filter(s => s.row === row).sort((p, q) => p.x0 - q.x0)
    // a syllable starts a little left of its head: its first letter is under the head's left edge
    const LEFT = 150
    const cost = (i: number, j: number) =>
      Math.abs((ss[i] as Syl).x0 - ((sung[j] as (typeof sung)[number]).x - LEFT))
    // best[i][j]: the least cost of placing the first i syllables among the first j heads
    const best: number[][] = Array.from({ length: ss.length + 1 }, () =>
      new Array<number>(sung.length + 1).fill(Infinity)
    )
    for (let j = 0; j <= sung.length; j++) (best[0] as number[])[j] = 0
    for (let i = 1; i <= ss.length; i++)
      for (let j = 0; j <= sung.length; j++) {
        let b = ((best[i - 1] as number[])[j] as number) + SKIP // the syllable is left without a head
        if (j > 0) {
          b = Math.min(
            b,
            (best[i] as number[])[j - 1] as number,
            ((best[i - 1] as number[])[j - 1] as number) + cost(i - 1, j - 1)
          )
        }
        ;(best[i] as number[])[j] = b
      }
    // walk back
    let i = ss.length
    let j = sung.length
    while (i > 0 && j >= 0) {
      const here = (best[i] as number[])[j] as number
      if (
        j > 0 &&
        Math.abs(here - (((best[i - 1] as number[])[j - 1] as number) + cost(i - 1, j - 1))) < 1e-9
      ) {
        const el = (sung[j - 1] as (typeof sung)[number]).el
        mine.set(el, [...(mine.get(el) ?? []), ss[i - 1] as Syl])
        i--
        j--
      } else if (j > 0 && Math.abs(here - ((best[i] as number[])[j - 1] as number)) < 1e-9) j--
      else i--
    }
  }
  for (const [el, list] of mine) {
    for (let row = 0; row < rows; row++) {
      const s = list.find(x => x.row === row)
      const syl = group('syl', [
        node2('text', {}, [], s?.text ?? ''),
        ...(s?.connector
          ? [node('rect', { width: s.connector === 'extender' ? '300' : '98', height: '22' })]
          : []),
      ])
      el.children.push(group('verse', [syl]))
    }
  }
}
