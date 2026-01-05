const CACHE_PREFIX = "brisa-root-";
const CACHE_VERSION = "v13";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  OFFLINE_URL,
  "/assets/css/pages/index.css",
  "/assets/css/core-contrast.css",
  "/assets/js/pages/index.js",
  "/assets/js/common/firebaseClient.js",
  "/assets/js/common/notifications.js"
];

self.addEventListener("push", () => {
  // No-op placeholder to silence messaging warnings on root scope.
});

self.addEventListener("pushsubscriptionchange", () => {
  // No-op placeholder to silence messaging warnings on root scope.
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
});

const safeCachePut = async (cache, request, response) => {
  if (!response || !response.ok) return;
  if (response.status === 206 || request.headers.has("range")) return;
  try {
    await cache.put(request, response);
  } catch (err) {
    if (err && err.name === "QuotaExceededError") return;
    throw err;
  }
};

const precache = async () => {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    PRECACHE_URLS.map((url) => cache.add(url).catch(() => {}))
  );
};

const networkFirst = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    await safeCachePut(cache, request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    return cached || (await cache.match(OFFLINE_URL));
  }
};

const cacheFirst = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await safeCachePut(cache, request, response.clone());
  return response;
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    precache()
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/css/") ||
    url.pathname.startsWith("/js/")
  ) {
    event.respondWith(cacheFirst(request));
  }
});
