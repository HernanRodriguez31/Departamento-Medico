// Lightweight in-app notifications module (ESM)
// Depende de Firebase modular ya cargado en la página.

import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
  writeBatch,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirebase } from "./firebaseClient.js";

export const TYPE_ICONS = {
  chat_dm: "message-square",
  chat_group: "users",
  foro: "messages-square",
  galeria_comment: "message-circle",
  galeria_like: "heart"
};

const ensureApp = () => {
  return getFirebase().app;
};

export const formatRelative = (date) => {
  if (!date) return "";
  const now = new Date();
  const diff = (now - date) / 1000;
  if (diff < 60) return "justo ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return date.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const qs = (sel) => document.querySelector(sel);

const mountUI = () => {
  const btn = document.getElementById("dm-notif-btn");
  const dropdown = document.getElementById("dm-notif-dropdown");
  if (!btn || !dropdown) return null;
  return {
    btn,
    badge: document.getElementById("dm-notif-badge"),
    msgIndicator: document.getElementById("dm-msg-indicator"),
    msgBadge: document.getElementById("dm-msg-badge"),
    dropdown,
    backdrop: document.getElementById("dm-notif-backdrop"),
    list: document.getElementById("dm-notif-list"),
    markAll: document.getElementById("dm-notif-markall")
  };
};

const toggleDropdown = (ui, open) => {
  if (!ui) return;
  const show = open ?? ui.dropdown.hasAttribute("hidden");
  ui.dropdown.toggleAttribute("hidden", !show);
  if (ui.backdrop) {
    ui.backdrop.toggleAttribute("hidden", !show);
  }
  ui.btn.setAttribute("aria-expanded", String(show));
  dropdownOpen = show;
  if (show) {
    document.addEventListener("click", ui._outside);
    document.addEventListener("keydown", ui._esc);
    ui.btn.classList.remove("has-unread");
  } else {
    document.removeEventListener("click", ui._outside);
    document.removeEventListener("keydown", ui._esc);
  }
};

const updateMobileMessageBadge = (items = []) => {
  if (!uiRef?.msgBadge) return;
  const unread = items.filter((n) => !n.read);
  // Mobile badge shows unique senders with unread chat/foro notifications.
  const relevant = unread.filter((n) => {
    const type = String(n.type || "");
    return type.startsWith("chat") || type === "foro";
  });
  const senders = new Set();
  relevant.forEach((n) => {
    const key = n.fromUid || n.peerUid || n.fromName || n.id;
    if (key) senders.add(key);
  });
  uiRef.msgBadge.textContent = String(senders.size);
};

const renderList = (ui, items) => {
  if (!ui?.list) return;
  ui.list.innerHTML = "";
  const unread = items.filter((n) => !n.read);
  const rest = items.filter((n) => n.read);
  const ordered = [...unread, ...rest].slice(0, 12);
  if (!ordered.length) {
    const empty = document.createElement("div");
    empty.className = "dm-notif-item";
    empty.textContent = "Sin notificaciones recientes.";
    ui.list.appendChild(empty);
    return;
  }
  ordered.forEach((n) => {
    const item = document.createElement("div");
    item.className = "dm-notif-item" + (n.read ? "" : " unread");
    item.dataset.id = n.id;
    const iconWrap = document.createElement("div");
    iconWrap.className = "dm-notif-icon";
    const icon = document.createElement("i");
    icon.dataset.lucide = TYPE_ICONS[n.type] || "bell";
    iconWrap.appendChild(icon);
    const content = document.createElement("div");
    content.className = "dm-notif-content";
    const title = document.createElement("div");
    title.className = "dm-notif-title";
    title.textContent = n.title || "Notificación";
    const meta = document.createElement("div");
    meta.className = "dm-notif-meta";
    const from = document.createElement("span");
    from.textContent = n.fromName || "Sistema";
    const time = document.createElement("span");
    time.textContent = formatRelative(n.createdAt?.toDate ? n.createdAt.toDate() : null);
    meta.append(from, " · ", time);
    content.append(title, meta);
    if (n.body) {
      const body = document.createElement("div");
      body.className = "dm-notif-body";
      body.textContent = n.body;
      content.appendChild(body);
    }
    item.append(iconWrap, content);
    item.addEventListener("click", async () => {
      await markRead(n.id);
      toggleDropdown(ui, false);
      if (n.peerUid) {
        const ensureChat = window.__ensureChatLoaded;
        if (typeof ensureChat === "function") {
          await ensureChat();
        }
      }
      if (n.peerUid && window.BrisaChat?.openConversation) {
        window.BrisaChat.openConversation(n.peerUid);
      } else if (n.route) {
        window.location.href = n.route;
      } else {
        window.location.hash = "#chat";
      }
    });
    ui.list.appendChild(item);
  });
  if (window.lucide) window.lucide.createIcons();
};

let uiRef = null;
let unsub = null;
let dbRef = null;
let authRef = null;
const notiCache = new Map();
let dropdownOpen = false;
const lastToastAtByDocId = new Map();
const autoReadInFlight = new Set();

const shouldAutoReadForChatNotification = (notif) => {
  try {
    if (!notif || notif.read === true) return false;
    const isChat = notif.type && String(notif.type).startsWith("chat");
    if (!isChat) return false;
    if (document.hidden) return false;
    const visFn = window.__brisaChatIsConversationVisible;
    if (typeof visFn === "function" && notif.entityId) return visFn(notif.entityId) === true;
    return false;
  } catch (e) {
    return false;
  }
};

const markReadWithDb = async (db, id) => {
  if (!db || !id) return;
  try {
    await updateDoc(doc(db, "notifications", id), { read: true, readAt: serverTimestamp() });
  } catch (e) {
    console.error("Error marcando notificación como leída", e);
  }
};

const markAllReadWithDb = async (db, ids = []) => {
  if (!db || !ids.length) return;
  try {
    const batch = writeBatch(db);
    ids.forEach((id) => batch.update(doc(db, "notifications", id), { read: true, readAt: serverTimestamp() }));
    await batch.commit();
  } catch (e) {
    console.error("Error marcando todas como leídas", e);
  }
};

export const markNotificationRead = (db, id) => markReadWithDb(db, id);
export const markAllNotificationsRead = (db, ids = []) => markAllReadWithDb(db, ids);

export const subscribeNotifications = ({ db, uid, max = 50, onChange, onError }) => {
  if (!db || !uid) return () => {};
  const q = query(
    collection(db, "notifications"),
    where("toUid", "==", uid),
    orderBy("createdAt", "desc"),
    limit(max)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (typeof onChange === "function") {
        onChange(items, snap);
      }
    },
    onError
  );
};

