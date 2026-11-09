/**
 * Reads the melody out of a SongSelect lead sheet PDF, with pdf.js (through unpdf): the page's paths and matrices from its operator list, its words from the text content, and
 * from them `score-pdf.ts` builds the notes. Needs nothing but the PDF.
 */
import { getDocumentProxy, getResolvedPDFJS } from 'unpdf'
import type { Score } from './score.ts'
import { type DrawItem, pdfPageToTree, type TextRun } from './score-pdf.ts'
import { type ReadStats, readScoreTrees } from './score-read.ts'
import type { El } from './xml.ts'

type Matrix = [number, number, number, number, number, number]

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

/** pdf.js's path (a code, then its numbers: 0 move, 1 line, 2 curve, 3 quadratic curve, 4 close) as SVG path data */
function pathData(path: ArrayLike<number>): string {
  const letters = ['M', 'L', 'C', 'Q', 'Z']
  const lengths = [2, 2, 6, 4, 0]
  const out: string[] = []
  for (let i = 0; i < path.length; i += 1 + (lengths[path[i] as number] as number)) {
    const code = path[i] as number
    out.push(
      `${letters[code]}${Array.from({ length: lengths[code] as number }, (_, k) => path[i + 1 + k]).join(' ')}`
    )
  }
  return out.join('')
}

/** A character as it is drawn: where it starts and ends along the line, the baseline, the size, and its font */
interface Char {
  ch: string
  x0: number
  x1: number
  y: number
  size: number
  font: string
  space: boolean
  /** The text object it is in: each text of the SVG is one, and so is each syllable and chord */
  block: number
}

/**
 * The page's operator list as the shapes it paints (with their matrices turned to y down, as the SVG of
 * the page would have them) and the words it shows. Each character is its own text operation in these
 * PDFs, so the words come from where the characters are, not from pdf.js's joined text items (which
 * run syllables that are far apart together with the spaces between).
 */
function readOperators(
  fnArray: number[],
  argsArray: unknown[],
  ops: Record<string, number>,
  height: number,
  fontNames: Map<string, string>
): { items: DrawItem[]; runs: TextRun[] } {
  const items: DrawItem[] = []
  const chars: Char[] = []
  const saved: { m: Matrix; w: number }[] = []
  let matrix: Matrix = [1, 0, 0, 1, 0, 0]
  let width = 1
  /** The text matrix, and the matrix of the start of its line (a move is from there, not from where the last character ended) */
  let text: Matrix = [1, 0, 0, 1, 0, 0]
  let line: Matrix = text
  let font = ''
  let block = 0
  let fontSize = 1
  const stroke = new Set([ops.stroke, ops.closeStroke])
  const fill = new Set([
    ops.fill,
    ops.eoFill,
    ops.fillStroke,
    ops.eoFillStroke,
    ops.closeFillStroke,
    ops.closeEOFillStroke,
  ])
  for (let i = 0; i < fnArray.length; i++) {
    const op = fnArray[i] as number
    const args = argsArray[i]
    if (op === ops.save) saved.push({ m: matrix, w: width })
    else if (op === ops.restore) {
      const s = saved.pop()
      if (s) {
        matrix = s.m
        width = s.w
      }
    } else if (op === ops.transform) matrix = multiply(matrix, args as Matrix)
    else if (op === ops.setLineWidth) width = (args as number[])[0] as number
    else if (op === ops.setGState) {
      for (const [key, value] of (args as [[string, number][]])[0]) if (key === 'LW') width = value
    } else if (op === ops.beginText) {
      text = [1, 0, 0, 1, 0, 0]
      line = text
      block++
    } else if (op === ops.setFont) {
      font = (args as [string, number])[0]
      fontSize = (args as [string, number])[1]
    } else if (op === ops.setTextMatrix) {
      text = Array.from((args as ArrayLike<number>[])[0] as ArrayLike<number>) as Matrix
      line = text
    } else if (op === ops.moveText) {
      const [tx, ty] = args as [number, number]
      line = [
        line[0],
        line[1],
        line[2],
        line[3],
        line[0] * tx + line[2] * ty + line[4],
        line[1] * tx + line[3] * ty + line[5],
      ]
      text = line
    } else if (op === ops.showText) {
      for (const g of (
        args as [({ unicode?: string; width: number; isSpace?: boolean } | number)[]]
      )[0]) {
        if (typeof g === 'number') {
          text = [
            text[0],
            text[1],
            text[2],
            text[3],
            text[4] - (g / 1000) * fontSize * text[0],
            text[5] - (g / 1000) * fontSize * text[1],
          ]
          continue
        }
        const page = multiply(matrix, text)
        const scale = Math.hypot(page[0], page[1])
        const advance = (g.width / 1000) * fontSize
        chars.push({
          ch: g.unicode ?? '',
          x0: page[4],
          x1: page[4] + advance * scale,
          y: height - page[5],
          size: fontSize * Math.hypot(page[2], page[3]),
          font: fontNames.get(font) ?? '',
          block,
          space: !!g.isSpace || g.unicode === ' ' || g.unicode === '\u00a0',
        })
        text = [
          text[0],
          text[1],
          text[2],
          text[3],
          text[4] + advance * text[0],
          text[5] + advance * text[1],
        ]
      }
    } else if (op === ops.constructPath) {
      const [paint, paths] = args as [number, ArrayLike<number>[]]
      const isStroke = stroke.has(paint)
      if (!isStroke && !fill.has(paint)) continue // a clip
      items.push({
        d: paths.map(pathData).join(''),
        m: { a: matrix[0], d: -matrix[3], e: matrix[4], f: height - matrix[5] },
        stroked: isStroke,
        width,
      })
    }
  }
  return { items, runs: wordsOf(chars) }
}

