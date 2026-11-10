// Service worker — after the first successful load, the app works offline
// (all data lives in IndexedDB on-device).
const CACHE_NAME = 'theatre-log-v2';
const ASSETS = [
  './',
  './index.html',
  './css/tokens.css',
  './css/components.css',
  './css/app.css',
  './js/db.js',
  './js/icons.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: when online, always get the latest deployed code (and refresh
// the cache); when offline, fall back to the cached copy.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return; // e.g. Google Fonts
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request)
        .then(cached => cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
