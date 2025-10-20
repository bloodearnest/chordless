// Service Worker for Setalight
// Handles routing and generates pages for offline-first operation

const DEV_MODE = true; // Set to false for production
const CACHE_NAME = 'setalight-v10';
const ASSETS = [
    '/',
    '/css/style.css',
    '/js/parser.js',
    '/js/setlist-app.js',
    '/js/db.js',
    '/js/import.js',
    '/js/transpose.js'
];

// Install service worker and cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
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

// Fetch event handler - routes requests
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    console.log('[SW] Fetch:', event.request.method, url.pathname);

    // Only handle same-origin requests
    if (url.origin !== location.origin) {
        return;
    }

    // API requests - pass through to Python backend (for now)
    if (url.pathname.startsWith('/api/')) {
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

    // HTML navigation requests - route-based page generation
    const acceptHeader = event.request.headers.get('Accept') || '';
    if (event.request.mode === 'navigate' || acceptHeader.includes('text/html')) {
        console.log('[SW] Handling navigation to:', url.pathname);
        event.respondWith(handleRoute(url));
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
