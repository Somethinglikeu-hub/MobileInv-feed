const CACHE_NAME = 'bist-picker-shell-v5';
const APP_SHELL = [
  './',
  './index.html',
  './index.css?v=5',
  './app.js?v=5',
  './manifest.webmanifest?v=5',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const OPTIONAL_RUNTIME_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm',
  'https://cdn.jsdelivr.net/npm/apexcharts'
];

self.addEventListener('install', (e) => {
  console.log('[Service Worker] Install event');
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[Service Worker] Caching app shell assets');
      await cache.addAll(
        APP_SHELL.map(asset => new Request(asset, { cache: 'reload' }))
      );

      // CDN files are useful offline but must never make the PWA installation
      // fail when one provider is temporarily unavailable.
      await Promise.allSettled(
        OPTIONAL_RUNTIME_ASSETS.map(async asset => {
          const request = new Request(asset, { cache: 'reload' });
          const response = await fetch(request);
          if (response.ok || response.type === 'opaque') {
            await cache.put(request, response);
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  console.log('[Service Worker] Activate event');
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Snapshot metadata and database content must always be checked online.
  // The application itself falls back to the last IndexedDB snapshot offline.
  if (url.pathname.includes('mobile_snapshot.db.gz') || url.pathname.includes('manifest.json')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }

  // Keep page navigations fresh, but preserve an offline app-shell fallback.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(async () => (
          await caches.match('./index.html') ||
          await caches.match('./')
        ))
    );
    return;
  }

  // Network first makes installed PWAs receive new code immediately. Successful
  // responses are retained for offline startup, including CDN dependencies.
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response && (response.ok || response.type === 'opaque')) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if network request fails (Offline support)
        return caches.match(e.request).then(
          cached => cached || caches.match(e.request, { ignoreSearch: true })
        );
      })
  );
});
