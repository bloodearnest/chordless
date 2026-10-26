import type { ParsedChart } from '../data-types.ts'
import { SongIndex, type WordRange, wordRanges } from './song-search.ts'

interface SearchableSong {
  title?: string | null
  artist?: string | null
  /** What the variant is called */
  variantLabel?: string | null
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
    label: !!term && (song.variantLabel || '').toLowerCase().includes(term),
    lyrics: !!term && !!song.parsed && lyricsOf(song.parsed).lower.includes(term),
  }
}

/** A line split around the match at `at`, cut to about `width` characters either side */
function around(line: string, at: number, length: number, width: number) {
  const start = Math.max(0, at - width)
  const end = Math.min(line.length, at + length + width)
  return {
    before: (start > 0 ? '…' : '') + line.slice(start, at),
    match: line.slice(at, at + length),
    after: line.slice(at + length, end) + (end < line.length ? '…' : ''),
  }
}

/**
 * The first lyric line containing the search term, split around the match and cut to about
 * `width` characters either side. If no line has the letters typed, the line with the most of
 * the words searched for (in another form, or with a letter wrong), the first of them marked.
 * Undefined if no single line has it.
 */
export function lyricSnippet(
  parsed: ParsedChart,
  searchTerm: string,
  width = 40
): { before: string; match: string; after: string } | undefined {
  const term = normalizeTerm(searchTerm)
  if (!term) return undefined
  const { lines } = lyricsOf(parsed)
  for (const line of lines) {
    const lower = line.toLowerCase()
    // Lowercasing can change a string's length; then the positions can't be trusted
    const at = lower.length === line.length ? lower.indexOf(term) : -1
    if (at >= 0) return around(line, at, term.length, width)
  }
  let best: { line: string; ranges: WordRange[] } | undefined
  for (const line of lines) {
    const ranges = wordRanges(line, term)
    if (ranges.length > (best?.ranges.length ?? 0)) best = { line, ranges }
  }
  if (!best) return undefined
  const [first] = best.ranges
  return around(best.line, first.start, first.end - first.start, width)
}

/**
 * How well a song matches the search term, lowest first: 0 the title is the term, 1 the title
 * starts with it, 2 a word of the title starts with it, 3 the title contains it, 4 the artist or
 * variant name does, 5 only the lyrics do. Undefined if nothing matches.
 */
function matchRank(song: SearchableSong, term: string): number | undefined {
  const found = matchedFields(song, term)
  if (found.title) {
    // A title matched, so there is one
    const title = (song.title as string).toLowerCase()
    if (title.trim() === term) return 0
    if (title.startsWith(term)) return 1
    if (title.split(/[^\p{L}\p{N}]+/u).some(word => word.startsWith(term))) return 2
    return 3
  }
  if (found.artist || found.label) return 4
  if (found.lyrics) return 5
  return undefined
}

/** The rank of a song the letters typed are not in, but the words are (another form of one, a slip) */
const WORDS_ONLY = 6

/**
 * The rank of a song the words searched for are found in (in another form, or with a letter wrong):
 * as a title that has the term in it if in the title, as artist and variant name if in either of
 * them, else words in the lyrics only
 */
function wordRank(song: SearchableSong, term: string): number {
  if (wordRanges(song.title || '', term).length > 0) return 3
  if (
    wordRanges(song.artist || '', term).length + wordRanges(song.variantLabel || '', term).length >
    0
  ) {
    return 4
  }
  return WORDS_ONLY
}

/** The lowest rank whose songs are put in order of how well their words match, not by the library's order */
const SCORED_FROM = 5

/** The index of the list of songs last searched: typing goes on searching the same list */
let lastIndex: { songs: readonly SearchableSong[]; index: SongIndex } | undefined

/** SongSelect splits a word across chords ("e - [D]nough"): put it back together */
const SPLIT_WORD = /(?<=\p{L})\s+-\s+(?=\p{L})/gu

/** The index of these songs, made now or the one made for the same songs before */
function indexOf(songs: readonly SearchableSong[]): SongIndex {
  if (lastIndex?.songs.length === songs.length && lastIndex.songs.every((s, i) => s === songs[i])) {
    return lastIndex.index
  }
  const index = new SongIndex(
    songs.map(song => ({
      title: song.title || '',
      artist: song.artist || '',
      label: song.variantLabel || '',
      lyrics: song.parsed ? lyricsOf(song.parsed).lines.join('\n').replace(SPLIT_WORD, '') : '',
    }))
  )
  lastIndex = { songs: [...songs], index }
  return index
}

/**
 * Make the index of these songs a moment after they are shown, so that the first letter typed
 * finds them at once rather than waiting for it to be made
 */
export function warmSearch(songs: readonly SearchableSong[]): void {
  setTimeout(() => indexOf(songs), 300)
}

/**
 * The songs that match the search, best match first. A song matches if its title, artist, variant
 * name or lyrics contain what was typed, ignoring case; ranked a title that is the term, then
 * titles starting with it, then the rest of the title matches, then artist and variant name, then
 * lyrics only. Songs that match equally well keep their order, except lyrics-only ones, which go
 * by how well their words match (a chorus that repeats the word before a passing mention).
 * After them come the songs with the words but not the letters: other forms of a word ("praises"
 * finds "praise"), a slip of the fingers, words in another order. An empty search matches every
 * song (and gives back the same array).
 */
export function filterSongs<T extends SearchableSong>(songs: T[], searchTerm: string): T[] {
  const term = normalizeTerm(searchTerm)
  if (!term) return songs
  const scores = indexOf(songs).search(term)
  const ranked: { song: T; rank: number; score: number }[] = []
  songs.forEach((song, i) => {
    const letters = matchRank(song, term)
    const rank = scores.has(i) ? Math.min(letters ?? WORDS_ONLY, wordRank(song, term)) : letters
    if (rank !== undefined) ranked.push({ song, rank, score: scores.get(i) ?? 0 })
  })
  // Array.prototype.sort is stable, so ties stay in the library's order
  return ranked
    .sort((a, b) => a.rank - b.rank || (a.rank >= SCORED_FROM ? b.score - a.score : 0))
    .map(({ song }) => song)
}
