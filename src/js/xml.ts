/**
 * A small XML reader, for the tree `melody-read.ts` walks: elements, their attributes and their text.
 * It is for what Verovio and MusicXML files write, so it has what they have (a declaration, a
 * DOCTYPE, comments, CDATA, processing instructions, the five named entities and numeric ones) and
 * nothing else: no namespaces, and no DTD is ever read or fetched, so a file cannot name an entity
 * of its own or an external one (there is no way to ask for one). It does not need the page's
 * `DOMParser`, so it runs in a worker and in Node alike.
 */
import type { El } from './melody-read.ts'

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e] ?? m
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    // (a number that is no character is left as it was written)
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
  })
}

// One token: a comment, CDATA, a declaration or DOCTYPE (with an internal subset in brackets, which
// is skipped), a tag with its attributes, or text
const TOKEN = new RegExp(
  [
    '<!--[\\s\\S]*?-->',
    '<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>',
    '<\\?[\\s\\S]*?\\?>',
    '<!DOCTYPE(?:[^>\\[]|\\[[\\s\\S]*?\\])*>',
    '<(\\/?)([\\w:.-]+)((?:\\s+[\\w:.-]+\\s*=\\s*(?:"[^"]*"|\'[^\']*\'))*)\\s*(\\/?)>',
    '([^<]+)',
  ].join('|'),
  'g'
)
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** The root element of the document, or undefined if it has none */
export function parseXml(xml: string): El | undefined {
  const root: El = { name: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  for (const m of xml.matchAll(TOKEN)) {
    const top = stack[stack.length - 1] as El
    const [, cdata, closing, name, attrs, selfClosing, text] = m
    if (cdata !== undefined) {
      top.text += cdata
    } else if (text !== undefined) {
      if (text.trim()) top.text += decode(text)
    } else if (name === undefined) {
      // a comment, declaration, DOCTYPE or processing instruction
    } else if (closing) {
      if (stack.length > 1) stack.pop()
    } else {
      const el: El = { name, attrs: {}, children: [], text: '' }
      for (const a of (attrs ?? '').matchAll(ATTRIBUTE))
        el.attrs[a[1] as string] = decode(a[2] ?? a[3] ?? '')
      top.children.push(el)
      if (!selfClosing) stack.push(el)
    }
  }
  return root.children[0]
}
