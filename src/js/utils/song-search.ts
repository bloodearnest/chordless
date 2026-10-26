import MiniSearch from 'minisearch'
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

/**
 * How a word is indexed, and how a search word is looked up: lower case, without accents or
 * apostrophes ("Lord's" and "lords"), stemmed so that "praising", "praises" and "praised" are one
 * word, and nothing at all for a stop word
 */
export function processTerm(term: string): string | null {
  const word = term.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/['’]/g, '')
  if (!word || STOP_WORDS.has(word)) return null
  return stemmer(word)
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
      processTerm,
    })
    this.#index.addAll(documents.map((document, id) => ({ id, ...document })))
  }

  /**
   * The songs matching every word of the search, each with a score (higher is better). The last
   * word may be unfinished, as it is while typing, and words of four letters or more may have a
   * letter wrong.
   */
  search(searchTerm: string): Map<number, number> {
    const results = this.#index.search(searchTerm, {
      boost: FIELD_BOOSTS,
      combineWith: 'AND',
      prefix: (_term, i, terms) => i === terms.length - 1,
      fuzzy: term => (term.length >= 4 ? 0.2 : false),
    })
    return new Map(results.map(result => [result.id as number, result.score]))
  }
}
