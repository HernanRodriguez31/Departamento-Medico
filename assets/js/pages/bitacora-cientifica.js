import { getFirebase } from "../common/firebaseClient.js";
import { initUserMenu } from "../common/user-menu.js?v=20260430-orgtree-avatars-1";
import { requireAuth } from "../shared/authGate.js";
import { initSessionGuard } from "../shared/sessionGuard.js?v=20260305-session-1";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { BITACORA_POSTS } from "../data/bitacora-posts.js";
import { NATIONAL_SELECTED_SOURCE_IDS, SCIENTIFIC_SOURCES } from "../data/scientific-sources.js";
import { createBitacoraArticleRepository } from "../services/bitacora-article-repository.js";
import {
  inferSourceNameFromDomain,
  requestArticleExtraction,
  validateArticleUrl
} from "../services/bitacora-ai-extractor.js";

const { auth, db } = getFirebase();

const FILTER_ALL = "all";
const COMPLETION_FALLBACK = "Completar al cargar una publicación real verificada.";
const STATUS_FILTERS = [
  { label: "Todos los estados", value: FILTER_ALL },
  { label: "Pendiente de revisión", value: "pending_review" },
  { label: "Publicado", value: "published" },
  { label: "Borrador", value: "draft" },
  { label: "Plantilla", value: "template" }
];
const STATUS_LABELS = {
  pending_review: "Pendiente de revisión",
  published: "Publicado",
  draft: "Borrador",
  template: "Plantilla"
};
const EXTRACTION_LABELS = {
  ai_draft: "Borrador automático",
  metadata_only: "Metadatos básicos",
  failed: "Extracción fallida",
  not_configured: "IA no configurada"
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const els = {
  posts: $("#bitacora-posts"),
  empty: $("#bitacora-empty"),
  count: $("#bitacora-results-count"),
  search: $("#bitacora-search"),
  evidence: $("#bitacora-filter-evidence"),
  source: $("#bitacora-filter-source"),
  status: $("#bitacora-filter-status"),
  sort: $("#bitacora-sort"),
  reset: $("#bitacora-reset"),
  filters: $(".bitacora-filters-card"),
  persistenceNote: $(".bitacora-publications-meta p"),
  sources: $("#bitacora-sources"),
  sourceSearch: $("#scientific-sources-search"),
  sourceScopeButtons: $$("[data-source-scope]"),
  sourcesModal: $("#scientific-sources-modal"),
  addArticleModal: $("#add-article-modal"),
  addArticleForm: $("#bitacora-add-article-form"),
  articleUrl: $("#article-url"),
  articleUrlError: $("#article-url-error"),
  articleDomain: $("#article-domain-detected"),
  articleAiStatus: $("#article-ai-status"),
  articleFormError: $("#article-form-error"),
  articleCreatedBy: $("#article-created-by"),
  articleCreatedAt: $("#article-created-at"),
  analyzeButtons: $$("[data-analyze-article]"),
  scrollUp: $("#scroll-up"),
  returnHome: $("#art-gallery-return-home")
};

const state = {
  search: "",
  evidenceType: FILTER_ALL,
  source: FILTER_ALL,
  status: FILTER_ALL,
  sort: "recent",
  expandedPostId: "",
  sourceScope: "international",
  sourceSearch: "",
  userArticles: [],
  repositoryMode: "firestore",
  currentUser: null,
  isAdmin: false,
  demoDismissed: false,
  activeModal: null,
  activeModalTrigger: null,
  articleDraftMeta: {
    extractionStatus: "manual",
    extractionConfidence: null,
    extractionWarnings: [],
    sourceDomain: ""
  }
};

let repository = null;
let unsubscribeArticles = null;

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const normalizeText = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const escapeSelector = (value = "") =>
  window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/"/g, '\\"');

const uniqueSorted = (values = []) =>
  Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "es")
  );

const NATIONAL_SOURCE_ORDER = new Map(NATIONAL_SELECTED_SOURCE_IDS.map((id, index) => [id, index]));

const ensureWebUrl = (value = "") => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch (error) {
    return "";
  }
};

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateTime = (value) => {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
};

const formatDateOnly = (value) => {
  const date = toDate(value);
  if (!date) return String(value || "").trim();
  return new Intl.DateTimeFormat("es-AR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
};

const getSafeField = (value = "") => {
  const clean = String(value || "").trim();
  if (!clean || normalizeText(clean) === normalizeText("Pendiente de carga")) return COMPLETION_FALLBACK;
  return clean;
};

const splitTags = (value = "") =>
  Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).slice(0, 12);

const renderOptions = (select, values, label, currentValue = FILTER_ALL) => {
  if (!select) return;
  select.innerHTML = [
    `<option value="${FILTER_ALL}">${escapeHtml(label)}</option>`,
    ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
  ].join("");
  select.value = values.includes(currentValue) ? currentValue : FILTER_ALL;
};

