/**
 * What must be true of the library search over any songs, checked for words drawn from the songs
 * themselves rather than ones thought of by hand (tests/search.node.test.ts runs it on made-up
 * and real charts). A failure names the query and the song, so it can be looked at, and the cause
 * fixed in the search, not the one word. The queries are drawn with a seed: the same every run.
 *
 * - recall: every word of a song finds the song, and so does each prefix of it (typing a word
 *   must not lose the song half way), with the word before it, and any other form of it
 * - precision: a song is only given with a reason the card shows (a marked word or a quoted line)
 * - agreement: the songs given are those where the letters typed are somewhere, or every word of
 *   the search is (by a scan of the text, not by the index): none missed, none unexplained
 * - order: a song found only because a word in it has a letter wrong comes after every other
 * - a title typed whole puts its song first
 * - the same answer twice; nothing given that was not in the list, nothing twice
 */
import type { ParsedChart } from '../src/js/data-types.ts'
import {
  filterSongs,
  lyricSnippet,
  lyricsOf,
  matchedFields,
  normalizeTerm,
} from '../src/js/utils/song-filter.ts'
import { plainWord, stemOf, wordRanges, wordsFound } from '../src/js/utils/song-search.ts'

export interface TestSong {
  title: string
  artist: string
  parsed: ParsedChart
}

/** The words a chart sings, line by line, as the library reads them (a word split across chords whole) */
export function lyricLines(parsed: ParsedChart): string[] {
  return lyricsOf(parsed).lines
}

