/**
 * A minimal ChordPro chart from a song's details alone, for a song SongSelect has lyrics for but
 * no ChordPro chart. The details are what SongSelect's own song page loads (`GetSongDetails`):
 * the title, authors, CCLI number, copyright, default key and tempo, and the lyrics as parts
 * (a label like "Verse 1", and its lines joined with " | "). The result has the metadata as
 * directives and each part as a `{comment: Verse 1}` line and its lyrics, as SongSelect's own
 * charts have, so chords can be added in the editor. It has no time signature: SongSelect has none.
 */

/** The parts of SongSelect's song details this reads (all it needs; the rest is ignored) */
export interface SongDetails {
  title?: string
  authors?: { label?: string }[]
  ccliSongNumber?: string
  copyrights?: string
  defaultKey?: string[]
  bpm?: string | number
  lyrics?: { partLabel?: string; lyrics?: string }[]
}

/** Text for a directive's value: no braces to end it early */
const plain = (value: string) => value.replace(/[{}]/g, '').trim()

/** The ChordPro for the details, or null if they have no title or no lyrics */
export function songDetailsToChordpro(details: SongDetails): string | null {
  const title = plain(details.title ?? '')
  const body: string[] = []
  for (const part of details.lyrics ?? []) {
    const lines = (part.lyrics ?? '')
      .split('|')
      .map(line => line.trim())
      .filter(Boolean)
    if (!lines.length) continue
    const label = plain(part.partLabel ?? '')
    body.push(...(label ? [`{comment: ${label}}`] : []), ...lines, '')
  }
  if (!title || !body.length) return null

  const authors = (details.authors ?? []).map(author => plain(author.label ?? '')).filter(Boolean)
  const key = details.defaultKey?.[0]
  const tempo = Number(details.bpm)
  const directives = [
    `{title: ${title}}`,
    authors.length && `{artist: ${authors.join(', ')}}`,
    key && `{key: ${plain(key)}}`,
    tempo > 0 && `{tempo: ${Math.round(tempo)}}`,
    details.ccliSongNumber && `{ccli: ${plain(details.ccliSongNumber)}}`,
    details.copyrights && `{copyright: ${plain(details.copyrights.replace(/^©\s*/, ''))}}`,
  ].filter(Boolean)
  return `${directives.join('\n')}\n\n${body.join('\n')}`.trimEnd() + '\n'
}
