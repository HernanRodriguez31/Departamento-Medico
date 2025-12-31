import { getFirebase } from "../../common/firebaseClient.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const CONVERSATIONS_COLLECTION = "dm_conversations";
const PROFILE_COLLECTION = "usuarios";
const MAX_CONVERSATIONS = 50;

const QUICK_ITEMS = [
  {
    id: "dm_group_chat",
    title: "Chat grupal",
    subtitle: "Sala comun del equipo medico",
    avatar: "CG",
    search: "chat grupal sala comun equipo medico"
  },
  {
    id: "dm_foro_general",
    title: "Foro general",
    subtitle: "Mensajes vinculados al foro",
    avatar: "FG",
    search: "foro general mensajes vinculados al foro"
  }
];

const normalize = (value) => String(value || "").toLowerCase();

const resolveValue = (obj, keys) => {
  for (const key of keys) {
    if (obj && obj[key]) return obj[key];
  }
  return "";
};

const resolveProfileName = (profile = {}, fallback = "Medico") => {
  const primary = resolveValue(profile, [
    "displayName",
    "nombreCompleto",
    "apellidoNombre",
    "fullName",
    "name",
    "nombre"
  ]);
  const last = resolveValue(profile, ["apellido", "lastName"]);
  const first = resolveValue(profile, ["nombre", "firstName"]);
  const combined = `${last} ${first}`.trim();
  return primary || combined || profile.email || fallback;
};

const toDate = (value) => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatClock = (date) => {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

const formatShortDate = (date) => {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
};

const formatTimestamp = (value) => {
  const date = toDate(value);
  if (!date) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return formatClock(date);
  }
  return formatShortDate(date);
};

