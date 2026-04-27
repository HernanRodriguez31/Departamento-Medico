import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFirebase } from "./firebaseClient.js";
import { logger, once as logOnce } from "./app-logger.js";
import { resolveDefaultAvatarUrl } from "./default-avatars.js?v=20260426-profile-avatars-1";

const profileCache = new Map();
const profileRequests = new Map();
const AUTHOR_LOOKUP_TTL_MS = 5 * 60 * 1000;
const AUTHOR_LOOKUP_FIELDS = [
  "displayName",
  "nombreCompleto",
  "apellidoNombre",
  "fullName",
  "name",
  "nombre"
];
let avatarEventBound = false;
const authorUidCache = new Map();
const authorUidRequests = new Map();

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

const resolveAvatarUrlFromDoc = (data = {}, identity = {}) => {
  const displayName = identity.name || resolveNameFromDoc(data);
  return (
    data.avatarUrl ||
    data.profilePhotoUrl ||
    data.photoURL ||
    data.defaultAvatarUrl ||
    resolveDefaultAvatarUrl({
      uid: identity.uid || data.uid || data.id || "",
      email: identity.email || data.email || data.correo || data.mail || "",
      name: displayName
    }) ||
    ""
  );
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

const resolveAvatarUpdatedAtFromDoc = (data = {}, avatarUrl = "") => {
  if (!avatarUrl) return 0;
  if (data.avatarUrl && avatarUrl === data.avatarUrl) return normalizeUpdatedAt(data.avatarUpdatedAt);
  if (data.profilePhotoUrl && avatarUrl === data.profilePhotoUrl) {
    return normalizeUpdatedAt(data.profilePhotoUpdatedAt || data.avatarUpdatedAt);
  }
  if (data.photoURL && avatarUrl === data.photoURL) {
    return normalizeUpdatedAt(data.photoUpdatedAt || data.avatarUpdatedAt);
  }
  if (data.defaultAvatarUrl && avatarUrl === data.defaultAvatarUrl) {
    return normalizeUpdatedAt(data.defaultAvatarUpdatedAt);
  }
  return 0;
};

const buildProfileFromDoc = (data = {}, fallbackName = "", identity = {}) => {
  const displayName = normalizeName(resolveNameFromDoc(data)) || fallbackName || "Usuario";
  const avatarUrl = resolveAvatarUrlFromDoc(data, {
    ...identity,
    name: identity.name || displayName
  });
  const avatarUpdatedAt = resolveAvatarUpdatedAtFromDoc(data, avatarUrl);
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

const getCachedAuthorUid = (key) => {
  const cached = authorUidCache.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.cachedAt > AUTHOR_LOOKUP_TTL_MS) {
    authorUidCache.delete(key);
    return undefined;
  }
  return cached.uid || null;
};

const setCachedAuthorUid = (key, uid) => {
  if (!key) return;
  authorUidCache.set(key, {
    uid: uid || null,
    cachedAt: Date.now()
  });
};

const findUidByExactAuthorName = async (resolvedDb, authorName) => {
  const rawName = normalizeName(String(authorName || "").split(" - ")[0]);
  if (!resolvedDb || !rawName) return null;
  const usersRef = collection(resolvedDb, "usuarios");
  for (const field of AUTHOR_LOOKUP_FIELDS) {
    try {
      const snap = await getDocs(query(usersRef, where(field, "==", rawName), limit(1)));
      if (!snap.empty) return snap.docs[0].id;
    } catch (err) {
      warnOnce(`author-lookup:${field}`, "No se pudo resolver autor por nombre.", err);
    }
  }
  // TODO: para resolver variantes con acentos/case sin enumerar usuarios, crear indice denormalizado o callable backend.
  return null;
};

const resolveUidForAuthor = async ({ uid, authorName } = {}) => {
  if (uid) return uid;
  const key = normalizeNameKey(authorName);
  if (!key) return null;
  const cached = getCachedAuthorUid(key);
  if (cached !== undefined) return cached;
  if (authorUidRequests.has(key)) return authorUidRequests.get(key);

  const promise = (async () => {
    const firebase = getFirebase();
    const resolvedDb = firebase?.db;
    if (!resolvedDb) return null;
    const resolvedUid = await findUidByExactAuthorName(resolvedDb, authorName);
    setCachedAuthorUid(key, resolvedUid);
    return resolvedUid;
  })().finally(() => {
    authorUidRequests.delete(key);
  });

  authorUidRequests.set(key, promise);
  return promise;
};

const getUserProfile = async (uid, { db, fallbackName } = {}) => {
  if (!uid) return buildProfileFromDoc({}, fallbackName);
  if (profileCache.has(uid)) return profileCache.get(uid);
  if (profileRequests.has(uid)) return profileRequests.get(uid);
  const promise = (async () => {
    const firebase = getFirebase();
    const resolvedDb = db || firebase?.db;
    if (!resolvedDb) return buildProfileFromDoc({}, fallbackName, { uid });
    try {
      const snap = await getDoc(doc(resolvedDb, "usuarios", uid));
      const data = snap.exists() ? snap.data() || {} : {};
      const profile = buildProfileFromDoc(data, fallbackName, { uid });
      profileCache.set(uid, profile);
      return profile;
    } catch (err) {
      warnOnce(`profile:${uid}`, "No se pudo leer el perfil del usuario.", err);
      return buildProfileFromDoc({}, fallbackName, { uid });
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
    await Promise.all(Array.from(unresolved.entries()).map(async ([key, entry]) => {
      const resolvedUid = await resolveUidForAuthor({ authorName: entry.name });
      if (resolvedUid) {
        if (!grouped.has(resolvedUid)) grouped.set(resolvedUid, []);
        grouped.get(resolvedUid).push(...entry.nodes);
      } else {
        entry.nodes.forEach((node) => applyAvatarElement(node, buildProfileFromDoc({}, entry.name)));
      }
    }));
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
  resolveAvatarUpdatedAtFromDoc,
  normalizeUpdatedAt,
  buildAvatarSrc,
  buildProfileFromDoc,
  setUserProfileCache,
  resolveUidForAuthor,
  getUserProfile,
  applyAvatarElement,
  hydrateAvatars
};
