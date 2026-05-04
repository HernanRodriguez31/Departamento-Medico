import { getFirebase } from "../common/firebaseClient.js";
import { initUserMenu } from "../common/user-menu.js?v=20260430-orgtree-avatars-1";
import { requireAuth } from "../shared/authGate.js";
import { initSessionGuard } from "../shared/sessionGuard.js?v=20260305-session-1";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getBlob,
  ref as storageRef,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { BITACORA_POSTS } from "../data/bitacora-posts.js";
import { NATIONAL_SELECTED_SOURCE_IDS, SCIENTIFIC_SOURCES } from "../data/scientific-sources.js";
import { createBitacoraArticleRepository } from "../services/bitacora-article-repository.js?v=20260504-bitacora-document-agent-1";
import {
  inferSourceNameFromDomain,
  requestArticleExtraction,
  requestArticleDocumentExtraction,
  validateArticleUrl
} from "../services/bitacora-ai-extractor.js?v=20260504-bitacora-document-agent-1";

const { auth, db, storage } = getFirebase();

const FILTER_ALL = "all";
const COMPLETION_FALLBACK = "No especificado en el documento.";
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
  not_configured: "IA no configurada",
  manual: "Manual"
};
const EXTRACTION_SOURCE_LABELS = {
  pdf: "PDF",
  pasted_text: "Texto pegado",
  manual: "Manual",
  url: "Enlace"
};
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MIN_PASTED_TEXT_CHARS = 500;

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
  articleTabs: $$("[data-article-tab]"),
  articlePanels: $$("[data-article-panel]"),
  pdfDropzone: $("#article-pdf-dropzone"),
  pdfInput: $("#article-pdf-input"),
  pdfFile: $("#article-pdf-file"),
  pdfName: $("#article-pdf-name"),
  pdfSize: $("#article-pdf-size"),
  selectPdfButton: $("[data-select-pdf]"),
  removePdfButton: $("[data-remove-pdf]"),
  analyzePdfButton: $("[data-analyze-pdf]"),
  pastedText: $("#article-pasted-text"),
  pastedUrl: $("#article-pasted-url"),
  pastedSource: $("#article-pasted-source"),
  analyzeTextButton: $("[data-analyze-text]"),
  articleUrl: $("#article-url"),
  articleUrlError: $("#article-url-error"),
  articleDomain: $("#article-domain-detected"),
  articleAiStatus: $("#article-ai-status"),
  articleAiWarnings: $("#article-ai-warnings"),
  assistedZone: $("#article-assisted-zone"),
  assistedToggle: $("#article-assisted-toggle"),
  assistedFields: $("#article-assisted-fields"),
  assistedAnalyzeButton: $("[data-analyze-assisted-article]"),
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
    extractionSource: "manual",
    extractionConfidence: null,
    extractionWarnings: [],
    sourceDomain: "",
    doi: "",
    pmid: "",
    pmcid: "",
    nctId: "",
    pii: "",
    originalFileName: "",
    storagePath: "",
    contentHash: "",
    pageCount: 0,
    sourcePages: [],
    rawEvidence: null
  },
  selectedPdfFile: null
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

const splitLines = (value = "") =>
  String(value || "")
    .split(/\n|;/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);

const formatFileSize = (bytes = 0) => {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
};

