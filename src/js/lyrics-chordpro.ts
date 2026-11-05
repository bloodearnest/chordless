/**
 * A minimal ChordPro chart from a song's lyrics alone, for a song SongSelect has lyrics for but
 * no ChordPro chart. The lyrics download is plain text: the title, the sections with a heading
 * line each ("Verse 1", "Chorus"), then the credits (authors, "CCLI Song #…", the copyright,
 * SongSelect's terms line, the licence number). The result has the metadata as directives and
 * each section as a `{comment: Verse 1}` line and its lyrics, as SongSelect's own charts have, so
 * chords can be added in the editor. It has no key, time or tempo: the text has none.
 */

/** A line that heads a section: a known section word and perhaps a number or letter ("Verse 2") */
const HEADING =
  /^(?:verse|chorus|pre[- ]?chorus|post[- ]?chorus|bridge|tag|intro|outro|ending|interlude|instrumental|refrain|turnaround|vamp|coda|hook|rap|channel|breakdown|solo)(?:\s+[0-9]+[a-z]?|\s+[a-z])?$/i

const CCLI_NUMBER = /^CCLI Song\s*#\s*(\d+)\s*$/i
const CCLI_LICENCE = /^CCLI Licen[cs]e No\.?\s*(\d+)\s*$/i
const TERMS = /^For use solely with the SongSelect/i
const COPYRIGHT = /^[©(]/

/** Text for a directive's value: no braces to end it early */
const plain = (value: string) => value.replace(/[{}]/g, '').trim()

/**
 * The ChordPro for SongSelect's lyrics text, or null if it is not that: it needs a title and at
 * least one line of lyrics.
 */
export function lyricsToChordpro(text: string): string | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const title = lines.find(line => line.trim())?.trim()
  if (!title) return null

  let ccli = ''
  let licence = ''
  let terms = ''
  let copyright = ''
  let authors = ''
  const blocks: string[][] = []
  let block: string[] = []
  const endBlock = () => {
    if (block.length) blocks.push(block)
    block = []
  }
  let seenTitle = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!seenTitle) {
      if (line) seenTitle = true
      continue
    }
    if (!line) endBlock()
    else if (CCLI_NUMBER.test(line)) {
      ccli = (line.match(CCLI_NUMBER) as RegExpMatchArray)[1]
      // the authors are the line above it, at the end of the last block
      if (block.length) authors = block.pop() as string
      else if (blocks.length && blocks.at(-1)?.length === 1) authors = (blocks.pop() as string[])[0]
      endBlock()
    } else if (CCLI_LICENCE.test(line)) licence = (line.match(CCLI_LICENCE) as RegExpMatchArray)[1]
    else if (TERMS.test(line)) terms = line
    else if (COPYRIGHT.test(line) && ccli) copyright = line.replace(/^©\s*/, '')
    else block.push(line)
  }
  endBlock()

  const body: string[] = []
  for (const lyrics of blocks) {
    let section = lyrics
    // a heading needs lyrics under it: a lone line that looks like one is a lyric
    if (lyrics.length > 1 && HEADING.test(lyrics[0])) {
      body.push(`{comment: ${plain(lyrics[0])}}`)
      section = lyrics.slice(1)
    }
    body.push(...section, '')
  }
  if (!body.some(line => line && !line.startsWith('{comment:'))) return null

  const directives = [
    `{title: ${plain(title)}}`,
    authors && `{artist: ${plain(authors)}}`,
    licence && `{ccli_license: ${licence}}`,
    ccli && `{ccli: ${ccli}}`,
    copyright && `{copyright: ${plain(copyright)}}`,
    terms && `{footer: ${plain(terms)}}`,
  ].filter(Boolean)
  return `${directives.join('\n')}\n\n${body.join('\n')}`.trimEnd() + '\n'
}
