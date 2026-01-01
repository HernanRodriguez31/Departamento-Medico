import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  deleteDoc,
  doc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  increment,
  setDoc,
  runTransaction,
  deleteField,
  getCountFromServer,
  where,
  getDoc,
  getDocs,
  limit,
  startAfter
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getFirebase } from "../common/firebaseClient.js";
import { COLLECTIONS } from "../common/collections.js";
import { requireAuth, buildLoginRedirectUrl } from "../shared/authGate.js";
import { handleFirebaseError } from "../shared/errors.js";
import { initAssistantShell } from "../shared/assistant-shell.js";
import { logger, once, throttle } from "../common/app-logger.js";
import { initUserMenu } from "../common/user-menu.js";
import { hydrateAvatars } from "../common/user-profiles.js";

function ensureFirebase() {
  return getFirebase();
}

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
let inactivityTimerId = null;
let inactivityBound = false;

const buildAuthRedirect = () => buildLoginRedirectUrl(window.location.hash || "#carrete");

const initSessionGuard = (auth) => {
  if (!auth || inactivityBound) return;
  inactivityBound = true;

  const resetTimer = () => {
    if (inactivityTimerId) {
      clearTimeout(inactivityTimerId);
    }
    inactivityTimerId = setTimeout(async () => {
      if (!auth.currentUser) {
        window.location.replace(buildAuthRedirect());
        return;
      }
      try {
        await signOut(auth);
      } catch (e) {
        // no-op
      }
      window.location.replace(buildAuthRedirect());
    }, INACTIVITY_LIMIT_MS);
  };

  const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
  events.forEach((eventName) => {
    window.addEventListener(eventName, resetTimer, { passive: true });
  });
  window.addEventListener("focus", resetTimer);
  resetTimer();

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace(buildAuthRedirect());
    }
  });
};

const { POSTS: POSTS_COLLECTION, COMMENTS: COMMENTS_COLLECTION, USERS: USERS_COLLECTION } = COLLECTIONS;

