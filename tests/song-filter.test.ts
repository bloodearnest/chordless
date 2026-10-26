import { expect } from '@open-wc/testing'
import { filterSongs, lyricSnippet, matchedFields } from '../src/js/utils/song-filter.ts'

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

  it('copes with songs missing a title or artist', () => {
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

  it('finds no place in a line that changes length when lower-cased', () => {
    // "İ" is two characters in lower case, so a position in one is not a position in the other
    expect(lyricSnippet(chart('İstanbul grace'), 'grace')).to.equal(undefined)
  })
})