const renderStaticPost = (post) => ({
  id: post.id,
  title: post.title,
  sourceName: post.sourceName,
  sourceDomain: post.sourceDomain || "",
  officialUrl: post.officialUrl || post.externalUrl || post.sourceUrl || "",
  publicationDate: post.publicationDate || "",
  createdAt: toDate(post.createdAt) || toDate(post.reviewedAt),
  createdAtLabel: post.reviewedAt || "",
  createdByUid: post.createdBy?.uid || "",
  createdByName: post.createdBy?.displayName || post.reviewer || "Departamento Médico",
  evidenceType: post.evidenceType || "Plantilla editorial",
  studyType: post.studyDesign || post.evidenceType || "",
  status: post.status || "template",
  extractionStatus: post.extractionStatus || "manual",
  accessType: post.accessType || "Pendiente",
  summary: post.summary || "",
  executiveSummary: post.summary || "",
  clinicalQuestion: post.clinicalQuestion || "",
  mainResult: post.mainResult || post.keyFinding || "",
  userComment: post.internalComment || "",
  strengths: post.strengths || "",
  limitations: post.limitations || "",
  studyLocation: post.localApplicability || "",
  tags: [...(post.specialty || []), ...(post.tags || [])],
  extractionWarnings: [],
  isTemplate: Boolean(post.isDemo)
});

const renderUserArticle = (article) => ({
  id: article.id,
  title: article.title,
  sourceName: article.sourceName,
  sourceDomain: article.sourceDomain,
  officialUrl: article.officialUrl,
  publicationDate: article.publicationDate,
  createdAt: article.createdAt,
  createdAtLabel: formatDateTime(article.createdAt),
  createdByUid: article.createdBy?.uid || "",
  createdByName: article.createdBy?.displayName || article.createdBy?.email || "Usuario",
  evidenceType: article.evidenceType || article.studyType || "Pendiente",
  studyType: article.studyType,
  status: article.status,
  extractionStatus: article.extractionStatus,
  extractionConfidence: article.extractionConfidence,
  accessType: article.accessType,
  summary: article.executiveSummary || "Artículo cargado para revisión interna.",
  executiveSummary: article.executiveSummary,
  clinicalQuestion: article.clinicalQuestion,
  mainResult: article.mainResult,
  userComment: article.userComment,
  studyLocation: article.studyLocation,
  tags: article.tags || [],
  extractionWarnings: article.extractionWarnings || [],
  isTemplate: false
});

const staticPosts = BITACORA_POSTS.map(renderStaticPost);

const getAllPosts = () => {
  const userPosts = state.userArticles.map(renderUserArticle);
  if (userPosts.length || state.demoDismissed) return userPosts;
  return [...userPosts, ...staticPosts];
};

const getSearchText = (post) =>
  normalizeText(
    [
      post.title,
      post.sourceName,
      post.sourceDomain,
      post.evidenceType,
      post.studyType,
      STATUS_LABELS[post.status],
      post.summary,
      post.executiveSummary,
      post.clinicalQuestion,
      post.mainResult,
      post.userComment,
      ...(post.tags || [])
    ].join(" ")
  );

const matchesFilters = (post) => {
  const normalizedSearch = normalizeText(state.search);
  if (normalizedSearch && !getSearchText(post).includes(normalizedSearch)) return false;
  if (state.evidenceType !== FILTER_ALL && post.evidenceType !== state.evidenceType) return false;
  if (state.source !== FILTER_ALL && post.sourceName !== state.source) return false;
  if (state.status !== FILTER_ALL && post.status !== state.status) return false;
  return true;
};

const sortPosts = (posts) =>
  [...posts].sort((a, b) => {
    if (state.sort === "source") {
      return a.sourceName.localeCompare(b.sourceName, "es") || a.title.localeCompare(b.title, "es");
    }
    if (state.sort === "evidence") {
      return a.evidenceType.localeCompare(b.evidenceType, "es") || a.title.localeCompare(b.title, "es");
    }
    const aTime = toDate(a.createdAt)?.getTime() || 0;
    const bTime = toDate(b.createdAt)?.getTime() || 0;
    return bTime - aTime;
  });

const renderTags = (items = [], limit = 3) => {
  const visible = items.slice(0, limit);
  const hiddenCount = Math.max(0, items.length - visible.length);
  return [
    ...visible.map((item) => `<span class="bitacora-tag">${escapeHtml(item)}</span>`),
    hiddenCount ? `<span class="bitacora-tag">+${hiddenCount}</span>` : ""
  ].join("");
};

const getStatusBadgeClass = (post) => {
  if (post.status === "draft") return "bitacora-badge--draft";
  if (post.status === "template") return "bitacora-badge--template";
  return "bitacora-badge--status";
};