const safeStorageFileName = (value = "") =>
  String(value || "documento.pdf")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120) || "documento.pdf";

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
  journal: article.journal,
  authors: article.authors || [],
  sourceDomain: article.sourceDomain,
  officialUrl: article.officialUrl,
  doi: article.doi,
  pmid: article.pmid,
  pmcid: article.pmcid,
  nctId: article.nctId,
  pii: article.pii,
  publicationDate: article.publicationDate,
  originalLanguage: article.originalLanguage,
  articleType: article.articleType,
  createdAt: article.createdAt,
  createdAtLabel: formatDateTime(article.createdAt),
  createdByUid: article.createdBy?.uid || "",
  createdByName: article.createdBy?.displayName || article.createdBy?.email || "Usuario",
  evidenceType: article.evidenceType || article.studyType || "Pendiente",
  studyType: article.studyType,
  status: article.status,
  extractionStatus: article.extractionStatus,
  extractionSource: article.extractionSource,
  extractionConfidence: article.extractionConfidence,
  accessType: article.accessType,
  summary: article.cardSummaryEs || article.executiveSummaryEs || article.executiveSummary || "Artículo cargado para revisión interna.",
  cardSummaryEs: article.cardSummaryEs,
  executiveSummary: article.executiveSummaryEs || article.executiveSummary,
  abstractSummaryEs: article.abstractSummaryEs,
  clinicalQuestion: article.clinicalQuestionEs || article.clinicalQuestion,
  mainResult: article.mainResultEs || article.mainResult,
  methodologyEs: article.methodologyEs,
  keyPointsEs: article.keyPointsEs || [],
  limitationsEs: article.limitationsEs,
  localApplicabilityEs: article.localApplicabilityEs,
  occupationalHealthRelevanceEs: article.occupationalHealthRelevanceEs,
  userComment: article.userComment,
  studyLocation: article.studyLocation,
  originalFileName: article.originalFileName,
  storagePath: article.storagePath,
  contentHash: article.contentHash,
  pageCount: article.pageCount,
  sourcePages: article.sourcePages || [],
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

const hasMeaningfulAnalysisValue = (value = "") => {
  const clean = normalizeText(value);
  return Boolean(
    clean &&
      clean !== normalizeText(COMPLETION_FALLBACK) &&
      clean !== normalizeText("Pendiente") &&
      clean !== normalizeText("Artículo cargado para revisión interna.")
  );
};

const isIncompleteDraft = (post) =>
  post.status === "draft" &&
  ![
    post.executiveSummary,
    post.cardSummaryEs,
    post.clinicalQuestion,
    post.mainResult,
    post.methodologyEs,
    post.studyType,
    post.evidenceType
  ].some(hasMeaningfulAnalysisValue);

const renderBadges = (post) => {
  const statusLabel = isIncompleteDraft(post)
    ? "Borrador incompleto"
    : STATUS_LABELS[post.status] || "Pendiente de revisión";
  const badges = [
    `<span class="bitacora-badge ${getStatusBadgeClass(post)}">${escapeHtml(statusLabel)}</span>`
  ];
  if (post.extractionSource && EXTRACTION_SOURCE_LABELS[post.extractionSource]) {
    badges.push(
      `<span class="bitacora-badge bitacora-badge--source">${escapeHtml(
        EXTRACTION_SOURCE_LABELS[post.extractionSource]
      )}</span>`
    );
  }
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

const renderAnalysisListBlock = (analysisId, suffix, title, items = []) => {
  const cleanItems = (Array.isArray(items) ? items : []).map((item) => String(item || "").trim()).filter(Boolean);
  if (!cleanItems.length) return renderAnalysisBlock(analysisId, suffix, title, "");
  return `
    <section aria-labelledby="${analysisId}-${suffix}">
      <h3 id="${analysisId}-${suffix}">${escapeHtml(title)}</h3>
      <ul class="bitacora-analysis__list">
        ${cleanItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
  `;
};

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
    <div>
      <dt>Documento</dt>
      <dd>${escapeHtml(getSafeField(post.originalFileName || EXTRACTION_SOURCE_LABELS[post.extractionSource] || ""))}</dd>
    </div>
    <div>
      <dt>Confianza</dt>
      <dd>${post.extractionConfidence == null ? "No especificado" : `${Math.round(Number(post.extractionConfidence) * 100)}%`}</dd>
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
      ${renderAnalysisBlock(analysisId, "summary", "Resumen ejecutivo", post.executiveSummary || post.summary)}
      ${renderAnalysisBlock(analysisId, "abstract", "Abstract / resumen en español", post.abstractSummaryEs)}
      ${renderAnalysisBlock(analysisId, "question", "Pregunta que busca responder", post.clinicalQuestion)}
      ${renderAnalysisBlock(analysisId, "methodology", "Metodología / tipo de estudio", post.methodologyEs || post.studyType)}
      ${renderAnalysisBlock(analysisId, "result", "Resultado o mensaje principal", post.mainResult)}
      ${renderAnalysisListBlock(analysisId, "keypoints", "Puntos clave", post.keyPointsEs)}
      ${renderAnalysisBlock(analysisId, "limitations", "Limitaciones", post.limitationsEs)}
      ${renderAnalysisBlock(analysisId, "local", "Aplicabilidad local", post.localApplicabilityEs)}
      ${renderAnalysisBlock(analysisId, "occupational", "Relevancia para salud ocupacional / gestión sanitaria", post.occupationalHealthRelevanceEs)}
      ${renderAnalysisBlock(analysisId, "context", "Lugar / contexto", post.studyLocation)}
      ${renderAnalysisBlock(analysisId, "bibliography", "Datos bibliográficos", [post.journal, post.doi, (post.authors || []).join(", ")].filter(Boolean).join(" · "))}
      ${renderAnalysisBlock(analysisId, "comment", "Comentario del usuario", post.userComment)}
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
          ${renderTags(post.tags || [], 4)}
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
          post.storagePath
            ? `<button class="bitacora-btn bitacora-btn--secondary" type="button" data-bitacora-action="view-pdf">Ver PDF</button>`
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
    extractionSource: "manual",
    extractionConfidence: null,
    extractionWarnings: [],
    sourceDomain: "",
    doi: "",
    pmid: "",
    pmcid: "",
    nctId: "",
    pii: "",
    originalFileName: "",
    storagePath: "",
    contentHash: "",
    pageCount: 0,
    sourcePages: [],
    rawEvidence: null
  };
  state.selectedPdfFile = null;
};

