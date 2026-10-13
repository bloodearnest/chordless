import { expect } from '@esm-bundle/chai'
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
      lyrics: false,
    })
    expect(matchedFields(song, 'grace')).to.deep.equal({ title: true, artist: false, lyrics: true })
    expect(lyricSnippet(parsed, 'how sweet')).to.deep.equal({
      before: 'Amazing grace, ',
      match: 'how sweet',
      after: ' the sound',
    })
    expect(lyricSnippet(parsed, 'zzz')).to.equal(undefined)
  })
})
