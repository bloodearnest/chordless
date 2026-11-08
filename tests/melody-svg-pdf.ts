/**
 * A lead sheet as a PDF, made from Verovio's SVG of a melody: for the tests of the PDF reader
 * (`melody-pdfjs.ts`) without a CCLI sheet. SongSelect's PDFs are IronPdf printing the same Verovio
 * SVG, so what matters is that nothing is changed on the way: every glyph keeps its own path (the
 * reader tells a notehead from a clef by the shape of its outline, and a general converter bakes
 * the placing into the coordinates, which changes it), and is put on the page by a matrix, as the
 * SVG puts it. Lines are stroked, noteheads and stems filled, words are real text.
 *
 * It does what Verovio writes and nothing more: `svg` with a viewBox, `g`, `use`, `path`, `rect`,
 * `polygon`, `text` and `tspan`, and the transforms `translate`, `scale` and `matrix`.
 */
import type { El } from '../src/js/melody-read.ts'
import { parseXml } from '../src/js/xml.ts'

/** CSS pixels to PDF points */
const POINTS = 0.75

type Matrix = [number, number, number, number, number, number]

/** A number as PDF writes it: no exponent, and no noise from the arithmetic */
const n = (value: number) => String(Math.round(value * 1e5) / 1e5)

function parseTransform(value: string | undefined): Matrix | null {
  if (!value) return null
  let m: Matrix = [1, 0, 0, 1, 0, 0]
  for (const [, name, args] of value.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const a = (args ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
    let t: Matrix
    if (name === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]
    else if (name === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]
    else if (name === 'matrix') t = a as Matrix
    else throw new Error(`unsupported transform: ${name}`)
    m = [
      m[0] * t[0] + m[2] * t[1],
      m[1] * t[0] + m[3] * t[1],
      m[0] * t[2] + m[2] * t[3],
      m[1] * t[2] + m[3] * t[3],
      m[0] * t[4] + m[2] * t[5] + m[4],
      m[1] * t[4] + m[3] * t[5] + m[5],
    ]
  }
  return m
}

const cm = (m: Matrix) => `${m.map(n).join(' ')} cm`

/** Path data as PDF path operators, every command made absolute and every curve a cubic one (the only ones a PDF has) */
function pathOps(d: string): string {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  const out: string[] = []
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let ctrl: [number, number] | null = null
  let i = 0
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i] as string)) cmd = tokens[i++] as string
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    switch (cmd.toUpperCase()) {
      case 'M':
        x = ox + num()
        y = oy + num()
        sx = x
        sy = y
        out.push(`${n(x)} ${n(y)} m`)
        cmd = rel ? 'l' : 'L'
        ctrl = null
        break
      case 'L':
        x = ox + num()
        y = oy + num()
        out.push(`${n(x)} ${n(y)} l`)
        ctrl = null
        break
      case 'H':
        x = ox + num()
        out.push(`${n(x)} ${n(y)} l`)
        ctrl = null
        break
      case 'V':
        y = oy + num()
        out.push(`${n(x)} ${n(y)} l`)
        ctrl = null
        break
      case 'C':
      case 'S': {
        let [x1, y1] = [x, y]
        if (cmd.toUpperCase() === 'C') {
          x1 = ox + num()
          y1 = oy + num()
        } else if (ctrl) {
          x1 = 2 * x - ctrl[0]
          y1 = 2 * y - ctrl[1]
        }
        const x2 = ox + num()
        const y2 = oy + num()
        const x3 = ox + num()
        const y3 = oy + num()
        out.push(`${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x3)} ${n(y3)} c`)
        ctrl = [x2, y2]
        x = x3
        y = y3
        break
      }
      case 'Q': {
        const qx = ox + num()
        const qy = oy + num()
        const x3 = ox + num()
        const y3 = oy + num()
        out.push(
          `${n(x + (2 / 3) * (qx - x))} ${n(y + (2 / 3) * (qy - y))} ${n(x3 + (2 / 3) * (qx - x3))} ${n(y3 + (2 / 3) * (qy - y3))} ${n(x3)} ${n(y3)} c`
        )
        x = x3
        y = y3
        ctrl = null
        break
      }
      case 'Z':
        out.push('h')
        x = sx
        y = sy
        ctrl = null
        break
      default:
        throw new Error(`unsupported path command: ${cmd}`)
    }
  }
  return out.join(' ')
}

