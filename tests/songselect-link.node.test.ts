import assert from 'node:assert/strict'
import { test } from 'node:test'
import { songSelectLink } from '../src/js/songselect-link.ts'

test('a song with a CCLI number links to its SongSelect page, which the bookmarklet reads', () => {
  const link = songSelectLink({ ccli: '7106807', title: 'Living Hope' })
  assert.equal(link, 'https://songselect.ccli.com/songs/7106807')
  assert.equal(/\/songs\/(\d+)/.exec(link)?.[1], '7106807')
})

test('a song with none links to a search for its title, without bracketed extras', () => {
  assert.equal(
    songSelectLink({ ccli: null, title: "Grace You've Shown Me Grace (You Have Won Me)" }),
    "https://songselect.ccli.com/search/results?search=Grace%20You've%20Shown%20Me%20Grace"
  )
  assert.equal(
    songSelectLink({ ccli: 'abc', title: 'Majesty, Here I am' }),
    'https://songselect.ccli.com/search/results?search=Majesty%2C%20Here%20I%20am',
    'a number that is not one is not used'
  )
  assert.equal(
    songSelectLink({ ccli: null, title: '(Only Brackets)' }).includes('Only%20Brackets'),
    true
  )
})
