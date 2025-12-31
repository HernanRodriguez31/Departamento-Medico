import { getFirebase } from "../../common/firebaseClient.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  formatRelative,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeNotifications
} from "../../common/notifications.js";

const TYPE_BADGES = {
  chat_dm: "DM",
  chat_group: "GR",
  foro: "FO",
  galeria_comment: "CO",
  galeria_like: "LI",
  post: "PO",
  group: "GR"
};

const normalize = (value) => String(value || "").toLowerCase();

const resolveDate = (value) => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatTime = (value) => {
  const date = resolveDate(value);
  if (!date) return "";
  return formatRelative(date);
};

const resolveTitle = (notif) => {
  if (notif.title) return notif.title;
  if (notif.type === "chat_dm") return "Nuevo mensaje";
  if (notif.type === "chat_group") return "Nuevo mensaje grupal";
  if (notif.type === "foro") return "Nueva actividad";
  if (notif.type === "galeria_like") return "Nuevo like";
  if (notif.type === "galeria_comment") return "Nuevo comentario";
  return "Notificacion";
};

const resolveAvatar = (notif) => {
  const label = TYPE_BADGES[notif.type] || "NT";
  return label;
};

const resolveFrom = (notif) => {
  return notif.fromName || "Sistema";
};

const resolveBody = (notif) => {
  if (notif.body) return notif.body;
  if (notif.type && notif.type.startsWith("chat")) return "Abrir conversacion";
  return "";
};

const buildNotificationItem = ({ notif, onOpen }) => {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "notification-item" + (notif.read ? "" : " is-unread");
  item.dataset.id = notif.id;
  item.dataset.search = normalize(`${resolveTitle(notif)} ${resolveBody(notif)} ${resolveFrom(notif)}`);

  const avatar = document.createElement("span");
  avatar.className = "notification-avatar" + (notif.read ? "" : " notification-avatar--accent");
  avatar.textContent = resolveAvatar(notif);

  const content = document.createElement("div");
  content.className = "notification-content";

  const title = document.createElement("div");
  title.className = "notification-title";
  title.textContent = resolveTitle(notif);

  const body = document.createElement("div");
  body.className = "notification-body";
  body.textContent = resolveBody(notif);

  const meta = document.createElement("div");
  meta.className = "notification-meta";
  const from = document.createElement("span");
  from.textContent = resolveFrom(notif);
  const time = document.createElement("span");
  time.className = "notification-time";
  time.textContent = formatTime(notif.createdAt || notif.updatedAt);
  meta.append(from, " - ", time);

  content.append(title, meta);
  if (body.textContent) content.appendChild(body);

  item.append(avatar, content, document.createElement("span"));
  item.addEventListener("click", () => onOpen(notif));
  return item;
};

