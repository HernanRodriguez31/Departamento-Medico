import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth as sharedAuth } from "../common/firebaseClient.js";
import { isLocalHost } from "../common/firebase-bootstrap.js";

const normalizeHash = (value) => {
  if (!value) return "";
  return value.startsWith("#") ? value : `#${value}`;
};

export const resolveNextHash = (fallbackHash = "") => {
  const params = new URLSearchParams(window.location.search);
  if (params.has("next")) {
    const raw = params.get("next") || "";
    if (!raw) return window.location.hash || fallbackHash;
    return normalizeHash(raw);
  }
  return window.location.hash || fallbackHash;
};

export const buildLoginRedirectUrl = (fallbackHash = "") => {
  if (isLocalHost()) return "/login.html";
  const nextHash = resolveNextHash(fallbackHash);
  const query = nextHash ? `?next=${encodeURIComponent(nextHash)}` : "";
  return `/login.html${query}`;
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