const renderBadges = (post) => {
  const badges = [
    `<span class="bitacora-badge ${getStatusBadgeClass(post)}">${escapeHtml(
      STATUS_LABELS[post.status] || "Pendiente de revisión"
    )}</span>`
  ];
  if (post.extractionStatus && EXTRACTION_LABELS[post.extractionStatus]) {
    badges.push(
      `<span class="bitacora-badge bitacora-badge--ai">${escapeHtml(
        EXTRACTION_LABELS[post.extractionStatus]
      )}</span>`
    );
  }
  return badges.join("");
};

const renderAnalysisBlock = (analysisId, suffix, title, content) => `
  <section aria-labelledby="${analysisId}-${suffix}">
    <h3 id="${analysisId}-${suffix}">${escapeHtml(title)}</h3>
    <p>${escapeHtml(getSafeField(content))}</p>
  </section>
`;

const renderWarnings = (warnings = []) => {
  const cleanWarnings = warnings.map((warning) => String(warning || "").trim()).filter(Boolean);
  if (!cleanWarnings.length) return "";
  return `
    <div class="bitacora-analysis__warnings" role="note">
      ${cleanWarnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}
    </div>
  `;
};

const renderTrace = (post) => `
  <dl class="bitacora-trace">
    <div>
      <dt>Fuente oficial</dt>
      <dd>${escapeHtml(getSafeField(post.officialUrl))}</dd>
    </div>
    <div>
      <dt>Usuario</dt>
      <dd>${escapeHtml(getSafeField(post.createdByName))}</dd>
    </div>
    <div>
      <dt>Fecha y hora</dt>
      <dd>${escapeHtml(getSafeField(post.createdAtLabel || formatDateTime(post.createdAt)))}</dd>
    </div>
    <div>
      <dt>Estado</dt>
      <dd>${escapeHtml(STATUS_LABELS[post.status] || "Pendiente de revisión")}</dd>
    </div>
  </dl>
`;

const canDeleteArticle = (post) =>
  Boolean(
    post &&
      !post.isTemplate &&
      state.currentUser &&
      (state.isAdmin || (post.createdByUid && post.createdByUid === state.currentUser.uid))
  );

const renderAnalysis = (post, analysisId, expanded) => `
  <div id="${analysisId}" class="bitacora-analysis bitacora-analysis-panel" ${expanded ? "" : "hidden"}>
    <div class="bitacora-analysis__grid">
      ${renderAnalysisBlock(analysisId, "question", "Pregunta que busca responder", post.clinicalQuestion)}
      ${renderAnalysisBlock(analysisId, "design", "Tipo de estudio", post.studyType)}
      ${renderAnalysisBlock(analysisId, "result", "Resultado principal", post.mainResult)}
      ${renderAnalysisBlock(analysisId, "summary", "Resumen ejecutivo", post.executiveSummary || post.summary)}
      ${renderAnalysisBlock(analysisId, "comment", "Comentario del usuario", post.userComment)}
      ${renderAnalysisBlock(analysisId, "context", "Lugar / contexto", post.studyLocation)}
    </div>
    ${renderWarnings(post.extractionWarnings)}
    ${renderTrace(post)}
  </div>
`;

const renderPostMeta = (post) => `
  <dl class="bitacora-post-card__meta">
    <div>
      <dt>Publicación</dt>
      <dd>${escapeHtml(getSafeField(formatDateOnly(post.publicationDate)))}</dd>
    </div>
    <div>
      <dt>Carga</dt>
      <dd>${escapeHtml(getSafeField(post.createdAtLabel || formatDateTime(post.createdAt)))}</dd>
    </div>
    <div>
      <dt>Cargado por</dt>
      <dd>${escapeHtml(getSafeField(post.createdByName))}</dd>
    </div>
    <div>
      <dt>Acceso</dt>
      <dd>${escapeHtml(getSafeField(post.accessType))}</dd>
    </div>
  </dl>
`;

