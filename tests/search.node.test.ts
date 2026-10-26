/**
 * The library search over many words drawn from songs, not ones picked by hand
 * (tests/search-properties.ts says what is checked). Over made-up hymns here and in CI, and with
 * CHORDLESS_REAL_CHARTS=1 over real charts (tests/fixtures/private/charts/*.cho, copyrighted, so
 * git ignores them: unpack the songs/ of a Chordless export there). More words of both with
 * CHORDLESS_SEARCH_WORDS=600.
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ChordProParser } from '../src/js/parser.ts'
import { HYMNS } from './fixtures/search-hymns.ts'
import { checkSearch, type TestSong } from './search-properties.ts'

const parser = new ChordProParser()

function song(chordpro: string): TestSong {
  const parsed = parser.parse(chordpro)
  return { title: parsed.metadata.title ?? '', artist: parsed.metadata.artist ?? '', parsed }
}

const words = Number(process.env.CHORDLESS_SEARCH_WORDS) || undefined
// A different draw of words (the same every run, for a seed)
const seed = Number(process.env.CHORDLESS_SEARCH_SEED) || undefined

/** The problems, the first few of them, as the failure says */
function expectNone(problems: string[]) {
  const shown = problems.slice(0, 25).join('\n')
  assert.equal(problems.length, 0, `${problems.length} problems:\n${shown}`)
}

test('search: made-up hymns', () => {
  const songs = HYMNS.map(song)
  assert.equal(songs.length, HYMNS.length)
  expectNone(checkSearch(songs, { words: words ?? 300, scans: 300, seed }))
})

const CHARTS = new URL('./fixtures/private/charts/', import.meta.url)
const charts = existsSync(CHARTS) ? readdirSync(CHARTS).filter(name => name.endsWith('.cho')) : []

// Opt in: real charts take other paths through the parser than the made-up ones, which moves the
// coverage `just ci` checks (it is of what CI has, which has no real charts)
test('search: real charts', {
  skip:
    (!process.env.CHORDLESS_REAL_CHARTS && 'set CHORDLESS_REAL_CHARTS=1 to try the real charts') ||
    (!charts.length && 'no real charts in tests/fixtures/private/charts'),
}, () => {
  const songs = charts.map(name => song(readFileSync(new URL(name, CHARTS), 'utf8')))
  expectNone(checkSearch(songs, { words, scans: 150, seed }))
})
