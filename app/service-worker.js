const CACHE_PREFIX = "brisa-app-";
// Bump this whenever we change precached assets (CSS/JS) to ensure clients
// receive the updated files instead of an older cached copy.
const CACHE_VERSION = "v11";
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
const APP_SHELL_URL = "/app/index.html";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  APP_SHELL_URL,
  OFFLINE_URL,
  "/assets/css/pages/app.css",
  "/assets/js/pages/app.js"
];

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

let firebaseInitialized = false;
let messagingReady = false;

const setupMessaging = () => {
  if (messagingReady) return;
  try {
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const { title, body, conversationId } = payload.data || {};

      if (self.registration.setAppBadge) {
        self.registration.setAppBadge(
          (self.__badgeCount = (self.__badgeCount || 0) + 1)
        );
      }

      self.registration.showNotification(title || "Nuevo mensaje", {
        body: body || "Tenes un mensaje nuevo",
        data: { conversationId },
        icon: "/assets/icons/icon-192.png",
        badge: "/assets/icons/icon-72.png"
      });
    });
    messagingReady = true;
  } catch (e) {
    // Waiting for INIT_FIREBASE.
  }
};

self.addEventListener("message", (event) => {
  if (event.data?.type === "INIT_FIREBASE" && !firebaseInitialized) {
    firebase.initializeApp(event.data.config);
    firebaseInitialized = true;
    setupMessaging();
  }
});

self.addEventListener("push", () => {
  // Firebase Messaging handles payloads; keep listener to silence warnings.
});

self.addEventListener("pushsubscriptionchange", () => {
  // No-op placeholder to silence warnings; resubscription handled by app.
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/app/index.html")) {
          client.focus();
          client.postMessage({
            type: "OPEN_CONVERSATION",
            conversationId: event.notification.data?.conversationId
          });
          return;
        }
      }
      const conversationId = event.notification.data?.conversationId;
      const targetUrl = conversationId
        ? `/open.html?conversationId=${encodeURIComponent(conversationId)}`
        : "/open.html";
      return clients.openWindow(targetUrl);
    })
  );
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

const networkFirst = async (request) => {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    await safeCachePut(cache, request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    return cached || (await cache.match(APP_SHELL_URL)) || (await cache.match(OFFLINE_URL));
  }
};

const cacheFirst = async (request) => {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await safeCachePut(cache, request, response.clone());
  return response;
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(PRECACHE_URLS.map((url) => cache.add(url).catch(() => {})))
      )
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
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
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

  if (request.mode === "navigate" && url.pathname.startsWith("/app/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
  }
});
