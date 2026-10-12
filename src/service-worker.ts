// Service Worker for offline-first operation
// Built as a classic script by vite-plugins/service-worker.js, which defines the two
// constants below: the files to precache, and a version (a hash of them)
import * as AuthDB from './js/auth-db.ts'
import { errorMessage } from './js/utils/errors.ts'

declare const self: ServiceWorkerGlobalScope

// Handles routing and offline caching

const PRECACHE = __PRECACHE__
const PRECACHED = new Set(PRECACHE)
const CACHE_NAME = `cache-${__CACHE_VERSION__}`
const PAD_CACHE_NAME = 'padsets-cache-v1'
const RUNTIME_CACHE_NAME = 'runtime-v1'

// Install service worker and cache assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // Bypass the HTTP cache: a file with no hash in its name must be this version's
      .then(cache => cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' }))))
  )
  self.skipWaiting()
})

// Activate and clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (
            cacheName !== CACHE_NAME &&
            cacheName !== PAD_CACHE_NAME &&
            cacheName !== RUNTIME_CACHE_NAME
          ) {
            return caches.delete(cacheName)
          }
          return undefined
        })
      )
    })
  )
  self.clients.claim()
})

// Handle messages from clients
self.addEventListener('message', async event => {
  const { type, data, messageId } = event.data || {}

  console.log('[SW] Received message:', type)

  try {
    switch (type) {
      case 'SKIP_WAITING':
        console.log('[SW] Received SKIP_WAITING message')
        self.skipWaiting()
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

      case 'QUEUE_INVITE': {
        // Queue an invite operation
        const inviteId = await AuthDB.queueOperation({
          type: 'invite',
          file_id: data.file_id,
          email: data.email,
        })
        respondToClient(event, messageId, { success: true, operationId: inviteId })
        // Trigger processing
        processOperationQueue()
        break
      }

      case 'QUEUE_REVOKE': {
        // Queue a revoke operation
        const revokeId = await AuthDB.queueOperation({
          type: 'revoke',
          file_id: data.file_id,
          permission_id: data.permission_id,
        })
        respondToClient(event, messageId, { success: true, operationId: revokeId })
        // Trigger processing
        processOperationQueue()
        break
      }

      case 'GET_PENDING_OPERATIONS': {
        // Get all pending operations
        const pending = await AuthDB.getPendingOperations()
        respondToClient(event, messageId, { success: true, operations: pending })
        break
      }

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

      case 'PROCESS_QUEUE':
        // Manually trigger queue processing
        processOperationQueue()
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
  event: ExtendableMessageEvent,
  messageId: string,
  response: Record<string, unknown>
) {
  if (event.ports?.[0]) {
    event.ports[0].postMessage({ messageId, ...response })
  }
}

// ==============================================================================
// FUTURE FEATURE: Drive API Operation Queue
// ==============================================================================
// The functions below handle queued Drive API operations (invite/revoke permissions).
// Operations are queued when offline and processed when the user is online and authenticated.
// Currently not used - infrastructure for future collaboration features.
// ==============================================================================

// Process operation queue
async function processOperationQueue() {
  console.log('[SW] Processing operation queue')

  try {
    const pending = await AuthDB.getPendingOperations()
    console.log('[SW] Found', pending.length, 'pending operations')

    for (const operation of pending) {
      // Skip if retried too many times
      if (operation.retry_count >= 3) {
        console.warn('[SW] Operation', operation.id, 'exceeded retry limit')
        await AuthDB.updateOperationStatus(operation.id, 'failed', 'Exceeded retry limit')
        continue
      }

      try {
        await processOperation(operation)
        await AuthDB.updateOperationStatus(operation.id, 'completed')
        console.log('[SW] Operation', operation.id, 'completed')
      } catch (error) {
        console.error('[SW] Operation', operation.id, 'failed:', error)
        await AuthDB.updateOperationStatus(operation.id, 'failed', errorMessage(error))
      }
    }

    // Clean up old completed operations
    await AuthDB.clearCompletedOperations()
  } catch (error) {
    console.error('[SW] Error processing queue:', error)
  }
}

// Process a single operation
async function processOperation(operation: AuthDB.QueuedOperation) {
  // Get blob
  const blobData = await AuthDB.getBlob()
  if (!blobData) {
    throw new Error('No auth blob found - user needs to re-authenticate')
  }

  // Get current ID token from a client
  const idToken = await requestIdTokenFromClient()
  if (!idToken) {
    throw new Error('No ID token available - user needs to refresh session')
  }

  if (operation.type === 'invite') {
    // Call /session/invite
    const response = await fetch(`/session/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blob: blobData.blob,
        id_token: idToken,
        file_id: operation.file_id,
        email: operation.email,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Invite failed')
    }

    return await response.json()
  } else if (operation.type === 'revoke') {
    // Call /session/revoke
    const response = await fetch(`/session/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blob: blobData.blob,
        id_token: idToken,
        file_id: operation.file_id,
        permission_id: operation.permission_id,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Revoke failed')
    }

    return await response.json()
  }

  throw new Error(`Unknown operation type: ${(operation as { type: string }).type}`)
}

// Request ID token from an active client
async function requestIdTokenFromClient(): Promise<string | null> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

  if (clients.length === 0) {
    return null
  }

  // Ask the first client for an ID token
  return new Promise<string | null>(resolve => {
    const messageChannel = new MessageChannel()
    const timeout = setTimeout(() => resolve(null), 5000)

    messageChannel.port1.onmessage = event => {
      clearTimeout(timeout)
      resolve(event.data.idToken || null)
    }

    clients[0].postMessage({ type: 'REQUEST_ID_TOKEN' }, [messageChannel.port2])
  })
}

// Process queue periodically when online
self.addEventListener('online', () => {
  console.log('[SW] Back online, processing queue')
  processOperationQueue()
})

// Fetch event handler - routes requests
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)

  console.log('[SW] Fetch:', event.request.method, url.pathname)

  // Always pass through Google OAuth/GSI requests
  if (url.origin === 'https://accounts.google.com') {
    return
  }

  // Only handle same-origin requests
  if (url.origin !== location.origin) {
    return
  }

  // Dev-only component playgrounds (src/dev/) - leave entirely to the browser.
  // Not part of the app: never cached, and not served in production.
  if (url.pathname === '/dev' || url.pathname.startsWith('/dev/')) {
    return
  }

  // API and auth requests (the worker's) - pass through to network
  if (['/api/', '/oauth/', '/session/'].some(prefix => url.pathname.startsWith(prefix))) {
    event.respondWith(fetch(event.request))
    return
  }

  // Built files, precached when this version installed: named by hash (or versioned with
  // the cache), so the cached copy is the right one. Everything else of the app's is below.
  if (PRECACHED.has(url.pathname) && url.pathname !== '/') {
    event.respondWith(
      caches
        .open(CACHE_NAME)
        .then(cache => cache.match(url.pathname))
        .then(cached => cached ?? fetch(event.request))
    )
    return
  }

  // JS/TS/CSS (modules, in dev; the build hashes them and precaches them): network-first, bypassing HTTP cache, fallback to SW cache for offline
  if (url.pathname.match(/\.(css|js|ts)$/)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
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
    console.log('[SW] Direct HTML file request, passing through:', url.pathname)
    event.respondWith(fetch(event.request))
    return
  }

  // HTML navigation requests - route-based page generation
  const acceptHeader = event.request.headers.get('Accept') || ''
  if (event.request.mode === 'navigate' || acceptHeader.includes('text/html')) {
    console.log('[SW] Handling navigation to:', url.pathname)
    event.respondWith(handleRoute())
    return
  }

  // Pad audio files - cache on demand for offline use
  if (url.pathname.startsWith('/pads/') && url.pathname.endsWith('.mp3')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) {
          console.log('[SW] Serving cached pad:', url.pathname)
          return cached
        }

        // Not cached, fetch and cache it
        console.log('[SW] Fetching and caching pad:', url.pathname)
        return fetch(event.request)
          .then(response => {
            // Only cache full responses (200), not partial responses (206)
            if (response.ok && response.status === 200) {
              const responseToCache = response.clone()
              caches.open(RUNTIME_CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache)
                console.log('[SW] Cached pad for offline use:', url.pathname)
              })
            }
            return response
          })
          .catch(error => {
            console.error('[SW] Failed to fetch pad:', url.pathname, error)
            throw error
          })
      })
    )
    return
  }

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
      fetch(event.request)
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
      fetch(event.request).catch(() =>
        caches.match(event.request).then(cached => cached || new Response('', { status: 404 }))
      )
    )
    return
  }

  event.respondWith(fetch(event.request))
})

async function handleRoute() {
  // Every URL is served by the app shell, index.html, which shows the view for it
  // (and a not-found view for a URL that is no page). Always fetch the clean URL:
  // wrangler strips .html, so /index.html redirects to /, and browser navigations
  // have redirect: 'manual', so a redirected SW response causes an error.
  const htmlFile = '/'

  try {
    const response = await fetch(htmlFile)
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
