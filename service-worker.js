const CACHE_PREFIX = "brisa-root-";
const CACHE_VERSION = "v93";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  OFFLINE_URL,
  "/css/style.css?v=20260428-desktop-orgtree-eyebrow-plus-1",
  "/assets/css/pages/index.css?v=20260502-portal-hover-state-1",
  "/css/structure.css?v=20260502-specialists-lorena-popup-card-1",
  "/assets/css/core-contrast.css?v=20260502-committee-border-align-1",
  "/assets/js/pages/index.js?v=20260502-portal-hover-state-1",
  "/js/app.js?v=20260502-neuquen-veronica-rodriguez-1",
  "/js/chat.js?v=20260428-chat-read-receipts-1",
  "/assets/js/common/firebaseClient.js",
  "/assets/js/common/notifications.js",
  "/assets/images/committees/committee-emergencias.png?v=20260502-committee-cards-precision-1",
  "/assets/images/committees/committee-salud-ocupacional.png?v=20260502-committee-cards-precision-1",
  "/assets/images/committees/committee-calidad-seguridad.png?v=20260502-committee-cards-precision-1",
  "/assets/images/committees/committee-salud-digital-innovacion.png?v=20260502-committee-cards-precision-1",
  "/assets/images/committees/committee-docencia-investigacion.png?v=20260502-committee-cards-precision-1",
  "/assets/images/committees/committee-farmacia-terapeutica.png?v=20260502-committee-cards-precision-1",
  "/assets/images/committees/committee-bioetica.png?v=20260502-committee-cards-precision-1"
];

try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");
} catch (e) {}

let firebaseInitialized = false;
let messagingReady = false;

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDabEuXGyD5muXCGrbQ1WB9j-CFmVnxudU",
  authDomain: "departamento-medico-brisa.firebaseapp.com",
  projectId: "departamento-medico-brisa",
  storageBucket: "departamento-medico-brisa.firebasestorage.app",
  messagingSenderId: "830022654524",
  appId: "1:830022654524:web:45321f121e62d2815cc139"
};

const pickString = (value) => (typeof value === "string" ? value.trim() : "");

const buildNotificationData = (data = {}) => ({
  route: pickString(data.route),
  conversationId: pickString(data.conversationId),
  postId: pickString(data.postId),
  type: pickString(data.type)
});

const buildTargetUrl = (notificationData = {}) => {
  const route = pickString(notificationData.route);
  if (route) {
    const routeUrl = normalizeRouteUrl(route);
    if (routeUrl) return routeUrl;
  }

  const conversationId = pickString(notificationData.conversationId);
  if (conversationId) {
    return new URL(
      `/open.html?conversationId=${encodeURIComponent(conversationId)}`,
      self.location.origin
    ).href;
  }

  return new URL("/open.html", self.location.origin).href;
};

const normalizeRouteUrl = (route) => {
  if (!route) return "";
  if (route.startsWith("#/")) {
    return new URL(`/app/index.html${route}`, self.location.origin).href;
  }
  if (route.startsWith("#")) {
    return new URL(`/index.html${route}`, self.location.origin).href;
  }

  try {
    const target = new URL(route, self.location.origin);
    if (target.origin !== self.location.origin) return "";
    const allowedPaths = new Set([
      "/",
      "/index.html",
      "/app/",
      "/app/index.html",
      "/open.html"
    ]);
    if (!allowedPaths.has(target.pathname)) return "";
    return target.href;
  } catch (e) {
    return "";
  }
};

const parseUrl = (url) => {
  try {
    return new URL(url);
  } catch (e) {
    return null;
  }
};

