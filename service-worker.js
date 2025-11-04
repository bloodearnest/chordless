// Service Worker for Setalight
// Handles routing and generates pages for offline-first operation

// Auto-detect development mode based on hostname
const DEV_MODE = self.location.hostname === 'localhost'
    || self.location.hostname === '127.0.0.1'
    || self.location.hostname.startsWith('192.168.')
    || self.location.hostname.startsWith('10.')
    || self.location.hostname.endsWith('.local');

const CACHE_NAME = 'setalight-v56';
const ASSETS = [
    '/',
    '/css/style.css',
    '/js/parser.js',
    '/js/setlist-app.js',
    '/js/db.js',
    '/js/import.js',
    '/js/transpose.js',
    '/components/media-player.js'
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
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Handle messages from clients
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('[SW] Received SKIP_WAITING message');
        self.skipWaiting();
    }
});

// Fetch event handler - routes requests
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    console.log('[SW] Fetch:', event.request.method, url.pathname);

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
                    if (response.ok) {
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

    // 404
    console.log('[SW] 404 - not found');
    return new Response('Not Found', { status: 404 });
}
