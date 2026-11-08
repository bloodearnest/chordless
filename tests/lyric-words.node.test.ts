/** Lyrics as they are compared (src/js/utils/lyric-words.ts) */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lyricWords, normalLyrics } from '../src/js/utils/lyric-words.ts'

describe('lyric words', () => {
  it('ignores case, marks and spacing', () => {
    assert.equal(normalLyrics('  Don’t,   STOP!\tnow '), 'don t stop now')
  })

  it('reads a straight and a curly apostrophe alike', () => {
    assert.deepEqual(lyricWords("don't"), lyricWords('don’t'))
  })

  it('keeps letters beyond a to z, and numbers', () => {
    assert.deepEqual(lyricWords('Señor, 10 000 reasons'), ['señor', '10', '000', 'reasons'])
  })

  it('gives no words for marks alone', () => {
    assert.deepEqual(lyricWords(' — … '), [])
  })
})
