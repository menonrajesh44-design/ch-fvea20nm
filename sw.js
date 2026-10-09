// Club House (phone) service worker: keeps the app shell available offline.
// Only caches this folder's own files. AI sites always open live in the browser.
// Bot chat (relay /api/chat, POST, another origin) is never cached.
const CACHE = 'clubhouse-phone-v17'; // v17: Jail moved to the last section
const NET_TIMEOUT_MS = 3000; // if the network stalls (e.g. China firewall), open from cache after 3 s
const SHELL = [
  './', './index.html', './club.html',
  './grokchat.js', './manifest.json', './robots.txt',
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
  const url = new URL(req.url);
  if (url.pathname.includes('/api/')) return;               // bot chat relay: always live
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const put = res => { if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };
  const fromCache = () => caches.match(req, { ignoreSearch: true });
  if (req.mode === 'navigate') {
    // Pages: live first. If slow (>3 s) use THIS page's cached copy (never Home in its place).
    e.respondWith(new Promise(resolve => {
      let done = false;
      const net = fetch(req).then(put);
      const t = setTimeout(() => fromCache().then(r => { if (r && !done) { done = true; resolve(r); } }), NET_TIMEOUT_MS);
      net.then(r => { if (!done) { done = true; clearTimeout(t); resolve(r); } })
         .catch(() => fromCache().then(r => { if (!done) { done = true; clearTimeout(t); resolve(r || caches.match('./index.html').then(x => x || Response.error())); } }));
    }));
    return;
  }
  // Files (images, fonts, js): cache first for speed, refresh in background.
  e.respondWith(fromCache().then(r => {
    const net = fetch(req).then(put).catch(() => r || Response.error());
    return r || net;
  }));
});
