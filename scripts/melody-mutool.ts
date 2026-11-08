/**
 * The pages of a PDF as `melody-pdf.ts` takes them, by `mutool` (a command line tool): its SVG output
 * keeps every path and the matrix it was drawn with, and its stext output has the words. The app gets
 * the same from pdf.js (`src/js/melody-pdfjs.ts`); this is for developing against, and for comparing.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DrawItem, TextRun } from '../src/js/melody-pdf.ts'
import type { El } from '../src/js/xml.ts'
import { parseXml } from '../src/js/xml.ts'

/** The paths of a page from `mutool draw -F svg` */
export function drawingFromSvg(svg: string): DrawItem[] {
  const items: DrawItem[] = []
  const walk = (e: El, inDefs: boolean) => {
    for (const c of e.children) {
      const defs = inDefs || c.name === 'defs' || c.name === 'clipPath'
      if (c.name === 'path' && !defs && !c.attrs.id) {
        const mm = /matrix\(([^)]*)\)/.exec(c.attrs.transform ?? '')
        if (mm) {
          const v = (mm[1] as string).split(/[ ,]+/).map(Number)
          items.push({
            d: c.attrs.d ?? '',
            m: { a: v[0] as number, d: v[3] as number, e: v[4] as number, f: v[5] as number },
            stroked: !!c.attrs.stroke,
            width: Number(c.attrs['stroke-width'] ?? 0),
          })
        }
      }
      walk(c, defs)
    }
  }
  walk(parseXml(svg) as El, false)
  return items
}

/**
 * The words on a page from `mutool draw -F stext`: a line's characters split at its spaces. The music
 * font's characters (a chord's flat) stay in the word they are in. In the app these come from pdf.js's
 * text content, which has the same pieces.
 */
export function textRunsFromStext(xml: string): TextRun[] {
  const runs: TextRun[] = []
  const walk = (e: El) => {
    if (e.name === 'line') {
      let cur: TextRun | null = null
      for (const font of e.children) {
        const name = font.attrs.name ?? ''
        const size = Number(font.attrs.size)
        for (const ch of font.children) {
          const q = (ch.attrs.quad ?? '').split(' ').map(Number)
          const c = ch.attrs.c ?? ''
          if (c === ' ' || c === '\u00a0') {
            if (cur) runs.push(cur)
            cur = null
            continue
          }
          if (!cur)
            cur = {
              x0: q[0] as number,
              x1: q[2] as number,
              y: Number(ch.attrs.y),
              size,
              bold: /Bold/i.test(name),
              italic: /Italic|Oblique/i.test(name),
              text: '',
            }
          cur.text += c
          cur.x1 = q[2] as number
          if (!/Leipzig/i.test(name)) {
            cur.bold = /Bold/i.test(name)
            cur.italic = /Italic|Oblique/i.test(name)
            cur.size = size
          }
        }
      }
      if (cur) runs.push(cur)
    } else e.children.forEach(walk)
  }
  walk(parseXml(xml) as El)
  return runs
}

/** Every page of a PDF: its paths and its words */
export function mutoolPages(file: string): { items: DrawItem[]; runs: TextRun[] }[] {
  const dir = mkdtempSync(join(tmpdir(), 'melody-'))
  try {
    execFileSync('mutool', ['draw', '-F', 'svg', '-o', join(dir, 'p-%d.svg'), file], {
      stdio: 'ignore',
    })
    execFileSync('mutool', ['draw', '-F', 'stext', '-o', join(dir, 't-%d.xml'), file], {
      stdio: 'ignore',
    })
    const n = readdirSync(dir).filter(f => f.endsWith('.svg')).length
    return Array.from({ length: n }, (_, i) => ({
      items: drawingFromSvg(readFileSync(join(dir, `p-${i + 1}.svg`), 'utf8')),
      runs: textRunsFromStext(readFileSync(join(dir, `t-${i + 1}.xml`), 'utf8')),
    }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
