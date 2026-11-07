/**
 * Reading the SVG of a `GetSongLeadPreview` response: the oracle the PDF reader is developed against
 * (docs/MELODY.md). Nothing in `src/` uses it: the app reads the PDF alone.
 */
import type { Melody } from '../src/js/melody.ts'
import { type El, type ReadStats, readMelodyTrees } from '../src/js/melody-read.ts'

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      )
    return ENTITIES[e] ?? m
  })
}

/** A small XML reader: elements, attributes and text; no namespaces, DTDs or CDATA, which Verovio does not write */
export function parseXml(xml: string): El {
  const root: El = { name: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  const tag =
    /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<[?!][^>]*>|([^<]+)/g
  const attr = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    const top = stack[stack.length - 1] as El
    if (m[5] !== undefined) {
      if (m[5].trim()) top.text += decode(m[5])
    } else if (m[2] === undefined) {
      // a declaration or comment
    } else if (m[1]) {
      stack.pop()
    } else {
      const el: El = { name: m[2], attrs: {}, children: [], text: '' }
      for (let a = attr.exec(m[3] ?? ''); a; a = attr.exec(m[3] ?? ''))
        el.attrs[a[1] as string] = decode(a[2] ?? a[3] ?? '')
      top.children.push(el)
      if (!m[4]) stack.push(el)
    }
  }
  return root.children[0] as El
}

/** Read the pages' SVG text, in page order, into a melody */
export function readMelodySvg(svgs: string[], stats?: ReadStats): Melody {
  return readMelodyTrees(svgs.map(parseXml), stats)
}
