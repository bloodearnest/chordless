/**
 * The views of the app shell, by route name (see AppRouter). Each loads its
 * module only when first shown. There is one for each of SHELL_ROUTES.
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
  bookmarklet: view(
    'bookmarklet-view',
    () => import('./bookmarklet-view.js'),
    () => 'Bookmarklet - Chordless'
  ),
}
