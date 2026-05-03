import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth as sharedAuth } from "../common/firebaseClient.js";

const normalizeHash = (value) => {
  if (!value) return "";
  return value.startsWith("#") ? value : `#${value}`;
};

const SAFE_PATHS = new Set([
  "/",
  "/index.html",
  "/app/",
  "/app/index.html",
  "/galeriadearte",
  "/galeriadearte.html"
]);

const normalizeSafePath = (value) => {
  if (!value || !value.startsWith("/")) return "";
  try {
    const target = new URL(value, window.location.origin);
    if (target.origin !== window.location.origin) return "";
    if (!SAFE_PATHS.has(target.pathname)) return "";
    return `${target.pathname}${target.hash || ""}`;
  } catch (e) {
    return "";
  }
};

export const resolveNextTarget = (fallbackHash = "") => {
  const params = new URLSearchParams(window.location.search);
  if (params.has("next")) {
    const raw = params.get("next") || "";
    if (!raw) return window.location.hash || fallbackHash;
    const safePath = normalizeSafePath(raw);
    if (safePath) return safePath;
    return normalizeHash(raw);
  }
  const currentPath = window.location.pathname || "";
  if (currentPath && !["/", "/index.html", "/app/", "/app/index.html", "/login.html"].includes(currentPath)) {
    const safePath = normalizeSafePath(`${currentPath}${window.location.hash || ""}`);
    if (safePath) return safePath;
  }
  return window.location.hash || fallbackHash;
};

export const resolveNextHash = resolveNextTarget;

export const buildLoginRedirectUrl = (fallbackHash = "") => {
  const nextHash = resolveNextTarget(fallbackHash);
  const params = new URLSearchParams();
  if (nextHash) params.set("next", nextHash);
  const currentParams = new URLSearchParams(window.location.search || "");
  if (currentParams.get("dmEmulators") === "1") {
    params.set("dmEmulators", "1");
  }
  const query = params.toString();
  return `/login.html${query ? `?${query}` : ""}`;
};

export const waitForAuth = (auth = sharedAuth) =>
  new Promise((resolve) => {
    if (!auth) {
      resolve(null);
      return;
    }
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user || null);
      },
      () => {
        unsubscribe();
        resolve(null);
      }
    );
  });

export const requireAuth = async (auth = sharedAuth, { fallbackHash = "" } = {}) => {
  const user = await waitForAuth(auth);
  if (!user) {
    window.location.replace(buildLoginRedirectUrl(fallbackHash));
    return null;
  }
  return user;
};
