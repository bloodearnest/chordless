/* v8 ignore start -- start-up wiring of the whole app: the Playwright tests run it, a unit test cannot load it */
/**
 * The app shell: starts the router, which shows the view for the URL in
 * #view-outlet. The menu and the media player stay while views come and go.
 */
import '../components/nav-menu.ts'
import { AppRouter, RouteChangeEvent } from './app-router.ts'
import { appUpdate } from './app-update.ts'
import { maybeShowFirstUseSetup } from './first-use.ts'
import './install.ts'
import { maybeAskName } from './account-name.ts'
import { listenForLaunches } from './launch.ts'
import { startMediaPlayer } from './media-player-loader.ts'
import { setRouter } from './navigation.ts'
import { ensurePersonalSpace, SpaceChangeEvent } from './space.ts'
import { views } from './views/registry.ts'

const outlet = document.getElementById('view-outlet')
if (!outlet) throw new Error('The page has no #view-outlet')

const router = new AppRouter({
  outlet,
  announcer: document.getElementById('route-announcer'),
  views,
})
setRouter(router)
document.addEventListener(RouteChangeEvent.type, event => {
  document.body.dataset.view = event.route.name
})

// A branch preview starts with the songs of an export, if the dev server has one (docs/PREVIEWS.md); a
// build has none of this: Vite replaces DEV with false and drops the branch
if (import.meta.env?.DEV) {
  await import('./preview-seed.ts')
    .then(({ seedFromPreview }) => seedFromPreview())
    .catch(error => console.warn('[Preview] Could not seed from the export:', error))
}

await router.start()

// The one-time question of how they read a song, on whatever page they arrive at
void maybeShowFirstUseSetup()
// Someone signed in with no name is asked for one (once a visit): a Google sign-in need not say one, an emailed code never does
void maybeAskName()
// Someone who joined a Team and nothing else is given a Personal space now (not on the page of their first invite)
void ensurePersonalSpace().catch(error =>
  console.warn('[Space] Could not make a Personal space:', error)
)
// Optional, and not needed to show the first view, so once the page is idle (a slow device is
// busy with the view and the service worker's first install: Safari has no requestIdleCallback)
if ('requestIdleCallback' in window)
  requestIdleCallback(() => startMediaPlayer(), { timeout: 3000 })
else setTimeout(startMediaPlayer, 1000)
// What the device kept from the last launch (shown on About; sent when reports are on): marks this one
import('./storage-survival.ts').then(({ launchReport }) => launchReport()).catch(() => undefined)
// Anonymous usage reports, if they are on (docs/OBSERVABILITY.md): the SDK loads now the page is idle
import('./telemetry/start.ts').then(({ initTelemetry }) => initTelemetry())
// Setlists shared by link are kept only until they end (their songs stay)
import('./share-receiver.ts').then(({ tidySharedWithMe }) => tidySharedWithMe())
// Whether the user can write to the space's Drive folder (a sync asks too)
import('./space-access.ts').then(({ refreshSpaceAccess }) => {
  void refreshSpaceAccess()
  // ...and again for the space switched to
  window.addEventListener(SpaceChangeEvent.type, () => void refreshSpaceAccess())
})
// The teams the person is in that this device has not set up (a second device, a new browser)
import('./team-memberships.ts').then(({ watchTeamMemberships }) => watchTeamMemberships())
void appUpdate.start()
// The heavy files the worker did not install (the PDF reader, Verovio): fetched once the page is idle, for offline
import('./precache-deferred.ts').then(({ startDeferredPrecache }) =>
  startDeferredPrecache(navigator.serviceWorker)
)
// Sync the space in use by itself while the app is open (sync-lock.ts keeps it to one at a time)
import('./auto-sync.ts').then(({ startAutoSync }) => startAutoSync())
// While live on a team space, its devices tell each other of changes, to sync at once (live-sync.ts)
import('./live-sync.ts').then(({ startLiveSync }) => startLiveSync())
// ...and the pages hear of what other tabs of the app write
import('./data-changes.ts').then(({ listenForOtherTabs }) => listenForOtherTabs())
// Files the system opens with the installed app, and links for its open window
listenForLaunches()
/* v8 ignore stop */
