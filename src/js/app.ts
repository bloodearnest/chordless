/**
 * The app shell: starts the router, which shows the view for the URL in
 * #view-outlet. The menu and the media player stay while views come and go.
 */
import '../components/nav-menu.ts'
import { AppRouter, RouteChangeEvent } from './app-router.ts'
import { checkFirstTimeAuth } from './first-time-auth.ts'
import { startMediaPlayer } from './media-player-loader.ts'
import { setRouter } from './navigation.ts'
import { views } from './views/registry.ts'

// Answer the service worker's requests for a Google ID token
import('./google-auth.ts').then(({ listenForIdTokenRequests }) => listenForIdTokenRequests())

// The first sign-in renames the organisation: before anything shows its name. The sign-in
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

// Optional, and not needed to show the first view, so after it
startMediaPlayer()
