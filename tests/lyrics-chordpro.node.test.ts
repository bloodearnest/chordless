import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type SongDetails, songDetailsToChordpro } from '../src/js/lyrics-chordpro.ts'

const details = (overrides: SongDetails = {}): SongDetails => ({
  title: 'A Song',
  authors: [{ label: 'A Writer' }, { label: 'B Writer' }],
  ccliSongNumber: '123',
  copyrights: '© 2020 Some Music; Other Music',
  defaultKey: ['Bb'],
  bpm: '',
  lyrics: [
    { partLabel: 'Verse 1', lyrics: 'Line one | Line two' },
    { partLabel: 'Chorus', lyrics: 'Sing it' },
  ],
  ...overrides,
})

describe('songDetailsToChordpro', () => {
  it('makes the metadata directives and a comment for each part', () => {
    assert.equal(
      songDetailsToChordpro(details()),
      [
        '{title: A Song}',
        '{artist: A Writer, B Writer}',
        '{key: Bb}',
        '{ccli: 123}',
        '{copyright: 2020 Some Music; Other Music}',
        '',
        '{comment: Verse 1}',
        'Line one',
        'Line two',
        '',
        '{comment: Chorus}',
        'Sing it',
        '',
      ]
        .join('\n')
        .replace(/\n\n$/, '\n')
    )
  })

  it('gives the tempo when there is one, and leaves out what is missing', () => {
    const chart = songDetailsToChordpro(
      details({ bpm: '72', authors: [], defaultKey: [], copyrights: '' })
    )
    assert.match(chart as string, /\{tempo: 72\}/)
    assert.doesNotMatch(chart as string, /artist|key|copyright/)
  })

  it('keeps braces out of the directives, and skips empty parts and unlabelled ones', () => {
    const chart = songDetailsToChordpro(
      details({
        title: 'Odd {Title}',
        lyrics: [
          { partLabel: 'Empty', lyrics: ' | ' },
          { partLabel: 'None' },
          { lyrics: 'Words {oh}' },
        ],
      })
    )
    assert.match(chart as string, /^\{title: Odd Title\}/)
    assert.doesNotMatch(chart as string, /Empty/)
    assert.match(chart as string, /\n\nWords \{oh\}\n$/)
  })

  it('is null when there is no title or no lyrics', () => {
    assert.equal(songDetailsToChordpro({}), null)
    assert.equal(songDetailsToChordpro(details({ title: '' })), null)
    assert.equal(songDetailsToChordpro(details({ lyrics: [] })), null)
    assert.equal(
      songDetailsToChordpro(details({ lyrics: [{ partLabel: 'Verse', lyrics: '' }] })),
      null
    )
  })
})
