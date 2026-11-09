/**
 * A small XML reader, for the tree `score-read.ts` walks: elements, their attributes and their text.
 * It is for what Verovio and MusicXML files write, so it has what they have (a declaration, a
 * DOCTYPE, comments, CDATA, processing instructions, the five named entities and numeric ones) and
 * nothing else: no namespaces, and no DTD is ever read or fetched, so a file cannot name an entity
 * of its own or an external one (there is no way to ask for one). It does not need the page's
 * `DOMParser`, so it runs in a worker and in Node alike.
 */
/** An element: its name, its attributes, its children, and its text */
export interface El {
  name: string
  attrs: Record<string, string>
  children: El[]
  /** The text directly inside, in order, joined */
  text: string
}

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

// One token: a comment, CDATA, a processing instruction, the start of a DOCTYPE (its end is found by
// `endOfDoctype`: a pattern for its bracketed subset can backtrack without end on a file made to), a tag
// with its attributes, or text
const TOKEN = new RegExp(
  [
    '<!--[\\s\\S]*?-->',
    '<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>',
    '<\\?[\\s\\S]*?\\?>',
    '<!DOCTYPE',
    '<(\\/?)([\\w:.-]+)((?:\\s+[\\w:.-]+\\s*=\\s*(?:"[^"]*"|\'[^\']*\'))*)\\s*(\\/?)>',
    '([^<]+)',
  ].join('|'),
  'g'
)
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** Where a DOCTYPE that starts at `from` ends, past its `>`: an internal subset in brackets is skipped, and one that is not closed ends the document */
function endOfDoctype(xml: string, from: number): number {
  const bracket = xml.indexOf('[', from)
  const close = xml.indexOf('>', from)
  if (bracket === -1 || (close !== -1 && close < bracket))
    return close === -1 ? xml.length : close + 1
  const subsetEnd = xml.indexOf(']', bracket)
  const end = subsetEnd === -1 ? -1 : xml.indexOf('>', subsetEnd)
  return end === -1 ? xml.length : end + 1
}

/** The root element of the document, or undefined if it has none */
export function parseXml(xml: string): El | undefined {
  const root: El = { name: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  TOKEN.lastIndex = 0
  for (let m = TOKEN.exec(xml); m; m = TOKEN.exec(xml)) {
    if (m[0] === '<!DOCTYPE') {
      TOKEN.lastIndex = endOfDoctype(xml, TOKEN.lastIndex)
      continue
    }
    const top = stack[stack.length - 1] as El
    const [, cdata, closing, name, attrs, selfClosing, text] = m
    if (cdata !== undefined) {
      top.text += cdata
    } else if (text !== undefined) {
      if (text.trim()) top.text += decode(text)
    } else if (name === undefined) {
      // a comment or processing instruction
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
