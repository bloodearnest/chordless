import { expect } from '@esm-bundle/chai'
import { filterSongs } from '../public/js/utils/song-filter.js'

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

  it('matches lyrics, when a song has them', () => {
    const withLyrics = [{ title: 'A', lyricsText: 'Was blind but now I see' }, { title: 'B' }]
    expect(filterSongs(withLyrics, 'blind').map(song => song.title)).to.deep.equal(['A'])
  })

  it('copes with songs missing a title or artist', () => {
    expect(filterSongs(songs, 'untitled')).to.have.length(1)
    expect(filterSongs(songs, 'zzz')).to.deep.equal([])
  })
})
