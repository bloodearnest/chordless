// Service Worker for Setalight
// Handles routing and generates pages for offline-first operation

// Auto-detect development mode based on hostname
const DEV_MODE = self.location.hostname === 'localhost'
    || self.location.hostname === '127.0.0.1'
    || self.location.hostname.startsWith('192.168.')
    || self.location.hostname.startsWith('10.')
    || self.location.hostname.endsWith('.local');

const CACHE_NAME = 'setalight-v250';
const PAD_CACHE_NAME = 'padsets-cache-v1';
const ASSETS = [
    '/',
    '/css/style.css',
    '/js/parser.js',
    '/js/setlist-app.js',
    '/js/db.js',
    '/js/import.js',
    '/js/transpose.js',
    '/js/theme-manager.js',
    '/components/media-player.js',
    '/components/media-player-settings.js'
];

// External CDN resources to cache for offline support
const CDN_ASSETS = [
    'https://cdn.jsdelivr.net/npm/lit@3.1.0/index.js',
    'https://cdn.jsdelivr.net/npm/lit@3.1.0/directives/class-map.js',
    'https://cdn.jsdelivr.net/npm/lit@3.1.0/directives/style-map.js',
    'https://cdn.jsdelivr.net/npm/@lit/reactive-element@2.0.4/reactive-element.js',
    'https://cdn.jsdelivr.net/npm/@lit/reactive-element@2.0.4/decorators/custom-element.js',
    'https://cdn.jsdelivr.net/npm/@lit/reactive-element@2.0.4/decorators/property.js',
    'https://cdn.jsdelivr.net/npm/@lit/reactive-element@2.0.4/decorators/state.js',
    'https://cdn.jsdelivr.net/npm/@lit/reactive-element@2.0.4/decorators/event-options.js',
    'https://cdn.jsdelivr.net/npm/@lit/reactive-element@2.0.4/decorators/query.js',
    'https://cdn.jsdelivr.net/npm/@lit/reactive-element@2.0.4/decorators/query-all.js',
    'https://cdn.jsdelivr.net/npm/@lit/reactive-element@2.0.4/decorators/query-async.js',
    'https://cdn.jsdelivr.net/npm/@lit/reactive-element@2.0.4/decorators/query-assigned-elements.js',
    'https://cdn.jsdelivr.net/npm/@lit/reactive-element@2.0.4/decorators/query-assigned-nodes.js',
    'https://cdn.jsdelivr.net/npm/lit-element@4.0.4/lit-element.js',
    'https://cdn.jsdelivr.net/npm/lit-html@3.1.0/lit-html.js',
    'https://cdn.jsdelivr.net/npm/lit-html@3.1.0/is-server.js',
    'https://cdn.jsdelivr.net/npm/lit-html@3.1.0/directive.js',
    'https://cdn.jsdelivr.net/npm/lit-html@3.1.0/directive-helpers.js',
    'https://cdn.jsdelivr.net/npm/lit-html@3.1.0/async-directive.js'
];

// Install service worker and cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Cache local assets
            const localCache = cache.addAll(ASSETS);

            // Cache CDN assets (non-blocking, fail silently)
            const cdnCache = Promise.allSettled(
                CDN_ASSETS.map(url =>
                    fetch(url, { mode: 'cors' })
                        .then(response => {
                            if (response.ok) {
                                return cache.put(url, response);
                            }
                        })
                        .catch(err => console.log('[SW] Failed to cache CDN asset:', url, err))
                )
            );

            return Promise.all([localCache, cdnCache]);
        })
    );
    self.skipWaiting();
});

// Activate and clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName !== PAD_CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Import auth-db module
import * as AuthDB from '/js/auth-db.js';

