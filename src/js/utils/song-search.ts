import MiniSearch, { type Query } from 'minisearch'
import { stemmer } from 'stemmer'

/** What is searched of a song */
export interface SongDocument {
  title: string
  artist: string
  /** What the variant is called */
  label: string
  /** The words of the chart, without its chords */
  lyrics: string
}

/** Where a word is in a text: from `start` up to (not including) `end` */
export interface WordRange {
  start: number
  end: number
}

/**
 * Words too common in songs to tell one from another ("you" is in nearly every worship song), so
 * leaving them out of the index keeps a search for them from matching everything
 */
const STOP_WORDS = new Set(
  (
    'a an and are as at be but by for from has have he her him his i in is it its me my of on or ' +
    'our she so that the their them they this to us was we were what when who will with you your s t'
  ).split(' ')
)

/** What separates the words of a text; an apostrophe stays in a word ("Lord's") */
const NOT_A_WORD = /[^\p{L}\p{N}'’]+/u

/** The words of a text, as the search sees them */
function tokenize(text: string): string[] {
  return text.split(NOT_A_WORD).filter(Boolean)
}

/**
 * A word as it was written, in lower case, without accents or apostrophes ("Lord's" is "lords");
 * nothing at all for a word too common to search for
 */
export function plainWord(word: string): string | null {
  const plain = word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/['’]/g, '')
  return !plain || STOP_WORDS.has(plain) ? null : plain
}

/** The stem of a plain word, which "praising", "praises" and "praised" share */
export function stemOf(plain: string): string {
  return stemmer(plain)
}

/**
 * What a word is indexed as: itself, so that a word begun is found ("worshippin" finds
 * "worshipping"), and its stem, so that another form of it is ("worshipped")
 */
function indexTerms(word: string): string | string[] | null {
  const plain = plainWord(word)
  if (plain === null) return null
  const stem = stemOf(plain)
  return stem === plain ? plain : [plain, stem]
}

/** How a word may go on, as the end of a form of it: while typing "worshippin" it is "worshipping" */
const ENDINGS = ['g', 'ng', 'ing', 'd', 'ed', 'es', 's', 'ly', 'er', 'ers']

/**
 * The stems of the words an unfinished word may become: "worshippin" will be "worshipping", of
 * the stem "worship", which the letters so far are not a beginning of
 */
function completionStems(plain: string): string[] {
  return [...new Set(ENDINGS.map(ending => stemOf(plain + ending)))]
}

/** The words of a search: as written, stemmed, and (for the one being typed) as it may be completed */
function searchWords(searchTerm: string) {
  return tokenize(searchTerm).flatMap(word => {
    const plain = plainWord(word)
    return plain === null
      ? []
      : [{ plain, stem: stemOf(plain), completions: completionStems(plain) }]
  })
}

/** How many letters of a word of this length may be wrong: none for a short one */
function slips(length: number): number {
  return length >= 6 ? Math.round(length * 0.2) : 0
}

/** The number of single-letter changes (add, remove, change) that make one word the other */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    previous = row
  }
  return previous[b.length]
}

/**
 * The words of a text the search found it by, as `search` finds: a form of a word searched for, a
 * word with a letter wrong, or (the last word of the search) a word that begins as typed
 */
export function wordRanges(text: string, searchTerm: string): WordRange[] {
  const words = searchWords(searchTerm)
  const ranges: WordRange[] = []
  for (const found of text.matchAll(/[\p{L}\p{N}'’]+/gu)) {
    const plain = plainWord(found[0])
    if (plain === null) continue
    const stem = stemOf(plain)
    const matches = words.some(
      (word, i) =>
        stem === word.stem ||
        distance(stem, word.stem) <= slips(word.stem.length) ||
        (i === words.length - 1 &&
          (plain.startsWith(word.plain) || word.completions.includes(stem)))
    )
    if (matches) ranges.push({ start: found.index, end: found.index + found[0].length })
  }
  return ranges
}

/** Boosts: a word in the title counts for more than the same word in the lyrics */
const FIELD_BOOSTS = { title: 3, artist: 2, label: 2, lyrics: 1 }

/**
 * A search over a list of songs by the words in them, which finds what a plain match of the
 * letters typed does not: other forms of a word ("praises" finds "praise"), a slip of the
 * fingers, words in any order. A song is named by its place in the list the index was made from.
 */
export class SongIndex {
  readonly #index: MiniSearch<SongDocument & { id: number }>

  constructor(documents: SongDocument[]) {
    this.#index = new MiniSearch({
      fields: ['title', 'artist', 'label', 'lyrics'],
      tokenize,
      processTerm: indexTerms,
    })
    this.#index.addAll(documents.map((document, id) => ({ id, ...document })))
  }

  /**
   * The songs with every word of the search (or a form of it), each with a score (higher is
   * better). The last word may be unfinished, as it is while typing, and a word of six letters or
   * more may have a letter wrong.
   */
  search(searchTerm: string): Map<number, number> {
    const words = searchWords(searchTerm)
    if (words.length === 0) return new Map()
    const queries: Query[] = words.map((word, i) => {
      const form: Query = {
        combineWith: 'OR',
        queries: [word.stem],
        fuzzy: slips(word.stem.length) ? 0.2 : false,
      }
      if (i < words.length - 1) return form
      // The word being typed may be begun: not a stem yet
      return {
        combineWith: 'OR',
        queries: [form, { queries: [word.plain], prefix: true }, { queries: word.completions }],
      }
    })
    const results = this.#index.search(
      { combineWith: 'AND', queries },
      // The words are ready: look them up as they are
      { boost: FIELD_BOOSTS, tokenize: term => [term], processTerm: term => term }
    )
    return new Map(results.map(result => [result.id as number, result.score]))
  }
}
