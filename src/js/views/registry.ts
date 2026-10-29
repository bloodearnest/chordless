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
  home: {
    ...view('home-view', () => import('./home-view.ts')),
    // What was shared is another list, so another view
    sameView: (previous, next) => 'shared' in previous === 'shared' in next,
  },
  account: view(
    'account-view',
    () => import('./account-view.ts'),
    () => 'Account and Teams - Chordless'
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
  join: view(
    'join-view',
    () => import('./join-view.ts'),
    () => 'Join a team space - Chordless'
  ),
  media: view(
    'media-view',
    () => import('./media-view.ts'),
    () => 'Media player - Chordless'
  ),
  'new-team-space': view(
    'new-team-space-view',
    () => import('./new-team-space-view.ts'),
    () => 'New team space - Chordless'
  ),
}
