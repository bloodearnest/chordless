import type { ParsedChart } from '../data-types.ts'

interface SearchableSong {
  title?: string | null
  artist?: string | null
  parsed?: ParsedChart | null
}

const lyricsCache = new WeakMap<ParsedChart, { lines: string[]; lower: string }>()

/** The words of a chart, without its chords or section labels: each line, and all of it lowercased */
function lyricsOf(parsed: ParsedChart) {
  let lyrics = lyricsCache.get(parsed)
  if (!lyrics) {
    const lines = parsed.sections.flatMap(section =>
      section.lines.map(line =>
        line.segments
          .map(s => s.lyrics)
          .join('')
          .trim()
      )
    )
    lyrics = { lines, lower: lines.join('\n').toLowerCase() }
    lyricsCache.set(parsed, lyrics)
  }
  return lyrics
}

/** A search term as the filter uses it */
export function normalizeTerm(searchTerm: string): string {
  return searchTerm.toLowerCase().trim()
}

/** Which of a song's fields contain the search term */
export function matchedFields(song: SearchableSong, searchTerm: string) {
  const term = normalizeTerm(searchTerm)
  return {
    title: !!term && (song.title || '').toLowerCase().includes(term),
    artist: !!term && (song.artist || '').toLowerCase().includes(term),
    lyrics: !!term && !!song.parsed && lyricsOf(song.parsed).lower.includes(term),
  }
}

/**
 * The first lyric line containing the search term, split around the match and cut to about
 * `width` characters either side. Undefined if no single line has it.
 */
export function lyricSnippet(
  parsed: ParsedChart,
  searchTerm: string,
  width = 40
): { before: string; match: string; after: string } | undefined {
  const term = normalizeTerm(searchTerm)
  if (!term) return undefined
  for (const line of lyricsOf(parsed).lines) {
    const lower = line.toLowerCase()
    // Lowercasing can change a string's length; then the positions can't be trusted
    const at = lower.length === line.length ? lower.indexOf(term) : -1
    if (at < 0) continue
    const start = Math.max(0, at - width)
    const end = Math.min(line.length, at + term.length + width)
    return {
      before: (start > 0 ? '…' : '') + line.slice(start, at),
      match: line.slice(at, at + term.length),
      after: line.slice(at + term.length, end) + (end < line.length ? '…' : ''),
    }
  }
  return undefined
}

/**
 * The songs whose title, artist or lyrics contain the search term, ignoring case.
 * An empty search matches every song (and gives back the same array).
 */
export function filterSongs<T extends SearchableSong>(songs: T[], searchTerm: string): T[] {
  if (!normalizeTerm(searchTerm)) return songs
  return songs.filter(song => {
    const found = matchedFields(song, searchTerm)
    return found.title || found.artist || found.lyrics
  })
}
