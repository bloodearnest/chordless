/**
 * Routes of the app: parsing a URL into a route, building a URL from one, and
 * deciding how a move between two routes touches the browser history.
 *
 * Pure functions, with no DOM or history access, so they are easy to test and
 * can be shared by the page code and the service worker.
 *
 * A route is a plain object:
 *   { name: 'home' }
 *   { name: 'songs', songUuid?: string }     /songs, /songs/<song uuid>
 *   { name: 'songs', search: string }        /songs?q=<search>: the list, searched
 *   { name: 'preferences' | 'storage' | 'import-song' | 'bookmarklet' }
 *   { name: 'setlist', setlistId, songIndex } /setlist/<id> (the overview, songIndex -1)
 *                                             /setlist/<id>/song/<n>
 *   { name: 'not-found', path }
 */

/** Pages that are a path of their own and nothing else. */
const PAGES = {
  '/': 'home',
  '/songs': 'songs',
  '/preferences': 'preferences',
  '/storage': 'storage',
  '/import-song': 'import-song',
  '/bookmarklet': 'bookmarklet',
}

const PAGE_PATHS = Object.fromEntries(Object.entries(PAGES).map(([path, name]) => [name, path]))

/**
 * Every route name. Each is a view of the app shell (see views/registry.js),
 * which the service worker serves for every URL.
 */
export const ROUTE_NAMES = [...Object.values(PAGES), 'setlist', 'not-found']

const SONGS_SONG_PATH = /^\/songs\/([^/]+)$/
const SETLIST_PATH = /^\/setlist\/([^/]+)$/
const SETLIST_SONG_PATH = /^\/setlist\/([^/]+)\/song\/(\d+)$/

/**
 * The clean path for a URL path: no trailing slash, no .html. (Wrangler serves
 * /songs for songs.html, and /index.html is the home page.)
 */
export function normalizePath(pathname) {
  let path = pathname || '/'
  if (path === '/index.html') return '/'
  path = path.replace(/\.html$/, '')
  if (path.length > 1) path = path.replace(/\/+$/, '')
  return path || '/'
}

function decode(part) {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/**
 * Parse a location into a route.
 * @param {string | {pathname: string, search?: string}} location a URL string or path,
 *   or a Location/URL. Only the library's ?q= is read of the query string; the hash is ignored.
 */
export function matchRoute(location) {
  let pathname
  let search
  if (typeof location === 'string') {
    const url = new URL(location, 'http://chordless.invalid')
    pathname = url.pathname
    search = url.search
  } else {
    pathname = location.pathname
    search = location.search ?? ''
  }
  const path = normalizePath(pathname)

  const page = PAGES[path]
  // The library list can be searched: /songs?q=...
  if (page === 'songs') {
    const query = new URLSearchParams(search).get('q')
    return query ? { name: 'songs', search: query } : { name: 'songs' }
  }
  if (page) return { name: page }

  const librarySong = path.match(SONGS_SONG_PATH)
  if (librarySong) return { name: 'songs', songUuid: decode(librarySong[1]) }

  const setlistSong = path.match(SETLIST_SONG_PATH)
  if (setlistSong) {
    return { name: 'setlist', setlistId: decode(setlistSong[1]), songIndex: Number(setlistSong[2]) }
  }

  const setlist = path.match(SETLIST_PATH)
  if (setlist) {
    return { name: 'setlist', setlistId: decode(setlist[1]), songIndex: -1 }
  }

  return { name: 'not-found', path }
}

/** The URL path for a route. The inverse of matchRoute. */
export function buildUrl(route) {
  switch (route.name) {
    case 'songs':
      if (route.songUuid) return `/songs/${encodeURIComponent(route.songUuid)}`
      return route.search ? `/songs?q=${encodeURIComponent(route.search)}` : '/songs'
    case 'setlist': {
      const base = `/setlist/${encodeURIComponent(route.setlistId)}`
      return route.songIndex >= 0 ? `${base}/song/${route.songIndex}` : base
    }
    case 'not-found':
      return route.path
    default: {
      const path = PAGE_PATHS[route.name]
      if (!path) throw new Error(`Unknown route: ${route.name}`)
      return path
    }
  }
}

/** True when two routes are the same place. */
export function sameRoute(a, b) {
  return buildUrl(a) === buildUrl(b)
}

/**
 * Where a route sits in a section of the app that has a list or overview and
 * things inside it: the library (its list, then a song) and a setlist (its
 * overview, then a song). Null for routes that are not in such a section.
 * @returns {{section: string, depth: number} | null}
 */
function placeOf(route) {
  if (route.name === 'songs') return { section: 'songs', depth: route.songUuid ? 1 : 0 }
  if (route.name === 'setlist') {
    return { section: `setlist:${route.setlistId}`, depth: route.songIndex >= 0 ? 1 : 0 }
  }
  return null
}

/** True when going from the list/overview of a section into one of its songs */
export function isDescent(from, to) {
  const a = placeOf(from)
  const b = placeOf(to)
  return Boolean(a && b && a.section === b.section && a.depth === 0 && b.depth === 1)
}

/**
 * How moving from one route to another changes the browser history:
 *
 *   'push'     add an entry (going deeper into the app)
 *   'replace'  swap the current entry (a lateral move, or no move at all)
 *   'back'     go back one entry (undoing an earlier push)
 *
 * Within the library or a setlist: from the list/overview into a song pushes;
 * song to song replaces; song to the list/overview goes back if the song was
 * reached from it (the entry we pushed, marked `fromParent` in the history
 * state), and replaces if it was a direct link. Moves between pages push.
 *
 * @param {object} from the current route
 * @param {object} to the target route
 * @param {{fromParent?: boolean} | null} [state] the current history entry's state
 */
export function historyAction(from, to, state) {
  if (sameRoute(from, to)) return 'replace'

  const a = placeOf(from)
  const b = placeOf(to)
  if (!a || !b || a.section !== b.section) return 'push'

  if (a.depth === 0 && b.depth === 1) return 'push'
  if (a.depth === 1 && b.depth === 1) return 'replace'
  if (a.depth === 1 && b.depth === 0) return state?.fromParent ? 'back' : 'replace'
  return 'replace'
}
