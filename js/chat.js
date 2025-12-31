import { getAuth, onAuthStateChanged, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  collectionGroup,
  doc,
  query,
  where,
  orderBy,
  limitToLast,
  onSnapshot,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
  arrayUnion,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFirebase } from "../assets/js/common/firebaseClient.js";
import { COLLECTIONS } from "../assets/js/common/collections.js";
import { requireAuth, buildLoginRedirectUrl } from "../assets/js/shared/authGate.js";

(function () {
  const { auth, db } = getFirebase();

  const {
    PRESENCE: PRESENCE_COLLECTION,
    CHATS: CHATS_COLLECTION,
    CONVERSATIONS: CONVERSATIONS_COLLECTION,
    MESSAGES: MESSAGES_COLLECTION
  } = COLLECTIONS;
  const SPECIAL_CONVERSATIONS = new Set(['dm_group_chat', 'dm_foro_general']);
  const APP_ID = 'departamento-medico-brisa';
  const VIRTUAL_DOCTOR_UID = 'virtual_doctor';
  const VIRTUAL_REPLIES = [
    'Estoy en línea, contame tu caso.',
    'Recibido, ¿algún detalle extra?',
    'Perfecto, reviso y te respondo.',
    'Gracias por avisar, ahora lo vemos.',
    '¿Podés compartir más contexto?'
  ];
  const SOUND_KEY = 'brisaChatSound';
  const isMobileShell = () => {
    try {
      if (location.pathname.startsWith('/app/')) return true;
    } catch (e) {}
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches;
  };
  const isReadByMe = (msg) => {
    if (!currentUser) return false;
    const readBy = Array.isArray(msg?.readBy) ? msg.readBy : [];
    return readBy.includes(currentUser.uid);
  };

  // Estado en memoria
  let currentUser = null;
  let currentProfile = null;
  let presenceUnsub = null;
  let activeConversationId = null;
  let activePeer = null;
  let embeddedParent = null;
  let embeddedNextSibling = null;

  const conversationSubs = new Map(); // id -> unsub
  const conversationMessages = new Map(); // id -> array de msgs
  const conversationPeers = new Map(); // id -> { uid, name, subtitle }
  const presenceMap = new Map(); // uid -> { name, role }
  const presenceRows = new Map(); // uid -> row element
  const minimizedPills = new Map(); // id -> element
  const conversationReady = new Set(); // id inicializado
  const chatState = {
    isChatOpen: false,
    isMinimized: true,
    activeConversationId: null,
    activePeerUid: null
  };
  const setChatState = (next = {}) => {
    chatState.isChatOpen = Boolean(next.isChatOpen);
    chatState.isMinimized = Boolean(next.isMinimized);
    chatState.activeConversationId = next.activeConversationId ?? chatState.activeConversationId;
    chatState.activePeerUid = next.activePeerUid ?? chatState.activePeerUid;
  };
  let incomingUnsub = null;
  let incomingReady = false;
  let incomingCutoff = null;
  const PANEL_BASE_NO_TRAY = 84;
  const PANEL_BASE_WITH_TRAY = 60;
  const MAX_RENDER_MESSAGES = 200;
  let isSending = false;
  let pendingDeleteId = null;
  let isDeleteModalOpen = false;
  let deleteContextConversationId = null;
  let pendingDeleteConversationId = null;
  let isDeleteConversationModalOpen = false;
  const newMsgAudio = new Audio(new URL('../assets/sounds/incoming-message.mp3', import.meta.url).toString());

  let originalDocumentTitle = document.title;
  function formatDoctorName(name) {
    const base = (name || 'Médico').trim();
    if (/^Dr\.?/i.test(base)) return base.replace(/^dr/i, 'Dr');
    return `Dr. ${base}`;
  }
  newMsgAudio.preload = 'auto';
  newMsgAudio.playsInline = true;
  newMsgAudio.muted = false;
  const notifiedMessages = new Set();
  const unreadByConversation = new Map();
  let totalUnreadCount = 0;
  let onlineCount = 0;
  let audioPrimed = false;
  let pendingSound = false;
  let soundEnabled = (localStorage.getItem(SOUND_KEY) || 'on') !== 'muted';
  let lastPresenceUser = null;
  let lastPresenceProfile = null;
  let incomingSessionStart = 0;
  let bubblePulseTimeout = null;
  let lastBubblePulseAt = 0;
  const BUBBLE_MARGIN = 0;
  const BUBBLE_TOP_MIN = 80;
  const BUBBLE_BOTTOM_GAP = 110;
  const bubblePositionKey = () => `brisa_chat_bubble_pos_v1_${currentUser?.uid || auth?.currentUser?.uid || 'anon'}`;

  const pulseChatBubble = () => {
    const bubble = document.getElementById('brisa-chat-bubble');
    if (!bubble) return;
    const now = Date.now();
    if (bubble.classList.contains('brisa-chat-bubble--pulse')) return;
    if (now - lastBubblePulseAt < 900) return;
    lastBubblePulseAt = now;
    bubble.classList.add('brisa-chat-bubble--pulse');
    if (bubblePulseTimeout) clearTimeout(bubblePulseTimeout);
    bubblePulseTimeout = setTimeout(() => {
      bubble.classList.remove('brisa-chat-bubble--pulse');
    }, 900);
  };

  const ensureChatStylesInjected = () => {
    if (document.getElementById('brisa-chat-pulse-style')) return;
    const style = document.createElement('style');
    style.id = 'brisa-chat-pulse-style';
    style.textContent = `
      .brisa-chat-bubble--pulse { animation: brisaChatPulse 0.9s ease-out; }
      .brisa-chat-bubble.is-dragging { opacity: .9; }
      @keyframes brisaChatPulse {
        0% { transform: scale(1); }
        30% { transform: scale(1.08); }
        100% { transform: scale(1); }
      }
      @media (max-width: 768px) {
        #brisa-chat-pill-tray { display: none !important; }
        .brisa-chat-bubble { touch-action: none; }
      }
    `;
    document.head.appendChild(style);
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const getBubbleBounds = (bubble) => {
    const height = bubble?.offsetHeight || 58;
    const topMin = BUBBLE_TOP_MIN;
    const topMax = Math.max(topMin, window.innerHeight - height - BUBBLE_BOTTOM_GAP);
    return { height, topMin, topMax };
  };

  const applyBubblePosition = (bubble, { side, yPct } = {}) => {
    if (!bubble || !isMobileShell()) return;
    const { topMin, topMax } = getBubbleBounds(bubble);
    const pct = Number.isFinite(yPct) ? yPct : 0.5;
    const targetTop = clamp(Math.round(pct * window.innerHeight), topMin, topMax);
    const resolvedSide = side === 'right' ? 'right' : 'left';
    bubble.style.top = `${targetTop}px`;
    bubble.style.bottom = 'auto';
    if (resolvedSide === 'right') {
      bubble.style.right = `${BUBBLE_MARGIN}px`;
      bubble.style.left = 'auto';
    } else {
      bubble.style.left = `${BUBBLE_MARGIN}px`;
      bubble.style.right = 'auto';
    }
  };

  const readBubblePosition = () => {
    try {
      const raw = localStorage.getItem(bubblePositionKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        side: parsed.side === 'right' ? 'right' : 'left',
        yPct: Number(parsed.yPct)
      };
    } catch (e) {
      return null;
    }
  };

  const saveBubblePosition = (pos) => {
    try {
      localStorage.setItem(bubblePositionKey(), JSON.stringify(pos));
    } catch (e) {}
  };

  // ---------- UI ----------
  let pillTray = null;

  function injectChatShell() {
    ensureChatStylesInjected();
    let root = document.getElementById('brisa-chat-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'brisa-chat-root';
      document.body.appendChild(root);
    }

    root.innerHTML = `
      <div class="brisa-chat-bubble" id="brisa-chat-bubble">
        <svg class="brisa-chat-bubble-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        <div class="brisa-chat-badge" id="brisa-chat-badge">1</div>
      </div>

      <div class="brisa-chat-panel" id="brisa-chat-panel">
        <div class="brisa-chat-panel-header">
          <div>
            <div class="brisa-chat-panel-title">Médicos conectados <span id="brisa-chat-online-count" class="brisa-chat-online-count">0</span></div>
            <div class="brisa-chat-panel-subtitle">Tiempo real · Departamento Médico</div>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <button class="brisa-chat-pill-btn" id="brisa-chat-panel-sound-toggle" type="button" aria-label="Silenciar">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                <path d="M19 5s2 2 2 7-2 7-2 7" />
                <path d="M15 8s1.5 1.5 1.5 4S15 16 15 16" />
              </svg>
            </button>
            <button class="brisa-chat-pill-btn" id="brisa-chat-panel-close" type="button" aria-label="Cerrar">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div class="brisa-chat-panel-body">
          <div class="brisa-chat-section-label" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span>Accesos rápidos</span>
          </div>
          <div class="brisa-chat-row" id="brisa-chat-quick-group">
            <div class="brisa-chat-status-dot brisa-chat-status-dot--online"></div>
            <div class="brisa-chat-row-main">
              <div class="brisa-chat-name">Chat grupal</div>
              <div class="brisa-chat-meta">Sala común · Todos los médicos</div>
            </div>
          </div>
          <div class="brisa-chat-row" id="brisa-chat-quick-foro">
            <div class="brisa-chat-status-dot brisa-chat-status-dot--online"></div>
            <div class="brisa-chat-row-main">
              <div class="brisa-chat-name">Foro general</div>
              <div class="brisa-chat-meta">Vinculado al Foro del sitio</div>
            </div>
          </div>

          <div class="brisa-chat-section-label">Médicos conectados</div>
          <div id="brisa-chat-users"></div>
        </div>
      </div>

      <div class="brisa-chat-window" id="brisa-chat-window">
        <div class="brisa-chat-window-header">
          <div class="brisa-chat-status-dot brisa-chat-status-dot--online"></div>
          <div class="brisa-chat-window-title" id="brisa-chat-window-title">Chat</div>
          <div class="brisa-chat-window-actions">
            <button class="brisa-chat-pill-btn" id="brisa-chat-window-min" type="button" aria-label="Minimizar" data-tooltip="Minimizar">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M5 12h14"/>
              </svg>
            </button>
            <button class="brisa-chat-pill-btn" id="brisa-chat-delete-conversation" type="button" aria-label="Borrar conversación" data-tooltip="Borrar chat">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
            <button class="brisa-chat-pill-btn" id="brisa-chat-window-close" type="button" aria-label="Cerrar chat" data-tooltip="Cerrar">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div class="brisa-chat-window-subtitle" id="brisa-chat-window-subtitle"></div>
        <div class="brisa-chat-window-body" id="brisa-chat-messages"></div>
        <div class="brisa-chat-window-footer">
          <div class="emoji-input-wrap" style="flex:1;">
            <input id="brisa-chat-input" class="brisa-chat-input" type="text" placeholder="Escribí un mensaje…" autocomplete="off" />
            <button type="button" class="emoji-btn emoji-trigger" data-emoji-target="brisa-chat-input" aria-label="Insertar emoji">😊</button>
            <div class="emoji-panel" data-emoji-panel></div>
          </div>
          <button id="brisa-chat-send" class="brisa-chat-send-btn" type="button">
            <span>Enviar</span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2 11 13" /><path d="M22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      <div class="brisa-chat-pill" id="brisa-chat-pill" style="display:none;">
        <div class="brisa-chat-pill-dot"></div>
        <div class="brisa-chat-pill-label" id="brisa-chat-pill-label">Nuevo mensaje</div>
      </div>
      <div class="brisa-chat-pill-tray" id="brisa-chat-pill-tray"></div>
      <div class="brisa-chat-toast" id="brisa-chat-toast"></div>
      <div class="brisa-chat-mini-modal" id="brisa-chat-delete-modal">
        <div class="brisa-chat-mini-card">
          <div class="brisa-chat-mini-title">Borrar mensaje</div>
          <input id="brisa-chat-delete-pass" class="brisa-chat-mini-input" type="password" placeholder="Contraseña" autocomplete="current-password" />
          <div class="brisa-chat-mini-actions">
            <button class="brisa-chat-mini-btn" id="brisa-chat-delete-cancel" type="button">Cancelar</button>
            <button class="brisa-chat-mini-btn brisa-chat-mini-btn--danger" id="brisa-chat-delete-confirm" type="button">Borrar</button>
          </div>
        </div>
      </div>
      <div class="brisa-chat-mini-modal" id="brisa-chat-delete-conv-modal">
        <div class="brisa-chat-mini-card">
          <div class="brisa-chat-mini-title">Borrar conversación</div>
          <input id="brisa-chat-delete-conv-pass" class="brisa-chat-mini-input" type="password" placeholder="Contraseña" autocomplete="current-password" />
          <div class="brisa-chat-mini-actions">
            <button class="brisa-chat-mini-btn" id="brisa-chat-delete-conv-cancel" type="button">Cancelar</button>
            <button class="brisa-chat-mini-btn brisa-chat-mini-btn--danger" id="brisa-chat-delete-conv-confirm" type="button">Borrar todo</button>
          </div>
        </div>
      </div>
    `;

    pillTray = document.getElementById('brisa-chat-pill-tray');
  }

  function adjustPanelForTray() {
    const panel = document.getElementById('brisa-chat-panel');
    if (!panel) return;
    const hasTray = pillTray && pillTray.children.length > 0;
    const trayHeight = hasTray ? pillTray.offsetHeight : 0;
    const base = hasTray ? PANEL_BASE_WITH_TRAY : PANEL_BASE_NO_TRAY;
    const extra = hasTray ? trayHeight + 8 : 0;
    panel.style.bottom = `${base + extra}px`;
  }

  function getChatRoot() {
    return document.getElementById('brisa-chat-root');
  }

  function isEmbeddedMode() {
    const root = getChatRoot();
    return root ? root.classList.contains('brisa-chat--embedded') : false;
  }

  function mountChat(containerEl) {
    const root = getChatRoot();
    if (!root || !containerEl) return;
    if (!embeddedParent) {
      embeddedParent = root.parentElement;
      embeddedNextSibling = root.nextSibling;
    }
    if (root.parentElement !== containerEl) {
      containerEl.appendChild(root);
    }
    root.classList.add('brisa-chat--embedded');
    const bubble = document.getElementById('brisa-chat-bubble');
    const panel = document.getElementById('brisa-chat-panel');
    const pill = document.getElementById('brisa-chat-pill');
    const tray = document.getElementById('brisa-chat-pill-tray');
    if (bubble) bubble.style.display = 'none';
    if (panel) panel.style.display = 'none';
    if (pill) pill.style.display = 'none';
    if (tray) tray.style.display = 'none';
    const win = document.getElementById('brisa-chat-window');
    if (win) win.style.display = 'flex';
  }

  function unmountChat() {
    const root = getChatRoot();
    if (!root) return;
    root.classList.remove('brisa-chat--embedded');
    const bubble = document.getElementById('brisa-chat-bubble');
    const panel = document.getElementById('brisa-chat-panel');
    const pill = document.getElementById('brisa-chat-pill');
    const tray = document.getElementById('brisa-chat-pill-tray');
    if (bubble) bubble.style.display = '';
    if (panel) panel.style.display = '';
    if (pill) pill.style.display = '';
    if (tray) tray.style.display = '';
    const targetParent = embeddedParent || document.body;
    if (targetParent && root.parentElement !== targetParent) {
      if (embeddedNextSibling && embeddedNextSibling.parentElement === targetParent) {
        targetParent.insertBefore(root, embeddedNextSibling);
      } else {
        targetParent.appendChild(root);
      }
    }
  }

  function isConversationActuallyVisible(conversationId) {
    const panel = document.getElementById('brisa-chat-panel');
    const win = document.getElementById('brisa-chat-window');
    const panelVisible = isEmbeddedMode() ? true : panel && panel.style.display === 'block';
    const winVisible = win && win.style.display !== 'none';
    if (!panelVisible || !winVisible) return false;
    if (!conversationId) return false;
    const sameConversation = activeConversationId === conversationId;
    const tabVisible = !document.hidden;
    return sameConversation && tabVisible;
  }

  // Exponer utilidad de visibilidad para otros módulos/diagnóstico.
  window.__brisaChatIsConversationVisible = isConversationActuallyVisible;
  window.__brisaChatTotalUnread = () => totalUnreadCount;

  function showToast(message) {
    const toast = document.getElementById('brisa-chat-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 4000);
  }

  function updateCountsUI() {
    const badge = document.getElementById('brisa-chat-badge');
    const onlineTitle = document.getElementById('brisa-chat-online-count');
    if (badge) {
      badge.textContent = totalUnreadCount.toString();
      badge.style.display = totalUnreadCount > 0 ? 'flex' : 'none';
    }
    if (onlineTitle) {
      onlineTitle.textContent = onlineCount.toString();
    }
  }

  function updateDocumentBadge() {
    const count = totalUnreadCount || 0;
    if (!originalDocumentTitle) {
      originalDocumentTitle = document.title || 'Departamento Médico';
    }
    if (count > 0) {
      document.title = `(${count}) ${originalDocumentTitle}`;
    } else {
      document.title = originalDocumentTitle;
    }
    const total = window.__brisaChatTotalUnread ? window.__brisaChatTotalUnread() : count;
    if ('setAppBadge' in navigator) {
      try {
        total > 0 ? navigator.setAppBadge(total) : navigator.clearAppBadge();
      } catch (e) {
        // silent catch for badge errors
      }
    }
  }

  function setRowUnreadForPeer(uid, count) {
    const row = presenceRows.get(uid);
    if (!row) return;
    let badge = row.querySelector('.brisa-chat-row-unread');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'brisa-chat-row-unread';
      row.appendChild(badge);
    }
    if (count > 0) {
      badge.textContent = count.toString();
      badge.style.display = 'inline-flex';
      row.classList.add('brisa-chat-row--unread');
    } else {
      badge.textContent = '0';
      badge.style.display = 'none';
      row.classList.remove('brisa-chat-row--unread');
    }
  }

  function playNewMessageSound(conversationId) {
    if (!soundEnabled) return;
    const isVisibleFn = window.__brisaChatIsConversationVisible;
    if (typeof isVisibleFn === 'function') {
      try {
        if (isVisibleFn(conversationId)) return;
      } catch (e) {
        // ignore visibility check errors to avoid blocking sound
      }
    }
    primeAudio();
    try {
      newMsgAudio.currentTime = 0;
      const p = newMsgAudio.play();
      if (p && typeof p.then === 'function') {
        p.catch(() => {
          pendingSound = true;
        });
      }
    } catch (e) {
      pendingSound = true;
    }
  }

  function primeAudio() {
    if (audioPrimed) return;
    try {
      newMsgAudio.muted = true;
      const p = newMsgAudio.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          newMsgAudio.pause();
          newMsgAudio.currentTime = 0;
          newMsgAudio.muted = false;
          audioPrimed = true;
        }).catch(() => {
          newMsgAudio.muted = false;
          pendingSound = true;
        });
      } else {
        newMsgAudio.muted = false;
        audioPrimed = true;
      }
    } catch (e) {
      newMsgAudio.muted = false;
      pendingSound = true;
    }
  }

  function resumePendingSound() {
    if (!pendingSound) return;
    pendingSound = false;
    try {
      newMsgAudio.currentTime = 0;
      newMsgAudio.play().catch(() => {});
    } catch (e) {
      // ignore
    }
  }

  // ---------- PRESENCIA (escritura) ----------
  function buildDisplayName(profile, user) {
    const nameCandidates = [
      profile?.displayName,
      profile?.nombreCompleto,
      profile?.apellidoNombre,
      profile?.fullName,
      profile?.name,
      profile?.nombre,
      user?.displayName,
      user?.email
    ].filter(Boolean);
    return formatDoctorName(nameCandidates[0] || 'Médico');
  }

  function buildRole(profile) {
    return (
      profile?.role ||
      profile?.rol ||
      profile?.cargo ||
      profile?.position ||
      profile?.puesto ||
      null
    );
  }

  async function updatePresenceStatus(user, profile, online) {
    if (!user || !db) return;
    lastPresenceUser = user;
    lastPresenceProfile = profile || lastPresenceProfile || {};
    try {
      await setDoc(
        doc(db, PRESENCE_COLLECTION, user.uid),
        {
          uid: user.uid,
          displayName: buildDisplayName(profile, user),
          role: buildRole(profile),
          online,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('No se pudo actualizar presencia (chat):', e);
    }
  }

  async function markOffline() {
    if (!lastPresenceUser || !db) return;
    try {
      await setDoc(
        doc(db, PRESENCE_COLLECTION, lastPresenceUser.uid),
        { online: false, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.warn('No se pudo marcar offline (chat):', e);
    }
  }

  let offlineTimer = null;
  const scheduleOfflineMark = () => {
    if (offlineTimer) return;
    offlineTimer = window.setTimeout(() => {
      offlineTimer = null;
      markOffline();
    }, 250);
  };
  const cancelOfflineMark = () => {
    if (!offlineTimer) return;
    clearTimeout(offlineTimer);
    offlineTimer = null;
  };

  // ---------- PRESENCIA ----------
  function getConversationId(uid1, uid2) {
    return [uid1, uid2].sort().join('__');
  }

  function isSpecialConversation(conversationId) {
    return SPECIAL_CONVERSATIONS.has(conversationId);
  }

  function isConversationId(value) {
    return typeof value === 'string' && value.includes('__');
  }

  function resolvePeerUidFromConversationId(conversationId, uid) {
    if (!conversationId || !uid) return null;
    const parts = conversationId.split('__');
    if (parts.length < 2) return null;
    if (parts[0] === uid) return parts[1];
    if (parts[1] === uid) return parts[0];
    return parts[0];
  }

  function subscribePresence() {
    if (presenceUnsub) presenceUnsub();
    presenceMap.clear();
    const presenceQuery = query(collection(db, PRESENCE_COLLECTION), where('online', '==', true));
    presenceUnsub = onSnapshot(presenceQuery, snapshot => {
        const container = document.getElementById('brisa-chat-users');
        if (!container) return;
        container.innerHTML = '';
        presenceRows.clear();

    const totalOnline = currentUser ? Math.max(snapshot.size - 0, 0) : snapshot.size;
    onlineCount = currentUser ? Math.max(snapshot.size, 0) : totalOnline;
    updateCountsUI();

    if (currentUser) {
      const selfName = formatDoctorName(currentUser.displayName || currentUser.email || 'Vos');
      presenceMap.set(currentUser.uid, { name: selfName, role: 'Sesión actual' });
      container.appendChild(buildSelfRow());
    }

        snapshot.forEach(doc => {
          const data = doc.data();
          const uid = data.uid || doc.id;
          if (!uid) return;
          const doctorName = formatDoctorName(data.displayName || data.email || 'Médico');
          presenceMap.set(uid, { name: doctorName, role: data.role || 'Médico' });
          if (!currentUser || uid === currentUser.uid) return;

          const row = document.createElement('div');
          row.className = 'brisa-chat-row';
          row.dataset.uid = uid;
          row.dataset.name = doctorName;
          presenceRows.set(uid, row);

          row.innerHTML = `
            <div class="brisa-chat-status-dot brisa-chat-status-dot--online"></div>
            <div class="brisa-chat-row-main">
              <div class="brisa-chat-name">${row.dataset.name}</div>
              <div class="brisa-chat-meta">${data.role || 'Médico'}</div>
            </div>
            <button class="brisa-chat-icon-btn" type="button" aria-label="Enviar mensaje">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M22 2 11 13" /><path d="M22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          `;

          row.addEventListener('click', () => openConversation(uid, row.dataset.name));
          container.appendChild(row);

          // Aplicar indicador de no leídos si existe
          if (currentUser) {
            const convId = getConversationId(currentUser.uid, uid);
            const unread = unreadByConversation.get(convId) || 0;
            setRowUnreadForPeer(uid, unread);

            // Mantener listener en segundo plano para recibir mensajes sin abrir el chat.
            ensureConversationSubscription(convId);
          }
        });
      });
  }

  function buildSelfRow() {
    const row = document.createElement('div');
    row.className = 'brisa-chat-row brisa-chat-row--disabled';
    row.innerHTML = `
      <div class="brisa-chat-status-dot brisa-chat-status-dot--online"></div>
      <div class="brisa-chat-row-main">
        <div class="brisa-chat-name">${formatDoctorName(currentUser?.displayName || currentUser?.email || 'Vos')}</div>
        <div class="brisa-chat-meta">Sesión actual</div>
      </div>
    `;
    return row;
  }

  // ---------- MENSAJES Y SUSCRIPCIONES ----------
  function ensurePeerFromMessage(conversationId, msg) {
    if (conversationPeers.has(conversationId)) return;
    if (!msg) return;
    const peerUid = msg.from === currentUser?.uid ? msg.to : msg.from;
    const fromPresence = presenceMap.get(peerUid);
    const name = formatDoctorName(fromPresence?.name || msg.fromName || 'Médico');
    conversationPeers.set(conversationId, { uid: peerUid, name, subtitle: 'Conversación privada · Departamento Médico' });
  }

  function incrementUnread(conversationId, { silent = false } = {}) {
    const isVisibleFn = window.__brisaChatIsConversationVisible;
    if (typeof isVisibleFn === 'function') {
      try {
        if (isVisibleFn(conversationId)) return;
      } catch (e) {
        // ignore visibility check errors to avoid blocking unread count
      }
    }
    const current = unreadByConversation.get(conversationId) || 0;
    unreadByConversation.set(conversationId, current + 1);
    totalUnreadCount += 1;
    updateCountsUI();
    updateDocumentBadge();
    const peer = conversationPeers.get(conversationId);
    if (peer?.uid) {
      setRowUnreadForPeer(peer.uid, unreadByConversation.get(conversationId) || 0);
    }
    if (!silent) {
      playNewMessageSound(conversationId);
    }
  }

  function clearUnread(conversationId) {
    if (!conversationId) return;
    const prev = unreadByConversation.get(conversationId) || 0;
    if (prev > 0) {
      totalUnreadCount = Math.max(0, totalUnreadCount - prev);
    }
    unreadByConversation.set(conversationId, 0);
    updateCountsUI();
    updateDocumentBadge();
    const peer = conversationPeers.get(conversationId);
    if (peer?.uid) {
      setRowUnreadForPeer(peer.uid, 0);
    }
  }

  function ensureConversationSubscription(conversationId) {
    if (conversationSubs.has(conversationId)) return;

    const msgsRef = collection(db, CHATS_COLLECTION, conversationId, MESSAGES_COLLECTION);
    const msgsQuery = query(msgsRef, orderBy('createdAt', 'asc'), limitToLast(MAX_RENDER_MESSAGES));
    const unsub = onSnapshot(msgsQuery, snapshot => {
        const isInitialized = conversationReady.has(conversationId);

        if (!isInitialized) {
          const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          conversationMessages.set(conversationId, msgs.slice(-MAX_RENDER_MESSAGES));
          if (!conversationPeers.has(conversationId)) {
            snapshot.docs.forEach(d => ensurePeerFromMessage(conversationId, d.data()));
          }
        } else {
          const current = conversationMessages.get(conversationId) || [];
          snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
              const data = { id: change.doc.id, ...change.doc.data() };
              if (data.from === currentUser?.uid) {
                const pendingIdx = current.findIndex(m => m.localPending);
                if (pendingIdx >= 0) current.splice(pendingIdx, 1);
              }
              current.push(data);
            }
            if (change.type === 'modified') {
              const data = { id: change.doc.id, ...change.doc.data() };
              const idx = current.findIndex(m => m.id === data.id);
              if (idx >= 0) current[idx] = data;
            }
            if (change.type === 'removed') {
              const idx = current.findIndex(m => m.id === change.doc.id);
              if (idx >= 0) current.splice(idx, 1);
            }
          });
          conversationMessages.set(conversationId, current.slice(-MAX_RENDER_MESSAGES));
        }

        const isHidden = !isConversationActuallyVisible(conversationId);

        // En el primer snapshot, calcular no leídos reales (según readBy) para no "contar historia" como nueva,
        // y para capturar mensajes que llegaron antes de que exista un listener específico.
        if (!isInitialized && currentUser && isHidden) {
          let initialUnread = 0;
          snapshot.docs.forEach(d => {
            const msg = d.data() || {};
            if (msg.from === currentUser.uid) return;
            const readBy = Array.isArray(msg.readBy) ? msg.readBy : [];
            if (readBy.includes(currentUser.uid)) return;
            initialUnread += 1;
            if (d.id) notifiedMessages.add(d.id);
            ensurePeerFromMessage(conversationId, msg);
          });

          if (initialUnread > 0) {
            const prev = unreadByConversation.get(conversationId) || 0;
            if (initialUnread > prev) {
              unreadByConversation.set(conversationId, initialUnread);
              totalUnreadCount += (initialUnread - prev);
              updateCountsUI();
              updateDocumentBadge();
              const peer = conversationPeers.get(conversationId);
              if (peer?.uid) {
                setRowUnreadForPeer(peer.uid, initialUnread);
              }
            }
          }
        }

        const hasNewFromOther = isInitialized && snapshot.docChanges().some(change => {
          const msg = { id: change.doc.id, ...change.doc.data() };
          if (change.type !== 'added' || !currentUser || msg.from === currentUser.uid) return false;
          if (isReadByMe(msg)) return false;
          ensurePeerFromMessage(conversationId, msg);
          return true;
        });


        if (conversationId === activeConversationId) {
          if (!isInitialized) {
            renderActiveConversation();
            const list = document.getElementById('brisa-chat-messages');
            if (list) list.scrollTop = list.scrollHeight;
          } else {
            // Render solo nuevas (docChanges)
            const list = document.getElementById('brisa-chat-messages');
            if (list) {
              const removePending = () => {
                const pendingEl = list.querySelector('[data-pending="true"]');
                if (pendingEl) pendingEl.remove();
              };
              snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                  const data = { id: change.doc.id, ...change.doc.data() };
                  if (data.from === currentUser?.uid) removePending();
                  renderMessage({ id: change.doc.id, ...change.doc.data() });
                }
                if (change.type === 'modified') {
                  renderMessage({ id: change.doc.id, ...change.doc.data() }, true);
                }
                if (change.type === 'removed') {
                  const el = list.querySelector(`[data-id="${change.doc.id}"]`);
                  if (el) el.remove();
                }
              });
              list.scrollTop = list.scrollHeight;
            }
          }
          if (hasNewFromOther && isHidden) {
            snapshot.docChanges().forEach(change => {
              if (change.type !== 'added') return;
              const msg = { id: change.doc.id, ...change.doc.data() };
              if (msg.from === currentUser?.uid) return;
              if (isReadByMe(msg)) return;
              if (msg.id && notifiedMessages.has(msg.id)) return;
              if (msg.id) notifiedMessages.add(msg.id);
              incrementUnread(conversationId);
              handleIncomingForMinimized(conversationId, { force: true });
            });
          } else if (hasNewFromOther && !isHidden) {
            markIncomingAsRead(conversationId, snapshot.docChanges());
            snapshot.docChanges().forEach(change => {
              if (change.type !== 'added') return;
              const msg = { id: change.doc.id, ...change.doc.data() };
              if (msg.from === currentUser?.uid) return;
              if (isReadByMe(msg)) return;
              if (msg.id && notifiedMessages.has(msg.id)) return;
              if (msg.id) notifiedMessages.add(msg.id);
              handleIncomingForMinimized(conversationId, { force: false });
            });
            stopBlink(conversationId);
          }
          if (!isHidden) {
            markAllAsRead(conversationId);
            clearUnread(conversationId);
          }
        } else if (hasNewFromOther) {
          snapshot.docChanges().forEach(change => {
            if (change.type !== 'added') return;
            const msg = { id: change.doc.id, ...change.doc.data() };
            if (msg.from === currentUser?.uid) return;
            if (isReadByMe(msg)) return;
            if (msg.id && notifiedMessages.has(msg.id)) return;
            if (msg.id) notifiedMessages.add(msg.id);
            incrementUnread(conversationId);
          });
          handleIncomingForMinimized(conversationId, { force: true });
        }

        conversationReady.add(conversationId);
      }, (error) => {
        console.warn('Snapshot error en conversación', conversationId, error);
        showToast('Chat con problemas de conexión, reintentando…');
      });

    conversationSubs.set(conversationId, unsub);
  }

  function renderActiveConversation() {
    const list = document.getElementById('brisa-chat-messages');
    if (!list) return;
    list.innerHTML = '';

    const msgs = conversationMessages.get(activeConversationId) || [];
    msgs.forEach(msg => renderMessage(msg));
  }

  function handleIncomingForMinimized(conversationId, { force = false } = {}) {
    if (!currentUser) return;
    if (isMobileShell()) {
      if (force) {
        pulseChatBubble();
      }
      return;
    }
    const peer = conversationPeers.get(conversationId);
    const label = peer?.name || 'Nuevo mensaje';
    if (force || minimizedPills.has(conversationId) || !activeConversationId || conversationId !== activeConversationId) {
      const pill = getOrCreatePill(conversationId, label);
      if (pill) pill.classList.add('brisa-chat-pill--blink');
    }
  }

  async function resetConversationUnread(conversationId) {
    if (!currentUser || !conversationId) return;
    if (isSpecialConversation(conversationId)) return;
    try {
      const ref = doc(db, CONVERSATIONS_COLLECTION, conversationId);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const data = snap.data() || {};
        const unreadMap = { ...(data.unreadCountByUid || {}) };
        if (!unreadMap[currentUser.uid]) return;
        unreadMap[currentUser.uid] = 0;
        tx.set(ref, { unreadCountByUid: unreadMap }, { merge: true });
      });
    } catch (e) {
      console.warn('No se pudo limpiar el unread de la conversacion:', e);
    }
  }

  function markIncomingAsRead(conversationId, docChanges) {
    docChanges.forEach(change => {
      if (change.type !== 'added') return;
      const data = change.doc.data();
      if (!currentUser || data.from === currentUser.uid) return;
      setDoc(
        doc(db, CHATS_COLLECTION, conversationId, MESSAGES_COLLECTION, change.doc.id),
        { readBy: arrayUnion(currentUser.uid), readAt: serverTimestamp() },
        { merge: true }
      )
        .catch(() => {});
    });
    clearUnread(conversationId);
    resetConversationUnread(conversationId);
  }

  function markAllAsRead(conversationId) {
    const msgs = conversationMessages.get(conversationId) || [];
    msgs.forEach(msg => {
      if (!currentUser || msg.from === currentUser.uid || !msg.id) return;
      const already = Array.isArray(msg.readBy) && msg.readBy.includes(currentUser.uid);
      if (already) return;
      setDoc(
        doc(db, CHATS_COLLECTION, conversationId, MESSAGES_COLLECTION, msg.id),
        { readBy: arrayUnion(currentUser.uid), readAt: serverTimestamp() },
        { merge: true }
      ).catch(() => {});
    });
    clearUnread(conversationId);
    resetConversationUnread(conversationId);
  }

  function ensureIncomingWatcher() {
    if (!currentUser) return;
    if (incomingUnsub) return;
    incomingReady = true;
    incomingSessionStart = Date.now();
    incomingCutoff = incomingSessionStart;
    const incomingQuery = query(
      collectionGroup(db, MESSAGES_COLLECTION),
      where('to', '==', currentUser.uid)
    );
    incomingUnsub = onSnapshot(incomingQuery, (snapshot) => {
        snapshot.docChanges().forEach(change => {
          if (change.type !== 'added') return;
          const data = change.doc.data();
          if (!currentUser || data.from === currentUser.uid) return;
          if (isReadByMe(data)) return;
          const createdAt = data.createdAt;
          let ts = 0;
          if (createdAt?.toMillis) ts = createdAt.toMillis();
          else if (createdAt?.getTime) ts = createdAt.getTime();
          else if (Number.isFinite(createdAt?.seconds)) ts = createdAt.seconds * 1000;
          const isHistorical = ts ? ts <= incomingSessionStart : true;
          if (!isHistorical && incomingCutoff && ts <= incomingCutoff) return;
          incomingCutoff = Math.max(incomingCutoff || 0, ts);
          const rawConversationId = change.doc.ref.parent.parent?.id;
          const isGroupChat = rawConversationId === 'dm_group_chat';
          const conversationId = isGroupChat
            ? 'dm_group_chat'
            : getConversationId(currentUser.uid, data.from || '');
          if (!conversationId) return;
          const messageId = change.doc.id;
          if (messageId && notifiedMessages.has(messageId)) return;
          if (messageId) notifiedMessages.add(messageId);
          ensurePeerFromMessage(conversationId, data);
          // Asegurar que la conversación tiene listener para seguir recibiendo cambios.
          if (!conversationSubs.has(conversationId)) {
            ensureConversationSubscription(conversationId);
          }
          if (isHistorical) {
            incrementUnread(conversationId, { silent: true });
            return;
          }
          const peer = conversationPeers.get(conversationId) || { uid: data.from, name: presenceMap.get(data.from)?.name || 'Nuevo mensaje', subtitle: 'Conversación privada · Departamento Médico' };
          let autoRead = false;
          const visFn = window.__brisaChatIsConversationVisible;
          if (!document.hidden && typeof visFn === 'function') {
            try {
              autoRead = visFn(conversationId) === true;
            } catch (e) {
              autoRead = false;
            }
          }

          const isVisible = isConversationActuallyVisible(conversationId);
          if (!isVisible) {
            incrementUnread(conversationId);
            handleIncomingForMinimized(conversationId, { force: true });
          } else {
            markIncomingAsRead(conversationId, [change]);
            handleIncomingForMinimized(conversationId, { force: false });
            clearUnread(conversationId);
          }

          // Upsert notificación de mensaje entrante (DM/Grupo)
          try {
            const notifApi = window.BrisaNotifications?.upsert;
            if (typeof notifApi === 'function') {
              const docId = isGroupChat
                ? `notif__chat_group__${currentUser.uid}__${conversationId}`
                : `notif__chat_dm__${currentUser.uid}__${conversationId}`;
              const title = isGroupChat ? 'Nuevo mensaje en grupo' : 'Nuevo mensaje';
              const snippet = data.text && data.text.length > 90 ? `${data.text.slice(0, 90)}…` : (data.text || '');
              const fromName = data.fromName || presenceMap.get(data.from)?.name || 'Usuario';
              const peerUid = isGroupChat ? 'dm_group_chat' : data.from;
              notifApi({
                docId,
                toUid: currentUser.uid,
                fromUid: data.from,
                fromName,
                type: isGroupChat ? 'chat_group' : 'chat_dm',
                entityId: conversationId,
                route: '#chat',
                title,
                body: snippet,
                peerUid,
                read: autoRead,
                readAt: autoRead ? serverTimestamp() : null
              });
            }
          } catch (err) {
            console.debug('Notif chat entrante error', err);
          }
        });
    }, (err) => {
      console.warn('Error en watcher global de mensajes:', err);
    });
  }

  function stopIncomingWatcher() {
    if (incomingUnsub) {
      incomingUnsub();
      incomingUnsub = null;
    }
    incomingReady = false;
    incomingCutoff = null;
    incomingSessionStart = 0;
  }

  function showDeleteModal(messageId) {
    pendingDeleteId = messageId;
    deleteContextConversationId = activeConversationId;
    const modal = document.getElementById('brisa-chat-delete-modal');
    const pass = document.getElementById('brisa-chat-delete-pass');
    if (!modal || !pass) return;
    modal.classList.add('is-visible');
    isDeleteModalOpen = true;
    pass.value = '';
    setTimeout(() => pass.focus(), 20);
  }

  function hideDeleteModal() {
    const modal = document.getElementById('brisa-chat-delete-modal');
    if (modal) modal.classList.remove('is-visible');
    pendingDeleteId = null;
    deleteContextConversationId = null;
    isDeleteModalOpen = false;
  }

  async function confirmDeleteMessage() {
    if (!pendingDeleteId) {
      hideDeleteModal();
      return;
    }
    const pass = document.getElementById('brisa-chat-delete-pass');
    const password = pass?.value?.trim();
    if (!password) {
      showToast('Ingresá tu contraseña.');
      return;
    }
    await requestDeleteMessage(pendingDeleteId, password, deleteContextConversationId || activeConversationId);
    hideDeleteModal();
  }

  function showDeleteConversationModal() {
    if (!activeConversationId) return;
    pendingDeleteConversationId = activeConversationId;
    const modal = document.getElementById('brisa-chat-delete-conv-modal');
    const pass = document.getElementById('brisa-chat-delete-conv-pass');
    if (!modal || !pass) return;
    modal.classList.add('is-visible');
    isDeleteConversationModalOpen = true;
    pass.value = '';
    setTimeout(() => pass.focus(), 20);
  }

  function hideDeleteConversationModal() {
    const modal = document.getElementById('brisa-chat-delete-conv-modal');
    if (modal) modal.classList.remove('is-visible');
    pendingDeleteConversationId = null;
    isDeleteConversationModalOpen = false;
  }

  async function confirmDeleteConversation() {
    if (!pendingDeleteConversationId) {
      hideDeleteConversationModal();
      return;
    }
    const pass = document.getElementById('brisa-chat-delete-conv-pass');
    const password = pass?.value?.trim();
    if (!password) {
      showToast('Ingresá tu contraseña.');
      return;
    }
    await requestDeleteConversation(pendingDeleteConversationId, password);
    hideDeleteConversationModal();
  }

  function renderMessage(msg, replaceExisting = false) {
    const list = document.getElementById('brisa-chat-messages');
    if (!list || !currentUser) return;

    if (replaceExisting && msg.id) {
      const existing = list.querySelector(`[data-id="${msg.id}"]`);
      if (existing) existing.remove();
    }

    const isMe = msg.from === currentUser.uid;
    const item = document.createElement('div');
    item.className = 'brisa-chat-msg ' + (isMe ? 'brisa-chat-msg--me' : 'brisa-chat-msg--other');
    if (msg.id) item.dataset.id = msg.id;
    if (msg.localPending) item.dataset.pending = 'true';

    const authorLabel = isMe ? 'Vos' : (activePeer?.name || 'Médico');
    const date = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date();
    const timeText = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

    let statusHTML = '';
    if (isMe) {
      const readBy = msg.readBy || [];
      const targetUid = activePeer?.uid;
      const isRead = targetUid ? readBy.includes(targetUid) : false;
      const isPending = msg.localPending;
      const canDelete = !isPending && !!msg.id;
      const trashIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>`;
      if (isPending) {
        statusHTML = `<span class="brisa-chat-status-icon brisa-chat-status-icon--pending">✓</span>`;
      } else if (isRead) {
        statusHTML = `<span class="brisa-chat-status-icon brisa-chat-status-icon--read">✓✓</span>`;
      } else {
        statusHTML = `<span class="brisa-chat-status-icon brisa-chat-status-icon--sent">✓✓</span>`;
      }
      if (canDelete) {
        statusHTML += `<button class="brisa-chat-delete-btn" data-id="${msg.id}" title="Borrar mensaje">${trashIcon}</button>`;
      }
    }

    item.innerHTML = `
      <span class="brisa-chat-msg-author">${authorLabel}</span>
      <span>${msg.text}</span>
      <span class="brisa-chat-msg-time">
        ${timeText}
        ${statusHTML}
      </span>
    `;
    list.appendChild(item);

    if (isMe) {
      const deleteBtn = item.querySelector('.brisa-chat-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const msgId = deleteBtn.dataset.id;
          if (msgId) showDeleteModal(msgId);
        });
      }
    }
  }

  async function sendMessage() {
    if (!currentUser) {
      showToast('Inicia sesión para enviar mensajes.');
      return;
    }
    if (!activeConversationId || !activePeer || !activePeer.uid) {
      showToast('Seleccioná un chat válido.');
      return;
    }
    if (isSending) return;
    const input = document.getElementById('brisa-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const sendBtn = document.getElementById('brisa-chat-send');
    if (sendBtn) sendBtn.disabled = true;
    input.disabled = true;
    isSending = true;

    const tempId = `tmp-${Date.now()}`;
    const placeholder = {
      id: tempId,
      text,
      from: currentUser.uid,
      to: activePeer.uid,
      createdAt: new Date(),
      localPending: true,
      readBy: []
    };
    const existing = conversationMessages.get(activeConversationId) || [];
    existing.push(placeholder);
    conversationMessages.set(activeConversationId, existing.slice(-MAX_RENDER_MESSAGES));
    if (activeConversationId) {
      renderMessage(placeholder);
      const list = document.getElementById('brisa-chat-messages');
      if (list) list.scrollTop = list.scrollHeight;
    }

    const payload = {
      text,
      from: currentUser.uid,
      to: activePeer.uid,
      createdAt: serverTimestamp(),
      readBy: []
    };

    try {
      await addDoc(collection(db, CHATS_COLLECTION, activeConversationId, MESSAGES_COLLECTION), payload);
      upsertConversationSummary({
        conversationId: activeConversationId,
        fromUid: currentUser.uid,
        toUid: activePeer.uid,
        text
      });

      if (activeConversationId === 'dm_foro_general') {
        await mirrorToForum(text);
      }

      if (activePeer.uid === VIRTUAL_DOCTOR_UID) {
        const reply = VIRTUAL_REPLIES[Math.floor(Math.random() * VIRTUAL_REPLIES.length)];
        const replyConversationId = activeConversationId;
        const replyTargetUid = currentUser.uid;
        setTimeout(() => {
          addDoc(collection(db, CHATS_COLLECTION, replyConversationId, MESSAGES_COLLECTION), {
              text: reply,
              from: VIRTUAL_DOCTOR_UID,
              to: replyTargetUid,
              createdAt: serverTimestamp()
            })
              .then(() => {
                upsertConversationSummary({
                  conversationId: replyConversationId,
                  fromUid: VIRTUAL_DOCTOR_UID,
                  toUid: replyTargetUid,
                  text: reply
                });
              })
              .catch(() => {});
        }, 700);
      }

      input.value = '';
      input.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      isSending = false;

      // Notificaciones (DM / Grupo)
      try {
        const notifApi = window.BrisaNotifications?.upsert;
        if (typeof notifApi === "function") {
          const snippet = text.length > 90 ? `${text.slice(0, 90)}…` : text;
          const isGroup = activeConversationId === 'dm_group_chat';
          const type = isGroup ? 'chat_group' : 'chat_dm';
          const title = isGroup ? 'Nuevo mensaje en grupo' : 'Nuevo mensaje';
      const route = '#chat';
      const targets = isGroup ? (activePeer.members || []) : [activePeer.uid];
      targets
        .filter((uid) => uid && uid !== currentUser.uid && uid !== VIRTUAL_DOCTOR_UID)
        .forEach((toUid) => {
          const docId = isGroup
            ? `notif__chat_group__${toUid}__${activeConversationId}`
            : `notif__chat_dm__${toUid}__${activeConversationId}`;
          notifApi({
            toUid,
            fromUid: currentUser.uid,
            fromName: currentUser.displayName || currentUser.email || 'Usuario',
            type,
            entityId: activeConversationId,
            route,
            title,
            body: snippet,
            docId,
            peerUid: isGroup ? 'dm_group_chat' : activePeer.uid
          });
        });
        }
      } catch (err) {
        console.error('No se pudo enviar notificación de chat', err);
      }
    } catch (e) {
      console.warn('No se pudo enviar el mensaje:', e);
      input.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      isSending = false;
      showToast('No se pudo enviar. Reintentá.');
    }
  }

  async function requestDeleteMessage(messageId, password, conversationId) {
    if (!currentUser || !messageId || !conversationId) return;
    if (!currentUser.email) {
      showToast('No se puede borrar: usuario sin email.');
      return;
    }
    try {
      const cred = EmailAuthProvider.credential(currentUser.email, password);
      await reauthenticateWithCredential(currentUser, cred);
      await deleteDoc(doc(db, CHATS_COLLECTION, conversationId, MESSAGES_COLLECTION, messageId));
      showToast('Mensaje borrado.');
    } catch (e) {
      console.warn('Error al borrar mensaje:', e);
      showToast('No se pudo borrar (credenciales inválidas o error).');
    }
  }

  async function requestDeleteConversation(conversationId, password) {
    if (!currentUser || !conversationId) return;
    if (!currentUser.email) {
      showToast('No se puede borrar: usuario sin email.');
      return;
    }
    try {
      const cred = EmailAuthProvider.credential(currentUser.email, password);
      await reauthenticateWithCredential(currentUser, cred);
      const msgsRef = collection(db, CHATS_COLLECTION, conversationId, MESSAGES_COLLECTION);
      const snap = await getDocs(msgsRef);
      const deletions = snap.docs.map(d => deleteDoc(d.ref).catch(() => {}));
      await Promise.all(deletions);
      conversationMessages.set(conversationId, []);
      if (activeConversationId === conversationId) {
        renderActiveConversation();
      }
      showToast('Conversación borrada.');
    } catch (e) {
      console.warn('Error al borrar conversación:', e);
      showToast('No se pudo borrar la conversación.');
    }
  }

  async function mirrorToForum(text) {
    try {
      const resolveValue = (obj, keys, fallback = '') => {
        if (!obj) return fallback;
        for (const k of keys) {
          if (obj[k]) return obj[k];
        }
        return fallback;
      };
      const author =
        resolveValue(currentProfile, ['displayName', 'nombreCompleto', 'apellidoNombre', 'fullName', 'name', 'nombre'], '') ||
        `${resolveValue(currentProfile, ['apellido', 'lastName'], '')} ${resolveValue(currentProfile, ['nombre', 'firstName'], '')}`.trim() ||
        currentUser.displayName ||
        currentUser.email ||
        'Médico';
      const businessUnit = resolveValue(currentProfile, ['businessUnit', 'unidadNegocio', 'bu', 'business_unit'], '');
      const managementUnit = resolveValue(currentProfile, ['managementUnit', 'unidadGestion', 'mu', 'management_unit'], '');

      const forumRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'committee_messages');
      await addDoc(forumRef, {
        text,
        author,
        businessUnit,
        managementUnit,
        committeeId: 'foro_general',
        authorUid: currentUser.uid,
        authorName: author,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.warn('No se pudo reflejar el mensaje en el foro:', e);
    }
  }

  async function upsertConversationSummary({ conversationId, fromUid, toUid, text }) {
    if (!conversationId || !fromUid || !toUid) return;
    if (isSpecialConversation(conversationId)) return;
    try {
      const ref = doc(db, CONVERSATIONS_COLLECTION, conversationId);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists() ? snap.data() : {};
        const unreadMap = { ...(data.unreadCountByUid || {}) };
        const prevUnread = Number(unreadMap[toUid] || 0);
        unreadMap[toUid] = prevUnread + 1;
        unreadMap[fromUid] = 0;
        const participants =
          Array.isArray(data.participants) && data.participants.length
            ? data.participants
            : [fromUid, toUid].sort();
        tx.set(
          ref,
          {
            participants,
            lastMessageText: text,
            lastMessageAt: serverTimestamp(),
            lastSenderUid: fromUid,
            updatedAt: serverTimestamp(),
            unreadCountByUid: unreadMap
          },
          { merge: true }
        );
      });
    } catch (e) {
      console.warn('No se pudo actualizar la conversacion:', e);
    }
  }

  // ---------- VENTANAS Y PILLS ----------
  function updateConversationPeer(conversationId, updates = {}) {
    const peer = conversationPeers.get(conversationId);
    if (!peer) return;
    const next = { ...peer, ...updates };
    conversationPeers.set(conversationId, next);
    if (activeConversationId === conversationId) {
      const title = document.getElementById('brisa-chat-window-title');
      const subtitle = document.getElementById('brisa-chat-window-subtitle');
      if (title && next.name) title.textContent = next.name;
      if (subtitle && next.subtitle) subtitle.textContent = next.subtitle;
    }
  }

  async function hydratePeerProfile(conversationId, peerUid) {
    if (!peerUid || !db) return;
    try {
      const snap = await getDoc(doc(db, 'usuarios', peerUid));
      if (!snap.exists()) return;
      const profile = snap.data() || {};
      const userStub = {
        displayName: profile.displayName || profile.nombreCompleto || profile.apellidoNombre || profile.fullName || profile.name,
        email: profile.email || profile.correo || profile.mail
      };
      const name = buildDisplayName(profile, userStub);
      updateConversationPeer(conversationId, {
        uid: peerUid,
        name,
        subtitle: 'Conversacion privada - Departamento Medico'
      });
    } catch (e) {
      console.warn('No se pudo cargar el perfil del medico:', e);
    }
  }

  async function openConversationFromId(conversationId) {
    if (!currentUser) return;
    if (conversationId === 'dm_group_chat') {
      openSpecialConversation('dm_group_chat', 'Chat grupal', 'Sala comun - Departamento Medico');
      return;
    }
    if (conversationId === 'dm_foro_general') {
      openSpecialConversation('dm_foro_general', 'Foro general', 'Mensajes vinculados al foro');
      return;
    }
    const peerUid = resolvePeerUidFromConversationId(conversationId, currentUser.uid);
    if (!peerUid) return;
    const peerName = presenceMap.get(peerUid)?.name || 'Medico';
    openConversationById(conversationId, { uid: peerUid, name: peerName, subtitle: 'Conversacion privada - Departamento Medico' });
    await hydratePeerProfile(conversationId, peerUid);
  }

  function openConversation(peerUid, peerName, options = {}) {
    if (!currentUser) return;
    const conversationId = getConversationId(currentUser.uid, peerUid);
    openConversationById(conversationId, { uid: peerUid, name: peerName, subtitle: 'Conversación privada · Departamento Médico' }, options);
  }

  function openSpecialConversation(conversationId, peerName, subtitleText, options = {}) {
    openConversationById(conversationId, { uid: conversationId, name: peerName, subtitle: subtitleText }, options);
  }

  function openConversationById(conversationId, peer, options = {}) {
    activeConversationId = conversationId;
    activePeer = peer;
    conversationPeers.set(conversationId, peer);
    ensureConversationSubscription(conversationId);
    setChatState({
      isChatOpen: true,
      isMinimized: false,
      activeConversationId,
      activePeerUid: peer.uid
    });

    const win = document.getElementById('brisa-chat-window');
    const title = document.getElementById('brisa-chat-window-title');
    const subtitle = document.getElementById('brisa-chat-window-subtitle');
    const msgs = document.getElementById('brisa-chat-messages');

    if (win && title && subtitle && msgs) {
      title.textContent = peer.name;
      subtitle.textContent = peer.subtitle || 'Departamento Médico';
      msgs.innerHTML = '';
      win.style.display = 'flex';
      renderActiveConversation();
      markAllAsRead(conversationId);
      clearUnread(conversationId);
      resetConversationUnread(conversationId);
      if (!options.preserveBlink) {
        stopBlink(conversationId);
      }
    }
  }

  function minimizeActiveConversation() {
    if (isEmbeddedMode()) return;
    if (!activeConversationId || !activePeer) return;
    const win = document.getElementById('brisa-chat-window');
    if (win) win.style.display = 'none';
    const pill = getOrCreatePill(activeConversationId, activePeer.name);
    stopBlink(activeConversationId);
    setChatState({
      isChatOpen: true,
      isMinimized: true,
      activeConversationId,
      activePeerUid: activePeer.uid
    });
  }

  function getOrCreatePill(conversationId, label) {
    if (isMobileShell()) return null;
    if (!pillTray) return null;
    if (minimizedPills.has(conversationId)) {
      const existing = minimizedPills.get(conversationId);
      existing.querySelector('.brisa-chat-pill-label').textContent = label;
      return existing;
    }

    const pill = document.createElement('div');
    pill.className = 'brisa-chat-pill brisa-chat-pill--tray';
    pill.dataset.conversationId = conversationId;
    pill.innerHTML = `
      <div class="brisa-chat-pill-dot"></div>
      <div class="brisa-chat-pill-label">${label}</div>
      <div class="brisa-chat-pill-actions">
        <button class="brisa-chat-pill-btn-mini" data-action="open" title="Abrir" aria-label="Abrir">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M16 3h3a2 2 0 0 1 2 2v3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" />
            <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
          </svg>
        </button>
        <button class="brisa-chat-pill-btn-mini" data-action="close" title="Cerrar" aria-label="Cerrar">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    `;

    pill.querySelector('[data-action="open"]').addEventListener('click', (e) => {
      e.stopPropagation();
      const peer = conversationPeers.get(conversationId);
      if (peer) {
        openConversationById(conversationId, peer);
      }
    });

    pill.querySelector('[data-action="close"]').addEventListener('click', (e) => {
      e.stopPropagation();
      removeConversation(conversationId);
    });

    pill.addEventListener('click', () => {
      const peer = conversationPeers.get(conversationId);
      if (peer) {
        openConversationById(conversationId, peer);
      }
    });

    pillTray.appendChild(pill);
    minimizedPills.set(conversationId, pill);
    adjustPanelForTray();
    return pill;
  }

  function stopBlink(conversationId) {
    const pill = minimizedPills.get(conversationId);
    if (pill) pill.classList.remove('brisa-chat-pill--blink');
  }

  function removeConversation(conversationId) {
    const unsub = conversationSubs.get(conversationId);
    if (unsub) unsub();
    conversationSubs.delete(conversationId);
    conversationMessages.delete(conversationId);
    conversationPeers.delete(conversationId);
    conversationReady.delete(conversationId);
    const prev = unreadByConversation.get(conversationId) || 0;
    if (prev > 0) {
      totalUnreadCount = Math.max(0, totalUnreadCount - prev);
    }
    unreadByConversation.delete(conversationId);
    updateCountsUI();
    updateDocumentBadge();

    const pill = minimizedPills.get(conversationId);
    if (pill) pill.remove();
    minimizedPills.delete(conversationId);
    adjustPanelForTray();

    if (activeConversationId === conversationId) {
      activeConversationId = null;
      activePeer = null;
      const win = document.getElementById('brisa-chat-window');
      if (win) win.style.display = 'none';
      setChatState({
        isChatOpen: false,
        isMinimized: true,
        activeConversationId: null,
        activePeerUid: null
      });
    }
  }

  // ---------- HANDLERS DE UI ----------
  function attachUIHandlers() {
    const bubble = document.getElementById('brisa-chat-bubble');
    const panel = document.getElementById('brisa-chat-panel');
    const panelClose = document.getElementById('brisa-chat-panel-close');
    const panelSoundToggle = document.getElementById('brisa-chat-panel-sound-toggle');
    const win = document.getElementById('brisa-chat-window');
    const winClose = document.getElementById('brisa-chat-window-close');
    const winMin = document.getElementById('brisa-chat-window-min');
    const deleteConversationBtn = document.getElementById('brisa-chat-delete-conversation');
    const sendBtn = document.getElementById('brisa-chat-send');
    const input = document.getElementById('brisa-chat-input');
    const quickGroup = document.getElementById('brisa-chat-quick-group');
    const quickForo = document.getElementById('brisa-chat-quick-foro');
    const deleteModal = document.getElementById('brisa-chat-delete-modal');
    const deletePass = document.getElementById('brisa-chat-delete-pass');
    const deleteCancel = document.getElementById('brisa-chat-delete-cancel');
    const deleteConfirm = document.getElementById('brisa-chat-delete-confirm');
    const deleteConvModal = document.getElementById('brisa-chat-delete-conv-modal');
    const deleteConvPass = document.getElementById('brisa-chat-delete-conv-pass');
    const deleteConvCancel = document.getElementById('brisa-chat-delete-conv-cancel');
    const deleteConvConfirm = document.getElementById('brisa-chat-delete-conv-confirm');

    let dragTimer = null;
    let dragging = false;
    let suppressClick = false;
    let activePointerId = null;
    let lastSide = 'left';
    let lastTopPx = null;

    const restoreBubblePosition = () => {
      if (!bubble || !isMobileShell()) return;
      const saved = readBubblePosition();
      if (saved) {
        applyBubblePosition(bubble, saved);
      }
    };

    const persistBubblePosition = (side, topPx) => {
      if (!bubble || !isMobileShell()) return;
      const { topMin, topMax } = getBubbleBounds(bubble);
      const clampedTop = clamp(topPx, topMin, topMax);
      const yPct = clampedTop / window.innerHeight;
      saveBubblePosition({ side, yPct });
    };

    if (bubble && isMobileShell()) {
      restoreBubblePosition();
      const handleResize = () => {
        restoreBubblePosition();
      };
      window.addEventListener('resize', handleResize);
      window.addEventListener('orientationchange', handleResize);

      bubble.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        activePointerId = e.pointerId;
        lastSide = e.clientX > window.innerWidth / 2 ? 'right' : 'left';
        lastTopPx = null;
        dragging = false;
        suppressClick = false;
        if (dragTimer) clearTimeout(dragTimer);
        dragTimer = setTimeout(() => {
          dragging = true;
          bubble.classList.add('is-dragging');
          try {
            bubble.setPointerCapture(activePointerId);
          } catch (err) {}
        }, 250);
      });

      bubble.addEventListener('pointermove', (e) => {
        if (!dragging || e.pointerId !== activePointerId) return;
        e.preventDefault();
        const { height, topMin, topMax } = getBubbleBounds(bubble);
        const targetTop = clamp(e.clientY - height / 2, topMin, topMax);
        lastTopPx = targetTop;
        lastSide = e.clientX > window.innerWidth / 2 ? 'right' : 'left';
        bubble.style.top = `${targetTop}px`;
        bubble.style.bottom = 'auto';
        if (lastSide === 'right') {
          bubble.style.right = `${BUBBLE_MARGIN}px`;
          bubble.style.left = 'auto';
        } else {
          bubble.style.left = `${BUBBLE_MARGIN}px`;
          bubble.style.right = 'auto';
        }
      });

      const finalizeDrag = (e) => {
        if (e.pointerId !== activePointerId) return;
        if (dragTimer) {
          clearTimeout(dragTimer);
          dragTimer = null;
        }
        if (dragging) {
          dragging = false;
          suppressClick = true;
          bubble.classList.remove('is-dragging');
          try {
            bubble.releasePointerCapture(activePointerId);
          } catch (err) {}
          const fallbackTop = bubble.getBoundingClientRect().top;
          const finalTop = Number.isFinite(lastTopPx) ? lastTopPx : fallbackTop;
          persistBubblePosition(lastSide, finalTop);
          lastTopPx = null;
          setTimeout(() => {
            suppressClick = false;
          }, 0);
        }
        activePointerId = null;
      };

      bubble.addEventListener('pointerup', finalizeDrag);
      bubble.addEventListener('pointercancel', finalizeDrag);
    }

    if (bubble && panel) {
      bubble.addEventListener('click', () => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        const visible = panel.style.display === 'block';
        panel.style.display = visible ? 'none' : 'block';
        if (visible) {
          minimizeActiveConversation();
          setChatState({
            isChatOpen: false,
            isMinimized: true,
            activeConversationId: null,
            activePeerUid: null
          });
        }
      });
    }
    if (panelClose && panel) {
      panelClose.addEventListener('click', () => {
        panel.style.display = 'none';
        minimizeActiveConversation();
      });
    }
    if (panelSoundToggle) {
      const updateSoundIcon = () => {
        const iconOn = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                <path d="M19 5s2 2 2 7-2 7-2 7" />
                <path d="M15 8s1.5 1.5 1.5 4S15 16 15 16" />
              </svg>`;
        const iconOff = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                <path d="m19 5-4 4" />
                <path d="m15 5 4 4" />
                <path d="m19 19-4-4" />
                <path d="m15 19 4-4" />
              </svg>`;
        panelSoundToggle.innerHTML = soundEnabled ? iconOn : iconOff;
        panelSoundToggle.classList.toggle('is-muted', !soundEnabled);
        panelSoundToggle.setAttribute('aria-label', soundEnabled ? 'Silenciar' : 'Activar sonido');
      };
      updateSoundIcon();
      panelSoundToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        soundEnabled = !soundEnabled;
        localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'muted');
        updateSoundIcon();
      });
    }
    if (winClose && win) {
      winClose.addEventListener('click', () => {
        if (activeConversationId) removeConversation(activeConversationId);
        win.style.display = 'none';
      });
    }
    if (winMin && win) {
      winMin.addEventListener('click', () => {
        minimizeActiveConversation();
      });
    }
    if (deleteConversationBtn) {
      deleteConversationBtn.addEventListener('click', () => {
        showDeleteConversationModal();
      });
    }
    if (sendBtn) {
      sendBtn.addEventListener('click', sendMessage);
    }
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }
    if (quickGroup) {
      quickGroup.addEventListener('click', () => {
        openSpecialConversation('dm_group_chat', 'Chat grupal', 'Sala común · Departamento Médico');
      });
    }
    if (quickForo) {
      quickForo.addEventListener('click', () => {
        openSpecialConversation('dm_foro_general', 'Foro general', 'Mensajes vinculados al foro');
      });
    }
    if (deletePass) {
      deletePass.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmDeleteMessage();
        }
        if (e.key === 'Escape') {
          hideDeleteModal();
        }
      });
      deletePass.addEventListener('click', (e) => e.stopPropagation());
    }
    if (deleteModal) {
      deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) hideDeleteModal();
      });
    }
    if (deleteConvPass) {
      deleteConvPass.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmDeleteConversation();
        }
        if (e.key === 'Escape') {
          hideDeleteConversationModal();
        }
      });
      deleteConvPass.addEventListener('click', (e) => e.stopPropagation());
    }
    if (deleteConvModal) {
      deleteConvModal.addEventListener('click', (e) => {
        if (e.target === deleteConvModal) hideDeleteConversationModal();
      });
    }

    document.addEventListener('click', (e) => {
      const target = e.target;
      const insidePanel = panel?.contains(target);
      const insideWin = win?.contains(target);
      const insideBubble = bubble?.contains(target);
      const insideTray = pillTray?.contains(target);
      const insideDelete = deleteModal?.contains(target);
      const insideDeleteConv = deleteConvModal?.contains(target);
      const insideToast = document.getElementById('brisa-chat-toast')?.contains(target);

      const panelVisible = panel && panel.style.display === 'block';
      const winVisible = win && win.style.display !== 'none';

      if (isDeleteModalOpen || isDeleteConversationModalOpen) return;
      if (isEmbeddedMode()) return;
        if (!insidePanel && !insideWin && !insideBubble && !insideTray && !insideDelete && !insideDeleteConv && !insideToast) {
          if (panelVisible) panel.style.display = 'none';
          if (winVisible) minimizeActiveConversation();
          if (panelVisible) {
            setChatState({
              isChatOpen: false,
              isMinimized: true,
              activeConversationId: null,
              activePeerUid: null
            });
          }
        }
      });

    if (deleteCancel) deleteCancel.addEventListener('click', (e) => { e.stopPropagation(); hideDeleteModal(); });
    if (deleteConfirm) deleteConfirm.addEventListener('click', (e) => { e.stopPropagation(); confirmDeleteMessage(); });
    if (deleteConvCancel) deleteConvCancel.addEventListener('click', (e) => { e.stopPropagation(); hideDeleteConversationModal(); });
    if (deleteConvConfirm) deleteConvConfirm.addEventListener('click', (e) => { e.stopPropagation(); confirmDeleteConversation(); });

    document.addEventListener('click', (e) => {
      const confirmBtn = e.target?.closest && e.target.closest('#brisa-chat-delete-confirm');
      const cancelBtn = e.target?.closest && e.target.closest('#brisa-chat-delete-cancel');
      const confirmConvBtn = e.target?.closest && e.target.closest('#brisa-chat-delete-conv-confirm');
      const cancelConvBtn = e.target?.closest && e.target.closest('#brisa-chat-delete-conv-cancel');
      if (confirmBtn) {
        e.stopPropagation();
        confirmDeleteMessage();
      }
      if (cancelBtn) {
        e.stopPropagation();
        hideDeleteModal();
      }
      if (confirmConvBtn) {
        e.stopPropagation();
        confirmDeleteConversation();
      }
      if (cancelConvBtn) {
        e.stopPropagation();
        hideDeleteConversationModal();
      }
    });
  }

  // ---------- INICIALIZACIÓN GLOBAL ----------
  async function init() {
    const authedUser = await requireAuth(auth);
    if (!authedUser) return;

    injectChatShell();
    attachUIHandlers();
    ['click', 'touchstart', 'keydown', 'pointermove', 'wheel', 'scroll'].forEach(evt => {
      document.addEventListener(evt, primeAudio, { capture: true });
      document.addEventListener(evt, resumePendingSound, { capture: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        scheduleOfflineMark();
        return;
      }
      cancelOfflineMark();
      resumePendingSound();
      primeAudio();
      updateDocumentBadge();
    });
    window.addEventListener('focus', () => {
      resumePendingSound();
      primeAudio();
    });
    // Intento temprano de preparar audio
    primeAudio();
    window.addEventListener('pagehide', () => {
      scheduleOfflineMark();
    }, { capture: true });

    auth.onAuthStateChanged(async user => {
      if (!user) {
        window.location.replace(buildLoginRedirectUrl());
        return;
      }
      currentUser = user || null;
      if (currentUser) {
        currentProfile = null;
        try {
          const snap = await getDoc(doc(db, 'usuarios', currentUser.uid));
          if (snap.exists()) currentProfile = snap.data() || null;
        } catch (e) {
          console.warn('No se pudo cargar el perfil del usuario:', e);
        }
        await updatePresenceStatus(currentUser, currentProfile, true);
        subscribePresence();
        ensureIncomingWatcher();
        updateCountsUI();
      } else {
        await markOffline();
        if (presenceUnsub) presenceUnsub();
        stopIncomingWatcher();
        conversationSubs.forEach(unsub => unsub());
        conversationSubs.clear();
        conversationMessages.clear();
        conversationPeers.clear();
        minimizedPills.forEach(p => p.remove());
        minimizedPills.clear();
        currentProfile = null;
        unreadByConversation.clear();
        totalUnreadCount = 0;
        onlineCount = 0;
        updateCountsUI();
        updateDocumentBadge();
        const loggedFlag = sessionStorage.getItem('isLoggedIn') === 'true';
        if (loggedFlag) {
          showPill('Chat no disponible (Auth). Reingresá sesión.');
        }
      }
      adjustPanelForTray();
    });
  }

  const safeInit = () => {
    init().catch((err) => console.error('[Chat] Error inicializando', err));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeInit);
  } else {
    safeInit();
  }

  // Exponer API mínima para abrir conversaciones desde notificaciones
  window.BrisaChat = {
    openConversation: async (uidOrSpecial) => {
      if (!uidOrSpecial) return;
      if (uidOrSpecial === 'dm_group_chat') {
        openSpecialConversation('dm_group_chat', 'Chat grupal', 'Sala común · Departamento Médico');
        return;
      }
      if (uidOrSpecial === 'dm_foro_general') {
        openSpecialConversation('dm_foro_general', 'Foro general', 'Mensajes vinculados al foro');
        return;
      }
      if (isConversationId(uidOrSpecial)) {
        await openConversationFromId(uidOrSpecial);
        return;
      }
      const name = presenceMap.get(uidOrSpecial)?.name || 'Medico';
      openConversation(uidOrSpecial, name);
      if (currentUser) {
        await hydratePeerProfile(getConversationId(currentUser.uid, uidOrSpecial), uidOrSpecial);
      }
    },
    mount: (containerEl) => {
      mountChat(containerEl);
    },
    unmount: () => {
      unmountChat();
    },
    getState: () => {
      const panel = document.getElementById('brisa-chat-panel');
      const win = document.getElementById('brisa-chat-window');
      const panelVisible = panel && panel.style.display === 'block';
      const winVisible = win && win.style.display !== 'none';
      const isChatOpen = !!(panelVisible && winVisible);
      const isMinimized = !!(panelVisible && !winVisible);
      return {
        isChatOpen,
        isMinimized,
        activeConversationId: isChatOpen ? activeConversationId : null,
        activePeerUid: isChatOpen ? (activePeer?.uid || null) : null,
        tabVisible: document.visibilityState === 'visible' && document.hasFocus()
      };
    }
  };
})();
