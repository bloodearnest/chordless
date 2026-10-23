/**
 * Routes of the app: parsing a URL into a route, building a URL from one, and
 * deciding how a move between two routes touches the browser history.
 *
 * Pure functions, with no DOM or history access, so they are easy to test and
 * can be shared by the page code and the service worker.
 *
 * A route is a plain object (see Route):
 *   { name: 'home' }                          /
 *   { name: 'home', shared: true }            /?shared: the home page of what was shared by link
 *   { name: 'songs', songUuid?: string }     /songs, /songs/<song uuid>
 *   { name: 'songs', search: string }        /songs?q=<search>: the list, searched
 *   { name: 'preferences' | 'account' | 'import-song' | 'import-setlist' | 'bookmarklet' | 'about' | 'join' | 'new-team-space' | 'media' }
 *                                             /account is Account and Teams (/storage still opens it);
 *                                             /account/new makes a team (team-space-wizard.ts)
 *                                             /join is a team space's invite link; the space and the
 *                                             code are in its #fragment, which routes ignore
 *   { name: 'setlist', setlistId, songIndex } /setlist/<id> (the overview, songIndex -1)
 *                                             /setlist/<id>/song/<n>
 *   { name: 'share', fileId, songIndex }     /s/<id> (a setlist shared by link, songIndex -1 for
 *                                             its overview) and /s/<id>/song/<n>. The key is in the
 *                                             URL's #fragment, which routes ignore.
 *   { name: 'not-found', path }
 */

/** Routes that are a path of their own and nothing else (and the library's list) */
export type PageName =
  | 'home'
  | 'preferences'
  | 'account'
  | 'import-song'
  | 'import-setlist'
  | 'bookmarklet'
  | 'about'
  | 'join'
  | 'new-team-space'
  | 'media'

export type Route =
  | { name: PageName }
  | { name: 'home'; shared: true }
  | { name: 'songs'; songUuid?: string; search?: string }
  | { name: 'setlist'; setlistId: string; songIndex: number }
  | { name: 'share'; fileId: string; songIndex: number }
  | { name: 'not-found'; path: string }

/** Pages that are a path of their own and nothing else. */
const PAGES: Readonly<Record<string, PageName | 'songs'>> = {
  '/': 'home',
  '/songs': 'songs',
  '/preferences': 'preferences',
  '/account': 'account',
  '/import-song': 'import-song',
  '/import-setlist': 'import-setlist',
  '/bookmarklet': 'bookmarklet',
  '/about': 'about',
  '/join': 'join',
  '/account/new': 'new-team-space',
  '/media': 'media',
}

/** Paths that open another page (the Account and Teams page was Storage) */
const ALIASES: Readonly<Record<string, string>> = { '/storage': '/account' }

const PAGE_PATHS: Record<string, string> = Object.fromEntries(
  Object.entries(PAGES).map(([path, name]) => [name, path])
)

/**
 * Every route name. Each is a view of the app shell (see views/registry.js),
 * which the service worker serves for every URL.
 */
export const ROUTE_NAMES: Route['name'][] = [
  ...Object.values(PAGES),
  'setlist',
  'share',
  'not-found',
]

const SONGS_SONG_PATH = /^\/songs\/([^/]+)$/
const SETLIST_PATH = /^\/setlist\/([^/]+)$/
const SETLIST_SONG_PATH = /^\/setlist\/([^/]+)\/song\/(\d+)$/
const SHARE_PATH = /^\/s\/([^/]+)$/
const SHARE_SONG_PATH = /^\/s\/([^/]+)\/song\/(\d+)$/

/**
 * The clean path for a URL path: no trailing slash, no .html. (Wrangler serves
 * /songs for songs.html, and /index.html is the home page.)
 */