const renderPost = (post) => {
  const expanded = state.expandedPostId === post.id;
  const analysisId = `bitacora-analysis-${post.id}`;
  const originalUrl = ensureWebUrl(post.officialUrl);

  return `
    <article class="bitacora-post bitacora-post-card" data-post-id="${escapeHtml(post.id)}">
      <div class="bitacora-post-card__inner">
        <div class="bitacora-post-card__header">
          <div class="bitacora-post-card__eyebrow">
            <span>${escapeHtml(post.sourceName || "Fuente pendiente")}</span>
            <span>${escapeHtml(post.evidenceType || "Tipo pendiente")}</span>
            ${renderBadges(post)}
          </div>
          <h3 class="bitacora-post-card__title">${escapeHtml(post.title || "Artículo sin título")}</h3>
        </div>
        <p class="bitacora-post-card__summary">${escapeHtml(post.summary || COMPLETION_FALLBACK)}</p>
        <div class="bitacora-post-card__tags" aria-label="Etiquetas editoriales">
          ${renderTags(post.tags || [], 3)}
        </div>
        ${renderPostMeta(post)}
      </div>
      <div class="bitacora-post-card__actions">
        <button
          class="bitacora-btn bitacora-btn--primary"
          type="button"
          data-bitacora-action="toggle-analysis"
          aria-expanded="${expanded ? "true" : "false"}"
          aria-controls="${analysisId}"
        >
          ${expanded ? "Ocultar análisis" : "Leer análisis"}
        </button>
        ${
          originalUrl
            ? `<a class="bitacora-btn bitacora-btn--secondary" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">Ver fuente original</a>`
            : ""
        }
        ${
          post.isTemplate
            ? `<button class="bitacora-btn bitacora-btn--secondary" type="button" data-bitacora-action="dismiss-demo">Quitar ejemplo</button>`
            : ""
        }
        ${
          canDeleteArticle(post)
            ? `<button class="bitacora-btn bitacora-btn--danger" type="button" data-bitacora-action="delete-article">Eliminar</button>`
            : ""
        }
      </div>
      ${renderAnalysis(post, analysisId, expanded)}
    </article>
  `;
};

const updateResultCount = (count) => {
  if (!els.count) return;
  els.count.textContent = count === 1 ? "1 artículo agregado" : `${count} artículos agregados`;
};

const updatePersistenceNote = () => {
  if (!els.persistenceNote) return;
  els.persistenceNote.textContent =
    state.repositoryMode === "memory"
      ? "Modo local: los artículos se conservarán solo durante esta sesión."
      : "";
};

const renderFilterOptions = () => {
  const posts = getAllPosts();
  renderOptions(
    els.evidence,
    uniqueSorted(posts.map((post) => post.evidenceType)),
    "Todos los tipos",
    state.evidenceType
  );
  renderOptions(
    els.source,
    uniqueSorted(posts.map((post) => post.sourceName)),
    "Todas las fuentes",
    state.source
  );
  if (els.status) {
    els.status.innerHTML = STATUS_FILTERS.map(
      (filter) => `<option value="${escapeHtml(filter.value)}">${escapeHtml(filter.label)}</option>`
    ).join("");
    els.status.value = STATUS_FILTERS.some((filter) => filter.value === state.status)
      ? state.status
      : FILTER_ALL;
  }
};

const renderPosts = () => {
  if (!els.posts) return;
  const filtered = sortPosts(getAllPosts().filter(matchesFilters));
  els.posts.innerHTML = filtered.map(renderPost).join("");
  if (els.empty) els.empty.hidden = filtered.length > 0;
  updateResultCount(state.userArticles.length);
  updatePersistenceNote();
  if (window.lucide) window.lucide.createIcons();
};

const normalizeSourceScope = (scope = "") => (scope === "national" ? "national" : "international");

const getActiveScopeSources = () => {
  const scope = normalizeSourceScope(state.sourceScope);
  const scoped = SCIENTIFIC_SOURCES.filter((source) => normalizeSourceScope(source.scope) === scope);
  if (scope !== "national") return scoped;
  return scoped.sort((a, b) => {
    const aIndex = NATIONAL_SOURCE_ORDER.has(a.id) ? NATIONAL_SOURCE_ORDER.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bIndex = NATIONAL_SOURCE_ORDER.has(b.id) ? NATIONAL_SOURCE_ORDER.get(b.id) : Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
};

const sourceMatchesSearch = (source) => {
  const search = normalizeText(state.sourceSearch);
  if (!search) return true;
  return normalizeText([source.name, source.fullName, source.category, source.group, source.description].join(" ")).includes(
    search
  );
};

const renderSourceScopeControls = () => {
  els.sourceScopeButtons.forEach((button) => {
    const isActive = normalizeSourceScope(button.dataset.sourceScope) === normalizeSourceScope(state.sourceScope);
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
};

const normalizeLogoSize = (value) => {
  const size = Number.parseInt(value, 10);
  if (!Number.isFinite(size)) return "";
  return Math.min(68, Math.max(30, size));
};

const normalizeLogoScale = (value) => {
  const scale = Number.parseFloat(value);
  if (!Number.isFinite(scale)) return "";
  return Math.min(1.35, Math.max(0.72, scale));
};

const normalizeLogoOffset = (value) => {
  const offset = Number.parseFloat(value);
  if (!Number.isFinite(offset)) return "";
  return Math.min(8, Math.max(-8, offset));
};

const renderSourceCard = (source) => {
  const url = ensureWebUrl(source.url);
  const title = source.fullName && source.fullName !== source.name ? source.fullName : source.name;
  const logoSize = normalizeLogoSize(source.logoSize);
  const logoScale = normalizeLogoScale(source.logoScale);
  const logoOffsetX = normalizeLogoOffset(source.logoOffsetX);
  const logoOffsetY = normalizeLogoOffset(source.logoOffsetY);
  const logoStyles = [
    logoSize ? `--source-logo-size: ${logoSize}px` : "",
    logoScale ? `--source-logo-scale: ${logoScale}` : "",
    logoOffsetX ? `--source-logo-offset-x: ${logoOffsetX}px` : "",
    logoOffsetY ? `--source-logo-offset-y: ${logoOffsetY}px` : ""
  ]
    .filter(Boolean)
    .join("; ");
  const logoStyle = logoStyles ? ` style="${logoStyles}"` : "";
  const logo = source.logoUrl
    ? `<img src="${escapeHtml(source.logoUrl)}" data-logo-stage="local" data-fallback-logo="${escapeHtml(
        source.fallbackLogoUrl || ""
      )}" alt="" loading="lazy" decoding="async" />`
    : source.fallbackLogoUrl
      ? `<img src="${escapeHtml(source.fallbackLogoUrl)}" data-logo-stage="fallback" alt="" loading="lazy" decoding="async" />`
      : "";

  return `
    <a
      class="scientific-source-card"
      data-source-id="${escapeHtml(source.id)}"
      data-source-scope="${escapeHtml(normalizeSourceScope(source.scope))}"
      href="${escapeHtml(url)}"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Abrir ${escapeHtml(title)} en una pestaña nueva"
      ${logoStyle}
    >
      <div class="scientific-source-logo" aria-hidden="true">
        ${logo}
        <span class="scientific-source-logo-fallback">${escapeHtml(source.initials || "DM")}</span>
      </div>
      <div class="scientific-source-card__content">
        <div class="scientific-source-card__topline">
          <span class="scientific-source-card__group">${escapeHtml(source.group || "Fuente científica")}</span>
          <span class="scientific-source-card__category">${escapeHtml(source.category)}</span>
        </div>
        <h3 title="${escapeHtml(title)}">${escapeHtml(source.name)}</h3>
        <p>${escapeHtml(source.description)}</p>
      </div>
      <span class="scientific-source-card__external-icon" aria-hidden="true">
        <i data-lucide="external-link"></i>
      </span>
    </a>
  `;
};

