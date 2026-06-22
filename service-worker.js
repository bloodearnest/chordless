// Service Worker for offline-first operation
import * as AuthDB from '/js/auth-db.js'

// Caching strategy: network-first with ETag validation for all app files.
// Uses cache: 'no-cache' so the browser sends conditional requests (If-None-Match / 304),
// avoiding full re-downloads when files haven't changed, while still always checking for updates.
// SW cache is the offline fallback — used only when the network is unreachable.

const CACHE_NAME = 'cache-v3'
const PAD_CACHE_NAME = 'padsets-cache-v1'
const RUNTIME_CACHE_NAME = 'runtime-v1'

// Critical files to precache for offline app shell
const ASSETS = [
  '/',
  '/css/style.css',
  '/js/parser.js',
  '/js/setlist-app.js',
  '/js/db.js',
  '/js/import.js',
  '/js/transpose.js',
  '/js/theme-manager.js',
  '/js/icons.js',
  '/components/media-player.js',
  '/components/media-player-settings.js',
  '/components/icon.js',
  '/manifest.webmanifest',
]

// Install service worker and cache assets
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)))
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
    respondToClient(event, messageId, { success: false, error: error.message })
  }
})

// Helper to respond to client messages
function respondToClient(event, messageId, response) {
  if (event.ports && event.ports[0]) {
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
        await AuthDB.updateOperationStatus(operation.id, 'failed', error.message)
      }
    }

    // Clean up old completed operations
    await AuthDB.clearCompletedOperations()
  } catch (error) {
    console.error('[SW] Error processing queue:', error)
  }
}

// Process a single operation
async function processOperation(operation) {
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

  const AUTH_PROXY_URL = self.location.hostname === 'localhost' ? 'http://localhost:8787' : ''

  if (operation.type === 'invite') {
    // Call /session/invite
    const response = await fetch(`${AUTH_PROXY_URL}/session/invite`, {
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
    const response = await fetch(`${AUTH_PROXY_URL}/session/revoke`, {
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

  throw new Error('Unknown operation type: ' + operation.type)
}

// Request ID token from an active client
async function requestIdTokenFromClient() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

  if (clients.length === 0) {
    return null
  }

  // Ask the first client for an ID token
  return new Promise(resolve => {
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

  // Always pass through auth-proxy requests (different port)
  if (url.port === '8787' || url.hostname.includes('workers.dev')) {
    return
  }

  // Only handle same-origin requests
  if (url.origin !== location.origin) {
    return
  }

  // API requests - pass through to network
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request))
    return
  }

  // Always pass through sets directory/files to get real filesystem contents
  if (url.pathname === '/sets' || url.pathname === '/sets/' || url.pathname.startsWith('/sets/')) {
    console.log('[SW] Passing through sets request:', url.pathname)
    event.respondWith(fetch(event.request))
    return
  }

  // JS/CSS: network-first with ETag validation, SW cache as offline fallback
  if (url.pathname.match(/\.(css|js)$/)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(response => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
          }
          return response
        })
        .catch(() => caches.match(event.request))
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
    event.respondWith(handleRoute(url))
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
              caches.open(CACHE_NAME).then(cache => {
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

// Network-first HTML fetch: validates via ETag (304 if unchanged), SW cache as offline fallback.
async function serveHtmlNetworkFirst(htmlPath) {
  try {
    const response = await fetch(htmlPath, { cache: 'no-cache' })
    if (response.ok) {
      const clone = response.clone()
      caches.open(CACHE_NAME).then(cache => cache.put(htmlPath, clone))
    }
    return response
  } catch {
    return (await caches.match(htmlPath)) ?? new Response('Offline', { status: 503 })
  }
}

async function handleRoute(url) {
  const path = url.pathname

  // Test files - pass through to network
  if (path.includes('-test.html') || path.includes('test-')) {
    return fetch(url)
  }

  if (path === '/' || path === '/index.html') return serveHtmlNetworkFirst('/index.html')
  if (path.startsWith('/setlist/')) return serveHtmlNetworkFirst('/setlist.html')
  if (path.startsWith('/songs')) return serveHtmlNetworkFirst('/songs.html')
  if (path.startsWith('/preferences')) return serveHtmlNetworkFirst('/preferences.html')
  if (path.startsWith('/storage')) return serveHtmlNetworkFirst('/storage.html')
  if (path.startsWith('/share/')) return serveHtmlNetworkFirst('/share.html')
  if (path.startsWith('/import-song')) return serveHtmlNetworkFirst('/import-song.html')
  if (path.startsWith('/bookmarklet')) return serveHtmlNetworkFirst('/bookmarklet-install.html')
  if (path.startsWith('/authorize')) return serveHtmlNetworkFirst('/authorize.html')
  if (path.startsWith('/components-test')) return serveHtmlNetworkFirst('/components-test.html')

  console.log('[SW] 404 - not found:', path)
  return new Response('Not Found', { status: 404 })
}