const buildInitials = (name) => {
  const cleaned = String(name || "").replace(/[^a-zA-Z0-9 ]/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
};

export default function renderMessages(container) {
  if (!container) return;
  const { db, auth } = getFirebase();
  if (!db) {
    container.innerHTML = `
      <section class="view-header">
        <h1 class="view-title">Mensajes</h1>
        <p class="view-subtitle">No se pudo conectar con Firestore.</p>
      </section>
    `;
    return;
  }

  if (container._messagesCleanup) {
    container._messagesCleanup();
  }

  container.innerHTML = `
    <section class="view-header">
      <div class="view-header__top">
        <div>
          <h1 class="view-title">Mensajes</h1>
          <p class="view-subtitle">Conversaciones recientes y chat directo.</p>
        </div>
      </div>
    </section>
    <section class="messages-shell">
      <aside class="messages-panel">
        <label class="messages-search">
          <span class="messages-search__label">Buscar conversaciones</span>
          <input class="messages-search__input" type="search" placeholder="Buscar por nombre o mensaje" data-messages-search />
        </label>
        <div class="messages-status" data-messages-status></div>
        <div class="messages-section">
          <div class="messages-section__title">Accesos rapidos</div>
          <div class="messages-list messages-list--quick">
            ${QUICK_ITEMS.map((item) => `
            <button class="messages-item messages-item--special" type="button" data-conversation-id="${item.id}" data-special="${item.id}" data-title="${item.title}" data-subtitle="${item.subtitle}" data-search="${item.search}">
              <span class="messages-avatar messages-avatar--accent">${item.avatar}</span>
              <span class="messages-item__body">
                <span class="messages-item__name">${item.title}</span>
                <span class="messages-item__snippet">${item.subtitle}</span>
              </span>
            </button>
            `).join("")}
          </div>
        </div>
        <div class="messages-section">
          <div class="messages-section__title">Recientes</div>
          <div class="messages-list" data-messages-list></div>
        </div>
      </aside>
      <section class="messages-thread">
        <div class="messages-thread-toolbar">
          <button class="messages-back" type="button" data-messages-back aria-label="Volver">Volver</button>
          <div class="messages-thread-text">
            <div class="messages-thread-title" data-thread-title>Mensajes</div>
            <div class="messages-thread-subtitle" data-thread-subtitle>Selecciona una conversacion.</div>
          </div>
        </div>
        <div class="messages-thread-body">
          <div class="messages-empty">
            <h3>Elegi una conversacion</h3>
            <p>Selecciona un chat para ver mensajes recientes.</p>
          </div>
        </div>
        <div class="messages-chat" data-chat-mount></div>
      </section>
    </section>
  `;

  const shell = container.querySelector(".messages-shell");
  const listEl = container.querySelector("[data-messages-list]");
  const statusEl = container.querySelector("[data-messages-status]");
  const searchInput = container.querySelector("[data-messages-search]");
  const thread = container.querySelector(".messages-thread");
  const threadTitle = container.querySelector("[data-thread-title]");
  const threadSubtitle = container.querySelector("[data-thread-subtitle]");
  const chatMount = container.querySelector("[data-chat-mount]");
  const backBtn = container.querySelector("[data-messages-back]");
  const quickButtons = Array.from(container.querySelectorAll("[data-special]"));

  let currentUser = null;
  let activeConversationId = null;
  let activePeerUid = null;
  let chatMounted = false;
  let chatLoadPromise = null;

  const nameCache = new Map();
  const pendingNames = new Set();

  const setStatus = (message = "", tone = "info") => {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  };

  const ensureChatApi = async () => {
    if (window.BrisaChat) return window.BrisaChat;
    if (!chatLoadPromise) {
      chatLoadPromise = import("/js/chat.js");
    }
    await chatLoadPromise;
    return window.BrisaChat;
  };

  const mountChat = async () => {
    if (chatMounted) return;
    try {
      const api = await ensureChatApi();
      if (!container.isConnected) return;
      if (api && chatMount) {
        api.mount(chatMount);
        chatMounted = true;
      }
    } catch (e) {
      setStatus("No se pudo cargar el chat.", "error");
    }
  };

  const isConversationId = (value) => typeof value === "string" && value.includes("__");

  const getConversationId = (uid1, uid2) => {
    if (!uid1 || !uid2) return "";
    return [uid1, uid2].sort().join("__");
  };

  const setThreadActive = (isActive) => {
    if (shell) shell.classList.toggle("is-chat-open", isActive);
    if (thread) thread.classList.toggle("is-active", isActive);
  };

  const updateThreadHeader = (title, subtitle) => {
    if (threadTitle) threadTitle.textContent = title || "Mensajes";
    if (threadSubtitle) threadSubtitle.textContent = subtitle || "";
  };

  const openPendingConversation = async () => {
    const pending = window.__brisaOpenConversation;
    if (!pending || !currentUser) return;
    window.__brisaOpenConversation = null;
    const pendingId = isConversationId(pending) ? pending : getConversationId(currentUser.uid, pending);
    activeConversationId = pendingId || pending;
    activePeerUid = pending;
    setActiveItem(activeConversationId);
    const quick = QUICK_ITEMS.find((item) => item.id === pending);
    if (quick) {
      updateThreadHeader(quick.title, quick.subtitle);
    } else {
      updateThreadHeader("Conversacion", "Chat directo");
    }
    setThreadActive(true);
    await mountChat();
    const api = await ensureChatApi();
    if (!container.isConnected || !api) return;
    api.openConversation(pending);
  };

  const setActiveItem = (conversationId) => {
    const items = container.querySelectorAll(".messages-item");
    items.forEach((item) => {
      item.classList.toggle("is-active", item.dataset.conversationId === conversationId);
    });
  };

  const updateUnreadBadge = (conversationId, unread) => {
    const item = container.querySelector(`[data-conversation-id="${conversationId}"]`);
    if (!item) return;
    const badge = item.querySelector(".messages-item__badge");
    if (!badge) return;
    if (unread > 0) {
      badge.textContent = String(unread);
      badge.classList.remove("is-hidden");
      item.classList.add("is-unread");
    } else {
      badge.textContent = "";
      badge.classList.add("is-hidden");
      item.classList.remove("is-unread");
    }
  };

  const applySearch = () => {
    if (!searchInput) return;
    const queryValue = normalize(searchInput.value);
    const items = Array.from(container.querySelectorAll(".messages-item"));
    let visibleCount = 0;
    items.forEach((item) => {
      const haystack = item.dataset.search || "";
      const match = !queryValue || haystack.includes(queryValue);
      item.hidden = !match;
      if (match) visibleCount += 1;
    });
    if (queryValue) {
      setStatus(visibleCount ? "" : "No hay coincidencias.", "info");
    }
  };

  const resolvePeerUid = (participants = []) => {
    if (!Array.isArray(participants)) return "";
    const other = participants.find((uid) => uid && uid !== currentUser?.uid);
    return other || participants[0] || "";
  };

  const updateItemsForPeer = (uid, name) => {
    const items = Array.from(container.querySelectorAll(`[data-peer-uid="${uid}"]`));
    items.forEach((item) => {
      const nameEl = item.querySelector(".messages-item__name");
      const avatarEl = item.querySelector(".messages-avatar");
      const snippet = item.dataset.snippet || "";
      if (nameEl) nameEl.textContent = name;
      if (avatarEl) avatarEl.textContent = buildInitials(name);
      item.dataset.search = normalize(`${name} ${snippet}`);
    });
    if (activePeerUid === uid) {
      updateThreadHeader(name, threadSubtitle?.textContent || "");
    }
  };

  const hydratePeerName = async (uid) => {
    if (!uid || nameCache.has(uid) || pendingNames.has(uid)) return;
    pendingNames.add(uid);
    try {
      const snap = await getDoc(doc(db, PROFILE_COLLECTION, uid));
      if (!snap.exists()) return;
      const name = resolveProfileName(snap.data(), "Medico");
      nameCache.set(uid, name);
      updateItemsForPeer(uid, name);
    } catch (e) {
      // ignore
    } finally {
      pendingNames.delete(uid);
    }
  };

  const createConversationItem = (conversation) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "messages-item";
    item.dataset.conversationId = conversation.id;
    item.dataset.peerUid = conversation.peerUid;
    item.dataset.snippet = normalize(conversation.snippet);
    item.dataset.search = normalize(`${conversation.name} ${conversation.snippet}`);

    if (conversation.unread > 0) {
      item.classList.add("is-unread");
    }
    if (conversation.id === activeConversationId) {
      item.classList.add("is-active");
    }

    const avatar = document.createElement("span");
    avatar.className = "messages-avatar";
    avatar.textContent = buildInitials(conversation.name);

    const body = document.createElement("span");
    body.className = "messages-item__body";

    const nameEl = document.createElement("span");
    nameEl.className = "messages-item__name";
    nameEl.textContent = conversation.name;

    const snippetEl = document.createElement("span");
    snippetEl.className = "messages-item__snippet";
    snippetEl.textContent = conversation.snippet;

    body.append(nameEl, snippetEl);

    const meta = document.createElement("span");
    meta.className = "messages-item__meta";

    const timeEl = document.createElement("span");
    timeEl.className = "messages-item__time";
    timeEl.textContent = conversation.timeLabel || "";

    const badge = document.createElement("span");
    badge.className = "messages-item__badge";
    if (conversation.unread > 0) {
      badge.textContent = String(conversation.unread);
    } else {
      badge.classList.add("is-hidden");
    }

    meta.append(timeEl, badge);
    item.append(avatar, body, meta);

    item.addEventListener("click", async () => {
      if (!currentUser) {
        setStatus("Inicia sesion para abrir chats.", "warn");
        return;
      }
      activeConversationId = conversation.id;
      activePeerUid = conversation.peerUid;
      setActiveItem(conversation.id);
      updateThreadHeader(conversation.name, conversation.subtitle || "Conversacion directa");
      setThreadActive(true);
      updateUnreadBadge(conversation.id, 0);
      await mountChat();
      const api = await ensureChatApi();
      if (!container.isConnected || !api) return;
      api.openConversation(conversation.id);
    });

    return item;
  };

  const renderConversations = (docs) => {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!docs.length) {
      const empty = document.createElement("div");
      empty.className = "messages-empty-list";
      empty.textContent = "No hay conversaciones recientes.";
      listEl.appendChild(empty);
      applySearch();
      return;
    }
    docs.forEach((data) => {
      const peerUid = resolvePeerUid(data.participants);
      if (!peerUid) return;
      const name = nameCache.get(peerUid) || "Medico";
      const lastText = String(data.lastMessageText || "Sin mensajes");
      const isMe = data.lastSenderUid === currentUser?.uid;
      const snippet = isMe ? `Vos: ${lastText}` : lastText;
      const conversation = {
        id: data.id,
        peerUid,
        name,
        snippet,
        subtitle: "Conversacion directa",
        timeLabel: formatTimestamp(data.lastMessageAt || data.updatedAt),
        unread: Number((data.unreadCountByUid || {})[currentUser?.uid] || 0)
      };
      const item = createConversationItem(conversation);
      listEl.appendChild(item);
      hydratePeerName(peerUid);
    });
    applySearch();
  };

  const subscribeConversations = (uid) => {
    if (container._messagesConvUnsub) container._messagesConvUnsub();
    const convQuery = query(
      collection(db, CONVERSATIONS_COLLECTION),
      where("participants", "array-contains", uid),
      orderBy("updatedAt", "desc"),
      limit(MAX_CONVERSATIONS)
    );
    container._messagesConvUnsub = onSnapshot(
      convQuery,
      (snapshot) => {
        if (!container.isConnected) return;
        const conversations = snapshot.docs.map((docSnap) => ({
          ...docSnap.data(),
          id: docSnap.id
        }));
        setStatus(conversations.length ? "" : "No hay conversaciones recientes.", "info");
        renderConversations(conversations);
      },
      () => {
        setStatus("No se pudieron cargar las conversaciones.", "error");
      }
    );
  };

  const handleAuthChange = (user) => {
    currentUser = user || null;
    activeConversationId = null;
    activePeerUid = null;
    setActiveItem(null);
    setThreadActive(false);
    updateThreadHeader("Mensajes", "Selecciona una conversacion.");
    if (!currentUser) {
      if (listEl) listEl.innerHTML = "";
      setStatus("Inicia sesion para ver tus conversaciones.", "warn");
      return;
    }
    setStatus("Cargando conversaciones...", "info");
    subscribeConversations(currentUser.uid);
    openPendingConversation();
  };

  if (auth) {
    container._messagesAuthUnsub = onAuthStateChanged(auth, handleAuthChange);
  } else {
    handleAuthChange(null);
  }

  searchInput?.addEventListener("input", applySearch);

  quickButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!currentUser) {
        setStatus("Inicia sesion para abrir chats.", "warn");
        return;
      }
      const title = btn.dataset.title || "Mensajes";
      const subtitle = btn.dataset.subtitle || "";
      const convId = btn.dataset.special || btn.dataset.conversationId;
      if (!convId) return;
      activeConversationId = convId;
      activePeerUid = convId;
      setActiveItem(convId);
      updateThreadHeader(title, subtitle);
      setThreadActive(true);
      await mountChat();
      const api = await ensureChatApi();
      if (!container.isConnected || !api) return;
      api.openConversation(convId);
    });
  });

  backBtn?.addEventListener("click", () => {
    setThreadActive(false);
  });

  mountChat();

  const previousHandler = container._messagesHashHandler;
  if (previousHandler) {
    window.removeEventListener("hashchange", previousHandler);
  }

  const onHashChange = () => {
    const isMessages = window.location.hash.startsWith("#/messages");
    if (!container.isConnected || !isMessages) {
      if (container._messagesAuthUnsub) {
        container._messagesAuthUnsub();
        container._messagesAuthUnsub = null;
      }
      if (container._messagesConvUnsub) {
        container._messagesConvUnsub();
        container._messagesConvUnsub = null;
      }
      if (window.BrisaChat?.unmount) {
        window.BrisaChat.unmount();
      }
      window.removeEventListener("hashchange", onHashChange);
    }
  };

  container._messagesHashHandler = onHashChange;
  window.addEventListener("hashchange", onHashChange);

  container._messagesCleanup = () => {
    if (container._messagesAuthUnsub) {
      container._messagesAuthUnsub();
      container._messagesAuthUnsub = null;
    }
    if (container._messagesConvUnsub) {
      container._messagesConvUnsub();
      container._messagesConvUnsub = null;
    }
    if (window.BrisaChat?.unmount) {
      window.BrisaChat.unmount();
    }
  };
}
