// sw.js: service worker for the installed app (registered by src/main.js on https only; ?nosw skips it).
//
// Navigations (the page itself): network first, so a new deploy arrives as soon as there is a connection;
// the cached page is the offline fallback. Other same-origin GETs (scripts, vendor, terrain, icons): cache
// first, and each cached answer is refreshed in the background so the next visit picks up a deploy.
// Bump VERSION to drop every cached file at once (the old caches are deleted on activate).
// Never cached: cross-origin requests, non-GET, and any response that is not a plain 200.
// Relative paths only: the site lives under a /the-civil-war/ subpath on GitHub Pages.

const VERSION = 'cw-v25';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('cw-') && n !== VERSION).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

function cacheable(res) {
  return res && res.status === 200 && res.type === 'basic';
}

async function store(req, res) {
  if (!cacheable(res)) return;
  try {
    const cache = await caches.open(VERSION);
    await cache.put(req, res);
  } catch {
    // quota or a body already used: skip caching this one
  }
}

async function networkFirst(event) {
  const req = event.request;
  try {
    const res = await fetch(req);
    event.waitUntil(store(req, res.clone()));
    return res;
  } catch (err) {
    const hit = (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(event) {
  const req = event.request;
  const hit = await caches.match(req);
  const refresh = fetch(req).then((res) => store(req, res.clone()).then(() => res));
  if (hit) {
    event.waitUntil(refresh.catch(() => {})); // offline: keep the cached copy
    return hit;
  }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin: the browser handles it, never cached
  if (req.headers.has('range')) return; // partial content (audio) is never cached
  if (req.mode === 'navigate') event.respondWith(networkFirst(event));
  else event.respondWith(cacheFirst(event));
});