async function initCarouselModule() {
  const formatDoctorName = (rawName) => {
    const clean = (rawName || "").trim();
    if (!clean) return "Invitado";
    const lower = clean.toLowerCase();
    if (lower === "invitado" || lower === "invitada") return clean;
    if (lower.startsWith("dr.") || lower.startsWith("dr ") || lower.startsWith("dra.") || lower.startsWith("dra ")) {
      return clean;
    }
    return `Dr. ${clean}`;
  };

  const { app, auth, db, storage } = ensureFirebase();
  const authedUser = await requireAuth(auth, { fallbackHash: "#carrete" });
  if (!authedUser) return;
  const appState = {
    permissionDenied: false,
    feedReady: false
  };
  const resolveUserValue = (obj, keys, fallback = "") => {
    for (const k of keys) {
      if (obj && obj[k]) return obj[k];
    }
    return fallback;
  };
  const permissionMessage =
    "No tenes permisos para ver este contenido. Inicia sesion o solicita acceso.";

  const isPermissionError = (err) => {
    if (!err) return false;
    const code = err.code || "";
    if (code === "permission-denied" || code === "unauthenticated") return true;
    const message = String(err.message || "");
    if (/missing or insufficient permissions/i.test(message)) return true;
    const status = err.status || err?.customData?.httpStatus || err?.customData?.status;
    return status === 403;
  };

  const applyPermissionState = () => {
    if (!appState.permissionDenied) return;
    if (typeof hasMorePosts !== "undefined") {
      hasMorePosts = false;
      isLoadingPosts = false;
    }
    if (typeof topPostsUnsub !== "undefined" && topPostsUnsub) {
      topPostsUnsub();
      topPostsUnsub = null;
    }
    if (typeof teardownFeedPagerObserver === "function") {
      teardownFeedPagerObserver();
    }
    if (typeof updateFeedSentinel === "function") {
      updateFeedSentinel({ loading: false, hasMore: false, errorMessage: permissionMessage });
    }
    if (track) {
      track.innerHTML = `<div class="dm-feed-permission">${permissionMessage}</div>`;
      if (feedSentinel?.parentElement) {
        feedSentinel.parentElement.removeChild(feedSentinel);
      }
    }
  };

  const handlePermissionDenied = (scope) => {
    if (appState.permissionDenied) return;
    appState.permissionDenied = true;
    once(`perm:${scope || "global"}`, () => {
      logger.warn("[Permisos] Acceso denegado.", scope || "global");
    });
    if (appState.feedReady) {
      applyPermissionState();
    }
  };
  const getUserProfileMeta = async (user) => {
    const fallbackName = user?.displayName || user?.email || "Usuario";
    if (!db || !user) {
      return { displayName: fallbackName, businessUnit: "", managementUnit: "" };
    }
    try {
      const snap = await getDoc(doc(db, USERS_COLLECTION, user.uid));
      if (!snap.exists()) {
        return { displayName: fallbackName, businessUnit: "", managementUnit: "" };
      }
      const data = snap.data() || {};
      const displayName =
        resolveUserValue(data, ["displayName", "nombreCompleto", "apellidoNombre", "fullName", "name", "nombre"], "") ||
        `${resolveUserValue(data, ["apellido", "lastName"], "")} ${resolveUserValue(data, ["nombre"], "")}`.trim() ||
        fallbackName;
      const businessUnit = resolveUserValue(data, ["businessUnit", "unidadNegocio", "bu", "business_unit"], "");
      const managementUnit = resolveUserValue(data, ["managementUnit", "unidadGestion", "mu", "management_unit"], "");
      return { displayName, businessUnit, managementUnit };
    } catch (e) {
      if (isPermissionError(e)) {
        handlePermissionDenied("profile");
      }
      throttle("profile-read", 60000, () => {
        logger.warn("[Muro] No se pudo leer perfil del usuario.", e);
      });
      return { displayName: fallbackName, businessUnit: "", managementUnit: "" };
    }
  };
  const appIdMeta = window.__APP_ID__ || "departamento-medico-brisa";
  const track = document.getElementById("dm-carousel-track");
  const dots = document.getElementById("dm-carousel-dots");
  const carouselSection = document.querySelector(".dm-carousel-section");
  const viewport = document.querySelector(".dm-carousel-viewport");
  const btnPrev = document.getElementById("dm-prev");
  const btnNext = document.getElementById("dm-next");
  const btnPause = document.getElementById("dm-playpause");
  const btnFullscreen = document.getElementById("dm-fullscreen");
  const btnDelete = document.getElementById("dm-delete");
  const btnAddImage = document.getElementById("dm-add-image");
  const btnLike = document.getElementById("dm-like");
  const likeCountEl = document.getElementById("dm-like-count");
  const overlayPrev = document.getElementById("dm-overlay-prev");
  const overlayNext = document.getElementById("dm-overlay-next");
  const visitsBadge = document.getElementById("contador-visitas");
  const addBtn = document.getElementById("dm-carousel-add") || btnAddImage;
  const infoReference = document.getElementById("dm-carousel-reference");
  const infoAuthor = document.getElementById("dm-carousel-author");
  const modal = document.getElementById("dm-carousel-modal");
  const modalClose = document.getElementById("dm-carousel-modal-close");
  const modalCancel = document.getElementById("dm-carousel-cancel");
  const form =
    (modal && modal.querySelector("form")) ||
    document.getElementById("dm-carousel-form");
  const fileInput = document.getElementById("dm-carousel-file-input");
  const titleInput = document.getElementById("dm-carousel-title-input");
  const buSelect = document.getElementById("dm-carousel-bu");
  const muSelect = document.getElementById("dm-carousel-mu");
  const errorBox = document.getElementById("dm-carousel-error");
  const saveBtn =
    (modal && modal.querySelector('button[type="submit"]')) ||
    document.getElementById("dm-carousel-save");
  if (modal?.parentElement && modal.parentElement !== document.body) {
    // Keep the modal outside transformed sections so it overlays the viewport.
    document.body.appendChild(modal);
  }
  const loader = document.getElementById("dm-loading");
  const speedDownBtn = document.getElementById("dm-slower");
  const speedUpBtn = document.getElementById("dm-faster");
  const speedInput = document.getElementById("dm-speed-input");
  const commentSendBtn = document.getElementById("dm-comment-send");
  const commentInlineInput = document.getElementById("dm-comment-inline-input");
  const commentEmojiBtn = document.querySelector(".dm-comment-emoji");
  const commentsList = document.getElementById("dm-comments-list");
  const commentsCount = document.getElementById("dm-comments-count");
  const muroInput = document.getElementById("dm-muro-input");
  const muroPhotoBtn = document.getElementById("dm-muro-photo");
  const muroSendBtn = document.getElementById("dm-muro-send");
  let isAdmin = false;
  let adminChecked = false;

  const applyAdminUi = () => {
    if (!btnDelete) return;
    btnDelete.style.display = isAdmin ? "inline-flex" : "none";
  };

  const resolveAdminStatus = async (user) => {
    if (!user) return false;
    try {
      const token = await user.getIdTokenResult();
      if (token?.claims?.admin === true) return true;
                } catch (e) {
                    throttle("admin-claims", 60000, () => {
                      logger.warn("[Admin] No se pudo leer custom claims.", e);
                    });
                }
    if (!db) return false;
    try {
      const snap = await getDoc(doc(db, "admin_whitelist", user.uid));
      return snap.exists();
                } catch (e) {
                    throttle("admin-whitelist", 60000, () => {
                      logger.warn("[Admin] No se pudo leer whitelist.", e);
                    });
                    return false;
                }
  };

  const refreshAdminState = async (user) => {
    if (!user) {
      isAdmin = false;
      adminChecked = true;
      applyAdminUi();
      return false;
    }
    const next = await resolveAdminStatus(user);
    isAdmin = next;
    adminChecked = true;
    applyAdminUi();
    return next;
  };
  applyAdminUi();

  const setupCalendarModeToggle = () => {
    const iframe = document.getElementById("calendar-iframe");
    const buttons = document.querySelectorAll("[data-calendar-mode]");
    if (!iframe || buttons.length === 0) return;

    const storageKey = "dm-calendar-mode";
    const normalizeMode = (mode) => (mode === "AGENDA" ? "AGENDA" : "MONTH");
    const getModeFromSrc = () => {
      try {
        const url = new URL(iframe.src, window.location.href);
        return normalizeMode(url.searchParams.get("mode"));
      } catch (e) {
        return "MONTH";
      }
    };
    const updateButtons = (mode) => {
      buttons.forEach((btn) => {
        const isActive = btn.dataset.calendarMode === mode;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    };
    const updateIframe = (mode) => {
      try {
        const url = new URL(iframe.src, window.location.href);
        if (url.searchParams.get("mode") === mode) return;
        url.searchParams.set("mode", mode);
        iframe.src = url.toString();
      } catch (e) {
        throttle("calendar-update", 60000, () => {
          logger.warn("No se pudo actualizar el calendario:", e);
        });
      }
    };

    let currentMode = getModeFromSrc();
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) currentMode = normalizeMode(stored);
    } catch (e) {
      // Ignore storage errors.
    }

    updateButtons(currentMode);
    updateIframe(currentMode);

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextMode = normalizeMode(btn.dataset.calendarMode);
        if (nextMode === currentMode) {
          updateButtons(currentMode);
          return;
        }
        currentMode = nextMode;
        updateButtons(currentMode);
        updateIframe(currentMode);
        try {
          localStorage.setItem(storageKey, currentMode);
        } catch (e) {
          // Ignore storage errors.
        }
      });
    });
  };

  setupCalendarModeToggle();

  const loadCommitteeStats = async () => {
    const kpiCommittees = document.getElementById("kpi-committees");
    const kpiMembers = document.getElementById("kpi-members");
    const kpiProjects = document.getElementById("kpi-projects");
    const setKpis = (committees, members, projects) => {
      if (kpiCommittees) kpiCommittees.textContent = String(committees);
      if (kpiMembers && kpiMembers.dataset.dynamic === "true") kpiMembers.textContent = String(members);
      if (kpiProjects) kpiProjects.textContent = String(projects);
    };

    if (!db) {
      setKpis("—", "—", "—");
      return;
    }

    const cards = document.querySelectorAll("#comites .comite__card");
    const committeesTotal = Array.from(cards).reduce((acc, card) => {
      return card.getAttribute("data-committee-id") ? acc + 1 : acc;
    }, 0);
    let membersTotal = 0;
    let projectsTotal = 0;
    let hasError = false;

    setKpis("—", "—", "—");

    for (const card of Array.from(cards)) {
      const committeeId = card.getAttribute("data-committee-id");
      if (!committeeId) continue;
      const statsDiv = card.querySelector(".committee-stats");
      if (!statsDiv) continue;
      const values = statsDiv.querySelectorAll(".committee-stat-value");
      const setValues = (int = "-", proj = "-") => {
        if (values[0]) values[0].textContent = String(int);
        if (values[1]) values[1].textContent = String(proj);
      };
      try {
        const membersRef = collection(db, "artifacts", appIdMeta, "public", "data", "committee_members");
        const topicsRef = collection(db, "artifacts", appIdMeta, "public", "data", "committee_topics");
        const membersSnap = await getCountFromServer(query(membersRef, where("committeeId", "==", committeeId)));
        const topicsSnap = await getCountFromServer(query(topicsRef, where("committeeId", "==", committeeId)));
        const memberCount = membersSnap.data().count || 0;
        const projectCount = topicsSnap.data().count || 0;
        setValues(memberCount, projectCount);
        membersTotal += memberCount;
        projectsTotal += projectCount;
      } catch (err) {
        if (isPermissionError(err)) {
          handlePermissionDenied("committee-stats");
        }
        throttle(`committee-stats-${committeeId}`, 60000, () => {
          logger.warn(`Error fetching stats for ${committeeId}:`, err);
        });
        hasError = true;
        setValues("-", "-");
      }
    }

    if (hasError) {
      setKpis("—", "—", "—");
    } else {
      setKpis(committeesTotal, membersTotal, projectsTotal);
    }

    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  };

  const loadCommitteeMetaCards = async () => {
    if (!db) return;
    try {
      const metaSnap = await getDocs(collection(db, "artifacts", appIdMeta, "public", "data", "committee_meta"));
      const metaMap = new Map(metaSnap.docs.map((d) => [d.id, d.data()]));
      document.querySelectorAll("#comites .comite__card").forEach((card) => {
        const id = card.getAttribute("data-committee-id");
        const meta = metaMap.get(id);
        if (!meta) return;
        const titleEl = card.querySelector(".comite__title");
        const descEl = card.querySelector(".comite__desc");
        if (meta.title && titleEl) titleEl.textContent = meta.title;
        if (meta.subtitle && descEl) descEl.textContent = meta.subtitle;
        if (id === "comite_salud_digital" && descEl) {
          descEl.textContent = "Transformación e innovación digital en salud.";
        }
      });
    } catch (e) {
      if (isPermissionError(e)) {
        handlePermissionDenied("committee-meta");
      }
      throttle("committee-meta", 60000, () => {
        logger.warn("Error cargando metadata de comités:", e);
      });
    }
  };

  const setupJoinButtons = () => {
    if (!auth || !db) return;
    const resolveValue = (obj, keys, fallback = "") => {
      for (const k of keys) {
        if (obj && obj[k]) return obj[k];
      }
      return fallback;
    };
    document.querySelectorAll(".comite__join-btn").forEach((btn) => {
      if (btn.dataset.joinBound === "1") return;
      btn.dataset.joinBound = "1";
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const committeeId = btn.getAttribute("data-committee-id");
        if (!committeeId) return;
        const user = auth.currentUser;
        if (!user) {
          Swal.fire({
            icon: "warning",
            title: "Iniciá sesión",
            text: "Debes iniciar sesión para unirte a un comité."
          });
          return;
        }
        try {
          const userRef = doc(db, USERS_COLLECTION, user.uid);
          const snap = await getDoc(userRef);
          if (!snap.exists()) {
            Swal.fire({
              icon: "error",
              title: "Perfil incompleto",
              text: "No encontramos tu información. Volvé a iniciar sesión."
            });
            return;
          }
          const data = snap.data() || {};
          const existing = await getDocs(
            query(
              collection(db, "artifacts", appIdMeta, "public", "data", "committee_members"),
              where("committeeId", "==", committeeId),
              where("userUid", "==", user.uid)
            )
          );
          if (!existing.empty) {
            Swal.fire({
              icon: "info",
              title: "Ya sos integrante",
              text: "Tu membresía ya está registrada."
            });
            btn.disabled = true;
            btn.innerHTML = '<span class="comite__join-icon">+</span> Ya sos integrante';
            return;
          }
          const displayName =
            resolveValue(data, ["displayName", "nombreCompleto", "apellidoNombre", "fullName", "name", "nombre"], "") ||
            `${resolveValue(data, ["apellido", "lastName"], "")} ${resolveValue(data, ["nombre"], "")}`.trim() ||
            user.displayName ||
            user.email ||
            "Médico";
          const businessUnit = resolveValue(data, ["businessUnit", "unidadNegocio", "bu", "business_unit"], "");
          const managementUnit = resolveValue(data, ["managementUnit", "unidadGestion", "mu", "management_unit"], "");
          await addDoc(
            collection(db, "artifacts", appIdMeta, "public", "data", "committee_members"),
            {
              committeeId,
              userUid: user.uid,
              name: displayName,
              businessUnit,
              managementUnit,
              isLeader: false,
              createdAt: serverTimestamp()
            }
          );
          Swal.fire({
            icon: "success",
            title: "¡Te uniste al comité!",
            text: "Tu participación fue registrada.",
            timer: 2000,
            showConfirmButton: false
          });
          btn.disabled = true;
          btn.innerHTML = '<span class="comite__join-icon">+</span> Ya sos integrante';
        } catch (err) {
          if (isPermissionError(err)) {
            handlePermissionDenied("committee-join");
          }
          throttle("committee-join", 60000, () => {
            logger.warn("Error al unir al comité:", err);
          });
          Swal.fire({
            icon: "error",
            title: "Error",
            text: "No se pudo procesar la solicitud."
          });
        }
      });
    });
  };

  const setupCommitteeCards = () => {
    const cards = document.querySelectorAll("#comites .comite__card");
    cards.forEach((card) => {
      if (card.dataset.comiteNavBound === "1") return;
      const link = card.dataset.link || card.getAttribute("data-link");
      if (!link) return;
      card.dataset.comiteNavBound = "1";
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "link");
      card.addEventListener("click", (e) => {
        if (e.target && e.target.closest("button, a, input, textarea, select, label")) return;
        window.location.href = link;
      });
      card.addEventListener("keydown", (e) => {
        if (document.activeElement !== card) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          window.location.href = link;
        }
      });
    });
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  };
  setupCommitteeCards();

  const syncCommentSendState = () => {
    if (!commentSendBtn || !commentInlineInput) return;
    commentSendBtn.disabled = commentInlineInput.value.trim().length === 0;
  };
  syncCommentSendState();

  if (!track || !dots) return;
  if (!app || !auth || !db || !storage) {
    logger.error("[Galeria] No se pudo inicializar Firebase para el carrusel", { app, auth, db, storage });
    Swal.fire("Error", "No se pudo conectar con el servidor. Intente nuevamente.", "error");
    track.innerHTML = `<div class="dm-carousel-empty">No hay conexión a la galería.</div>`;
    dots.innerHTML = "";
    return;
  }
  loadCommitteeMetaCards();
  loadCommitteeStats();
  setupJoinButtons();
  const gestionesPorNegocio = {
    Upstream: ["Golfo San Jorge", "Neuquén", "Acambuco"],
    Downstream: ["Refinería Campana", "Edificio Av. Alem 1110", "CORS"],
    "Salud Ocupacional Brisa - MPSA/FSE": ["Golfo San Jorge", "Neuquén"]
  };
  const populateUnidadGestionSelect = () => {
    const negocio = buSelect?.value || "";
    if (!muSelect) return;
    muSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Seleccionar";
    muSelect.appendChild(placeholder);
    const opciones = gestionesPorNegocio[negocio] || [];
    opciones.forEach((nombre) => {
      const opt = document.createElement("option");
      opt.value = nombre;
      opt.textContent = nombre;
      muSelect.appendChild(opt);
    });
    muSelect.value = "";
  };
  let slides = [];
  let feedPosts = [];
  let postsById = new Map();
  let currentIndex = 0;
  let activeIndex = 0;
  let feedObserver = null;
  const feedVisibleRatios = new Map();
  const prefetchedFull = new Set();
  const feedQuery = window.matchMedia("(max-width: 768px)");
  const displayModeQuery = window.matchMedia("(display-mode: standalone)");
  let feedMode = feedQuery.matches || displayModeQuery.matches;
  let autoTimer = null;
  const defaultSpeed = 10000; // 10 segundos por defecto
  const storedSpeed = Number(localStorage.getItem("dm-speed"));
  let autoplaySpeed = Number.isFinite(storedSpeed) && storedSpeed > 0 ? storedSpeed : defaultSpeed;
  // Forzar nuevo estándar: mínimo 10s al iniciar
  if (!Number.isFinite(storedSpeed) || storedSpeed < defaultSpeed) {
    autoplaySpeed = defaultSpeed;
    localStorage.setItem("dm-speed", defaultSpeed);
  }
  let autoplayRunning = true;
  let isTransitioning = false;
  const likeTooltip = document.createElement("div");
  likeTooltip.className = "dm-like-tooltip dm-like-tooltip-hidden";
  document.body.appendChild(likeTooltip);

  const updateVisitsUI = (count = 0) => {
    if (visitsBadge) visitsBadge.textContent = String(count);
  };

  let visitsSubscribed = false;
  let unsubscribeComments = null;
  const feedCommentSubscriptions = new Map();
  let isComposingComment = false;
  const PAGE_SIZE = 10;
  const FEED_SKELETON_COUNT = 5;
  const PAGE_SKELETON_COUNT = 3;
  let lastPostDoc = null;
  let hasMorePosts = true;
  let isLoadingPosts = false;
  let isInitialLoading = true;
  let feedPagerObserver = null;
  let feedSentinel = null;
  let feedLoader = null;
  let feedEnd = null;
  let feedError = null;
  let topPostsUnsub = null;
  const renderedPostIds = new Set();
  const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

  appState.feedReady = true;
  if (appState.permissionDenied) {
    applyPermissionState();
  }
  const updateFeedModeClass = () => {
    if (!carouselSection) return;
    carouselSection.classList.toggle("is-feed-mode", feedMode);
  };
  updateFeedModeClass();

  const buildFeedSkeletonCards = (count) =>
    Array.from({ length: count })
      .map(
        () => `
      <article class="dm-post dm-post-skeleton">
        <div class="dm-skeleton-line dm-skeleton-line--sm"></div>
        <div class="dm-skeleton-line dm-skeleton-line--md"></div>
        <div class="dm-skeleton-block"></div>
        <div class="dm-skeleton-line dm-skeleton-line--lg"></div>
      </article>
    `
      )
      .join("");

  const buildFeedSkeleton = () => buildFeedSkeletonCards(FEED_SKELETON_COUNT);
  const buildFeedPaginationSkeleton = () => buildFeedSkeletonCards(PAGE_SKELETON_COUNT);

  // Infinite scroll sentinel for feed pagination.
  const ensureFeedSentinel = () => {
    if (feedSentinel) return feedSentinel;
    feedSentinel = document.createElement("div");
    feedSentinel.className = "dm-feed-sentinel";
    feedSentinel.innerHTML = `
      <div class="dm-feed-loader" data-role="feed-loader" hidden>
        ${buildFeedPaginationSkeleton()}
      </div>
      <div class="dm-feed-end" data-role="feed-end" hidden>No hay más publicaciones.</div>
      <div class="dm-feed-error" data-role="feed-error" hidden></div>
    `;
    feedLoader = feedSentinel.querySelector('[data-role="feed-loader"]');
    feedEnd = feedSentinel.querySelector('[data-role="feed-end"]');
    feedError = feedSentinel.querySelector('[data-role="feed-error"]');
    return feedSentinel;
  };

  const updateFeedSentinel = ({ loading = false, hasMore = true, errorMessage = "" } = {}) => {
    if (!feedSentinel) return;
    if (feedLoader) feedLoader.hidden = !loading;
    if (feedEnd) feedEnd.hidden = hasMore || loading || Boolean(errorMessage);
    if (feedError) {
      feedError.hidden = !errorMessage;
      feedError.textContent = errorMessage || "";
    }
  };

  const renderFeedSkeleton = () => {
    if (!track) return;
    track.innerHTML = buildFeedSkeleton();
    track.appendChild(ensureFeedSentinel());
    updateFeedSentinel({ loading: true, hasMore: true, errorMessage: "" });
  };

  const teardownFeedPagerObserver = () => {
    if (!feedPagerObserver) return;
    feedPagerObserver.disconnect();
    feedPagerObserver = null;
  };

  const setupFeedPagerObserver = () => {
    teardownFeedPagerObserver();
    if (!feedMode || !feedSentinel || !hasMorePosts || appState.permissionDenied) return;
    feedPagerObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadPostsPage({ reset: false });
        }
      },
      { root: null, rootMargin: "600px 0px", threshold: 0 }
    );
    feedPagerObserver.observe(feedSentinel);
  };

  const mapPostDoc = (d) => {
    const data = d.data() || {};
    const likedBy = Array.isArray(data.likedBy) ? data.likedBy : [];
    const likedNames = Array.isArray(data.likedNames) ? data.likedNames : [];
    let likesCount = Number.isFinite(data.likesCount) ? data.likesCount : 0;
    if (likedBy.length > 0) {
      likesCount = likedBy.length;
    } else if (likesCount > 0) {
      likesCount = 0;
    }
    const createdByName = data.createdByName || data.authorName || data.author || data.createdBy;
    const unidadNegocio =
      data.unidadNegocio || data.businessUnit || data.business_unit || data.bu || data.sector || "";
    const unidadGestion =
      data.unidadGestion || data.managementUnit || data.management_unit || data.mu || "";
    const text = data.text || data.title || "";
    const type = data.type || (data.imageUrl ? "image" : "text");
    return {
      id: d.id,
      title: data.title,
      text,
      type,
      imageUrl: data.imageUrl,
      thumbUrl: data.thumbUrl || data.thumbURL || "",
      createdByUid: data.createdByUid || "",
      authorUid: data.authorUid || "",
      unidadNegocio,
      unidadGestion,
      createdByName,
      createdAt: data.createdAt,
      likesCount,
      likedBy,
      likedNames
    };
  };

  const mergePosts = (incoming, { reset = false } = {}) => {
    if (reset) {
      feedPosts = incoming;
      postsById = new Map(incoming.map((post) => [post.id, post]));
    } else {
      incoming.forEach((post) => {
        if (postsById.has(post.id)) {
          const existing = postsById.get(post.id) || {};
          const merged = { ...existing, ...post };
          postsById.set(post.id, merged);
          const idx = feedPosts.findIndex((item) => item.id === post.id);
          if (idx >= 0) feedPosts[idx] = merged;
        } else {
          postsById.set(post.id, post);
          feedPosts.push(post);
        }
      });
    }
    slides = feedPosts.filter((s) => s.imageUrl);
  };

  const resolveCreatedAt = (post) => {
    if (!post?.createdAt) return 0;
    if (typeof post.createdAt.toMillis === "function") return post.createdAt.toMillis();
    if (Number.isFinite(post.createdAt?.seconds)) return post.createdAt.seconds * 1000;
    if (post.createdAt instanceof Date) return post.createdAt.getTime();
    const asNumber = Number(post.createdAt);
    return Number.isFinite(asNumber) ? asNumber : 0;
  };

  const buildFeedPostMarkup = (s, idx) => {
    const description = formatPostDescription(s);
    const fullUrl = s.imageUrl;
    const thumbUrl = s.thumbUrl || "";
    const displaySrc = thumbUrl || fullUrl || "";
    const blurClass = thumbUrl ? " is-blur" : "";
    const media = fullUrl
      ? `
      <div class="dm-carousel-media dm-post__media is-loading">
        <img class="dm-carousel-img dm-post-img${blurClass}"
          src="${TRANSPARENT_PIXEL}"
          data-src="${displaySrc}"
          data-full="${fullUrl}"
          data-thumb="${thumbUrl}"
          alt="${s.title || "Imagen de la galería"}"
          loading="lazy"
          decoding="async"
          fetchpriority="low"
          width="1200"
          height="900" />
        <span class="dm-img-skeleton" aria-hidden="true"></span>
      </div>
      `
      : "";
    const descBlock = description ? `<div class="dm-post__desc">${description}</div>` : "";
    const currentUser = auth?.currentUser;
    const ownerId = s.createdByUid || s.authorUid || "";
    const authorUid = s.createdByUid || s.authorUid || "";
    const authorName = s.createdByName || s.authorName || s.author || s.createdBy || "Usuario";
    const avatarSlot = `
      <div class="dm-post__avatar" data-author-uid="${escapeHtml(authorUid)}" data-author-name="${escapeHtml(authorName)}">
        <img class="dm-post__avatar-img" data-author-avatar
          src="${TRANSPARENT_PIXEL}" alt="Avatar"
          loading="lazy" decoding="async" hidden />
        <span class="dm-post__avatar-fallback" data-avatar-fallback="initials"></span>
      </div>
    `;
    const canDelete = currentUser && (isAdmin || (ownerId && ownerId === currentUser.uid));
    const deleteBtn = canDelete
      ? `<button class="dm-post-delete" type="button" data-id="${s.id}" aria-label="Borrar publicación" title="Borrar">
          <svg class="dm-post-delete__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M8 6V4h8v2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M6 6l1 14h10l1-14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M10 11v6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M14 11v6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </button>`
      : "";
    const likeNames =
      Array.isArray(s.likedNames) && s.likedNames.length
        ? s.likedNames
        : Array.isArray(s.likedBy)
        ? s.likedBy
        : [];
    const likeTooltipText = buildLikeTooltipText(likeNames);
    const hasLikes = (s.likesCount || 0) > 0;
    const viewLikesBtn = `<button class="dm-post-like-view" type="button" data-id="${s.id}" aria-label="Ver likes" title="Ver likes" ${
      hasLikes ? "" : "hidden"
    }>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" fill="none" stroke="currentColor" stroke-width="1.6"></path>
          <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle>
        </svg>
      </button>`;
    return `
      <article class="dm-post dm-carousel-slide" data-idx="${idx}" data-id="${s.id}">
        <div class="dm-post__meta-row">
          <div class="dm-post__meta">
            ${avatarSlot}
            <span class="dm-post__meta-text">${formatPostMeta(s)}</span>
          </div>
          ${deleteBtn}
        </div>
        ${descBlock}
        ${media}
        <div class="dm-post__actions">
          <button class="dm-post-like" type="button" data-id="${s.id}">
            ❤️ <span class="dm-post-like-count">${s.likesCount ? String(s.likesCount) : "0"}</span>
            <span class="dm-like-tooltip">${likeTooltipText}</span>
          </button>
          ${viewLikesBtn}
          <button class="dm-post-comment-toggle" type="button" data-id="${s.id}">
            💬 <span class="dm-post-comment-count">0</span>
          </button>
        </div>
        <div class="dm-comments dm-comments--inline dm-post-comments is-collapsed is-empty" data-post-id="${s.id}">
          <div class="dm-comments__header">
            <div class="dm-comments__title">Comentarios</div>
            <div class="dm-comments__count">0</div>
          </div>
          <div class="dm-comments__list"></div>
          <form class="dm-comments__composer dm-post-comment-form">
            <div class="dm-comment-inline">
              <textarea class="dm-post-comment-input" rows="1" placeholder="Escribe un comentario..." aria-label="Comentar publicación"></textarea>
            </div>
            <button class="dm-comment-submit dm-post-comment-send" type="submit">Comentar</button>
          </form>
        </div>
      </article>
    `;
  };

  const createFeedPostElement = (post, idx) => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = buildFeedPostMarkup(post, idx).trim();
    return wrapper.firstElementChild;
  };

  const syncFeedIndices = () => {
    if (!track) return;
    track.querySelectorAll(".dm-post").forEach((postEl, idx) => {
      postEl.dataset.idx = String(idx);
    });
  };

  const wireFeedPostElement = (postEl) => {
    if (!postEl || postEl.dataset.wired === "true") return;
    postEl.dataset.wired = "true";
    const postId = postEl.dataset.id;
    if (!postId) return;
    updateFeedLikeUI(postEl, getSlideById(postId));
    const likeBtn = postEl.querySelector(".dm-post-like");
    likeBtn?.addEventListener("click", () => togglePostLike(postId, postEl));
    const viewLikesBtn = postEl.querySelector(".dm-post-like-view");
    viewLikesBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleLikeTooltip(likeBtn);
    });
    const deleteBtn = postEl.querySelector(".dm-post-delete");
    deleteBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const user = auth?.currentUser;
      if (!user) {
        Swal?.fire?.("Sesión requerida", "Iniciá sesión para borrar la publicación.", "warning");
        return;
      }
      await deletePostWithReauth(postId, user);
    });
    const listEl = postEl.querySelector(".dm-comments__list");
    const countEl = postEl.querySelector(".dm-comments__count");
    const actionCountEl = postEl.querySelector(".dm-post-comment-count");
    const commentsWrap = postEl.querySelector(".dm-post-comments");
    commentsWrap?.classList.add("is-collapsed");
    subscribeCommentsForPost(postId, listEl, countEl, actionCountEl, postEl);
    const formEl = postEl.querySelector(".dm-post-comment-form");
    const inputEl = postEl.querySelector(".dm-post-comment-input");
    const expandComments = () => {
      if (!commentsWrap) return;
      commentsWrap.classList.remove("is-collapsed");
      commentsWrap.classList.add("is-expanded");
      commentsWrap.classList.remove("is-empty");
      inputEl?.focus();
    };
    formEl?.addEventListener("submit", (e) => {
      e.preventDefault();
      sendFeedComment(postId, inputEl);
    });
    inputEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendFeedComment(postId, inputEl);
      }
    });
    inputEl?.addEventListener("focus", expandComments);
    const commentToggle = postEl.querySelector(".dm-post-comment-toggle");
    commentToggle?.addEventListener("click", () => {
      expandComments();
    });
    commentsWrap?.addEventListener("click", () => {
      if (commentsWrap.classList.contains("is-collapsed")) {
        expandComments();
      }
    });
    const img = postEl.querySelector("img");
    if (img) {
      initPostImage(img);
      const handleOrientation = () => {
        if (img.naturalHeight > img.naturalWidth) {
          postEl.classList.add("vertical");
        }
      };
      img.addEventListener("load", handleOrientation);
      if (img.complete) handleOrientation();
    }
  };

  const renderFeedList = ({ reset = false } = {}) => {
    if (!track) return;
    if (appState.permissionDenied) {
      applyPermissionState();
      return;
    }
    if (reset) {
      teardownFeedObserver();
      clearFeedCommentSubscriptions();
      renderedPostIds.clear();
      track.innerHTML = "";
    }
    if (!feedPosts.length) {
      track.innerHTML = `<div class="dm-carousel-empty">Todavía no hay publicaciones.</div>`;
      if (feedSentinel?.parentElement) {
        feedSentinel.parentElement.removeChild(feedSentinel);
      }
      return;
    }
    if (reset) {
      const fragment = document.createDocumentFragment();
      feedPosts.forEach((post, idx) => {
        const postEl = createFeedPostElement(post, idx);
        fragment.appendChild(postEl);
        renderedPostIds.add(post.id);
      });
      track.appendChild(fragment);
      track.appendChild(ensureFeedSentinel());
      updateFeedSentinel({
        loading: isLoadingPosts && !isInitialLoading,
        hasMore: hasMorePosts,
        errorMessage: feedError?.textContent || ""
      });
      track.querySelectorAll(".dm-post").forEach(wireFeedPostElement);
      hydrateAvatars(track);
      setupFeedObserver();
      setupFeedPagerObserver();
      track.style.transition = "none";
      track.style.transform = "none";
      activeIndex = 0;
      isTransitioning = false;
      if (autoTimer) clearInterval(autoTimer);
      renderDots([]);
    }
  };

  const appendFeedPosts = (posts, { position = "end", preserveScroll = false } = {}) => {
    if (!track || !posts.length) return;
    const uniquePosts = posts.filter((post) => !renderedPostIds.has(post.id));
    if (!uniquePosts.length) return;
    const fragment = document.createDocumentFragment();
    const newElements = [];
    uniquePosts.forEach((post) => {
      const idx = feedPosts.findIndex((item) => item.id === post.id);
      const postEl = createFeedPostElement(post, idx >= 0 ? idx : renderedPostIds.size);
      fragment.appendChild(postEl);
      newElements.push(postEl);
      renderedPostIds.add(post.id);
    });

    const prevScrollTop = preserveScroll ? window.scrollY : 0;
    const prevHeight = preserveScroll ? document.documentElement.scrollHeight : 0;
    const emptyState = track.querySelector(".dm-carousel-empty");
    if (emptyState) emptyState.remove();

    if (position === "start") {
      const firstPost = track.querySelector(".dm-post");
      if (firstPost) {
        track.insertBefore(fragment, firstPost);
      } else if (feedSentinel && feedSentinel.parentElement === track) {
        track.insertBefore(fragment, feedSentinel);
      } else {
        track.appendChild(fragment);
      }
      syncFeedIndices();
    } else if (feedSentinel && feedSentinel.parentElement === track) {
      track.insertBefore(fragment, feedSentinel);
    } else {
      track.appendChild(fragment);
    }

    newElements.forEach(wireFeedPostElement);
    newElements.forEach((el) => hydrateAvatars(el));
    setupFeedObserver();
    setupFeedPagerObserver();
    if (preserveScroll) {
      requestAnimationFrame(() => {
        const nextHeight = document.documentElement.scrollHeight;
        const delta = nextHeight - prevHeight;
        if (delta > 0) window.scrollTo(0, prevScrollTop + delta);
      });
    }
  };

  const updateFeedPostElement = (post) => {
    if (!track || !post) return;
    const postEl = track.querySelector(`.dm-post[data-id="${post.id}"]`);
    if (!postEl) return;
    const metaEl = postEl.querySelector(".dm-post__meta-text");
    if (metaEl) metaEl.textContent = formatPostMeta(post);
    const avatarEl = postEl.querySelector("[data-author-uid]");
    if (avatarEl) {
      const authorUid = post.createdByUid || post.authorUid || "";
      const authorName = post.createdByName || post.authorName || post.author || post.createdBy || "Usuario";
      avatarEl.dataset.authorUid = authorUid;
      avatarEl.dataset.authorName = authorName;
      hydrateAvatars(postEl);
    }
    const descEl = postEl.querySelector(".dm-post__desc");
    const description = formatPostDescription(post);
    if (descEl) {
      if (description) {
        descEl.textContent = description;
      } else {
        descEl.remove();
      }
    } else if (description) {
      const metaRow = postEl.querySelector(".dm-post__meta-row");
      const descNode = document.createElement("div");
      descNode.className = "dm-post__desc";
      descNode.textContent = description;
      metaRow?.insertAdjacentElement("afterend", descNode);
    }
    updateFeedLikeUI(postEl, post);
  };

  const subscribeTopPosts = () => {
    if (!db || topPostsUnsub || appState.permissionDenied) return;
    const topQuery = query(collection(db, POSTS_COLLECTION), orderBy("createdAt", "desc"), limit(PAGE_SIZE));
    topPostsUnsub = onSnapshot(
      topQuery,
      (snap) => {
        const newPosts = [];
        const updatedPosts = [];
        const removedIds = [];
        snap.docChanges().forEach((change) => {
          const post = mapPostDoc(change.doc);
          if (change.type === "added") {
            if (postsById.has(post.id) || renderedPostIds.has(post.id)) {
              updatedPosts.push(post);
            } else {
              newPosts.push(post);
            }
          } else if (change.type === "modified") {
            updatedPosts.push(post);
          } else if (change.type === "removed") {
            removedIds.push(change.doc.id);
          }
        });

        if (newPosts.length) {
          newPosts.sort((a, b) => resolveCreatedAt(b) - resolveCreatedAt(a));
          const newIds = new Set(newPosts.map((post) => post.id));
          feedPosts = [...newPosts, ...feedPosts.filter((post) => !newIds.has(post.id))];
          newPosts.forEach((post) => postsById.set(post.id, post));
          if (feedMode) {
            appendFeedPosts(newPosts, { position: "start", preserveScroll: true });
          }
        }

        if (updatedPosts.length) {
          updatedPosts.forEach((post) => {
            const existing = postsById.get(post.id) || {};
            const merged = { ...existing, ...post };
            postsById.set(post.id, merged);
            const idx = feedPosts.findIndex((item) => item.id === post.id);
            if (idx >= 0) feedPosts[idx] = merged;
            if (feedMode) {
              updateFeedPostElement(merged);
            }
          });
        }

        if (removedIds.length) {
          removedIds.forEach((id) => {
            postsById.delete(id);
            feedPosts = feedPosts.filter((post) => post.id !== id);
            if (feedMode) {
              const postEl = track?.querySelector(`.dm-post[data-id="${id}"]`);
              if (postEl) {
                postEl.remove();
                renderedPostIds.delete(id);
              }
            }
          });
          if (feedMode) {
            syncFeedIndices();
          }
        }

        slides = feedPosts.filter((s) => s.imageUrl);
        if (!feedPosts.length && feedMode) {
          track.innerHTML = `<div class="dm-carousel-empty">Todavía no hay publicaciones.</div>`;
        }
      },
      (err) => {
        if (isPermissionError(err)) {
          handlePermissionDenied("muro-live");
          updateFeedSentinel({ loading: false, hasMore: false, errorMessage: permissionMessage });
          return;
        }
        handleFirebaseError(err, {
          scope: "muro-live",
          onPermissionDenied: () => {
            handlePermissionDenied("muro-live");
            updateFeedSentinel({ loading: false, hasMore: false, errorMessage: permissionMessage });
          },
          onUnavailable: () => {
            updateFeedSentinel({ loading: false, hasMore: true, errorMessage: "Sin conexión. Reintentando..." });
          },
          onDefault: () => {}
        });
      }
    );
  };

  // Firestore pagination uses limit/startAfter for the feed.
  const loadPostsPage = async ({ reset = false } = {}) => {
    if (!db || isLoadingPosts || appState.permissionDenied) return;
    if (!hasMorePosts && !reset) return;
    isLoadingPosts = true;

    if (reset) {
      lastPostDoc = null;
      hasMorePosts = true;
      isInitialLoading = true;
      renderFeedSkeleton();
    } else {
      updateFeedSentinel({ loading: true, hasMore: hasMorePosts, errorMessage: "" });
    }

    try {
      let q = query(collection(db, POSTS_COLLECTION), orderBy("createdAt", "desc"), limit(PAGE_SIZE));
      if (!reset && lastPostDoc) {
        q = query(collection(db, POSTS_COLLECTION), orderBy("createdAt", "desc"), startAfter(lastPostDoc), limit(PAGE_SIZE));
      }
      const snap = await getDocs(q);
      const incoming = snap.docs.map(mapPostDoc).filter((s) => s.imageUrl || s.text || s.title);
      mergePosts(incoming, { reset });
      if (snap.docs.length > 0) {
        lastPostDoc = snap.docs[snap.docs.length - 1];
      }
      hasMorePosts = snap.docs.length === PAGE_SIZE;
      if (feedMode) {
        if (reset) {
          renderFeedList({ reset: true });
        } else {
          appendFeedPosts(incoming, { position: "end" });
        }
      } else {
        renderSlides();
      }
    } catch (err) {
      let fallbackMessage = "No pudimos cargar el muro.";
      if (isPermissionError(err)) {
        hasMorePosts = false;
        handlePermissionDenied("muro-pagination");
        fallbackMessage = permissionMessage;
        updateFeedSentinel({ loading: false, hasMore: false, errorMessage: fallbackMessage });
      } else {
        handleFirebaseError(err, {
          scope: "muro-pagination",
          onPermissionDenied: () => {
            hasMorePosts = false;
            handlePermissionDenied("muro-pagination");
            fallbackMessage = permissionMessage;
            updateFeedSentinel({ loading: false, hasMore: false, errorMessage: fallbackMessage });
          },
          onUnavailable: () => {
            fallbackMessage = "Sin conexión. Reintentá en unos segundos.";
            updateFeedSentinel({ loading: false, hasMore: true, errorMessage: fallbackMessage });
          },
          onDefault: () => {
            fallbackMessage = "No pudimos cargar más publicaciones.";
            updateFeedSentinel({ loading: false, hasMore: true, errorMessage: fallbackMessage });
          }
        });
      }
      if (reset && track && feedPosts.length === 0) {
        track.innerHTML = `<div class="dm-carousel-empty">${fallbackMessage}</div>`;
      }
    } finally {
      isLoadingPosts = false;
      isInitialLoading = false;
      updateFeedSentinel({ loading: false, hasMore: hasMorePosts, errorMessage: feedError?.textContent || "" });
      setupFeedPagerObserver();
      logger.debug("[Muro] Página cargada", { hasMorePosts, lastPostDoc: Boolean(lastPostDoc) });
    }
  };

  const subscribeVisits = () => {
    if (!db || !visitsBadge || visitsSubscribed || appState.permissionDenied) return;
    const visitsRef = doc(db, "dm_meta", "home_visits");
    onSnapshot(
      visitsRef,
      (snap) => {
        const data = snap.data();
        const safeCount = Number.isFinite(data?.count) ? data.count : 0;
        updateVisitsUI(safeCount);
      },
      (err) => {
        if (isPermissionError(err)) {
          handlePermissionDenied("visits-read");
          updateVisitsUI("—");
          return;
        }
        once("visits-read", () => {
          logger.warn("[Visitas] Error leyendo contador", err);
        });
      }
    );
    setDoc(visitsRef, { count: increment(1), updatedAt: serverTimestamp() }, { merge: true }).catch((err) =>
      once("visits-increment", () => {
        logger.warn("[Visitas] Error sumando visita", err);
      })
    );
    visitsSubscribed = true;
  };

  const loadInitialPosts = () => {
    loadPostsPage({ reset: true });
    subscribeTopPosts();
  };
  const applyTransform = () => {
    if (feedMode) return;
    track.style.transform = `translate3d(-${currentIndex * 100}%, 0, 0)`;
  };

  const resetAuto = () => {
    if (autoTimer) clearInterval(autoTimer);
    if (feedMode || !autoplayRunning || isComposingComment) return;
    autoTimer = setInterval(() => moveTo(currentIndex + 1), autoplaySpeed);
  };

  const hasCurrentUserLiked = () => {
    const { auth: currentAuth } = ensureFirebase();
    const current = slides[getVisualIndex()];
    const user = currentAuth?.currentUser;
    if (!user || !current?.likedBy) return false;
    return current.likedBy.includes(user.uid);
  };

  const refreshLikeUI = () => {
    const current = slides[getVisualIndex()];
    if (likeCountEl) {
      likeCountEl.textContent = current?.likesCount ? String(current.likesCount) : "0";
    }
    if (btnLike) {
      const alreadyLiked = hasCurrentUserLiked();
      btnLike.classList.toggle("dm-like-active", alreadyLiked);
    }
  };

  const updateInfoPanel = () => {
    if (!infoReference || !infoAuthor) return;
    if (!slides.length) {
      infoReference.textContent = "Referencia: -";
      infoAuthor.textContent = "Autor: -";
      subscribeCommentsForSlide(null);
      return;
    }
    const current = slides[getVisualIndex()];
    infoReference.textContent = `Referencia: ${current?.title || "Sin título"}`;
    const authorUid = current?.createdByUid || current?.authorUid || "";
    const authorName = current?.createdByName || current?.authorName || current?.author || "Autor";
    infoAuthor.innerHTML = `
      <span class="dm-carousel-author" data-author-uid="${escapeHtml(authorUid)}" data-author-name="${escapeHtml(authorName)}">
        <img class="dm-carousel-author__img" data-author-avatar src="${TRANSPARENT_PIXEL}" alt="Avatar" hidden />
        <span class="dm-carousel-author__fallback" data-avatar-fallback="initials"></span>
      </span>
      <span class="dm-carousel-meta-text">${formatMeta(current || {})}</span>
    `;
    hydrateAvatars(infoAuthor);
    subscribeCommentsForSlide(current?.id);
  };

  const formatMeta = (s) => {
    const date = s.createdAt?.toDate ? s.createdAt.toDate() : new Date();
    const dateStr = date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const timeStr = date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    const author = s.createdByName || "Autor";
    const unidadNegocio = s.unidadNegocio || "Unidad de negocio";
    const unidadGestion = s.unidadGestion || "Unidad de gestión";
    return `Autor: ${author}, ${unidadNegocio}, ${unidadGestion}, ${dateStr}, ${timeStr}`;
  };

  const formatPostMeta = (s) => {
    const date = s.createdAt?.toDate ? s.createdAt.toDate() : new Date();
    const dateStr = date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const timeStr = date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    const author = s.createdByName || "Autor";
    const parts = [author, s.unidadNegocio, s.unidadGestion, `${dateStr} ${timeStr}`].filter(Boolean);
    return parts.join(" - ");
  };

  const formatPostDescription = (s) => s.text || s.title || "";

  const escapeHtml = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const buildLikeTooltipText = (names = []) => {
    const list = Array.isArray(names) ? names.filter(Boolean) : [];
    if (!list.length) return "Sin likes";
    const first = list.slice(0, 10).map(escapeHtml).join(", ");
    const extra = list.length - 10;
    return first + (extra > 0 ? ` +${extra}` : "");
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const clearFloatingLikeTooltips = () => {
    document.querySelectorAll(".dm-like-tooltip.is-floating").forEach((tooltip) => {
      tooltip.classList.remove("is-floating", "is-flipped");
      tooltip.style.removeProperty("--dm-like-top");
      tooltip.style.removeProperty("--dm-like-left");
      tooltip.style.removeProperty("--dm-like-arrow-left");
    });
  };

  const positionLikeTooltip = (likeBtn) => {
    const tooltip = likeBtn?.querySelector(".dm-like-tooltip");
    if (!tooltip) return;
    const rect = likeBtn.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const width = tooltipRect.width || tooltip.offsetWidth || 180;
    const height = tooltipRect.height || tooltip.offsetHeight || 60;
    const gutter = 8;
    const fitsBelow = rect.bottom + gutter + height <= window.innerHeight - gutter;
    const top = fitsBelow ? rect.bottom + gutter : rect.top - height - gutter;
    const left = clamp(rect.left, gutter, window.innerWidth - width - gutter);
    const arrowLeft = clamp(rect.left + rect.width / 2 - left - 5, 10, width - 18);

    tooltip.classList.add("is-floating");
    tooltip.classList.toggle("is-flipped", !fitsBelow);
    tooltip.style.setProperty("--dm-like-top", `${Math.round(top)}px`);
    tooltip.style.setProperty("--dm-like-left", `${Math.round(left)}px`);
    tooltip.style.setProperty("--dm-like-arrow-left", `${Math.round(arrowLeft)}px`);
  };

  let likeTooltipBound = false;
  const closeLikeTooltips = () => {
    document
      .querySelectorAll(".dm-post-like.is-open, .dm-comment-like.is-open")
      .forEach((btn) => btn.classList.remove("is-open"));
    clearFloatingLikeTooltips();
  };
  const bindLikeTooltipDismiss = () => {
    if (likeTooltipBound) return;
    likeTooltipBound = true;
    document.addEventListener("click", (event) => {
      if (
        event.target.closest(
          ".dm-post-like, .dm-comment-like, .dm-post-like-view, .dm-comment-like-view"
        )
      ) {
        return;
      }
      closeLikeTooltips();
    });
    document.addEventListener("scroll", closeLikeTooltips, true);
  };
  const toggleLikeTooltip = (likeBtn) => {
    if (!likeBtn) return;
    bindLikeTooltipDismiss();
    const isOpen = likeBtn.classList.contains("is-open");
    closeLikeTooltips();
    if (!isOpen) {
      likeBtn.classList.add("is-open");
      positionLikeTooltip(likeBtn);
    }
  };

  const markPostImageLoaded = (imgEl, { full } = {}) => {
    if (!imgEl) return;
    const media = imgEl.closest(".dm-post__media");
    media?.classList.remove("is-loading");
    imgEl.classList.add("is-loaded");
    imgEl.style.opacity = "1";
    if (full || !imgEl.dataset.thumb) {
      imgEl.classList.remove("is-blur");
    }
  };

  const markPostImageError = (imgEl) => {
    if (!imgEl) return;
    imgEl.dataset.fullLoaded = "true";
    const postId = imgEl.closest(".dm-post")?.dataset.id || "unknown";
    once(`imgfail:${postId}`, () => {
      logger.warn("[Muro] Imagen no disponible, usando fallback.", { postId });
    });
    imgEl.src = TRANSPARENT_PIXEL;
    imgEl.classList.remove("is-blur");
    imgEl.classList.add("is-loaded");
    imgEl.style.opacity = "0";
    const media = imgEl.closest(".dm-post__media");
    media?.classList.add("is-error");
    markPostImageLoaded(imgEl, { full: true });
  };

  const prefetchFullImage = (src) => {
    if (!src || prefetchedFull.has(src)) return;
    prefetchedFull.add(src);
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  };

  const resolveUrl = (src) => {
    if (!src) return "";
    try {
      return new URL(src, window.location.href).href;
    } catch (e) {
      return src;
    }
  };

  let imageObserver = null;
  const observeLazyImages = (root = document) => {
    if (!root) return;
    if (!imageObserver) {
      imageObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const imgEl = entry.target;
            imageObserver.unobserve(imgEl);
            loadLazyImage(imgEl);
          });
        },
        { root: null, rootMargin: "200px 0px", threshold: 0.05 }
      );
    }
    const imgs = root.querySelectorAll(".dm-post-img");
    imgs.forEach((imgEl) => {
      if (imgEl.dataset.lazyObserved === "true") return;
      imgEl.dataset.lazyObserved = "true";
      imageObserver.observe(imgEl);
    });
  };

  const loadLazyImage = (imgEl) => {
    if (!imgEl || imgEl.dataset.srcLoaded === "true") return;
    const nextSrc = imgEl.dataset.src || imgEl.dataset.thumb || imgEl.dataset.full;
    if (!nextSrc) return;
    imgEl.dataset.srcLoaded = "true";
    imgEl.src = nextSrc;
    const isFull = !imgEl.dataset.full || nextSrc === imgEl.dataset.full;
    const handleLoaded = async () => {
      try {
        if (typeof imgEl.decode === "function") {
          await imgEl.decode();
        }
      } catch (e) {}
      markPostImageLoaded(imgEl, { full: isFull });
      const postEl = imgEl.closest(".dm-post");
      if (postEl && imgEl.naturalHeight > imgEl.naturalWidth) {
        postEl.classList.add("vertical");
      }
      if (!isFull && imgEl.dataset.full && imgEl.dataset.full !== nextSrc) {
        loadFullImage(imgEl);
      }
    };
    if (imgEl.complete && imgEl.naturalWidth > 0) {
      handleLoaded();
      return;
    }
    imgEl.addEventListener("load", handleLoaded, { once: true });
    imgEl.addEventListener("error", () => markPostImageError(imgEl), { once: true });
  };

  const loadFullImage = (imgEl) => {
    if (!imgEl) return;
    const fullSrc = resolveUrl(imgEl.dataset.full || "");
    const currentSrc = resolveUrl(imgEl.currentSrc || imgEl.src || "");
    if (!fullSrc) {
      markPostImageLoaded(imgEl, { full: true });
      return;
    }
    if (imgEl.dataset.fullLoaded === "true") return;
    if (currentSrc === fullSrc && imgEl.complete) {
      imgEl.dataset.fullLoaded = "true";
      markPostImageLoaded(imgEl, { full: true });
      return;
    }
    const preloader = new Image();
    preloader.decoding = "async";
    preloader.src = fullSrc;
    preloader.onload = async () => {
      imgEl.src = fullSrc;
      imgEl.dataset.fullLoaded = "true";
      try {
        if (typeof imgEl.decode === "function") {
          await imgEl.decode();
        }
      } catch (e) {}
      markPostImageLoaded(imgEl, { full: true });
    };
    preloader.onerror = () => {
      imgEl.dataset.fullLoaded = "true";
      markPostImageLoaded(imgEl, { full: true });
    };
  };

  const initPostImage = (imgEl) => {
    if (!imgEl) return;
    observeLazyImages(imgEl.closest(".dm-post") || imgEl);
  };

  const clearCommentsList = (listEl, countEl) => {
    if (!listEl) return;
    listEl.innerHTML = `<div class="dm-comments__empty">Sin comentarios todavía.</div>`;
    if (countEl) countEl.textContent = "0";
  };

  const renderCommentItems = (listEl, countEl, items = [], slideId) => {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!items.length) {
      clearCommentsList(listEl, countEl);
      return;
    }
    if (countEl) countEl.textContent = String(items.length);
    const user = auth?.currentUser;
    items.forEach((c) => {
      const wrap = document.createElement("div");
      wrap.className = "dm-comment";
      wrap.dataset.id = c.id;

      const meta = document.createElement("div");
      meta.className = "dm-comment__meta";
      const authorEl = document.createElement("div");
      authorEl.className = "dm-comment__author";
      authorEl.textContent = c.authorName || "Usuario";
      const avatarEl = document.createElement("div");
      avatarEl.className = "dm-comment__avatar";
      avatarEl.dataset.authorUid = c.authorUid || "";
      avatarEl.dataset.authorName = c.authorName || "Usuario";
      avatarEl.innerHTML = `
        <img class="dm-comment__avatar-img" data-author-avatar src="${TRANSPARENT_PIXEL}" alt="Avatar" hidden />
        <span class="dm-comment__avatar-fallback" data-avatar-fallback="initials"></span>
      `;
      const authorWrap = document.createElement("div");
      authorWrap.className = "dm-comment__author-wrap";
      authorWrap.append(avatarEl, authorEl);
      const dateEl = document.createElement("div");
      dateEl.className = "dm-comment__date";
      const d = c.createdAt?.toDate ? c.createdAt.toDate() : null;
      dateEl.textContent = d
        ? `${d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })} hs`
        : "";

      const actions = document.createElement("div");
      actions.className = "dm-comment__actions";
      const likedByMap = c.likedBy && typeof c.likedBy === "object" ? c.likedBy : {};
      const likeNames = Object.values(likedByMap || {}).filter(Boolean);
      const likesCount = likeNames.length;
      const userLiked = user?.uid && likedByMap[user.uid];
      const likeGroup = document.createElement("div");
      likeGroup.className = "dm-comment-like-group";
      const likeBtn = document.createElement("button");
      likeBtn.type = "button";
      likeBtn.className = "dm-comment-like" + (userLiked ? " is-active" : "");
      likeBtn.dataset.id = c.id;
      const likeIcon = document.createElement("span");
      likeIcon.textContent = "❤️";
      const likeVal = document.createElement("span");
      likeVal.textContent = String(likesCount);
      likeBtn.append(likeIcon, likeVal);
      const tooltip = document.createElement("div");
      tooltip.className = "dm-like-tooltip";
      if (likeNames.length === 0) {
        tooltip.textContent = "Sin likes";
      } else {
        const list = likeNames.slice(0, 10);
        const extra = likeNames.length - list.length;
        tooltip.textContent = list.join(", ") + (extra > 0 ? ` +${extra}` : "");
      }
      likeBtn.appendChild(tooltip);
      likeGroup.appendChild(likeBtn);

      if (likesCount > 0) {
        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.className = "dm-comment-like-view";
        viewBtn.setAttribute("aria-label", "Ver likes");
        viewBtn.setAttribute("title", "Ver likes");
        viewBtn.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
        viewBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleLikeTooltip(likeBtn);
        });
        likeGroup.appendChild(viewBtn);
      }

      actions.appendChild(likeGroup);

      const canDeleteComment = user && (isAdmin || (c.authorUid && user.uid === c.authorUid));
      if (canDeleteComment) {
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "dm-comment-del";
        delBtn.dataset.id = c.id;
        delBtn.setAttribute("aria-label", "Eliminar comentario");
        delBtn.setAttribute("title", "Eliminar");
        const delIcon = document.createElement("span");
        delIcon.className = "dm-comment-del__icon";
        delIcon.setAttribute("aria-hidden", "true");
        delIcon.textContent = "🗑";
        delBtn.appendChild(delIcon);
        actions.appendChild(delBtn);
      }

      meta.append(authorWrap, dateEl);
      const body = document.createElement("div");
      body.className = "dm-comment__text";
      body.textContent = c.text || "";
      wrap.append(meta, body, actions);
      listEl.appendChild(wrap);
    });
    listEl.scrollTop = listEl.scrollHeight;
    hydrateAvatars(listEl);

    // Bind actions
    listEl.querySelectorAll(".dm-comment-like").forEach((btn) => {
      btn.onclick = async () => {
        const user = requireUser();
        if (!user) return;
        const commentId = btn.dataset.id;
        if (!slideId || !commentId) return;
        try {
          await toggleCommentLike(slideId, commentId, user);
        } catch (err) {
          throttle("comments-like", 30000, () => {
            logger.warn("[Comentarios] No se pudo registrar el like.", err);
          });
        }
      };
    });
    listEl.querySelectorAll(".dm-comment-del").forEach((btn) => {
      btn.onclick = async () => {
        const user = requireUser();
        if (!user) return;
        const commentId = btn.dataset.id;
        if (!slideId || !commentId) return;
        try {
          await deleteCommentWithReauth(slideId, commentId, user);
        } catch (err) {
          throttle("comments-delete", 30000, () => {
            logger.warn("[Comentarios] No se pudo borrar el comentario.", err);
          });
        }
      };
    });

    if (window.lucide) window.lucide.createIcons();
  };

  const clearCommentsUI = () => {
    clearCommentsList(commentsList, commentsCount);
  };

  const renderComments = (items = [], slideId) => {
    renderCommentItems(commentsList, commentsCount, items, slideId);
  };

  const subscribeCommentsForSlide = (slideId) => {
    if (unsubscribeComments) {
      unsubscribeComments();
      unsubscribeComments = null;
    }
    clearCommentsUI();
    if (!db || !slideId || !commentsList || appState.permissionDenied) return;
    const q = query(collection(db, POSTS_COLLECTION, slideId, COMMENTS_COLLECTION), orderBy("createdAt", "asc"));
    unsubscribeComments = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderComments(items, slideId);
      },
      (err) => {
        if (isPermissionError(err)) {
          handlePermissionDenied("comments-slide");
          if (commentsList) {
            commentsList.innerHTML =
              '<div class="dm-comments__empty">No tenes permisos para ver comentarios.</div>';
          }
          if (commentsCount) commentsCount.textContent = "—";
          return;
        }
        throttle(`comments-slide-${slideId}`, 60000, () => {
          logger.warn("[Comentarios] Error obteniendo comentarios", err);
        });
        clearCommentsUI();
      }
    );
  };

  const toggleCommentLike = async (slideId, commentId, user) => {
    const commentRef = doc(db, POSTS_COLLECTION, slideId, COMMENTS_COLLECTION, commentId);
    await runTransaction(db, async (trx) => {
      const snap = await trx.get(commentRef);
      if (!snap.exists()) return;
      const data = snap.data() || {};
      const likedBy = data.likedBy && typeof data.likedBy === "object" ? { ...data.likedBy } : {};
      if (likedBy[user.uid]) {
        delete likedBy[user.uid];
      } else {
        likedBy[user.uid] = user.displayName || user.email || "Usuario";
      }
      trx.update(commentRef, { likedBy });
    });
    if (commentsList) hydrateAvatars(commentsList);
  };

  const deleteCommentWithReauth = async (slideId, commentId, user) => {
    const providerIds = (user.providerData || []).map((p) => p.providerId);
    if (!providerIds.includes("password")) {
      Swal?.fire?.("No disponible", "Tu método de ingreso no usa contraseña. Reautenticá desde tu proveedor.", "info");
      return;
    }
    const { value: password } = (await Swal?.fire?.({
      title: "Confirmá tu contraseña",
      input: "password",
      inputPlaceholder: "Contraseña",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar"
    })) || {};
    if (!password) return;
    try {
      const cred = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, cred);
      await deleteDoc(doc(db, POSTS_COLLECTION, slideId, COMMENTS_COLLECTION, commentId));
    } catch (err) {
      throttle("comments-reauth-delete", 60000, () => {
        logger.error("[Comentarios] Error al borrar (reauth)", err);
      });
      Swal?.fire?.("Error", "No se pudo borrar el comentario. Contraseña incorrecta o error de red.", "error");
    }
  };

  const deletePostWithReauth = async (postId, user) => {
    if (!db || !postId || !user) return;
    const post = getSlideById(postId);
    const ownerId = post?.createdByUid || post?.authorUid;
    if (!isAdmin && ownerId && ownerId !== user.uid) {
      Swal?.fire?.("No permitido", "Solo el autor o un administrador puede borrar esta publicación.", "error");
      return;
    }
    const confirm = await Swal.fire({
      title: "Eliminar publicación",
      text: "Esta acción no se puede deshacer. ¿Continuar?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#6b7280"
    });
    if (!confirm.isConfirmed) return;
    const providerIds = (user.providerData || []).map((p) => p.providerId);
    if (!providerIds.includes("password")) {
      Swal?.fire?.("No disponible", "Tu método de ingreso no usa contraseña. Reautenticá desde tu proveedor.", "info");
      return;
    }
    const { value: password } = (await Swal?.fire?.({
      title: "Confirmá tu contraseña",
      input: "password",
      inputPlaceholder: "Contraseña",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar"
    })) || {};
    if (!password) return;
    try {
      const cred = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, cred);
      await deleteDoc(doc(db, POSTS_COLLECTION, postId));
      Swal?.fire?.("Eliminada", "La publicación fue eliminada.", "success");
    } catch (err) {
      throttle("feed-delete", 60000, () => {
        logger.error("[Muro] Error al borrar publicación", err);
      });
      Swal?.fire?.("Error", "No se pudo borrar la publicación. Contraseña incorrecta o error de red.", "error");
    }
  };

  const clearFeedCommentSubscriptions = () => {
    feedCommentSubscriptions.forEach((unsubscribe) => unsubscribe());
    feedCommentSubscriptions.clear();
  };

  const subscribeCommentsForPost = (postId, listEl, countEl, actionCountEl, postEl) => {
    if (!db || !postId || !listEl || appState.permissionDenied) return;
    const q = query(collection(db, POSTS_COLLECTION, postId, COMMENTS_COLLECTION), orderBy("createdAt", "asc"));
    const commentsWrap = postEl?.querySelector(".dm-post-comments");
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!items.length) {
          if (countEl) countEl.textContent = "0";
          if (actionCountEl) actionCountEl.textContent = "0";
          listEl.innerHTML = "";
          if (commentsWrap && !commentsWrap.classList.contains("is-expanded")) {
            commentsWrap.classList.add("is-empty");
          }
          return;
        }
        commentsWrap?.classList.remove("is-empty");
        renderCommentItems(listEl, countEl, items, postId);
        if (actionCountEl) actionCountEl.textContent = String(items.length);
      },
      (err) => {
        if (isPermissionError(err)) {
          handlePermissionDenied("comments-post");
          listEl.innerHTML = '<div class="dm-comments__empty">No tenes permisos para ver comentarios.</div>';
          if (countEl) countEl.textContent = "—";
          if (actionCountEl) actionCountEl.textContent = "—";
          if (commentsWrap && !commentsWrap.classList.contains("is-expanded")) {
            commentsWrap.classList.add("is-empty");
          }
          return;
        }
        throttle(`comments-post-${postId}`, 60000, () => {
          logger.warn("[Comentarios] Error obteniendo comentarios", err);
        });
        listEl.innerHTML = "";
        if (countEl) countEl.textContent = "0";
        if (actionCountEl) actionCountEl.textContent = "0";
        if (commentsWrap && !commentsWrap.classList.contains("is-expanded")) {
          commentsWrap.classList.add("is-empty");
        }
      }
    );
    feedCommentSubscriptions.set(postId, unsubscribe);
  };

  const getSlideById = (slideId) => postsById.get(slideId) || slides.find((s) => s.id === slideId);

  const updateFeedLikeUI = (postEl, slide) => {
    if (!postEl || !slide) return;
    const likeBtn = postEl.querySelector(".dm-post-like");
    const likeCount = postEl.querySelector(".dm-post-like-count");
    const viewBtn = postEl.querySelector(".dm-post-like-view");
    const tooltipEl = likeBtn?.querySelector(".dm-like-tooltip");
    if (likeCount) {
      likeCount.textContent = slide.likesCount ? String(slide.likesCount) : "0";
    }
    if (likeBtn) {
      const user = auth?.currentUser;
      const likedBy = slide.likedBy || [];
      likeBtn.classList.toggle("is-active", !!user && likedBy.includes(user.uid));
    }
    if (tooltipEl) {
      const names =
        Array.isArray(slide.likedNames) && slide.likedNames.length
          ? slide.likedNames
          : Array.isArray(slide.likedBy)
          ? slide.likedBy
          : [];
      tooltipEl.textContent = buildLikeTooltipText(names);
    }
    if (viewBtn) {
      const hasLikes = (slide.likesCount || 0) > 0;
      viewBtn.hidden = !hasLikes;
    }
  };

  const togglePostLike = async (postId, postEl) => {
    const { auth: currentAuth, db: currentDb } = ensureFirebase();
    if (!currentAuth || !currentDb || !postId) return;
    const user = currentAuth.currentUser;
    if (!user) {
      Swal.fire("Sesión requerida", "Iniciá sesión para dar me gusta.", "warning");
      return;
    }
    const slide = getSlideById(postId);
    if (!slide) return;
    const likedBy = slide.likedBy || [];
    const alreadyLiked = likedBy.includes(user.uid);
    const name = user.displayName || user.email || "Usuario";
    try {
      if (alreadyLiked) {
        await updateDoc(doc(currentDb, POSTS_COLLECTION, postId), {
          likedBy: arrayRemove(user.uid),
          likedNames: arrayRemove(name),
          likesCount: increment(-1)
        });
        slide.likedBy = likedBy.filter((id) => id !== user.uid);
        slide.likedNames = (slide.likedNames || []).filter((n) => n !== name);
        slide.likesCount = Math.max(0, (slide.likesCount || 0) - 1);
      } else {
        await updateDoc(doc(currentDb, POSTS_COLLECTION, postId), {
          likedBy: arrayUnion(user.uid),
          likedNames: arrayUnion(name),
          likesCount: increment(1)
        });
        slide.likedBy = [...likedBy, user.uid];
        slide.likedNames = [...(slide.likedNames || []), name];
        slide.likesCount = (slide.likesCount || 0) + 1;
      }
      updateFeedLikeUI(postEl, slide);
    } catch (e) {
      throttle("post-like", 30000, () => {
        logger.warn("Error registrando like", e);
      });
      Swal.fire("Error", "No se pudo registrar el like.", "error");
    }
  };

  const sendFeedComment = async (postId, inputEl) => {
    const user = requireUser();
    if (!user || !db || !postId || !inputEl) return;
    const text = inputEl.value.trim();
    if (!text) return;
    try {
      await addDoc(collection(db, POSTS_COLLECTION, postId, COMMENTS_COLLECTION), {
        text,
        createdAt: serverTimestamp(),
        authorName: user.displayName || user.email || "Usuario",
        authorUid: user.uid || ""
      });
      inputEl.value = "";
    } catch (err) {
      if (isPermissionError(err)) {
        once("perm:comment-write", () => {
          logger.warn("[Comentarios] Sin permisos para comentar.", err);
        });
        Swal?.fire?.("Permisos", "No tenes permisos para comentar.", "warning");
        return;
      }
      throttle("comment-send", 30000, () => {
        logger.error("[Comentarios] Error publicando comentario", err);
      });
      Swal?.fire?.("Error", "No se pudo publicar el comentario", "error") || alert("No se pudo publicar el comentario");
    }
  };

  const teardownFeedObserver = () => {
    if (feedObserver) {
      feedObserver.disconnect();
      feedObserver = null;
    }
    feedVisibleRatios.clear();
  };

  const setupFeedObserver = () => {
    if (!viewport) return;
    teardownFeedObserver();
    const slideEls = track.querySelectorAll(".dm-carousel-slide");
    if (!slideEls.length) return;
    feedObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const idx = Number(entry.target.dataset.idx);
          if (Number.isNaN(idx)) return;
          if (entry.isIntersecting) {
            feedVisibleRatios.set(idx, entry.intersectionRatio);
            const imgEl = entry.target.querySelector(".dm-post-img");
            if (imgEl) {
              loadLazyImage(imgEl);
              const next = feedPosts[idx + 1];
              if (next?.imageUrl) prefetchFullImage(next.imageUrl);
            }
          } else {
            feedVisibleRatios.delete(idx);
          }
        });
        if (!feedVisibleRatios.size) return;
        let nextIndex = activeIndex;
        let maxRatio = -1;
        feedVisibleRatios.forEach((ratio, idx) => {
          if (ratio > maxRatio) {
            maxRatio = ratio;
            nextIndex = idx;
          }
        });
        if (nextIndex !== activeIndex) {
          activeIndex = nextIndex;
          refreshLikeUI();
          updateInfoPanel();
        }
      },
      { root: feedMode ? null : viewport, rootMargin: "200px 0px", threshold: [0.25, 0.5, 0.75, 1] }
    );
    slideEls.forEach((slideEl) => feedObserver.observe(slideEl));
    activeIndex = Math.min(activeIndex, slideEls.length - 1);
    refreshLikeUI();
    updateInfoPanel();
  };

  const renderDots = (visibleSlides) => {
    dots.innerHTML = "";
    if (feedMode || visibleSlides.length === 0) return;
    visibleSlides.forEach((_, idx) => {
      const dot = document.createElement("div");
      dot.className = "dm-carousel-dot" + (idx === getVisualIndex() ? " is-active" : "");
      dots.appendChild(dot);
    });
  };

  const getVisualIndex = () => {
    if (slides.length === 0) return 0;
    if (feedMode) return Math.min(activeIndex, slides.length - 1);
    if (currentIndex === 0) return slides.length - 1;
    if (currentIndex === slides.length + 1) return 0;
    return currentIndex - 1;
  };

  const renderSlides = () => {
    if (feedMode) {
      renderFeedList({ reset: true });
      return;
    }
    teardownFeedObserver();
    clearFeedCommentSubscriptions();
    if (!slides.length) {
      track.innerHTML = `<div class="dm-carousel-empty">Aún no hay imágenes cargadas.</div>`;
      dots.innerHTML = "";
      if (autoTimer) clearInterval(autoTimer);
      updateInfoPanel();
      return;
    }

    teardownFeedPagerObserver();
    if (feedSentinel?.parentElement) feedSentinel.parentElement.removeChild(feedSentinel);
    const extended = [slides[slides.length - 1], ...slides, slides[0]];
    track.innerHTML = extended
      .map(
        (s, idx) => `
        <div class="dm-carousel-slide" data-idx="${idx}">
          <div class="dm-carousel-media">
            <img class="dm-carousel-img" src="${s.imageUrl}" alt="${s.title || "Imagen de la galería"}" loading="lazy" decoding="async" width="1200" height="900" />
            <button class="dm-slide-nav dm-slide-nav--left" type="button" data-slide-nav="prev" aria-label="Anterior">◀</button>
            <button class="dm-slide-nav dm-slide-nav--right" type="button" data-slide-nav="next" aria-label="Siguiente">▶</button>
          </div>
        </div>
      `
      )
      .join("");
    const slideEls = track.querySelectorAll(".dm-carousel-slide");
    slideEls.forEach((slideEl) => {
      const img = slideEl.querySelector("img");
      if (!img) return;
      img.onload = () => {
        if (img.naturalHeight > img.naturalWidth) {
          slideEl.classList.add("vertical");
        }
      };
      if (img.complete) img.onload?.();
    });
    currentIndex = 1;
    track.style.transition = "none";
    applyTransform();
    requestAnimationFrame(() => {
      track.style.transition = "transform 0.6s ease";
    });
    renderDots(slides);
    resetAuto();
    refreshLikeUI();
    updateInfoPanel();
  };

  const updateFeedMode = () => {
    const next = feedQuery.matches || displayModeQuery.matches;
    if (next === feedMode) return;
    feedMode = next;
    updateFeedModeClass();
    if (feedMode && autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
    renderSlides();
  };

  if (feedQuery.addEventListener) {
    feedQuery.addEventListener("change", updateFeedMode);
  } else {
    feedQuery.addListener(updateFeedMode);
  }
  if (displayModeQuery.addEventListener) {
    displayModeQuery.addEventListener("change", updateFeedMode);
  } else {
    displayModeQuery.addListener(updateFeedMode);
  }

  const moveTo = (targetIndex) => {
    if (feedMode || isTransitioning || slides.length === 0) return;
    isTransitioning = true;
    currentIndex = targetIndex;
    applyTransform();
  };

  track.addEventListener("transitionend", () => {
    if (feedMode) return;
    if (slides.length === 0) {
      isTransitioning = false;
      return;
    }
    if (currentIndex === slides.length + 1) {
      track.style.transition = "none";
      currentIndex = 1;
      applyTransform();
      void track.offsetHeight;
      requestAnimationFrame(() => {
        track.style.transition = "transform 0.6s ease";
      });
    }
    if (currentIndex === 0) {
      track.style.transition = "none";
      currentIndex = slides.length;
      applyTransform();
      void track.offsetHeight;
      requestAnimationFrame(() => {
        track.style.transition = "transform 0.6s ease";
      });
    }
    renderDots(slides);
    isTransitioning = false;
    refreshLikeUI();
    updateInfoPanel();
  });

  btnPrev?.addEventListener("click", () => {
    moveTo(currentIndex - 1);
    resetAuto();
  });

  btnNext?.addEventListener("click", () => {
    moveTo(currentIndex + 1);
    resetAuto();
  });
  overlayPrev?.addEventListener("click", () => {
    moveTo(currentIndex - 1);
    resetAuto();
  });
  overlayNext?.addEventListener("click", () => {
    moveTo(currentIndex + 1);
    resetAuto();
  });
  track?.addEventListener("click", (event) => {
    const navBtn = event.target.closest(".dm-slide-nav");
    if (!navBtn || feedMode) return;
    event.preventDefault();
    const dir = navBtn.getAttribute("data-slide-nav");
    moveTo(dir === "prev" ? currentIndex - 1 : currentIndex + 1);
    resetAuto();
  });

  let wheelLock = false;
  let touchStartY = 0;
  let touchStartX = 0;
  let touchDeltaY = 0;
  let touchDeltaX = 0;
  const WHEEL_THRESHOLD = 12;
  const WHEEL_COOLDOWN = 650;
  const SWIPE_THRESHOLD = 40;

  // Si el viewport tiene overflow vertical, priorizamos el scroll nativo
  // (móvil/feed) y evitamos capturar wheel/touch para navegación horizontal.
  const viewportHasVerticalScroll = () => {
    if (!viewport) return false;
    return viewport.scrollHeight > viewport.clientHeight + 2;
  };

  const handleWheel = (event) => {
    if (feedMode || viewportHasVerticalScroll() || !slides.length || isTransitioning) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(delta) < WHEEL_THRESHOLD) return;
    event.preventDefault();
    if (wheelLock) return;
    wheelLock = true;
    moveTo(delta > 0 ? currentIndex + 1 : currentIndex - 1);
    resetAuto();
    setTimeout(() => {
      wheelLock = false;
    }, WHEEL_COOLDOWN);
  };

  const handleTouchStart = (event) => {
    if (feedMode || viewportHasVerticalScroll()) return;
    if (!event.touches?.length) return;
    const touch = event.touches[0];
    touchStartY = touch.clientY;
    touchStartX = touch.clientX;
    touchDeltaY = 0;
    touchDeltaX = 0;
  };

  const handleTouchMove = (event) => {
    if (feedMode || viewportHasVerticalScroll()) return;
    if (!event.touches?.length || !slides.length) return;
    const touch = event.touches[0];
    touchDeltaY = touch.clientY - touchStartY;
    touchDeltaX = touch.clientX - touchStartX;
    // Evitar bloquear scroll vertical por pequeños desvíos horizontales.
    const isHorizontalSwipe = Math.abs(touchDeltaX) > Math.abs(touchDeltaY) * 1.3 && Math.abs(touchDeltaX) > 12;
    if (isHorizontalSwipe && event.cancelable) {
      event.preventDefault();
    }
  };

  const handleTouchEnd = () => {
    if (feedMode || viewportHasVerticalScroll()) return;
    if (!slides.length || isTransitioning) return;
    if (Math.abs(touchDeltaX) < SWIPE_THRESHOLD) return;
    moveTo(touchDeltaX > 0 ? currentIndex - 1 : currentIndex + 1);
    resetAuto();
    touchDeltaY = 0;
    touchDeltaX = 0;
  };

  if (viewport) {
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    viewport.addEventListener("touchstart", handleTouchStart, { passive: true });
    viewport.addEventListener("touchmove", handleTouchMove, { passive: false });
    viewport.addEventListener("touchend", handleTouchEnd);
  }

  const requireUser = () => {
    const user = auth?.currentUser;
    if (!user) {
      Swal?.fire?.("Iniciá sesión", "Necesitás iniciar sesión para comentar.", "info") || alert("Iniciá sesión para comentar.");
      return null;
    }
    return user;
  };

  const sendComment = async () => {
    const user = requireUser();
    if (!user) return;
    const current = slides[getVisualIndex()];
    if (!current?.id || !commentInlineInput) return;
    const text = commentInlineInput.value.trim();
    if (!text) return;
    try {
      await addDoc(collection(db, POSTS_COLLECTION, current.id, COMMENTS_COLLECTION), {
        text,
        createdAt: serverTimestamp(),
        authorName: user.displayName || user.email || "Usuario",
        authorUid: user.uid || ""
      });
      commentInlineInput.value = "";
      syncCommentSendState();
      isComposingComment = false;
      resetAuto();
    } catch (err) {
      if (isPermissionError(err)) {
        once("perm:comment-inline", () => {
          logger.warn("[Comentarios] Sin permisos para comentar.", err);
        });
        Swal?.fire?.("Permisos", "No tenes permisos para comentar.", "warning");
        return;
      }
      throttle("comment-inline", 30000, () => {
        logger.error("[Comentarios] Error publicando comentario", err);
      });
      Swal?.fire?.("Error", "No se pudo publicar el comentario", "error") || alert("No se pudo publicar el comentario");
    }
  };

  const pauseForCompose = () => {
    isComposingComment = true;
    if (autoTimer) clearInterval(autoTimer);
  };

  commentInlineInput?.addEventListener("focus", pauseForCompose);
  commentInlineInput?.addEventListener("input", () => {
    if (commentInlineInput.value.length >= 0) pauseForCompose();
    syncCommentSendState();
  });
  commentInlineInput?.addEventListener("keydown", (e) => {
    isComposingComment = true;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendComment();
    }
  });
  commentInlineInput?.addEventListener("blur", () => {
    isComposingComment = false;
    resetAuto();
  });
  commentSendBtn?.addEventListener("click", () => {
    sendComment();
  });
  commentEmojiBtn?.addEventListener("click", pauseForCompose);
  btnPause?.addEventListener("click", () => {
    autoplayRunning = !autoplayRunning;
    btnPause.textContent = autoplayRunning ? "⏯" : "▶";
    if (autoplayRunning) resetAuto();
    else if (autoTimer) clearInterval(autoTimer);
  });
  btnFullscreen?.addEventListener("click", () => {
    const vp = document.querySelector(".dm-carousel-viewport");
    if (!vp) return;
    if (!document.fullscreenElement) {
      vp.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });
  btnLike?.addEventListener("click", async () => {
    const { auth, db } = ensureFirebase();
    const current = slides[getVisualIndex()];
    if (!auth || !db || !current?.id) return;
    const user = auth.currentUser;
    if (!user) {
      Swal.fire("Sesión requerida", "Iniciá sesión para dar me gusta.", "warning");
      return;
    }
    const likedBy = current.likedBy || [];
    const alreadyLiked = likedBy.includes(user.uid);
    const name = user.displayName || user.email || "Usuario";
    try {
      if (alreadyLiked) {
        await updateDoc(doc(db, POSTS_COLLECTION, current.id), {
          likedBy: arrayRemove(user.uid),
          likedNames: arrayRemove(name),
          likesCount: increment(-1)
        });
        current.likedBy = likedBy.filter((id) => id !== user.uid);
        current.likedNames = (current.likedNames || []).filter((n) => n !== name);
        current.likesCount = Math.max(0, (current.likesCount || 0) - 1);
      } else {
        await updateDoc(doc(db, POSTS_COLLECTION, current.id), {
          likedBy: arrayUnion(user.uid),
          likedNames: arrayUnion(name),
          likesCount: increment(1)
        });
        current.likedBy = [...likedBy, user.uid];
        current.likedNames = [...(current.likedNames || []), name];
        current.likesCount = (current.likesCount || 0) + 1;
      }
      refreshLikeUI();
    } catch (e) {
      throttle("carousel-like", 30000, () => {
        logger.warn("Error registrando like", e);
      });
      Swal.fire("Error", "No se pudo registrar el like.", "error");
    }
  });
  likeCountEl?.addEventListener("mouseenter", (e) => {
    const current = slides[getVisualIndex()];
    const names = current?.likedNames || [];
    likeTooltip.textContent = "";
    if (names.length > 0) {
      names.forEach((n) => {
        const row = document.createElement("div");
        row.textContent = n;
        likeTooltip.appendChild(row);
      });
    } else {
      const empty = document.createElement("div");
      empty.textContent = "Sin likes aún";
      likeTooltip.appendChild(empty);
    }
    likeTooltip.classList.remove("dm-like-tooltip-hidden");
    likeTooltip.style.top = `${e.pageY + 12}px`;
    likeTooltip.style.left = `${e.pageX + 12}px`;
  });
  likeCountEl?.addEventListener("mousemove", (e) => {
    likeTooltip.style.top = `${e.pageY + 12}px`;
    likeTooltip.style.left = `${e.pageX + 12}px`;
  });
  likeCountEl?.addEventListener("mouseleave", () => {
    likeTooltip.classList.add("dm-like-tooltip-hidden");
  });
  btnDelete?.addEventListener("click", async () => {
    const current = slides[getVisualIndex()];
    if (!current?.id) return;
    const { db } = ensureFirebase();
    if (!db) {
      Swal.fire("Error", "No se pudo eliminar la imagen.", "error");
      return;
    }
    const user = auth?.currentUser;
    if (!user) {
      Swal.fire("Acceso restringido", "Iniciá sesión para continuar.", "warning");
      return;
    }
    const allowed = adminChecked ? isAdmin : await refreshAdminState(user);
    if (!allowed) {
      Swal.fire("Acceso restringido", "Solo administradores pueden eliminar imágenes.", "error");
      return;
    }
    const confirm = await Swal.fire({
      title: "Eliminar imagen",
      text: "Esta acción no se puede deshacer. ¿Continuar?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#dc2626"
    });
    if (!confirm.isConfirmed) return;
    try {
      await deleteDoc(doc(db, POSTS_COLLECTION, current.id));
      Swal.fire("Eliminada", "La imagen fue eliminada.", "success");
    } catch (e) {
      throttle("carousel-delete", 60000, () => {
        logger.error("Error eliminando imagen", e);
      });
      Swal.fire("Error", "No se pudo eliminar la imagen.", "error");
    }
  });

  const openModal = () => {
    modal?.classList.add("is-open");
    modal?.setAttribute("aria-hidden", "false");
    if (errorBox) {
      errorBox.style.display = "none";
    }
    populateUnidadGestionSelect();
  };
  const closeModal = () => {
    modal?.classList.remove("is-open");
    modal?.setAttribute("aria-hidden", "true");
    form?.reset();
    if (errorBox) {
      errorBox.style.display = "none";
    }
  };

  addBtn?.addEventListener("click", openModal);
  modalClose?.addEventListener("click", closeModal);
  modalCancel?.addEventListener("click", closeModal);
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  const THUMB_WIDTH = 480;
  const THUMB_QUALITY = 0.6;
  const supportsWebp = (() => {
    try {
      const canvas = document.createElement("canvas");
      return canvas.toDataURL("image/webp").startsWith("data:image/webp");
    } catch (e) {
      return false;
    }
  })();

  const loadImageFromFile = (file) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(img.src);
        reject(err);
      };
      img.src = URL.createObjectURL(file);
    });

  const createThumbnail = async (file) => {
    try {
      const img = await loadImageFromFile(file);
      const scale = THUMB_WIDTH / img.width;
      const targetWidth = THUMB_WIDTH;
      const targetHeight = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      const type = supportsWebp ? "image/webp" : "image/jpeg";
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, THUMB_QUALITY));
      if (!blob) return null;
      return { blob, type, width: targetWidth, height: targetHeight };
    } catch (err) {
      throttle("thumb-generate", 60000, () => {
        logger.warn("[Muro] Thumbnail fallo, continuo sin thumb.", err);
      });
      return null;
    }
  };

  const handleUpload = async (user) => {
    if (!form || !fileInput || !titleInput || !buSelect || !muSelect) return;
    if (errorBox) {
      errorBox.style.display = "none";
    }
    const title = titleInput.value.trim();
    const file = fileInput.files?.[0];
    const unidadNegocio = buSelect.value;
    const unidadGestion = muSelect.value;
    if (!title || !file || !unidadNegocio || !unidadGestion) {
      if (errorBox) {
        errorBox.textContent = "Completá todos los campos e incluí una imagen.";
        errorBox.style.display = "block";
      }
      return;
    }
    if (loader) loader.classList.remove("dm-loading-hidden");
    try {
      const { db, storage } = ensureFirebase();
      if (!db || !storage) {
        throw new Error("Sin conexión a Firebase.");
      }
      const stamp = Date.now();
      const safeName = String(file.name || "imagen").replace(/\s+/g, "-");
      const filename = `${stamp}-${safeName}`;
      const userId = user.uid;
      const path = `${POSTS_COLLECTION}/${userId}/${filename}`;
      const ref = storageRef(storage, path);
      const thumbData = await createThumbnail(file);
      await uploadBytes(ref, file);
      const downloadURL = await getDownloadURL(ref);
      let thumbUrl = "";
      if (thumbData?.blob) {
        try {
          const baseName = safeName.replace(/\.[^.]+$/, "");
          const ext = thumbData.type === "image/webp" ? "webp" : "jpg";
          const thumbFilename = `${stamp}-${baseName}_thumb.${ext}`;
          const thumbPath = `${POSTS_COLLECTION}/${userId}/${thumbFilename}`;
          const thumbRef = storageRef(storage, thumbPath);
          await uploadBytes(thumbRef, thumbData.blob, { contentType: thumbData.type });
          thumbUrl = await getDownloadURL(thumbRef);
        } catch (err) {
          throttle("thumb-upload", 60000, () => {
            logger.warn("[Muro] No se pudo subir el thumb.", err);
          });
        }
      }
      await addDoc(collection(db, POSTS_COLLECTION), {
        title,
        imageUrl: downloadURL,
        thumbUrl,
        unidadNegocio,
        unidadGestion,
        createdByUid: user.uid,
        createdByName: user.displayName || user.email || "Usuario",
        createdAt: serverTimestamp(),
        likesCount: 0,
        likedBy: [],
        likedNames: []
      });
      loadPostsPage({ reset: true });
      titleInput.value = "";
      fileInput.value = "";
      buSelect.value = "";
      muSelect.innerHTML = '<option value="">Seleccionar</option>';
      if (errorBox) {
        errorBox.style.display = "none";
      }
      closeModal();
    } catch (e) {
      if (isPermissionError(e)) {
        once("perm:upload-image", () => {
          logger.warn("[Muro] Sin permisos para subir imagen.", e);
        });
        if (errorBox) {
          errorBox.textContent = "No tenes permisos para subir imagenes.";
          errorBox.style.display = "block";
        }
        return;
      }
      throttle("upload-image", 30000, () => {
        logger.error("Error subiendo imagen del carrusel:", e);
      });
      if (errorBox) {
        errorBox.textContent = "Error subiendo imagen. Intentá nuevamente.";
        errorBox.style.display = "block";
      }
    } finally {
      if (loader) loader.classList.add("dm-loading-hidden");
    }
  };

  const submitTextPost = async () => {
    if (!muroInput) return;
    const text = muroInput.value.trim();
    if (!text) return;
    const { auth: currentAuth, db: currentDb } = ensureFirebase();
    const user = currentAuth?.currentUser;
    if (!currentDb || !user) {
      Swal?.fire?.("Iniciá sesión", "Necesitás iniciar sesión para publicar.", "info") ||
        alert("Necesitás iniciar sesión para publicar.");
      return;
    }
    muroSendBtn?.setAttribute("disabled", "true");
    try {
      const meta = await getUserProfileMeta(user);
      await addDoc(collection(currentDb, POSTS_COLLECTION), {
        type: "text",
        text,
        authorName: meta.displayName,
        authorUid: user.uid || "",
        businessUnit: meta.businessUnit || "",
        managementUnit: meta.managementUnit || "",
        unidadNegocio: meta.businessUnit || "",
        unidadGestion: meta.managementUnit || "",
        createdByName: meta.displayName,
        createdByUid: user.uid || "",
        createdAt: serverTimestamp(),
        likesCount: 0,
        likedBy: [],
        likedNames: []
      });
      loadPostsPage({ reset: true });
      muroInput.value = "";
    } catch (err) {
      if (isPermissionError(err)) {
        once("perm:text-post", () => {
          logger.warn("[Muro] Sin permisos para publicar texto.", err);
        });
        Swal?.fire?.("Permisos", "No tenes permisos para publicar.", "warning");
        return;
      }
      throttle("text-post", 30000, () => {
        logger.error("[Muro] Error creando publicación de texto", err);
      });
      Swal?.fire?.("Error", "No se pudo publicar el texto.", "error") || alert("No se pudo publicar el texto.");
    } finally {
      muroSendBtn?.removeAttribute("disabled");
    }
  };

  buSelect?.addEventListener("change", populateUnidadGestionSelect);
  const syncSpeedInput = () => {
    if (speedInput) speedInput.value = String(Math.round(autoplaySpeed / 1000));
  };
  syncSpeedInput();
  const resetAutoplaySpeed = () => {
    localStorage.setItem("dm-speed", autoplaySpeed);
    syncSpeedInput();
    resetAuto();
  };
  speedDownBtn?.addEventListener("click", () => {
    const secs = Math.min(30, Math.max(1, Math.round(autoplaySpeed / 1000) + 1));
    autoplaySpeed = secs * 1000;
    resetAutoplaySpeed();
  });
  speedUpBtn?.addEventListener("click", () => {
    const secs = Math.min(30, Math.max(1, Math.round(autoplaySpeed / 1000) - 1));
    autoplaySpeed = secs * 1000;
    resetAutoplaySpeed();
  });
  speedInput?.addEventListener("change", () => {
    const secs = Number(speedInput.value);
    if (Number.isNaN(secs)) {
      syncSpeedInput();
      return;
    }
    const clamped = Math.min(30, Math.max(1, secs));
    autoplaySpeed = clamped * 1000;
    resetAutoplaySpeed();
  });

  const handleSubmit = async (e) => {
    e?.preventDefault();
    const { auth: currentAuth } = ensureFirebase();
    if (!currentAuth) {
      if (errorBox) {
        errorBox.textContent = "No hay conexión con el servidor.";
        errorBox.style.display = "block";
      }
      return;
    }
    const user = currentAuth.currentUser;
    if (!user) {
      if (errorBox) {
        errorBox.textContent = "Debés iniciar sesión para subir imágenes.";
        errorBox.style.display = "block";
      }
      return;
    }
    await handleUpload(user);
  };

  form?.addEventListener("submit", handleSubmit);
  saveBtn?.addEventListener("click", handleSubmit);
  btnAddImage?.addEventListener("click", openModal);
  muroInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitTextPost();
    }
  });
  muroSendBtn?.addEventListener("click", submitTextPost);
  muroPhotoBtn?.addEventListener("click", () => {
    openModal();
  });
  refreshLikeUI();

  if (auth) {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.replace(buildLoginRedirectUrl("#carrete"));
        return;
      }
      if (addBtn) addBtn.style.display = user ? "inline-flex" : "none";
      await refreshAdminState(user);

      // Suscripciones dependientes de auth (lecturas protegidas)
      loadInitialPosts();
      subscribeVisits();
    });
  } else {
    // Sin auth no hay data; mostrar mensaje base
    track.innerHTML = `<div class="dm-carousel-empty">No hay conexión a la galería.</div>`;
  }
}

const boot = () => {
  const { auth } = ensureFirebase();
  initSessionGuard(auth);
  initUserMenu({ variant: "mobile" });
  const assistantShell = initAssistantShell({ variant: "mobile" });
  const aiFab = document.getElementById("aiFab");
  if (aiFab && assistantShell) {
    aiFab.addEventListener("click", () => assistantShell.togglePicker());
  }
  initCarouselModule().catch((err) => {
    throttle("muro-init", 60000, () => {
      logger.error("[Muro] Error inicializando", err);
    });
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