const renderSources = () => {
  if (!els.sources) return;
  const filtered = getActiveScopeSources().filter(sourceMatchesSearch);
  els.sources.innerHTML = filtered.map(renderSourceCard).join("");
  if (window.lucide) window.lucide.createIcons();
};

const handleSourceLogoError = (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  const logo = img.closest(".scientific-source-logo");
  if (!logo) return;
  const fallbackLogo = img.dataset.fallbackLogo || "";
  if (img.dataset.logoStage === "local" && fallbackLogo) {
    img.dataset.logoStage = "fallback";
    img.removeAttribute("data-fallback-logo");
    img.src = fallbackLogo;
    return;
  }
  img.hidden = true;
  logo.classList.add("is-logo-fallback");
};

const getFocusable = (root) =>
  $$(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    root
  ).filter((el) => !el.hidden && el.offsetParent !== null);

const openModal = (modal, trigger) => {
  if (!modal) return;
  state.activeModal = modal;
  state.activeModalTrigger = trigger || document.activeElement;
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("bitacora-modal-open");
  window.requestAnimationFrame(() => {
    const focusTarget = getFocusable(modal)[0] || $(".bitacora-modal__dialog", modal);
    focusTarget?.focus();
  });
};

const closeModal = (modal = state.activeModal) => {
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("bitacora-modal-open");
  const trigger = state.activeModalTrigger;
  state.activeModal = null;
  state.activeModalTrigger = null;
  if (trigger && typeof trigger.focus === "function") {
    trigger.focus({ preventScroll: true });
  }
};

