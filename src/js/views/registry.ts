/**
 * The views of the app shell, by route name (see AppRouter). Each loads its
 * module only when first shown. There is one for each of ROUTE_NAMES.
 */

import type { ViewEntry } from '../app-router.ts'
import type { Route } from '../router.ts'
import { t } from '../text.ts'

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
      () => t('title-setlist')
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
      () => t('title-shared')
    ),
    sameView: (previous, next) =>
      previous.name === 'share' && next.name === 'share' && previous.fileId === next.fileId,
  },
  'not-found': view(
    'not-found-view',
    () => import('./not-found-view.ts'),
    () => t('title-not-found')
  ),
  home: {
    ...view('home-view', () => import('./home-view.ts')),
    // What was shared is another list, so another view
    sameView: (previous, next) => 'shared' in previous === 'shared' in next,
  },
  account: view(
    'account-view',
    () => import('./account-view.ts'),
    () => t('title-account')
  ),
  churches: view(
    'churches-view',
    () => import('./churches-view.ts'),
    () => t('title-churches')
  ),
  preferences: view(
    'preferences-view',
    () => import('./preferences-view.ts'),
    () => t('title-preferences')
  ),
  'import-song': view(
    'import-song-view',
    () => import('./import-song-view.ts'),
    () => t('title-import-songs')
  ),
  space: view(
    'space-view',
    () => import('./space-view.ts'),
    () => t('title-space')
  ),
  'sign-in': view(
    'sign-in-view',
    () => import('./sign-in-view.ts'),
    () => t('title-sign-in')
  ),
  'import-setlist': view(
    'import-setlist-view',
    () => import('./import-setlist-view.ts'),
    () => t('title-import-setlist')
  ),
  songs: view(
    'library-view',
    () => import('./library-view.ts'),
    () => t('title-library')
  ),
  about: view(
    'about-view',
    () => import('./about-view.ts'),
    () => t('title-about')
  ),
  contact: view(
    'contact-view',
    () => import('./contact-view.ts'),
    () => t('title-contact')
  ),
  'speed-test': view(
    'speed-test-view',
    () => import('./speed-test-view.ts'),
    () => t('title-speed-test')
  ),
  join: view(
    'join-view',
    () => import('./join-view.ts'),
    () => t('title-join')
  ),
  media: view(
    'media-view',
    () => import('./media-view.ts'),
    () => t('title-media')
  ),
}
