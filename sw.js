const CACHE_NAME = 'bist-picker-v4';
const ASSETS = [
  './',
  './index.html',
  './index.css',
  './app.js',
  './manifest.webmanifest',
  'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js',
  'https://cdn.jsdelivr.net/npm/apexcharts',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Outfit:wght@400;500;600;700;800;900&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200'
];

self.addEventListener('install', (e) => {
  console.log('[Service Worker] Install event');
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell assets');
      return cache.addAll(ASSETS);
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

self.addEventListener('fetch', (e) => {
  // We do not want to cache the database download file or manifest since they must be live/fresh
  const url = new URL(e.request.url);
  if (url.pathname.includes('mobile_snapshot.db.gz') || url.pathname.includes('manifest.json')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network falling back to Cache strategy for general assets
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // If valid network response, update cache
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if network request fails (Offline support)
        return caches.match(e.request);
      })
  );
});
