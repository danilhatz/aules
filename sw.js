const VERSION = "v1";
const CACHE = `aules-shell-${VERSION}`;
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./src/api.js",
  "./src/app.js",
  "./src/auth.js",
  "./src/config.js",
  "./src/content.js",
  "./src/errors.js",
  "./src/main.js",
  "./src/sanitize.js",
  "./src/storage.js",
  "./src/store.js",
  "./src/strings.js",
  "./src/styles.css",
  "./src/vault.js",
  "./src/ui/course.js",
  "./src/ui/courses.js",
  "./src/ui/dom.js",
  "./src/ui/login.js"
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Same-origin GETs: serve the cached copy immediately and refresh it in the background.
// Cross-origin requests (the aules API and files) are never touched, so tokens are never cached.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
