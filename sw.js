const VERSION = "v9";
const CACHE = `aules-shell-${VERSION}`;
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./src/api.js",
  "./src/assign.js",
  "./src/attemptstore.js",
  "./src/app.js",
  "./src/auth.js",
  "./src/config.js",
  "./src/content.js",
  "./src/courses.js",
  "./src/diagnostics.js",
  "./src/drafts.js",
  "./src/errors.js",
  "./src/folders.js",
  "./src/forum.js",
  "./src/i18n.js",
  "./src/lang/en.js",
  "./src/lang/uk.js",
  "./src/qhtml.js",
  "./src/quiz.js",
  "./src/main.js",
  "./src/sanitize.js",
  "./src/storage.js",
  "./src/store.js",
  "./src/timings.js",
  "./src/strings.js",
  "./src/submit.js",
  "./src/styles.css",
  "./src/vault.js",
  "./src/ui/assign.js",
  "./src/ui/attempt.js",
  "./src/ui/course.js",
  "./src/ui/courses.js",
  "./src/ui/diagnostics.js",
  "./src/ui/dom.js",
  "./src/ui/forum.js",
  "./src/ui/langswitch.js",
  "./src/ui/login.js",
  "./src/ui/quiz.js"
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Same-origin GETs are served from the versioned cache with no network request at all, so the app files
// never compete with the Aules calls for mobile bandwidth and one version is always served as a consistent
// set. A new release changes VERSION: the install step below re-downloads everything (bypassing the HTTP
// cache) and the old cache is deleted on activate. Cross-origin requests (Aules API and files) are never
// touched, so tokens are never cached.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => (await cache.match(req, { ignoreSearch: true })) || fetch(req)),
  );
});