// Handle messages from clients
self.addEventListener('message', async (event) => {
    const { type, data, messageId } = event.data || {};

    console.log('[SW] Received message:', type);

    try {
        switch (type) {
            case 'SKIP_WAITING':
                console.log('[SW] Received SKIP_WAITING message');
                self.skipWaiting();
                break;

            case 'STORE_BLOB':
                // Store encrypted token blob
                await AuthDB.storeBlob(data.blob, data.metadata);
                respondToClient(event, messageId, { success: true });
                break;

            case 'GET_BLOB':
                // Retrieve blob
                const blobData = await AuthDB.getBlob();
                respondToClient(event, messageId, { success: true, data: blobData });
                break;

            case 'DELETE_BLOB':
                // Delete blob (logout)
                await AuthDB.deleteBlob();
                respondToClient(event, messageId, { success: true });
                break;

            case 'QUEUE_INVITE':
                // Queue an invite operation
                const inviteId = await AuthDB.queueOperation({
                    type: 'invite',
                    file_id: data.file_id,
                    email: data.email
                });
                respondToClient(event, messageId, { success: true, operationId: inviteId });
                // Trigger processing
                processOperationQueue();
                break;

            case 'QUEUE_REVOKE':
                // Queue a revoke operation
                const revokeId = await AuthDB.queueOperation({
                    type: 'revoke',
                    file_id: data.file_id,
                    permission_id: data.permission_id
                });
                respondToClient(event, messageId, { success: true, operationId: revokeId });
                // Trigger processing
                processOperationQueue();
                break;

            case 'GET_PENDING_OPERATIONS':
                // Get all pending operations
                const pending = await AuthDB.getPendingOperations();
                respondToClient(event, messageId, { success: true, operations: pending });
                break;

            case 'EXPORT_BLOB':
                // Export blob as backup
                const backup = await AuthDB.exportBlobBackup();
                respondToClient(event, messageId, { success: true, backup });
                break;

            case 'IMPORT_BLOB':
                // Import blob from backup
                await AuthDB.importBlobBackup(data.backup);
                respondToClient(event, messageId, { success: true });
                break;

            case 'PROCESS_QUEUE':
                // Manually trigger queue processing
                processOperationQueue();
                respondToClient(event, messageId, { success: true });
                break;

            default:
                console.warn('[SW] Unknown message type:', type);
        }
    } catch (error) {
        console.error('[SW] Error handling message:', error);
        respondToClient(event, messageId, { success: false, error: error.message });
    }
});

// Helper to respond to client messages
function respondToClient(event, messageId, response) {
    if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ messageId, ...response });
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
    console.log('[SW] Processing operation queue');

    try {
        const pending = await AuthDB.getPendingOperations();
        console.log('[SW] Found', pending.length, 'pending operations');

        for (const operation of pending) {
            // Skip if retried too many times
            if (operation.retry_count >= 3) {
                console.warn('[SW] Operation', operation.id, 'exceeded retry limit');
                await AuthDB.updateOperationStatus(operation.id, 'failed', 'Exceeded retry limit');
                continue;
            }

            try {
                await processOperation(operation);
                await AuthDB.updateOperationStatus(operation.id, 'completed');
                console.log('[SW] Operation', operation.id, 'completed');
            } catch (error) {
                console.error('[SW] Operation', operation.id, 'failed:', error);
                await AuthDB.updateOperationStatus(operation.id, 'failed', error.message);
            }
        }

        // Clean up old completed operations
        await AuthDB.clearCompletedOperations();
    } catch (error) {
        console.error('[SW] Error processing queue:', error);
    }
}

// Process a single operation
async function processOperation(operation) {
    // Get blob
    const blobData = await AuthDB.getBlob();
    if (!blobData) {
        throw new Error('No auth blob found - user needs to re-authenticate');
    }

    // Get current ID token from a client
    const idToken = await requestIdTokenFromClient();
    if (!idToken) {
        throw new Error('No ID token available - user needs to refresh session');
    }

    const AUTH_PROXY_URL = self.location.hostname === 'localhost'
        ? 'http://localhost:8787'
        : 'https://setalight-auth-proxy.YOUR-SUBDOMAIN.workers.dev';

    if (operation.type === 'invite') {
        // Call /session/invite
        const response = await fetch(`${AUTH_PROXY_URL}/session/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                blob: blobData.blob,
                id_token: idToken,
                file_id: operation.file_id,
                email: operation.email
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Invite failed');
        }

        return await response.json();
    } else if (operation.type === 'revoke') {
        // Call /session/revoke
        const response = await fetch(`${AUTH_PROXY_URL}/session/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                blob: blobData.blob,
                id_token: idToken,
                file_id: operation.file_id,
                permission_id: operation.permission_id
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Revoke failed');
        }

        return await response.json();
    }

    throw new Error('Unknown operation type: ' + operation.type);
}

// Request ID token from an active client
async function requestIdTokenFromClient() {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    if (clients.length === 0) {
        return null;
    }

    // Ask the first client for an ID token
    return new Promise((resolve) => {
        const messageChannel = new MessageChannel();
        const timeout = setTimeout(() => resolve(null), 5000);

        messageChannel.port1.onmessage = (event) => {
            clearTimeout(timeout);
            resolve(event.data.idToken || null);
        };

        clients[0].postMessage(
            { type: 'REQUEST_ID_TOKEN' },
            [messageChannel.port2]
        );
    });
}

// Process queue periodically when online
self.addEventListener('online', () => {
    console.log('[SW] Back online, processing queue');
    processOperationQueue();
});

