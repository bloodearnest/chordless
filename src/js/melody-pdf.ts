/**
 * Reads a SongSelect lead sheet PDF's drawing into the tree the preview's SVG gives
 * (`melody-svg.ts` reads that), so the lengths, pitches and measure sums are worked out in one place.
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
import { GLYPHS } from './melody-glyphs.ts'
import { absolutePath, shapeHash } from './melody-path.ts'
import { type El, parseXml } from './melody-svg.ts'

interface Line {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
}
interface Glyph {
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
export function pdfPageToTree(svg: string, warnings: string[]): El | null {
  const root = parseXml(svg)
  const lines: Line[] = []
  const hooks: { hookX: number; endX: number; y: number }[] = []
  const glyphs: Glyph[] = []
  const polys: Poly[] = []
  const dots: { x: number; y: number }[] = []
  const curves: { d: string; minX: number; maxX: number; minY: number; maxY: number }[] = []

  // The units of the original drawing: the staff lines are the stroked horizontals with the commonest matrix
  type M = { a: number; d: number; e: number; f: number }
  const matrices: M[] = []
  const items: { el: El; m: M }[] = []
  const walk = (e: El, inDefs: boolean) => {
    for (const c of e.children) {
      const defs = inDefs || c.name === 'defs' || c.name === 'clipPath'
      if (c.name === 'path' && !defs && !c.attrs.id) {
        const mm = /matrix\(([^)]*)\)/.exec(c.attrs.transform ?? '')
        if (mm) {
          const v = (mm[1] as string).split(/[ ,]+/).map(Number)
          items.push({
            el: c,
            m: { a: v[0] as number, d: v[3] as number, e: v[4] as number, f: v[5] as number },
          })
        }
      }
      walk(c, defs)
    }
  }
  walk(root, false)
  // the unit matrix: the one most stroked straight lines are drawn in
  const votes = new Map<string, number>()
  for (const { el, m } of items)
    if (el.attrs.stroke && m.d > 0)
      votes.set(`${m.a}|${m.e}|${m.f}`, (votes.get(`${m.a}|${m.e}|${m.f}`) ?? 0) + 1)
  const best = [...votes].sort((a, b) => b[1] - a[1])[0]
  if (!best) return null
  const [ua, ue, uf] = best[0].split('|').map(Number) as [number, number, number]
  void matrices

  for (const { el, m } of items) {
    const stroked = !!el.attrs.stroke
    if (stroked) {
      const w = Number(el.attrs['stroke-width'] ?? 0)
      if (w <= 1) continue // the hairline mutool draws over every filled shape
      if (Math.abs(m.a - ua) > 1e-9 || m.d <= 0) continue
      const p = absolutePath(el.attrs.d ?? '')
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
    const p = absolutePath(el.attrs.d ?? '')
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
    } else if (Math.abs(m.a - ua) < 1e-9) {
      const { box } = p
      const w = box.maxX - box.minX
      const h = box.maxY - box.minY
      const hasCurve = /C/.test(p.key)
      if (hasCurve && w < 80 && h < 80)
        dots.push({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 })
      else if (hasCurve)
        curves.push({
          d: el.attrs.d ?? '',
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
          d: el.attrs.d ?? '',
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
    const s = staffFor((p.minX + p.maxX) / 2, (p.minY + p.maxY) / 2)
    if (s && p.maxY - p.minY >= 50) perStaff.get(s)?.polys.push(p) // a beam, not a hyphen
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

  const page = group('page-margin')
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
        },
        warnings
      )
    )
  }
  page.children.push(...systems)
  return node('svg', {}, [page])
}

interface Staff {
  x0: number
  x1: number
  ys: number[]
}

function buildMeasure(
  s: Staff,
  c: {
    tuplets: { x: number; y: number; from: number | null; to: number | null; g: Glyph }[]
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
  for (const [st, hs] of byStem) {
    const makeNote = (h: Glyph, own: El[]): El => {
      const note = group('note', [group('notehead', [useOf(h)]), ...own])
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
