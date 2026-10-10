/**
 * The app shell: starts the router, which shows the view for the URL in
 * #view-outlet. The menu, and what lives with it (the media player, to come),
 * stay while views come and go.
 */
import '../components/nav-menu.js'
import { AppRouter } from './app-router.js'
import { checkFirstTimeAuth } from './first-time-auth.js'
import { setRouter } from './navigation.js'
import { views } from './views/registry.js'

// Answer the service worker's requests for a Google ID token
import('./google-auth.js').then(({ listenForIdTokenRequests }) => listenForIdTokenRequests())

// The first sign-in renames the organisation: before anything shows its name
await checkFirstTimeAuth()

const router = new AppRouter({
  outlet: document.getElementById('view-outlet'),
  announcer: document.getElementById('route-announcer'),
  views,
})
setRouter(router)
await router.start()
