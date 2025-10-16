// Service Worker for Setalight
// Handles routing and generates pages for offline-first operation

const CACHE_NAME = 'setalight-v3';
const ASSETS = [
    '/',
    '/style.css',
    '/chordpro-parser.js',
    '/page-app.js'
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

    // Static assets - network first (for development), fallback to cache
    if (url.pathname.match(/\.(css|js)$/)) {
        event.respondWith(
            fetch(event.request).then((response) => {
                // Clone the response and cache it
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                return response;
            }).catch(() => {
                // If network fails, try cache
                return caches.match(event.request);
            })
        );
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

    // Home page: /
    if (path === '/' || path === '/index.html') {
        console.log('[SW] Generating home page');
        return generateHomePage();
    }

    // Setlist page: /setlist/2025-10-12 (ignore hash)
    const setlistMatch = path.match(/^\/setlist\/([^\/]+)$/);
    if (setlistMatch) {
        const setlistId = setlistMatch[1];
        console.log('[SW] Generating setlist page for:', setlistId);
        return generateSetlistPage(setlistId);
    }

    // 404
    console.log('[SW] 404 - not found');
    return new Response('Not Found', { status: 404 });
}

// Generate home page HTML
async function generateHomePage() {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Setlist arrangement for worship songs">
    <meta name="view-transition" content="same-origin">
    <title>Setalight</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <div class="app-container">
        <div id="home-view" class="view">
            <header>
                <h1>Setalight</h1>
            </header>

            <main class="home-content">
                <h2>Select a Setlist</h2>
                <div id="setlist-list" class="setlist-list">
                    <p>Loading setlists...</p>
                </div>
            </main>
        </div>
    </div>

    <script type="module" src="/page-app.js"></script>
</body>
</html>`;

    return new Response(html, {
        headers: { 'Content-Type': 'text/html' }
    });
}

// Generate setlist overview page HTML
async function generateSetlistPage(setlistId) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Setlist arrangement for worship songs">
    <meta name="view-transition" content="same-origin">
    <title>Setlist - ${setlistId}</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <div class="app-container">
        <div id="song-view" class="view">
            <header>
                <a href="/" class="home-button" aria-label="Home">🏠</a>
                <h1>Setalight</h1>
                <div class="setlist-info">
                    <span class="date" id="setlist-date"></span>
                </div>
            </header>

            <main id="main-content">
                <div class="song-container">
                    <p>Loading setlist...</p>
                </div>
            </main>

            <nav class="controls">
                <button id="prev-song" aria-label="Previous">←</button>
                <span class="song-position" id="song-position">Setlist</span>
                <button id="next-song" aria-label="Next">→</button>
            </nav>
        </div>
    </div>

    <script type="module" src="/page-app.js"></script>
    <script>
        window.__ROUTE__ = {
            type: 'setlist',
            setlistId: '${setlistId}'
        };
    </script>
</body>
</html>`;

    return new Response(html, {
        headers: { 'Content-Type': 'text/html' }
    });
}