const findTargetClient = (clientList, targetUrl) => {
  const target = parseUrl(targetUrl);
  if (!target) return null;
  const sameOrigin = clientList.filter((client) => {
    const clientUrl = parseUrl(client.url);
    return clientUrl && clientUrl.origin === self.location.origin;
  });

  if (target.pathname === "/app/" || target.pathname === "/app/index.html") {
    return (
      sameOrigin.find((client) => {
        const clientUrl = parseUrl(client.url);
        return clientUrl?.pathname.startsWith("/app/");
      }) || sameOrigin[0] || null
    );
  }

  if (target.pathname === "/open.html") {
    return sameOrigin[0] || null;
  }

  return (
    sameOrigin.find((client) => {
      const clientUrl = parseUrl(client.url);
      if (!clientUrl) return false;
      if (target.pathname === "/index.html") {
        return clientUrl.pathname === "/" || clientUrl.pathname === "/index.html";
      }
      return clientUrl.pathname === target.pathname;
    }) || sameOrigin[0] || null
  );
};

const postNotificationClick = (client, notificationData) => {
  if (!client?.postMessage) return;
  try {
    if (notificationData.conversationId) {
      client.postMessage({
        type: "OPEN_CONVERSATION",
        conversationId: notificationData.conversationId
      });
    }
    client.postMessage({
      type: "BRISA_NOTIFICATION_CLICK",
      route: notificationData.route,
      conversationId: notificationData.conversationId,
      postId: notificationData.postId,
      notificationType: notificationData.type
    });
  } catch (e) {}
};

const focusOrOpenNotificationTarget = async (notificationData) => {
  const targetUrl = buildTargetUrl(notificationData);
  const clientList = await clients.matchAll({
    type: "window",
    includeUncontrolled: true
  });
  const targetClient = findTargetClient(clientList, targetUrl);
  if (targetClient) {
    let focusedClient = targetClient;
    if (targetClient.url !== targetUrl && targetClient.navigate) {
      try {
        focusedClient = (await targetClient.navigate(targetUrl)) || targetClient;
      } catch (e) {
        focusedClient = targetClient;
      }
    }
    if (focusedClient.focus) await focusedClient.focus();
    postNotificationClick(focusedClient, notificationData);
    return;
  }

  await clients.openWindow(targetUrl);
};

const setupMessaging = () => {
  if (messagingReady) return;
  if (typeof firebase === "undefined" || !firebase.messaging) return;
  try {
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const data = payload?.data || {};
      const notification = payload?.notification || {};
      const notificationData = buildNotificationData(data);
      const title =
        pickString(data.title) ||
        pickString(notification.title) ||
        "Nueva notificacion";
      const body =
        pickString(data.body) ||
        pickString(notification.body) ||
        "Hay nueva actividad en la aplicacion";

      if (self.registration.setAppBadge) {
        self.registration.setAppBadge(
          (self.__badgeCount = (self.__badgeCount || 0) + 1)
        );
      }

      self.registration.showNotification(title, {
        body,
        data: notificationData,
        icon: "/assets/icons/icon-192.png",
        badge: "/assets/icons/icon-72.png"
      });
    });
    messagingReady = true;
  } catch (e) {}
};

const initFirebase = (config) => {
  if (firebaseInitialized) return;
  if (!config || typeof firebase === "undefined") return;
  try {
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp(config);
    }
    firebaseInitialized = true;
    setupMessaging();
  } catch (e) {}
};

initFirebase(self.__FIREBASE_CONFIG__ || FIREBASE_CONFIG);

self.addEventListener("message", (event) => {
  if (event.data?.type === "INIT_FIREBASE") {
    initFirebase(event.data.config || FIREBASE_CONFIG);
  }
});

self.addEventListener("push", () => {
  // No-op placeholder to silence messaging warnings on root scope.
});

self.addEventListener("pushsubscriptionchange", () => {
  // No-op placeholder to silence messaging warnings on root scope.
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(focusOrOpenNotificationTarget(event.notification.data || {}));
});

const shouldSkipRuntimeCache = (request) => {
  if (!request || request.method !== "GET") return true;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return true;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/__/")) {
    return true;
  }
  if (request.mode === "navigate" && url.search) return true;
  return false;
};

const safeCachePut = async (cache, request, response) => {
  if (!response || !response.ok) return;
  if (shouldSkipRuntimeCache(request)) return;
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