// Fetch event handler - routes requests
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    console.log('[SW] Fetch:', event.request.method, url.pathname);

    // Always pass through Google OAuth/GSI requests
    if (url.origin === 'https://accounts.google.com') {
        return;
    }

    // Always pass through auth-proxy requests (different port)
    if (url.port === '8787' || url.hostname.includes('workers.dev')) {
        return;
    }

    // Handle CDN requests (Lit.js from jsdelivr)
    if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.includes('/npm/lit')) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                // Return cached version if available, otherwise fetch and cache
                if (cached) {
                    return cached;
                }
                return fetch(event.request, { mode: 'cors' }).then((response) => {
                    if (response.ok) {
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return response;
                }).catch(() => {
                    console.log('[SW] Failed to fetch CDN asset:', url.href);
                    // Return a fallback or throw to let the browser handle it
                    return new Response('CDN asset not available', { status: 503 });
                });
            })
        );
        return;
    }

    // Only handle same-origin requests after CDN check
    if (url.origin !== location.origin) {
        return;
    }

    // API requests - pass through to network
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Directory listings in /sets/ - pass through to get real directory listing
    if (url.pathname.startsWith('/sets/') && url.pathname.endsWith('/')) {
        console.log('[SW] Passing through directory listing request:', url.pathname);
        event.respondWith(fetch(event.request));
        return;
    }

    // Static assets - behavior depends on dev mode
    if (url.pathname.match(/\.(css|js)$/)) {
        if (DEV_MODE) {
            // Dev mode: Always fetch fresh, fallback to cache on failure
            event.respondWith(
                fetch(event.request, { cache: 'no-cache' }).then((response) => {
                    // Clone the response and cache it as backup
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                    return response;
                }).catch(() => {
                    // If network fails, serve stale from cache
                    return caches.match(event.request);
                })
            );
        } else {
            // Production mode: Cache first, update in background
            event.respondWith(
                caches.match(event.request).then((cached) => {
                    const fetchPromise = fetch(event.request).then((response) => {
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                        return response;
                    });
                    return cached || fetchPromise;
                })
            );
        }
        return;
    }

    // Direct HTML file requests - pass through to network
    if (url.pathname.endsWith('.html')) {
        console.log('[SW] Direct HTML file request, passing through:', url.pathname);
        event.respondWith(fetch(event.request));
        return;
    }

    // HTML navigation requests - route-based page generation
    const acceptHeader = event.request.headers.get('Accept') || '';
    if (event.request.mode === 'navigate' || acceptHeader.includes('text/html')) {
        console.log('[SW] Handling navigation to:', url.pathname);
        event.respondWith(handleRoute(url));
        return;
    }

    // Pad audio files - cache on demand for offline use
    if (url.pathname.startsWith('/pads/') && url.pathname.endsWith('.mp3')) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) {
                    console.log('[SW] Serving cached pad:', url.pathname);
                    return cached;
                }

                // Not cached, fetch and cache it
                console.log('[SW] Fetching and caching pad:', url.pathname);
                return fetch(event.request).then((response) => {
                    // Only cache full responses (200), not partial responses (206)
                    if (response.ok && response.status === 200) {
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                            console.log('[SW] Cached pad for offline use:', url.pathname);
                        });
                    }
                    return response;
                }).catch((error) => {
                    console.error('[SW] Failed to fetch pad:', url.pathname, error);
                    throw error;
                });
            })
        );
        return;
    }

    if (url.pathname.startsWith('/pad-sets/')) {
        event.respondWith(
            caches.open(PAD_CACHE_NAME).then(async (cache) => {
                const cached = await cache.match(event.request);
                if (cached) {
                    return cached;
                }
                return new Response('Pad set asset not available offline', { status: 404 });
            })
        );
        return;
    }

    // Everything else - pass through
    event.respondWith(fetch(event.request));
});