const markRead = async (id) => {
  if (!dbRef || !id) return;
  await markReadWithDb(dbRef, id);
};

const markAllRead = async (ids = []) => {
  if (!dbRef || !ids.length) return;
  await markAllReadWithDb(dbRef, ids);
};

export const createNotification = async (payload = {}) => {
  const app = ensureApp();
  if (!app) return;
  const db = getFirestore(app);
  const auth = getAuth(app);
  const user = auth.currentUser;
  if (!user) return;
  const {
    toUid,
    fromUid = user.uid,
    fromName = user.displayName || user.email || "Usuario",
    type,
    entityId = "",
    route = "",
    title = "Notificación",
    body = ""
  } = payload;
  if (!toUid || toUid === fromUid) return;
  if (!["chat_dm", "chat_group", "foro", "galeria_comment", "galeria_like"].includes(type)) return;
  try {
    await addDoc(collection(db, "notifications"), {
      toUid,
      fromUid,
      fromName,
      type,
      entityId,
      route,
      title,
      body,
      createdAt: serverTimestamp(),
      read: false,
      readAt: null
    });
  } catch (e) {
    console.error("Error creando notificación", e);
  }
};

const bodySnippet = (text = "") => {
  if (!text) return "";
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
};

export const upsertNotification = async (payload = {}) => {
  const app = ensureApp();
  if (!app) return;
  const db = getFirestore(app);
  const auth = getAuth(app);
  const user = auth.currentUser;
  if (!user) return;
  const {
    toUid,
    fromUid = user.uid,
    fromName = user.displayName || user.email || "Usuario",
    type,
    entityId = "",
    route = "",
    title = "Notificación",
    body = "",
    peerUid = "",
    docId,
    read,
    readAt
  } = payload;
  if (!toUid || toUid === fromUid) return;
  if (!["chat_dm", "chat_group", "foro", "galeria_comment", "galeria_like"].includes(type)) return;
  const id = docId || `notif__${type}__${toUid}__${entityId || "generic"}`;
  try {
    await setDoc(
      doc(db, "notifications", id),
      {
        toUid,
        fromUid,
        fromName,
        type,
        entityId,
        route,
        title,
        body: bodySnippet(body),
        peerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        read: read === true,
        readAt: read === true ? (readAt || serverTimestamp()) : null
      },
      { merge: true }
    );
  } catch (e) {
    console.error("Error upsert notificación", e);
  }
};