/** The music font's resource name (it is not embedded: its characters are named by code point, as pdf.js reads them) */
const MUSIC = 'Leipzig'

const FONTS = ['Times-Roman', 'Times-Italic', 'Times-Bold', 'Times-BoldItalic'] as const

/** What Verovio's stylesheet makes bold and italic: by the class of the group a text is in */
const BOLD = new Set(['ending', 'fing', 'reh', 'tempo'])
const ITALIC = new Set(['dir', 'dynam', 'mNum'])

interface Page {
  ops: string[]
  /** The characters of the music font (private-use code points) the document uses, and the one-byte code each is written as */
  music: Map<string, number>
  /** The width of the viewport and its height, in points */
  width: number
  height: number
}

/** `ctx`: the classes of the groups the element is in, for the font of a text */
function draw(el: El, defs: Map<string, El>, page: Page, classes: Set<string>, viewport: number[]) {
  const transform = parseTransform(el.attrs.transform)
  const wrap = (body: () => void) => {
    if (!transform) return body()
    page.ops.push('q', cm(transform))
    body()
    page.ops.push('Q')
  }
  const children = (cls: Set<string>, vp = viewport) => {
    for (const child of el.children) draw(child, defs, page, cls, vp)
  }
  const own = new Set(classes)
  for (const c of (el.attrs.class ?? '').split(/\s+/)) if (c) own.add(c)

  switch (el.name) {
    case 'svg': {
      const box = (el.attrs.viewBox ?? '').split(/[\s,]+/).map(Number)
      const [bx = 0, by = 0, bw = viewport[0] ?? 0, bh = viewport[1] ?? 0] = box
      const w = Number.parseFloat(el.attrs.width ?? '') || (viewport[0] as number)
      const h = Number.parseFloat(el.attrs.height ?? '') || (viewport[1] as number)
      const s = Math.min(w / bw, h / bh)
      page.ops.push(
        'q',
        cm([s, 0, 0, s, Number(el.attrs.x ?? 0) - bx * s, Number(el.attrs.y ?? 0) - by * s])
      )
      children(own, [bw, bh])
      page.ops.push('Q')
      return
    }
    case 'defs':
    case 'style':
    case 'desc':
      return
    case 'g':
      return wrap(() => children(own))
    case 'use': {
      const id = (el.attrs.href ?? el.attrs['xlink:href'] ?? '').replace(/^#/, '')
      const target = defs.get(id)
      if (!target) throw new Error(`no definition for #${id}`)
      // (the segno and coda signs are characters of the music font in a SongSelect sheet, not paths)
      const sign = /^E04([78])-/.exec(id)
      if (sign && transform) {
        const ch = String.fromCodePoint(Number(`0xE04${sign[1]}`))
        if (!page.music.has(ch)) page.music.set(ch, page.music.size + 1)
        page.ops.push(
          'q',
          'BT',
          `/${MUSIC} ${n(1000 * transform[0])} Tf`,
          `1 0 0 -1 ${n(transform[4])} ${n(transform[5])} Tm`,
          `(\\${(page.music.get(ch) as number).toString(8).padStart(3, '0')}) Tj`,
          'ET',
          'Q'
        )
        return
      }
      const x = Number(el.attrs.x ?? 0)
      const y = Number(el.attrs.y ?? 0)
      return wrap(() => {
        page.ops.push('q')
        if (x || y) page.ops.push(cm([1, 0, 0, 1, x, y]))
        draw(target, defs, page, own, viewport)
        page.ops.push('Q')
      })
    }
    case 'path': {
      const width = el.attrs['stroke-width']
      return wrap(() => {
        if (width) page.ops.push(`${n(Number(width))} w`)
        page.ops.push(pathOps(el.attrs.d ?? ''), width ? 'S' : 'f')
      })
    }
    case 'rect': {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map(k => Number(el.attrs[k] ?? 0)) as [
        number,
        number,
        number,
        number,
      ]
      const outline = el.attrs['fill-opacity'] === '0'
      return wrap(() => {
        if (outline) page.ops.push(`${n(Number(el.attrs['stroke-width'] ?? 1))} w`)
        page.ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re`, outline ? 'S' : 'f')
      })
    }
    case 'ellipse': {
      // (a dot: four curves, as a PDF draws a circle)
      const [cx, cy, rx, ry] = ['cx', 'cy', 'rx', 'ry'].map(k => Number(el.attrs[k] ?? 0)) as [
        number,
        number,
        number,
        number,
      ]
      const k = 0.5523
      const d = `M${cx + rx} ${cy}C${cx + rx} ${cy + k * ry} ${cx + k * rx} ${cy + ry} ${cx} ${cy + ry}C${cx - k * rx} ${cy + ry} ${cx - rx} ${cy + k * ry} ${cx - rx} ${cy}C${cx - rx} ${cy - k * ry} ${cx - k * rx} ${cy - ry} ${cx} ${cy - ry}C${cx + k * rx} ${cy - ry} ${cx + rx} ${cy - k * ry} ${cx + rx} ${cy}Z`
      return wrap(() => page.ops.push(pathOps(d), 'f'))
    }
    case 'polyline': {
      // (a tuplet's bracket: a line with its hooks)
      const points = (el.attrs.points ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
      const d = Array.from(
        { length: points.length / 2 },
        (_, i) => `${i ? 'L' : 'M'}${points[2 * i]} ${points[2 * i + 1]}`
      )
      return wrap(() =>
        page.ops.push(`${n(Number(el.attrs['stroke-width'] ?? 1))} w`, pathOps(d.join('')), 'S')
      )
    }
    case 'polygon': {
      const points = (el.attrs.points ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
      const d = Array.from(
        { length: points.length / 2 },
        (_, i) => `${i ? 'L' : 'M'}${points[2 * i]} ${points[2 * i + 1]}`
      )
      return wrap(() => page.ops.push(pathOps(`${d.join('')}Z`), 'f'))
    }
    case 'text': {
      return wrap(() => {
        const bold = [...own].some(c => BOLD.has(c))
        const italic = [...own].some(c => ITALIC.has(c))
        const font = FONTS[(bold ? 2 : 0) + (italic ? 1 : 0)] as string
        page.ops.push('BT')
        const anchor = el.attrs['text-anchor']
        const across = anchor === 'middle' ? 0.5 : anchor === 'end' ? 1 : 0
        const x = Number(el.attrs.x ?? 0) - across * widthOf(el, 0, false)
        // (the text's own x and y are in the pen, shifted by its anchor)
        const pen = { x, y: Number(el.attrs.y ?? 0), size: 0, font, moved: true }
        for (const child of el.children) textOps(child, page, pen)
        page.ops.push('ET')
      })
    }
    default:
      return
  }
}

/** The widths of Times-Roman's printable ASCII, from a space, in thousandths of the size: enough to centre or right-align a text */
const TIMES = [
  250, 333, 408, 500, 500, 833, 778, 333, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611,
  556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722,
  722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500,
  278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541,
]

/** How wide a text is, with the size each of its tspans gives it (the music font's characters are taken to be 0.4 of the size) */
function widthOf(el: El, size: number, music: boolean): number {
  const s = Number.parseFloat(el.attrs['font-size'] ?? '') || size
  const m = music || /Leipzig/i.test(el.attrs['font-family'] ?? '')
  if (el.children.length) return el.children.reduce((sum, c) => sum + widthOf(c, s, m), 0)
  let total = 0
  for (const ch of el.text.trim()) total += m ? 400 : (TIMES[ch.charCodeAt(0) - 32] ?? 500)
  return (total * s) / 1000
}

/** Where the next word of a text goes, and in what: it follows the one before unless a tspan says where */
interface Pen {
  x: number
  y: number
  size: number
  font: string
  /** The text matrix has to be set before the next word */
  moved: boolean
}

/**
 * A text's tspans, in order: each leaf is shown in its font and size. A tspan with no position
 * carries on from the end of the one before, which the PDF does by itself as it shows the words.
 */
function textOps(el: El, page: Page, pen: Pen) {
  if (el.attrs.x !== undefined || el.attrs.y !== undefined) {
    pen.x = Number(el.attrs.x ?? pen.x)
    pen.y = Number(el.attrs.y ?? pen.y)
    pen.moved = true
  }
  const [was, wasFont] = [pen.size, pen.font]
  pen.size = Number.parseFloat(el.attrs['font-size'] ?? '') || pen.size
  const music = /Leipzig/i.test(el.attrs['font-family'] ?? '')
  if (music) pen.font = MUSIC
  for (const child of el.children) textOps(child, page, pen)
  const text = el.text.trim()
  if (text && !el.children.length) {
    // (the PDF's own text space is y up, and the page is flipped to y down: flip the text back)
    if (pen.moved) page.ops.push(`1 0 0 -1 ${n(pen.x)} ${n(pen.y)} Tm`)
    pen.moved = false
    let shown = ''
    for (const ch of text) {
      if (pen.font !== MUSIC) shown += /[\\()]/.test(ch) ? `\\${ch}` : ch
      else {
        if (!page.music.has(ch)) page.music.set(ch, page.music.size + 1)
        shown += `\\${(page.music.get(ch) as number).toString(8).padStart(3, '0')}`
      }
    }
    page.ops.push(`/${pen.font} ${n(pen.size)} Tf`, `(${shown}) Tj`)
  }
  pen.size = was
  pen.font = wasFont
}

/** The music font: no program in it, only the names of the glyphs the document shows (uniE262 is U+E262) and how wide each is */
function musicFont(music: Map<string, number>): string {
  const codes = [...music.entries()].sort((a, b) => a[1] - b[1])
  const names = codes.map(
    ([ch]) => `/uni${(ch.codePointAt(0) as number).toString(16).toUpperCase()}`
  )
  return `<< /Type /Font /Subtype /Type1 /BaseFont /${MUSIC} /FirstChar 1 /LastChar ${Math.max(1, codes.length)} /Widths [${codes.map(() => 400).join(' ') || 400}] /Encoding << /Type /Encoding /Differences [1 ${names.join(' ')}] >> >>`
}

/** One page's content stream, and its size in points */
function pageOf(
  svg: string,
  music: Map<string, number>
): { content: string; width: number; height: number } {
  const root = parseXml(svg)
  if (!root || root.name !== 'svg') throw new Error('not an SVG')
  const defs = new Map<string, El>()
  const collect = (el: El) => {
    if (el.attrs.id && el.name !== 'svg') defs.set(el.attrs.id, el)
    for (const child of el.children) collect(child)
  }
  collect(root)
  const [, , w = 0, h = 0] = (root.attrs.viewBox ?? '').split(/[\s,]+/).map(Number)
  const page: Page = { ops: [], music, width: w * POINTS, height: h * POINTS }
  // (the page is y down, as the SVG is, and in points)
  page.ops.push(cm([POINTS, 0, 0, -POINTS, 0, h * POINTS]))
  for (const child of root.children) draw(child, defs, page, new Set(), [w, h])
  return { content: page.ops.join('\n'), width: page.width, height: page.height }
}

/** The PDF of the pages of Verovio's SVG, one page each */
export function svgToPdf(svgs: string[]): ArrayBuffer {
  const music = new Map<string, number>()
  const pages = svgs.map(svg => pageOf(svg, music))
  // objects: 1 catalog, 2 pages, 3-6 fonts, 7 the music font, then a page and its content for each page
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${8 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ...FONTS.map(f => `<< /Type /Font /Subtype /Type1 /BaseFont /${f} >>`),
    musicFont(music),
  ]
  for (const [i, { content, width, height }] of pages.entries()) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(width)} ${n(height)}] /Contents ${9 + 2 * i} 0 R /Resources << /Font << ${FONTS.map((f, k) => `/${f} ${3 + k} 0 R`).join(' ')} /${MUSIC} 7 0 R >> >> >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    )
  }
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [i, body] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf).buffer as ArrayBuffer
}