async function handleRoute(url) {
    const path = url.pathname;

    console.log('[SW] handleRoute:', path);

    // Test files - pass through to network
    if (path.includes('-test.html') || path.includes('test-')) {
        console.log('[SW] Test file - passing through');
        return fetch(url);
    }

    // Home page: /
    if (path === '/' || path === '/index.html') {
        console.log('[SW] Serving index.html');
        if (DEV_MODE) {
            // Dev mode: Always fetch fresh, fallback to cache on failure
            return fetch('/index.html', { cache: 'no-cache' }).then((response) => {
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put('/index.html', responseToCache);
                });
                return response;
            }).catch(() => {
                return caches.match('/index.html');
            });
        } else {
            return fetch('/index.html');
        }
    }

    // Songs library page: /songs or /songs/
    if (path === '/songs' || path === '/songs/' || path === '/songs.html') {
        console.log('[SW] Serving songs.html');
        if (DEV_MODE) {
            // Dev mode: Always fetch fresh, fallback to cache on failure
            return fetch('/songs.html', { cache: 'no-cache' }).then((response) => {
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put('/songs.html', responseToCache);
                });
                return response;
            }).catch(() => {
                return caches.match('/songs.html');
            });
        } else {
            return fetch('/songs.html');
        }
    }

    // Settings page: /settings
    if (path === '/settings' || path === '/settings/' || path === '/settings.html') {
        console.log('[SW] Serving settings.html');
        if (DEV_MODE) {
            // Dev mode: Always fetch fresh, fallback to cache on failure
            return fetch('/settings.html', { cache: 'no-cache' }).then((response) => {
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put('/settings.html', responseToCache);
                });
                return response;
            }).catch(() => {
                return caches.match('/settings.html');
            });
        } else {
            return fetch('/settings.html');
        }
    }

    // Bookmarklet page: /bookmarklet
    if (path === '/bookmarklet' || path === '/bookmarklet/' || path === '/bookmarklet-install.html') {
        console.log('[SW] Serving bookmarklet-install.html');
        if (DEV_MODE) {
            // Dev mode: Always fetch fresh, fallback to cache on failure
            return fetch('/bookmarklet-install.html', { cache: 'no-cache' }).then((response) => {
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put('/bookmarklet-install.html', responseToCache);
                });
                return response;
            }).catch(() => {
                return caches.match('/bookmarklet-install.html');
            });
        } else {
            return fetch('/bookmarklet-install.html');
        }
    }

    // Import song page: /import-song
    if (path === '/import-song' || path === '/import-song/' || path === '/import-song.html') {
        console.log('[SW] Serving import-song.html');
        if (DEV_MODE) {
            // Dev mode: Always fetch fresh, fallback to cache on failure
            return fetch('/import-song.html', { cache: 'no-cache' }).then((response) => {
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put('/import-song.html', responseToCache);
                });
                return response;
            }).catch(() => {
                return caches.match('/import-song.html');
            });
        } else {
            return fetch('/import-song.html');
        }
    }

    // Components test page: /components-test
    if (path === '/components-test' || path === '/components-test/' || path === '/components-test.html') {
        console.log('[SW] Serving components-test.html');
        if (DEV_MODE) {
            // Dev mode: Always fetch fresh, fallback to cache on failure
            return fetch('/components-test.html', { cache: 'no-cache' }).then((response) => {
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put('/components-test.html', responseToCache);
                });
                return response;
            }).catch(() => {
                return caches.match('/components-test.html');
            });
        } else {
            return fetch('/components-test.html');
        }
    }

    // Setlist page: /setlist/{uuid} (ignore hash)
    const setlistMatch = path.match(/^\/setlist\/([^\/]+)$/);
    if (setlistMatch) {
        console.log('[SW] Serving setlist.html');
        if (DEV_MODE) {
            // Dev mode: Always fetch fresh, fallback to cache on failure
            return fetch('/setlist.html', { cache: 'no-cache' }).then((response) => {
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put('/setlist.html', responseToCache);
                });
                return response;
            }).catch(() => {
                return caches.match('/setlist.html');
            });
        } else {
            return fetch('/setlist.html');
        }
    }

    // Share page: /share/{id}
    const shareMatch = path.match(/^\/share\/([a-zA-Z0-9]+)$/);
    if (shareMatch) {
        console.log('[SW] Serving share.html');
        if (DEV_MODE) {
            return fetch('/share.html', { cache: 'no-cache' }).then((response) => {
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put('/share.html', responseToCache);
                });
                return response;
            }).catch(() => {
                return caches.match('/share.html');
            });
        } else {
            return fetch('/share.html');
        }
    }

    // Authorize page: /authorize (redirects to storage)
    if (path === '/authorize' || path === '/authorize/' || path === '/authorize.html') {
        console.log('[SW] Serving authorize.html (redirect page)');
        if (DEV_MODE) {
            return fetch('/authorize.html', { cache: 'no-cache' }).then((response) => {
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put('/authorize.html', responseToCache);
                });
                return response;
            }).catch(() => {
                return caches.match('/authorize.html');
            });
        } else {
            return fetch('/authorize.html');
        }
    }

    // Storage page: /storage
    if (path === '/storage' || path === '/storage/' || path === '/storage.html') {
        console.log('[SW] Serving storage.html');
        if (DEV_MODE) {
            return fetch('/storage.html', { cache: 'no-cache' }).then((response) => {
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put('/storage.html', responseToCache);
                });
                return response;
            }).catch(() => {
                return caches.match('/storage.html');
            });
        } else {
            return fetch('/storage.html');
        }
    }

    // 404
    console.log('[SW] 404 - not found');
    return new Response('Not Found', { status: 404 });
}
