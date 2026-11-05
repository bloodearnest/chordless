import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lyricsToChordpro } from '../src/js/lyrics-chordpro.ts'

const credits = (authors = 'A Writer, B Writer') =>
  `${authors}\nCCLI Song #123\n© 2020 Some Music; Other Music\nFor use solely with the SongSelect® Terms of Use.  All rights reserved. www.ccli.com\nCCLI Licence No.456`

describe('lyricsToChordpro', () => {
  it('makes the metadata directives and a comment for each section', () => {
    const chart = lyricsToChordpro(
      `A Song\n\nVerse 1\nLine one\nLine two\n\nChorus\nSing it\n\n${credits()}`
    )
    assert.equal(
      chart,
      [
        '{title: A Song}',
        '{artist: A Writer, B Writer}',
        '{ccli_license: 456}',
        '{ccli: 123}',
        '{copyright: 2020 Some Music; Other Music}',
        '{footer: For use solely with the SongSelect® Terms of Use.  All rights reserved. www.ccli.com}',
        '',
        '{comment: Verse 1}',
        'Line one',
        'Line two',
        '',
        '{comment: Chorus}',
        'Sing it',
        '',
      ].join('\n')
    )
  })

  it('keeps a section with no heading as lyrics, and a lone heading-like line as a lyric', () => {
    const chart = lyricsToChordpro('T\n\nJust words\nmore words\n\nChorus\n\nTag')
    assert.match(chart as string, /\nJust words\nmore words\n/)
    assert.match(chart as string, /\nChorus\n/)
    assert.doesNotMatch(chart as string, /\{comment:/)
  })

  it('reads the authors when the credits have a blank line before them', () => {
    const chart = lyricsToChordpro('T\n\nVerse\nWords\n\nAn Author\n\nCCLI Song #7\n© 1999 X')
    assert.match(chart as string, /\{artist: An Author\}/)
    assert.match(chart as string, /\{copyright: 1999 X\}/)
  })

  it('copes with Windows line endings, braces and credits it does not have', () => {
    const chart = lyricsToChordpro('Odd {Title}\r\n\r\nBridge\r\nOh {oh}\r\n')
    assert.equal(chart, '{title: Odd Title}\n\n{comment: Bridge}\nOh {oh}\n')
  })

  it('is null when it is not lyrics', () => {
    assert.equal(lyricsToChordpro(''), null)
    assert.equal(lyricsToChordpro('Only a title'), null)
    assert.equal(lyricsToChordpro(`T\n\n${credits()}`), null)
  })
})
