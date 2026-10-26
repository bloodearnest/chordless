import { expect } from '@open-wc/testing'
import {
  filterSongs,
  lyricSnippet,
  matchedFields,
  warmSearch,
} from '../src/js/utils/song-filter.ts'

const { describe, it } = window

describe('filterSongs', () => {
  const songs = [
    { title: 'Amazing Grace', artist: 'John Newton' },
    { title: 'How Great Thou Art', artist: 'Carl Boberg' },
    { title: 'Untitled' },
  ]

  it('returns every song for an empty or blank search', () => {
    expect(filterSongs(songs, '')).to.equal(songs)
    expect(filterSongs(songs, '   ')).to.equal(songs)
  })

  it('matches the title, ignoring case', () => {
    expect(filterSongs(songs, 'great').map(song => song.title)).to.deep.equal([
      'How Great Thou Art',
    ])
  })

  it('matches the artist', () => {
    expect(filterSongs(songs, 'newton').map(song => song.title)).to.deep.equal(['Amazing Grace'])
  })

  it('matches lyrics, but not chords, when a song has a chart', () => {
    const parsed = {
      metadata: {},
      sections: [
        {
          type: 'section' as const,
          label: 'Verse',
          lines: [
            {
              segments: [
                { chord: 'Gsus', lyrics: 'Was blind ' },
                { chord: 'D', lyrics: 'but now I see' },
              ],
            },
          ],
        },
      ],
    }
    const withLyrics = [{ title: 'A', parsed }, { title: 'B' }]
    expect(filterSongs(withLyrics, 'blind but').map(song => song.title)).to.deep.equal(['A'])
    expect(filterSongs(withLyrics, 'gsus')).to.deep.equal([])
  })

  describe('ranking', () => {
    const chart = (words: string) => ({
      metadata: {},
      sections: [
        {
          type: 'section' as const,
          label: 'Verse',
          lines: [{ segments: [{ chord: 'G', lyrics: words }] }],
        },
      ],
    })
    const library = [
      { title: 'Alleluia', parsed: chart('We praise you') },
      { title: 'Sing Praise Now' },
      { title: 'Songs of Praises' },
      { title: 'Praise the Lord' },
      { title: 'Hymn', artist: 'Praise Band' },
      { title: 'Praise' },
      { title: 'Unpraised' },
    ]
    const titles = (term: string) => filterSongs(library, term).map(song => song.title)

    it('puts an exact title first, then titles starting with the term, then the rest', () => {
      expect(titles('praise')).to.deep.equal([
        'Praise',
        'Praise the Lord',
        'Sing Praise Now',
        'Songs of Praises',
        'Unpraised',
        'Hymn',
        'Alleluia',
      ])
    })

    it('never puts a lyrics-only song above a title match', () => {
      const result = titles('praise')
      expect(result.indexOf('Alleluia')).to.equal(result.length - 1)
    })

    it('keeps the input order within a rank', () => {
      const same = [{ title: 'B Praise' }, { title: 'A Praise' }]
      expect(filterSongs(same, 'praise').map(song => song.title)).to.deep.equal([
        'B Praise',
        'A Praise',
      ])
    })

    it('does not change the songs it is given', () => {
      const copy = [...library]
      filterSongs(library, 'praise')
      expect(library).to.deep.equal(copy)
    })
  })

  describe('by the words', () => {
    const chart = (words: string) => ({
      metadata: {},
      sections: [
        {
          type: 'section' as const,
          label: 'Verse',
          lines: words.split('\n').map(line => ({ segments: [{ chord: 'G', lyrics: line }] })),
        },
      ],
    })
    const library = [
      {
        title: 'Passing',
        parsed: chart('We praise you\nthe rest is about a mountain else\nmore words'),
      },
      { title: 'Repeating', parsed: chart('Praise him\npraise him\npraise him\nPraise') },
      { title: 'Other forms', parsed: chart('He is praising\nand singing') },
      { title: 'No words' },
    ]
    const titles = (term: string) => filterSongs(library, term).map(song => song.title)

    it('orders songs matching only in the lyrics by how well, not by the library order', () => {
      expect(titles('praise').slice(0, 2)).to.deep.equal(['Repeating', 'Passing'])
    })

    it('puts songs with another form of the word after every song with the letters', () => {
      expect(titles('praise')).to.deep.equal(['Repeating', 'Passing', 'Other forms'])
    })

    it('finds a longer form of the word typed', () => {
      expect(titles('praises')).to.have.members(['Repeating', 'Passing', 'Other forms'])
    })

    it('ranks a song whose title, artist or variant has the word like one with the letters', () => {
      const parsed = chart('Praise him\npraise him\npraise him')
      const songs = [
        { title: 'Lyrics only', parsed },
        { title: 'Variant', variantLabel: 'Praising set' },
        { title: 'Artist', artist: 'The Praising Band' },
        { title: 'Praise' },
        { artist: 'No title: Praised Be' },
        { title: 'Elsewhere', artist: 'Someone', variantLabel: 'Else' },
      ]
      expect(filterSongs(songs, 'praises').map(song => song.title)).to.deep.equal([
        'Praise',
        'Variant',
        'Artist',
        undefined,
        'Lyrics only',
      ])
    })

    it('finds a slip of the fingers, and words in another order', () => {
      expect(titles('mountan')).to.deep.equal(['Passing'])
      expect(titles('else about')).to.deep.equal(['Passing'])
    })

    it('puts back a word SongSelect split across chords', () => {
      const split = [{ title: 'Split', parsed: chart('Hallelu - jah to the King') }]
      expect(filterSongs(split, 'hallelujah')).to.have.length(1)
    })

    it('can make the index ahead of the first search', async () => {
      const songs = [{ title: 'Ahead', parsed: chart('mercies new') }]
      warmSearch(songs)
      await new Promise(resolve => setTimeout(resolve, 400))
      expect(filterSongs(songs, 'mercy').map(song => song.title)).to.deep.equal(['Ahead'])
    })

    it('searches again when the songs change, and not when they have not', () => {
      const first = [{ title: 'A', parsed: chart('mercies new') }]
      expect(filterSongs(first, 'mercy')).to.have.length(1)
      expect(filterSongs([...first], 'mercy')).to.have.length(1)
      const second = [{ title: 'B', parsed: chart('something else') }]
      expect(filterSongs(second, 'mercy')).to.have.length(0)
    })
  })

  it('copes with songs missing a title or artist', () => {
    expect(filterSongs([{ artist: 'Carl Boberg' }, { title: null }], 'boberg')).to.have.length(1)
    expect(filterSongs(songs, 'untitled')).to.have.length(1)
    expect(filterSongs(songs, 'zzz')).to.deep.equal([])
  })

  it('says which fields matched, and quotes the lyric line', () => {
    const parsed = {
      metadata: {},
      sections: [
        {
          type: 'section' as const,
          label: null,
          lines: [
            {
              segments: [
                { chord: 'G', lyrics: 'Amazing grace, how ' },
                { chord: 'D', lyrics: 'sweet the sound' },
              ],
            },
          ],
        },
      ],
    }
    const song = { title: 'Grace', artist: 'Newton', parsed }
    expect(matchedFields(song, 'newton')).to.deep.equal({
      title: false,
      artist: true,
      label: false,
      lyrics: false,
    })
    expect(matchedFields(song, 'grace')).to.deep.equal({
      title: true,
      artist: false,
      label: false,
      lyrics: true,
    })
    expect(lyricSnippet(parsed, 'how sweet')).to.deep.equal({
      before: 'Amazing grace, ',
      match: 'how sweet',
      after: ' the sound',
    })
    expect(lyricSnippet(parsed, 'zzz')).to.equal(undefined)
  })
})

