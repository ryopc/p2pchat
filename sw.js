/**
 * P2P Secure LAN Chat - Service Worker
 * ============================================
 * Zero-internet, offline-first PWA service worker
 * Cache versioning & cleanup strategy included
 */

const CACHE_VERSION = 'p2p-chat-v1';
const CACHE_ASSETS = [
    './',
    './index.html',
    './manifest.json'
];

const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

/**
 * Install Event: Pre-cache essential assets
 */
self.addEventListener('install', (event) => {
    console.log('[SW] Install event triggered');
    
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            console.log('[SW] Caching static assets...');
            return cache.addAll(CACHE_ASSETS).catch((err) => {
                console.warn('[SW] Some assets failed to cache (expected in dev):', err);
                // Don't fail install if some assets are unreachable
                return Promise.resolve();
            });
        }).then(() => {
            console.log('[SW] Install complete');
            return self.skipWaiting(); // Activate immediately
        })
    );
});

/**
 * Activate Event: Clean up old cache versions
 */
self.addEventListener('activate', (event) => {
    console.log('[SW] Activate event triggered');
    
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (!cacheName.startsWith('p2p-chat-')) {
                        return undefined;
                    }
                    if (cacheName !== STATIC_CACHE && cacheName !== RUNTIME_CACHE) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[SW] Activation complete');
            return self.clients.claim(); // Take control of all clients
        })
    );
});

/**
 * Fetch Event: Cache strategies
 * 
 * Strategy:
 * - HTML: Network-first (always check server, fall back to cache)
 * - CSS/JS: Cache-first (use cached, update in background)
 * - Images/Media: Cache-first
 * - API/WebSocket: Network-only (bypass cache)
 */
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip external origins
    if (url.origin !== self.location.origin) {
        return;
    }

    // HTML: Network-first strategy
    if (request.destination === 'document' || url.pathname.endsWith('.html')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Cache successful responses
                    if (response.ok) {
                        const cache = caches.open(STATIC_CACHE);
                        cache.then((c) => c.put(request, response.clone()));
                    }
                    return response;
                })
                .catch(() => {
                    // Fall back to cached version
                    return caches.match(request).then((cached) => {
                        return cached || offlineResponse();
                    });
                })
        );
        return;
    }

    // CSS/JS/Assets: Cache-first strategy
    if (
        request.destination === 'style' ||
        request.destination === 'script' ||
        request.destination === 'image' ||
        request.destination === 'font' ||
        url.pathname.endsWith('.woff2') ||
        url.pathname.endsWith('.woff')
    ) {
        event.respondWith(
            caches.match(request)
                .then((cached) => {
                    if (cached) {
                        return cached;
                    }
                    return fetch(request).then((response) => {
                        if (response.ok) {
                            caches.open(RUNTIME_CACHE).then((cache) => {
                                cache.put(request, response.clone());
                            });
                        }
                        return response;
                    });
                })
                .catch(() => {
                    // Return a blank placeholder for missing assets
                    return new Response('', { status: 404 });
                })
        );
        return;
    }

    // Default: Network-first with cache fallback
    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response.ok) {
                    caches.open(RUNTIME_CACHE).then((cache) => {
                        cache.put(request, response.clone());
                    });
                }
                return response;
            })
            .catch(() => {
                return caches.match(request).then((cached) => {
                    return cached || offlineResponse();
                });
            })
    );
});

/**
 * Offline Response: Fallback page for offline mode
 */
function offlineResponse() {
    return new Response(
        `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Offline - P2P Chat</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background-color: #0d1117;
            color: #00ff41;
            font-family: 'Monaco', 'Courier New', monospace;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            text-align: center;
        }
        .container {
            padding: 2rem;
            border: 2px dashed #00d9ff;
            border-radius: 4px;
            max-width: 600px;
        }
        h1 { font-size: 2rem; margin-bottom: 1rem; text-shadow: 0 0 20px rgba(0, 255, 65, 0.3); }
        p { margin: 0.5rem 0; color: #8b949e; }
    </style>
</head>
<body>
    <div class="container">
        <h1>▶ OFFLINE</h1>
        <p>ファイルがキャッシュされていません。</p>
        <p>オンライン環境に戻るか、既にロードしたアプリを再度開いてください。</p>
    </div>
</body>
</html>`,
        {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }
    );
}

/**
 * Message Events: Communication with clients
 */
self.addEventListener('message', (event) => {
    console.log('[SW] Message received:', event.data);

    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.keys().then((names) => {
            Promise.all(names.map((name) => caches.delete(name))).then(() => {
                event.ports[0].postMessage({ status: 'cache-cleared' });
            });
        });
    }
});

console.log('[SW] Service Worker loaded');
