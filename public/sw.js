/*
 * 10/10 Thrifts service worker.
 *
 * Exists to make the site installable (browsers require a service worker
 * before they offer "Add to Home Screen") and to speed up repeat visits —
 * WITHOUT ever serving stale content:
 *
 *  - Pages, API routes, model GLBs and images: network only. Always fresh.
 *  - /_next/static/* assets only: stale-while-revalidate. These files are
 *    content-hashed by the build, so a cached copy can never be "old" — the
 *    hash changes whenever the code changes. The cache is refreshed in the
 *    background on every request, and wiped on activate when this file
 *    changes.
 *
 * No other caching. No offline mode by design (a marketplace showing stale
 * listings/prices offline is worse than showing nothing).
 */
const CACHE = "thrift-static-v1";
const IMMUTABLE = /^\/_next\/static\//;

self.addEventListener("install", () => {
  // New SW takes over immediately so old caches get cleaned up fast.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (!IMMUTABLE.test(new URL(request.url).pathname)) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      // Serve the cached copy instantly, refresh it from the network in the
      // background; fall back to the cache only if the network fails.
      const network = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