const setArticleError = (element, message = "") => {
  if (!element) return;
  element.hidden = !message;
  element.textContent = message;
};

const setAiStatus = (message = "") => {
  if (els.articleAiStatus) els.articleAiStatus.textContent = message;
};

const setAiWarnings = (warnings = []) => {
  if (!els.articleAiWarnings) return;
  const cleanWarnings = Array.from(new Set((warnings || []).map((warning) => String(warning || "").trim()).filter(Boolean))).slice(0, 8);
  els.articleAiWarnings.hidden = !cleanWarnings.length;
  els.articleAiWarnings.innerHTML = cleanWarnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("");
};

const setAssistedModeVisible = (visible, expanded = false) => {
  if (!els.assistedZone || !els.assistedToggle || !els.assistedFields) return;
  els.assistedZone.hidden = !visible;
  els.assistedToggle.setAttribute("aria-expanded", visible && expanded ? "true" : "false");
  els.assistedFields.hidden = !(visible && expanded);
};

const setArticleTab = (tab = "pdf") => {
  const target = ["pdf", "text", "manual"].includes(tab) ? tab : "pdf";
  els.articleTabs.forEach((button) => {
    const active = button.dataset.articleTab === target;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  els.articlePanels.forEach((panel) => {
    const active = panel.dataset.articlePanel === target;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
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
  setAiWarnings([]);
  setAssistedModeVisible(false);
  setArticleTab("pdf");
  if (els.pdfInput) els.pdfInput.value = "";
  if (els.pdfFile) els.pdfFile.hidden = true;
  if (els.pdfName) els.pdfName.textContent = "";
  if (els.pdfSize) els.pdfSize.textContent = "";
  els.pdfDropzone?.classList.remove("is-dragover");
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
  if (!String(value || "").trim()) {
    if (els.articleDomain) els.articleDomain.textContent = "";
    return { ok: true, href: "", domain: "", sourceName: "" };
  }
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

const validateOptionalArticleUrl = (value = "") => {
  const clean = String(value || "").trim();
  if (!clean) return { ok: true, href: "", domain: "", sourceName: "" };
  return validateArticleUrl(clean);
};

const hasArticleEvidenceField = () =>
  [
    $("#article-executive-summary")?.value,
    $("#article-card-summary")?.value,
    $("#article-clinical-question")?.value,
    $("#article-main-result")?.value,
    $("#article-methodology")?.value,
    $("#article-study-type")?.value,
    $("#article-evidence-type")?.value
  ].some((value) => String(value || "").trim());

const validateArticleBeforeSave = (requestedStatus = "pending_review") => {
  const urlValidation = syncUrlDerivedFields();
  if (!urlValidation.ok) {
    setArticleError(els.articleUrlError, urlValidation.message);
    els.articleUrl?.focus();
    return null;
  }
  setArticleError(els.articleUrlError, "");

  const officialUrl = $("#article-official-url")?.value || urlValidation.href;
  const officialValidation = validateOptionalArticleUrl(officialUrl);
  if (!officialValidation.ok) {
    setArticleError(els.articleFormError, "El enlace oficial debe ser una URL válida.");
    $("#article-official-url")?.focus();
    return null;
  }

  const title = ($("#article-title")?.value || "").trim();
  const sourceName = ($("#article-source-name")?.value || "").trim();
  if (requestedStatus === "draft") {
    setArticleError(els.articleFormError, "");
    return {
      urlInfo: officialValidation,
      title: title || "Borrador científico sin título"
    };
  }

  if (!title) {
    setArticleError(els.articleFormError, "Ingresá el título del artículo antes de guardar.");
    $("#article-title")?.focus();
    return null;
  }

  if (!sourceName && !($("#article-journal")?.value || "").trim()) {
    setArticleError(els.articleFormError, "Ingresá la fuente o revista antes de guardar el artículo.");
    $("#article-source-name")?.focus();
    return null;
  }
  if (!($("#article-card-summary")?.value || $("#article-executive-summary")?.value || "").trim()) {
    setArticleError(
      els.articleFormError,
      "Para guardar como artículo, agregá un resumen breve o resumen ejecutivo. Podés guardarlo como borrador si está incompleto."
    );
    $("#article-card-summary")?.focus();
    return null;
  }
  if (!hasArticleEvidenceField()) {
    setArticleError(
      els.articleFormError,
      "Agregá al menos un campo de análisis científico antes de guardar como artículo."
    );
    $("#article-executive-summary")?.focus();
    return null;
  }

  setArticleError(els.articleFormError, "");
  return {
    urlInfo: officialValidation,
    title
  };
};

const fillArticleFromExtraction = (article = {}, rawEvidence = null) => {
  const sourceName = article.sourceName || article.journal || "";
  const fieldMap = {
    "article-title": article.title,
    "article-source-name": sourceName,
    "article-journal": article.journal,
    "article-authors": (article.authors || []).join(", "),
    "article-official-url": article.officialUrl,
    "article-doi": article.doi,
    "article-type": article.articleType,
    "article-study-type": article.studyType,
    "article-evidence-type": article.evidenceType,
    "article-publication-date": article.publicationDate,
    "article-original-language": article.originalLanguage,
    "article-study-location": article.studyLocation,
    "article-card-summary": article.cardSummaryEs,
    "article-executive-summary": article.executiveSummaryEs || article.executiveSummary,
    "article-abstract-summary": article.abstractSummaryEs,
    "article-clinical-question": article.clinicalQuestionEs || article.clinicalQuestion,
    "article-main-result": article.mainResultEs || article.mainResult,
    "article-methodology": article.methodologyEs,
    "article-key-points": (article.keyPointsEs || []).join("\n"),
    "article-limitations": article.limitationsEs,
    "article-local-applicability": article.localApplicabilityEs,
    "article-occupational-relevance": article.occupationalHealthRelevanceEs,
    "article-tags": (article.tags || []).join(", "),
    "article-access-type": article.accessType
  };

  Object.entries(fieldMap).forEach(([id, value]) => {
    if (value) setFieldValue(id, value);
  });

  state.articleDraftMeta.sourceDomain = article.sourceDomain || state.articleDraftMeta.sourceDomain;
  state.articleDraftMeta.doi = article.doi || state.articleDraftMeta.doi;
  state.articleDraftMeta.pmid = article.pmid || state.articleDraftMeta.pmid;
  state.articleDraftMeta.pmcid = article.pmcid || state.articleDraftMeta.pmcid;
  state.articleDraftMeta.nctId = article.nctId || state.articleDraftMeta.nctId;
  state.articleDraftMeta.pii = article.pii || state.articleDraftMeta.pii;
  state.articleDraftMeta.extractionConfidence = article.extractionConfidence ?? null;
  state.articleDraftMeta.extractionWarnings = article.warnings || [];
  state.articleDraftMeta.contentHash = rawEvidence?.contentHash || state.articleDraftMeta.contentHash;
  state.articleDraftMeta.pageCount = rawEvidence?.pageCount || state.articleDraftMeta.pageCount;
  state.articleDraftMeta.sourcePages = article.sourcePages || state.articleDraftMeta.sourcePages || [];
  state.articleDraftMeta.rawEvidence = rawEvidence || state.articleDraftMeta.rawEvidence;
  setAiWarnings(article.warnings || []);
};

const setAnalyzeBusy = (busy) => {
  els.analyzeButtons.forEach((button) => {
    button.disabled = busy;
    button.setAttribute("aria-busy", busy ? "true" : "false");
    const label = $("span", button);
    if (label) label.textContent = busy ? "Analizando..." : "Analizar enlace con IA";
  });
  if (els.assistedAnalyzeButton) {
    els.assistedAnalyzeButton.disabled = busy;
    els.assistedAnalyzeButton.setAttribute("aria-busy", busy ? "true" : "false");
    const label = $("span", els.assistedAnalyzeButton);
    if (label) label.textContent = busy ? "Analizando..." : "Analizar datos pegados";
  }
};

const setDocumentAnalyzeBusy = (button, busy, idleText) => {
  if (!button) return;
  button.disabled = busy;
  button.setAttribute("aria-busy", busy ? "true" : "false");
  const label = $("span", button);
  if (label) label.textContent = busy ? "Analizando..." : idleText;
};

const applyExtractionResult = (result) => {
  fillArticleFromExtraction(result.article || {}, result.rawEvidence || null);
  state.articleDraftMeta.extractionStatus = result.extractionStatus || "manual";
  const shouldShowAssisted =
    result.extractionStatus === "failed" ||
    (result.article?.warnings || []).some((warning) => /bloque|captcha|limita|403/i.test(warning));
  setAssistedModeVisible(shouldShowAssisted, shouldShowAssisted);
  if (result.extractionStatus === "ai_draft") {
    setAiStatus(result.message || "Borrador cargado por IA. Revisá la información antes de guardar.");
    return;
  }
  if (result.extractionStatus === "metadata_only") {
    setAiStatus(
      result.message ||
        "Se detectaron metadatos básicos, pero no contenido científico suficiente. Completá el análisis manualmente."
    );
    return;
  }
  if (result.extractionStatus === "not_configured") {
    setAiStatus(result.error || result.message || "El servicio de IA no está configurado en backend.");
    return;
  }
  setAiStatus(
    result.error ||
      result.message ||
      "No se pudo extraer información suficiente desde esta URL. Probá con DOI, PubMed, PMC, PDF open access o completá manualmente."
  );
};

const getAssistedEvidence = () => ({
  doi: $("#article-assisted-doi")?.value || "",
  pmid: $("#article-assisted-pmid")?.value || "",
  pmcid: $("#article-assisted-pmcid")?.value || "",
  pastedTitle: $("#article-assisted-title")?.value || "",
  pastedSource: $("#article-assisted-source")?.value || "",
  pastedAbstract: $("#article-assisted-abstract")?.value || ""
});

const handleAnalyzeArticle = async (evidence = {}) => {
  const validation = syncUrlDerivedFields();
  if (!validation.ok) {
    setArticleError(els.articleUrlError, validation.message);
    els.articleUrl?.focus();
    return;
  }
  setArticleError(els.articleUrlError, "");
  setArticleError(els.articleFormError, "");
  setAnalyzeBusy(true);
  setAiWarnings([]);
  setAiStatus(Object.values(evidence).some((value) => String(value || "").trim()) ? "Consultando fuentes bibliográficas..." : "Analizando enlace científico...");
  try {
    const result = await requestArticleExtraction(validation.href, { auth, evidence });
    applyExtractionResult(result);
  } finally {
    setAnalyzeBusy(false);
  }
};

const validatePdfFile = (file) => {
  if (!file) return "Seleccioná un PDF para analizar.";
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return "El archivo no es PDF.";
  }
  if (!file.size) return "El archivo PDF está vacío.";
  if (file.size > MAX_PDF_BYTES) return "El archivo supera el tamaño permitido.";
  return "";
};

const setSelectedPdfFile = (file) => {
  const error = validatePdfFile(file);
  if (error) {
    setArticleError(els.articleFormError, error);
    return false;
  }
  state.selectedPdfFile = file;
  setArticleError(els.articleFormError, "");
  if (els.pdfFile) els.pdfFile.hidden = false;
  if (els.pdfName) els.pdfName.textContent = file.name;
  if (els.pdfSize) els.pdfSize.textContent = formatFileSize(file.size);
  return true;
};

const clearSelectedPdfFile = () => {
  state.selectedPdfFile = null;
  if (els.pdfInput) els.pdfInput.value = "";
  if (els.pdfFile) els.pdfFile.hidden = true;
  if (els.pdfName) els.pdfName.textContent = "";
  if (els.pdfSize) els.pdfSize.textContent = "";
};

const uploadSelectedPdf = async () => {
  const file = state.selectedPdfFile;
  const error = validatePdfFile(file);
  if (error) throw new Error(error);
  if (!storage || !auth.currentUser) throw new Error("Necesitás iniciar sesión para analizar documentos.");
  const path = `bitacora/article-documents/${auth.currentUser.uid}/${Date.now()}-${safeStorageFileName(file.name)}`;
  const reference = storageRef(storage, path);
  await uploadBytes(reference, file, {
    contentType: "application/pdf",
    customMetadata: {
      uploadedBy: auth.currentUser.uid,
      originalFileName: file.name,
      purpose: "scientific-article-extraction"
    }
  });
  return path;
};

const applyDocumentExtractionResult = (result, source) => {
  fillArticleFromExtraction(result.article || {}, result.rawEvidence || null);
  state.articleDraftMeta.extractionStatus = result.extractionStatus || "manual";
  state.articleDraftMeta.extractionSource = source;
  if (result.rawEvidence?.originalFileName) {
    state.articleDraftMeta.originalFileName = result.rawEvidence.originalFileName;
  }
  if (result.rawEvidence?.storagePath) {
    state.articleDraftMeta.storagePath = result.rawEvidence.storagePath;
  }
  if (result.rawEvidence?.contentHash) {
    state.articleDraftMeta.contentHash = result.rawEvidence.contentHash;
  }
  if (result.rawEvidence?.pageCount) {
    state.articleDraftMeta.pageCount = result.rawEvidence.pageCount;
  }
  if (result.extractionStatus === "ai_draft") {
    setAiStatus(result.message || "Ficha generada por IA. Revisá la información antes de guardar.");
  } else if (result.extractionStatus === "metadata_only") {
    setAiStatus(result.message || "Se detectaron datos básicos, pero falta contenido suficiente. Completá los campos necesarios antes de guardar.");
  } else if (result.extractionStatus === "not_configured") {
    setAiStatus(result.error || "El servicio de IA no está configurado en backend.");
  } else {
    setAiStatus(result.error || "No se pudo analizar el documento. Podés completar la publicación manualmente.");
  }
};

const handleAnalyzePdf = async () => {
  const error = validatePdfFile(state.selectedPdfFile);
  if (error) {
    setArticleError(els.articleFormError, error);
    return;
  }
  setArticleError(els.articleFormError, "");
  setAiWarnings([]);
  setDocumentAnalyzeBusy(els.analyzePdfButton, true, "Analizar PDF con IA");
  try {
    setAiStatus("Subiendo PDF…");
    const storagePath = await uploadSelectedPdf();
    state.articleDraftMeta.storagePath = storagePath;
    state.articleDraftMeta.originalFileName = state.selectedPdfFile.name;
    state.articleDraftMeta.extractionSource = "pdf";
    setAiStatus("Extrayendo texto…");
    const result = await requestArticleDocumentExtraction(
      {
        mode: "pdf",
        storagePath,
        originalFileName: state.selectedPdfFile.name,
        officialUrl: $("#article-official-url")?.value || els.articleUrl?.value || ""
      },
      { auth }
    );
    setAiStatus("Generando ficha en español…");
    applyDocumentExtractionResult(result, "pdf");
  } catch (error) {
    setAiStatus(error?.message || "No se pudo analizar el documento. Podés completar la publicación manualmente.");
  } finally {
    setDocumentAnalyzeBusy(els.analyzePdfButton, false, "Analizar PDF con IA");
  }
};

const handleAnalyzePastedText = async () => {
  const pastedText = els.pastedText?.value || "";
  if (pastedText.trim().length < MIN_PASTED_TEXT_CHARS) {
    setArticleError(els.articleFormError, "El texto pegado es demasiado breve para generar una ficha confiable.");
    els.pastedText?.focus();
    return;
  }
  setArticleError(els.articleFormError, "");
  setAiWarnings([]);
  setDocumentAnalyzeBusy(els.analyzeTextButton, true, "Analizar texto con IA");
  try {
    setAiStatus("Analizando texto…");
    const result = await requestArticleDocumentExtraction(
      {
        mode: "pasted_text",
        pastedText,
        officialUrl: els.pastedUrl?.value || $("#article-official-url")?.value || "",
        pastedSource: els.pastedSource?.value || $("#article-source-name")?.value || ""
      },
      { auth }
    );
    state.articleDraftMeta.extractionSource = "pasted_text";
    setAiStatus("Generando ficha en español…");
    applyDocumentExtractionResult(result, "pasted_text");
  } finally {
    setDocumentAnalyzeBusy(els.analyzeTextButton, false, "Analizar texto con IA");
  }
};

const handlePdfDrop = (event) => {
  event.preventDefault();
  els.pdfDropzone?.classList.remove("is-dragover");
  const file = event.dataTransfer?.files?.[0] || null;
  if (file) setSelectedPdfFile(file);
};

const handleViewPdf = async (postId, button) => {
  const post = getAllPosts().find((item) => item.id === postId);
  if (!post?.storagePath || !storage) return;
  setActionBusy(button, true, "Abriendo...");
  try {
    const blob = await getBlob(storageRef(storage, post.storagePath));
    const blobUrl = window.URL.createObjectURL(blob);
    const opened = window.open(blobUrl, "_blank", "noopener,noreferrer");
    window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
    if (!opened) {
      showArticleActionError("El navegador bloqueó la apertura del PDF. Permití ventanas emergentes para verlo.");
    }
  } catch (error) {
    showArticleActionError("No se pudo abrir el PDF. Verificá permisos o conexión.");
  } finally {
    setActionBusy(button, false);
  }
};

const buildArticlePayload = (status) => {
  const officialUrl = ($("#article-official-url")?.value || els.articleUrl?.value || "").trim();
  const urlInfo = validateOptionalArticleUrl(officialUrl);
  const sourceDomain = urlInfo.ok
    ? urlInfo.domain
    : state.articleDraftMeta.sourceDomain || validateOptionalArticleUrl(els.articleUrl?.value || "").domain || "";
  const sourceName =
    ($("#article-source-name")?.value || $("#article-journal")?.value || "").trim() ||
    (sourceDomain ? inferSourceNameFromDomain(sourceDomain) : "");

  return {
    title: $("#article-title")?.value || (status === "draft" ? "Borrador científico sin título" : ""),
    sourceName,
    journal: $("#article-journal")?.value || "",
    authors: splitTags($("#article-authors")?.value || ""),
    sourceDomain,
    officialUrl,
    doi: $("#article-doi")?.value || state.articleDraftMeta.doi || "",
    pmid: state.articleDraftMeta.pmid || $("#article-assisted-pmid")?.value || "",
    pmcid: state.articleDraftMeta.pmcid || $("#article-assisted-pmcid")?.value || "",
    nctId: state.articleDraftMeta.nctId || "",
    pii: state.articleDraftMeta.pii || "",
    articleType: $("#article-type")?.value || "",
    studyType: $("#article-study-type")?.value || "",
    evidenceType: $("#article-evidence-type")?.value || "",
    publicationDate: $("#article-publication-date")?.value || "",
    originalLanguage: $("#article-original-language")?.value || "",
    studyLocation: $("#article-study-location")?.value || "",
    cardSummaryEs: $("#article-card-summary")?.value || "",
    executiveSummary: $("#article-executive-summary")?.value || "",
    executiveSummaryEs: $("#article-executive-summary")?.value || "",
    abstractSummaryEs: $("#article-abstract-summary")?.value || "",
    clinicalQuestion: $("#article-clinical-question")?.value || "",
    clinicalQuestionEs: $("#article-clinical-question")?.value || "",
    mainResult: $("#article-main-result")?.value || "",
    mainResultEs: $("#article-main-result")?.value || "",
    methodologyEs: $("#article-methodology")?.value || "",
    keyPointsEs: splitLines($("#article-key-points")?.value || ""),
    limitationsEs: $("#article-limitations")?.value || "",
    localApplicabilityEs: $("#article-local-applicability")?.value || "",
    occupationalHealthRelevanceEs: $("#article-occupational-relevance")?.value || "",
    tags: splitTags($("#article-tags")?.value || ""),
    accessType: $("#article-access-type")?.value || "Pendiente",
    userComment: $("#article-user-comment")?.value || "",
    sourcePages: state.articleDraftMeta.sourcePages || [],
    extractionSource: state.articleDraftMeta.extractionSource || "manual",
    originalFileName: state.articleDraftMeta.originalFileName || "",
    storagePath: state.articleDraftMeta.storagePath || "",
    contentHash: state.articleDraftMeta.contentHash || "",
    pageCount: state.articleDraftMeta.pageCount || 0,
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
    await repository.deleteArticle(post.id, { storagePath: post.storagePath || "" });
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
  const validation = validateArticleBeforeSave(requestedStatus);
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
    if (action === "view-pdf") {
      handleViewPdf(postId, actionButton);
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
  els.articleTabs.forEach((button) => {
    button.addEventListener("click", () => setArticleTab(button.dataset.articleTab));
  });
  els.selectPdfButton?.addEventListener("click", () => els.pdfInput?.click());
  els.pdfDropzone?.addEventListener("click", () => els.pdfInput?.click());
  els.pdfDropzone?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    els.pdfInput?.click();
  });
  els.pdfDropzone?.addEventListener("dragenter", (event) => {
    event.preventDefault();
    els.pdfDropzone?.classList.add("is-dragover");
  });
  els.pdfDropzone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.pdfDropzone?.classList.add("is-dragover");
  });
  els.pdfDropzone?.addEventListener("dragleave", (event) => {
    if (event.currentTarget === event.target) {
      els.pdfDropzone?.classList.remove("is-dragover");
    }
  });
  els.pdfDropzone?.addEventListener("drop", handlePdfDrop);
  els.pdfInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0] || null;
    if (file) setSelectedPdfFile(file);
  });
  els.removePdfButton?.addEventListener("click", clearSelectedPdfFile);
  els.analyzePdfButton?.addEventListener("click", handleAnalyzePdf);
  els.analyzeTextButton?.addEventListener("click", handleAnalyzePastedText);
  els.pastedUrl?.addEventListener("change", () => {
    const validation = validateOptionalArticleUrl(els.pastedUrl?.value || "");
    if (validation.ok && validation.href) {
      setFieldValue("article-official-url", validation.href, { overwrite: false });
      setFieldValue("article-source-name", validation.sourceName, { overwrite: false });
    }
  });
  els.pastedSource?.addEventListener("change", () => {
    setFieldValue("article-source-name", els.pastedSource?.value || "", { overwrite: false });
  });
  els.analyzeButtons.forEach((button) => {
    button.addEventListener("click", () => handleAnalyzeArticle());
  });
  els.assistedToggle?.addEventListener("click", () => {
    const expanded = els.assistedToggle.getAttribute("aria-expanded") === "true";
    setAssistedModeVisible(true, !expanded);
  });
  els.assistedAnalyzeButton?.addEventListener("click", () => handleAnalyzeArticle(getAssistedEvidence()));
  els.addArticleForm?.addEventListener("submit", handleArticleSubmit);
};

const initArticleRepository = () => {
  repository = createBitacoraArticleRepository({ db, auth, storage });
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
