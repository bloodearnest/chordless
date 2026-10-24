/* v8 ignore start -- start-up wiring of the whole app: the Playwright tests run it, a unit test cannot load it */
/**
 * The app shell: starts the router, which shows the view for the URL in
 * #view-outlet. The menu and the media player stay while views come and go.
 */
import '../components/nav-menu.ts'
import { AppRouter, RouteChangeEvent } from './app-router.ts'
import { appUpdate } from './app-update.ts'
import { checkFirstTimeAuth } from './first-time-auth.ts'
import { maybeShowFirstUseSetup } from './first-use.ts'
import { startFullscreen } from './fullscreen.ts'
import './install.ts'
import { listenForLaunches } from './launch.ts'
import { startMediaPlayer } from './media-player-loader.ts'
import { setRouter } from './navigation.ts'
import { SpaceChangeEvent } from './space.ts'
import { views } from './views/registry.ts'

// Answer the service worker's requests for a Google ID token
import('./google-auth.ts').then(({ listenForIdTokenRequests }) => listenForIdTokenRequests())

// The first sign-in renames the space: before anything shows its name. The sign-in
// lives behind the service worker, so a page it does not control yet (the first visit) has none
// to find: don't make the first view wait for that.
if (navigator.serviceWorker?.controller) await checkFirstTimeAuth()

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

await router.start()

// The one-time question of how they read a song, on whatever page they arrive at
void maybeShowFirstUseSetup()
// Optional, and not needed to show the first view, so once the page is idle (a slow device is
// busy with the view and the service worker's first install: Safari has no requestIdleCallback)
if ('requestIdleCallback' in window)
  requestIdleCallback(() => startMediaPlayer(), { timeout: 3000 })
else setTimeout(startMediaPlayer, 1000)
// Fullscreen while live
startFullscreen()
// Setlists shared by link are kept only until they end (their songs stay)
import('./share-receiver.ts').then(({ tidySharedWithMe }) => tidySharedWithMe())
// Whether the user can write to the space's Drive folder (a sync asks too)
import('./space-access.ts').then(({ refreshSpaceAccess }) => {
  void refreshSpaceAccess()
  // ...and again for the space switched to
  window.addEventListener(SpaceChangeEvent.type, () => void refreshSpaceAccess())
})
void appUpdate.start()
// Sync the space in use by itself while the app is open (sync-lock.ts keeps it to one at a time)
import('./auto-sync.ts').then(({ startAutoSync }) => startAutoSync())
// ...and the pages hear of what other tabs of the app write
import('./data-changes.ts').then(({ listenForOtherTabs }) => listenForOtherTabs())
// Files the system opens with the installed app, and links for its open window
listenForLaunches()
/* v8 ignore stop */
