// Club House (phone) service worker: keeps the app shell available offline.
// Only caches this folder's own files. AI sites always open live in the browser.
const CACHE = 'clubhouse-phone-v2';
const SHELL = [
  './', './index.html', './manifest.json', './robots.txt',
  './apple-touch-icon.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './favicon.png',
  './fonts/ChakraPetch-600-normal.woff2', './fonts/ChakraPetch-700-normal.woff2',
  './fonts/IBMPlexMono-400-normal.woff2', './fonts/IBMPlexMono-500-normal.woff2',
  './fonts/IBMPlexSans-400_600-normal.woff2'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Network first (so updates show up), fall back to the cached shell when offline.
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
