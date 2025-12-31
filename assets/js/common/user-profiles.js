import {
  doc,
  getDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFirebase } from "./firebaseClient.js";
import { logger, once as logOnce } from "./app-logger.js";

const profileCache = new Map();
const profileRequests = new Map();
let avatarEventBound = false;
let nameIndex = null;
let nameIndexPromise = null;

const warnOnce = (key, message, err) => {
  logOnce(key, () => {
    if (err) logger.warn(message, err);
    else logger.warn(message);
  });
};

const normalizeName = (value) => (value || "").trim();
const normalizeNameKey = (value) => {
  if (!value) return "";
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const base = trimmed.split(" - ")[0].trim();
  return base
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
};

const resolveNameFromDoc = (data = {}) => {
  const direct =
    data.displayName ||
    data.nombreCompleto ||
    data.apellidoNombre ||
    data.fullName ||
    data.name ||
    data.nombre;
  if (direct) return direct;
  const lastName = data.apellido || data.lastName || "";
  const firstName = data.nombre || data.firstName || "";
  return `${lastName} ${firstName}`.trim();
};

const buildInitials = (name) => {
  if (!name) return "??";
  const clean = name.replace(/dr\.?/gi, "").trim();
  if (!clean) return "??";
  const parts = clean.split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0] || "");
  return letters.join("").toUpperCase();
};

const resolveAvatarUrlFromDoc = (data = {}) => {
  return data.avatarUrl || data.profilePhotoUrl || data.photoURL || "";
};

const normalizeUpdatedAt = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : 0;
};