/** Characters into words: a word ends at a space, a new line, or a gap the size of a letter or so (the music font's flat joins its letter) */
function wordsOf(chars: Char[]): TextRun[] {
  const runs: TextRun[] = []
  let cur: TextRun | null = null
  /** Where the last character of the word starts (a character's own width is not to be trusted: the subset fonts have it wrong) */
  let last = 0
  let curBlock = -1
  let lastMusic = false
  for (const c of chars) {
    const music = /Leipzig/i.test(c.font)
    if (c.space || !c.ch) {
      if (cur) runs.push(cur)
      cur = null
      continue
    }
    if (
      cur &&
      ((c.block !== curBlock && !(music || (lastMusic && !/[A-G]/.test(c.ch)))) ||
        Math.abs(c.y - cur.y) > 0.3 * c.size ||
        (c.block !== curBlock && c.x0 - last > 0.95 * Math.max(c.size, cur.size)) ||
        c.x0 < last)
    ) {
      runs.push(cur)
      cur = null
    }
    cur ??= { x0: c.x0, x1: c.x0, y: c.y, size: c.size, bold: false, italic: false, text: '' }
    cur.text += c.ch
    cur.x1 = c.x1
    last = c.x0
    curBlock = c.block
    lastMusic = music
    if (!/Leipzig/i.test(c.font)) {
      cur.size = c.size
      cur.bold = /Bold/i.test(c.font)
      cur.italic = /Italic|Oblique/i.test(c.font)
    }
  }
  if (cur) runs.push(cur)
  return runs
}

/** The melody of a lead sheet PDF, or null if it has none to read (not a lead sheet, or not one of SongSelect's) */
export async function readScorePdf(pdf: ArrayBuffer, stats?: ReadStats): Promise<Score | null> {
  try {
    const pdfjs = await getResolvedPDFJS()
    // (with the extra font properties the fonts keep their names, which say which words are bold)
    const document = await getDocumentProxy(new Uint8Array(pdf), { fontExtraProperties: true })
    const warnings = stats?.warnings ?? []
    const trees: El[] = []
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      const height = (page.view[3] as number) - (page.view[1] as number)
      const { fnArray, argsArray } = await page.getOperatorList()
      // (the fonts are loaded by now, and say by name which words are bold)
      const fontNames = new Map<string, string>()
      for (const [i, op] of fnArray.entries()) {
        if (op !== pdfjs.OPS.setFont) continue
        const id = (argsArray[i] as [string])[0]
        if (!fontNames.has(id) && page.commonObjs.has(id))
          fontNames.set(id, (page.commonObjs.get(id) as { name?: string }).name ?? '')
      }
      const { items, runs } = readOperators(
        fnArray,
        argsArray,
        pdfjs.OPS as Record<string, number>,
        height,
        fontNames
      )
      const tree = pdfPageToTree(items, warnings, runs)
      if (tree) trees.push(tree)
    }
    if (!trees.length) return null
    return readScoreTrees(trees, stats)
  } catch (error) {
    console.warn('Could not read the melody of a PDF:', error)
    return null
  }
}