const handleModalKeydown = (event) => {
  const modal = state.activeModal;
  if (!modal) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeModal(modal);
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = getFocusable(modal);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

const getCurrentUserLabel = () => {
  const user = state.currentUser;
  return user?.displayName || user?.email || "Usuario autenticado";
};

const resetArticleDraftMeta = () => {
  state.articleDraftMeta = {
    extractionStatus: "manual",
    extractionConfidence: null,
    extractionWarnings: [],
    sourceDomain: ""
  };
};

const setArticleError = (element, message = "") => {
  if (!element) return;
  element.hidden = !message;
  element.textContent = message;
};

const setAiStatus = (message = "") => {
  if (els.articleAiStatus) els.articleAiStatus.textContent = message;
};

const setFieldValue = (id, value = "", { overwrite = true } = {}) => {
  const field = $(`#${id}`);
  if (!field || (!overwrite && field.value)) return;
  field.value = value || "";
};

const syncArticleAudit = () => {
  if (els.articleCreatedBy) els.articleCreatedBy.textContent = getCurrentUserLabel();
  if (els.articleCreatedAt) els.articleCreatedAt.textContent = formatDateTime(new Date());
};

const resetArticleForm = () => {
  els.addArticleForm?.reset();
  resetArticleDraftMeta();
  setArticleError(els.articleUrlError, "");
  setArticleError(els.articleFormError, "");
  setAiStatus("");
  if (els.articleDomain) els.articleDomain.textContent = "";
  setFieldValue("article-access-type", "Pendiente");
  syncArticleAudit();
};

const openAddArticleModal = (trigger) => {
  resetArticleForm();
  openModal(els.addArticleModal, trigger);
};

const syncUrlDerivedFields = () => {
  const value = els.articleUrl?.value || "";
  const validation = validateArticleUrl(value);
  if (!validation.ok) {
    if (els.articleDomain) els.articleDomain.textContent = "";
    return validation;
  }
  if (els.articleDomain) {
    els.articleDomain.textContent = `Dominio detectado: ${validation.domain}`;
  }
  setFieldValue("article-official-url", validation.href, { overwrite: false });
  setFieldValue("article-source-name", validation.sourceName, { overwrite: false });
  state.articleDraftMeta.sourceDomain = validation.domain;
  return validation;
};

const validateArticleBeforeSave = () => {
  const urlValidation = syncUrlDerivedFields();
  if (!urlValidation.ok) {
    setArticleError(els.articleUrlError, urlValidation.message);
    els.articleUrl?.focus();
    return null;
  }
  setArticleError(els.articleUrlError, "");

  const officialUrl = $("#article-official-url")?.value || urlValidation.href;
  const officialValidation = validateArticleUrl(officialUrl);
  if (!officialValidation.ok) {
    setArticleError(els.articleFormError, "El enlace oficial debe ser una URL válida.");
    $("#article-official-url")?.focus();
    return null;
  }

  const title = ($("#article-title")?.value || "").trim();
  if (!title) {
    setArticleError(els.articleFormError, "Ingresá el título del artículo antes de guardar.");
    $("#article-title")?.focus();
    return null;
  }

  setArticleError(els.articleFormError, "");
  return {
    urlInfo: officialValidation,
    title
  };
};

const fillArticleFromExtraction = (article = {}) => {
  const fieldMap = {
    "article-title": article.title,
    "article-source-name": article.sourceName,
    "article-official-url": article.officialUrl,
    "article-study-type": article.studyType,
    "article-evidence-type": article.evidenceType,
    "article-publication-date": article.publicationDate,
    "article-study-location": article.studyLocation,
    "article-executive-summary": article.executiveSummary,
    "article-clinical-question": article.clinicalQuestion,
    "article-main-result": article.mainResult,
    "article-tags": (article.tags || []).join(", "),
    "article-access-type": article.accessType
  };

  Object.entries(fieldMap).forEach(([id, value]) => {
    if (value) setFieldValue(id, value);
  });

  state.articleDraftMeta.sourceDomain = article.sourceDomain || state.articleDraftMeta.sourceDomain;
  state.articleDraftMeta.extractionConfidence = article.extractionConfidence ?? null;
  state.articleDraftMeta.extractionWarnings = article.warnings || [];
};

const setAnalyzeBusy = (busy) => {
  els.analyzeButtons.forEach((button) => {
    button.disabled = busy;
    button.setAttribute("aria-busy", busy ? "true" : "false");
    const label = $("span", button);
    if (label) label.textContent = busy ? "Analizando..." : "Analizar enlace con IA";
  });
};

const handleAnalyzeArticle = async () => {
  const validation = syncUrlDerivedFields();
  if (!validation.ok) {
    setArticleError(els.articleUrlError, validation.message);
    els.articleUrl?.focus();
    return;
  }
  setArticleError(els.articleUrlError, "");
  setArticleError(els.articleFormError, "");
  setAnalyzeBusy(true);
  setAiStatus("Analizando metadatos disponibles...");
  try {
    const result = await requestArticleExtraction(validation.href, { auth });
    if (result.error) {
      fillArticleFromExtraction(result.article || {});
      state.articleDraftMeta.extractionStatus = result.extractionStatus || "failed";
      setAiStatus(result.error);
      return;
    }
    fillArticleFromExtraction(result.article || {});
    state.articleDraftMeta.extractionStatus = result.extractionStatus || "manual";
    if (result.ok && result.extractionStatus === "ai_draft") {
      setAiStatus("Datos cargados por IA. Revisar antes de guardar.");
      return;
    }
    setAiStatus(result.message || "No se pudo completar con IA. Revisá o completá los campos manualmente.");
  } finally {
    setAnalyzeBusy(false);
  }
};

const buildArticlePayload = (status) => {
  const officialUrl = ($("#article-official-url")?.value || els.articleUrl?.value || "").trim();
  const urlInfo = validateArticleUrl(officialUrl);
  const sourceDomain = urlInfo.ok
    ? urlInfo.domain
    : state.articleDraftMeta.sourceDomain || validateArticleUrl(els.articleUrl?.value || "").domain || "";
  const sourceName =
    ($("#article-source-name")?.value || "").trim() ||
    (sourceDomain ? inferSourceNameFromDomain(sourceDomain) : "");

  return {
    title: $("#article-title")?.value || "",
    sourceName,
    sourceDomain,
    officialUrl,
    studyType: $("#article-study-type")?.value || "",
    evidenceType: $("#article-evidence-type")?.value || "",
    publicationDate: $("#article-publication-date")?.value || "",
    studyLocation: $("#article-study-location")?.value || "",
    executiveSummary: $("#article-executive-summary")?.value || "",
    clinicalQuestion: $("#article-clinical-question")?.value || "",
    mainResult: $("#article-main-result")?.value || "",
    tags: splitTags($("#article-tags")?.value || ""),
    accessType: $("#article-access-type")?.value || "Pendiente",
    userComment: $("#article-user-comment")?.value || "",
    status,
    extractionStatus: state.articleDraftMeta.extractionStatus || "manual",
    extractionConfidence: state.articleDraftMeta.extractionConfidence,
    extractionWarnings: state.articleDraftMeta.extractionWarnings || []
  };
};

const upsertUserArticle = (article) => {
  if (!article?.id) return;
  const next = state.userArticles.filter((item) => item.id !== article.id);
  state.userArticles = [article, ...next];
};

const setSaveBusy = (button, busy) => {
  if (!button) return;
  button.disabled = busy;
  button.dataset.originalText = button.dataset.originalText || button.textContent.trim();
  button.textContent = busy ? "Guardando..." : button.dataset.originalText;
};

const setActionBusy = (button, busy, busyText = "Procesando...") => {
  if (!button) return;
  button.disabled = busy;
  button.dataset.originalText = button.dataset.originalText || button.textContent.trim();
  button.textContent = busy ? busyText : button.dataset.originalText;
};

const confirmArticleDeletion = async (post) => {
  const title = post?.title || "este artículo";
  if (window.Swal?.fire) {
    const result = await window.Swal.fire({
      title: "Eliminar artículo",
      text: `Se quitará "${title}" de la Bitácora.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#b91c1c"
    });
    return Boolean(result.isConfirmed);
  }
  return window.confirm(`Eliminar "${title}" de la Bitácora?`);
};

const showArticleActionError = (message) => {
  if (window.Swal?.fire) {
    window.Swal.fire("No se pudo completar", message, "error");
    return;
  }
  window.alert(message);
};

const handleDeleteArticle = async (postId, button) => {
  const post = getAllPosts().find((item) => item.id === postId);
  if (!post || !repository || !canDeleteArticle(post)) return;
  const confirmed = await confirmArticleDeletion(post);
  if (!confirmed) return;
  setActionBusy(button, true, "Eliminando...");
  try {
    await repository.deleteArticle(post.id);
    state.userArticles = state.userArticles.filter((article) => article.id !== post.id);
    if (state.expandedPostId === post.id) state.expandedPostId = "";
    renderFilterOptions();
    renderPosts();
  } catch (error) {
    const message =
      error?.message === "AUTH_REQUIRED"
        ? "La sesión no está activa. Iniciá sesión nuevamente."
        : "No se pudo eliminar el artículo. Verificá permisos o conexión.";
    showArticleActionError(message);
  } finally {
    setActionBusy(button, false);
  }
};

const handleArticleSubmit = async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const requestedStatus = submitter?.dataset?.saveStatus === "draft" ? "draft" : "pending_review";
  const validation = validateArticleBeforeSave();
  if (!validation || !repository) return;
  setSaveBusy(submitter, true);
  try {
    const article = await repository.createArticle(buildArticlePayload(requestedStatus));
    upsertUserArticle(article);
    state.repositoryMode = article.repositoryMode || repository.getMode();
    renderFilterOptions();
    renderPosts();
    closeModal(els.addArticleModal);
  } catch (error) {
    const message =
      error?.message === "AUTH_REQUIRED"
        ? "No se pudo guardar porque la sesión no está activa."
        : "No se pudo guardar el artículo. Revisá la conexión e intentá nuevamente.";
    setArticleError(els.articleFormError, message);
  } finally {
    setSaveBusy(submitter, false);
  }
};

const resetFilters = () => {
  state.search = "";
  state.evidenceType = FILTER_ALL;
  state.source = FILTER_ALL;
  state.status = FILTER_ALL;
  state.sort = "recent";
  state.expandedPostId = "";
  if (els.search) els.search.value = "";
  if (els.evidence) els.evidence.value = FILTER_ALL;
  if (els.source) els.source.value = FILTER_ALL;
  if (els.status) els.status.value = FILTER_ALL;
  if (els.sort) els.sort.value = "recent";
  renderPosts();
};

const initReturnHomeLink = () => {
  const link = els.returnHome;
  if (!link) return;
  const params = new URLSearchParams(window.location.search);
  link.href = params.get("dmEmulators") === "1" ? "/index.html?dmEmulators=1" : "/index.html";
};

const initScrollUp = () => {
  const btn = els.scrollUp;
  if (!btn) return;
  const sync = () => btn.classList.toggle("show-scroll", window.scrollY > 420);
  window.addEventListener("scroll", sync, { passive: true });
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  sync();
};

const bindEvents = () => {
  els.search?.addEventListener("input", (event) => {
    state.search = event.target.value || "";
    state.expandedPostId = "";
    renderPosts();
  });
  els.evidence?.addEventListener("change", (event) => {
    state.evidenceType = event.target.value || FILTER_ALL;
    state.expandedPostId = "";
    renderPosts();
  });
  els.source?.addEventListener("change", (event) => {
    state.source = event.target.value || FILTER_ALL;
    state.expandedPostId = "";
    renderPosts();
  });
  els.status?.addEventListener("change", (event) => {
    state.status = event.target.value || FILTER_ALL;
    state.expandedPostId = "";
    renderPosts();
  });
  els.sort?.addEventListener("change", (event) => {
    state.sort = event.target.value || "recent";
    renderPosts();
  });
  els.reset?.addEventListener("click", resetFilters);
  els.filters?.addEventListener("submit", (event) => event.preventDefault());

  els.posts?.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-bitacora-action]");
    if (!actionButton) return;
    const post = event.target.closest(".bitacora-post");
    const postId = post?.dataset?.postId || "";
    if (!postId) return;
    const action = actionButton.dataset.bitacoraAction;
    if (action === "dismiss-demo") {
      state.demoDismissed = true;
      state.expandedPostId = "";
      renderPosts();
      return;
    }
    if (action === "delete-article") {
      handleDeleteArticle(postId, actionButton);
      return;
    }
    if (action !== "toggle-analysis") return;
    state.expandedPostId = state.expandedPostId === postId ? "" : postId;
    renderPosts();
    const restored = $(`.bitacora-post[data-post-id="${escapeSelector(postId)}"]`);
    restored?.querySelector('[data-bitacora-action="toggle-analysis"]')?.focus({ preventScroll: true });
  });

  els.sourceScopeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextScope = normalizeSourceScope(button.dataset.sourceScope);
      if (nextScope === state.sourceScope) return;
      state.sourceScope = nextScope;
      state.sourceSearch = "";
      if (els.sourceSearch) els.sourceSearch.value = "";
      renderSourceScopeControls();
      renderSources();
    });
  });
  els.sourceSearch?.addEventListener("input", (event) => {
    state.sourceSearch = event.target.value || "";
    renderSources();
  });
  els.sources?.addEventListener("error", handleSourceLogoError, true);

  $$("[data-open-scientific-sources]").forEach((trigger) => {
    trigger.addEventListener("click", () => openModal(els.sourcesModal, trigger));
  });
  $$("[data-open-add-article]").forEach((trigger) => {
    trigger.addEventListener("click", () => openAddArticleModal(trigger));
  });
  $$("[data-close-modal]").forEach((trigger) => {
    trigger.addEventListener("click", () => closeModal(trigger.closest(".bitacora-modal")));
  });
  $$(".bitacora-modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });
  document.addEventListener("keydown", handleModalKeydown);

  els.articleUrl?.addEventListener("input", () => {
    setArticleError(els.articleUrlError, "");
    syncUrlDerivedFields();
  });
  els.analyzeButtons.forEach((button) => {
    button.addEventListener("click", handleAnalyzeArticle);
  });
  els.addArticleForm?.addEventListener("submit", handleArticleSubmit);
};

const initArticleRepository = () => {
  repository = createBitacoraArticleRepository({ db, auth });
  unsubscribeArticles = repository.subscribe(
    (articles, meta = {}) => {
      state.repositoryMode = meta.mode || repository.getMode();
      state.userArticles = articles;
      renderFilterOptions();
      renderPosts();
    },
    (error) => {
      console.warn("[Bitácora] No se pudo leer bitacoraArticles.", error);
      state.repositoryMode = "memory";
      updatePersistenceNote();
    }
  );
};

const resolveAdminStatus = async (user) => {
  if (!user || !db) return false;
  try {
    const token = await user.getIdTokenResult();
    if (token?.claims?.admin === true) return true;
  } catch (error) {
    console.warn("[Bitácora] No se pudo leer el claim admin.", error);
  }
  try {
    const snap = await getDoc(doc(db, "admin_whitelist", user.uid));
    return snap.exists();
  } catch (error) {
    console.warn("[Bitácora] No se pudo leer admin_whitelist.", error);
    return false;
  }
};

const boot = async () => {
  const currentUser = await requireAuth(auth);
  if (!currentUser) return;
  state.currentUser = currentUser;
  state.isAdmin = await resolveAdminStatus(currentUser);
  initSessionGuard({ auth, db });
  initUserMenu({ variant: "desktop" });
  initReturnHomeLink();
  initScrollUp();
  renderFilterOptions();
  renderSourceScopeControls();
  renderSources();
  renderPosts();
  bindEvents();
  initArticleRepository();
  if (window.lucide) window.lucide.createIcons();
};

window.addEventListener("beforeunload", () => {
  if (typeof unsubscribeArticles === "function") unsubscribeArticles();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
