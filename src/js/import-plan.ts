/**
 * Planning an email's setlist against the library: which of its songs the library has, and which
 * might be.
 *
 * Pure (no database): it is given the library's songs. The charts in the email's PDFs are never
 * imported (they are other people's copies, often old ones from before SongSelect): the library
 * has the SongSelect chart or nothing. A song it lacks has to be imported first, from SongSelect
 * with the bookmarklet (songselect-link.ts says where to go), before it can be in the setlist.
 */
import type { SongSource } from './data-types.ts'
import { type ImportedSong, normaliseTitle, titleScore } from './email-setlist.ts'

/** A song of the library, as far as matching goes */
export interface LibrarySong {
  uuid: string
  /** The deterministic id: ccli-<number>, or title-<normalised title> */
  id: string
  title: string
  ccli: string | null
  /** The words of its chart, for finding a song by a line of it (see lyricsOf) */
  lyrics?: string
  /** Set for a song of another database ('Shared with me', another space): not the library's yet */
  source?: SongSource
}

export type SongMatch =
  /** The library has this song: the same CCLI number, or the same title */
  | { kind: 'ccli' | 'title'; song: LibrarySong }
  /**
   * Titles are close, or are the same with another CCLI number: the person decides. With `via`
   * 'lyrics', no title was close, but the title is a line of these songs' words: a song's
   * chorus is often how it is known, and leaders call songs by it.
   */
  | { kind: 'possible'; candidates: LibrarySong[]; via?: 'lyrics' }
  | { kind: 'none' }

/** How close a title must be to a library song's to be offered as a possibility */
const POSSIBLE = 0.5
const MAX_CANDIDATES = 3

/** Which song of the library an emailed song is: by CCLI number, then title, then closeness */
export function matchLibrary(song: ImportedSong, library: LibrarySong[]): SongMatch {
  if (song.ccli) {
    const same = library.find(have => have.ccli === song.ccli)
    if (same) return { kind: 'ccli', song: same }
  }
  const titles = song.titles.length ? song.titles : [song.title]
  const wanted = new Set(titles.map(normaliseTitle).filter(Boolean))
  // The same title, but a different CCLI number on both sides, is not the same song
  const sameTitle = library.filter(have => wanted.has(normaliseTitle(have.title)))
  const agrees = sameTitle.find(have => !song.ccli || !have.ccli)
  if (agrees) return { kind: 'title', song: agrees }

  const scored = library
    .map(have => ({
      have,
      score: sameTitle.includes(have)
        ? 1
        : Math.max(...titles.map(title => titleScore(title, have.title))),
    }))
    .filter(({ score }) => score >= POSSIBLE)
    .sort((a, b) => b.score - a.score || a.have.title.localeCompare(b.have.title))
  if (scored.length) {
    return { kind: 'possible', candidates: scored.slice(0, MAX_CANDIDATES).map(({ have }) => have) }
  }
  const byWords = matchLyrics(titles, library)
  return byWords.length
    ? { kind: 'possible', candidates: byWords, via: 'lyrics' }
    : { kind: 'none' }
}

/** The shortest title, in letters, that may be looked for in the songs' words: not just "Holy" */
const MIN_PHRASE = 8

/**
 * The songs whose words have one of the titles in them, the ones with it most often first. Only
 * a title of two words or more is looked for, as one word is in many songs.
 */
function matchLyrics(titles: string[], library: LibrarySong[]): LibrarySong[] {
  const phrases = [...new Set(titles.map(normaliseTitle))].filter(
    phrase => phrase.length >= MIN_PHRASE && phrase.includes(' ')
  )
  if (!phrases.length) return []
  return library
    .map(have => {
      const words = ` ${have.lyrics ?? ''} `
      const hits = phrases.reduce((sum, phrase) => sum + words.split(` ${phrase} `).length - 1, 0)
      return { have, hits }
    })
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits || a.have.title.localeCompare(b.have.title))
    .slice(0, MAX_CANDIDATES)
    .map(({ have }) => have)
}

/**
 * The words of a ChordPro chart, ready to look for a phrase in: no directives, chords or CCLI
 * lines, in lower case without punctuation, in one line. SongSelect splits a word across chords
 * with " - " ("e - [D]nough"), which is put back together.
 */
export function lyricsOf(chordpro: string): string {
  return normaliseTitle(
    chordpro
      .split(/\r?\n/)
      .filter(line => !/^\s*\{/.test(line) && !/^\s*(CCLI|©)/i.test(line))
      .map(line => line.replace(/\[[^\]]*\]/g, ''))
      .join(' ')
      .replace(/(?<=\p{L})\s+-\s+(?=\p{L})/gu, '')
  )
}