describe('matching in songs with missing fields, and quoting long lines', () => {
  const chart = (...lyrics: string[]) => ({
    metadata: {},
    sections: [
      {
        type: 'section' as const,
        label: null,
        lines: lyrics.map(text => ({ segments: [{ chord: '', lyrics: text }] })),
      },
    ],
  })

  it('finds a variant by what it is called', () => {
    const songs = [
      { title: 'Grace', variantLabel: 'Capo 3' },
      { title: 'Grace', variantLabel: 'Original' },
    ]
    expect(filterSongs(songs, 'capo')).to.deep.equal([songs[0]])
    expect(matchedFields(songs[0], 'CAPO').label).to.equal(true)
  })

  it('matches nothing in a song with no title or artist, and nothing at all for no search', () => {
    expect(matchedFields({}, 'grace')).to.deep.equal({
      title: false,
      artist: false,
      label: false,
      lyrics: false,
    })
    expect(matchedFields({ title: 'Grace' }, '  ')).to.deep.equal({
      title: false,
      artist: false,
      label: false,
      lyrics: false,
    })
    expect(lyricSnippet(chart('Amazing grace'), '  ')).to.equal(undefined)
  })

  it('cuts a long line to either side of the match, marking where', () => {
    const line = `${'a'.repeat(60)} grace ${'b'.repeat(60)}`
    const snippet = lyricSnippet(chart(line), 'grace')
    expect(snippet?.match).to.equal('grace')
    expect(snippet?.before.startsWith('…')).to.equal(true)
    expect(snippet?.after.endsWith('…')).to.equal(true)
    expect(snippet?.before.length).to.equal(41)
  })

  it('does not mark an end that is the end of the line', () => {
    const snippet = lyricSnippet(chart('grace'), 'grace')
    expect(snippet).to.deep.equal({ before: '', match: 'grace', after: '' })
  })

  it('finds the place in a line that changes length when lower-cased by its words', () => {
    // "İ" is two characters in lower case, so a position in one is not a position in the other:
    // the letters are not searched for there, the words are, in the line as it is
    expect(lyricSnippet(chart('İstanbul grace'), 'grace')).to.deep.equal({
      before: 'İstanbul ',
      match: 'grace',
      after: '',
    })
  })

  it('quotes the line with the words searched for when the letters are not in it', () => {
    const parsed = chart('We are praising him, praising')
    expect(lyricSnippet(parsed, 'praises')).to.deep.equal({
      before: 'We are ',
      match: 'praising',
      after: ' him, praising',
    })
    expect(lyricSnippet(parsed, 'worshippin')).to.equal(undefined)
  })

  it('quotes the line with the most of the words, when the letters are in none', () => {
    const lines = ['We sing of mercies', 'Mercy, mercies and mercy', 'Mercy again'].map(words => ({
      segments: [{ chord: 'G', lyrics: words }],
    }))
    const parsed = { metadata: {}, sections: [{ type: 'section' as const, label: 'V', lines }] }
    expect(lyricSnippet(parsed, 'merciful')?.match).to.equal('Mercy')
    expect(lyricSnippet(parsed, 'merciful')?.after).to.equal(', mercies and mercy')
  })
})
