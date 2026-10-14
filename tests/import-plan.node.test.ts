/**
 * Matching an email's songs to the library (src/js/import-plan.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type LibrarySong, lyricsOf, matchLibrary } from '../src/js/import-plan.ts'
import { makeImportedSong } from './builders.ts'

const song = makeImportedSong

const lib = (title: string, ccli: string | null = null): LibrarySong => ({
  uuid: `uuid-${title}`,
  id: ccli ? `ccli-${ccli}` : `title-${title.toLowerCase().replace(/\W/g, '')}`,
  title,
  ccli,
})

const library = [
  lib('Living Hope', '7106807'),
  lib('Behold Him', '7133698'),
  lib('Holy Holy', null),
  lib('Your Grace Is Enough', '4477'),
  lib('Holy Spirit'),
]

test('a CCLI number finds the song, whatever it is called', () => {
  const match = matchLibrary(song('Something Else Entirely', { ccli: '7106807' }), library)
  assert.deepEqual(
    [match.kind, match.kind === 'ccli' ? match.song.title : ''],
    ['ccli', 'Living Hope']
  )
})

test('the same title finds the song, ignoring case, punctuation and brackets of other titles', () => {
  assert.equal(matchLibrary(song('behold him!'), library).kind, 'title')
  const holy = matchLibrary(
    song('Holy, Holy (Lift up his name)', {
      titles: ['Holy, Holy (Lift up his name)', 'Holy, Holy', 'Lift up his name'],
    }),
    library
  )
  assert.deepEqual(
    [holy.kind, holy.kind === 'title' ? holy.song.title : ''],
    ['title', 'Holy Holy']
  )
})

test('the same title with a different CCLI number is not taken to be the song, but is offered', () => {
  const match = matchLibrary(song('Living Hope', { ccli: '999999' }), library)
  assert.equal(match.kind, 'possible')
  assert.equal(match.kind === 'possible' && match.candidates[0].title, 'Living Hope')
})

test('a title that is close is offered, best first, and never more than three', () => {
  const match = matchLibrary(
    song('Your Grace Is Enough (This Is Our God)', {
      titles: ['Your Grace Is Enough (This Is Our God)', 'Your Grace Is Enough', 'This Is Our God'],
    }),
    library
  )
  assert.equal(match.kind, 'title', 'one of its titles is the library’s')
  const near = matchLibrary(song('Holy Spirit Come'), [
    lib('Holy Spirit Come Down'),
    lib('Come Holy Spirit Come'),
    lib('Holy Spirit Come Now'),
    lib('Spirit Come Holy Spirit Come'),
  ])
  assert.equal(near.kind, 'possible')
  assert.ok(near.kind === 'possible' && near.candidates.length <= 3)
})

test('a song the library lacks matches nothing', () => {
  assert.equal(matchLibrary(song('Totally New Song'), library).kind, 'none')
  assert.equal(
    matchLibrary(song('Holy'), library).kind,
    'none',
    'one word is not inside Holy Spirit'
  )
  assert.equal(matchLibrary(song('Anything'), []).kind, 'none')
})

// ---- finding a song by a line of its words ----

const withWords = (title: string, chordpro: string, ccli: string | null = null): LibrarySong => ({
  ...lib(title, ccli),
  lyrics: lyricsOf(chordpro),
})

const wordy = [
  withWords(
    'This Is Our God',
    '{title: This Is Our God}\n\n[G]Your grace is [C]enough\n[G]Made up words for us'
  ),
  withWords('Another Song', '[D]Nothing like that [A]here\nA different line'),
  withWords('Yet Another', '[E]Your grace is enough for [B]me\n[E]And your grace is enough'),
]

test('the words of a chart: no chords, directives, CCLI lines or punctuation', () => {
  assert.equal(
    lyricsOf(
      '{title: A}\n{comment: Verse}\n[G]Your grace is [C]enough,\nAnd more!\nCCLI Song # 123\n© Someone'
    ),
    'your grace is enough and more'
  )
})

test('SongSelect splits words across chords, which does not hide a line from the search', () => {
  const chart = '{title: A}\nYour gr[C]ace is e - [D]nough\nA - [G]gain and a - [A]gain'
  const library = [{ ...lib('Split Words'), lyrics: lyricsOf(chart) }]
  assert.equal(lyricsOf(chart), 'your grace is enough again and again')
  assert.equal(matchLibrary(song('Your Grace Is Enough'), library).kind, 'possible')
  assert.equal(matchLibrary(song('Again And Again'), library).kind, 'possible')
  assert.equal(matchLibrary(song('Our Grace Is Enough'), library).kind, 'none', 'whole words still')
})

test('with no title that matches, a line of a song’s words does, for the person to confirm', () => {
  const match = matchLibrary(song('Your Grace Is Enough'), wordy)
  assert.equal(match.kind, 'possible')
  assert.equal(match.kind === 'possible' && match.via, 'lyrics')
  // The song with the line most often first
  assert.deepEqual(match.kind === 'possible' && match.candidates.map(c => c.title), [
    'Yet Another',
    'This Is Our God',
  ])
})

test('a title that matches is not looked for in the words', () => {
  const match = matchLibrary(song('Another Song'), wordy)
  assert.equal(match.kind, 'title')
})

test('the words are only searched for a title of two words or more, and a few letters', () => {
  assert.equal(matchLibrary(song('Grace'), wordy).kind, 'none', 'one word is in many songs')
  assert.equal(matchLibrary(song('Is It'), wordy).kind, 'none', 'too short')
  assert.equal(matchLibrary(song('Our Grace Is Enough'), wordy).kind, 'none', 'not a line of them')
})

test('another of its titles can be the line: "Your Grace Is Enough (This Is Our God)"', () => {
  const asked = song('Your Grace Is Enough (This Is Our God)', {
    titles: ['Your Grace Is Enough (This Is Our God)', 'Your Grace Is Enough', 'This Is Our God'],
  })
  assert.equal(
    matchLibrary(asked, wordy).kind,
    'title',
    'This Is Our God is a title of the library'
  )
})
