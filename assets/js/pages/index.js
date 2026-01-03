import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
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
import { handleFirebaseError, debugLog } from "../shared/errors.js";
import { initAssistantShell } from "../shared/assistant-shell.js";
import { initUserMenu } from "../common/user-menu.js";
import { hydrateAvatars } from "../common/user-profiles.js";

function ensureFirebase() {
  return getFirebase();
}

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
  const authedUser = await requireAuth(auth, { fallbackHash: "#estructura" });
  if (!authedUser) return;
  const resolveUserValue = (obj, keys, fallback = "") => {
    for (const k of keys) {
      if (obj && obj[k]) return obj[k];
    }
    return fallback;
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
      console.warn("[Muro] No se pudo leer perfil del usuario.", e);
      return { displayName: fallbackName, businessUnit: "", managementUnit: "" };
    }
  };
  const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
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
      console.warn("[Admin] No se pudo leer custom claims.", e);
    }
    if (!db) return false;
    try {
      const snap = await getDoc(doc(db, "admin_whitelist", user.uid));
      return snap.exists();
    } catch (e) {
      console.warn("[Admin] No se pudo leer whitelist.", e);
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
        console.warn("No se pudo actualizar el calendario:", e);
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
        console.error(`Error fetching stats for ${committeeId}:`, err);
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
      console.error("Error cargando metadata de comités:", e);
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
          console.error("Error al unir al comité:", err);
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
    console.error("[Galeria] No se pudo inicializar Firebase para el carrusel", { app, auth, db, storage });
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
  let slideWidth = 0;
  let resizeObserver = null;
  let transitionTimer = null;
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
  const FEED_SKELETON_COUNT = 6;
  const CAROUSEL_SKELETON_COUNT = 3;
  let lastPostDoc = null;
  let hasMorePosts = true;
  let isLoadingPosts = false;
  let isInitialLoading = true;
  let feedPagerObserver = null;
  let feedSentinel = null;
  let feedLoader = null;
  let feedEnd = null;
  let feedError = null;
  const updateFeedModeClass = () => {
    if (!carouselSection) return;
    carouselSection.classList.toggle("is-feed-mode", feedMode);
  };
  updateFeedModeClass();

  const buildFeedSkeleton = () =>
    Array.from({ length: FEED_SKELETON_COUNT })
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

  const buildCarouselSkeleton = () =>
    Array.from({ length: CAROUSEL_SKELETON_COUNT })
      .map(
        () => `
      <div class="dm-carousel-slide dm-carousel-slide--skeleton" aria-hidden="true">
        <div class="dm-carousel-media is-loading">
          <img class="dm-carousel-img" src="${TRANSPARENT_PIXEL}" alt="" aria-hidden="true" width="1200" height="900" />
          <span class="dm-img-skeleton" aria-hidden="true"></span>
        </div>
      </div>
    `
      )
      .join("");

  const ensureFeedSentinel = () => {
    if (feedSentinel) return feedSentinel;
    feedSentinel = document.createElement("div");
    feedSentinel.className = "dm-feed-sentinel";
    feedSentinel.innerHTML = `
      <div class="dm-feed-loader" data-role="feed-loader" hidden>
        <span class="dm-feed-spinner" aria-hidden="true"></span>
        <span class="dm-feed-loader__text">Cargando más...</span>
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
    track.classList.remove("is-loading");
    if (!feedMode) {
      track.classList.add("is-loading");
      track.innerHTML = buildCarouselSkeleton();
      dots.innerHTML = "";
      track.style.transition = "none";
      track.style.transform = "none";
      updateSlideWidth();
      setupResizeObserver();
      return;
    }
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
    if (!feedMode || !feedSentinel || !hasMorePosts) return;
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

  const loadPostsPage = async ({ reset = false } = {}) => {
    if (!db || isLoadingPosts) return;
    if (!hasMorePosts && !reset) return;
    isLoadingPosts = true;
    const preserveScroll = !reset;
    const prevScrollTop = window.scrollY;
    const prevHeight = document.documentElement.scrollHeight;

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
      renderSlides();
      if (preserveScroll) {
        requestAnimationFrame(() => {
          const nextHeight = document.documentElement.scrollHeight;
          const delta = nextHeight - prevHeight;
          if (delta > 0) window.scrollTo(0, prevScrollTop + delta);
        });
      }
    } catch (err) {
      let fallbackMessage = "No pudimos cargar el muro.";
      handleFirebaseError(err, {
        scope: "muro-pagination",
        onPermissionDenied: () => {
          hasMorePosts = false;
          fallbackMessage = "No tenés permisos para ver el muro.";
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
      if (reset && track && feedPosts.length === 0) {
        track.innerHTML = `<div class="dm-carousel-empty">${fallbackMessage}</div>`;
      }
    } finally {
      isLoadingPosts = false;
      isInitialLoading = false;
      updateFeedSentinel({ loading: false, hasMore: hasMorePosts, errorMessage: feedError?.textContent || "" });
      setupFeedPagerObserver();
      debugLog("[Muro] Página cargada", { hasMorePosts, lastPostDoc: Boolean(lastPostDoc) });
    }
  };

  const subscribeVisits = () => {
    if (!db || !visitsBadge || visitsSubscribed) return;
    const visitsRef = doc(db, "dm_meta", "home_visits");
    onSnapshot(
      visitsRef,
      (snap) => {
        const data = snap.data();
        const safeCount = Number.isFinite(data?.count) ? data.count : 0;
        updateVisitsUI(safeCount);
      },
      (err) => {
        console.error("[Visitas] Error leyendo contador", err);
      }
    );
    setDoc(visitsRef, { count: increment(1), updatedAt: serverTimestamp() }, { merge: true }).catch((err) =>
      console.error("[Visitas] Error sumando visita", err)
    );
    visitsSubscribed = true;
  };

  const loadInitialPosts = () => {
    loadPostsPage({ reset: true });
  };
  const updateSlideWidth = () => {
    if (!viewport) return;
    slideWidth = viewport.getBoundingClientRect().width || 0;
  };

  const setupResizeObserver = () => {
    if (!viewport || resizeObserver || typeof ResizeObserver === "undefined") return;
    resizeObserver = new ResizeObserver(() => {
      updateSlideWidth();
      if (!feedMode && slides.length) {
        viewport.scrollTo({ left: slideWidth * currentIndex, behavior: "auto" });
      }
    });
    resizeObserver.observe(viewport);
  };

  const loadCarouselImageAtIndex = (index) => {
    if (feedMode || !track || !slides.length) return;
    const slideEl = track.querySelector(`.dm-carousel-slide[data-idx="${index}"]`);
    const imgEl = slideEl?.querySelector(".dm-carousel-img");
    if (!imgEl) return;
    loadFullImage(imgEl);
    const nextIndex = (index + 1) % slides.length;
    const next = slides[nextIndex];
    if (next?.imageUrl) prefetchFullImage(next.imageUrl);
  };

  const scrollToIndex = (index, { immediate = false } = {}) => {
    if (!viewport || !slides.length) return;
    if (!slideWidth) updateSlideWidth();
    const safeIndex = ((index % slides.length) + slides.length) % slides.length;
    currentIndex = safeIndex;
    const left = slideWidth * safeIndex;
    viewport.scrollTo({ left, behavior: immediate ? "auto" : "smooth" });
    if (!feedMode) {
      renderDots(slides);
      refreshLikeUI();
      updateInfoPanel();
      loadCarouselImageAtIndex(currentIndex);
    }
    if (transitionTimer) clearTimeout(transitionTimer);
    if (immediate) {
      isTransitioning = false;
      return;
    }
    isTransitioning = true;
    transitionTimer = window.setTimeout(() => {
      isTransitioning = false;
    }, 550);
  };

  const resetAuto = () => {
    if (autoTimer) clearInterval(autoTimer);
    if (feedMode || !autoplayRunning || isComposingComment || slides.length <= 1) return;
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
    const media = imgEl.closest(".dm-post__media") || imgEl.closest(".dm-carousel-media");
    media?.classList.remove("is-loading");
    if (full || !imgEl.dataset.thumb) {
      imgEl.classList.remove("is-blur");
      imgEl.classList.add("is-loaded");
    }
  };

  const prefetchFullImage = (src) => {
    if (!src || prefetchedFull.has(src)) return;
    prefetchedFull.add(src);
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  };

  const loadFullImage = (imgEl) => {
    if (!imgEl) return;
    const fullSrc = imgEl.dataset.full;
    if (!fullSrc) {
      markPostImageLoaded(imgEl, { full: true });
      return;
    }
    if (imgEl.dataset.fullLoaded === "true") return;
    if (imgEl.currentSrc === fullSrc && imgEl.complete) {
      imgEl.dataset.fullLoaded = "true";
      markPostImageLoaded(imgEl, { full: true });
      return;
    }
    const preloader = new Image();
    preloader.decoding = "async";
    preloader.src = fullSrc;
    preloader.onload = () => {
      imgEl.src = fullSrc;
      imgEl.dataset.fullLoaded = "true";
      markPostImageLoaded(imgEl, { full: true });
    };
    preloader.onerror = () => {
      imgEl.dataset.fullLoaded = "true";
      imgEl.classList.remove("is-blur");
    };
  };

  const initPostImage = (imgEl) => {
    if (!imgEl) return;
    const thumbSrc = imgEl.dataset.thumb;
    const fullSrc = imgEl.dataset.full;
    const handleLoad = () => {
      if (!thumbSrc || imgEl.currentSrc === fullSrc) {
        imgEl.dataset.fullLoaded = "true";
        markPostImageLoaded(imgEl, { full: true });
      } else {
        markPostImageLoaded(imgEl, { full: false });
      }
    };
    imgEl.addEventListener("load", handleLoad, { once: true });
    imgEl.addEventListener(
      "error",
      () => {
        markPostImageLoaded(imgEl, { full: true });
      },
      { once: true }
    );
    if (imgEl.complete) handleLoad();
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
          console.error("[Comentarios] like error", err);
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
          console.error("[Comentarios] delete error", err);
        }
      };
    });

    hydrateAvatars(listEl);
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
    if (!db || !slideId || !commentsList) return;
    const q = query(collection(db, POSTS_COLLECTION, slideId, COMMENTS_COLLECTION), orderBy("createdAt", "asc"));
    unsubscribeComments = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderComments(items, slideId);
      },
      (err) => {
        console.error("[Comentarios] Error obteniendo comentarios", err);
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
      console.error("[Comentarios] Error al borrar (reauth)", err);
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
      console.error("[Muro] Error al borrar publicación", err);
      Swal?.fire?.("Error", "No se pudo borrar la publicación. Contraseña incorrecta o error de red.", "error");
    }
  };

  const clearFeedCommentSubscriptions = () => {
    feedCommentSubscriptions.forEach((unsubscribe) => unsubscribe());
    feedCommentSubscriptions.clear();
  };

  const subscribeCommentsForPost = (postId, listEl, countEl, actionCountEl, postEl) => {
    if (!db || !postId || !listEl) return;
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
        console.error("[Comentarios] Error obteniendo comentarios", err);
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
      console.error("Error registrando like", e);
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
      console.error("[Comentarios] Error publicando comentario", err);
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
              loadFullImage(imgEl);
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
      dot.setAttribute("role", "button");
      dot.setAttribute("tabindex", "0");
      dot.addEventListener("click", () => {
        moveTo(idx);
        resetAuto();
      });
      dot.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          moveTo(idx);
          resetAuto();
        }
      });
      dots.appendChild(dot);
    });
  };

  const getVisualIndex = () => {
    if (slides.length === 0) return 0;
    if (feedMode) return Math.min(activeIndex, slides.length - 1);
    return Math.min(Math.max(currentIndex, 0), slides.length - 1);
  };

  const renderSlides = () => {
    teardownFeedObserver();
    clearFeedCommentSubscriptions();
    if (track) track.classList.remove("is-loading");
    const activePosts = feedMode ? feedPosts : slides;
    if (!activePosts.length) {
      track.innerHTML = `<div class="dm-carousel-empty">${feedMode ? "Aún no hay publicaciones." : "Aún no hay imágenes cargadas."}</div>`;
      dots.innerHTML = "";
      if (autoTimer) clearInterval(autoTimer);
      updateInfoPanel();
      return;
    }

    if (feedMode) {
      const currentUser = auth?.currentUser;
      track.innerHTML = activePosts
        .map((s, idx) => {
          const description = formatPostDescription(s);
          const fullUrl = s.imageUrl;
          const thumbUrl = s.thumbUrl || "";
          const displaySrc = thumbUrl || fullUrl || "";
          const media = fullUrl
            ? `
          <div class="dm-carousel-media dm-post__media is-loading">
            <img class="dm-carousel-img dm-post-img is-blur"
              src="${displaySrc}"
              data-full="${fullUrl}"
              data-thumb="${thumbUrl}"
              alt="${s.title || "Imagen de la galería"}"
              loading="lazy"
              decoding="async"
              width="1200"
              height="900" />
            <span class="dm-img-skeleton" aria-hidden="true"></span>
          </div>
          `
            : "";
          const descBlock = description ? `<div class="dm-post__desc">${description}</div>` : "";
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
        })
        .join("");
      track.appendChild(ensureFeedSentinel());
      updateFeedSentinel({
        loading: isLoadingPosts && !isInitialLoading,
        hasMore: hasMorePosts,
        errorMessage: feedError?.textContent || ""
      });
      const slideEls = track.querySelectorAll(".dm-carousel-slide");
      slideEls.forEach((slideEl) => {
        const img = slideEl.querySelector("img");
        if (!img) return;
        initPostImage(img);
        const handleOrientation = () => {
          if (img.naturalHeight > img.naturalWidth) {
            slideEl.classList.add("vertical");
          }
        };
        img.addEventListener("load", handleOrientation);
        if (img.complete) handleOrientation();
      });
      track.querySelectorAll(".dm-post").forEach((postEl) => {
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
      });
      hydrateAvatars(track);
      setupFeedObserver();
      setupFeedPagerObserver();
      track.style.transition = "none";
      track.style.transform = "none";
      activeIndex = 0;
      isTransitioning = false;
      if (autoTimer) clearInterval(autoTimer);
      renderDots([]);
      return;
    }

    teardownFeedPagerObserver();
    if (feedSentinel?.parentElement) feedSentinel.parentElement.removeChild(feedSentinel);
    track.innerHTML = slides
      .map((s, idx) => {
        const fullUrl = s.imageUrl || "";
        const thumbUrl = s.thumbUrl || "";
        const displaySrc = thumbUrl || fullUrl || "";
        const fetchPriority = idx === 0 ? 'fetchpriority="high"' : "";
        return `
        <div class="dm-carousel-slide" data-idx="${idx}">
          <div class="dm-carousel-media is-loading">
            <img class="dm-carousel-img is-blur" src="${displaySrc}" data-full="${fullUrl}" data-thumb="${thumbUrl}"
              alt="${s.title || "Imagen de la galería"}" loading="${idx === 0 ? "eager" : "lazy"}" ${fetchPriority}
              decoding="async" width="1200" height="900" />
            <span class="dm-img-skeleton" aria-hidden="true"></span>
            <button class="dm-slide-nav dm-slide-nav--left" type="button" data-slide-nav="prev" aria-label="Anterior">◀</button>
            <button class="dm-slide-nav dm-slide-nav--right" type="button" data-slide-nav="next" aria-label="Siguiente">▶</button>
          </div>
        </div>
      `;
      })
      .join("");
    const slideEls = track.querySelectorAll(".dm-carousel-slide");
    slideEls.forEach((slideEl) => {
      const img = slideEl.querySelector(".dm-carousel-img");
      if (!img) return;
      initPostImage(img);
      const handleOrientation = () => {
        if (img.naturalHeight > img.naturalWidth) {
          slideEl.classList.add("vertical");
        }
      };
      img.addEventListener("load", handleOrientation);
      if (img.complete) handleOrientation();
    });
    currentIndex = 0;
    track.style.transition = "none";
    track.style.transform = "none";
    updateSlideWidth();
    setupResizeObserver();
    scrollToIndex(currentIndex, { immediate: true });
    resetAuto();
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

  const moveTo = (targetIndex, { immediate = false } = {}) => {
    if (feedMode || slides.length === 0) return;
    if (!immediate && isTransitioning) return;
    scrollToIndex(targetIndex, { immediate });
  };

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

  const handleWheel = (event) => {
    if (feedMode || !slides.length || isTransitioning) return;
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
    if (feedMode) return;
    if (!event.touches?.length) return;
    const touch = event.touches[0];
    touchStartY = touch.clientY;
    touchStartX = touch.clientX;
    touchDeltaY = 0;
    touchDeltaX = 0;
  };

  const handleTouchMove = (event) => {
    if (feedMode) return;
    if (!event.touches?.length || !slides.length) return;
    const touch = event.touches[0];
    touchDeltaY = touch.clientY - touchStartY;
    touchDeltaX = touch.clientX - touchStartX;
    if (Math.abs(touchDeltaX) > Math.abs(touchDeltaY) && Math.abs(touchDeltaX) > 6) {
      event.preventDefault();
    }
  };

  const handleTouchEnd = () => {
    if (feedMode) return;
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
      console.error("[Comentarios] Error publicando comentario", err);
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
      console.error("Error registrando like", e);
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
      console.error("Error eliminando imagen", e);
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
      console.warn("[Muro] Thumbnail falló, continuo sin thumb.", err);
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
          console.warn("[Muro] No se pudo subir el thumb.", err);
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
      console.error("Error subiendo imagen del carrusel:", e);
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
      console.error("[Muro] Error creando publicación de texto", err);
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
        window.location.replace(buildLoginRedirectUrl("#estructura"));
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


// Desktop-only quick navigation sidebar (left cubes)
function initDesktopQuickSidebar({ assistantShell } = {}) {
  const sidebar = document.getElementById("dmDesktopSidebar");
  if (!sidebar) return;

  const header = document.getElementById("header");
  const botSlot = document.getElementById("dmDesktopSidebarBotSlot");
  const fab = document.getElementById("dmAssistantFab");
  const portalWrapper = document.getElementById("portal-wrapper");
  const portalButton = document.getElementById("btn-portal");
  const portalBubble = document.getElementById("portal-bubble");
  const portalAction = document.getElementById("portal-action");

  // Keep original placement so we can restore when leaving desktop
  const originalParent = fab?.parentElement || null;
  const originalNextSibling = fab?.nextSibling || null;

  const mq = window.matchMedia("(min-width: 1024px)");

  const updateHeaderHeightVar = () => {
    const h = header ? header.getBoundingClientRect().height : 80;
    document.documentElement.style.setProperty("--dm-header-h", `${Math.round(h)}px`);
  };

  const moveFabIntoSidebar = () => {
    if (!fab || !botSlot) return;
    if (fab.parentElement !== botSlot) botSlot.appendChild(fab);
  };

  const restoreFab = () => {
    if (!fab || !originalParent) return;
    if (fab.parentElement === originalParent) return;
    if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
      originalParent.insertBefore(fab, originalNextSibling);
    } else {
      originalParent.appendChild(fab);
    }
  };

  const syncDesktopState = () => {
    if (mq.matches) {
      sidebar.classList.add("dm-desktop-sidebar--active");
      moveFabIntoSidebar();
      fab?.classList.add("dm-cube");
      document.body.classList.add("dm-assistant-docked");
    } else {
      sidebar.classList.remove("dm-desktop-sidebar--active");
      restoreFab();
      fab?.classList.remove("dm-cube");
      document.body.classList.remove("dm-assistant-docked");
    }
    updateHeaderHeightVar();
  };

  let navCubes = [];
  let activeCubeIndex = 0;
  let keyboardNavActive = false;
  let suppressAiFocusOpen = false;

  const refreshNavCubes = () => {
    navCubes = Array.from(sidebar.querySelectorAll(".dm-cube"));
    if (!navCubes.length) return;
    if (activeCubeIndex < 0) activeCubeIndex = 0;
    if (activeCubeIndex >= navCubes.length) activeCubeIndex = navCubes.length - 1;
  };

  const isAssistantCube = (btn) => btn && btn.id === "dmAssistantFab";
  const isPortalCube = (btn) => btn && btn.id === "btn-portal";
  const getAssistantShell = () => assistantShell || window.__dmAssistantShell;
  const isAssistantMenuOpen = () => Boolean(getAssistantShell()?.state?.pickerOpen);
  const showPortalBubble = () => {
    if (!portalWrapper || !portalBubble) return;
    portalWrapper.classList.add("is-open");
    portalBubble.setAttribute("aria-hidden", "false");
    portalButton?.setAttribute("aria-expanded", "true");
  };
  const hidePortalBubble = () => {
    if (!portalWrapper || !portalBubble) return;
    portalWrapper.classList.remove("is-open");
    portalBubble.setAttribute("aria-hidden", "true");
    portalButton?.setAttribute("aria-expanded", "false");
  };
  const openPortalMenu = () => {
    closeAiMenu();
    showPortalBubble();
    portalButton?.classList.add("active");
  };
  const closePortalMenu = () => {
    hidePortalBubble();
    portalButton?.classList.remove("active");
  };
  const openAiMenu = () => {
    const shell = getAssistantShell();
    if (!shell) return;
    closePortalMenu();
    shell.openPicker?.();
    fab?.classList.add("active");
    requestAnimationFrame(() => focusAiModel("gemini"));
  };
  const closeAiMenu = () => {
    const shell = getAssistantShell();
    if (!shell) return;
    shell.closePicker?.();
    fab?.classList.remove("active");
  };
  const closeAllMenus = () => {
    closePortalMenu();
    closeAiMenu();
  };
  const togglePortalMenu = () => {
    const isOpen = portalWrapper?.classList.contains("is-open");
    closeAllMenus();
    if (!isOpen) openPortalMenu();
  };
  const toggleAiMenu = () => {
    const isOpen = isAssistantMenuOpen();
    closeAllMenus();
    if (!isOpen) openAiMenu();
  };
  const isExternalCube = (btn) => {
    if (!btn) return false;
    if (btn.dataset.external === "true") return true;
    if (btn.getAttribute("target") === "_blank") return true;
    const href = btn.getAttribute("href");
    return href ? /^https?:/i.test(href) : false;
  };

  const scrollToCubeTarget = (btn) => {
    if (isExternalCube(btn)) return;
    const targetSel = btn.getAttribute("data-target") || "";
    if (!targetSel || targetSel === "#top") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const target = document.querySelector(targetSel);
    if (!target) return;

    const headerH = header ? header.getBoundingClientRect().height : 0;
    const y = target.getBoundingClientRect().top + window.pageYOffset - headerH - 16;

    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  };

  const clearCubeSelection = ({ closePicker = false } = {}) => {
    if (!navCubes.length) return;
    navCubes.forEach((btn) => btn.classList.remove("is-selected"));
    if (closePicker) closeAllMenus();
    const activeEl = document.activeElement;
    if (activeEl && navCubes.includes(activeEl)) {
      activeEl.blur();
    }
  };

  const setActiveCube = (index, { scroll = false, focus = false } = {}) => {
    refreshNavCubes();
    if (!navCubes.length) return;
    const safeIndex = Math.min(Math.max(index, 0), navCubes.length - 1);
    navCubes.forEach((btn) => btn.classList.remove("is-selected"));
    const nextBtn = navCubes[safeIndex];
    nextBtn.classList.add("is-selected");
    activeCubeIndex = safeIndex;
    if (focus) nextBtn.focus({ preventScroll: true });
    if (scroll && !isAssistantCube(nextBtn)) scrollToCubeTarget(nextBtn);
    if (isAssistantCube(nextBtn)) {
      openAiMenu();
      return;
    }
    if (isPortalCube(nextBtn)) {
      openPortalMenu();
      return;
    }
    closeAllMenus();
  };

  const getAiSelector = () => document.querySelector(".dm-ai-selector");
  const getAiButtons = () => {
    const selector = getAiSelector();
    if (!selector) return [];
    return Array.from(selector.querySelectorAll("[data-dm-ai-model]"));
  };
  const focusAiModel = (model) => {
    const selector = getAiSelector();
    if (!selector) return;
    const btn = selector.querySelector(`[data-dm-ai-model="${model}"]`);
    if (btn) btn.focus({ preventScroll: true });
  };
  const handleAiSelectorKeydown = (event) => {
    const selector = getAiSelector();
    if (!selector || !selector.contains(event.target)) return;
    const buttons = getAiButtons();
    if (!buttons.length) return;
    const activeIndex = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (activeIndex + delta + buttons.length) % buttons.length;
      buttons[nextIndex].focus({ preventScroll: true });
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      (assistantShell || window.__dmAssistantShell)?.closePicker?.();
      fab?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "ArrowRight" || event.key === "Enter") {
      event.preventDefault();
      const btn = document.activeElement;
      const model = btn?.dataset?.dmAiModel;
      if (model) {
        (assistantShell || window.__dmAssistantShell)?.openChat?.(model);
      }
    }
  };

  const bindCubeHandlers = () => {
    refreshNavCubes();
    navCubes.forEach((btn) => {
      btn.addEventListener(
        "click",
        (event) => {
          if (isPortalCube(btn)) {
            event.preventDefault();
            event.stopPropagation();
            togglePortalMenu();
            if (portalWrapper?.classList.contains("is-open")) {
              portalAction?.focus({ preventScroll: true });
            }
            return;
          }
          if (isAssistantCube(btn)) {
            event.stopPropagation();
            btn.classList.add("is-pressed");
            window.setTimeout(() => btn.classList.remove("is-pressed"), 150);
            toggleAiMenu();
            return;
          }
          if (isExternalCube(btn)) return;
          btn.classList.add("is-pressed");
          window.setTimeout(() => btn.classList.remove("is-pressed"), 150);
          setActiveCube(navCubes.indexOf(btn), { scroll: true });
        },
        { passive: false }
      );
    });
  };

  const isTextInput = (el) => {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return el.isContentEditable;
  };

  const handleCubeKeyNav = (event) => {
    if (!mq.matches) return;
    refreshNavCubes();
    if (!navCubes.length) return;
    if (isTextInput(event.target)) return;
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    if (!keyboardNavActive) {
      keyboardNavActive = true;
      const startIndex = event.key === "ArrowUp" ? navCubes.length - 1 : 0;
      setActiveCube(startIndex, { scroll: true, focus: true });
      return;
    }
    const delta = event.key === "ArrowDown" ? 1 : -1;
    setActiveCube(activeCubeIndex + delta, { scroll: true, focus: true });
  };

  const handleWheelNav = () => {
    if (!mq.matches || !keyboardNavActive) return;
    keyboardNavActive = false;
    clearCubeSelection({ closePicker: true });
  };

  bindCubeHandlers();

  if (fab) {
    fab.addEventListener("click", (event) => {
      if (!mq.matches) return;
      event.preventDefault();
      event.stopPropagation();
      suppressAiFocusOpen = false;
      toggleAiMenu();
    });
  }

  if (portalWrapper && portalButton && portalBubble) {
    portalWrapper.addEventListener("focusin", openPortalMenu);
    portalWrapper.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!portalWrapper.contains(document.activeElement)) closePortalMenu();
      }, 0);
    });
    portalButton.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        closeAllMenus();
        openPortalMenu();
        portalAction?.focus({ preventScroll: true });
      }
    });
  }

  if (portalAction && portalButton) {
    portalAction.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        portalButton.focus({ preventScroll: true });
        return;
      }
      if (event.key === "Enter") return;
    });
    portalAction.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  }

  if (fab) {
    const markAiMouseIntent = () => {
      if (!mq.matches) return;
      suppressAiFocusOpen = true;
    };
    fab.addEventListener("pointerdown", markAiMouseIntent);
    fab.addEventListener("mousedown", markAiMouseIntent);
    fab.addEventListener("focus", () => {
      if (!mq.matches) return;
      if (suppressAiFocusOpen) {
        suppressAiFocusOpen = false;
        return;
      }
      closePortalMenu();
      openAiMenu();
    });
  }

  const aiSelector = getAiSelector();
  if (aiSelector) {
    aiSelector.addEventListener("keydown", handleAiSelectorKeydown);
    aiSelector.addEventListener("click", (event) => event.stopPropagation());
  }

  document.addEventListener("click", (event) => {
    if (!mq.matches) return;
    const target = event.target;
    if (target.closest(".nav-item-wrapper")) return;
    if (target.closest("#dmAssistantFab")) return;
    if (target.closest(".dm-ai-selector")) return;
    closeAllMenus();
  });

  syncDesktopState();
  updateHeaderHeightVar();

  window.addEventListener("resize", updateHeaderHeightVar, { passive: true });
  document.addEventListener("keydown", handleCubeKeyNav);
  document.addEventListener("keydown", (event) => {
    if (!mq.matches) return;
    if (event.key !== "ArrowLeft") return;
    const shell = getAssistantShell();
    if (!shell?.state?.panelOpen) return;
    if (isTextInput(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    shell.closeChat?.();
    suppressAiFocusOpen = true;
    fab?.focus({ preventScroll: true });
  });
  window.addEventListener("wheel", handleWheelNav, { passive: true });

  refreshNavCubes();
  if (navCubes.length) {
    activeCubeIndex = Math.max(0, navCubes.findIndex((btn) => btn.classList.contains("is-selected")));
  }

  // MediaQueryList compatibility
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", syncDesktopState);
  } else if (typeof mq.addListener === "function") {
    mq.addListener(syncDesktopState);
  }
}

const initRevealAnimations = () => {
  const targets = Array.from(document.querySelectorAll(".reveal-on-scroll"));
  if (!targets.length) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!("IntersectionObserver" in window) || reduceMotion) {
    targets.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        obs.unobserve(entry.target);
      });
    },
    { threshold: 0.1 }
  );

  targets.forEach((el) => observer.observe(el));
};

const initProgressiveMedia = () => {
  const images = Array.from(document.querySelectorAll("main img")).filter((img) => {
    if (img.closest(".dm-carousel-section")) return false;
    if (img.closest(".dm-carousel-media")) return false;
    if (img.closest(".dm-post__media")) return false;
    if (img.closest(".dm-comments")) return false;
    return true;
  });

  if (!images.length) return;

  images.forEach((img) => {
    if (!img.hasAttribute("loading")) {
      const rect = img.getBoundingClientRect();
      const isNearViewport = rect.top < window.innerHeight * 1.25;
      img.setAttribute("loading", isNearViewport ? "eager" : "lazy");
    }
    if (!img.hasAttribute("decoding")) {
      img.decoding = "async";
    }
    img.classList.add("dm-progressive-img");
    const markLoaded = () => img.classList.add("is-loaded");
    if (img.complete && img.naturalWidth > 0) {
      markLoaded();
    } else {
      img.addEventListener("load", markLoaded, { once: true });
      img.addEventListener("error", markLoaded, { once: true });
    }
  });
};

const initCalendarProgressive = () => {
  const container = document.querySelector(".calendar-container");
  if (!container) return;
  const frame = container.querySelector("iframe");
  if (!frame) return;

  frame.classList.add("dm-calendar-frame");
  if (!frame.hasAttribute("loading")) frame.setAttribute("loading", "lazy");
  if (!frame.getAttribute("title")) frame.setAttribute("title", "Calendario de actividades");

  container.classList.add("is-loading");
  const fallbackTimer = window.setTimeout(() => {
    if (!container.classList.contains("is-loaded")) {
      container.classList.remove("is-loading");
    }
  }, 4000);

  const markLoaded = () => {
    window.clearTimeout(fallbackTimer);
    container.classList.add("is-loaded");
    container.classList.remove("is-loading");
  };

  frame.addEventListener("load", markLoaded, { once: true });
};

const boot = () => {
  initRevealAnimations();
  initProgressiveMedia();
  initCalendarProgressive();
  initUserMenu({ variant: "desktop" });
  const assistantShell = initAssistantShell({ variant: "desktop" });
  initDesktopQuickSidebar({ assistantShell });
  const assistantFab = document.getElementById("dmAssistantFab");
  if (assistantFab && assistantShell) {
    assistantFab.addEventListener("click", (event) => {
      if (assistantFab.classList.contains("dm-cube")) {
        event.stopPropagation();
        return;
      }
      assistantShell.togglePicker();
    });
  }
  initCarouselModule().catch((err) => console.error("[Muro] Error inicializando", err));
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
