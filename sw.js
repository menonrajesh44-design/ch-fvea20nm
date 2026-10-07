// Club House (phone) service worker: keeps the app shell available offline.
// Only caches this folder's own files. AI sites always open live in the browser.
const CACHE = 'clubhouse-phone-v5';
const NET_TIMEOUT_MS = 3000; // if the network stalls (e.g. China firewall), open from cache after 3 s
const SHELL = [
  './', './index.html', './club.html', './manifest.json', './robots.txt',
  './apple-touch-icon.png', './atelier-logo.png',
  './bots/ralph.jpg', './bots/alexa.jpg', './bots/miranda.jpg', './bots/priya.jpg', './bots/jack.jpg', './bots/millie.jpg',
  './bots/orange.jpg', './bots/amra.jpg', './bots/metaads.jpg', './bots/orchidwest.jpg', './bots/mellow.jpg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './favicon.png',
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
  // Network first (so updates show up), but give up after NET_TIMEOUT_MS and use the cached copy,
  // so the Home Screen app still opens instantly when github.io is slow or disrupted.
  const network = fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  });
  const cached = () => caches.match(req).then(r => r || caches.match('./index.html'));
  const timeout = new Promise(resolve => setTimeout(resolve, NET_TIMEOUT_MS)).then(cached);
  e.respondWith(
    Promise.race([network.catch(cached), timeout.then(r => r || network)])
  );
});
