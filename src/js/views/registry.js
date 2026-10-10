/**
 * The views of the app shell, by route name (see AppRouter). Each loads its
 * module only when first shown. There is one for each of ROUTE_NAMES.
 */

/** A view entry for a custom element defined by `module` */
function view(tag, module, title) {
  return {
    load: async () => {
      await module()
      return document.createElement(tag)
    },
    title,
  }
}

export const views = {
  setlist: {
    ...view(
      'setlist-view',
      () => import('./setlist-view.js'),
      () => 'Setlist - Chordless'
    ),
    // Moving to another setlist is a new view; moving within one is not
    sameView: (previous, next) => previous.setlistId === next.setlistId,
  },
  'not-found': view(
    'not-found-view',
    () => import('./not-found-view.js'),
    () => 'Not found - Chordless'
  ),
  home: view('home-view', () => import('./home-view.js')),
  storage: view(
    'storage-view',
    () => import('./storage-view.js'),
    () => 'Storage - Chordless'
  ),
  preferences: view(
    'preferences-view',
    () => import('./preferences-view.js'),
    () => 'Preferences - Chordless'
  ),
  'import-song': view(
    'import-song-view',
    () => import('./import-song-view.js'),
    () => 'Import Songs - Chordless'
  ),
  songs: view(
    'library-view',
    () => import('./library-view.js'),
    () => 'Song Library - Chordless'
  ),
  bookmarklet: view(
    'bookmarklet-view',
    () => import('./bookmarklet-view.js'),
    () => 'Bookmarklet - Chordless'
  ),
}
