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

/**
 * The routes that are views in the app shell (index.html, which the service
 * worker serves for them), rather than pages of their own. Moves over one page
 * at a time; views/registry.js has a view for each.
 */
export const SHELL_ROUTES = ['home']

const PAGE_PATHS = Object.fromEntries(Object.entries(PAGES).map(([path, name]) => [name, path]))

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
 * @param {string | {pathname: string}} location a URL string or path, or a
 *   Location/URL. The query string and hash are ignored.
 */
export function matchRoute(location) {
  const pathname =
    typeof location === 'string'
      ? new URL(location, 'http://chordless.invalid').pathname
      : location.pathname
  const path = normalizePath(pathname)

  const page = PAGES[path]
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
      return route.songUuid ? `/songs/${encodeURIComponent(route.songUuid)}` : '/songs'
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
 * How moving from one route to another changes the browser history:
 *
 *   'push'     add an entry (going deeper into the app)
 *   'replace'  swap the current entry (a lateral move, or no move at all)
 *   'back'     go back one entry (undoing an earlier push)
 *
 * In a setlist: overview to a song pushes; song to song replaces; song to
 * overview goes back if the song was reached from the overview (the entry we
 * pushed), and replaces if it was a direct link. Moves between pages push.
 *
 * @param {object} from the current route
 * @param {object} to the target route
 * @param {{fromOverview?: boolean} | null} [state] the current history entry's state
 */
export function historyAction(from, to, state) {
  if (sameRoute(from, to)) return 'replace'

  const inSameSetlist =
    from.name === 'setlist' && to.name === 'setlist' && from.setlistId === to.setlistId
  if (!inSameSetlist) return 'push'

  const fromSong = from.songIndex >= 0
  const toSong = to.songIndex >= 0
  if (!fromSong && toSong) return 'push'
  if (fromSong && toSong) return 'replace'
  if (fromSong && !toSong) return state?.fromOverview ? 'back' : 'replace'
  return 'replace'
}
