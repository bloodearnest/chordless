/**
 * The service worker's behaviour: precaching, routing and the auth blob messages. The entry
 * (src/service-worker.ts) gives it the worker's globals, so a test can give it fakes. It declares
 * the little it needs of them itself: the DOM and WebWorker type libraries do not mix.
 */
import * as AuthDB from './auth-db.ts'
import { SHARED_CACHE_NAME, storeShared } from './shared-incoming.ts'
import { errorMessage } from './utils/errors.ts'

interface WaitEvent {
  waitUntil(promise: Promise<unknown>): void
}

/** What a page sends with a message (which of these depends on its type) */
interface MessagePayload {
  blob: string
  metadata?: AuthDB.AuthMetadata
  backup: Partial<AuthDB.BlobBackup>
}

interface WorkerMessage {
  data?: { type?: string; data?: MessagePayload; messageId?: string } | null
  ports?: readonly MessagePort[]
}

interface WorkerFetch {
  request: Request
  respondWith(response: Response | Promise<Response>): void
}

/** What the worker needs of its global scope (the ServiceWorkerGlobalScope) */
export interface WorkerScope {
  registration: { active: unknown }
  location: { origin: string }
  clients: {
    claim(): Promise<void>
  }
  skipWaiting(): Promise<void>
  addEventListener(type: 'install' | 'activate', listener: (event: WaitEvent) => void): void
  addEventListener(type: 'message', listener: (event: WorkerMessage) => void): void
  addEventListener(type: 'fetch', listener: (event: WorkerFetch) => void): void
}

/** What the build gives the worker: the files to precache, and the version they make */
export interface WorkerConfig {
  precache: string[]
  cacheVersion: string
  releasedAt: string
}