/** A random number generator that gives the same numbers for the same seed */
function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The distinct words (of four letters or more, that are searched for) a song is made of */
function wordsOf(song: TestSong): string[] {
  const text = `${song.title}\n${lyricLines(song.parsed).join('\n')}`
  const words = new Set<string>()
  // (an apostrophe is in a word, as the search has it: "sov'reign" is "sovreign")
  for (const [word] of text.matchAll(/[\p{L}\p{N}'’]+/gu)) {
    const plain = plainWord(word)
    if (plain !== null && plain.length >= 4) words.add(plain)
  }
  return [...words]
}

const tokenCache = new Map<TestSong, string[]>()

/** Every word of a song (any length), in lower case without apostrophes or accents */
function tokensOf(song: TestSong): string[] {
  let tokens = tokenCache.get(song)
  if (!tokens) {
    tokens = []
    for (const text of textsOf(song)) {
      for (const [word] of text.matchAll(/[\p{L}\p{N}'’]+/gu)) {
        tokens.push(
          word
            .toLowerCase()
            .normalize('NFD')
            .replace(/\p{M}|['’]/gu, '')
        )
      }
    }
    tokenCache.set(song, tokens)
  }
  return tokens
}

/** Another form of a word that has its stem, if one can be made by adding or taking off an ending */
function otherForms(word: string): string[] {
  const stem = stemOf(word)
  // (the word without an ending it has: not "alway" for "always", which is no word)
  const bare = word.replace(/(ing|ed)$/, '')
  const candidates = [
    `${word}s`,
    `${word}es`,
    `${word}ed`,
    `${word}d`,
    `${word}ing`,
    `${word.replace(/e$/, '')}ing`,
    // mercy, mercies, married
    word.replace(/y$/, 'ies'),
    word.replace(/y$/, 'ied'),
    ...(bare === word ? [] : [`${bare}s`, `${bare}ing`, `${bare}ed`, bare]),
  ]
  return [...new Set(candidates)].filter(
    form => form !== word && form.length >= 4 && stemOf(form) === stem
  )
}

/** A word with a letter missing, changed or swapped in the middle of it */
function slipsOf(word: string): string[] {
  const at = Math.floor(word.length / 2)
  return [
    word.slice(0, at) + word.slice(at + 1),
    word.slice(0, at) + (word[at] === 'q' ? 'z' : 'q') + word.slice(at + 1),
    word.slice(0, at - 1) + word[at] + word[at - 1] + word.slice(at + 1),
  ].filter(slip => slip !== word)
}

/** Where the letters typed are in a song, as the library shows a match of them */
function hasLetters(song: TestSong, term: string): boolean {
  const found = matchedFields(song, term)
  return found.title || found.artist || found.label || found.lyrics
}

/** The texts of a song that are searched */
function textsOf(song: TestSong): string[] {
  return [song.title, song.artist, lyricLines(song.parsed).join('\n')]
}

/** Whether the card for this song, given for this search, shows why */
function showsWhy(song: TestSong, term: string): boolean {
  return (
    hasLetters(song, term) ||
    wordRanges(song.title, term).length > 0 ||
    wordRanges(song.artist, term).length > 0 ||
    lyricSnippet(song.parsed, term) !== undefined
  )
}

interface Options {
  /** Words to draw (each one is searched for in several ways) */
  words?: number
  /** Searches to check against a scan of the text, which is slow */
  scans?: number
  seed?: number
}

/** Every problem found in the search over these songs, each as a line saying what and for which search */
export function checkSearch(songs: TestSong[], options: Options = {}): string[] {
  const { words: wordCount = 150, scans = 120, seed = 1 } = options
  const next = random(seed)
  const pick = <T>(list: T[]): T => list[Math.floor(next() * list.length)]
  const problems: string[] = []
  const search = (term: string) => filterSongs(songs, term)

  /** Check the songs given for a search; `expected` is a song that must be among them */
  const queries = new Set<string>()
  const recall = (kind: string, term: string, expected: TestSong) => {
    // A word begun that is a word too common to search for ("your" of "yours", "you're") is left
    // out of the search, as the word is: the rest of the search stands, and there may be none
    if (kind.startsWith('typing') && plainWord(term.split(' ').pop() as string) === null) return
    queries.add(term)
    if (!search(term).includes(expected)) {
      problems.push(`${kind}: "${term}" does not find "${expected.title}"`)
    }
  }

  // The word begun in each search that is begun (4 to 6 letters: before a letter wrong is allowed)
  const begun = new Map<string, string>()
  const eligible = songs.filter(song => wordsOf(song).length > 0)
  for (let n = 0; n < wordCount; n++) {
    const song = pick(eligible)
    const own = wordsOf(song)
    const word = pick(own)
    recall('word', word, song)
    for (let length = 3; length < word.length; length++) {
      const typed = word.slice(0, length)
      recall('typing', typed, song)
      if (length >= 4 && length <= 6) begun.set(typed, typed)
    }
    const before = pick(own)
    if (before !== word) {
      recall('two words', `${before} ${word}`, song)
      for (let length = 3; length < word.length; length++) {
        const typed = word.slice(0, length)
        recall('typing after a word', `${before} ${typed}`, song)
        if (length >= 4 && length <= 6) begun.set(`${before} ${typed}`, typed)
      }
    }
    for (const form of otherForms(word)) {
      recall('another form', form, song)
      // Typing a longer form of the word, letter by letter, goes on finding the song with the
      // shorter ("worshippin" for "worship"): from four letters, the shortest stem it goes on from
      if (stemOf(word).length >= 4) {
        for (let length = 4; length < form.length; length++) {
          recall('typing another form', form.slice(0, length), song)
        }
      }
    }
    if (word.length >= 8) for (const slip of slipsOf(word)) queries.add(slip)
  }

  // A title typed whole, whole or without its last letters, finds its song first
  const titleCount = new Map<string, number>()
  for (const song of songs)
    titleCount.set(normalizeTerm(song.title), (titleCount.get(normalizeTerm(song.title)) ?? 0) + 1)
  for (const song of songs) {
    const typed = normalizeTerm(song.title)
    if (typed.length < 3 || titleCount.get(typed) !== 1) continue
    queries.add(typed)
    const [first] = search(typed)
    if (first !== song)
      problems.push(`title: "${typed}" gives "${first?.title}" first, not the song`)
  }

  for (const term of queries) {
    const found = search(term)
    if (new Set(found).size !== found.length) problems.push(`twice: "${term}" gives a song twice`)
    if (found.some(song => !songs.includes(song)))
      problems.push(`strange: "${term}" gives a song not in the list`)
    const again = search(term)
    if (found.length !== again.length || found.some((song, i) => song !== again[i])) {
      problems.push(`unsteady: "${term}" gives different answers`)
    }

    for (const song of found) {
      if (!showsWhy(song, term))
        problems.push(`why: "${term}" gives "${song.title}", with nothing to mark or quote`)
    }

    // A word begun is not taken for another word a letter off ("worshi" is not "worthy"): every
    // song given has the letters in it, or a word that starts with its first four letters.
    // (Without using the search's own rules, which could be wrong in the same way as the search.)
    const typed = begun.get(term)
    // (a word begun that is a word too common to search for, "when" of "whenever", is left out)
    if (typed !== undefined && plainWord(typed) !== null) {
      const start = typed.slice(0, 4)
      for (const song of found) {
        const letters = textsOf(song).some(text => text.toLowerCase().includes(typed))
        // (or the stemmer takes it for a form of the same word: "pres" for "pre", "prai" for "pray")
        const sameStem = tokensOf(song).some(token => stemOf(token) === stemOf(typed))
        // (or it goes on from a word of the song, or one that lost its "e": "savi" from "save")
        const goesOn = tokensOf(song).some(token => {
          const stem = stemOf(token)
          return (
            stem.length >= 4 && (typed.startsWith(stem) || typed.startsWith(stem.replace(/e$/, '')))
          )
        })
        const related =
          letters || sameStem || goesOn || tokensOf(song).some(token => token.startsWith(start))
        if (!related) {
          problems.push(
            `unrelated: "${term}" gives "${song.title}", which has no word starting "${start}"`
          )
        }
      }
    }

    // Songs found only by a letter wrong come after every other
    const slipOnly = (song: TestSong) =>
      !hasLetters(song, term) && !wordsFound(textsOf(song), term, false)
    const firstSlip = found.findIndex(slipOnly)
    if (firstSlip >= 0 && found.slice(firstSlip).some(song => !slipOnly(song))) {
      problems.push(
        `order: "${term}" puts "${found[firstSlip].title}", found by a letter wrong, before a match`
      )
    }
  }

  // The songs given are those the letters or the words are in, by a scan of the text
  for (const term of [...queries].slice(0, scans)) {
    const typed = normalizeTerm(term)
    const expected = new Set(
      songs.filter(song => hasLetters(song, typed) || wordsFound(textsOf(song), typed))
    )
    const given = new Set(search(term))
    for (const song of expected) {
      if (!given.has(song))
        problems.push(`missed: "${term}" does not give "${song.title}", which has the words`)
    }
    for (const song of given) {
      if (!expected.has(song))
        problems.push(
          `unexplained: "${term}" gives "${song.title}", which has neither letters nor words`
        )
    }
  }

  return problems
}
