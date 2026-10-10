import { expect } from '@esm-bundle/chai'
import {
  buildUrl,
  historyAction,
  isDescent,
  matchRoute,
  normalizePath,
  sameRoute,
} from '../src/js/router.ts'

const { describe, it } = window

// One test for each case, so a failure names it

describe('normalizePath', () => {
  const cases = [
    ['/songs.html', '/songs'],
    ['/songs/', '/songs'],
    ['/setlist/abc/', '/setlist/abc'],
    ['/index.html', '/'],
    ['/', '/'],
    ['', '/'],
  ]
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} is ${expected}`, () => {
      expect(normalizePath(input)).to.equal(expected)
    })
  }
})

describe('matchRoute', () => {
  const pages = ['songs', 'preferences', 'storage', 'import-song', 'bookmarklet']
  const setlist = (setlistId, songIndex) => ({ name: 'setlist', setlistId, songIndex })
  const notFound = path => ({ name: 'not-found', path })

  const cases = [
    // Each page, by its clean path and its variants
    ...pages.flatMap(name =>
      [`/${name}`, `/${name}/`, `/${name}.html`].map(path => [path, { name }])
    ),
    ['/', { name: 'home' }],
    ['/index.html', { name: 'home' }],

    // The library list, searched
    ['/songs?q=grace', { name: 'songs', search: 'grace' }],
    ['/songs?q=amazing%20grace', { name: 'songs', search: 'amazing grace' }],
    ['/songs?q=amazing+grace', { name: 'songs', search: 'amazing grace' }],
    ['/songs?q=', { name: 'songs' }],
    ['/songs?other=1', { name: 'songs' }],
    [
      { pathname: '/songs', search: '?q=hi' },
      { name: 'songs', search: 'hi' },
    ],

    // A song of the library
    ['/songs/abc-123', { name: 'songs', songUuid: 'abc-123' }],
    ['/songs/abc-123?q=grace', { name: 'songs', songUuid: 'abc-123' }], // the search is the list's
    ['/songs/abc-123/', { name: 'songs', songUuid: 'abc-123' }],

    // A setlist: its overview, or a song when the path names one
    ['/setlist/abc', setlist('abc', -1)],
    ['/setlist/abc/song/0', setlist('abc', 0)],
    ['/setlist/abc/song/12/', setlist('abc', 12)],
    ['/setlist/a%20b', setlist('a b', -1)], // an encoded id is decoded

    // Also accepted: a Location-like object
    [{ pathname: '/setlist/abc/song/3' }, setlist('abc', 3)],
    [{ pathname: '/storage' }, { name: 'storage' }],

    // The query string and the hash say nothing
    ['/songs/abc?x=1#top', { name: 'songs', songUuid: 'abc' }],
    ['/storage#section', { name: 'storage' }],

    // Not a route
    ['/nope', notFound('/nope')],
    ['/songs/a/b', notFound('/songs/a/b')],
    ['/setlist', notFound('/setlist')],
    ['/setlist/abc/song', notFound('/setlist/abc/song')],
    ['/setlist/abc/song/x', notFound('/setlist/abc/song/x')],
    ['/setlist/abc/song/-1', notFound('/setlist/abc/song/-1')],
    ['/setlist/abc/other/1', notFound('/setlist/abc/other/1')],
  ]
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} is ${JSON.stringify(expected)}`, () => {
      expect(matchRoute(input)).to.deep.equal(expected)
    })
  }
})

describe('buildUrl', () => {
  const routes = [
    [{ name: 'home' }, '/'],
    [{ name: 'songs' }, '/songs'],
    [{ name: 'songs', search: 'amazing grace' }, '/songs?q=amazing%20grace'],
    [{ name: 'songs', songUuid: 'abc-123' }, '/songs/abc-123'],
    [{ name: 'preferences' }, '/preferences'],
    [{ name: 'storage' }, '/storage'],
    [{ name: 'import-song' }, '/import-song'],
    [{ name: 'bookmarklet' }, '/bookmarklet'],
    [{ name: 'setlist', setlistId: 'abc', songIndex: -1 }, '/setlist/abc'],
    [{ name: 'setlist', setlistId: 'abc', songIndex: 4 }, '/setlist/abc/song/4'],
    [{ name: 'setlist', setlistId: 'a b', songIndex: -1 }, '/setlist/a%20b'], // ids are encoded
    [{ name: 'setlist', setlistId: 'a b', songIndex: 7 }, '/setlist/a%20b/song/7'],
    [{ name: 'not-found', path: '/nope' }, '/nope'],
  ]
  for (const [route, url] of routes) {
    it(`builds ${url} from ${JSON.stringify(route)}`, () => {
      expect(buildUrl(route)).to.equal(url)
    })
    it(`${url} matches back to the same route`, () => {
      expect(matchRoute(buildUrl(route))).to.deep.equal(route)
    })
  }

  it('throws for an unknown route name', () => {
    expect(() => buildUrl({ name: 'mystery' })).to.throw('Unknown route')
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
    expect(historyAction(song(2), overview, { fromParent: true })).to.equal('back')
  })

  it('replaces from a song to the overview when it was a direct link', () => {
    expect(historyAction(song(2), overview)).to.equal('replace')
    expect(historyAction(song(2), overview, { fromParent: false })).to.equal('replace')
  })

  it('copes with a history entry that has no state', () => {
    expect(historyAction(song(2), overview, null)).to.equal('replace')
    expect(historyAction(overview, song(2), null)).to.equal('push')
  })

  it('replaces when the target is where we already are', () => {
    expect(historyAction(overview, overview)).to.equal('replace')
    expect(historyAction({ name: 'home' }, { name: 'home' })).to.equal('replace')
  })

  it('pushes when moving between pages', () => {
    expect(historyAction({ name: 'home' }, { name: 'songs' })).to.equal('push')
    expect(historyAction(song(1), { name: 'storage' })).to.equal('push')
  })

  describe('in the library', () => {
    const list = { name: 'songs' }
    const librarySong = uuid => ({ name: 'songs', songUuid: uuid })

    it('pushes from the list into a song, and replaces from song to song', () => {
      expect(historyAction(list, librarySong('a'))).to.equal('push')
      expect(historyAction(librarySong('a'), librarySong('b'))).to.equal('replace')
    })

    it('goes back from a song to the list it was opened from', () => {
      expect(historyAction(librarySong('a'), list, { fromParent: true })).to.equal('back')
      expect(historyAction(librarySong('a'), list)).to.equal('replace')
    })

    it('pushes between the library and other pages', () => {
      expect(historyAction({ name: 'home' }, list)).to.equal('push')
      expect(historyAction(librarySong('a'), { name: 'storage' })).to.equal('push')
    })
  })

  describe('isDescent', () => {
    it('is true from a list or overview into one of its own songs only', () => {
      expect(isDescent({ name: 'songs' }, { name: 'songs', songUuid: 'a' })).to.equal(true)
      expect(isDescent(overview, song(0))).to.equal(true)
      expect(isDescent(song(0), song(1))).to.equal(false)
      expect(isDescent(song(0), overview)).to.equal(false)
      expect(isDescent({ name: 'home' }, { name: 'songs', songUuid: 'a' })).to.equal(false)
      expect(isDescent(overview, { name: 'setlist', setlistId: 'b', songIndex: 0 })).to.equal(false)
    })
  })

  it('pushes when moving to a different setlist', () => {
    expect(historyAction(song(1), { name: 'setlist', setlistId: 'b', songIndex: 1 })).to.equal(
      'push'
    )
  })
})
