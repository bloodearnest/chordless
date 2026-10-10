import { expect } from '@esm-bundle/chai'
import {
  buildUrl,
  historyAction,
  matchRoute,
  normalizePath,
  sameRoute,
} from '../public/js/router.js'

const { describe, it } = window

describe('normalizePath', () => {
  it('drops the .html extension and trailing slashes', () => {
    expect(normalizePath('/songs.html')).to.equal('/songs')
    expect(normalizePath('/songs/')).to.equal('/songs')
    expect(normalizePath('/setlist/abc/')).to.equal('/setlist/abc')
  })

  it('maps /index.html and the empty path to the root', () => {
    expect(normalizePath('/index.html')).to.equal('/')
    expect(normalizePath('/')).to.equal('/')
    expect(normalizePath('')).to.equal('/')
  })
})

describe('matchRoute', () => {
  it('matches each page by its clean path and its variants', () => {
    for (const name of ['songs', 'preferences', 'storage', 'import-song', 'bookmarklet']) {
      expect(matchRoute(`/${name}`)).to.deep.equal({ name })
      expect(matchRoute(`/${name}/`)).to.deep.equal({ name })
      expect(matchRoute(`/${name}.html`)).to.deep.equal({ name })
    }
    expect(matchRoute('/')).to.deep.equal({ name: 'home' })
    expect(matchRoute('/index.html')).to.deep.equal({ name: 'home' })
  })

  it('reads the song a library URL names', () => {
    expect(matchRoute('/songs/abc-123')).to.deep.equal({ name: 'songs', songUuid: 'abc-123' })
    expect(matchRoute('/songs/abc-123/').songUuid).to.equal('abc-123')
  })

  it('matches a setlist as its overview, or as a song when the path names one', () => {
    expect(matchRoute('/setlist/abc')).to.deep.equal({
      name: 'setlist',
      setlistId: 'abc',
      songIndex: -1,
    })
    expect(matchRoute('/setlist/abc/song/0')).to.deep.equal({
      name: 'setlist',
      setlistId: 'abc',
      songIndex: 0,
    })
    expect(matchRoute('/setlist/abc/song/12/').songIndex).to.equal(12)
  })

  it('takes a Location-like object as well as a string', () => {
    expect(matchRoute({ pathname: '/setlist/abc/song/3' })).to.deep.equal({
      name: 'setlist',
      setlistId: 'abc',
      songIndex: 3,
    })
    expect(matchRoute({ pathname: '/storage' })).to.deep.equal({ name: 'storage' })
  })

  it('ignores the query string and the hash', () => {
    expect(matchRoute('/songs/abc?x=1#top')).to.deep.equal({ name: 'songs', songUuid: 'abc' })
    expect(matchRoute('/storage#section')).to.deep.equal({ name: 'storage' })
  })

  it('decodes an encoded setlist id', () => {
    expect(matchRoute('/setlist/a%20b').setlistId).to.equal('a b')
  })

  it('does not match a malformed setlist path', () => {
    for (const path of [
      '/setlist',
      '/setlist/abc/song',
      '/setlist/abc/song/x',
      '/setlist/abc/song/-1',
      '/setlist/abc/other/1',
    ]) {
      expect(matchRoute(path), path).to.deep.equal({ name: 'not-found', path })
    }
  })

  it('reports an unknown path as not found', () => {
    expect(matchRoute('/nope')).to.deep.equal({ name: 'not-found', path: '/nope' })
  })
})

describe('buildUrl', () => {
  it('builds each page path', () => {
    expect(buildUrl({ name: 'home' })).to.equal('/')
    expect(buildUrl({ name: 'storage' })).to.equal('/storage')
    expect(buildUrl({ name: 'import-song' })).to.equal('/import-song')
  })

  it('builds the library URL, with the song in the path when there is one', () => {
    expect(buildUrl({ name: 'songs' })).to.equal('/songs')
    expect(buildUrl({ name: 'songs', songUuid: 'abc' })).to.equal('/songs/abc')
  })

  it('builds setlist URLs in the path form', () => {
    expect(buildUrl({ name: 'setlist', setlistId: 'abc', songIndex: -1 })).to.equal('/setlist/abc')
    expect(buildUrl({ name: 'setlist', setlistId: 'abc', songIndex: 4 })).to.equal(
      '/setlist/abc/song/4'
    )
  })

  it('encodes ids that need it', () => {
    expect(buildUrl({ name: 'setlist', setlistId: 'a b', songIndex: -1 })).to.equal(
      '/setlist/a%20b'
    )
  })

  it('throws for an unknown route name', () => {
    expect(() => buildUrl({ name: 'mystery' })).to.throw('Unknown route')
  })

  it('round-trips through matchRoute', () => {
    const routes = [
      { name: 'home' },
      { name: 'songs' },
      { name: 'songs', songUuid: 'abc-123' },
      { name: 'preferences' },
      { name: 'storage' },
      { name: 'import-song' },
      { name: 'bookmarklet' },
      { name: 'setlist', setlistId: 'abc', songIndex: -1 },
      { name: 'setlist', setlistId: 'a b', songIndex: 7 },
      { name: 'not-found', path: '/nope' },
    ]
    for (const route of routes) {
      expect(matchRoute(buildUrl(route))).to.deep.equal(route)
    }
  })
})

describe('sameRoute', () => {
  it('compares the place', () => {
    const overview = { name: 'setlist', setlistId: 'a', songIndex: -1 }
    expect(sameRoute(overview, { ...overview })).to.equal(true)
    expect(sameRoute(overview, { ...overview, songIndex: 0 })).to.equal(false)
    expect(sameRoute({ name: 'home' }, { name: 'storage' })).to.equal(false)
  })
})

describe('historyAction', () => {
  const overview = { name: 'setlist', setlistId: 'a', songIndex: -1 }
  const song = index => ({ name: 'setlist', setlistId: 'a', songIndex: index })

  it('pushes when going from the overview into a song', () => {
    expect(historyAction(overview, song(0))).to.equal('push')
  })

  it('replaces when moving from song to song', () => {
    expect(historyAction(song(0), song(1))).to.equal('replace')
  })

  it('goes back from a song to the overview it was opened from', () => {
    expect(historyAction(song(2), overview, { fromOverview: true })).to.equal('back')
  })

  it('replaces from a song to the overview when it was a direct link', () => {
    expect(historyAction(song(2), overview)).to.equal('replace')
    expect(historyAction(song(2), overview, { fromOverview: false })).to.equal('replace')
  })

  it('replaces when the target is where we already are', () => {
    expect(historyAction(overview, overview)).to.equal('replace')
    expect(historyAction({ name: 'home' }, { name: 'home' })).to.equal('replace')
  })

  it('pushes when moving between pages', () => {
    expect(historyAction({ name: 'home' }, { name: 'songs' })).to.equal('push')
    expect(historyAction(song(1), { name: 'storage' })).to.equal('push')
  })

  it('pushes when moving to a different setlist', () => {
    expect(historyAction(song(1), { name: 'setlist', setlistId: 'b', songIndex: 1 })).to.equal(
      'push'
    )
  })
})