export function startServiceWorker(
  scope: WorkerScope,
  caches: CacheStorage,
  doFetch: typeof fetch,
  config: WorkerConfig
) {
  const PRECACHE = config.precache
  const PRECACHED = new Set(PRECACHE)
  const CACHE_NAME = `cache-${config.cacheVersion}`
  const PAD_CACHE_NAME = 'padsets-cache-v1'
  const RUNTIME_CACHE_NAME = 'runtime-v1'

  // Install service worker and cache assets
  scope.addEventListener('install', event => {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        // Bypass the HTTP cache: a file with no hash in its name must be this version's
        .then(cache => cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' }))))
    )
    // A first install takes over at once. An update waits, with its own copy of the files, until
    // the page asks for it (a SKIP_WAITING message: see app-update.ts) or the app is closed and
    // opened again, so a page that is open and playing is never changed under the user.
    if (!scope.registration.active) scope.skipWaiting()
  })

  // Activate and clean up old caches
  scope.addEventListener('activate', event => {
    event.waitUntil(
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (
              cacheName !== CACHE_NAME &&
              cacheName !== PAD_CACHE_NAME &&
              cacheName !== RUNTIME_CACHE_NAME &&
              cacheName !== SHARED_CACHE_NAME
            ) {
              return caches.delete(cacheName)
            }
            return undefined
          })
        )
      })
    )
    scope.clients.claim()
  })

  // Handle messages from clients
  scope.addEventListener('message', async event => {
    const { type, messageId } = event.data || {}
    // (a message that needs its data and has none fails below, and is answered as an error)
    const data = event.data?.data as MessagePayload

    try {
      switch (type) {
        case 'GET_VERSION':
          // Which version of the app this worker (and the files it serves) is
          respondToClient(event, messageId, {
            success: true,
            version: config.cacheVersion,
            released: config.releasedAt,
          })
          break

        case 'SKIP_WAITING':
          scope.skipWaiting()
          break

        case 'STORE_BLOB':
          // Store encrypted token blob
          await AuthDB.storeBlob(data.blob, data.metadata)
          respondToClient(event, messageId, { success: true })
          break

        case 'GET_BLOB': {
          // Retrieve blob
          const blobData = await AuthDB.getBlob()
          respondToClient(event, messageId, { success: true, data: blobData })
          break
        }

        case 'DELETE_BLOB':
          // Delete blob (logout)
          await AuthDB.deleteBlob()
          respondToClient(event, messageId, { success: true })
          break

        case 'EXPORT_BLOB': {
          // Export blob as backup
          const backup = await AuthDB.exportBlobBackup()
          respondToClient(event, messageId, { success: true, backup })
          break
        }

        case 'IMPORT_BLOB':
          // Import blob from backup
          await AuthDB.importBlobBackup(data.backup)
          respondToClient(event, messageId, { success: true })
          break

        default:
          console.warn('[SW] Unknown message type:', type)
      }
    } catch (error) {
      console.error('[SW] Error handling message:', error)
      respondToClient(event, messageId, { success: false, error: errorMessage(error) })
    }
  })

  // Helper to respond to client messages
  function respondToClient(
    event: WorkerMessage,
    messageId: string | undefined,
    response: Record<string, unknown>
  ) {
    if (event.ports?.[0]) {
      event.ports[0].postMessage({ messageId, ...response })
    }
  }

  // Fetch event handler - routes requests
  scope.addEventListener('fetch', event => {
    const url = new URL(event.request.url)

    // Always pass through Google OAuth/GSI requests
    if (url.origin === 'https://accounts.google.com') {
      return
    }

    // Only handle same-origin requests
    if (url.origin !== scope.location.origin) {
      return
    }

    // Dev-only component playgrounds (src/dev/) - leave entirely to the browser.
    // Not part of the app: never cached, and not served in production.
    if (url.pathname === '/dev' || url.pathname.startsWith('/dev/')) {
      return
    }

    // Something shared to the app from another app (the manifest's share_target): keep it for the
    // import page, which takes it from the cache, and go there
    if (url.pathname === '/share-target') {
      event.respondWith(
        (async () => {
          if (event.request.method === 'POST') {
            try {
              await storeShared(await event.request.formData(), caches)
            } catch (error) {
              console.error('[SW] Could not keep what was shared:', error)
            }
          }
          return Response.redirect(new URL('/import-song', scope.location.origin).href, 303)
        })()
      )
      return
    }

    // API and auth requests (the worker's) - pass through to network
    if (['/api/', '/oauth/', '/session/'].some(prefix => url.pathname.startsWith(prefix))) {
      event.respondWith(doFetch(event.request))
      return
    }

    // Built files, precached when this version installed: named by hash (or versioned with
    // the cache), so the cached copy is the right one. Everything else of the app's is below.
    if (PRECACHED.has(url.pathname) && url.pathname !== '/') {
      event.respondWith(
        caches
          .open(CACHE_NAME)
          .then(cache => cache.match(url.pathname))
          .then(cached => cached ?? doFetch(event.request))
      )
      return
    }

    // JS/TS/CSS (modules, in dev; the build hashes them and precaches them): network-first, bypassing HTTP cache, fallback to SW cache for offline
    if (url.pathname.match(/\.(css|js|ts)$/)) {
      event.respondWith(
        doFetch(event.request, { cache: 'no-store' })
          .then(response => {
            if (response.ok) {
              const clone = response.clone()
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
            }
            return response
          })
          // (with nothing cached, respondWith(undefined) was a network error: so is this)
          .catch(async () => (await caches.match(event.request)) ?? Response.error())
      )
      return
    }

    // Direct HTML file requests - pass through to network
    if (url.pathname.endsWith('.html')) {
      event.respondWith(doFetch(event.request))
      return
    }

    // HTML navigation requests - route-based page generation
    const acceptHeader = event.request.headers.get('Accept') || ''
    if (event.request.mode === 'navigate' || acceptHeader.includes('text/html')) {
      event.respondWith(handleRoute())
      return
    }

    // The pads of a pad set the user uploaded: only what the app kept
    if (url.pathname.startsWith('/pad-sets/')) {
      event.respondWith(
        caches.open(PAD_CACHE_NAME).then(async cache => {
          const cached = await cache.match(event.request)
          if (cached) {
            return cached
          }
          return new Response('Pad set asset not available offline', { status: 404 })
        })
      )
      return
    }

    // Static assets (icons, images, fonts) - network first, cache as fallback only
    // Store without query string so cache-busted URLs (e.g. ?t=...) can find the entry
    if (url.pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$/)) {
      event.respondWith(
        doFetch(event.request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone()
              caches.open(RUNTIME_CACHE_NAME).then(cache => {
                cache.put(new Request(url.origin + url.pathname), clone)
              })
            }
            return response
          })
          .catch(() =>
            caches
              .open(RUNTIME_CACHE_NAME)
              .then(cache => cache.match(event.request, { ignoreSearch: true }))
              .then(cached => cached || new Response('', { status: 404 }))
          )
      )
      return
    }

    // Manifest - network first, fall back to install cache
    if (url.pathname.endsWith('manifest.webmanifest')) {
      event.respondWith(
        doFetch(event.request).catch(() =>
          caches.match(event.request).then(cached => cached || new Response('', { status: 404 }))
        )
      )
      return
    }

    event.respondWith(doFetch(event.request))
  })

  async function handleRoute() {
    // Every URL is served by the app shell, index.html, which shows the view for it
    // (and a not-found view for a URL that is no page). Always fetch the clean URL:
    // wrangler strips .html, so /index.html redirects to /, and browser navigations
    // have redirect: 'manual', so a redirected SW response causes an error.
    const htmlFile = '/'

    // With a precache the cached shell is the one that goes with the cached files, so it is
    // served at once: waiting for the network first made a slow or hung connection (a venue's
    // wifi) hold up an app that was already on the device. A new version arrives as a new worker.
    if (PRECACHE.length > 0) {
      const cached = await (await caches.open(CACHE_NAME)).match(htmlFile)
      if (cached) return cached
    }

    try {
      const response = await doFetch(htmlFile)
      if (response.ok) {
        // Clone now: once the page is returned its body is being read, and can't be cloned
        // With a precache the cached shell stays the one that goes with the cached files: a
        // newer shell would name files this version has not got, which fails offline.
        if (PRECACHE.length === 0) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(htmlFile, copy))
        }
      }
      return response
    } catch {
      const cache = await caches.open(CACHE_NAME)
      return (await cache.match(htmlFile)) ?? new Response('Offline', { status: 503 })
    }
  }
}