export function normalizePath(pathname: string): string {
  let path = pathname || '/'
  if (path === '/index.html') return '/'
  path = path.replace(/\.html$/, '')
  if (path.length > 1) path = path.replace(/\/+$/, '')
  return path || '/'
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/**
 * Parse a location into a route.
 * @param location a URL string or path, or a Location/URL. Only the library's ?q= and the home
 *   page's ?shared are read of the query string; the hash is ignored.
 */
export function matchRoute(location: string | { pathname: string; search?: string }): Route {
  let pathname: string
  let search: string
  if (typeof location === 'string') {
    const url = new URL(location, 'http://chordless.invalid')
    pathname = url.pathname
    search = url.search
  } else {
    pathname = location.pathname
    search = location.search ?? ''
  }
  const normalized = normalizePath(pathname)
  const path = ALIASES[normalized] ?? normalized

  const page = PAGES[path]
  // The library list can be searched: /songs?q=...
  if (page === 'songs') {
    const query = new URLSearchParams(search).get('q')
    return query ? { name: 'songs', search: query } : { name: 'songs' }
  }
  // The home page can show what was shared: /?shared
  if (page === 'home' && new URLSearchParams(search).has('shared'))
    return { name: 'home', shared: true }
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

  const shareSong = path.match(SHARE_SONG_PATH)
  if (shareSong) {
    return { name: 'share', fileId: decode(shareSong[1]), songIndex: Number(shareSong[2]) }
  }

  const share = path.match(SHARE_PATH)
  if (share) return { name: 'share', fileId: decode(share[1]), songIndex: -1 }

  return { name: 'not-found', path }
}

/** The URL path for a route. The inverse of matchRoute. */
export function buildUrl(route: Route): string {
  switch (route.name) {
    case 'songs':
      if (route.songUuid) return `/songs/${encodeURIComponent(route.songUuid)}`
      return route.search ? `/songs?q=${encodeURIComponent(route.search)}` : '/songs'
    case 'setlist': {
      const base = `/setlist/${encodeURIComponent(route.setlistId)}`
      return route.songIndex >= 0 ? `${base}/song/${route.songIndex}` : base
    }
    case 'share': {
      const base = `/s/${encodeURIComponent(route.fileId)}`
      return route.songIndex >= 0 ? `${base}/song/${route.songIndex}` : base
    }
    case 'not-found':
      return route.path
    case 'home':
      return 'shared' in route ? '/?shared' : '/'
    default: {
      const path = PAGE_PATHS[route.name]
      if (!path) throw new Error(`Unknown route: ${route.name}`)
      return path
    }
  }
}

/** True when two routes are the same place. */
export function sameRoute(a: Route, b: Route): boolean {
  return buildUrl(a) === buildUrl(b)
}

/**
 * Where a route sits in a section of the app that has a list or overview and
 * things inside it: the library (its list, then a song) and a setlist (its
 * overview, then a song). Null for routes that are not in such a section.
 */
function placeOf(route: Route): { section: string; depth: number } | null {
  if (route.name === 'songs') return { section: 'songs', depth: route.songUuid ? 1 : 0 }
  if (route.name === 'setlist') {
    return { section: `setlist:${route.setlistId}`, depth: route.songIndex >= 0 ? 1 : 0 }
  }
  if (route.name === 'share') {
    return { section: `share:${route.fileId}`, depth: route.songIndex >= 0 ? 1 : 0 }
  }
  return null
}

/** True when going from the list/overview of a section into one of its songs */
export function isDescent(from: Route, to: Route): boolean {
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
 * @param from the current route
 * @param to the target route
 * @param state the current history entry's state
 */
export function historyAction(
  from: Route,
  to: Route,
  state?: { fromParent?: boolean } | null
): 'push' | 'replace' | 'back' {
  if (sameRoute(from, to)) return 'replace'

  const a = placeOf(from)
  const b = placeOf(to)
  if (!a || !b || a.section !== b.section) return 'push'

  if (a.depth === 0 && b.depth === 1) return 'push'
  if (a.depth === 1 && b.depth === 0) return state?.fromParent ? 'back' : 'replace'
  // From song to song
  return 'replace'
}
