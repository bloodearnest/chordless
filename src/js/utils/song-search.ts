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

const stems = new Map<string, string>()

/** The stem of a plain word, which "praising", "praises" and "praised" share (kept: words come again and again) */
export function stemOf(plain: string): string {
  let stem = stems.get(plain)
  if (stem === undefined) {
    stem = stemmer(plain)
    stems.set(plain, stem)
  }
  return stem
}

/** What follows the apostrophe in an everyday contraction (Lord's, don't, you're, I've, we'll, I'd, I'm) */
const CONTRACTION = /^(s|t|re|ve|ll|d|m)$/i

/**
 * The letters left out for an apostrophe: a vowel ("ev'ry", "pow'r", "heav'n") or a "v" ("ne'er",
 * "o'er"). Not every letter, which would make "eter" of "e'er" and find "eternal" by it.
 */
const LEFT_OUT = [...'aeiouv']

/**
 * The words a word may be with a letter put back where its apostrophe is: songs are written
 * "ev'ry", "pow'r", "heav'n", "ne'er", "o'er", for every, power, heaven, never, over. We can't
 * know which letter, so each is tried: "every" is among them, and the rest are not words anyone
 * searches for. None for an everyday contraction, or a word with no apostrophe inside it.
 */
function lettersPutBack(word: string): string[] {
  const at = word.search(/['’]/)
  if (at < 1 || at === word.length - 1 || CONTRACTION.test(word.slice(at + 1))) return []
  const forms: string[] = []
  for (const letter of LEFT_OUT) {
    const plain = plainWord(`${word.slice(0, at)}${letter}${word.slice(at + 1)}`)
    if (plain !== null) forms.push(plain)
  }
  return forms
}

/**
 * What a word is indexed as: itself, so that a word begun is found ("worshippin" finds
 * "worshipping"), and its stem, so that another form of it is ("worshipped"); and the same of the
 * words it may be with a letter put back, for a word with an apostrophe in it ("ev'ry")
 */
function indexTerms(word: string): string | string[] | null {
  const plain = plainWord(word)
  if (plain === null) return null
  const terms = new Set<string>()
  for (const form of [plain, ...lettersPutBack(word)]) {
    terms.add(form)
    terms.add(stemOf(form))
  }
  return terms.size === 1 ? plain : [...terms]
}

/** How a word goes on from its stem: "worship" goes on "ping" (doubling its last letter) and "ped" */
const ENDINGS = ['ing', 'ings', 'ed', 'es', 's', 'er', 'ers', 'ly', 'ness', 'ful', 'ies', 'ied']

/** The shortest stem a word being typed is taken to be going on from ("son" is not "sonn") */
const MIN_STEM = 4

/**
 * The stems a word being typed may be going on from: "worshippin" is "worship" and "pin", the
 * start of "ping" ("worshipping", the last letter doubled), so the songs that have "worship" are
 * the songs for it, as well as those that have "worshipping" (which the plain beginning finds).
 * A word that loses its "e" is found too: "lovi" is "lov" and "i", the start of "ing", so "love";
 * and one that changes its "y": "mercie" is "merc" and "ie", the start of "ies", so "mercy".
 * Only the beginnings of the typed letters, never another word they are near.
 */
function completionStems(plain: string): string[] {
  const stems: string[] = []
  for (let length = MIN_STEM - 1; length < plain.length; length++) {
    const stem = plain.slice(0, length)
    const tail = plain.slice(length)
    const goesOn = ENDINGS.some(
      ending => ending.startsWith(tail) || `${stem.at(-1)}${ending}`.startsWith(tail)
    )
    if (!goesOn) continue
    if (length >= MIN_STEM) stems.push(stem)
    if (/^[ie]/.test(tail)) stems.push(`${stem}e`)
    if (tail.startsWith('i')) stems.push(`${stem}y`)
  }
  // (the index has the stem of a word, which is not the word: "stai" for "stay"; but not a stem
  // so short that it is nearly every word: "alle" is not "all")
  return [
    ...new Set(stems.flatMap(stem => [stem, stemOf(stem)]).filter(stem => stem.length >= MIN_STEM)),
  ]
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

/**
 * How many letters of a word of this length may be wrong: none for a short one. The word being
 * typed needs a letter more before it is allowed any: an unfinished word ("worshi") is a letter
 * from other words ("worthy"), and is not a slip of the fingers.
 */
function slips(length: number, beingTyped: boolean): number {
  return length >= (beingTyped ? 7 : 6) ? Math.round(length * 0.2) : 0
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
 * Go through the words of a text for those the search finds it by, as `search` finds: a form of a
 * word searched for, a word with a letter wrong (unless `slip` is false), or (the last word of the
 * search) a word that begins as typed. Gives where they are, and which words of the search (by
 * place) were found.
 */
function scan(text: string, searchTerm: string, slip: boolean) {
  const words = searchWords(searchTerm)
  const ranges: WordRange[] = []
  const found = new Set<number>()
  for (const token of text.matchAll(/[\p{L}\p{N}'’]+/gu)) {
    const written = plainWord(token[0])
    if (written === null) continue
    // (the word as written, and the words it may be with a letter put back, for "ev'ry")
    const forms = [written, ...lettersPutBack(token[0])]
    let matched = false
    words.forEach((word, i) => {
      const last = i === words.length - 1
      const allowed = slip ? slips(word.stem.length, last) : 0
      // (the index has the word as written and its stem, and the stem of the search is looked up in both)
      const matches = forms.some(plain => {
        const stem = stemOf(plain)
        return (
          stem === word.stem ||
          plain === word.stem ||
          (allowed > 0 &&
            (distance(stem, word.stem) <= allowed || distance(plain, word.stem) <= allowed)) ||
          (last &&
            (plain.startsWith(word.plain) ||
              word.completions.includes(plain) ||
              word.completions.includes(stem)))
        )
      })
      if (matches) {
        matched = true
        found.add(i)
      }
    })
    if (matched) ranges.push({ start: token.index, end: token.index + token[0].length })
  }
  return { ranges, found, count: words.length }
}

/**
 * The words of a text the search found it by (see `scan`): where they are, to mark them. With
 * `slip` false, not those with a letter wrong.
 */
export function wordRanges(text: string, searchTerm: string, slip = true): WordRange[] {
  return scan(text, searchTerm, slip).ranges
}

/**
 * Whether every word of the search is in these texts together (each in any of them): a form of
 * it, or with a letter wrong (unless `slip` is false), or begun as typed for the last. False for
 * a search of no words.
 */
export function wordsFound(texts: string[], searchTerm: string, slip = true): boolean {
  const found = new Set<number>()
  let count = 0
  for (const text of texts) {
    const result = scan(text, searchTerm, slip)
    count = result.count
    for (const i of result.found) found.add(i)
  }
  return count > 0 && found.size === count
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
   * better). The last word may be unfinished, as it is while typing. A word of six letters or more
   * may have a letter wrong, and the last of seven.
   */
  search(searchTerm: string): Map<number, number> {
    const words = searchWords(searchTerm)
    if (words.length === 0) return new Map()
    const queries: Query[] = words.map((word, i) => {
      const form: Query = {
        combineWith: 'OR',
        queries: [word.stem],
        fuzzy: slips(word.stem.length, i === words.length - 1) ? 0.2 : false,
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
