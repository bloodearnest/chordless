// Service Worker for Setalight
// Handles routing and generates pages for offline-first operation

const DEV_MODE = true; // Set to false for production
const CACHE_NAME = 'setalight-v6';
const ASSETS = [
    '/',
    '/style.css',
    '/chordpro-parser.js',
    '/page-app.js',
    '/db.js',
    '/import.js'
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

    // Home page: /
    if (path === '/' || path === '/index.html') {
        console.log('[SW] Generating home page');
        return generateHomePage();
    }

    // Setlist page: /setlist/{uuid} (ignore hash)
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
                <div class="header-left">
                    <a href="/" class="home-button" aria-label="Home">🏠</a>
                    <div class="song-title-compact" id="song-title-header">Loading...</div>
                </div>
                <div class="header-center">
                    <button class="reset-button" id="reset-button" aria-label="Reset song">↺</button>
                    <div class="font-size-controls">
                        <button class="font-size-btn" id="font-size-decrease" aria-label="Decrease font size">A−</button>
                        <button class="font-size-btn" id="font-size-increase" aria-label="Increase font size">A+</button>
                    </div>
                    <!-- Key display (normal mode) and key selector (edit mode) in same position -->
                    <div class="key-display-wrapper">
                        <span class="meta-item key-meta-display" id="key-meta-display">
                            <span class="meta-label">Key:</span>
                            <span id="key-value-display">-</span>
                        </span>
                        <div class="key-selector-controls">
                            <label class="key-selector-label">Key:</label>
                            <button id="key-selector-button" class="key-selector" popovertarget="key-selector-popover">
                                <span id="key-selector-value">-</span>
                            </button>
                            <div id="key-selector-popover" class="key-popover" popover>
                                <div id="key-options-list" class="key-options-list">
                                    <!-- Options populated by JavaScript -->
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="song-meta-compact" id="song-meta-header"></div>
                </div>
                <div class="header-right">
                    <button class="edit-mode-toggle" id="edit-mode-toggle" aria-label="Toggle edit mode">✎</button>
                    <button class="info-button" id="info-button" aria-label="Song info">i</button>
                </div>
            </header>

            <main id="main-content">
                <div class="song-container">
                    <p>Loading setlist...</p>
                </div>
            </main>
        </div>

        <!-- Song info modal -->
        <div class="modal-overlay" id="song-info-modal">
            <div class="modal-content">
                <button class="modal-close" id="modal-close">&times;</button>
                <div id="modal-body"></div>
            </div>
        </div>

        <!-- Reset confirmation modal -->
        <div class="modal-overlay" id="reset-confirm-modal">
            <div class="modal-content">
                <h2>Reset Song?</h2>
                <p>This will reset the key, BPM, font size, and all section states back to defaults. This cannot be undone.</p>
                <div class="modal-actions">
                    <button class="modal-btn modal-btn-cancel" id="reset-cancel">Cancel</button>
                    <button class="modal-btn modal-btn-confirm" id="reset-confirm">Reset</button>
                </div>
            </div>
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