export default function renderNotifications(container) {
  if (!container) return;
  const { db, auth } = getFirebase();
  if (!db) {
    container.innerHTML = `
      <section class="view-header">
        <h1 class="view-title">Notificaciones</h1>
        <p class="view-subtitle">No se pudo conectar con Firestore.</p>
      </section>
    `;
    return;
  }

  if (container._notificationsCleanup) {
    container._notificationsCleanup();
  }

  container.innerHTML = `
    <section class="view-header">
      <div class="view-header__top">
        <div>
          <h1 class="view-title">Notificaciones</h1>
          <p class="view-subtitle">Actualizaciones recientes de la actividad.</p>
        </div>
        <div class="view-header__actions">
          <button class="notifications-markall notifications-markall--primary" type="button" data-markall>Marcar todo como leido</button>
        </div>
      </div>
    </section>
    <section class="notifications-shell">
      <div class="notifications-toolbar">
        <div class="notifications-filters" role="tablist" aria-label="Filtros de notificaciones">
          <button class="notifications-filter is-active" type="button" data-filter="unread" role="tab" aria-selected="true">No leidas</button>
          <button class="notifications-filter" type="button" data-filter="all" role="tab" aria-selected="false">Todas</button>
        </div>
        <div class="notifications-status" data-status></div>
      </div>
      <div class="notifications-list" data-list></div>
    </section>
  `;

  const listEl = container.querySelector("[data-list]");
  const statusEl = container.querySelector("[data-status]");
  const markAllBtn = container.querySelector("[data-markall]");
  const filterButtons = Array.from(container.querySelectorAll("[data-filter]"));

  let currentUser = null;
  let items = [];
  let activeFilter = "unread";

  const setStatus = (message = "", tone = "info") => {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  };

  const updateFiltersUI = () => {
    const unreadCount = items.filter((n) => !n.read).length;
    filterButtons.forEach((btn) => {
      const isActive = btn.dataset.filter === activeFilter;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    const unreadBtn = filterButtons.find((btn) => btn.dataset.filter === "unread");
    const allBtn = filterButtons.find((btn) => btn.dataset.filter === "all");
    if (unreadBtn) unreadBtn.textContent = unreadCount ? `No leidas (${unreadCount})` : "No leidas";
    if (allBtn) allBtn.textContent = items.length ? `Todas (${items.length})` : "Todas";
    if (markAllBtn) markAllBtn.disabled = unreadCount === 0;
  };

  const applyFilter = () => {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "notification-empty";
      empty.textContent = "No hay notificaciones todavia.";
      listEl.appendChild(empty);
      return;
    }

    const filtered = activeFilter === "unread" ? items.filter((n) => !n.read) : items;
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "notification-empty";
      empty.textContent = "No hay notificaciones sin leer.";
      listEl.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach((notif) => {
      fragment.appendChild(
        buildNotificationItem({
          notif,
          onOpen: async (selected) => {
            if (!currentUser) {
              setStatus("Inicia sesion para ver notificaciones.", "warn");
              return;
            }
            if (!selected.read) {
              selected.read = true;
              markNotificationRead(db, selected.id);
              updateFiltersUI();
              applyFilter();
            }
            navigateToResource(selected);
          }
        })
      );
    });
    listEl.appendChild(fragment);
  };

  const navigateToResource = (notif) => {
    if (!notif) return;
    if (notif.type && notif.type.startsWith("chat")) {
      const target = notif.entityId || notif.peerUid;
      if (target) window.__brisaOpenConversation = target;
      window.location.hash = "#/messages";
      return;
    }

    if (notif.type === "foro") {
      if (notif.entityId) {
        window.location.hash = `#/groups/${encodeURIComponent(notif.entityId)}`;
      } else {
        window.location.hash = "#/groups";
      }
      return;
    }

    if (notif.type === "group" || notif.type === "committee") {
      if (notif.entityId) {
        window.location.hash = `#/groups/${encodeURIComponent(notif.entityId)}`;
      } else {
        window.location.hash = "#/groups";
      }
      return;
    }

    if (notif.type && (notif.type.startsWith("galeria") || notif.type === "post")) {
      if (notif.entityId) window.__brisaFocusPostId = notif.entityId;
      window.location.hash = "#/feed";
      return;
    }

    if (notif.route) {
      if (notif.route.startsWith("#/")) {
        window.location.hash = notif.route;
      } else {
        window.location.href = notif.route;
      }
      return;
    }

    window.location.hash = "#/notifications";
  };

  const subscribe = (uid) => {
    if (container._notificationsUnsub) container._notificationsUnsub();
    container._notificationsUnsub = subscribeNotifications({
      db,
      uid,
      max: 60,
      onChange: (next) => {
        items = next;
        updateFiltersUI();
        applyFilter();
        setStatus(items.length ? "" : "No hay notificaciones recientes.", "info");
      },
      onError: () => {
        setStatus("No se pudieron cargar las notificaciones.", "error");
      }
    });
  };

  const handleAuthChange = (user) => {
    currentUser = user || null;
    items = [];
    updateFiltersUI();
    applyFilter();
    if (!currentUser) {
      setStatus("Inicia sesion para ver notificaciones.", "warn");
      return;
    }
    setStatus("Cargando notificaciones...", "info");
    subscribe(currentUser.uid);
  };

  if (auth) {
    container._notificationsAuthUnsub = onAuthStateChanged(auth, handleAuthChange);
  } else {
    handleAuthChange(null);
  }

  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter || "unread";
      updateFiltersUI();
      applyFilter();
    });
  });

  markAllBtn?.addEventListener("click", async () => {
    if (!currentUser) return;
    const unreadIds = items.filter((n) => !n.read).map((n) => n.id);
    if (!unreadIds.length) return;
    items = items.map((notif) => (notif.read ? notif : { ...notif, read: true }));
    updateFiltersUI();
    applyFilter();
    await markAllNotificationsRead(db, unreadIds);
  });

  const previousHandler = container._notificationsHashHandler;
  if (previousHandler) {
    window.removeEventListener("hashchange", previousHandler);
  }

  const onHashChange = () => {
    const isNotifications = window.location.hash.startsWith("#/notifications");
    if (!container.isConnected || !isNotifications) {
      if (container._notificationsAuthUnsub) {
        container._notificationsAuthUnsub();
        container._notificationsAuthUnsub = null;
      }
      if (container._notificationsUnsub) {
        container._notificationsUnsub();
        container._notificationsUnsub = null;
      }
      window.removeEventListener("hashchange", onHashChange);
    }
  };

  container._notificationsHashHandler = onHashChange;
  window.addEventListener("hashchange", onHashChange);

  container._notificationsCleanup = () => {
    if (container._notificationsAuthUnsub) {
      container._notificationsAuthUnsub();
      container._notificationsAuthUnsub = null;
    }
    if (container._notificationsUnsub) {
      container._notificationsUnsub();
      container._notificationsUnsub = null;
    }
  };
}
