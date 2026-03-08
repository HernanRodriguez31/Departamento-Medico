import { getAuth, onAuthStateChanged, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
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
  updateDoc,
  deleteDoc,
  serverTimestamp,
  arrayUnion,
  increment,
  FieldPath
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
  const PRESENCE_STALE_MS = 3 * 60 * 60 * 1000;
  const PRESENCE_HEARTBEAT_MS = 60 * 1000;
  const USER_SEARCH_MIN_CHARS = 2;
  const ASSISTANT_MODEL_STORAGE_KEY = 'dm_ai_model';
  const ASSISTANT_DEFAULT_MODEL = 'gemini';
  const ASSISTANT_SHELL_MODULE_URL = '/assets/js/shared/assistant-shell.js?v=20260306-chat-desktop-layout-1';
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
  const isCompactMobileChat = () => (
    typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches
  );
  const detectChatDesktopContext = () => {
    try {
      const pathname = window.location.pathname || '';
      if (pathname.startsWith('/app/')) return 'app';
      if (pathname.includes('/pages/comites/')) return 'committee';
    } catch (error) {}
    return 'home';
  };
  const isReadByMe = (msg) => {
    if (!currentUser) return false;
    const readBy = Array.isArray(msg?.readBy) ? msg.readBy : [];
    return readBy.includes(currentUser.uid);
  };
  const isMissingDocError = (err) => {
    const code = err?.code || "";
    return code === "not-found" || code === "failed-precondition";
  };

  // Estado en memoria
  let currentUser = null;
  let currentProfile = null;
  let presenceUnsub = null;
  let activeConversationId = null;
  let activePeer = null;
  let embeddedParent = null;
  let embeddedNextSibling = null;
  let mobileFabHomeParent = null;
  let mobileFabHomeNextSibling = null;
  let mobileWindowHomeParent = null;
  let mobileWindowHomeNextSibling = null;

  const conversationSubs = new Map(); // id -> unsub
  const conversationMessages = new Map(); // id -> array de msgs
  const conversationPeers = new Map(); // id -> { uid, name, subtitle }
  const presenceMap = new Map(); // uid -> { name, role }
  const presenceRows = new Map(); // uid -> row element visible en panel
  const minimizedPills = new Map(); // id -> element
  const conversationReady = new Set(); // id inicializado
  let onlineUsers = [];
  let allUsersCache = [];
  let allUsersPromise = null;
  let assistantShellPromise = null;
  let activeSearchQuery = '';
  let isUserDirectoryLoading = false;
  let userDirectoryError = '';
  const chatState = {
    isChatOpen: false,
    isMinimized: true,
    activeConversationId: null,
    activePeerUid: null
  };
  const CHAT_SURFACE_STATES = Object.freeze({
    CLOSED: 'closed',
    OPENING: 'opening',
    OPEN: 'open',
    CLOSING: 'closing'
  });
  const CHAT_SURFACE_META = Object.freeze({
    panel: { display: 'flex', open: 460, close: 320 },
    window: { display: 'flex', open: 420, close: 280 },
    pill: { display: 'flex', open: 260, close: 260 }
  });
  const REDUCED_MOTION_MS = 140;
  const setChatState = (next = {}) => {
    chatState.isChatOpen = Boolean(next.isChatOpen);
    chatState.isMinimized = Boolean(next.isMinimized);
    chatState.activeConversationId = next.activeConversationId ?? chatState.activeConversationId;
    chatState.activePeerUid = next.activePeerUid ?? chatState.activePeerUid;
  };
  let incomingUnsub = null;
  let incomingReady = false;
  let incomingCutoff = null;
  const PANEL_OFFSET_BASE = 0;
  const PANEL_OFFSET_EXTRA = 8;
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
  const timestampToMs = (value) => {
    if (!value) return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.seconds === 'number') {
      return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (value instanceof Date) return value.getTime();
    return 0;
  };
  const isPresenceFresh = (updatedAt) => {
    const updatedMs = timestampToMs(updatedAt);
    if (!updatedMs) return true;
    return Date.now() - updatedMs <= PRESENCE_STALE_MS;
  };
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
  let lastPresenceHeartbeatAt = 0;
  let presenceHeartbeatBound = false;
  let incomingSessionStart = 0;
  let bubblePulseTimeout = null;
  let bubbleReactionTimeout = null;
  let lastBubblePulseAt = 0;
  let cancelBubbleDragSession = null;
  const BUBBLE_MARGIN = 8;
  const BUBBLE_TOP_MIN = 80;
  const BUBBLE_BOTTOM_GAP = 154;
  const BUBBLE_DEFAULT_SIDE = 'right';
  const BUBBLE_DEFAULT_Y_PCT = 1;
  const BUBBLE_DRAG_THRESHOLD_PX = 5;
  const BUBBLE_SNAP_TRANSITION_MS = 180;
  const bubblePositionKey = () => `brisa_chat_bubble_pos_v2_${currentUser?.uid || auth?.currentUser?.uid || 'anon'}`;

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
      #brisa-chat-root {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 21500;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        --dm-fab-bottom: 18px;
        --brisa-chat-fab-left: 18px;
        --brisa-chat-fab-right: 8px;
        --brisa-chat-mobile-fab-bottom: calc(var(--bottom-nav-h, 0px) + 36px + env(safe-area-inset-bottom));
        --brisa-chat-panel-width: 18rem;
        --brisa-chat-panel-gap: 16px;
        --brisa-chat-window-gap: 18px;
        --brisa-chat-window-left: 292px;
        --brisa-chat-open-ease: cubic-bezier(.22, 1, .36, 1);
        --brisa-chat-close-ease: cubic-bezier(.4, 0, .2, 1);
        --brisa-chat-panel-open-ms: 460ms;
        --brisa-chat-panel-close-ms: 320ms;
        --brisa-chat-window-open-ms: 420ms;
        --brisa-chat-window-close-ms: 280ms;
        --brisa-chat-pill-ms: 260ms;
        --brisa-chat-mobile-border: #7ab800;
      }

      .brisa-chat-mobile-viewport {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        max-width: calc(100vw - 32px);
        pointer-events: none;
      }

      .brisa-chat-mobile-stack {
        position: relative;
        display: flex;
        flex-direction: column;
        width: min(100%, 420px);
        height: min(85vh, calc(100dvh - 32px));
        max-height: min(85vh, calc(100dvh - 32px));
        background: #ffffff;
        border-radius: 24px;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.26);
        overflow: hidden;
        pointer-events: auto;
      }

      .brisa-chat-fab {
        position: fixed;
        left: var(--brisa-chat-fab-left, 18px);
        right: auto;
        top: auto;
        bottom: var(--dm-fab-bottom, 18px);
        width: var(--dm-chat-fab-size, 58px);
        height: var(--dm-chat-fab-size, 58px);
        z-index: 50;
        --brisa-chat-panel-shift-x: -12px;
        --brisa-chat-panel-origin-x: 28px;
      }

      .brisa-chat-fab[data-side="right"] {
        --brisa-chat-panel-shift-x: 12px;
        --brisa-chat-panel-origin-x: calc(100% - 28px);
      }

      .brisa-chat-fab .brisa-chat-bubble {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: auto;
        touch-action: none;
        user-select: none;
        -webkit-user-drag: none;
        -webkit-tap-highlight-color: transparent;
        cursor: grab;
        transform: translateZ(0);
        transform-origin: center;
        backface-visibility: hidden;
        transition: filter 220ms ease, box-shadow 220ms ease, transform 220ms ease;
      }

      .brisa-chat-fab .brisa-chat-bubble svg,
      .brisa-chat-fab .brisa-chat-bubble img {
        pointer-events: none;
        user-select: none;
        -webkit-user-drag: none;
      }

      .brisa-chat-fab .brisa-chat-panel {
        position: absolute;
        bottom: calc(120% + var(--brisa-panel-offset, 0px));
        right: 0;
        left: auto;
        width: var(--brisa-chat-panel-width, 18rem);
        display: none;
        flex-direction: column;
        max-height: min(420px, var(--brisa-panel-max-height, 420px));
        background: rgba(255, 255, 255, 0.94);
        -webkit-backdrop-filter: blur(18px);
        backdrop-filter: blur(18px);
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.65);
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
        overflow: hidden;
        z-index: 40;
        pointer-events: none;
        visibility: hidden;
        opacity: 0;
        transform: translate3d(var(--brisa-chat-panel-shift-x, -12px), 24px, 0) scale(0.26, 0.38);
        transform-origin: var(--brisa-chat-panel-origin-x, 28px) calc(100% + 18px);
        filter: blur(12px) saturate(0.92);
        clip-path: inset(18% 10% 0 10% round 999px);
        will-change: transform, opacity, filter, clip-path, border-radius;
      }

      .brisa-chat-fab[data-side="left"] .brisa-chat-panel {
        left: 0;
        right: auto;
      }

      .brisa-chat-window {
        position: fixed;
        bottom: 84px;
        left: var(--brisa-chat-window-left, 292px);
        width: 320px;
        max-height: 420px;
        background: linear-gradient(160deg, rgba(255, 255, 255, 0.98), rgba(247, 249, 252, 0.95));
        -webkit-backdrop-filter: blur(18px);
        backdrop-filter: blur(18px);
        border-radius: 18px;
        border: 1px solid rgba(15, 23, 42, 0.05);
        box-shadow: 0 14px 38px rgba(15, 23, 42, 0.16);
        display: none;
        flex-direction: column;
        pointer-events: none;
        z-index: 45;
        visibility: hidden;
        opacity: 0;
        --brisa-chat-window-from-x: -42px;
        --brisa-chat-window-from-y: 24px;
        --brisa-chat-window-scale-x: 0.82;
        --brisa-chat-window-scale-y: 0.88;
        transform: translate3d(var(--brisa-chat-window-from-x), var(--brisa-chat-window-from-y), 0) scale(var(--brisa-chat-window-scale-x), var(--brisa-chat-window-scale-y));
        transform-origin: 0 100%;
        filter: blur(10px) saturate(0.94);
        will-change: transform, opacity, filter, border-radius;
      }

      .brisa-chat-pill {
        position: fixed;
        bottom: 18px;
        left: 86px;
        height: 34px;
        max-width: 220px;
        padding: 0 12px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.9);
        -webkit-backdrop-filter: blur(14px);
        backdrop-filter: blur(14px);
        border: 1px solid rgba(209, 213, 219, 0.85);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
        display: none;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        pointer-events: none;
        visibility: hidden;
        opacity: 0;
        transform: translate3d(-34px, 18px, 0) scale(0.8);
        transform-origin: 0 100%;
        filter: blur(10px) saturate(0.96);
        will-change: transform, opacity, filter;
      }

      .brisa-chat-pill-tray {
        position: fixed;
        bottom: 18px;
        left: 86px;
        display: flex;
        flex-direction: column-reverse;
        gap: 8px;
        align-items: flex-start;
        z-index: 21500;
        pointer-events: auto;
      }

      .brisa-chat-pill--tray {
        position: static;
        width: 210px;
        pointer-events: auto;
        display: flex;
        align-items: center;
        padding-left: 10px;
        padding-right: 10px;
      }

      .brisa-chat-panel[data-chat-origin="panel"] {
        transform-origin: 20px 20px;
      }

      .brisa-chat-window[data-chat-origin="panel"] {
        --brisa-chat-window-from-x: -40px;
        --brisa-chat-window-from-y: 24px;
        --brisa-chat-window-scale-x: 0.82;
        --brisa-chat-window-scale-y: 0.88;
        transform-origin: 0 100%;
      }

      .brisa-chat-window[data-chat-origin="pill"] {
        --brisa-chat-window-from-x: -78px;
        --brisa-chat-window-from-y: 38px;
        --brisa-chat-window-scale-x: 0.62;
        --brisa-chat-window-scale-y: 0.42;
        transform-origin: 0 100%;
      }

      .brisa-chat-window[data-chat-origin="bubble"] {
        --brisa-chat-window-from-x: 0px;
        --brisa-chat-window-from-y: 82px;
        --brisa-chat-window-scale-x: 0.54;
        --brisa-chat-window-scale-y: 0.28;
        transform-origin: 24px calc(100% - 18px);
      }

      .brisa-chat-panel[data-chat-state="open"],
      .brisa-chat-window[data-chat-state="open"],
      .brisa-chat-pill[data-chat-state="open"] {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: translate3d(0, 0, 0) scale(1);
        filter: blur(0) saturate(1);
        clip-path: inset(0 round 18px);
      }

      .brisa-chat-pill[data-chat-state="open"] {
        clip-path: none;
      }

      .brisa-chat-panel[data-chat-state="opening"],
      .brisa-chat-panel[data-chat-state="closing"],
      .brisa-chat-window[data-chat-state="opening"],
      .brisa-chat-window[data-chat-state="closing"],
      .brisa-chat-pill[data-chat-state="opening"],
      .brisa-chat-pill[data-chat-state="closing"] {
        visibility: visible;
        pointer-events: none;
      }

      .brisa-chat-panel[data-chat-state="opening"] {
        animation: brisaChatPanelOpen var(--brisa-chat-panel-open-ms) var(--brisa-chat-open-ease) forwards;
      }

      .brisa-chat-panel[data-chat-state="closing"] {
        animation: brisaChatPanelClose var(--brisa-chat-panel-close-ms) var(--brisa-chat-close-ease) forwards;
      }

      .brisa-chat-window[data-chat-state="opening"] {
        animation: brisaChatWindowOpen var(--brisa-chat-window-open-ms) var(--brisa-chat-open-ease) forwards;
      }

      .brisa-chat-window[data-chat-state="closing"] {
        animation: brisaChatWindowClose var(--brisa-chat-window-close-ms) var(--brisa-chat-close-ease) forwards;
      }

      .brisa-chat-pill[data-chat-state="opening"] {
        animation: brisaChatPillOpen var(--brisa-chat-pill-ms) var(--brisa-chat-open-ease) forwards;
      }

      .brisa-chat-pill[data-chat-state="closing"] {
        animation: brisaChatPillClose var(--brisa-chat-pill-ms) var(--brisa-chat-close-ease) forwards;
      }

      .brisa-chat-bubble--pulse { animation: brisaChatPulse 0.9s ease-out; }
      .brisa-chat-fab.is-dragging {
        transition: none !important;
        will-change: transform;
      }
      .brisa-chat-fab.is-snapping {
        transition:
          top ${BUBBLE_SNAP_TRANSITION_MS}ms var(--brisa-chat-open-ease),
          left ${BUBBLE_SNAP_TRANSITION_MS}ms var(--brisa-chat-open-ease),
          right ${BUBBLE_SNAP_TRANSITION_MS}ms var(--brisa-chat-open-ease),
          transform ${BUBBLE_SNAP_TRANSITION_MS}ms var(--brisa-chat-open-ease);
      }
      .brisa-chat-bubble.is-dragging {
        opacity: .9;
        cursor: grabbing;
      }
      .brisa-chat-bubble[data-chat-react="opening"] {
        animation: brisaChatBubbleOpen 460ms var(--brisa-chat-open-ease);
      }

      .brisa-chat-bubble[data-chat-react="closing"] {
        animation: brisaChatBubbleClose 320ms var(--brisa-chat-close-ease);
      }

      .brisa-chat-bubble[data-chat-react="restoring"] {
        animation: brisaChatBubbleRestore 260ms var(--brisa-chat-open-ease);
      }

      .brisa-chat-bubble::after {
        content: '';
        position: absolute;
        inset: -8px;
        border-radius: 999px;
        border: 1px solid rgba(122, 184, 0, 0.28);
        opacity: 0;
        animation: pulse-glow 3s ease-out infinite;
        pointer-events: none;
      }

      .brisa-chat-bubble:hover::after {
        animation-play-state: paused;
        opacity: 0;
      }

      @keyframes brisaChatPulse {
        0% { transform: scale(1); }
        30% { transform: scale(1.08); }
        100% { transform: scale(1); }
      }

      @keyframes brisaChatBubbleOpen {
        0% {
          transform: scale(1) translateY(0);
          filter: brightness(1);
        }
        38% {
          transform: scale(0.92, 1.12) translateY(1px);
          filter: brightness(1.08);
        }
        62% {
          transform: scale(1.06, 0.95) translateY(-1px);
          filter: brightness(1.12);
        }
        100% {
          transform: scale(1) translateY(0);
          filter: brightness(1);
        }
      }

      @keyframes brisaChatBubbleClose {
        0% {
          transform: scale(1) translateY(0);
          filter: brightness(1);
        }
        35% {
          transform: scale(1.04, 0.96);
          filter: brightness(1.08);
        }
        100% {
          transform: scale(0.96, 1.04);
          filter: brightness(1);
        }
      }

      @keyframes brisaChatBubbleRestore {
        0% {
          transform: scale(0.94);
          filter: brightness(1.04);
        }
        55% {
          transform: scale(1.06);
          filter: brightness(1.1);
        }
        100% {
          transform: scale(1);
          filter: brightness(1);
        }
      }

      @keyframes brisaChatPanelOpen {
        0% {
          opacity: 0;
          transform: translate3d(var(--brisa-chat-panel-shift-x, -12px), 24px, 0) scale(0.26, 0.38);
          border-radius: 999px;
          filter: blur(12px) saturate(0.92);
          clip-path: inset(18% 10% 0 10% round 999px);
        }
        58% {
          opacity: 1;
          transform: translate3d(0, -4px, 0) scale(1.02, 1.03);
          border-radius: 28px;
          filter: blur(0) saturate(1);
          clip-path: inset(0 round 28px);
        }
        100% {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          border-radius: 18px;
          filter: blur(0) saturate(1);
          clip-path: inset(0 round 18px);
        }
      }

      @keyframes brisaChatPanelClose {
        0% {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          border-radius: 18px;
          filter: blur(0) saturate(1);
          clip-path: inset(0 round 18px);
        }
        38% {
          opacity: 1;
          transform: translate3d(0, -2px, 0) scale(0.94, 0.96);
          border-radius: 26px;
          clip-path: inset(0 round 26px);
        }
        100% {
          opacity: 0;
          transform: translate3d(var(--brisa-chat-panel-shift-x, -12px), 24px, 0) scale(0.26, 0.38);
          border-radius: 999px;
          filter: blur(12px) saturate(0.92);
          clip-path: inset(18% 10% 0 10% round 999px);
        }
      }

      @keyframes brisaChatWindowOpen {
        0% {
          opacity: 0;
          transform: translate3d(var(--brisa-chat-window-from-x), var(--brisa-chat-window-from-y), 0) scale(var(--brisa-chat-window-scale-x), var(--brisa-chat-window-scale-y));
          border-radius: 28px;
          filter: blur(10px) saturate(0.94);
        }
        55% {
          opacity: 1;
          transform: translate3d(0, -4px, 0) scale(1.02);
          border-radius: 22px;
          filter: blur(0) saturate(1);
        }
        100% {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          border-radius: 18px;
          filter: blur(0) saturate(1);
        }
      }

      @keyframes brisaChatWindowClose {
        0% {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          border-radius: 18px;
          filter: blur(0) saturate(1);
        }
        36% {
          opacity: 1;
          transform: translate3d(0, -2px, 0) scale(0.94);
          border-radius: 24px;
        }
        100% {
          opacity: 0;
          transform: translate3d(var(--brisa-chat-window-from-x), var(--brisa-chat-window-from-y), 0) scale(var(--brisa-chat-window-scale-x), var(--brisa-chat-window-scale-y));
          border-radius: 30px;
          filter: blur(10px) saturate(0.94);
        }
      }

      @keyframes brisaChatPillOpen {
        0% {
          opacity: 0;
          transform: translate3d(-34px, 18px, 0) scale(0.8);
          filter: blur(10px) saturate(0.96);
        }
        60% {
          opacity: 1;
          transform: translate3d(0, -2px, 0) scale(1.04);
          filter: blur(0) saturate(1);
        }
        100% {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          filter: blur(0) saturate(1);
        }
      }

      @keyframes brisaChatPillClose {
        0% {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          filter: blur(0) saturate(1);
        }
        100% {
          opacity: 0;
          transform: translate3d(-34px, 18px, 0) scale(0.8);
          filter: blur(10px) saturate(0.96);
        }
      }

      @keyframes pulse-glow {
        0% { transform: scale(0.95); opacity: 0.35; }
        70% { transform: scale(1.35); opacity: 0; }
        100% { transform: scale(1.35); opacity: 0; }
      }

      @media (prefers-reduced-motion: reduce) {
        #brisa-chat-root {
          --brisa-chat-panel-open-ms: 140ms;
          --brisa-chat-panel-close-ms: 140ms;
          --brisa-chat-window-open-ms: 140ms;
          --brisa-chat-window-close-ms: 140ms;
          --brisa-chat-pill-ms: 140ms;
        }

        .brisa-chat-bubble,
        .brisa-chat-panel,
        .brisa-chat-window,
        .brisa-chat-pill {
          transition-duration: 140ms !important;
        }

        .brisa-chat-bubble::after {
          animation: none;
          opacity: 0;
        }
      }

      @media (max-width: 768px), (display-mode: standalone) {
        #brisa-chat-pill-tray { display: none !important; }
        .brisa-chat-fab {
          left: auto;
          right: var(--brisa-chat-fab-right, 8px);
          top: auto;
          bottom: var(--brisa-chat-mobile-fab-bottom, calc(var(--bottom-nav-h, 0px) + 36px + env(safe-area-inset-bottom)));
        }
        .brisa-chat-fab .brisa-chat-panel {
          width: min(21rem, calc(100vw - 16px));
        }
        .brisa-chat-window {
          left: 8px;
          right: 8px;
          width: auto;
          height: min(76dvh, 620px);
          max-height: calc(100dvh - 20px - env(safe-area-inset-bottom));
          bottom: calc(var(--bottom-nav-h, 0px) + 76px + env(safe-area-inset-bottom));
          border-radius: 20px;
        }
        .brisa-chat-window-header {
          padding: 10px 14px;
        }
        .brisa-chat-window-subtitle {
          padding: 0 18px 4px;
        }
        .brisa-chat-window-body {
          padding: 10px 10px 8px;
        }
        .brisa-chat-window-footer {
          padding: 8px 10px 10px;
          gap: 6px;
        }
      }

      @media (min-width: 1024px) {
        #brisa-chat-root[data-chat-context="home"] {
          --dm-fab-bottom: 2rem;
          --brisa-chat-fab-left: 32px;
          --brisa-chat-window-left: calc(
            var(--brisa-chat-fab-left, 32px) +
            var(--dm-chat-fab-size, 58px) +
            var(--brisa-chat-panel-gap, 16px) +
            var(--brisa-chat-panel-width, 18rem) +
            var(--brisa-chat-window-gap, 18px)
          );
        }

        #brisa-chat-root[data-chat-context="committee"] {
          --dm-fab-bottom: 18px;
          --brisa-chat-fab-left: 18px;
          --brisa-chat-window-left: calc(
            var(--brisa-chat-fab-left, 18px) +
            var(--brisa-chat-panel-width, 18rem) +
            var(--brisa-chat-window-gap, 18px)
          );
        }

        #brisa-chat-root[data-chat-context="app"] {
          --brisa-chat-fab-left: 0px;
          --brisa-chat-window-left: 292px;
        }

        .brisa-chat-fab {
          left: var(--brisa-chat-fab-left, 32px);
          bottom: var(--dm-fab-bottom, 2rem);
        }

        #brisa-chat-root[data-chat-context="home"] .brisa-chat-fab[data-side="left"] .brisa-chat-panel,
        #brisa-chat-root[data-chat-context="app"] .brisa-chat-fab[data-side="left"] .brisa-chat-panel {
          left: calc(100% + var(--brisa-chat-panel-gap, 16px));
          right: auto;
        }

        #brisa-chat-root[data-chat-context="committee"] .brisa-chat-fab[data-side="left"] .brisa-chat-panel {
          left: 0;
          right: auto;
        }

        .brisa-chat-fab[data-side="left"] .brisa-chat-panel {
          left: calc(100% + var(--brisa-chat-panel-gap, 16px));
          right: auto;
        }
      }

      .app-shell #brisa-chat-root .brisa-chat-fab {
        bottom: calc(var(--bottom-nav-h) + 20px + env(safe-area-inset-bottom));
        left: var(--brisa-chat-fab-left, 0px);
        right: auto;
        top: auto;
      }

      @media (max-width: 768px), (display-mode: standalone) {
        .app-shell #brisa-chat-root .brisa-chat-fab {
          bottom: var(--brisa-chat-mobile-fab-bottom, calc(var(--bottom-nav-h, 0px) + 36px + env(safe-area-inset-bottom)));
          left: auto;
          right: var(--brisa-chat-fab-right, 8px);
        }
      }

      .brisa-chat-search {
        position: sticky;
        top: 0;
        z-index: 2;
        padding: 10px 12px 8px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.06);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(249, 250, 251, 0.98));
        box-shadow: 0 10px 22px rgba(15, 23, 42, 0.05);
      }

      .brisa-chat-search-label {
        display: block;
        margin-bottom: 6px;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #9ca3af;
      }

      .brisa-chat-search-field {
        position: relative;
      }

      .brisa-chat-search-icon {
        position: absolute;
        left: 10px;
        top: 50%;
        transform: translateY(-50%);
        width: 14px;
        height: 14px;
        color: #94a3b8;
        pointer-events: none;
      }

      .brisa-chat-search-input {
        width: 100%;
        min-height: 38px;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: rgba(255, 255, 255, 0.96);
        padding: 0 12px 0 34px;
        font-size: 12px;
        color: #0f172a;
        outline: none;
        transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
      }

      .brisa-chat-search-input:focus {
        border-color: rgba(122, 184, 0, 0.48);
        box-shadow: 0 0 0 3px rgba(122, 184, 0, 0.12);
        background: #fff;
      }

      .brisa-chat-search-status {
        min-height: 16px;
        margin-top: 6px;
        font-size: 11px;
        line-height: 1.35;
        color: #6b7280;
      }

      .brisa-chat-search-status[data-tone="error"] {
        color: #b42318;
      }

      .brisa-chat-search-status[data-tone="success"] {
        color: #3f6212;
      }

      .brisa-chat-search-status[data-tone="loading"] {
        color: #475467;
      }

      .brisa-chat-search-status[data-tone="hint"] {
        color: #667085;
      }

      .brisa-chat-empty {
        padding: 12px 14px 14px;
        font-size: 12px;
        color: #6b7280;
      }

      .brisa-chat-panel-body {
        display: flex;
        flex-direction: column;
        min-height: 0;
        max-height: none;
        overflow: hidden;
      }

      .brisa-chat-panel-scroll {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-bottom: 8px;
      }

      .brisa-chat-section-label--split {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      #brisa-chat-users {
        display: flex;
        flex-direction: column;
      }

      .brisa-chat-row-main {
        min-width: 0;
      }

      .brisa-chat-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .brisa-chat-meta {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        line-clamp: 2;
      }

      .brisa-chat-row--offline .brisa-chat-status-dot {
        background: #cbd5e1;
        box-shadow: none;
      }

      .brisa-chat-row--offline .brisa-chat-icon-btn {
        background: rgba(148, 163, 184, 0.12);
      }

      .brisa-chat-row--offline .brisa-chat-icon-btn svg {
        color: #64748b;
      }

      .brisa-chat-row--assistant {
        position: relative;
        align-items: center;
        gap: 10px;
        border: 1px solid rgba(122, 184, 0, 0.16);
        background: linear-gradient(180deg, rgba(247, 251, 241, 0.96), rgba(255, 255, 255, 0.98));
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.88);
      }

      .brisa-chat-row--assistant:hover {
        border-color: rgba(122, 184, 0, 0.26);
        box-shadow: 0 10px 22px rgba(122, 184, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.92);
      }

      .brisa-chat-status-dot--assistant {
        width: 18px;
        height: 18px;
        min-width: 18px;
        border-radius: 999px;
        background: linear-gradient(135deg, #16a34a 0%, #7ab800 55%, #d1e975 100%);
        box-shadow: 0 8px 18px rgba(122, 184, 0, 0.22);
        color: #ffffff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .brisa-chat-status-dot--assistant svg {
        width: 10px;
        height: 10px;
      }

      .brisa-chat-row-accent {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        min-width: 68px;
        padding: 5px 8px;
        border-radius: 999px;
        border: 1px solid rgba(122, 184, 0, 0.2);
        background: rgba(122, 184, 0, 0.1);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
        color: #3f6212;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.03em;
        white-space: nowrap;
      }

      .brisa-chat-row--assistant[data-model="gpt"] .brisa-chat-row-accent {
        border-color: rgba(15, 23, 42, 0.12);
        background: rgba(15, 23, 42, 0.06);
        color: #0f172a;
      }

      .brisa-chat-mobile-overlay {
        pointer-events: none;
      }

      .brisa-chat-mobile-overlay.hidden {
        display: none !important;
      }

      .brisa-chat-window-back {
        display: none;
      }

      .brisa-chat-window-heading {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        flex: 1 1 auto;
      }

      @media (max-width: 640px) {
        #brisa-chat-root.brisa-chat-root--mobile-open {
          pointer-events: auto;
        }

        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-mobile-overlay:not(.hidden) {
          pointer-events: auto;
        }

        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-mobile-viewport {
          pointer-events: none;
        }

        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-mobile-stack {
          pointer-events: auto;
        }

        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-fab {
          position: static !important;
          inset: auto !important;
          left: auto !important;
          right: auto !important;
          top: auto !important;
          bottom: auto !important;
          width: 100% !important;
          height: 100% !important;
          display: block;
          pointer-events: auto;
          z-index: auto;
        }

        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-bubble {
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transform: scale(0.92);
        }

        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-fab .brisa-chat-panel,
        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-window {
          position: absolute !important;
          inset: 0 !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100% !important;
          max-width: none !important;
          height: 100% !important;
          max-height: none !important;
          margin: 0 !important;
          border: 0 !important;
          border-radius: inherit !important;
          background: #ffffff !important;
          box-shadow: none !important;
          overflow: hidden;
          animation: none !important;
          filter: none !important;
          clip-path: none !important;
          transition: opacity 300ms ease, transform 300ms ease, visibility 300ms ease;
        }

        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-fab .brisa-chat-panel {
          z-index: 1;
          transform: translate3d(0, 12px, 0) scale(0.98);
          transform-origin: center;
        }

        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-window {
          z-index: 2;
          transform: translate3d(0, 12px, 0) scale(0.98);
          transform-origin: center;
        }

        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-fab .brisa-chat-panel[data-chat-state="open"],
        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-fab .brisa-chat-panel[data-chat-state="opening"],
        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-window[data-chat-state="open"],
        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-window[data-chat-state="opening"] {
          opacity: 1;
          visibility: visible;
          pointer-events: auto;
        }

        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-fab .brisa-chat-panel[data-chat-state="open"],
        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-fab .brisa-chat-panel[data-chat-state="opening"] {
          transform: translate3d(0, 0, 0) scale(1);
        }

        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-window[data-chat-state="open"],
        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-window[data-chat-state="opening"] {
          transform: translate3d(0, 0, 0) scale(1);
        }

        #brisa-chat-root.brisa-chat-root--mobile-detail .brisa-chat-fab .brisa-chat-panel {
          transform: translate3d(0, 0, 0) scale(0.985);
          opacity: 0.96;
          pointer-events: none;
        }

        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-badge,
        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-pill,
        #brisa-chat-root.brisa-chat-root--mobile-open .brisa-chat-pill-tray {
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
        }

        .brisa-chat-panel-header,
        .brisa-chat-window-header {
          padding: 18px 18px 14px;
          border-bottom: 1px solid rgba(226, 232, 240, 0.9);
          background: #ffffff;
        }

        .brisa-chat-panel-body,
        .brisa-chat-window-body {
          min-height: 0;
        }

        .brisa-chat-panel-body {
          display: flex;
          flex-direction: column;
          flex: 1 1 auto;
        }

        .brisa-chat-panel-scroll {
          min-height: 0;
          flex: 1 1 auto;
          padding-bottom: 12px;
        }

        .brisa-chat-window-subtitle {
          padding-left: 18px;
          padding-right: 18px;
        }

        .brisa-chat-window-body {
          flex: 1 1 auto;
        }

        .brisa-chat-window-footer {
          padding: 14px 16px calc(16px + env(safe-area-inset-bottom));
          background: #ffffff;
        }

        .brisa-chat-window-actions {
          margin-left: auto;
          gap: 8px;
          align-items: center;
        }

        .brisa-chat-window-title {
          min-width: 0;
        }

        .brisa-chat-window-back {
          display: inline-flex;
          order: 0;
          flex: 0 0 auto;
        }

        #brisa-chat-window-min {
          display: none;
        }

        #brisa-chat-delete-conversation {
          order: 1;
        }

        #brisa-chat-window-close {
          order: 2;
        }

        .brisa-chat-pill-btn {
          width: 44px;
          height: 44px;
          border-radius: 14px;
        }

        .brisa-chat-pill-btn svg {
          width: 20px;
          height: 20px;
        }
      }

      @media (max-width: 640px) and (prefers-reduced-motion: reduce) {
        .brisa-chat-mobile-overlay,
        .brisa-chat-fab .brisa-chat-panel,
        .brisa-chat-window,
        .brisa-chat-bubble {
          transition: none !important;
          animation: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  };

  const ensureAssistantShellStylesInjected = () => {
    if (document.getElementById('brisa-chat-assistant-style')) return;
    const style = document.createElement('style');
    style.id = 'brisa-chat-assistant-style';
    style.textContent = `
      .dm-ai-shell {
        position: fixed;
        inset: 0;
        z-index: 99999;
        pointer-events: none;
      }

      .dm-ai-shell.is-open {
        pointer-events: auto;
      }

      .dm-ai-selector {
        position: fixed;
        left: 88px;
        top: 50%;
        transform: translateY(-50%) translateX(-8px);
        display: flex;
        flex-direction: column;
        gap: 12px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease, transform 0.2s ease;
        z-index: 99999;
      }

      .dm-ai-selector.is-open {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(-50%) translateX(0);
      }

      .dm-ai-selector__btn {
        width: 44px;
        height: 44px;
        border-radius: 999px;
        border: 1.5px solid var(--primary-color, #2e6b46);
        background: #ffffff;
        display: grid;
        place-items: center;
        box-shadow: 0 8px 18px rgba(46, 107, 70, 0.18);
        color: #0f172a;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .dm-ai-selector__btn.is-active {
        box-shadow: 0 10px 22px rgba(46, 107, 70, 0.28);
        transform: translateY(-1px);
      }

      .dm-ai-selector__btn svg {
        width: 20px;
        height: 20px;
      }

      .dm-ai-shell--desktop .dm-ai-backdrop {
        position: absolute;
        inset: 0;
        background: transparent;
        opacity: 0;
      }

      .dm-ai-shell--desktop .dm-ai-panel {
        position: absolute;
        left: 88px;
        top: 50%;
        transform: translateY(-50%) scale(0.98);
        width: 440px;
        height: 600px;
        max-height: calc(100vh - 24px);
        background: #ffffff;
        border-radius: 18px;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.25);
        display: flex;
        flex-direction: column;
        opacity: 0;
        transition: transform 0.2s ease, opacity 0.2s ease;
        z-index: 99999;
        overflow: hidden;
      }

      .dm-ai-shell--desktop.is-open .dm-ai-panel {
        opacity: 1;
        transform: translateY(-50%) scale(1);
      }

      .dm-ai-shell--desktop .dm-ai-body,
      .dm-ai-shell .dm-ai-body {
        flex: 1 1 auto;
        overflow: hidden;
      }

      .dm-ai-shell--desktop .dm-ai-iframe,
      .dm-ai-shell .dm-ai-iframe {
        width: 100%;
        height: 100%;
        border: 0;
        background: #f8fafc;
        display: none;
      }

      .dm-ai-shell--desktop .dm-ai-iframe.is-active,
      .dm-ai-shell .dm-ai-iframe.is-active {
        display: block;
      }

      @media (min-width: 1024px) {
        .dm-ai-selector__btn {
          width: 56px;
          height: 56px;
        }

        .dm-ai-selector__btn svg {
          width: 24px;
          height: 24px;
        }

        .dm-ai-selector--anchored {
          transform: translateX(-8px);
        }

        .dm-ai-selector--anchored.is-open {
          transform: translateX(0);
        }

        .dm-ai-shell--anchored .dm-ai-panel {
          transform: scale(0.98);
        }

        .dm-ai-shell--anchored.is-open .dm-ai-panel {
          transform: scale(1);
        }
      }

      @media (max-width: 1023px) {
        .dm-ai-selector {
          left: 50%;
          top: auto;
          bottom: calc(env(safe-area-inset-bottom) + 108px);
          transform: translate(-50%, 12px);
          flex-direction: row;
          align-items: center;
          z-index: 22005;
        }

        .dm-ai-selector.is-open {
          transform: translate(-50%, 0);
        }

        .dm-ai-selector__btn {
          width: 46px;
          height: 46px;
        }

        .dm-ai-selector__btn svg {
          width: 22px;
          height: 22px;
        }

        .dm-ai-shell {
          z-index: 22000;
        }

        .dm-ai-shell .dm-ai-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(15, 23, 42, 0.55);
          opacity: 0;
          transition: opacity 0.2s ease;
        }

        .dm-ai-shell.is-open .dm-ai-backdrop {
          opacity: 1;
        }

        .dm-ai-shell .dm-ai-panel {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 85vh;
          background: #ffffff;
          border-radius: 18px 18px 0 0;
          box-shadow: 0 -24px 50px rgba(15, 23, 42, 0.2);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          transform: translateY(100%);
          transition: transform 0.25s ease;
        }

        .dm-ai-shell.is-open .dm-ai-panel {
          transform: translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const normalizeChatOrigin = (origin, fallback = 'bubble') => (
    origin === 'panel' || origin === 'pill' || origin === 'bubble'
      ? origin
      : fallback
  );
  const getSurfaceDisplay = (kind) => CHAT_SURFACE_META[kind]?.display || 'block';
  const getSurfaceDuration = (kind, phase) => (
    prefersReducedMotion()
      ? REDUCED_MOTION_MS
      : (CHAT_SURFACE_META[kind]?.[phase] || 0)
  );
  const getSurfaceState = (el) => el?.dataset?.chatState || CHAT_SURFACE_STATES.CLOSED;
  const isSurfaceOpenish = (el) => getSurfaceState(el) !== CHAT_SURFACE_STATES.CLOSED;

  function applySurfaceState(el, state, origin) {
    if (!el) return;
    const isVisibleState =
      state === CHAT_SURFACE_STATES.OPEN || state === CHAT_SURFACE_STATES.OPENING;
    if (!isVisibleState) {
      const active = document.activeElement;
      if (
        active &&
        active !== document.body &&
        el.contains(active) &&
        typeof active.blur === 'function'
      ) {
        active.blur();
      }
    }
    el.dataset.chatState = state;
    el.dataset.chatOrigin = normalizeChatOrigin(origin, el.dataset.chatOrigin || 'bubble');
    el.setAttribute('aria-hidden', isVisibleState ? 'false' : 'true');
    if ('inert' in el) {
      el.inert = !isVisibleState;
    }
  }

  function clearSurfaceTransition(el) {
    if (!el?._brisaChatTransition) return;
    const transition = el._brisaChatTransition;
    if (transition.rafOne) cancelAnimationFrame(transition.rafOne);
    if (transition.rafTwo) cancelAnimationFrame(transition.rafTwo);
    if (transition.timeoutId) clearTimeout(transition.timeoutId);
    if (typeof transition.cleanup === 'function') transition.cleanup();
    delete el._brisaChatTransition;
  }

  function finalizeSurfaceMutation(kind) {
    if (kind === 'pill') {
      adjustPanelForTray();
    }
    if (kind === 'panel') {
      syncPanelViewportBounds();
    }
  }

  function setSurfaceImmediate(el, kind, visible, origin = 'bubble') {
    if (!el) return;
    clearSurfaceTransition(el);
    applySurfaceState(
      el,
      visible ? CHAT_SURFACE_STATES.OPEN : CHAT_SURFACE_STATES.CLOSED,
      origin
    );
    el.style.display = visible ? getSurfaceDisplay(kind) : 'none';
    finalizeSurfaceMutation(kind);
  }

  function transitionSurface(el, kind, visible, { origin = 'bubble', immediate = false } = {}) {
    if (!el) return Promise.resolve(false);

    const normalizedOrigin = normalizeChatOrigin(origin, kind === 'window' ? 'panel' : 'bubble');
    const currentState = getSurfaceState(el);
    const currentVisible = currentState === CHAT_SURFACE_STATES.OPEN || currentState === CHAT_SURFACE_STATES.OPENING;

    if (immediate) {
      setSurfaceImmediate(el, kind, visible, normalizedOrigin);
      return Promise.resolve(true);
    }

    if (visible && currentVisible) {
      applySurfaceState(el, currentState, normalizedOrigin);
      finalizeSurfaceMutation(kind);
      return Promise.resolve(false);
    }

    if (!visible && currentState === CHAT_SURFACE_STATES.CLOSED) {
      applySurfaceState(el, currentState, normalizedOrigin);
      finalizeSurfaceMutation(kind);
      return Promise.resolve(false);
    }

    clearSurfaceTransition(el);

    if (visible) {
      el.style.display = getSurfaceDisplay(kind);
      applySurfaceState(el, CHAT_SURFACE_STATES.CLOSED, normalizedOrigin);
      void el.offsetWidth;
    }

    return new Promise((resolve) => {
      const token = Symbol(`${kind}-${visible ? 'open' : 'close'}`);
      const duration = getSurfaceDuration(kind, visible ? 'open' : 'close');
      const nextState = visible ? CHAT_SURFACE_STATES.OPENING : CHAT_SURFACE_STATES.CLOSING;
      const settledState = visible ? CHAT_SURFACE_STATES.OPEN : CHAT_SURFACE_STATES.CLOSED;

      const finish = () => {
        if (el._brisaChatTransition?.token !== token) return;
        clearSurfaceTransition(el);
        applySurfaceState(el, settledState, normalizedOrigin);
        if (!visible) {
          el.style.display = 'none';
        }
        finalizeSurfaceMutation(kind);
        resolve(true);
      };

      const handleAnimationEnd = (event) => {
        if (event.target !== el) return;
        finish();
      };

      const applyNextState = () => {
        if (el._brisaChatTransition?.token !== token) return;
        applySurfaceState(el, nextState, normalizedOrigin);
        if (duration === 0) finish();
      };

      el.addEventListener('animationend', handleAnimationEnd);
      el._brisaChatTransition = {
        token,
        cleanup: () => {
          el.removeEventListener('animationend', handleAnimationEnd);
        },
        timeoutId: setTimeout(finish, duration + 96)
      };

      if (visible) {
        el._brisaChatTransition.rafOne = requestAnimationFrame(() => {
          if (el._brisaChatTransition?.token !== token) return;
          el._brisaChatTransition.rafTwo = requestAnimationFrame(applyNextState);
        });
      } else {
        applyNextState();
      }
    });
  }

  function initializeSurfaceElement(el, kind, { origin = 'bubble', visible = false } = {}) {
    if (!el) return;
    clearSurfaceTransition(el);
    applySurfaceState(
      el,
      visible ? CHAT_SURFACE_STATES.OPEN : CHAT_SURFACE_STATES.CLOSED,
      origin
    );
    el.style.display = visible ? getSurfaceDisplay(kind) : 'none';
  }

  function isSurfaceVisible(el) {
    if (!el) return false;
    const hasManagedState = typeof el.dataset?.chatState === 'string';
    if (hasManagedState && !isSurfaceOpenish(el)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function resolveWindowOpenOrigin(options = {}) {
    const requested = normalizeChatOrigin(options.origin, 'bubble');
    if (isEmbeddedMode()) return requested === 'pill' ? 'panel' : requested;
    if (isMobileShell()) return 'bubble';
    if (options.origin) return requested;
    const panel = document.getElementById('brisa-chat-panel');
    return isPanelVisible(panel) ? 'panel' : 'bubble';
  }

  function resolveWindowCloseOrigin({ minimize = false, origin = null } = {}) {
    if (origin) {
      const requested = normalizeChatOrigin(origin, 'bubble');
      return isMobileShell() && requested === 'pill' ? 'bubble' : requested;
    }
    if (isEmbeddedMode()) return 'panel';
    if (isMobileShell()) return 'bubble';
    if (minimize) return 'pill';
    const panel = document.getElementById('brisa-chat-panel');
    return isPanelVisible(panel) ? 'panel' : 'bubble';
  }

  function focusChatInput() {
    const input = document.getElementById('brisa-chat-input');
    if (!input) return;
    const delay = prefersReducedMotion() ? 20 : 120;
    setTimeout(() => {
      try {
        input.focus({ preventScroll: true });
      } catch (error) {
        input.focus();
      }
    }, delay);
  }

  function focusElementSafely(target) {
    if (!target || typeof target.focus !== 'function') return false;
    try {
      target.focus({ preventScroll: true });
      return true;
    } catch (error) {
      try {
        target.focus();
        return true;
      } catch (fallbackError) {
        return false;
      }
    }
  }

  function moveFocusOutsideMobileChat(preferredTargets = []) {
    const root = getChatRoot();
    const viewport = document.getElementById('brisa-chat-mobile-viewport');
    const active = document.activeElement;
    const isFocusInsideMobileChat =
      !!active &&
      active !== document.body &&
      ((viewport && viewport.contains(active)) || (root && root.contains(active)));

    if (!isFocusInsideMobileChat) return true;

    const activeNavItem = document.querySelector(
      '.dm-bottom-nav__item[aria-current="page"], .dm-bottom-nav__item.is-active'
    );
    const bubble = document.getElementById('brisa-chat-bubble');
    const fab = document.getElementById('brisa-chat-fab');
    const targets = [...preferredTargets, activeNavItem, bubble, fab].filter(Boolean);
    const uniqueTargets = targets.filter((target, index) => targets.indexOf(target) === index);

    uniqueTargets.forEach((target) => {
      if (
        target &&
        (target === bubble || target === fab) &&
        !target.hasAttribute('tabindex')
      ) {
        target.setAttribute('tabindex', '-1');
      }
    });

    for (const target of uniqueTargets) {
      if (!focusElementSafely(target)) continue;
      const focusedNow = document.activeElement;
      if (!focusedNow) continue;
      if (!viewport || !viewport.contains(focusedNow)) {
        return true;
      }
    }

    if (active && typeof active.blur === 'function') {
      active.blur();
    }

    return !viewport || !viewport.contains(document.activeElement);
  }

  function restoreFocusAfterDetailClose() {
    const searchInput = document.getElementById('brisa-chat-user-search');
    const panelClose = document.getElementById('brisa-chat-panel-close');
    const bubble = document.getElementById('brisa-chat-bubble');
    if (focusElementSafely(searchInput)) return;
    if (focusElementSafely(panelClose)) return;
    focusElementSafely(bubble);
  }

  function restoreFocusAfterHubClose() {
    const activeNavItem = document.querySelector(
      '.dm-bottom-nav__item[aria-current="page"], .dm-bottom-nav__item.is-active'
    );
    const bubble = document.getElementById('brisa-chat-bubble');
    const fab = document.getElementById('brisa-chat-fab');
    if (focusElementSafely(activeNavItem)) return;
    if (bubble && !bubble.hasAttribute('tabindex')) {
      bubble.setAttribute('tabindex', '-1');
    }
    if (focusElementSafely(bubble)) return;
    if (fab && !fab.hasAttribute('tabindex')) {
      fab.setAttribute('tabindex', '-1');
    }
    if (focusElementSafely(fab)) return;
    const active = document.activeElement;
    if (active && active !== document.body && typeof active.blur === 'function') {
      active.blur();
    }
  }

  function triggerBubbleReaction(type = 'opening') {
    const bubble = document.getElementById('brisa-chat-bubble');
    if (!bubble) return;
    bubble.dataset.chatReact = type;
    if (bubbleReactionTimeout) clearTimeout(bubbleReactionTimeout);
    const duration = type === 'closing'
      ? getSurfaceDuration('panel', 'close')
      : getSurfaceDuration('panel', 'open');
    bubbleReactionTimeout = setTimeout(() => {
      if (bubble.dataset.chatReact === type) {
        bubble.dataset.chatReact = 'idle';
      }
    }, duration + 96);
  }

  const getViewportMetrics = () => {
    const docEl = document.documentElement;
    const visualViewport = window.visualViewport;
    const layoutWidth = docEl?.clientWidth || window.innerWidth;
    const offsetLeft = visualViewport ? Math.round(visualViewport.offsetLeft) : 0;
    const offsetTop = visualViewport ? Math.round(visualViewport.offsetTop) : 0;
    const width = visualViewport ? Math.round(visualViewport.width) : window.innerWidth;
    const height = visualViewport ? Math.round(visualViewport.height) : window.innerHeight;
    const rightInset = Math.max(
      BUBBLE_MARGIN,
      layoutWidth - offsetLeft - width + BUBBLE_MARGIN
    );
    return { layoutWidth, offsetLeft, offsetTop, width, height, rightInset };
  };

  const getBubbleBounds = (bubble) => {
    const target = document.getElementById('brisa-chat-fab') || bubble;
    const viewport = getViewportMetrics();
    const width = target?.offsetWidth || bubble?.offsetWidth || 58;
    const height = target?.offsetHeight || bubble?.offsetHeight || 58;
    const topMin = viewport.offsetTop + BUBBLE_TOP_MIN;
    const topMax = Math.max(
      topMin,
      viewport.offsetTop + viewport.height - height - BUBBLE_BOTTOM_GAP
    );
    const leftMin = viewport.offsetLeft + BUBBLE_MARGIN;
    const leftMax = Math.max(
      leftMin,
      viewport.offsetLeft + viewport.width - width - BUBBLE_MARGIN
    );
    return { viewport, width, height, topMin, topMax, leftMin, leftMax, rightInset: viewport.rightInset };
  };

  const applyBubblePosition = (bubble, { side, yPct } = {}) => {
    if (!bubble || !isMobileShell()) return;
    const target = document.getElementById('brisa-chat-fab') || bubble;
    const { viewport, topMin, topMax, leftMin, rightInset } = getBubbleBounds(bubble);
    const pct = Number.isFinite(yPct) ? clamp(yPct, 0, 1) : BUBBLE_DEFAULT_Y_PCT;
    const targetTop = clamp(
      Math.round(viewport.offsetTop + pct * viewport.height),
      topMin,
      topMax
    );
    const resolvedSide = side === 'left' ? 'left' : BUBBLE_DEFAULT_SIDE;
    target.style.top = `${targetTop}px`;
    target.style.bottom = 'auto';
    if (resolvedSide === 'right') {
      target.style.right = `${rightInset}px`;
      target.style.left = 'auto';
    } else {
      target.style.left = `${leftMin}px`;
      target.style.right = 'auto';
    }
    if (target?.dataset) target.dataset.side = resolvedSide;
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
    root.dataset.chatContext = detectChatDesktopContext();

    root.innerHTML = `
      <div class="brisa-chat-mobile-overlay hidden fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 transition-opacity duration-300" id="brisa-chat-mobile-overlay" aria-hidden="true">
        <div class="brisa-chat-mobile-viewport w-full flex items-center justify-center" id="brisa-chat-mobile-viewport" aria-hidden="true">
          <div class="brisa-chat-mobile-stack relative w-full max-w-md max-h-[85dvh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden" id="brisa-chat-mobile-stack" role="dialog" aria-modal="true" aria-label="Chat médico"></div>
        </div>
      </div>
      <div class="brisa-chat-fab" id="brisa-chat-fab" data-side="${BUBBLE_DEFAULT_SIDE}">
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
            <div class="brisa-chat-search">
              <label class="brisa-chat-search-label" for="brisa-chat-user-search">Buscar usuarios</label>
              <div class="brisa-chat-search-field">
                <svg class="brisa-chat-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <circle cx="11" cy="11" r="7"></circle>
                  <path d="m20 20-3.5-3.5"></path>
                </svg>
                <input
                  id="brisa-chat-user-search"
                  class="brisa-chat-search-input"
                  type="search"
                  placeholder="Buscar por nombre"
                  autocomplete="off"
                  spellcheck="false"
                  aria-label="Buscar usuarios por nombre"
                  aria-describedby="brisa-chat-search-status"
                />
              </div>
              <div class="brisa-chat-search-status" id="brisa-chat-search-status" aria-live="polite"></div>
            </div>
            <div class="brisa-chat-panel-scroll" id="brisa-chat-panel-scroll">
              <div class="brisa-chat-section-label brisa-chat-section-label--split">
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
              <div class="brisa-chat-row brisa-chat-row--assistant" id="brisa-chat-quick-ai" role="button" tabindex="0" aria-label="Abrir Asistente IA">
                <div class="brisa-chat-status-dot brisa-chat-status-dot--assistant" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2.75a.75.75 0 0 1 .75.75 5.5 5.5 0 0 0 5.5 5.5.75.75 0 0 1 0 1.5 5.5 5.5 0 0 0-5.5 5.5.75.75 0 0 1-1.5 0 5.5 5.5 0 0 0-5.5-5.5.75.75 0 0 1 0-1.5 5.5 5.5 0 0 0 5.5-5.5.75.75 0 0 1 .75-.75Zm6.5 12.5a.5.5 0 0 1 .5.5 2.75 2.75 0 0 0 2.75 2.75.5.5 0 0 1 0 1 2.75 2.75 0 0 0-2.75 2.75.5.5 0 0 1-1 0 2.75 2.75 0 0 0-2.75-2.75.5.5 0 0 1 0-1 2.75 2.75 0 0 0 2.75-2.75.5.5 0 0 1 .5-.5Z" />
                  </svg>
                </div>
                <div class="brisa-chat-row-main">
                  <div class="brisa-chat-name">Asistente IA</div>
                  <div class="brisa-chat-meta">Consulta asistida · Último modelo</div>
                </div>
                <div class="brisa-chat-row-accent" id="brisa-chat-quick-ai-model">Gemini</div>
              </div>
              <div class="brisa-chat-section-label" id="brisa-chat-users-label">Médicos conectados</div>
              <div id="brisa-chat-users"></div>
            </div>
          </div>
        </div>

        <div class="brisa-chat-bubble flex items-center justify-center rounded-full border border-white/20 z-50 !bg-gradient-to-br from-[#8BC71A] via-[#7AB800] to-[#5A8A00] !shadow-[0_14px_28px_rgba(15,23,42,0.18),_0_4px_10px_rgba(15,23,42,0.12)] transition-all duration-300 ease-out hover:-translate-y-1 hover:brightness-110 hover:!shadow-[0_18px_34px_rgba(15,23,42,0.22),_0_6px_14px_rgba(15,23,42,0.14)]" id="brisa-chat-bubble" draggable="false">
          <svg class="brisa-chat-bubble-icon text-white drop-shadow-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" draggable="false" focusable="false" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
          <div class="brisa-chat-badge" id="brisa-chat-badge">1</div>
        </div>
      </div>

      <div class="brisa-chat-window" id="brisa-chat-window">
        <div class="brisa-chat-window-header">
          <div class="brisa-chat-window-heading">
            <div class="brisa-chat-status-dot brisa-chat-status-dot--online"></div>
            <div class="brisa-chat-window-title" id="brisa-chat-window-title">Chat</div>
          </div>
          <div class="brisa-chat-window-actions">
            <button class="brisa-chat-pill-btn brisa-chat-window-back" id="brisa-chat-window-back" type="button" aria-label="Volver a la lista">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
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
    mobileFabHomeParent = null;
    mobileFabHomeNextSibling = null;
    mobileWindowHomeParent = null;
    mobileWindowHomeNextSibling = null;
    initializeSurfaceElement(document.getElementById('brisa-chat-panel'), 'panel');
    initializeSurfaceElement(document.getElementById('brisa-chat-window'), 'window', { origin: 'panel' });
    initializeSurfaceElement(document.getElementById('brisa-chat-pill'), 'pill', { origin: 'pill' });
    const bubble = document.getElementById('brisa-chat-bubble');
    if (bubble) {
      bubble.dataset.chatReact = 'idle';
    }
    updateAssistantQuickRow();
  }

  function adjustPanelForTray() {
    const panel = document.getElementById('brisa-chat-panel');
    if (!panel) return;
    const visibleTrayItems = pillTray
      ? Array.from(pillTray.children).filter((child) => isSurfaceVisible(child)).length
      : 0;
    const hasTray = visibleTrayItems > 0;
    const trayHeight = hasTray ? pillTray.offsetHeight : 0;
    const offset = hasTray
      ? trayHeight + PANEL_OFFSET_BASE + PANEL_OFFSET_EXTRA
      : PANEL_OFFSET_BASE;
    panel.style.setProperty('--brisa-panel-offset', `${offset}px`);
    syncPanelViewportBounds();
  }

  function syncPanelViewportBounds() {
    const panel = document.getElementById('brisa-chat-panel');
    const fab = document.getElementById('brisa-chat-fab');
    if (!panel || !fab) return;
    const fabRect = fab.getBoundingClientRect();
    const topMargin = 16;
    const availableAbove = Math.max(0, Math.floor(fabRect.top - topMargin));
    panel.style.setProperty('--brisa-panel-max-height', `${availableAbove}px`);
  }

  function getChatRoot() {
    return document.getElementById('brisa-chat-root');
  }

  function captureMobileModalHomes() {
    const fab = document.getElementById('brisa-chat-fab');
    const win = document.getElementById('brisa-chat-window');
    if (fab && !mobileFabHomeParent) {
      mobileFabHomeParent = fab.parentElement;
      mobileFabHomeNextSibling = fab.nextSibling;
    }
    if (win && !mobileWindowHomeParent) {
      mobileWindowHomeParent = win.parentElement;
      mobileWindowHomeNextSibling = win.nextSibling;
    }
  }

  function restoreMobileNode(node, parent, nextSibling) {
    if (!node || !parent || node.parentElement === parent) return;
    if (nextSibling && nextSibling.parentElement === parent) {
      parent.insertBefore(node, nextSibling);
      return;
    }
    parent.appendChild(node);
  }

  function syncMobileModalPlacement(open) {
    const stack = document.getElementById('brisa-chat-mobile-stack');
    const fab = document.getElementById('brisa-chat-fab');
    const win = document.getElementById('brisa-chat-window');
    captureMobileModalHomes();
    if (open) {
      if (stack && fab && fab.parentElement !== stack) {
        stack.appendChild(fab);
      }
      if (stack && win && win.parentElement !== stack) {
        stack.appendChild(win);
      }
      return;
    }
    restoreMobileNode(win, mobileWindowHomeParent, mobileWindowHomeNextSibling);
    restoreMobileNode(fab, mobileFabHomeParent, mobileFabHomeNextSibling);
  }

  function getChatContext() {
    const root = getChatRoot();
    return root?.dataset?.chatContext || detectChatDesktopContext();
  }

  function forceReleaseDocumentScrollState() {
    const body = document.body;
    const html = document.documentElement;
    if (!body || !html) return;
    body.classList.remove('overflow-hidden', 'is-dragging');
    body.style.overflow = '';
    body.style.touchAction = '';
    html.style.overflow = '';
    html.style.touchAction = '';
  }

  function setDocumentScrollLocked(locked) {
    const body = document.body;
    const html = document.documentElement;
    if (!body || !html) return;
    if (locked) {
      if (!body.dataset.brisaChatOverflow) {
        body.dataset.brisaChatOverflow = body.style.overflow || '';
        body.dataset.brisaChatTouchAction = body.style.touchAction || '';
        html.dataset.brisaChatOverflow = html.style.overflow || '';
      }
      body.style.overflow = 'hidden';
      body.style.touchAction = 'none';
      html.style.overflow = 'hidden';
      return;
    }
    if (body.dataset.brisaChatOverflow !== undefined) {
      body.style.overflow = body.dataset.brisaChatOverflow;
      body.style.touchAction = body.dataset.brisaChatTouchAction || '';
      html.style.overflow = html.dataset.brisaChatOverflow || '';
      delete body.dataset.brisaChatOverflow;
      delete body.dataset.brisaChatTouchAction;
      delete html.dataset.brisaChatOverflow;
    }
    forceReleaseDocumentScrollState();
  }

  function isMobileHubOpen() {
    if (!isCompactMobileChat()) return false;
    const root = getChatRoot();
    return root ? root.classList.contains('brisa-chat-root--mobile-open') : false;
  }

  function openMobileHub({ detail = false } = {}) {
    if (!isCompactMobileChat() || isEmbeddedMode()) return false;
    const root = getChatRoot();
    const overlay = document.getElementById('brisa-chat-mobile-overlay');
    const viewport = document.getElementById('brisa-chat-mobile-viewport');
    const stack = document.getElementById('brisa-chat-mobile-stack');
    const panel = document.getElementById('brisa-chat-panel');
    const win = document.getElementById('brisa-chat-window');
    if (!root || !overlay || !viewport || !stack || !panel || !win) return false;

    syncMobileModalPlacement(true);
    root.classList.add('brisa-chat-root--mobile-open');
    root.classList.toggle('brisa-chat-root--mobile-detail', Boolean(detail));
    root.style.pointerEvents = 'auto';
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    viewport.setAttribute('aria-hidden', 'false');
    if ('inert' in viewport) viewport.inert = false;
    setDocumentScrollLocked(true);
    setSurfaceImmediate(panel, 'panel', true, 'bubble');
    if (detail) {
      setSurfaceImmediate(win, 'window', true, 'panel');
    } else {
      setSurfaceImmediate(win, 'window', false, 'panel');
    }
    return true;
  }

  function closeMobileDetail() {
    if (!isCompactMobileChat()) return false;
    const root = getChatRoot();
    const win = document.getElementById('brisa-chat-window');
    const searchInput = document.getElementById('brisa-chat-user-search');
    const panelClose = document.getElementById('brisa-chat-panel-close');
    if (!root || !win) return false;
    moveFocusOutsideMobileChat([searchInput, panelClose]);
    restoreFocusAfterDetailClose();
    root.classList.remove('brisa-chat-root--mobile-detail');
    setSurfaceImmediate(win, 'window', false, 'panel');
    requestAnimationFrame(() => {
      moveFocusOutsideMobileChat([searchInput, panelClose]);
      restoreFocusAfterDetailClose();
    });
    setChatState({
      isChatOpen: false,
      isMinimized: false,
      activeConversationId,
      activePeerUid: activePeer?.uid || null
    });
    return true;
  }

  function closeMobileHub() {
    if (!isCompactMobileChat()) return false;
    const root = getChatRoot();
    const overlay = document.getElementById('brisa-chat-mobile-overlay');
    const viewport = document.getElementById('brisa-chat-mobile-viewport');
    const panel = document.getElementById('brisa-chat-panel');
    const win = document.getElementById('brisa-chat-window');
    if (!root || !overlay || !viewport || !panel || !win) return false;

    root.classList.remove('brisa-chat-root--mobile-detail', 'brisa-chat-root--mobile-open');
    root.style.pointerEvents = '';
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    viewport.setAttribute('aria-hidden', 'true');
    if ('inert' in viewport) viewport.inert = true;
    setSurfaceImmediate(win, 'window', false, 'panel');
    setSurfaceImmediate(panel, 'panel', false, 'bubble');
    setDocumentScrollLocked(false);
    if (typeof cancelBubbleDragSession === 'function') {
      cancelBubbleDragSession({ persistPosition: false });
    }
    syncMobileModalPlacement(false);
    moveFocusOutsideMobileChat();
    restoreFocusAfterHubClose();
    activeConversationId = null;
    activePeer = null;
    requestAnimationFrame(() => {
      moveFocusOutsideMobileChat();
      restoreFocusAfterHubClose();
    });
    setChatState({
      isChatOpen: false,
      isMinimized: false,
      activeConversationId: null,
      activePeerUid: null
    });
    return true;
  }

  function isEmbeddedMode() {
    const root = getChatRoot();
    return root ? root.classList.contains('brisa-chat--embedded') : false;
  }

  function isPanelVisible(panel) {
    return isSurfaceVisible(panel);
  }

  function isElementVisible(el) {
    return isSurfaceVisible(el);
  }

  function captureAnchorSnapshot(el) {
    if (!isElementVisible(el)) return null;
    const rect = el.getBoundingClientRect();
    return {
      getBoundingClientRect: () => rect
    };
  }

  function resolveAssistantAnchorForChat({ panel, windowEl, bubble }) {
    if (isElementVisible(windowEl)) return windowEl;
    const panelAnchor = captureAnchorSnapshot(panel);
    if (panelAnchor) return panelAnchor;
    return isElementVisible(bubble) ? bubble : null;
  }

  function mountChat(containerEl) {
    if (isCompactMobileChat() && !isEmbeddedMode()) return;
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
    const fab = document.getElementById('brisa-chat-fab');
    if (bubble) bubble.style.display = 'none';
    setSurfaceImmediate(panel, 'panel', false, 'bubble');
    if (fab) fab.style.display = 'none';
    setSurfaceImmediate(pill, 'pill', false, 'pill');
    if (tray) tray.style.display = 'none';
    const win = document.getElementById('brisa-chat-window');
    setSurfaceImmediate(win, 'window', true, 'panel');
  }

  function unmountChat() {
    if (isCompactMobileChat() && !isEmbeddedMode()) {
      closeMobileHub();
      return;
    }
    const root = getChatRoot();
    if (!root) return;
    root.classList.remove('brisa-chat--embedded');
    const bubble = document.getElementById('brisa-chat-bubble');
    const panel = document.getElementById('brisa-chat-panel');
    const pill = document.getElementById('brisa-chat-pill');
    const tray = document.getElementById('brisa-chat-pill-tray');
    const fab = document.getElementById('brisa-chat-fab');
    if (bubble) bubble.style.display = '';
    if (panel) {
      panel.style.display = getSurfaceState(panel) === CHAT_SURFACE_STATES.CLOSED ? 'none' : getSurfaceDisplay('panel');
    }
    if (fab) fab.style.display = '';
    if (pill) {
      pill.style.display = getSurfaceState(pill) === CHAT_SURFACE_STATES.CLOSED ? 'none' : getSurfaceDisplay('pill');
    }
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
    const win = document.getElementById('brisa-chat-window');
    const winVisible = isSurfaceVisible(win);
    if (!winVisible) return false;
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

  function normalizeSearchText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function resolveDirectoryName(profile = {}) {
    const primary =
      profile.displayName ||
      profile.nombreCompleto ||
      profile.apellidoNombre ||
      profile.fullName ||
      profile.name ||
      profile.nombre ||
      '';
    const lastName = profile.apellido || profile.lastName || '';
    const firstName = profile.nombre || profile.firstName || '';
    const combined = `${lastName} ${firstName}`.trim();
    const fallback = profile.email || profile.correo || profile.mail || 'Médico';
    return buildDisplayName(primary || combined ? { displayName: primary || combined } : { displayName: fallback });
  }

  function resolveDirectoryRole(profile = {}) {
    return buildRole(profile) || 'Médico';
  }

  function resolveDirectoryBusinessUnit(profile = {}) {
    return (
      profile.businessUnit ||
      profile.unidadNegocio ||
      profile.bu ||
      profile.business_unit ||
      ''
    );
  }

  function resolveDirectoryManagementUnit(profile = {}) {
    return (
      profile.managementUnit ||
      profile.unidadGestion ||
      profile.mu ||
      profile.management_unit ||
      ''
    );
  }

  function buildSearchDirectoryEntry(uid, profile = {}) {
    const displayName = resolveDirectoryName(profile);
    const role = resolveDirectoryRole(profile);
    const businessUnit = resolveDirectoryBusinessUnit(profile);
    const managementUnit = resolveDirectoryManagementUnit(profile);
    const candidates = [
      profile.displayName,
      profile.nombreCompleto,
      profile.apellidoNombre,
      profile.fullName,
      profile.name,
      profile.nombre,
      profile.apellido && profile.nombre
        ? `${profile.apellido} ${profile.nombre}`.trim()
        : '',
      displayName
    ]
      .filter(Boolean)
      .join(' ');
    return {
      uid,
      displayName,
      role,
      businessUnit,
      managementUnit,
      searchKey: normalizeSearchText(candidates)
    };
  }

  function getSearchElements() {
    return {
      input: document.getElementById('brisa-chat-user-search'),
      status: document.getElementById('brisa-chat-search-status'),
      label: document.getElementById('brisa-chat-users-label'),
      container: document.getElementById('brisa-chat-users')
    };
  }

  function setSearchStatus(message = '', tone = '') {
    const { status } = getSearchElements();
    if (!status) return;
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  function resolveAssistantModel() {
    const liveModel = window.__dmAssistantShell?.state?.activeModel;
    if (liveModel === 'gpt' || liveModel === 'gemini') return liveModel;
    try {
      const stored = localStorage.getItem(ASSISTANT_MODEL_STORAGE_KEY);
      if (stored === 'gpt' || stored === 'gemini') return stored;
    } catch (e) {}
    return ASSISTANT_DEFAULT_MODEL;
  }

  function getAssistantModelLabel(model = resolveAssistantModel()) {
    return model === 'gpt' ? 'ChatGPT' : 'Gemini';
  }

  function updateAssistantQuickRow() {
    const row = document.getElementById('brisa-chat-quick-ai');
    const badge = document.getElementById('brisa-chat-quick-ai-model');
    if (!row || !badge) return;
    const model = resolveAssistantModel();
    const label = getAssistantModelLabel(model);
    row.dataset.model = model;
    row.setAttribute('aria-label', `Abrir Asistente IA en ${label}`);
    badge.textContent = label;
  }

  async function ensureAssistantShellReady() {
    ensureAssistantShellStylesInjected();
    if (window.__dmAssistantShell?.openChat) {
      updateAssistantQuickRow();
      return window.__dmAssistantShell;
    }
    if (!assistantShellPromise) {
      assistantShellPromise = import(ASSISTANT_SHELL_MODULE_URL)
        .then(({ initAssistantShell }) => initAssistantShell({ variant: isMobileShell() ? 'mobile' : 'desktop' }))
        .catch((error) => {
          assistantShellPromise = null;
          throw error;
        });
    }
    const shell = await assistantShellPromise;
    updateAssistantQuickRow();
    return shell;
  }

  function buildUserMeta({ businessUnit = '', managementUnit = '', role = '' } = {}) {
    const parts = [businessUnit, managementUnit].map((part) => String(part || '').trim()).filter(Boolean);
    if (parts.length) return parts.join(' · ');
    return (role || 'Médico').trim() || 'Médico';
  }

  function buildEmptyState(message) {
    const empty = document.createElement('div');
    empty.className = 'brisa-chat-empty';
    empty.textContent = message;
    return empty;
  }

  function buildUserRow({ uid = '', name = 'Médico', meta = 'Médico', isOnline = false, disabled = false, onOpen = null }) {
    const row = document.createElement('div');
    row.className = 'brisa-chat-row';
    if (disabled) row.classList.add('brisa-chat-row--disabled');
    if (!isOnline) row.classList.add('brisa-chat-row--offline');
    if (uid) row.dataset.uid = uid;
    row.dataset.name = name;

    const dot = document.createElement('div');
    dot.className = 'brisa-chat-status-dot';
    if (isOnline) dot.classList.add('brisa-chat-status-dot--online');

    const main = document.createElement('div');
    main.className = 'brisa-chat-row-main';

    const nameEl = document.createElement('div');
    nameEl.className = 'brisa-chat-name';
    nameEl.textContent = name;

    const metaEl = document.createElement('div');
    metaEl.className = 'brisa-chat-meta';
    metaEl.textContent = meta;

    main.appendChild(nameEl);
    main.appendChild(metaEl);
    row.appendChild(dot);
    row.appendChild(main);

    if (!disabled) {
      const action = document.createElement('button');
      action.className = 'brisa-chat-icon-btn';
      action.type = 'button';
      action.setAttribute('aria-label', `Abrir chat con ${name}`);
      action.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M22 2 11 13" /><path d="M22 2 15 22 11 13 2 9 22 2" />
        </svg>
      `;
      if (typeof onOpen === 'function') {
        action.addEventListener('click', (event) => {
          event.stopPropagation();
          onOpen();
        });
      }
      row.appendChild(action);
    }

    if (!disabled && typeof onOpen === 'function') {
      row.addEventListener('click', onOpen);
    }

    return row;
  }

  function applyUnreadForRow(uid) {
    if (!uid || !currentUser) return;
    const conversationId = getConversationId(currentUser.uid, uid);
    const unread = unreadByConversation.get(conversationId) || 0;
    setRowUnreadForPeer(uid, unread);
  }

  async function loadAllUsersDirectory() {
    if (allUsersCache.length) return allUsersCache;
    if (allUsersPromise) return allUsersPromise;

    allUsersPromise = (async () => {
      const snap = await getDocs(collection(db, 'usuarios'));
      const next = [];
      snap.forEach((docSnap) => {
        const uid = docSnap.id;
        if (!uid || uid === currentUser?.uid) return;
        const entry = buildSearchDirectoryEntry(uid, docSnap.data() || {});
        if (!entry.searchKey) return;
        next.push(entry);
      });
      allUsersCache = next;
      return allUsersCache;
    })();

    try {
      return await allUsersPromise;
    } finally {
      allUsersPromise = null;
    }
  }

  function resetUserSearch({ preserveValue = false } = {}) {
    const { input } = getSearchElements();
    activeSearchQuery = '';
    userDirectoryError = '';
    if (input && !preserveValue) {
      input.value = '';
    }
    renderUsersPanel();
  }

  async function openDirectConversation(uid, displayName, { clearSearch = false, origin = 'panel' } = {}) {
    if (!uid) return;
    if (clearSearch) {
      resetUserSearch();
    }
    openConversation(uid, displayName, { origin });
    if (currentUser) {
      await hydratePeerProfile(getConversationId(currentUser.uid, uid), uid);
    }
  }

  function renderUsersPanel() {
    const { container, label } = getSearchElements();
    if (!container || !label) return;

    container.innerHTML = '';
    presenceRows.clear();

    const hasInput = activeSearchQuery.length > 0;
    const isSearchActive = activeSearchQuery.length >= USER_SEARCH_MIN_CHARS;

    if (!isSearchActive) {
      label.textContent = 'Médicos conectados';
      if (hasInput) {
        setSearchStatus(`Escribí al menos ${USER_SEARCH_MIN_CHARS} letras para buscar usuarios.`, 'hint');
      } else {
        setSearchStatus('');
      }

      if (currentUser) {
        container.appendChild(buildSelfRow());
      }

      onlineUsers.forEach((entry) => {
        const row = buildUserRow({
          uid: entry.uid,
          name: entry.displayName,
          meta: buildUserMeta(entry),
          isOnline: true,
          onOpen: () => {
            openDirectConversation(entry.uid, entry.displayName);
          }
        });
        presenceRows.set(entry.uid, row);
        container.appendChild(row);
        applyUnreadForRow(entry.uid);
      });
      return;
    }

    label.textContent = 'Resultados';

    if (isUserDirectoryLoading) {
      setSearchStatus('Buscando usuarios…', 'loading');
      return;
    }

    if (userDirectoryError) {
      label.textContent = 'Médicos conectados';
      setSearchStatus(userDirectoryError, 'error');
      if (currentUser) {
        container.appendChild(buildSelfRow());
      }
      onlineUsers.forEach((entry) => {
        const row = buildUserRow({
          uid: entry.uid,
          name: entry.displayName,
          meta: buildUserMeta(entry),
          isOnline: true,
          onOpen: () => {
            openDirectConversation(entry.uid, entry.displayName);
          }
        });
        presenceRows.set(entry.uid, row);
        container.appendChild(row);
        applyUnreadForRow(entry.uid);
      });
      return;
    }

    const results = allUsersCache
      .filter((entry) => entry.searchKey.includes(activeSearchQuery))
      .sort((a, b) => {
        const aOnline = presenceMap.has(a.uid) ? 0 : 1;
        const bOnline = presenceMap.has(b.uid) ? 0 : 1;
        if (aOnline !== bOnline) return aOnline - bOnline;
        return a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' });
      });

    if (!results.length) {
      setSearchStatus('No hay usuarios que coincidan.', 'hint');
      container.appendChild(buildEmptyState('No hay usuarios que coincidan.'));
      return;
    }

    setSearchStatus(
      `${results.length} resultado${results.length === 1 ? '' : 's'} encontrado${results.length === 1 ? '' : 's'}.`,
      'success'
    );

    results.forEach((entry) => {
      const isOnline = presenceMap.has(entry.uid);
      const row = buildUserRow({
        uid: entry.uid,
        name: entry.displayName,
        meta: buildUserMeta(entry),
        isOnline,
        onOpen: () => {
          openDirectConversation(entry.uid, entry.displayName, { clearSearch: true });
        }
      });
      presenceRows.set(entry.uid, row);
      container.appendChild(row);
      applyUnreadForRow(entry.uid);
    });
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
          businessUnit: resolveDirectoryBusinessUnit(profile),
          managementUnit: resolveDirectoryManagementUnit(profile),
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

  async function touchPresenceHeartbeat({ force = false } = {}) {
    if (!currentUser || !db || document.hidden) return;
    const now = Date.now();
    if (!force && now - lastPresenceHeartbeatAt < PRESENCE_HEARTBEAT_MS) return;
    lastPresenceHeartbeatAt = now;
    await updatePresenceStatus(currentUser, currentProfile, true);
  }

  function bindPresenceHeartbeat() {
    if (presenceHeartbeatBound) return;
    presenceHeartbeatBound = true;
    const refreshPresence = () => {
      if (Date.now() - lastPresenceHeartbeatAt < PRESENCE_HEARTBEAT_MS) return;
      void touchPresenceHeartbeat();
    };
    window.addEventListener('pointerdown', refreshPresence, { passive: true, capture: true });
    window.addEventListener('keydown', refreshPresence, { capture: true });
    window.addEventListener('touchstart', refreshPresence, { passive: true, capture: true });
    window.addEventListener('focus', refreshPresence);
    window.addEventListener('mousemove', refreshPresence, { passive: true });
    window.addEventListener('scroll', refreshPresence, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void touchPresenceHeartbeat({ force: true });
      }
    });
  }

  async function handleSignedOutState() {
    await markOffline();
    if (presenceUnsub) presenceUnsub();
    presenceUnsub = null;
    stopIncomingWatcher();
    conversationSubs.forEach(unsub => unsub());
    conversationSubs.clear();
    conversationMessages.clear();
    conversationPeers.clear();
    minimizedPills.forEach(p => p.remove());
    minimizedPills.clear();
    presenceMap.clear();
    presenceRows.clear();
    currentProfile = null;
    onlineUsers = [];
    allUsersCache = [];
    allUsersPromise = null;
    activeSearchQuery = '';
    isUserDirectoryLoading = false;
    userDirectoryError = '';
    unreadByConversation.clear();
    totalUnreadCount = 0;
    onlineCount = 0;
    lastPresenceHeartbeatAt = 0;
    updateCountsUI();
    updateDocumentBadge();
    const loggedFlag = sessionStorage.getItem('isLoggedIn') === 'true';
    if (loggedFlag) {
      showPill('Chat no disponible (Auth). Reingresá sesión.');
    }
    adjustPanelForTray();
  }

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
    onlineUsers = [];
    const presenceQuery = query(collection(db, PRESENCE_COLLECTION), where('online', '==', true));
    presenceUnsub = onSnapshot(presenceQuery, snapshot => {
      presenceMap.clear();
      onlineUsers = [];
      let filteredCount = 0;
      let hasSelfPresence = false;

      if (currentUser) {
        const selfName = formatDoctorName(currentUser.displayName || currentUser.email || 'Vos');
        presenceMap.set(currentUser.uid, { name: selfName, role: 'Sesión actual', online: true });
      }

      snapshot.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const uid = data.uid || docSnap.id;
        if (!uid) return;
        if (!isPresenceFresh(data.updatedAt)) return;
        const doctorName = formatDoctorName(data.displayName || data.email || 'Médico');
        const role = data.role || 'Médico';
        const businessUnit = resolveDirectoryBusinessUnit(data);
        const managementUnit = resolveDirectoryManagementUnit(data);
        presenceMap.set(uid, { name: doctorName, role, businessUnit, managementUnit, online: true });
        filteredCount += 1;
        if (currentUser && uid === currentUser.uid) {
          hasSelfPresence = true;
        }
        if (!currentUser || uid === currentUser.uid) return;

        onlineUsers.push({
          uid,
          displayName: doctorName,
          role,
          businessUnit,
          managementUnit
        });

        const conversationId = getConversationId(currentUser.uid, uid);
        ensureConversationSubscription(conversationId);
      });

      if (currentUser && !hasSelfPresence) {
        filteredCount += 1;
      }
      onlineCount = filteredCount;
      updateCountsUI();
      renderUsersPanel();
    });
  }

  function buildSelfRow() {
    return buildUserRow({
      uid: currentUser?.uid || '',
      name: formatDoctorName(currentUser?.displayName || currentUser?.email || 'Vos'),
      meta: 'Sesión actual',
      isOnline: true,
      disabled: true
    });
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
    list.scrollTop = list.scrollHeight;
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
      await updateDoc(
        ref,
        new FieldPath("unreadCountByUid", currentUser.uid),
        0,
        "updatedAt",
        serverTimestamp()
      );
    } catch (e) {
      if (isMissingDocError(e)) return;
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
    const participants = [fromUid, toUid].sort();
    try {
      const ref = doc(db, CONVERSATIONS_COLLECTION, conversationId);
      await updateDoc(
        ref,
        "participants",
        participants,
        "lastMessageText",
        text,
        "lastMessageAt",
        serverTimestamp(),
        "lastSenderUid",
        fromUid,
        "updatedAt",
        serverTimestamp(),
        new FieldPath("unreadCountByUid", toUid),
        increment(1),
        new FieldPath("unreadCountByUid", fromUid),
        0
      );
    } catch (e) {
      if (isMissingDocError(e)) {
        try {
          const ref = doc(db, CONVERSATIONS_COLLECTION, conversationId);
          await setDoc(
            ref,
            {
              participants,
              lastMessageText: text,
              lastMessageAt: serverTimestamp(),
              lastSenderUid: fromUid,
              updatedAt: serverTimestamp(),
              unreadCountByUid: {
                [toUid]: 1,
                [fromUid]: 0
              }
            },
            { merge: true }
          );
          return;
        } catch (err) {
          console.warn('No se pudo crear la conversacion:', err);
        }
      }
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
    const openOrigin = resolveWindowOpenOrigin(options);
    const pill = minimizedPills.get(conversationId);

    if (win && title && subtitle && msgs) {
      title.textContent = peer.name;
      subtitle.textContent = peer.subtitle || 'Departamento Médico';
      msgs.innerHTML = '';
      if (pill) {
        transitionSurface(pill, 'pill', false, { origin: 'pill', immediate: isEmbeddedMode() });
      }
      if (!isCompactMobileChat() && openOrigin === 'bubble') {
        triggerBubbleReaction('restoring');
      }
      renderActiveConversation();
      if (isCompactMobileChat() && !isEmbeddedMode()) {
        openMobileHub({ detail: true });
        if (activeConversationId === conversationId) {
          focusChatInput();
        }
      } else {
        transitionSurface(win, 'window', true, { origin: openOrigin, immediate: isEmbeddedMode() })
          .then(() => {
            if (activeConversationId !== conversationId) return;
            focusChatInput();
          });
      }
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
    if (isCompactMobileChat()) {
      closeMobileDetail();
      return;
    }
    const conversationId = activeConversationId;
    const peerUid = activePeer.uid;
    const closeOrigin = resolveWindowCloseOrigin({ minimize: true });
    const win = document.getElementById('brisa-chat-window');
    const pill = getOrCreatePill(conversationId, activePeer.name);
    if (closeOrigin === 'bubble') {
      triggerBubbleReaction('closing');
    }
    const closePromise = transitionSurface(win, 'window', false, {
      origin: closeOrigin,
      immediate: isEmbeddedMode()
    });
    if (pill) {
      closePromise.finally(() => {
        if (!minimizedPills.has(conversationId)) return;
        transitionSurface(pill, 'pill', true, { origin: 'pill' });
      });
    }
    stopBlink(conversationId);
    setChatState({
      isChatOpen: true,
      isMinimized: true,
      activeConversationId: conversationId,
      activePeerUid: peerUid
    });
  }

  function getOrCreatePill(conversationId, label) {
    if (isMobileShell()) return null;
    if (!pillTray) return null;
    if (minimizedPills.has(conversationId)) {
      const existing = minimizedPills.get(conversationId);
      existing.querySelector('.brisa-chat-pill-label').textContent = label;
      transitionSurface(existing, 'pill', true, { origin: 'pill' });
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
        openConversationById(conversationId, peer, { origin: 'pill' });
      }
    });

    pill.querySelector('[data-action="close"]').addEventListener('click', (e) => {
      e.stopPropagation();
      removeConversation(conversationId);
    });

    pill.addEventListener('click', () => {
      const peer = conversationPeers.get(conversationId);
      if (peer) {
        openConversationById(conversationId, peer, { origin: 'pill' });
      }
    });

    pillTray.appendChild(pill);
    initializeSurfaceElement(pill, 'pill', { origin: 'pill' });
    minimizedPills.set(conversationId, pill);
    adjustPanelForTray();
    return pill;
  }

  function stopBlink(conversationId) {
    const pill = minimizedPills.get(conversationId);
    if (pill) pill.classList.remove('brisa-chat-pill--blink');
  }

  function removeConversation(conversationId, options = {}) {
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
    minimizedPills.delete(conversationId);
    if (pill) {
      transitionSurface(pill, 'pill', false, { origin: 'pill' })
        .finally(() => {
          pill.remove();
          adjustPanelForTray();
        });
    } else {
      adjustPanelForTray();
    }

    if (activeConversationId === conversationId) {
      if (isCompactMobileChat()) {
        activeConversationId = null;
        activePeer = null;
        closeMobileDetail();
        setChatState({
          isChatOpen: false,
          isMinimized: false,
          activeConversationId: null,
          activePeerUid: null
        });
        return;
      }
      activeConversationId = null;
      activePeer = null;
      const win = document.getElementById('brisa-chat-window');
      const closeOrigin = resolveWindowCloseOrigin({ origin: options.windowOrigin });
      if (closeOrigin === 'bubble') {
        triggerBubbleReaction('closing');
      }
      transitionSurface(win, 'window', false, {
        origin: closeOrigin,
        immediate: isEmbeddedMode()
      });
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
    const fab = document.getElementById('brisa-chat-fab');
    const overlay = document.getElementById('brisa-chat-mobile-overlay');
    const panel = document.getElementById('brisa-chat-panel');
    const panelClose = document.getElementById('brisa-chat-panel-close');
    const panelSoundToggle = document.getElementById('brisa-chat-panel-sound-toggle');
    const searchInput = document.getElementById('brisa-chat-user-search');
    const win = document.getElementById('brisa-chat-window');
    const winBack = document.getElementById('brisa-chat-window-back');
    const winClose = document.getElementById('brisa-chat-window-close');
    const winMin = document.getElementById('brisa-chat-window-min');
    const deleteConversationBtn = document.getElementById('brisa-chat-delete-conversation');
    const sendBtn = document.getElementById('brisa-chat-send');
    const input = document.getElementById('brisa-chat-input');
    const quickGroup = document.getElementById('brisa-chat-quick-group');
    const quickForo = document.getElementById('brisa-chat-quick-foro');
    const quickAi = document.getElementById('brisa-chat-quick-ai');
    const deleteModal = document.getElementById('brisa-chat-delete-modal');
    const deletePass = document.getElementById('brisa-chat-delete-pass');
    const deleteCancel = document.getElementById('brisa-chat-delete-cancel');
    const deleteConfirm = document.getElementById('brisa-chat-delete-confirm');
    const deleteConvModal = document.getElementById('brisa-chat-delete-conv-modal');
    const deleteConvPass = document.getElementById('brisa-chat-delete-conv-pass');
    const deleteConvCancel = document.getElementById('brisa-chat-delete-conv-cancel');
    const deleteConvConfirm = document.getElementById('brisa-chat-delete-conv-confirm');
    const panelScroll = document.getElementById('brisa-chat-panel-scroll');

    let suppressClick = false;
    let activePointerId = null;
    let dragAbortController = null;
    let isDragging = false;
    let didMove = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let pendingClientX = 0;
    let pendingClientY = 0;
    let startFabRect = null;
    let startTopPx = 0;
    let startLeftPx = 0;
    let currentTopPx = null;
    let currentLeftPx = 0;
    let currentSide = BUBBLE_DEFAULT_SIDE;
    let dragWidth = 0;
    let dragHeight = 0;
    let rafId = 0;
    let snapFrameId = 0;
    let snapCleanupTimer = 0;
    let isSnapAnimating = false;

    const resetPanelSearchState = () => {
      resetUserSearch();
      if (panelScroll) panelScroll.scrollTop = 0;
      if (searchInput) searchInput.blur();
    };

    const closeUsersPanel = ({ minimizeConversation = false, origin = 'bubble' } = {}) => {
      if (panel && isPanelVisible(panel)) {
        resetPanelSearchState();
        if (origin === 'bubble') {
          triggerBubbleReaction('closing');
        }
        transitionSurface(panel, 'panel', false, { origin });
      }
      if (minimizeConversation) {
        minimizeActiveConversation();
      }
    };

    const restoreBubblePosition = () => {
      if (!bubble || !isMobileShell()) return;
      applyBubblePosition(
        bubble,
        readBubblePosition() || { side: BUBBLE_DEFAULT_SIDE, yPct: BUBBLE_DEFAULT_Y_PCT }
      );
    };

    const persistBubblePosition = (side, topPx) => {
      if (!bubble || !isMobileShell()) return;
      const { viewport, topMin, topMax } = getBubbleBounds(bubble);
      const clampedTop = clamp(topPx, topMin, topMax);
      const yPct = viewport.height > 0
        ? clamp((clampedTop - viewport.offsetTop) / viewport.height, 0, 1)
        : BUBBLE_DEFAULT_Y_PCT;
      saveBubblePosition({ side, yPct });
    };

    const dragTarget = fab || bubble;
    cancelBubbleDragSession = null;

    if (bubble && dragTarget && isMobileShell()) {
      bubble.setAttribute('draggable', 'false');
      bubble.querySelectorAll('img,svg').forEach((node) => {
        node.setAttribute('draggable', 'false');
      });

      restoreBubblePosition();
      const handleResize = () => {
        if (activePointerId !== null) {
          queueDragFrame();
          return;
        }
        restoreBubblePosition();
        syncPanelViewportBounds();
      };
      window.addEventListener('resize', handleResize, { passive: true });
      window.addEventListener('orientationchange', handleResize, { passive: true });
      window.visualViewport?.addEventListener('resize', handleResize, { passive: true });
      window.visualViewport?.addEventListener('scroll', handleResize, { passive: true });

      const clearSnapAnimation = () => {
        if (snapCleanupTimer) {
          clearTimeout(snapCleanupTimer);
          snapCleanupTimer = 0;
        }
        if (snapFrameId) {
          cancelAnimationFrame(snapFrameId);
          snapFrameId = 0;
        }
        isSnapAnimating = false;
        dragTarget.classList.remove('is-snapping');
        dragTarget.style.removeProperty('transform');
        dragTarget.style.removeProperty('will-change');
      };

      const resetSuppressClick = () => {
        setTimeout(() => {
          suppressClick = false;
        }, 0);
      };

      const abortTemporaryDragListeners = () => {
        if (!dragAbortController) return;
        dragAbortController.abort();
        dragAbortController = null;
      };

      const cancelDragFrame = () => {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      };

      const getDragBounds = (viewport = getViewportMetrics()) => {
        const topMin = viewport.offsetTop + BUBBLE_TOP_MIN;
        const topMax = Math.max(
          topMin,
          viewport.offsetTop + viewport.height - dragHeight - BUBBLE_BOTTOM_GAP
        );
        const leftMin = viewport.offsetLeft + BUBBLE_MARGIN;
        const leftMax = Math.max(
          leftMin,
          viewport.offsetLeft + viewport.width - dragWidth - BUBBLE_MARGIN
        );
        return { viewport, topMin, topMax, leftMin, leftMax, rightInset: viewport.rightInset };
      };

      const resolveSideFromLeft = (leftPx, viewport) =>
        leftPx + dragWidth / 2 >= viewport.offsetLeft + viewport.width / 2
          ? 'right'
          : 'left';

      const resolveCommittedLeft = (side, bounds) =>
        side === 'right'
          ? Math.max(bounds.leftMin, bounds.viewport.layoutWidth - bounds.rightInset - dragWidth)
          : bounds.leftMin;

      const resolvePendingDragPosition = () => {
        const bounds = getDragBounds();
        const nextLeft = clamp(
          startLeftPx + (pendingClientX - dragStartX),
          bounds.leftMin,
          bounds.leftMax
        );
        const nextTop = clamp(
          startTopPx + (pendingClientY - dragStartY),
          bounds.topMin,
          bounds.topMax
        );
        return {
          bounds,
          nextLeft,
          nextTop,
          side: resolveSideFromLeft(nextLeft, bounds.viewport)
        };
      };

      const queueDragFrame = () => {
        if (rafId || activePointerId === null) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          if (activePointerId === null) return;
          const { nextLeft, nextTop, side } = resolvePendingDragPosition();
          currentLeftPx = nextLeft;
          currentTopPx = nextTop;
          currentSide = side;
          dragTarget.style.transform = `translate3d(${nextLeft - startLeftPx}px, ${nextTop - startTopPx}px, 0)`;
        });
      };

      const cleanupDrag = (reason = 'cleanup') => {
        const pointerId = activePointerId;
        activePointerId = null;
        isDragging = false;
        didMove = false;
        dragStartX = 0;
        dragStartY = 0;
        pendingClientX = 0;
        pendingClientY = 0;
        startFabRect = null;
        startTopPx = 0;
        startLeftPx = 0;
        currentTopPx = null;
        currentLeftPx = 0;
        currentSide = dragTarget?.dataset?.side === 'left' ? 'left' : BUBBLE_DEFAULT_SIDE;
        dragWidth = 0;
        dragHeight = 0;
        cancelDragFrame();
        abortTemporaryDragListeners();
        dragTarget.classList.remove('is-dragging');
        bubble.classList.remove('is-dragging');
        document.body.style.removeProperty('user-select');
        document.documentElement.style.removeProperty('user-select');
        if (!isSnapAnimating) {
          dragTarget.style.removeProperty('transform');
          dragTarget.style.removeProperty('will-change');
          dragTarget.classList.remove('is-snapping');
        }
        if (pointerId !== null && bubble.hasPointerCapture?.(pointerId)) {
          try {
            bubble.releasePointerCapture(pointerId);
          } catch (e) {}
        }
        return reason;
      };

      const finishDrag = (reason = 'pointerup') => {
        if (activePointerId === null) {
          cleanupDrag(reason);
          return;
        }

        if (didMove && isDragging) {
          const { bounds, nextLeft, nextTop, side } = resolvePendingDragPosition();
          const finalTop = clamp(
            Number.isFinite(currentTopPx) ? currentTopPx : nextTop,
            bounds.topMin,
            bounds.topMax
          );
          const finalSide = (currentSide || side) === 'left' ? 'left' : BUBBLE_DEFAULT_SIDE;
          const finalLeft = resolveCommittedLeft(finalSide, bounds);
          const finalRight = bounds.rightInset;
          const fromLeft = Number.isFinite(currentLeftPx) ? currentLeftPx : nextLeft;
          const fromTop = Number.isFinite(currentTopPx) ? currentTopPx : nextTop;

          isSnapAnimating = true;
          dragTarget.classList.remove('is-dragging');
          bubble.classList.remove('is-dragging');
          dragTarget.classList.add('is-snapping');
          dragTarget.style.willChange = 'transform';
          dragTarget.style.top = `${finalTop}px`;
          dragTarget.style.bottom = 'auto';
          if (finalSide === 'right') {
            dragTarget.style.right = `${finalRight}px`;
            dragTarget.style.left = 'auto';
          } else {
            dragTarget.style.left = `${bounds.leftMin}px`;
            dragTarget.style.right = 'auto';
          }
          if (dragTarget?.dataset) dragTarget.dataset.side = finalSide;
          persistBubblePosition(finalSide, finalTop);
          dragTarget.style.transform = `translate3d(${fromLeft - finalLeft}px, ${fromTop - finalTop}px, 0)`;
          snapFrameId = requestAnimationFrame(() => {
            snapFrameId = 0;
            dragTarget.style.transform = 'translate3d(0, 0, 0)';
          });
          snapCleanupTimer = setTimeout(() => {
            clearSnapAnimation();
          }, BUBBLE_SNAP_TRANSITION_MS + 48);
          suppressClick = true;
          resetSuppressClick();
          syncPanelViewportBounds();
        } else {
          clearSnapAnimation();
        }

        cleanupDrag(reason);
      };

      const handleWindowBlur = () => {
        if (activePointerId === null) return;
        finishDrag('blur');
      };

      const handleVisibilityChange = () => {
        if (!document.hidden || activePointerId === null) return;
        finishDrag('visibilitychange');
      };

      const handlePointerDown = (event) => {
        if (!event.isPrimary) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        clearSnapAnimation();
        cleanupDrag('pointerdown-reset');
        suppressClick = false;
        startFabRect = dragTarget.getBoundingClientRect();
        const viewport = getViewportMetrics();
        dragWidth = Math.round(startFabRect.width) || dragTarget.offsetWidth || 58;
        dragHeight = Math.round(startFabRect.height) || dragTarget.offsetHeight || 58;
        startLeftPx = Math.round(startFabRect.left + viewport.offsetLeft);
        startTopPx = Math.round(startFabRect.top + viewport.offsetTop);
        currentLeftPx = startLeftPx;
        currentTopPx = startTopPx;
        currentSide = dragTarget?.dataset?.side === 'left' ? 'left' : BUBBLE_DEFAULT_SIDE;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        pendingClientX = event.clientX;
        pendingClientY = event.clientY;
        activePointerId = event.pointerId;
        dragAbortController = new AbortController();
        window.addEventListener('blur', handleWindowBlur, {
          passive: true,
          signal: dragAbortController.signal
        });
        document.addEventListener('visibilitychange', handleVisibilityChange, {
          signal: dragAbortController.signal
        });
        try {
          bubble.setPointerCapture(event.pointerId);
        } catch (e) {}
      };

      const handlePointerMove = (event) => {
        if (event.pointerId !== activePointerId) return;
        pendingClientX = event.clientX;
        pendingClientY = event.clientY;
        if (!didMove) {
          const movedX = Math.abs(event.clientX - dragStartX);
          const movedY = Math.abs(event.clientY - dragStartY);
          if (
            movedX < BUBBLE_DRAG_THRESHOLD_PX &&
            movedY < BUBBLE_DRAG_THRESHOLD_PX
          ) {
            return;
          }
          didMove = true;
          isDragging = true;
          dragTarget.classList.remove('is-snapping');
          dragTarget.classList.add('is-dragging');
          bubble.classList.add('is-dragging');
          document.body.style.userSelect = 'none';
          document.documentElement.style.userSelect = 'none';
        }
        queueDragFrame();
      };

      const handlePointerUp = (event) => {
        if (event.pointerId !== activePointerId) return;
        finishDrag('pointerup');
      };

      const handlePointerCancel = (event) => {
        if (event.pointerId !== activePointerId) return;
        finishDrag('pointercancel');
      };

      const handleLostPointerCapture = (event) => {
        if (event.pointerId !== activePointerId) return;
        finishDrag('lostpointercapture');
      };

      bubble.addEventListener('pointerdown', handlePointerDown);
      bubble.addEventListener('pointermove', handlePointerMove);
      bubble.addEventListener('pointerup', handlePointerUp);
      bubble.addEventListener('pointercancel', handlePointerCancel);
      bubble.addEventListener('lostpointercapture', handleLostPointerCapture);
      bubble.addEventListener('dragstart', (event) => {
        event.preventDefault();
      });

      cancelBubbleDragSession = () => {
        clearSnapAnimation();
        cleanupDrag('manual-cancel');
      };
    }

    const toggleMobileHubFromFab = (event) => {
      if (!(isCompactMobileChat() && !isEmbeddedMode())) return false;
      if (event?.target && (panel?.contains(event.target) || win?.contains(event.target))) return false;
      if (suppressClick) {
        suppressClick = false;
        return true;
      }
      if (isMobileHubOpen()) {
        closeMobileHub();
      } else {
        resetPanelSearchState();
        updateAssistantQuickRow();
        openMobileHub({ detail: false });
        setChatState({
          isChatOpen: false,
          isMinimized: false,
          activeConversationId,
          activePeerUid: activePeer?.uid || null
        });
      }
      return true;
    };

    if (bubble && panel) {
      bubble.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        if (toggleMobileHubFromFab(event)) return;
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        const visible = isPanelVisible(panel);
        syncPanelViewportBounds();
        if (visible) {
          closeUsersPanel({ minimizeConversation: true, origin: 'bubble' });
        } else {
          resetPanelSearchState();
          updateAssistantQuickRow();
          triggerBubbleReaction('opening');
          transitionSurface(panel, 'panel', true, { origin: 'bubble' });
        }
        if (visible && !activeConversationId) {
          setChatState({
            isChatOpen: false,
            isMinimized: true,
            activeConversationId: null,
            activePeerUid: null
          });
        }
      });
    }
    if (fab) {
      fab.addEventListener('click', (event) => {
        if (isCompactMobileChat() && !isEmbeddedMode()) return;
        if (bubble && event?.target && bubble.contains(event.target)) return;
        toggleMobileHubFromFab(event);
      });
    }
    if (panelClose && panel) {
      panelClose.addEventListener('click', () => {
        if (isCompactMobileChat() && !isEmbeddedMode()) {
          closeMobileHub();
          return;
        }
        closeUsersPanel({ minimizeConversation: true, origin: 'bubble' });
      });
    }
    if (overlay) {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          closeMobileHub();
        }
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
    if (searchInput) {
      searchInput.addEventListener('input', async () => {
        activeSearchQuery = normalizeSearchText(searchInput.value);
        userDirectoryError = '';

        if (!activeSearchQuery) {
          renderUsersPanel();
          return;
        }

        if (activeSearchQuery.length < USER_SEARCH_MIN_CHARS) {
          renderUsersPanel();
          return;
        }

        if (allUsersCache.length) {
          renderUsersPanel();
          return;
        }

        isUserDirectoryLoading = true;
        renderUsersPanel();

        try {
          await loadAllUsersDirectory();
        } catch (error) {
          console.warn('No se pudo cargar el directorio de usuarios del chat:', error);
          userDirectoryError = 'No se pudo cargar la lista de usuarios.';
        } finally {
          isUserDirectoryLoading = false;
          renderUsersPanel();
        }
      });

      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          resetUserSearch();
        }
      });
    }
    if (winBack && win) {
      winBack.addEventListener('click', () => {
        if (isCompactMobileChat() && !isEmbeddedMode()) {
          closeMobileDetail();
        }
      });
    }
    if (winClose && win) {
      winClose.addEventListener('click', () => {
        if (isCompactMobileChat() && !isEmbeddedMode()) {
          closeMobileHub();
          return;
        }
        if (activeConversationId) {
          removeConversation(activeConversationId, {
            windowOrigin: resolveWindowCloseOrigin({ minimize: false })
          });
        } else {
          transitionSurface(win, 'window', false, {
            origin: resolveWindowCloseOrigin({ minimize: false }),
            immediate: isEmbeddedMode()
          });
        }
      });
    }
    if (winMin && win) {
      winMin.addEventListener('click', () => {
        if (isCompactMobileChat() && !isEmbeddedMode()) {
          closeMobileDetail();
          return;
        }
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
        openSpecialConversation('dm_group_chat', 'Chat grupal', 'Sala común · Departamento Médico', { origin: 'panel' });
      });
    }
    if (quickForo) {
      quickForo.addEventListener('click', () => {
        openSpecialConversation('dm_foro_general', 'Foro general', 'Mensajes vinculados al foro', { origin: 'panel' });
      });
    }
    if (quickAi) {
      const openAssistant = async () => {
        try {
          const anchorEl = resolveAssistantAnchorForChat({
            panel,
            windowEl: win,
            bubble
          });
          const context = getChatContext();
          if (isCompactMobileChat() && !isEmbeddedMode()) {
            closeMobileHub();
          } else {
            closeUsersPanel({ origin: 'bubble' });
          }
          setChatState({
            isChatOpen: false,
            isMinimized: true,
            activeConversationId: null,
            activePeerUid: null
          });
          const shell = await ensureAssistantShellReady();
          const model = resolveAssistantModel();
          await shell.openChat?.(model, { anchorEl, context });
          updateAssistantQuickRow();
        } catch (error) {
          console.warn('No se pudo abrir el Asistente IA desde el chat:', error);
        }
      };
      quickAi.addEventListener('click', () => {
        openAssistant();
      });
      quickAi.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openAssistant();
        }
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
      if (isCompactMobileChat() && !isEmbeddedMode()) return;
      const target = e.target;
      const insidePanel = panel?.contains(target);
      const insideWin = win?.contains(target);
      const insideBubble = bubble?.contains(target);
      const insideTray = pillTray?.contains(target);
      const insideDelete = deleteModal?.contains(target);
      const insideDeleteConv = deleteConvModal?.contains(target);
      const insideToast = document.getElementById('brisa-chat-toast')?.contains(target);

      const panelIsVisible = isPanelVisible(panel);
      const winVisible = isSurfaceVisible(win);

      if (isDeleteModalOpen || isDeleteConversationModalOpen) return;
      if (isEmbeddedMode()) return;
      if (!insidePanel && !insideWin && !insideBubble && !insideTray && !insideDelete && !insideDeleteConv && !insideToast) {
        if (panelIsVisible) closeUsersPanel({ origin: 'bubble' });
        if (winVisible) minimizeActiveConversation();
        if (panelIsVisible && !winVisible) {
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
    bindPresenceHeartbeat();
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
      currentUser = user || null;
      if (!currentUser) {
        await handleSignedOutState();
        window.location.replace(buildLoginRedirectUrl());
        return;
      }
      if (currentUser) {
        currentProfile = null;
        try {
          const snap = await getDoc(doc(db, 'usuarios', currentUser.uid));
          if (snap.exists()) currentProfile = snap.data() || null;
        } catch (e) {
          console.warn('No se pudo cargar el perfil del usuario:', e);
        }
        lastPresenceHeartbeatAt = 0;
        await touchPresenceHeartbeat({ force: true });
        subscribePresence();
        ensureIncomingWatcher();
        updateCountsUI();
      }
      adjustPanelForTray();
      syncPanelViewportBounds();
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
    openHub: async (options = {}) => {
      injectChatShell();
      if (isCompactMobileChat() && !isEmbeddedMode()) {
        updateAssistantQuickRow();
        resetUserSearch();
        openMobileHub({ detail: Boolean(options.detail) });
      }
    },
    closeHub: () => {
      closeMobileHub();
    },
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
      const trayHasVisiblePills = pillTray
        ? Array.from(pillTray.children).some((child) => isSurfaceVisible(child))
        : false;
      const panelVisible = isPanelVisible(panel);
      const winVisible = isSurfaceVisible(win);
      const mobileHubOpen = isMobileHubOpen();
      const isChatOpen = isCompactMobileChat() ? mobileHubOpen : !!winVisible;
      const isMinimized = isCompactMobileChat() ? false : !!(!winVisible && trayHasVisiblePills);
      return {
        isChatOpen,
        isMinimized,
        activeConversationId: (isChatOpen || isMinimized || panelVisible) ? activeConversationId : null,
        activePeerUid: (isChatOpen || isMinimized || mobileHubOpen) ? (activePeer?.uid || null) : null,
        tabVisible: document.visibilityState === 'visible' && document.hasFocus()
      };
    }
  };
})();