const buildAvatarSrc = (url, updatedAt, forceBust = false) => {
  if (!url) return "";
  const stamp = updatedAt || (forceBust ? Date.now() : 0);
  if (!stamp) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${stamp}`;
};

const buildProfileFromDoc = (data = {}, fallbackName = "") => {
  const displayName = normalizeName(resolveNameFromDoc(data)) || fallbackName || "Usuario";
  const avatarUrl = resolveAvatarUrlFromDoc(data);
  const avatarUpdatedAt = normalizeUpdatedAt(data.avatarUpdatedAt);
  return {
    displayName,
    avatarUrl,
    avatarUpdatedAt,
    initials: buildInitials(displayName)
  };
};

const setUserProfileCache = (uid, profile) => {
  if (!uid) return;
  const current = profileCache.get(uid) || {};
  const merged = {
    ...current,
    ...profile
  };
  if (!merged.initials) {
    merged.initials = buildInitials(merged.displayName || current.displayName || "");
  }
  profileCache.set(uid, merged);
};

const buildNameIndex = async () => {
  if (nameIndex) return nameIndex;
  if (nameIndexPromise) return nameIndexPromise;
  nameIndexPromise = (async () => {
    const firebase = getFirebase();
    const resolvedDb = firebase?.db;
    if (!resolvedDb) {
      nameIndex = new Map();
      return nameIndex;
    }
    try {
      const snap = await getDocs(collection(resolvedDb, "usuarios"));
      const map = new Map();
      snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const candidates = new Set();
        if (data.displayName) candidates.add(data.displayName);
        if (data.nombreCompleto) candidates.add(data.nombreCompleto);
        if (data.apellidoNombre) candidates.add(data.apellidoNombre);
        if (data.fullName) candidates.add(data.fullName);
        if (data.name) candidates.add(data.name);
        if (data.nombre) candidates.add(data.nombre);
        if (data.apellido && data.nombre) {
          candidates.add(`${data.apellido} ${data.nombre}`.trim());
        }
        candidates.forEach((name) => {
          const key = normalizeNameKey(name);
          if (!key) return;
          if (!map.has(key)) {
            map.set(key, docSnap.id);
          }
        });
      });
      nameIndex = map;
      return map;
    } catch (err) {
      warnOnce("name-index", "No se pudo construir el indice de nombres.", err);
      nameIndex = new Map();
      return nameIndex;
    } finally {
      nameIndexPromise = null;
    }
  })();
  return nameIndexPromise;
};

const resolveUidForAuthor = async ({ uid, authorName } = {}) => {
  if (uid) return uid;
  const key = normalizeNameKey(authorName);
  if (!key) return null;
  const index = await buildNameIndex();
  return index.get(key) || null;
};

const getUserProfile = async (uid, { db, fallbackName } = {}) => {
  if (!uid) return buildProfileFromDoc({}, fallbackName);
  if (profileCache.has(uid)) return profileCache.get(uid);
  if (profileRequests.has(uid)) return profileRequests.get(uid);
  const promise = (async () => {
    const firebase = getFirebase();
    const resolvedDb = db || firebase?.db;
    if (!resolvedDb) return buildProfileFromDoc({}, fallbackName);
    try {
      const snap = await getDoc(doc(resolvedDb, "usuarios", uid));
      const data = snap.exists() ? snap.data() || {} : {};
      const profile = buildProfileFromDoc(data, fallbackName);
      profileCache.set(uid, profile);
      return profile;
    } catch (err) {
      warnOnce(`profile:${uid}`, "No se pudo leer el perfil del usuario.", err);
      return buildProfileFromDoc({}, fallbackName);
    } finally {
      profileRequests.delete(uid);
    }
  })();
  profileRequests.set(uid, promise);
  return promise;
};

const applyAvatarElement = (el, profile) => {
  if (!el) return;
  const nameFromData =
    el.dataset.dmAuthor ||
    el.dataset.authorName ||
    el.dataset.dmAvatarName ||
    el.dataset.avatarName ||
    "";
  const displayName = profile?.displayName || nameFromData || "Usuario";
  const initials = profile?.initials || buildInitials(displayName);
  const avatarUrl = profile?.avatarUrl || "";
  const avatarUpdatedAt = profile?.avatarUpdatedAt || 0;
  const img =
    el.matches("img") ? el : el.querySelector("[data-author-avatar], [data-avatar-img], [data-dm-avatar-img]");
  const fallback = el.querySelector("[data-avatar-fallback], [data-dm-avatar-fallback]");
  if (img) {
    if (avatarUrl) {
      img.src = buildAvatarSrc(avatarUrl, avatarUpdatedAt);
      img.hidden = false;
      img.alt = displayName;
    } else {
      img.hidden = true;
    }
  }
  if (fallback) {
    if (fallback.dataset.avatarFallback === "initials" || fallback.dataset.dmAvatarFallback === "initials") {
      fallback.textContent = initials;
    }
    fallback.hidden = Boolean(avatarUrl);
  }
  if (el.dataset) {
    if (avatarUrl) {
      el.dataset.hasAvatar = "1";
    } else {
      delete el.dataset.hasAvatar;
    }
  }
};

const hydrateAvatars = async (root = document) => {
  const nodes = Array.from(
    root.querySelectorAll("[data-author-uid], [data-dm-avatar-uid], [data-dm-uid], [data-dm-author]")
  );
  if (!nodes.length) return;
  const grouped = new Map();
  const unresolved = new Map();
  nodes.forEach((node) => {
    const uid = node.dataset.dmUid || node.dataset.authorUid || node.dataset.dmAvatarUid || "";
    if (uid) {
      if (!grouped.has(uid)) grouped.set(uid, []);
      grouped.get(uid).push(node);
      return;
    }
    const authorName =
      node.dataset.dmAuthor ||
      node.dataset.authorName ||
      node.dataset.dmAvatarName ||
      node.dataset.avatarName ||
      "";
    const key = normalizeNameKey(authorName);
    if (!key) {
      applyAvatarElement(node, buildProfileFromDoc({}, authorName));
      return;
    }
    if (!unresolved.has(key)) {
      unresolved.set(key, { name: authorName, nodes: [] });
    }
    unresolved.get(key).nodes.push(node);
  });
  if (unresolved.size) {
    const index = await buildNameIndex();
    unresolved.forEach((entry, key) => {
      const resolvedUid = index.get(key);
      if (resolvedUid) {
        if (!grouped.has(resolvedUid)) grouped.set(resolvedUid, []);
        grouped.get(resolvedUid).push(...entry.nodes);
      } else {
        entry.nodes.forEach((node) => applyAvatarElement(node, buildProfileFromDoc({}, entry.name)));
      }
    });
  }
  const entries = Array.from(grouped.entries());
  await Promise.all(
    entries.map(async ([uid, elements]) => {
      const fallbackName =
        elements[0]?.dataset.dmAuthor ||
        elements[0]?.dataset.authorName ||
        elements[0]?.dataset.dmAvatarName ||
        "";
      const profile = await getUserProfile(uid, { fallbackName });
      elements.forEach((el) => applyAvatarElement(el, profile));
    })
  );
};

const ensureAvatarEvent = () => {
  if (avatarEventBound || typeof window === "undefined") return;
  avatarEventBound = true;
  window.addEventListener("dm:avatar-updated", (event) => {
    const detail = event?.detail || {};
    const uid = detail.uid;
    if (!uid) return;
    const profile = {
      displayName: detail.displayName || detail.name || "",
      avatarUrl: detail.url || "",
      avatarUpdatedAt: detail.updatedAt || Date.now()
    };
    setUserProfileCache(uid, profile);
    hydrateAvatars().catch(() => {});
  });
};

ensureAvatarEvent();

export {
  buildInitials,
  normalizeNameKey,
  resolveNameFromDoc,
  resolveAvatarUrlFromDoc,
  normalizeUpdatedAt,
  buildAvatarSrc,
  buildProfileFromDoc,
  setUserProfileCache,
  resolveUidForAuthor,
  getUserProfile,
  applyAvatarElement,
  hydrateAvatars
};