export function initNotificationsUI() {
  const app = ensureApp();
  if (!app) return;
  const auth = getAuth(app);
  const db = getFirestore(app);
  authRef = auth;
  dbRef = db;
  uiRef = mountUI();
  if (!uiRef) return;

  uiRef._outside = (e) => {
    if (!uiRef?.dropdown || uiRef.dropdown.hasAttribute("hidden")) return;
    if (uiRef.dropdown.contains(e.target) || uiRef.btn.contains(e.target)) return;
    toggleDropdown(uiRef, false);
  };
  uiRef._esc = (e) => {
    if (e.key === "Escape") toggleDropdown(uiRef, false);
  };
  uiRef.backdrop?.addEventListener("click", () => toggleDropdown(uiRef, false));

  uiRef.btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const willOpen = uiRef.dropdown.hasAttribute("hidden");
    toggleDropdown(uiRef, willOpen);
    if (willOpen && uiRef.list && uiRef.list.children.length) {
      uiRef.btn.classList.remove("has-unread");
    }
  });

  uiRef.markAll?.addEventListener("click", async () => {
    const unreadIds = Array.from(notiCache.values()).filter((n) => !n.read).map((n) => n.id);
    await markAllRead(unreadIds);
  });

  onAuthStateChanged(auth, (user) => {
    if (unsub) unsub();
    notiCache.clear();
    if (!user) {
      uiRef.btn.style.display = "none";
      if (uiRef.msgBadge) uiRef.msgBadge.textContent = "0";
      uiRef.dropdown.setAttribute("hidden", "");
      return;
    }
    uiRef.btn.style.display = "inline-flex";
    const q = query(
      collection(db, "notifications"),
      where("toUid", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(25)
    );
    unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        items.forEach((n) => notiCache.set(n.id, n));
        const unreadModules = new Set(items.filter((n) => !n.read).map((n) => n.type));
        // Badge: 1 si hay cualquier pendiente, si no 0.
        const badgeVal = unreadModules.size > 0 ? 1 : 0;
        if (uiRef.badge) {
          if (badgeVal === 0) {
            uiRef.badge.hidden = true;
          } else {
            uiRef.badge.hidden = false;
            uiRef.badge.textContent = "1";
          }
        }
        if (badgeVal > 0) uiRef.btn.classList.add("has-unread");
        else uiRef.btn.classList.remove("has-unread");
        renderList(uiRef, items);
        updateMobileMessageBadge(items);
        const cooldown = 1500;
        snap.docChanges().forEach((c) => {
          if (c.type !== "added" && c.type !== "modified") return;
          const data = c.doc.data();
          if (data.read || dropdownOpen) return;
          // Auto read defensivo si está viendo la conversación
          if (!autoReadInFlight.has(c.doc.id) && shouldAutoReadForChatNotification(data)) {
            autoReadInFlight.add(c.doc.id);
            markRead(c.doc.id).finally(() => autoReadInFlight.delete(c.doc.id));
            return;
          }
          const ts =
            data.updatedAt?.toMillis?.() ??
            data.createdAt?.toMillis?.() ??
            Date.now();
          const last = lastToastAtByDocId.get(c.doc.id) || 0;
          if (ts <= last + cooldown) return;
          lastToastAtByDocId.set(c.doc.id, ts);
          showToast({ id: c.doc.id, ...data });
        });
      },
      (err) => console.error("Error suscribiendo notificaciones", err)
    );
  });
}

// Autoinit if button exists
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNotificationsUI);
} else {
  initNotificationsUI();
}

window.BrisaNotifications = {
  init: initNotificationsUI,
  create: createNotification,
  upsert: upsertNotification
};
// Toast helper
const ensureToast = () => {
  let toast = document.getElementById("dm-notif-toast");
  if (toast) return toast;
  toast = document.createElement("div");
  toast.id = "dm-notif-toast";
  toast.className = "dm-notif-toast";
  document.body.appendChild(toast);
  return toast;
};

const showToast = (notif) => {
  const ui = uiRef;
  if (!ui || !notif) return;
  const toast = ensureToast();
  toast.innerHTML = "";
  const icon = document.createElement("span");
  icon.className = "dm-notif-toast__icon";
  icon.textContent = "🔔";
  const body = document.createElement("div");
  body.className = "dm-notif-toast__body";
  const title = document.createElement("div");
  title.className = "dm-notif-toast__title";
  title.textContent = notif.title || "Nueva notificación";
  const meta = document.createElement("div");
  meta.className = "dm-notif-toast__meta";
  meta.textContent = notif.fromName ? `De ${notif.fromName}` : "";
  body.append(title, meta);
  toast.append(icon, body);
  toast.onclick = async () => {
    await markRead(notif.id);
    if (notif.peerUid && window.BrisaChat?.openConversation) {
      window.BrisaChat.openConversation(notif.peerUid);
    } else if (notif.route) {
      window.location.href = notif.route;
    } else {
      window.location.hash = "#chat";
    }
  };
  toast.classList.add("is-visible");
  setTimeout(() => toast.classList.remove("is-visible"), 4000);
};
