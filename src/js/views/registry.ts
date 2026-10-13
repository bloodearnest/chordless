/**
 * The views of the app shell, by route name (see AppRouter). Each loads its
 * module only when first shown. There is one for each of ROUTE_NAMES.
 */

import type { ViewEntry } from '../app-router.ts'
import type { Route } from '../router.ts'

/** A view entry for a custom element defined by `module` */
function view(
  tag: string,
  module: () => Promise<unknown>,
  title?: (route: Route) => string
): ViewEntry {
  return {
    load: async () => {
      await module()
      return document.createElement(tag)
    },
    title,
  }
}

export const views: Record<string, ViewEntry> = {
  setlist: {
    ...view(
      'setlist-view',
      () => import('./setlist-view.ts'),
      () => 'Setlist - Chordless'
    ),
    // Moving to another setlist is a new view; moving within one is not
    sameView: (previous, next) =>
      previous.name === 'setlist' &&
      next.name === 'setlist' &&
      previous.setlistId === next.setlistId,
  },
  share: {
    ...view(
      'share-view',
      () => import('./share-view.ts'),
      () => 'Shared setlist - Chordless'
    ),
    sameView: (previous, next) =>
      previous.name === 'share' && next.name === 'share' && previous.fileId === next.fileId,
  },
  'not-found': view(
    'not-found-view',
    () => import('./not-found-view.ts'),
    () => 'Not found - Chordless'
  ),
  home: view('home-view', () => import('./home-view.ts')),
  storage: view(
    'storage-view',
    () => import('./storage-view.ts'),
    () => 'Storage - Chordless'
  ),
  preferences: view(
    'preferences-view',
    () => import('./preferences-view.ts'),
    () => 'Preferences - Chordless'
  ),
  'import-song': view(
    'import-song-view',
    () => import('./import-song-view.ts'),
    () => 'Import Songs - Chordless'
  ),
  'import-setlist': view(
    'import-setlist-view',
    () => import('./import-setlist-view.ts'),
    () => 'Import a Setlist - Chordless'
  ),
  songs: view(
    'library-view',
    () => import('./library-view.ts'),
    () => 'Song Library - Chordless'
  ),
  about: view(
    'about-view',
    () => import('./about-view.ts'),
    () => 'About - Chordless'
  ),
  bookmarklet: view(
    'bookmarklet-view',
    () => import('./bookmarklet-view.ts'),
    () => 'Bookmarklet - Chordless'
  ),
}
