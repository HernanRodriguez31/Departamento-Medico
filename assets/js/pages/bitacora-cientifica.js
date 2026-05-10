import { getFirebase } from "../common/firebaseClient.js";
import { initUserMenu } from "../common/user-menu.js?v=20260430-orgtree-avatars-1";
import { requireAuth } from "../shared/authGate.js";
import { initSessionGuard } from "../shared/sessionGuard.js?v=20260305-session-1";
import { initAssistantShell } from "../shared/assistant-shell.js?v=20260306-chat-desktop-layout-1";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { BITACORA_POSTS } from "../data/bitacora-posts.js";
import { METHODOLOGY_GUIDE, METHODOLOGY_TERMS } from "../data/methodology-guide.js?v=20260504-methodology-guide-terms-1";
import { NATIONAL_SELECTED_SOURCE_IDS, SCIENTIFIC_SOURCES } from "../data/scientific-sources.js?v=20260504-ramr-logo-center-2";
import { createBitacoraArticleRepository } from "../services/bitacora-article-repository.js?v=20260505-bitacora-pdf-load-save-reliability-2";
import {
  inferSourceNameFromDomain,
  requestArticleExtraction,
  requestArticleDocumentExtraction,
  validateArticleUrl
} from "../services/bitacora-ai-extractor.js?v=20260505-bitacora-pdf-load-save-reliability-2";

const { auth, db, storage } = getFirebase();

const BITACORA_CHAT_MODULE_URL = "/js/chat.js?v=20260504-bitacora-cubes-hero-align-3";
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
const SOCIAL_TOOLTIP_LIMIT = 8;

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
  methodologyGuideModal: $("#methodology-guide-modal"),
  methodologyGuideContent: $("#methodology-guide-content"),
  noticeRegion: $("#bitacora-notice-region"),
  addArticleModal: $("#add-article-modal"),
  addArticleTitle: $("#add-article-title"),
  addArticleSubtitle: $("#add-article-description"),
  addArticleForm: $("#bitacora-add-article-form"),
  articleDraftSaveButton: $("#bitacora-add-article-form [data-save-status='draft']"),
  articlePrimarySaveButton: $("#bitacora-add-article-form [data-save-status='pending_review']"),
  articleDocumentTabs: $(".bitacora-document-tabs"),
  articleTabs: $$("[data-article-tab]"),
  articlePanels: $$("[data-article-panel]"),
  pdfDropzone: $("#article-pdf-dropzone"),
  pdfInput: $("#article-pdf-input"),
  pdfFile: $("#article-pdf-file"),
  pdfName: $("#article-pdf-name"),
  pdfSize: $("#article-pdf-size"),
  pdfOfficialUrl: $("#article-pdf-official-url"),
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
  articleAiProcessingOverlay: $("#article-ai-processing-overlay"),
  previewZone: $("#article-preview-zone"),
  previewAiSummary: $("#article-preview-analysis-summary"),
  previewExpandedDescription: $("#article-preview-expanded-description"),
  previewExpandedToggle: $("#article-preview-expanded-toggle"),
  previewExpandedBody: $("#article-preview-expanded-body"),
  advancedZone: $("#article-advanced-zone"),
  advancedToggle: $("#article-advanced-toggle"),
  assistedZone: $("#article-assisted-zone"),
  assistedToggle: $("#article-assisted-toggle"),
  assistedFields: $("#article-assisted-fields"),
  assistedAnalyzeButton: $("[data-analyze-assisted-article]"),
  articleFormError: $("#article-form-error"),
  articleCreatedBy: $("#article-created-by"),
  articleCreatedAt: $("#article-created-at"),
  analyzeButtons: $$("[data-analyze-article]"),
  reauthModal: $("#bitacora-reauth-modal"),
  reauthForm: $("#bitacora-reauth-form"),
  reauthTitle: $("#bitacora-reauth-title"),
  reauthDescription: $("#bitacora-reauth-description"),
  reauthPasswordSection: $("#bitacora-reauth-password-section"),
  reauthProviderSection: $("#bitacora-reauth-provider-section"),
  reauthProviderName: $("#bitacora-reauth-provider-name"),
  reauthPassword: $("#bitacora-reauth-password"),
  reauthError: $("#bitacora-reauth-error"),
  reauthSubmit: $("#bitacora-reauth-submit"),
  deleteConfirmModal: $("#bitacora-delete-confirm-modal"),
  deleteConfirmForm: $("#bitacora-delete-confirm-form"),
  deleteConfirmText: $("#bitacora-delete-confirm-text"),
  deleteConfirmSubmit: $("#bitacora-delete-confirm-submit"),
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
    fileSize: 0,
    documentContentType: "",
    contentHash: "",
    pageCount: 0,
    methodologyProfile: null,
    expandedDescriptionSections: [],
    expandedDescriptionQuality: "insufficient",
    expandedDescriptionText: "",
    sourcePages: [],
    rawEvidence: null
  },
  selectedPdfFile: null,
  articleModalMode: "create",
  editingArticleId: "",
  editingArticleSnapshot: null,
  pendingSensitiveAction: null,
  pendingDeleteArticleId: "",
  socialSummaries: new Map(),
  likeUnsubscribers: new Map(),
  commentsByPost: new Map(),
  activeCommentsArticleId: "",
  activeCommentsUnsubscribe: null,
  expandedCommentsAll: new Set(),
  commentLikeSummaries: new Map(),
  commentLikeUnsubscribers: new Map(),
  editingCommentId: "",
  noticeTimeout: null,
  methodologyTermAnchor: null,
  methodologyTermKey: ""
};

let repository = null;
let unsubscribeArticles = null;
let bitacoraChatLoadPromise = null;

const resolveAssistantVariant = () => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "desktop";
  return window.matchMedia("(min-width: 1024px)").matches ? "desktop" : "mobile";
};

const ensureBitacoraChatLoaded = () => {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.BrisaChat) return Promise.resolve(window.BrisaChat);
  const existingLoader = window.__ensureChatLoaded;
  if (typeof existingLoader === "function" && existingLoader !== ensureBitacoraChatLoaded) {
    return existingLoader().then(() => window.BrisaChat || null);
  }
  if (!bitacoraChatLoadPromise) {
    bitacoraChatLoadPromise = import(BITACORA_CHAT_MODULE_URL)
      .then(() => window.BrisaChat || null)
      .catch((error) => {
        bitacoraChatLoadPromise = null;
        console.warn("[Bitácora] No se pudo cargar el chat flotante.", error);
        return null;
      });
  }
  window.__ensureChatLoaded = ensureBitacoraChatLoaded;
  return bitacoraChatLoadPromise;
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const cleanUserText = (value = "") => String(value || "").replace(/[<>]/g, "").trim();

const EXPANDED_DESCRIPTION_QUALITY_VALUES = new Set(["complete", "partial", "insufficient"]);

const normalizeExpandedDescriptionQuality = (value = "") =>
  EXPANDED_DESCRIPTION_QUALITY_VALUES.has(cleanUserText(value)) ? cleanUserText(value) : "insufficient";

const normalizeExpandedDescriptionSections = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((section) => ({
      heading: cleanUserText(section?.heading).slice(0, 50),
      body: cleanUserText(section?.body).slice(0, 1200)
    }))
    .filter((section) => section.heading && section.body)
    .slice(0, 6);

const expandedDescriptionSectionsToText = (sections = []) =>
  normalizeExpandedDescriptionSections(sections)
    .map((section) => `${section.heading}\n${section.body}`)
    .join("\n\n");

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

const ensureSecureDocumentUrl = (value = "") => {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" ? url.href : "";
  } catch (error) {
    return "";
  }
};

const getArticleDocumentPath = (article = {}) =>
  [
    article.storagePath,
    article.documentStoragePath,
    article.pdfStoragePath,
    article.documentPath,
    article.pdfPath,
    article.storageRef
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";

const getArticleDocumentUrl = (article = {}) =>
  [article.documentUrl, article.pdfUrl, article.sourcePdfUrl]
    .map(ensureSecureDocumentUrl)
    .find(Boolean) || "";

const hasArticleDocument = (article = {}) => Boolean(getArticleDocumentPath(article) || getArticleDocumentUrl(article));

const renderMethodologyGuideIcon = (icon = "circle") =>
  `<i data-lucide="${escapeHtml(icon)}" aria-hidden="true"></i>`;

const getMethodologyTermPopover = () => $("#methodology-term-popover", els.methodologyGuideContent);

const isMethodologyTermPopoverOpen = () => Boolean(getMethodologyTermPopover() && !getMethodologyTermPopover().hidden);

const renderMethodologyGuideTerm = (term = {}) => {
  const termKey = String(term.termKey || "").trim();
  const termData = termKey ? METHODOLOGY_TERMS[termKey] : null;
  const label = term.label || termData?.label || "";
  if (!label) return "";
  if (!termData) {
    return `<span class="methodology-guide-chip">${escapeHtml(label)}</span>`;
  }
  return `
    <button
      type="button"
      class="methodology-guide-term"
      data-methodology-term="${escapeHtml(termKey)}"
      aria-label="Ver definición de ${escapeHtml(label)}"
      aria-expanded="false"
      aria-controls="methodology-term-popover"
    >
      <span>${escapeHtml(label)}</span>
      ${renderMethodologyGuideIcon("info")}
    </button>
  `;
};

const renderMethodologyGuideTerms = (terms = []) => terms.map(renderMethodologyGuideTerm).join("");

const renderMethodologyTermPopover = (term = {}) => `
  <div
    class="methodology-term-popover__card"
    role="dialog"
    aria-modal="false"
    aria-labelledby="methodology-term-popover-title"
    tabindex="-1"
  >
    <button
      type="button"
      class="methodology-term-popover__close"
      data-methodology-term-popover-close
      aria-label="Cerrar definición"
    >
      ${renderMethodologyGuideIcon("x")}
    </button>
    <span class="methodology-term-popover__category">${escapeHtml(term.category || "Concepto metodológico")}</span>
    <h3 id="methodology-term-popover-title">${escapeHtml(term.label || "")}</h3>
    <p class="methodology-term-popover__definition">${escapeHtml(term.definition || "")}</p>
    <div class="methodology-term-popover__example">
      <strong>Ejemplo</strong>
      <span>${escapeHtml(term.example || "Aplicación contextual dentro de un diseño científico.")}</span>
    </div>
    ${term.note ? `<p class="methodology-term-popover__note">${escapeHtml(term.note)}</p>` : ""}
  </div>
`;

const positionMethodologyTermPopover = (anchorElement) => {
  const popover = getMethodologyTermPopover();
  const card = popover?.querySelector(".methodology-term-popover__card");
  if (!popover || !card || !anchorElement) return;
  popover.style.removeProperty("left");
  popover.style.removeProperty("top");
  popover.style.removeProperty("right");
  popover.style.removeProperty("bottom");
  popover.style.removeProperty("transform");
  const anchorRect = anchorElement.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const margin = 16;
  let left = anchorRect.left;
  let top = anchorRect.bottom + 10;
  if (left + cardRect.width > window.innerWidth - margin) {
    left = window.innerWidth - cardRect.width - margin;
  }
  if (left < margin) {
    left = margin;
  }
  if (top + cardRect.height > window.innerHeight - margin) {
    top = Math.max(margin, anchorRect.top - cardRect.height - 10);
  }
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
};

const closeMethodologyTermPopover = ({ restoreFocus = true } = {}) => {
  const popover = getMethodologyTermPopover();
  const anchor = state.methodologyTermAnchor;
  if (popover) {
    popover.hidden = true;
    popover.innerHTML = "";
    popover.style.removeProperty("left");
    popover.style.removeProperty("top");
    popover.style.removeProperty("right");
    popover.style.removeProperty("bottom");
    popover.style.removeProperty("transform");
  }
  $$("[data-methodology-term]", els.methodologyGuideContent).forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
  state.methodologyTermAnchor = null;
  state.methodologyTermKey = "";
  if (restoreFocus && anchor && typeof anchor.focus === "function") {
    anchor.focus({ preventScroll: true });
  }
};

const openMethodologyTermPopover = (termKey = "", anchorElement) => {
  const term = METHODOLOGY_TERMS[termKey];
  const popover = getMethodologyTermPopover();
  if (!term || !popover || !anchorElement) return;
  state.methodologyTermAnchor = anchorElement;
  state.methodologyTermKey = termKey;
  $$("[data-methodology-term]", els.methodologyGuideContent).forEach((button) => {
    button.setAttribute("aria-expanded", button === anchorElement ? "true" : "false");
  });
  popover.innerHTML = renderMethodologyTermPopover(term);
  popover.hidden = false;
  positionMethodologyTermPopover(anchorElement);
  if (window.lucide) window.lucide.createIcons();
  const focusTarget = popover.querySelector("[data-methodology-term-popover-close]") || popover.querySelector(".methodology-term-popover__card");
  focusTarget?.focus({ preventScroll: true });
};

const renderMethodologyGuideHeading = ({ eyebrow = "", title = "", text = "" } = {}) => `
  <div class="methodology-guide-section__heading">
    ${eyebrow ? `<p class="methodology-guide-eyebrow">${escapeHtml(eyebrow)}</p>` : ""}
    ${title ? `<h3>${escapeHtml(title)}</h3>` : ""}
    ${text ? `<p>${escapeHtml(text)}</p>` : ""}
  </div>
`;

const renderMethodologyGuideMicrocards = (cards = []) => `
  <div class="methodology-guide-intro__cards">
    ${cards
      .map(
        (card) => `
          <article class="methodology-guide-microcard">
            <span class="methodology-guide-microcard__icon">${renderMethodologyGuideIcon(card.icon)}</span>
            <h4>${escapeHtml(card.title)}</h4>
            <p>${escapeHtml(card.text)}</p>
          </article>
        `
      )
      .join("")}
  </div>
`;

const renderMethodologyQuickPanel = () => {
  const steps = ["Diseño", "Objetivo", "Temporalidad", "Población", "Comparador", "Análisis"];
  const decisionItems = [
    {
      icon: "git-branch",
      question: "¿El investigador asigna una intervención?",
      answer: "Sí: experimental / cuasi-experimental",
      alternate: "No: observacional"
    },
    {
      icon: "scan-line",
      question: "¿Mide exposición y desenlace al mismo tiempo?",
      answer: "Sí: transversal",
      alternate: "No: evaluar seguimiento"
    },
    {
      icon: "route",
      question: "¿Parte de una exposición o población?",
      answer: "Sí: cohorte",
      alternate: "Observa desenlaces en el tiempo"
    },
    {
      icon: "search",
      question: "¿Parte del desenlace y busca exposiciones previas?",
      answer: "Sí: caso-control",
      alternate: "Útil para eventos raros"
    },
    {
      icon: "files",
      question: "¿Sintetiza estudios ya publicados?",
      answer: "Sí: revisión sistemática",
      alternate: "Si combina resultados: metaanálisis"
    }
  ];

  return `
    <section class="methodology-guide-panel-section methodology-guide-panel-section--hero">
      ${renderMethodologyGuideHeading({
        eyebrow: "Guía rápida",
        title: "Cómo describir un estudio",
        text:
          "Un estudio no se define por una sola etiqueta. Se clasifica combinando qué se hizo, cuándo se midió, sobre quiénes, con qué comparador y cómo se analizaron los datos."
      })}
      <ol class="methodology-guide-workflow" aria-label="Cadena para describir un estudio">
        ${steps
          .map(
            (item, index) => `
              <li class="methodology-guide-workflow__step">
                <span class="methodology-guide-workflow__number">${index + 1}</span>
                <span class="methodology-guide-workflow__label">${escapeHtml(item)}</span>
              </li>
            `
          )
          .join("")}
      </ol>
      <div class="methodology-guide-example">
        <strong>Ejemplo</strong>
        <span>Observacional · Analítico · Longitudinal · Cohorte retrospectiva · Multicéntrico · Registros clínicos.</span>
      </div>
    </section>

    <section class="methodology-guide-panel-section">
      ${renderMethodologyGuideHeading({
        eyebrow: "Decisión en 30 segundos",
        title: "Primero ubicá la lógica del estudio"
      })}
      <div class="methodology-guide-decision" aria-label="Árbol de decisión metodológico">
        ${decisionItems
          .map(
            (item, index) => `
              <article class="methodology-guide-decision__card">
                <span class="methodology-guide-decision__number">${index + 1}</span>
                <span class="methodology-guide-decision__icon">${renderMethodologyGuideIcon(item.icon)}</span>
                <h4>${escapeHtml(item.question)}</h4>
                <p>${escapeHtml(item.answer)}</p>
                <small>${escapeHtml(item.alternate)}</small>
              </article>
            `
          )
          .join("")}
      </div>
      <p class="methodology-guide-note">
        Mientras más completa sea la descripción metodológica, más fácil será interpretar validez, reproducibilidad y aplicabilidad.
      </p>
    </section>
  `;
};

const renderMethodologyDesignsPanel = () => {
  const frequentDesigns = [
    {
      icon: "scan-line",
      title: "Transversal",
      text: "Mide exposición y desenlace en un momento.",
      badge: "Prevalencia"
    },
    {
      icon: "route",
      title: "Cohorte",
      text: "Parte de una población o exposición y sigue desenlaces.",
      badge: "Riesgo / incidencia"
    },
    {
      icon: "search",
      title: "Caso-control",
      text: "Parte del desenlace y busca exposiciones previas.",
      badge: "Odds ratio"
    },
    {
      icon: "flask-conical",
      title: "Ensayo clínico",
      text: "Evalúa una intervención asignada por el investigador.",
      badge: "Efecto de intervención"
    },
    {
      icon: "repeat-2",
      title: "Cuasi-experimental",
      text: "Evalúa una intervención sin aleatorización estricta.",
      badge: "Antes-después"
    },
    {
      icon: "list-checks",
      title: "Revisión sistemática",
      text: "Sintetiza evidencia mediante búsqueda estructurada.",
      badge: "Síntesis"
    },
    {
      icon: "sigma",
      title: "Metaanálisis",
      text: "Combina estadísticamente resultados comparables.",
      badge: "Efecto combinado"
    }
  ];
  const advancedTerms = [
    { label: "Unicéntrico", termKey: "unicentrico" },
    { label: "Bicéntrico", termKey: "bicentrico" },
    { label: "Multicéntrico", termKey: "multicentrico" },
    { label: "Multinacional", termKey: "multinacional" },
    { label: "Aleatorizado", termKey: "aleatorizado" },
    { label: "No aleatorizado", termKey: "noAleatorizado" },
    { label: "Por clusters", termKey: "clusters" },
    { label: "Crossover", termKey: "crossover" },
    { label: "Factorial", termKey: "factorial" },
    { label: "Abierto", termKey: "abierto" },
    { label: "Simple ciego", termKey: "simpleCiego" },
    { label: "Doble ciego", termKey: "dobleCiego" },
    { label: "Triple ciego", termKey: "tripleCiego" },
    { label: "Control histórico", termKey: "historico" },
    { label: "Placebo", termKey: "placebo" },
    { label: "Control activo", termKey: "controlActivo" },
    { label: "Autocontrolado", termKey: "autocontrolado" }
  ];

  return `
    <section class="methodology-guide-panel-section">
      ${renderMethodologyGuideHeading({
        eyebrow: "Diseños frecuentes",
        title: "Patrones que más aparecen en lectura clínica"
      })}
      <div class="methodology-guide-design-grid">
        ${frequentDesigns
          .map(
            (design) => `
              <article class="methodology-guide-design-card">
                <div class="methodology-guide-design-card__icon">${renderMethodologyGuideIcon(design.icon)}</div>
                <h4>${escapeHtml(design.title)}</h4>
                <p>${escapeHtml(design.text)}</p>
                <span>${escapeHtml(design.badge)}</span>
              </article>
            `
          )
          .join("")}
      </div>
      <details class="methodology-guide-details">
        <summary>
          <span>Diseños y atributos avanzados</span>
          ${renderMethodologyGuideIcon("chevron-down")}
        </summary>
        <div class="methodology-guide-details__body">
          ${renderMethodologyGuideTerms(advancedTerms)}
        </div>
      </details>
    </section>
  `;
};

const renderMethodologyDifferencesPanel = () => `
  <section class="methodology-guide-panel-section">
    ${renderMethodologyGuideHeading({
      eyebrow: "Conceptos que suelen confundirse",
      title: "Diferencias clave"
    })}
    <aside class="methodology-guide-distinction" aria-label="No confundir revisión sistemática y metaanálisis">
      <strong>Revisión sistemática ≠ Metaanálisis</strong>
      <p>Una revisión sistemática puede no incluir metaanálisis. El metaanálisis es una técnica estadística dentro de algunos estudios de síntesis.</p>
    </aside>
    <div class="methodology-guide-comparison-grid">
      ${METHODOLOGY_GUIDE.keyDifferences
        .map(
          (item) => `
            <article class="methodology-guide-comparison-card">
              <h4>${escapeHtml(item.title)}</h4>
              <div class="methodology-guide-comparison-card__body">
                <div>
                  <strong>${escapeHtml(item.left[0])}</strong>
                  <p>${escapeHtml(item.left[1])}</p>
                </div>
                <span class="methodology-guide-comparison-card__vs" aria-hidden="true">vs</span>
                <div>
                  <strong>${escapeHtml(item.right[0])}</strong>
                  <p>${escapeHtml(item.right[1])}</p>
                </div>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  </section>
`;

const renderMethodologyChecklistPanel = () => {
  const trafficLight = [
    {
      tone: "green",
      label: "Verde",
      text: "Diseño, población, comparador, desenlaces y análisis están claramente definidos."
    },
    {
      tone: "yellow",
      label: "Amarillo",
      text: "Falta información parcial sobre comparador, seguimiento o control de sesgos."
    },
    {
      tone: "red",
      label: "Rojo",
      text: "No se define población, desenlace principal o método de análisis."
    }
  ];

  return `
    <section class="methodology-guide-panel-section">
      ${renderMethodologyGuideHeading({
        eyebrow: "Checklist básico",
        title: "Parámetros mínimos para interpretar el reporte"
      })}
      <div class="methodology-guide-checklist">
        ${METHODOLOGY_GUIDE.checklistGroups
          .map(
            (group) => `
              <article class="methodology-guide-checklist__group">
                <h4>${escapeHtml(group.title)}</h4>
                <ul>
                  ${group.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                </ul>
              </article>
            `
          )
          .join("")}
      </div>
      <div class="methodology-guide-traffic" aria-label="Semáforo metodológico">
        ${trafficLight
          .map(
            (item) => `
              <article class="methodology-guide-traffic__item methodology-guide-traffic__item--${escapeHtml(item.tone)}">
                <strong>${escapeHtml(item.label)}</strong>
                <p>${escapeHtml(item.text)}</p>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
};

const renderMethodologyMeasuresPanel = () => `
  <section class="methodology-guide-panel-section">
    ${renderMethodologyGuideHeading({
      eyebrow: "Medidas y guías",
      title: "Lectura cuantitativa y transparencia del reporte"
    })}
    <div class="methodology-guide-table-wrap">
      <table class="methodology-guide-table">
        <thead>
          <tr>
            <th scope="col">Diseño</th>
            <th scope="col">Medidas habituales</th>
            <th scope="col">Uso orientativo</th>
          </tr>
        </thead>
        <tbody>
          ${METHODOLOGY_GUIDE.commonMeasures
            .map(
              ([design, measures, use]) => `
                <tr>
                  <th scope="row">${escapeHtml(design)}</th>
                  <td data-label="Medidas habituales">${escapeHtml(measures)}</td>
                  <td data-label="Uso orientativo">${escapeHtml(use)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="methodology-guide-reporting-grid" aria-label="Guías de reporte">
      ${METHODOLOGY_GUIDE.reportingGuidelines
        .map(
          ([label, text]) => `
            <span class="methodology-guide-reporting-chip">
              ${renderMethodologyGuideIcon("book-open-check")}
              <strong>${escapeHtml(label)}</strong>
              <small>${escapeHtml(text)}</small>
            </span>
          `
        )
        .join("")}
    </div>
    <p class="methodology-guide-closing">
      <span>${renderMethodologyGuideIcon(METHODOLOGY_GUIDE.closing.icon)}</span>
      <strong>${escapeHtml(METHODOLOGY_GUIDE.closing.text)}</strong>
    </p>
  </section>
`;

const renderMethodologyGuide = () => {
  if (!els.methodologyGuideContent) return;
  const tabs = [
    ["quick", "Guía rápida", renderMethodologyQuickPanel()],
    ["designs", "Diseños", renderMethodologyDesignsPanel()],
    ["differences", "Diferencias", renderMethodologyDifferencesPanel()],
    ["checklist", "Checklist", renderMethodologyChecklistPanel()],
    ["measures", "Medidas y guías", renderMethodologyMeasuresPanel()]
  ];
  const nav = tabs
    .map(
      ([id, label], index) => `
        <button
          type="button"
          class="methodology-guide-tabs__button"
          id="methodology-guide-tab-${escapeHtml(id)}"
          role="tab"
          data-methodology-guide-tab="${escapeHtml(id)}"
          aria-selected="${index === 0 ? "true" : "false"}"
          aria-controls="methodology-guide-panel-${escapeHtml(id)}"
          tabindex="${index === 0 ? "0" : "-1"}"
        >
          ${escapeHtml(label)}
        </button>
      `
    )
    .join("");
  const panels = tabs
    .map(
      ([id, label, content], index) => `
        <section
          class="methodology-guide-panel"
          id="methodology-guide-panel-${escapeHtml(id)}"
          role="tabpanel"
          data-methodology-guide-panel="${escapeHtml(id)}"
          aria-labelledby="methodology-guide-tab-${escapeHtml(id)}"
          ${index === 0 ? "" : "hidden"}
        >
          <h3 class="sr-only">${escapeHtml(label)}</h3>
          ${content}
        </section>
      `
    )
    .join("");

  els.methodologyGuideContent.innerHTML = `
    <section class="methodology-guide-intro" aria-labelledby="methodology-guide-intro-title">
      <div class="methodology-guide-intro__copy">
        <p class="methodology-guide-eyebrow">Lectura rápida</p>
        <h3 id="methodology-guide-intro-title">${escapeHtml(METHODOLOGY_GUIDE.intro.title)}</h3>
        <p>${escapeHtml(METHODOLOGY_GUIDE.intro.text)}</p>
      </div>
      ${renderMethodologyGuideMicrocards(METHODOLOGY_GUIDE.intro.cards)}
    </section>

    <div class="methodology-guide-tabs" role="tablist" aria-label="Secciones de metodología de estudios científicos">
      ${nav}
    </div>

    <div class="methodology-guide-panels">
      ${panels}
    </div>

    <div id="methodology-term-popover" class="methodology-term-popover" hidden></div>
  `;
  if (window.lucide) window.lucide.createIcons();
};

const activateMethodologyGuideTab = (tabId = "", { focus = false } = {}) => {
  if (!els.methodologyGuideContent || !tabId) return;
  const tabs = $$("[data-methodology-guide-tab]", els.methodologyGuideContent);
  const targetTab = tabs.find((button) => button.dataset.methodologyGuideTab === tabId);
  if (!targetTab) return;
  closeMethodologyTermPopover({ restoreFocus: false });
  tabs.forEach((button) => {
    const isActive = button === targetTab;
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.setAttribute("tabindex", isActive ? "0" : "-1");
  });
  $$("[data-methodology-guide-panel]", els.methodologyGuideContent).forEach((panel) => {
    panel.hidden = panel.dataset.methodologyGuidePanel !== tabId;
  });
  els.methodologyGuideContent.scrollTo({ top: 0, behavior: "auto" });
  if (focus) targetTab.focus({ preventScroll: true });
  if (window.lucide) window.lucide.createIcons();
};

const handleMethodologyGuideNavigation = (event) => {
  const trigger = event.target.closest("[data-methodology-guide-tab]");
  if (!trigger || !els.methodologyGuideContent?.contains(trigger)) return;
  event.preventDefault();
  activateMethodologyGuideTab(trigger.dataset.methodologyGuideTab || "");
};

const handleMethodologyGuideKeyboard = (event) => {
  const currentTab = event.target.closest?.("[data-methodology-guide-tab]");
  if (!currentTab || !els.methodologyGuideContent?.contains(currentTab)) return;
  const tabs = $$("[data-methodology-guide-tab]", els.methodologyGuideContent);
  const currentIndex = tabs.indexOf(currentTab);
  if (currentIndex < 0) return;
  let nextIndex = currentIndex;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.length - 1;
  else if (event.key === "Enter" || event.key === " ") nextIndex = currentIndex;
  else return;
  event.preventDefault();
  activateMethodologyGuideTab(tabs[nextIndex]?.dataset.methodologyGuideTab || "", { focus: true });
};

const handleMethodologyGuideTermInteraction = (event) => {
  const closeButton = event.target.closest("[data-methodology-term-popover-close]");
  if (closeButton && els.methodologyGuideContent?.contains(closeButton)) {
    event.preventDefault();
    closeMethodologyTermPopover();
    return;
  }

  const termButton = event.target.closest("[data-methodology-term]");
  if (termButton && els.methodologyGuideContent?.contains(termButton)) {
    event.preventDefault();
    openMethodologyTermPopover(termButton.dataset.methodologyTerm || "", termButton);
    return;
  }

  if (!isMethodologyTermPopoverOpen()) return;
  if (event.target.closest(".methodology-term-popover__card")) return;
  closeMethodologyTermPopover({ restoreFocus: false });
};

const handleMethodologyGuideScroll = () => {
  if (isMethodologyTermPopoverOpen()) {
    positionMethodologyTermPopover(state.methodologyTermAnchor);
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

const truncateText = (value = "", maxLength = 120) => {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
};

const isNoSpecifiedValue = (value = "") => {
  const clean = normalizeText(value);
  return clean === "no especificado" || clean === "no especificado en el documento";
};

const isNoAplicaValue = (value = "") => {
  const clean = normalizeText(value);
  return clean === "no aplica" || clean.startsWith("no aplica ");
};

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
  createdBy: post.createdBy || null,
  createdByUid: post.createdBy?.uid || "",
  createdByName: post.createdBy?.displayName || post.reviewer || "Departamento Médico",
  evidenceType: post.evidenceType || "Plantilla editorial",
  studyType: post.studyDesign || post.evidenceType || "",
  status: post.status || "template",
  extractionStatus: post.extractionStatus || "manual",
  accessType: post.accessType || "Pendiente",
  summary: post.summary || "",
  briefDescriptionEs: post.summary || "",
  expandedDescriptionEs: post.summary || "",
  expandedDescriptionSections: [],
  expandedDescriptionQuality: "partial",
  executiveSummary: post.summary || "",
  clinicalQuestion: post.clinicalQuestion || "",
  mainResult: post.mainResult || post.keyFinding || "",
  userComment: post.internalComment || "",
  strengths: post.strengths || "",
  limitations: post.limitations || "",
  studyLocation: post.localApplicability || "",
  tags: [...(post.specialty || []), ...(post.tags || [])],
  extractionWarnings: [],
  methodologyProfile: {},
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
  studyDesignEs: article.studyDesignEs || article.methodologyEs,
  studyContextEs: article.studyContextEs,
  studyPopulationEs: article.studyPopulationEs,
  studyLocationEs: article.studyLocationEs || article.studyLocation,
  studyPeriodEs: article.studyPeriodEs,
  createdAt: article.createdAt,
  createdAtLabel: formatDateTime(article.createdAt),
  updatedAt: article.updatedAt,
  createdBy: article.createdBy,
  createdByUid: article.createdBy?.uid || "",
  createdByName: article.createdBy?.displayName || article.createdBy?.email || "Usuario",
  evidenceType: article.evidenceType || article.studyType || "Pendiente",
  studyType: article.studyType,
  status: article.status,
  extractionStatus: article.extractionStatus,
  extractionSource: article.extractionSource,
  extractionConfidence: article.extractionConfidence,
  accessType: article.accessType,
  summary:
    article.briefDescriptionEs ||
    article.cardSummaryEs ||
    article.expandedDescriptionEs ||
    article.executiveSummaryEs ||
    article.executiveSummary ||
    "Artículo cargado para revisión interna.",
  briefDescriptionEs: article.briefDescriptionEs || article.cardSummaryEs,
  expandedDescriptionEs: article.expandedDescriptionEs || article.executiveSummaryEs || article.executiveSummary,
  expandedDescriptionSections: normalizeExpandedDescriptionSections(article.expandedDescriptionSections),
  expandedDescriptionQuality: normalizeExpandedDescriptionQuality(article.expandedDescriptionQuality),
  cardSummaryEs: article.cardSummaryEs,
  executiveSummary: article.expandedDescriptionEs || article.executiveSummaryEs || article.executiveSummary,
  abstractSummaryEs: article.abstractSummaryEs,
  objectiveEs: article.objectiveEs || article.clinicalQuestionEs || article.clinicalQuestion,
  clinicalQuestion: article.objectiveEs || article.clinicalQuestionEs || article.clinicalQuestion,
  mainMessageEs: article.mainMessageEs || article.mainResultEs || article.mainResult,
  mainResult: article.mainMessageEs || article.mainResultEs || article.mainResult,
  methodologyEs: article.methodologyEs,
  keyPointsEs: article.keyPointsEs || [],
  limitationsEs: article.limitationsEs,
  localApplicabilityEs: article.localApplicabilityEs,
  occupationalHealthRelevanceEs: article.occupationalHealthRelevanceEs,
  methodologyProfile: article.methodologyProfile || {},
  userComment: article.userComment,
  studyLocation: article.studyLocation,
  originalFileName: article.originalFileName,
  storagePath: article.storagePath,
  fileSize: article.fileSize,
  documentContentType: article.documentContentType,
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
      post.expandedDescriptionEs,
      expandedDescriptionSectionsToText(post.expandedDescriptionSections),
      post.executiveSummary,
      post.objectiveEs,
      post.clinicalQuestion,
      post.studyDesignEs,
      post.studyContextEs,
      post.studyPopulationEs,
      post.studyLocationEs,
      post.studyPeriodEs,
      post.mainMessageEs,
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

const hasMeaningfulAnalysisValue = (value = "") => {
  const clean = normalizeText(value);
  return Boolean(
    clean &&
      clean !== normalizeText(COMPLETION_FALLBACK) &&
      clean !== normalizeText("Pendiente") &&
      clean !== normalizeText("Artículo cargado para revisión interna.")
  );
};

const renderAnalysisBlock = (analysisId, suffix, title, content) => {
  if (!hasMeaningfulAnalysisValue(content)) return "";
  return `
    <section aria-labelledby="${analysisId}-${suffix}">
      <h3 id="${analysisId}-${suffix}">${escapeHtml(title)}</h3>
      <p>${escapeHtml(String(content || "").trim())}</p>
    </section>
  `;
};

const renderAnalysisListBlock = (analysisId, suffix, title, items = []) => {
  const cleanItems = (Array.isArray(items) ? items : []).map((item) => String(item || "").trim()).filter(Boolean);
  if (!cleanItems.length) return "";
  return `
    <section aria-labelledby="${analysisId}-${suffix}">
      <h3 id="${analysisId}-${suffix}">${escapeHtml(title)}</h3>
      <ul class="bitacora-analysis__list">
        ${cleanItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
  `;
};

const splitExpandedDescriptionParagraphs = (value = "") =>
  String(value || "")
    .split(/\n{2,}|\r\n{2,}/)
    .map((paragraph) => cleanUserText(paragraph))
    .filter(Boolean)
    .slice(0, 8);

const renderExpandedDescription = (post, analysisId) => {
  const sections = normalizeExpandedDescriptionSections(post.expandedDescriptionSections);
  const text = cleanUserText(post.expandedDescriptionEs || post.executiveSummary);
  if (!sections.length && !hasMeaningfulAnalysisValue(text)) return "";
  const bodyId = `${analysisId}-expanded-description`;
  const labelId = `${analysisId}-expanded-description-title`;
  const bodyContent = sections.length
    ? sections
        .map(
          (section, index) => `
            <article class="bitacora-expanded-description__section" aria-labelledby="${bodyId}-section-${index}">
              <h4 id="${bodyId}-section-${index}">${escapeHtml(section.heading)}</h4>
              <p>${escapeHtml(section.body)}</p>
            </article>
          `
        )
        .join("")
    : splitExpandedDescriptionParagraphs(text)
        .map((paragraph) => `<p class="bitacora-expanded-description__paragraph">${escapeHtml(paragraph)}</p>`)
        .join("");
  return `
    <section class="bitacora-expanded-description" aria-labelledby="${labelId}">
      <button
        type="button"
        class="bitacora-expanded-description__toggle"
        data-bitacora-action="toggle-expanded-description"
        aria-expanded="false"
        aria-controls="${bodyId}"
      >
        <span class="bitacora-expanded-description__toggle-copy">
          <span id="${labelId}" class="bitacora-expanded-description__title">Descripción ampliada</span>
          <small>Síntesis editorial del documento para comprender contexto, diseño, hallazgos y aplicabilidad.</small>
        </span>
        <span class="bitacora-expanded-description__toggle-action">
          <span data-expanded-description-toggle-label>Ver descripción</span>
          <i data-lucide="chevron-down" aria-hidden="true"></i>
        </span>
      </button>
      <div id="${bodyId}" class="bitacora-expanded-description__body" hidden>
        ${bodyContent}
      </div>
    </section>
  `;
};

const joinDisplayList = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(", ");

const getEvidenceSupport = (profile = {}, key = "") => {
  const support = profile?.evidenceSupport?.[key];
  return support && typeof support === "object" ? support : null;
};

const renderSupportChip = (support = null, value = "") => {
  const level = support?.supportLevel || "";
  if (level === "inferido_con_soporte") {
    return `<span class="bitacora-methodology-chip bitacora-methodology-chip--inferred">inferido</span>`;
  }
  if (level === "no_aplica" || isNoAplicaValue(value)) {
    return `<span class="bitacora-methodology-chip bitacora-methodology-chip--na">no aplica</span>`;
  }
  return "";
};

const renderMethodologyRow = ({ label, value, support, essential = false }) => {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return "";
  if (!essential && isNoSpecifiedValue(cleanValue)) return "";
  const chip = renderSupportChip(support, cleanValue);
  const softClass = isNoSpecifiedValue(cleanValue) || isNoAplicaValue(cleanValue) ? " bitacora-methodology-row--soft" : "";
  return `
    <div class="bitacora-methodology-row${softClass}">
      <dt>${escapeHtml(label)}${chip}</dt>
      <dd>${escapeHtml(cleanValue)}</dd>
    </div>
  `;
};

const renderMethodologyGrid = (analysisId, post) => {
  const profile = post.methodologyProfile || {};
  const multicenterValue =
    typeof profile.isMulticenter === "boolean"
      ? profile.isMulticenter
        ? "Sí"
        : profile.multicenterRationale || "No"
      : "";
  const rows = [
    { label: "Tipo de trabajo", value: profile.studyFamilyEs },
    {
      label: "Diseño específico",
      value: profile.specificDesign || profile.designCategoryEs || post.studyDesignEs || post.methodologyEs,
      support: getEvidenceSupport(profile, "specificDesign"),
      essential: true
    },
    { label: "Categoría visible", value: profile.designCategoryEs },
    { label: "Temporalidad", value: profile.temporalDirection, support: getEvidenceSupport(profile, "temporalDirection"), essential: true },
    { label: "Alcance / centros", value: profile.centerScope, support: getEvidenceSupport(profile, "centerScope"), essential: true },
    { label: "¿Multicéntrico?", value: multicenterValue, support: getEvidenceSupport(profile, "centerScope"), essential: true },
    { label: "Ámbito", value: profile.setting },
    { label: "Lugar / región", value: profile.countryOrRegion || post.studyLocationEs || post.studyLocation },
    { label: "Instituciones", value: joinDisplayList(profile.institutions), support: getEvidenceSupport(profile, "institutions") },
    { label: "Población o contexto", value: profile.studyPopulation || post.studyPopulationEs, support: getEvidenceSupport(profile, "studyPopulation") },
    { label: "Tamaño / alcance", value: profile.sampleDescription || profile.sampleSize, support: getEvidenceSupport(profile, "sampleSize"), essential: true },
    { label: "Período", value: profile.studyPeriod || post.studyPeriodEs, support: getEvidenceSupport(profile, "studyPeriod") },
    { label: "Duración", value: profile.studyDuration, essential: true },
    { label: "Fuente de datos", value: profile.dataSource },
    { label: "Intervención / exposición", value: profile.interventionOrExposure },
    { label: "Comparador", value: profile.comparator, essential: true },
    { label: "Desenlace o propósito principal", value: profile.primaryOutcome },
    { label: "Método estadístico / proceso analítico", value: profile.statisticalApproach },
    { label: "Guía de reporte sugerida", value: profile.reportingGuideline },
    { label: "Justificación de clasificación", value: profile.classificationRationale, essential: true }
  ].filter((row) => hasMeaningfulAnalysisValue(row.value) && (row.essential || !isNoSpecifiedValue(row.value)));

  if (!rows.length) return "";
  return `
    <section class="bitacora-analysis__section bitacora-analysis__section--wide" aria-labelledby="${analysisId}-methodology-profile">
      <h3 id="${analysisId}-methodology-profile">Ficha metodológica</h3>
      <dl class="bitacora-methodology-grid">
        ${rows.map(renderMethodologyRow).join("")}
      </dl>
    </section>
  `;
};

const renderMethodologyInterpretation = (analysisId, post) => {
  const profile = post.methodologyProfile || {};
  const blocks = [
    ["Fortalezas metodológicas", joinDisplayList(profile.methodologicalStrengths)],
    ["Limitaciones metodológicas", joinDisplayList(profile.methodologicalLimitations) || post.limitationsEs],
    ["Cautelas de interpretación", joinDisplayList(profile.methodologyWarnings)]
  ].filter(([, value]) => hasMeaningfulAnalysisValue(value));
  if (!blocks.length) return "";
  return `
    <section class="bitacora-analysis__section" aria-labelledby="${analysisId}-methodology-interpretation">
      <h3 id="${analysisId}-methodology-interpretation">Interpretación metodológica</h3>
      <div class="bitacora-analysis__stack">
        ${blocks.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("")}
      </div>
    </section>
  `;
};

const renderApplicability = (analysisId, post) => {
  const profile = post.methodologyProfile || {};
  const blocks = [
    ["Aplicabilidad local", post.localApplicabilityEs || joinDisplayList(profile.applicabilityNotes)],
    ["Salud ocupacional / gestión sanitaria", post.occupationalHealthRelevanceEs]
  ].filter(([, value]) => hasMeaningfulAnalysisValue(value));
  if (!blocks.length) return "";
  return `
    <section class="bitacora-analysis__section" aria-labelledby="${analysisId}-applicability">
      <h3 id="${analysisId}-applicability">Aplicabilidad</h3>
      <div class="bitacora-analysis__stack">
        ${blocks.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("")}
      </div>
    </section>
  `;
};

const renderBibliography = (analysisId, post) => {
  const authors = Array.isArray(post.authors) ? post.authors.filter(Boolean) : [];
  const authorLabel = authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", ");
  const rows = [
    ["Revista / fuente", post.journal || post.sourceName],
    ["Fecha de publicación", formatDateOnly(post.publicationDate)],
    ["DOI (Identificador Digital de Objeto)", post.doi],
    ["Autores principales", authorLabel],
    ["URL oficial", ensureWebUrl(post.officialUrl)]
  ].filter(([, value]) => hasMeaningfulAnalysisValue(value));
  if (!rows.length) return "";
  return `
    <section aria-labelledby="${analysisId}-bibliography">
      <h3 id="${analysisId}-bibliography">Datos bibliográficos</h3>
      <dl class="bitacora-analysis__compact-list">
        ${rows
          .map(
            ([label, value]) => `
              <div>
                <dt>${escapeHtml(label)}</dt>
                <dd>${escapeHtml(value)}</dd>
              </div>
            `
          )
          .join("")}
      </dl>
    </section>
  `;
};

const getSocialSummary = (postId = "") =>
  state.socialSummaries.get(postId) || {
    likeCount: 0,
    commentCount: 0,
    likedByCurrentUser: false,
    likes: [],
    comments: [],
    latestComments: []
  };

const getPostComments = (postId = "") => state.commentsByPost.get(postId) || [];

const commentLikeKey = (postId = "", commentId = "") => `${postId}::${commentId}`;

const getCommentLikeSummary = (postId = "", commentId = "") =>
  state.commentLikeSummaries.get(commentLikeKey(postId, commentId)) || {
    count: 0,
    likedByCurrentUser: false,
    likes: []
  };

const canManageComment = (comment = {}) =>
  Boolean(state.currentUser && (state.isAdmin || comment.createdBy?.uid === state.currentUser.uid));

const getSocialNames = (likes = []) =>
  (Array.isArray(likes) ? likes : [])
    .map((like) => like.displayName || like.email || "Usuario")
    .filter(Boolean);

const getSocialTooltipText = (likes = []) => {
  const names = getSocialNames(likes);
  const visible = names.slice(0, SOCIAL_TOOLTIP_LIMIT);
  const extra = Math.max(0, names.length - visible.length);
  return visible.length ? `${visible.join(", ")}${extra ? `, +${extra} más` : ""}` : "Sin me gusta todavía";
};

const renderSocialTooltip = (id = "", likes = []) => {
  const text = getSocialTooltipText(likes);
  return `<span id="${escapeHtml(id)}" class="bitacora-social-tooltip" role="tooltip">${escapeHtml(text)}</span>`;
};

const buildLikeAriaLabel = ({ liked = false, count = 0, target = "esta publicación" } = {}) => {
  const countLabel = count === 1 ? "1 like" : `${count} likes`;
  return liked ? `Te gusta ${target}. ${countLabel}.` : `${countLabel} en ${target}.`;
};

const renderCommentActions = (postId, comment) => {
  const summary = getCommentLikeSummary(postId, comment.id);
  const liked = Boolean(summary.likedByCurrentUser);
  const tooltipId = `comment-like-tooltip-${postId}-${comment.id}`;
  return `
    <div class="bitacora-comment__actions">
      <button
        class="bitacora-comment-action bitacora-comment-like-button${liked ? " is-active" : ""}"
        type="button"
        data-bitacora-action="toggle-comment-like"
        aria-pressed="${liked ? "true" : "false"}"
        aria-describedby="${tooltipId}"
        aria-label="${escapeHtml(buildLikeAriaLabel({ liked, count: summary.count || 0, target: "este comentario" }))}"
      >
        <i data-lucide="heart" aria-hidden="true"></i>
        <strong data-bitacora-comment-like-count>${summary.count || 0}</strong>
        ${renderSocialTooltip(tooltipId, summary.likes || [])}
      </button>
      ${
        canManageComment(comment)
          ? `
            <button class="bitacora-comment-action" type="button" data-bitacora-action="edit-comment" aria-label="Editar comentario" title="Editar comentario">
              <i data-lucide="pencil" aria-hidden="true"></i>
            </button>
            <button class="bitacora-comment-action bitacora-comment-action--delete" type="button" data-bitacora-action="delete-comment" aria-label="Eliminar comentario" title="Eliminar comentario">
              <i data-lucide="trash-2" aria-hidden="true"></i>
            </button>
          `
          : ""
      }
    </div>
  `;
};

const renderComment = (analysisId, postId, comment) => {
  const editing = state.editingCommentId === comment.id;
  return `
    <article class="bitacora-comment" data-comment-id="${escapeHtml(comment.id)}">
      <div class="bitacora-comment__meta">
        <strong>${escapeHtml(comment.createdBy?.displayName || "Usuario")}</strong>
        <span>${escapeHtml(formatDateTime(comment.updatedAt || comment.createdAt) || "Ahora")}</span>
      </div>
      ${
        editing
          ? `
            <form class="bitacora-comment-edit-form" data-bitacora-comment-edit-form>
              <label class="sr-only" for="${analysisId}-comment-edit-${escapeHtml(comment.id)}">Editar comentario</label>
              <textarea id="${analysisId}-comment-edit-${escapeHtml(comment.id)}" maxlength="1000" rows="2" data-bitacora-comment-edit-text>${escapeHtml(comment.text)}</textarea>
              <span class="bitacora-comment-edit-form__actions">
                <button class="bitacora-btn bitacora-btn--secondary" type="submit">Guardar</button>
                <button class="bitacora-btn bitacora-btn--secondary" type="button" data-bitacora-action="cancel-edit-comment">Cancelar</button>
              </span>
            </form>
          `
          : `<p>${escapeHtml(comment.text)}</p>`
      }
      ${renderCommentActions(postId, comment)}
    </article>
  `;
};

const renderComments = (analysisId, post) => {
  if (post.isTemplate) return "";
  const comments = getPostComments(post.id);
  const showAll = state.expandedCommentsAll.has(post.id);
  const visibleComments = showAll ? [...comments].reverse() : comments.slice(-5).reverse();
  const hiddenCount = Math.max(0, comments.length - visibleComments.length);
  return `
    <section class="bitacora-comments" aria-labelledby="${analysisId}-comments">
      <div class="bitacora-comments__header">
        <h3 id="${analysisId}-comments">Comentarios</h3>
        <span>${comments.length === 1 ? "1 comentario" : `${comments.length} comentarios`}</span>
      </div>
      <form class="bitacora-comment-form" data-bitacora-comment-form>
        <label class="sr-only" for="${analysisId}-comment-text">Agregar comentario</label>
        <textarea id="${analysisId}-comment-text" maxlength="1000" rows="2" placeholder="Sumá un comentario breve" data-bitacora-comment-text></textarea>
        <button class="bitacora-btn bitacora-btn--secondary" type="submit">Comentar</button>
      </form>
      <div class="bitacora-comments__list">
        ${
          visibleComments.length
            ? visibleComments
                .map((comment) => renderComment(analysisId, post.id, comment))
                .join("")
            : `<p class="bitacora-comments__empty">Sé el primero en comentar esta publicación.</p>`
        }
      </div>
      ${
        hiddenCount
          ? `<button class="bitacora-comments__more" type="button" data-bitacora-action="show-all-comments">Ver todos</button>`
          : ""
      }
    </section>
  `;
};

const renderSocialActions = (post) => {
  if (post.isTemplate) return "";
  const summary = getSocialSummary(post.id);
  const liked = Boolean(summary.likedByCurrentUser);
  const tooltipId = `article-like-tooltip-${post.id}`;
  return `
    <span class="bitacora-post-card__social" aria-label="Interacciones">
      <button
        class="bitacora-social-action bitacora-like-button${liked ? " is-active" : ""}"
        type="button"
        data-bitacora-action="toggle-like"
        aria-pressed="${liked ? "true" : "false"}"
        aria-describedby="${tooltipId}"
        aria-label="${escapeHtml(buildLikeAriaLabel({ liked, count: summary.likeCount || 0, target: "esta publicación" }))}"
      >
        <i data-lucide="heart" aria-hidden="true"></i>
        <strong data-bitacora-like-count>${summary.likeCount || 0}</strong>
        ${renderSocialTooltip(tooltipId, summary.likes || [])}
      </button>
      <button
        class="bitacora-social-action"
        type="button"
        data-bitacora-action="focus-comments"
        aria-label="${summary.commentCount === 1 ? "1 comentario en esta publicación" : `${summary.commentCount || 0} comentarios en esta publicación`}"
      >
        <i data-lucide="message-circle" aria-hidden="true"></i>
        <strong data-bitacora-comment-count>${summary.commentCount || 0}</strong>
      </button>
    </span>
  `;
};

const renderCommentPreview = (post) => {
  if (post.isTemplate) return "";
  const summary = getSocialSummary(post.id);
  const latest = summary.latestComments || [];
  const count = Number(summary.commentCount || 0);
  if (!count) {
    return `
      <button class="bitacora-comment-preview bitacora-comment-preview--empty" type="button" data-bitacora-action="focus-comments" aria-label="0 comentarios">
        <i data-lucide="message-circle" aria-hidden="true"></i>
        <strong data-bitacora-comment-preview-count>0</strong>
      </button>
    `;
  }
  const last = latest[0] || {};
  const otherNames = latest
    .slice(1, 3)
    .map((comment) => comment.createdBy?.displayName || comment.createdBy?.email || "Usuario")
    .filter(Boolean);
  const extra = Math.max(0, count - 1 - otherNames.length);
  const tail = otherNames.length
    ? ` · ${otherNames.join(", ")}${extra ? ` y +${extra} comentaron también` : " comentó también"}`
    : extra
      ? ` · +${extra} comentarios`
      : "";
  return `
    <button class="bitacora-comment-preview" type="button" data-bitacora-action="focus-comments" aria-label="${escapeHtml(`${count} comentarios. Abrir comentarios.`)}">
      <i data-lucide="message-circle" aria-hidden="true"></i>
      <strong data-bitacora-comment-preview-count>${count}</strong>
      <span data-bitacora-comment-preview-text>
        ${escapeHtml(last.createdBy?.displayName || last.createdBy?.email || "Usuario")}: “${escapeHtml(truncateText(last.text, 92))}”${escapeHtml(tail)}
      </span>
    </button>
  `;
};

const canManageArticle = (post) =>
  Boolean(
    post &&
      !post.isTemplate &&
      state.currentUser &&
      (state.isAdmin || (post.createdByUid && post.createdByUid === state.currentUser.uid))
  );

const getUploaderLabel = (post) =>
  post?.createdByName ||
  post?.createdBy?.displayName ||
  post?.createdBy?.email ||
  "Usuario del departamento";

const getUploaderInitials = (post) => {
  const label = getUploaderLabel(post);
  const parts = String(label || "")
    .replace(/@.+$/, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "DM";
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return initials || "DM";
};

const getUploaderPhotoUrl = (post) => post?.createdBy?.photoURL || "";

const getRecommendationDateLabel = (post) =>
  post?.createdAtLabel || formatDateTime(post?.createdAt) || "Fecha no registrada";

const renderPostCurator = (post) => {
  const uploader = getUploaderLabel(post);
  const photoUrl = getUploaderPhotoUrl(post);
  const dateLabel = getRecommendationDateLabel(post);
  return `
    <div class="bitacora-post-card__curator">
      <span class="bitacora-post-card__avatar" aria-hidden="true">
        ${
          photoUrl
            ? `<img src="${escapeHtml(photoUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
            : `<span>${escapeHtml(getUploaderInitials(post))}</span>`
        }
      </span>
      <span class="bitacora-post-card__curator-copy">
        <span class="bitacora-post-card__curator-label">Recomendado por</span>
        <strong>${escapeHtml(uploader)}</strong>
      </span>
      <span class="bitacora-post-card__curator-date">${escapeHtml(dateLabel)}</span>
    </div>
  `;
};

const renderAnalysis = (post, analysisId, expanded) => `
  <div id="${analysisId}" class="bitacora-analysis bitacora-analysis-panel" ${expanded ? "" : "hidden"}>
    <section class="bitacora-analysis__lead" aria-labelledby="${analysisId}-quick">
      <h3 id="${analysisId}-quick">Lectura rápida</h3>
      ${hasMeaningfulAnalysisValue(post.briefDescriptionEs || post.summary) ? `<p>${escapeHtml(post.briefDescriptionEs || post.summary)}</p>` : ""}
      ${hasMeaningfulAnalysisValue(post.mainMessageEs || post.mainResult) ? `<p class="bitacora-analysis__main-message">${escapeHtml(post.mainMessageEs || post.mainResult)}</p>` : ""}
    </section>
    <div class="bitacora-analysis__grid bitacora-analysis__grid--summary">
      ${renderAnalysisBlock(analysisId, "question", "Objetivo", post.objectiveEs || post.clinicalQuestion)}
      ${renderAnalysisListBlock(analysisId, "keypoints", "Puntos clave", post.keyPointsEs)}
    </div>
    ${renderExpandedDescription(post, analysisId)}
    <div class="bitacora-analysis__grid">
      ${renderMethodologyGrid(analysisId, post)}
      ${renderMethodologyInterpretation(analysisId, post)}
      ${renderApplicability(analysisId, post)}
      ${renderBibliography(analysisId, post)}
    </div>
    ${renderComments(analysisId, post)}
  </div>
`;

const renderPostMeta = (post) => {
  const rows = [
    ["Fecha de publicación", formatDateOnly(post.publicationDate)],
    ["Tipo de estudio", post.evidenceType || post.articleType || post.studyDesignEs || post.studyType],
    ["Acceso", post.accessType]
  ].filter(([, value]) => hasMeaningfulAnalysisValue(value));
  if (!rows.length) return "";
  return `
    <dl class="bitacora-post-card__meta">
      ${rows
        .map(
          ([label, value]) => `
            <div>
              <dt>${escapeHtml(label)}</dt>
              <dd>${escapeHtml(value)}</dd>
            </div>
          `
        )
        .join("")}
    </dl>
  `;
};

const renderPost = (post) => {
  const expanded = state.expandedPostId === post.id;
  const analysisId = `bitacora-analysis-${post.id}`;
  const originalUrl = ensureWebUrl(post.officialUrl);
  const methodLabel =
    post.methodologyProfile?.designCategoryEs ||
    post.methodologyProfile?.specificDesign ||
    post.evidenceType ||
    post.articleType;

  return `
    <article class="bitacora-post bitacora-post-card" data-post-id="${escapeHtml(post.id)}">
      <div class="bitacora-post-card__inner">
        ${renderPostCurator(post)}
        <div class="bitacora-post-card__header">
          <div class="bitacora-post-card__editorial">
            <span class="bitacora-post-card__source">${escapeHtml(post.sourceName || post.journal || "Fuente pendiente")}</span>
            ${
              hasMeaningfulAnalysisValue(methodLabel)
                ? `<span class="bitacora-post-card__method-label">${escapeHtml(methodLabel)}</span>`
                : ""
            }
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
          <i data-lucide="${expanded ? "chevron-up" : "file-text"}" aria-hidden="true"></i>
          <span>${expanded ? "Ocultar Resumen Técnico" : "Resumen Técnico"}</span>
        </button>
        ${
          originalUrl
            ? `<a class="bitacora-btn bitacora-btn--secondary" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">
                <i data-lucide="external-link" aria-hidden="true"></i>
                <span>Ver fuente original</span>
              </a>`
            : ""
        }
        ${
          hasArticleDocument(post)
            ? `<button class="bitacora-btn bitacora-btn--secondary" type="button" data-bitacora-action="view-document" aria-label="Ver documento asociado">
                <i data-lucide="file-search" aria-hidden="true"></i>
                <span>Ver Documento</span>
              </button>`
            : ""
        }
        ${
          post.isTemplate
            ? `<button class="bitacora-btn bitacora-btn--secondary" type="button" data-bitacora-action="dismiss-demo">Quitar ejemplo</button>`
            : ""
        }
        ${renderSocialActions(post)}
        ${
          canManageArticle(post)
            ? `
              <span class="bitacora-post-card__management" aria-label="Acciones de gestión">
                <button
                  class="bitacora-post-action bitacora-post-action--edit"
                  type="button"
                  data-bitacora-action="edit-article"
                  aria-label="Editar publicación"
                  title="Editar publicación"
                >
                  <i data-lucide="pencil" aria-hidden="true"></i>
                </button>
                <button
                  class="bitacora-post-action bitacora-post-action--delete"
                  type="button"
                  data-bitacora-action="delete-article"
                  aria-label="Eliminar publicación"
                  title="Eliminar publicación"
                >
                  <i data-lucide="trash-2" aria-hidden="true"></i>
                </button>
              </span>
            `
            : ""
        }
      </div>
      ${renderCommentPreview(post)}
      ${renderAnalysis(post, analysisId, expanded)}
    </article>
  `;
};

const renderPostSeparator = (index) => `
  <div
    class="bitacora-post-separator"
    aria-hidden="true"
    data-bitacora-post-separator="${index + 1}"
  >
    <span class="bitacora-post-separator__line"></span>
    <span class="bitacora-post-separator__mark">
      <img
        src="/assets/images/logo-brisa-heart.png"
        alt=""
        width="42"
        height="50"
        loading="lazy"
        decoding="async"
      />
    </span>
    <span class="bitacora-post-separator__line"></span>
  </div>
`;

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

const updatePostSocialDom = (postId = "") => {
  const card = $(`.bitacora-post[data-post-id="${escapeSelector(postId)}"]`);
  const summary = getSocialSummary(postId);
  if (!card) return;
  const likeButton = card.querySelector("[data-bitacora-action='toggle-like']");
  const likeCount = card.querySelector("[data-bitacora-like-count]");
  const likeTooltip = likeButton?.querySelector(".bitacora-social-tooltip");
  const commentCount = card.querySelector("[data-bitacora-comment-count]");
  const commentPreviewCount = card.querySelector("[data-bitacora-comment-preview-count]");
  const commentPreviewText = card.querySelector("[data-bitacora-comment-preview-text]");
  const liked = Boolean(summary.likedByCurrentUser);
  if (likeButton) {
    likeButton.classList.toggle("is-active", liked);
    likeButton.setAttribute("aria-pressed", liked ? "true" : "false");
    likeButton.setAttribute(
      "aria-label",
      buildLikeAriaLabel({ liked, count: summary.likeCount || 0, target: "esta publicación" })
    );
  }
  if (likeCount) likeCount.textContent = String(summary.likeCount || 0);
  if (likeTooltip) likeTooltip.textContent = getSocialTooltipText(summary.likes || []);
  if (commentCount) commentCount.textContent = String(summary.commentCount || 0);
  if (commentPreviewCount) commentPreviewCount.textContent = String(summary.commentCount || 0);
  if (commentPreviewText) {
    const latest = summary.latestComments || [];
    const last = latest[0] || null;
    commentPreviewText.textContent = last
      ? `${last.createdBy?.displayName || last.createdBy?.email || "Usuario"}: “${truncateText(last.text, 92)}”`
      : "";
  }
};

const mergeSocialSummary = (postId = "", patch = {}) => {
  state.socialSummaries.set(postId, {
    ...getSocialSummary(postId),
    ...patch
  });
  updatePostSocialDom(postId);
};

const syncSocialWatchers = (posts = []) => {
  if (!repository) return;
  const activeIds = new Set(posts.filter((post) => !post.isTemplate).map((post) => post.id));
  state.likeUnsubscribers.forEach((unsubscribe, postId) => {
    if (!activeIds.has(postId)) {
      unsubscribe?.();
      state.likeUnsubscribers.delete(postId);
    }
  });
  posts.forEach((post) => {
    if (post.isTemplate || state.likeUnsubscribers.has(post.id)) return;
    repository.getArticleSocialSummary?.(post.id)
      .then((summary) => {
        mergeSocialSummary(post.id, summary);
        if (Array.isArray(summary.comments)) state.commentsByPost.set(post.id, summary.comments);
      })
      .catch(() => {});
    const unsubscribe = repository.watchArticleSocialSummary?.(post.id, (summary) => {
      mergeSocialSummary(post.id, summary);
      if (Array.isArray(summary.comments)) state.commentsByPost.set(post.id, summary.comments);
      if (state.expandedPostId === post.id) {
        renderPosts();
      }
    });
    if (typeof unsubscribe === "function") {
      state.likeUnsubscribers.set(post.id, unsubscribe);
    }
  });
};

const syncExpandedCommentsWatcher = () => {
  const postId = state.expandedPostId || "";
  if (postId && state.likeUnsubscribers.has(postId)) return;
  if (!repository || state.activeCommentsArticleId === postId) return;
  if (typeof state.activeCommentsUnsubscribe === "function") {
    state.activeCommentsUnsubscribe();
  }
  state.activeCommentsArticleId = "";
  state.activeCommentsUnsubscribe = null;
  if (!postId) return;
  const post = getAllPosts().find((item) => item.id === postId);
  if (!post || post.isTemplate) return;
  state.activeCommentsArticleId = postId;
  state.activeCommentsUnsubscribe = repository.watchArticleComments?.(postId, (comments = []) => {
    state.commentsByPost.set(postId, comments);
    mergeSocialSummary(postId, { commentCount: comments.length });
    renderPosts();
  });
};

const syncCommentLikeWatchers = () => {
  if (!repository || !state.expandedPostId) {
    state.commentLikeUnsubscribers.forEach((unsubscribe) => unsubscribe?.());
    state.commentLikeUnsubscribers.clear();
    state.commentLikeSummaries.clear();
    return;
  }
  const postId = state.expandedPostId;
  const comments = getPostComments(postId);
  const activeKeys = new Set(comments.map((comment) => commentLikeKey(postId, comment.id)));
  state.commentLikeUnsubscribers.forEach((unsubscribe, key) => {
    if (!activeKeys.has(key)) {
      unsubscribe?.();
      state.commentLikeUnsubscribers.delete(key);
      state.commentLikeSummaries.delete(key);
    }
  });
  comments.forEach((comment) => {
    const key = commentLikeKey(postId, comment.id);
    if (state.commentLikeUnsubscribers.has(key)) return;
    const unsubscribe = repository.watchCommentLikes?.(postId, comment.id, (summary) => {
      state.commentLikeSummaries.set(key, summary);
      const commentNode = $(`.bitacora-post[data-post-id="${escapeSelector(postId)}"] .bitacora-comment[data-comment-id="${escapeSelector(comment.id)}"]`);
      const button = commentNode?.querySelector("[data-bitacora-action='toggle-comment-like']");
      const count = commentNode?.querySelector("[data-bitacora-comment-like-count]");
      const tooltip = button?.querySelector(".bitacora-social-tooltip");
      const liked = Boolean(summary.likedByCurrentUser);
      button?.classList.toggle("is-active", liked);
      button?.setAttribute("aria-pressed", liked ? "true" : "false");
      button?.setAttribute("aria-label", buildLikeAriaLabel({ liked, count: summary.count || 0, target: "este comentario" }));
      if (count) count.textContent = String(summary.count || 0);
      if (tooltip) tooltip.textContent = getSocialTooltipText(summary.likes || []);
    });
    if (typeof unsubscribe === "function") {
      state.commentLikeUnsubscribers.set(key, unsubscribe);
    }
  });
};

const renderPosts = () => {
  if (!els.posts) return;
  const filtered = sortPosts(getAllPosts().filter(matchesFilters));
  els.posts.innerHTML = filtered
    .map((post, index) => `${renderPost(post)}${index < filtered.length - 1 ? renderPostSeparator(index) : ""}`)
    .join("");
  if (els.empty) els.empty.hidden = filtered.length > 0;
  updateResultCount(state.userArticles.length);
  updatePersistenceNote();
  syncSocialWatchers(filtered);
  filtered.forEach((post) => updatePostSocialDom(post.id));
  syncExpandedCommentsWatcher();
  syncCommentLikeWatchers();
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
  if (trigger?.hasAttribute?.("aria-expanded")) {
    trigger.setAttribute("aria-expanded", "true");
  }
  document.body.classList.add("bitacora-modal-open");
  window.requestAnimationFrame(() => {
    const focusTarget = getFocusable(modal)[0] || $(".bitacora-modal__dialog", modal);
    focusTarget?.focus();
  });
};

const closeModal = (modal = state.activeModal) => {
  if (!modal) return;
  if (modal === els.methodologyGuideModal) {
    closeMethodologyTermPopover({ restoreFocus: false });
  }
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("bitacora-modal-open");
  const trigger = state.activeModalTrigger;
  state.activeModal = null;
  state.activeModalTrigger = null;
  if (trigger?.hasAttribute?.("aria-expanded")) {
    trigger.setAttribute("aria-expanded", "false");
  }
  if (trigger && typeof trigger.focus === "function") {
    trigger.focus({ preventScroll: true });
  }
};

const handleModalKeydown = (event) => {
  const modal = state.activeModal;
  if (!modal) return;
  if (event.key === "Escape") {
    event.preventDefault();
    if (modal === els.methodologyGuideModal && isMethodologyTermPopoverOpen()) {
      closeMethodologyTermPopover();
      return;
    }
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
    fileSize: 0,
    documentContentType: "",
    contentHash: "",
    pageCount: 0,
    methodologyProfile: null,
    expandedDescriptionSections: [],
    expandedDescriptionQuality: "insufficient",
    expandedDescriptionText: "",
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

const setAiProcessingOverlay = (visible) => {
  if (!els.articleAiProcessingOverlay) return;
  els.articleAiProcessingOverlay.hidden = !visible;
  els.articleAiProcessingOverlay.setAttribute("aria-busy", visible ? "true" : "false");
  els.addArticleForm?.classList.toggle("is-ai-processing", visible);
  [els.analyzePdfButton, els.analyzeTextButton].filter(Boolean).forEach((button) => {
    button.disabled = visible;
    button.setAttribute("aria-busy", visible ? "true" : "false");
  });
  if (visible && window.lucide) window.lucide.createIcons();
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

const setPreviewVisible = (visible) => {
  if (!els.previewZone) return;
  els.previewZone.hidden = !visible;
};

const setAdvancedVisible = (visible) => {
  if (!els.advancedZone) return;
  els.advancedZone.hidden = !visible;
  if (els.advancedToggle) {
    els.advancedToggle.setAttribute("aria-expanded", visible ? "true" : "false");
    els.advancedToggle.textContent = visible ? "Ocultar detalles avanzados" : "Editar detalles avanzados";
  }
};

const countWords = (value = "") =>
  cleanUserText(value)
    .split(/\s+/)
    .filter(Boolean).length;

const getArticleExpandedDescriptionText = (article = {}) =>
  cleanUserText(
    article.expandedDescriptionEs ||
      article.executiveSummaryEs ||
      article.executiveSummary ||
      expandedDescriptionSectionsToText(article.expandedDescriptionSections)
  );

const getExtractionRequestId = (result = {}) =>
  cleanUserText(result.rawEvidence?.requestId || result.requestId || result.article?.requestId || "");

const buildExtractionQualitySummary = (result = {}, extractionStatus = "manual", source = "manual") => {
  const article = result.article || {};
  const sections = normalizeExpandedDescriptionSections(article.expandedDescriptionSections);
  const expandedText = getArticleExpandedDescriptionText(article);
  const wordCount = Number(result.rawEvidence?.expandedDescriptionWordCount) || countWords(expandedText);
  const sectionCount = Number(result.rawEvidence?.expandedDescriptionSectionCount) || sections.length;
  const fileName = cleanUserText(result.rawEvidence?.originalFileName || state.articleDraftMeta.originalFileName);
  const statusLabel =
    extractionStatus === "ai_draft"
      ? "Borrador automático"
      : extractionStatus === "metadata_only"
        ? "Ficha preliminar"
        : "Revisión manual";
  const sourceLabel =
    source === "pdf"
      ? "PDF"
      : source === "pasted_text"
        ? "Texto pegado"
        : "IA documental";
  return {
    statusLabel,
    sourceLabel,
    fileName,
    wordCount,
    sectionCount,
    quality: normalizeExpandedDescriptionQuality(article.expandedDescriptionQuality),
    requestId: getExtractionRequestId(result)
  };
};

const renderPreviewAiSummary = (result = {}, extractionStatus = "manual", source = "manual") => {
  if (!els.previewAiSummary) return;
  const summary = buildExtractionQualitySummary(result, extractionStatus, source);
  const chips = [
    summary.statusLabel,
    summary.sourceLabel,
    summary.quality === "complete"
      ? "Calidad completa"
      : summary.quality === "partial"
        ? "Revisión editorial"
        : "Descripción insuficiente",
    summary.wordCount ? `${summary.wordCount} palabras` : "",
    summary.sectionCount ? `${summary.sectionCount} secciones` : "",
    summary.fileName ? summary.fileName : "",
    summary.requestId ? `ID ${summary.requestId}` : ""
  ].filter(Boolean);
  els.previewAiSummary.hidden = !chips.length;
  els.previewAiSummary.innerHTML = chips
    .map((chip) => `<span class="bitacora-preview-ai-summary__chip">${escapeHtml(chip)}</span>`)
    .join("");
};

const resetPreviewExpandedDescription = () => {
  if (els.previewExpandedDescription) els.previewExpandedDescription.hidden = true;
  if (els.previewExpandedBody) {
    els.previewExpandedBody.hidden = true;
    els.previewExpandedBody.innerHTML = "";
  }
  if (els.previewExpandedToggle) {
    els.previewExpandedToggle.setAttribute("aria-expanded", "false");
    const label = els.previewExpandedToggle.querySelector("[data-preview-expanded-label]");
    if (label) label.textContent = "Ver descripción";
    const icon = els.previewExpandedToggle.querySelector("[data-lucide]");
    if (icon) icon.setAttribute("data-lucide", "chevron-down");
  }
};

const renderPreviewExpandedDescription = (article = {}) => {
  resetPreviewExpandedDescription();
  if (!els.previewExpandedDescription || !els.previewExpandedBody) return;
  const sections = normalizeExpandedDescriptionSections(article.expandedDescriptionSections);
  const text = getArticleExpandedDescriptionText(article);
  if (!sections.length && !text) return;
  const content = sections.length
    ? sections
        .map(
          (section) => `
            <article class="bitacora-preview-expanded-description__section">
              <h4>${escapeHtml(section.heading)}</h4>
              <p>${escapeHtml(section.body)}</p>
            </article>
          `
        )
        .join("")
    : splitExpandedDescriptionParagraphs(text)
        .map((paragraph) => `<p class="bitacora-preview-expanded-description__paragraph">${escapeHtml(paragraph)}</p>`)
        .join("");
  if (!content) return;
  els.previewExpandedBody.innerHTML = content;
  els.previewExpandedDescription.hidden = false;
  if (window.lucide) window.lucide.createIcons();
};

const togglePreviewExpandedDescription = () => {
  if (!els.previewExpandedToggle || !els.previewExpandedBody) return;
  const isOpen = els.previewExpandedToggle.getAttribute("aria-expanded") === "true";
  els.previewExpandedToggle.setAttribute("aria-expanded", isOpen ? "false" : "true");
  els.previewExpandedBody.hidden = isOpen;
  const label = els.previewExpandedToggle.querySelector("[data-preview-expanded-label]");
  if (label) label.textContent = isOpen ? "Ver descripción" : "Ocultar descripción";
  const icon = els.previewExpandedToggle.querySelector("[data-lucide]");
  if (icon) icon.setAttribute("data-lucide", isOpen ? "chevron-down" : "chevron-up");
  if (window.lucide) window.lucide.createIcons();
};

const scrollPreviewIntoView = () => {
  if (!els.previewZone) return;
  window.requestAnimationFrame(() => {
    els.previewZone?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
};

const verifyArticleFieldsAfterExtraction = (article = {}, result = {}) => {
  const checks = [
    { label: "título", expected: article.title, selector: "#article-title" },
    { label: "fuente", expected: article.sourceName || article.journal, selector: "#article-source-name" },
    { label: "descripción breve", expected: article.briefDescriptionEs || article.cardSummaryEs, selector: "#article-card-summary" },
    { label: "objetivo", expected: article.objectiveEs || article.clinicalQuestionEs || article.clinicalQuestion, selector: "#article-clinical-question" },
    { label: "puntos clave", expected: (article.keyPointsEs || []).join("\n"), selector: "#article-key-points" },
    { label: "descripción ampliada", expected: getArticleExpandedDescriptionText(article), selector: "#article-executive-summary" }
  ];
  const missing = checks
    .filter((check) => cleanUserText(check.expected))
    .filter((check) => !cleanUserText($(check.selector)?.value))
    .map((check) => check.label);
  if (!missing.length) {
    setArticleError(els.articleFormError, "");
    return true;
  }
  const requestId = getExtractionRequestId(result);
  setArticleError(
    els.articleFormError,
    `La IA respondió, pero no se cargaron estos campos en el formulario: ${missing.join(", ")}.${
      requestId ? ` ID técnico: ${requestId}.` : ""
    }`
  );
  return false;
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
  if (target === "manual") {
    setPreviewVisible(true);
    setAdvancedVisible(true);
  }
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

const setArticleModalMode = (mode = "create") => {
  const editing = mode === "edit";
  state.articleModalMode = editing ? "edit" : "create";
  els.addArticleModal?.classList.toggle("is-editing", editing);
  if (els.addArticleTitle) {
    els.addArticleTitle.textContent = editing ? "Editar artículo científico" : "Agregar artículo científico";
  }
  if (els.addArticleSubtitle) {
    els.addArticleSubtitle.textContent = editing
      ? "Actualizá la ficha editorial. Los datos de carga y el PDF asociado se conservan sin cambios."
      : "Cargá un PDF o pegá el texto del documento. La IA generará una ficha en español para revisión antes de guardar.";
  }
  if (els.articleDocumentTabs) els.articleDocumentTabs.hidden = editing;
  els.articlePanels.forEach((panel) => {
    if (editing) panel.hidden = true;
  });
  if (els.articleAiStatus) els.articleAiStatus.hidden = editing;
  if (els.articleAiWarnings) els.articleAiWarnings.hidden = true;
  if (els.assistedZone) els.assistedZone.hidden = true;
  if (els.articleDraftSaveButton) els.articleDraftSaveButton.hidden = editing;
  if (els.articlePrimarySaveButton) {
    els.articlePrimarySaveButton.textContent = editing ? "Guardar cambios" : "Guardar artículo";
    els.articlePrimarySaveButton.dataset.saveStatus = editing ? "edit" : "pending_review";
  }
};

const resetArticleForm = () => {
  els.addArticleForm?.reset();
  resetArticleDraftMeta();
  state.editingArticleId = "";
  state.editingArticleSnapshot = null;
  setArticleModalMode("create");
  setArticleError(els.articleUrlError, "");
  setArticleError(els.articleFormError, "");
  if (els.articleAiStatus) els.articleAiStatus.hidden = false;
  setAiStatus("");
  setAiWarnings([]);
  setAiProcessingOverlay(false);
  setAssistedModeVisible(false);
  setPreviewVisible(false);
  if (els.previewAiSummary) {
    els.previewAiSummary.hidden = true;
    els.previewAiSummary.innerHTML = "";
  }
  resetPreviewExpandedDescription();
  setAdvancedVisible(false);
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

const populateArticleFormForEdit = (post) => {
  if (!post) return;
  resetArticleForm();
  state.editingArticleId = post.id;
  state.editingArticleSnapshot = post;
  state.articleDraftMeta = {
    extractionStatus: post.extractionStatus || "manual",
    extractionSource: post.extractionSource || "manual",
    extractionConfidence: post.extractionConfidence ?? null,
    extractionWarnings: post.extractionWarnings || [],
    sourceDomain: post.sourceDomain || "",
    doi: post.doi || "",
    pmid: post.pmid || "",
    pmcid: post.pmcid || "",
    nctId: post.nctId || "",
    pii: post.pii || "",
    originalFileName: post.originalFileName || "",
    storagePath: post.storagePath || "",
    fileSize: post.fileSize || 0,
    documentContentType: post.documentContentType || "",
    contentHash: post.contentHash || "",
    pageCount: post.pageCount || 0,
    methodologyProfile: post.methodologyProfile || null,
    expandedDescriptionSections: normalizeExpandedDescriptionSections(post.expandedDescriptionSections),
    expandedDescriptionQuality: normalizeExpandedDescriptionQuality(post.expandedDescriptionQuality),
    expandedDescriptionText: post.expandedDescriptionEs || post.executiveSummaryEs || post.executiveSummary || "",
    sourcePages: post.sourcePages || [],
    rawEvidence: null
  };
  fillArticleFromExtraction(post, null);
  setFieldValue("article-user-comment", post.userComment || "");
  setFieldValue("article-access-type", post.accessType || "Pendiente");
  setPreviewVisible(true);
  setAdvancedVisible(false);
  setArticleModalMode("edit");
};

const openEditArticleModal = (postId, trigger) => {
  const post = getAllPosts().find((item) => item.id === postId);
  if (!post || !canManageArticle(post)) return;
  populateArticleFormForEdit(post);
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
    $("#article-brief-description")?.value,
    $("#article-expanded-description")?.value,
    $("#article-card-summary")?.value,
    $("#article-clinical-question")?.value,
    $("#article-main-result")?.value,
    $("#article-study-design")?.value,
    $("#article-study-context")?.value,
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

  const officialUrl = $("#article-official-url")?.value || els.pdfOfficialUrl?.value || els.pastedUrl?.value || urlValidation.href;
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
  if (!($("#article-brief-description")?.value || $("#article-card-summary")?.value || $("#article-expanded-description")?.value || $("#article-executive-summary")?.value || "").trim()) {
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
  const objective = article.objectiveEs || article.clinicalQuestionEs || article.clinicalQuestion || "";
  const mainMessage = article.mainMessageEs || article.mainResultEs || article.mainResult || "";
  const studyDesign = article.studyDesignEs || article.methodologyEs || article.studyType || "";
  const profile = article.methodologyProfile || {};
  const doiUrl = article.doi ? `https://doi.org/${String(article.doi).replace(/^https?:\/\/doi\.org\//i, "")}` : "";
  const fieldMap = {
    "article-title": article.title,
    "article-source-name": sourceName,
    "article-journal": article.journal,
    "article-authors": (article.authors || []).join(", "),
    "article-official-url": article.officialUrl || doiUrl,
    "article-doi": article.doi,
    "article-type": article.articleType,
    "article-study-type": article.studyType || studyDesign,
    "article-evidence-type": article.evidenceType,
    "article-publication-date": article.publicationDate,
    "article-original-language": article.originalLanguage,
    "article-study-location": article.studyLocation || article.studyLocationEs,
    "article-brief-description": article.briefDescriptionEs || article.cardSummaryEs,
    "article-expanded-description": article.expandedDescriptionEs || article.executiveSummaryEs || article.executiveSummary,
    "article-card-summary": article.cardSummaryEs || article.briefDescriptionEs,
    "article-executive-summary": article.executiveSummaryEs || article.expandedDescriptionEs || article.executiveSummary,
    "article-abstract-summary": article.abstractSummaryEs,
    "article-clinical-question": objective,
    "article-study-design": studyDesign,
    "article-study-context": article.studyContextEs,
    "article-main-result": mainMessage,
    "article-methodology": studyDesign,
    "article-key-points": (article.keyPointsEs || []).join("\n"),
    "article-study-population": article.studyPopulationEs,
    "article-study-location-es": article.studyLocationEs || article.studyLocation,
    "article-study-period": article.studyPeriodEs,
    "article-limitations": article.limitationsEs,
    "article-local-applicability": article.localApplicabilityEs,
    "article-occupational-relevance": article.occupationalHealthRelevanceEs,
    "article-methodology-family": profile.studyFamily,
    "article-methodology-family-es": profile.studyFamilyEs,
    "article-methodology-specific-design": profile.specificDesign || studyDesign,
    "article-methodology-design-category": profile.designCategoryEs || studyDesign,
    "article-methodology-temporal-direction": profile.temporalDirection,
    "article-methodology-center-scope": profile.centerScope,
    "article-methodology-is-multicenter": profile.isMulticenter ? "true" : "false",
    "article-methodology-multicenter-rationale": profile.multicenterRationale,
    "article-methodology-setting": profile.setting,
    "article-methodology-country-region": profile.countryOrRegion || article.studyLocationEs || article.studyLocation,
    "article-methodology-countries": (profile.countriesIncluded || []).join(", "),
    "article-methodology-institutions": (profile.institutions || []).join(", "),
    "article-methodology-population": profile.studyPopulation || article.studyPopulationEs,
    "article-methodology-sample-size": profile.sampleSize,
    "article-methodology-sample-description": profile.sampleDescription,
    "article-methodology-study-period": profile.studyPeriod || article.studyPeriodEs,
    "article-methodology-study-duration": profile.studyDuration,
    "article-methodology-recruitment-period": profile.recruitmentPeriod,
    "article-methodology-follow-up-duration": profile.followUpDuration,
    "article-methodology-data-source": profile.dataSource,
    "article-methodology-intervention": profile.interventionOrExposure,
    "article-methodology-comparator": profile.comparator,
    "article-methodology-primary-outcome": profile.primaryOutcome,
    "article-methodology-secondary-outcomes": (profile.secondaryOutcomes || []).join("\n"),
    "article-methodology-statistical-approach": profile.statisticalApproach,
    "article-methodology-effect-measures": (profile.effectMeasures || []).join(", "),
    "article-methodology-reporting-guideline": profile.reportingGuideline,
    "article-methodology-strengths": (profile.methodologicalStrengths || []).join("\n"),
    "article-methodology-limitations": (profile.methodologicalLimitations || []).join("\n"),
    "article-methodology-applicability": (profile.applicabilityNotes || []).join("\n"),
    "article-methodology-rationale": profile.classificationRationale,
    "article-methodology-classification-confidence": profile.classificationConfidence,
    "article-methodology-warnings": (profile.methodologyWarnings || []).join("\n"),
    "article-tags": (article.tags || []).join(", "),
    "article-access-type": article.accessType
  };

  Object.entries(fieldMap).forEach(([id, value]) => {
    if (value) setFieldValue(id, value);
  });

  if (Object.values(fieldMap).some((value) => (Array.isArray(value) ? value.length : String(value || "").trim()))) {
    setPreviewVisible(true);
    setAdvancedVisible(false);
  }

  state.articleDraftMeta.sourceDomain = article.sourceDomain || state.articleDraftMeta.sourceDomain;
  state.articleDraftMeta.doi = article.doi || state.articleDraftMeta.doi;
  state.articleDraftMeta.pmid = article.pmid || state.articleDraftMeta.pmid;
  state.articleDraftMeta.pmcid = article.pmcid || state.articleDraftMeta.pmcid;
  state.articleDraftMeta.nctId = article.nctId || state.articleDraftMeta.nctId;
  state.articleDraftMeta.pii = article.pii || state.articleDraftMeta.pii;
  state.articleDraftMeta.extractionConfidence = article.extractionConfidence ?? null;
  state.articleDraftMeta.extractionWarnings = article.warnings || [];
  state.articleDraftMeta.methodologyProfile = article.methodologyProfile || state.articleDraftMeta.methodologyProfile;
  state.articleDraftMeta.expandedDescriptionSections = normalizeExpandedDescriptionSections(article.expandedDescriptionSections);
  state.articleDraftMeta.expandedDescriptionQuality = normalizeExpandedDescriptionQuality(article.expandedDescriptionQuality);
  state.articleDraftMeta.expandedDescriptionText = article.expandedDescriptionEs || article.executiveSummaryEs || article.executiveSummary || "";
  state.articleDraftMeta.contentHash = rawEvidence?.contentHash || state.articleDraftMeta.contentHash;
  state.articleDraftMeta.pageCount = rawEvidence?.pageCount || state.articleDraftMeta.pageCount;
  state.articleDraftMeta.fileSize = rawEvidence?.fileSize || state.articleDraftMeta.fileSize;
  state.articleDraftMeta.documentContentType = rawEvidence?.documentContentType || state.articleDraftMeta.documentContentType;
  state.articleDraftMeta.sourcePages = article.sourcePages || state.articleDraftMeta.sourcePages || [];
  state.articleDraftMeta.rawEvidence = rawEvidence || state.articleDraftMeta.rawEvidence;
  renderPreviewExpandedDescription(article);
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

const handleDocumentFileSelected = (file) => {
  const error = validatePdfFile(file);
  if (error) {
    setArticleError(els.articleFormError, error);
    return false;
  }
  state.selectedPdfFile = file;
  state.articleDraftMeta.fileSize = file.size || 0;
  state.articleDraftMeta.documentContentType = file.type || "application/pdf";
  setArticleError(els.articleFormError, "");
  if (els.pdfFile) els.pdfFile.hidden = false;
  if (els.pdfName) els.pdfName.textContent = file.name;
  if (els.pdfSize) els.pdfSize.textContent = formatFileSize(file.size);
  return true;
};

const clearSelectedPdfFile = () => {
  state.selectedPdfFile = null;
  state.articleDraftMeta.fileSize = 0;
  state.articleDraftMeta.documentContentType = "";
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

const hasUsefulExtractedArticle = (article = {}) => {
  const hasTitle = Boolean(String(article.title || "").trim());
  const hasSource = Boolean(String(article.sourceName || article.journal || "").trim());
  const hasDescription = Boolean(
    String(
      article.briefDescriptionEs ||
        article.cardSummaryEs ||
        article.expandedDescriptionEs ||
        article.executiveSummaryEs ||
        article.objectiveEs ||
        article.mainMessageEs ||
        ""
    ).trim()
  );
  const hasMetadata = Boolean(article.doi || article.publicationDate || hasSource);
  return {
    aiDraft: hasTitle && hasSource && hasDescription,
    metadataOnly: hasTitle || hasMetadata
  };
};

const applyDocumentExtractionResult = (result, source) => {
  const article = result.article || {};
  const usefulness = hasUsefulExtractedArticle(article);
  let extractionStatus = result.extractionStatus || "manual";
  if (extractionStatus === "failed" && usefulness.aiDraft) {
    extractionStatus = "ai_draft";
  } else if (extractionStatus === "failed" && usefulness.metadataOnly) {
    extractionStatus = "metadata_only";
  }
  fillArticleFromExtraction(article, result.rawEvidence || null);
  state.articleDraftMeta.extractionStatus = extractionStatus;
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
  if (result.rawEvidence?.fileSize) {
    state.articleDraftMeta.fileSize = result.rawEvidence.fileSize;
  }
  if (result.rawEvidence?.documentContentType) {
    state.articleDraftMeta.documentContentType = result.rawEvidence.documentContentType;
  }
  if (extractionStatus === "ai_draft") {
    const summary = buildExtractionQualitySummary({ ...result, article }, extractionStatus, source);
    const qualityText = [
      summary.wordCount ? `${summary.wordCount} palabras` : "",
      summary.sectionCount ? `${summary.sectionCount} secciones` : ""
    ]
      .filter(Boolean)
      .join(", ");
    setAiStatus(
      result.message ||
        `Ficha generada por IA${qualityText ? ` con descripción ampliada de ${qualityText}` : ""}. Revisá la información antes de guardar.`
    );
  } else if (extractionStatus === "metadata_only") {
    const summary = buildExtractionQualitySummary({ ...result, article }, extractionStatus, source);
    setAiStatus(
      result.message ||
        `Se cargó una ficha preliminar${
          summary.wordCount ? ` con ${summary.wordCount} palabras de descripción ampliada` : ""
        }. Revisá y completá la información antes de guardar.`
    );
  } else if (extractionStatus === "not_configured") {
    setAiStatus(result.error || "El servicio de IA no está configurado en backend.");
  } else {
    setAiStatus(result.error || "No se pudo analizar el documento. Podés completar la publicación manualmente.");
  }
  if (extractionStatus === "ai_draft" || extractionStatus === "metadata_only") {
    renderPreviewAiSummary({ ...result, article }, extractionStatus, source);
    renderPreviewExpandedDescription(article);
    verifyArticleFieldsAfterExtraction(article, result);
    scrollPreviewIntoView();
  } else {
    renderPreviewAiSummary({ ...result, article }, extractionStatus, source);
    renderPreviewExpandedDescription(article);
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
  setAiProcessingOverlay(true);
  try {
    setAiStatus("Subiendo PDF…");
    const storagePath = await uploadSelectedPdf();
    state.articleDraftMeta.storagePath = storagePath;
    state.articleDraftMeta.originalFileName = state.selectedPdfFile.name;
    state.articleDraftMeta.fileSize = state.selectedPdfFile.size || 0;
    state.articleDraftMeta.documentContentType = state.selectedPdfFile.type || "application/pdf";
    state.articleDraftMeta.extractionSource = "pdf";
    setAiStatus("Analizando documento con IA. Puede tardar hasta 3 minutos…");
    const result = await requestArticleDocumentExtraction(
      {
        mode: "pdf",
        storagePath,
        originalFileName: state.selectedPdfFile.name,
        officialUrl: $("#article-official-url")?.value || els.pdfOfficialUrl?.value || els.articleUrl?.value || ""
      },
      { auth }
    );
    setAiStatus("Generando ficha en español…");
    applyDocumentExtractionResult(result, "pdf");
  } catch (error) {
    setAiStatus(error?.message || "No se pudo analizar el documento. Podés completar la publicación manualmente.");
  } finally {
    setDocumentAnalyzeBusy(els.analyzePdfButton, false, "Analizar PDF con IA");
    setAiProcessingOverlay(false);
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
  setAiProcessingOverlay(true);
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
    setAiProcessingOverlay(false);
  }
};

const handlePdfDrop = (event) => {
  event.preventDefault();
  els.pdfDropzone?.classList.remove("is-dragover");
  const file = event.dataTransfer?.files?.[0] || null;
  if (file) handleDocumentFileSelected(file);
};

const getDocumentOpenErrorMessage = (error) => {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("unauthorized")) return "No tenés permisos para abrir este documento.";
  if (code.includes("object-not-found")) return "El documento no está disponible en el almacenamiento.";
  if (code.includes("canceled") || code.includes("retry-limit") || code.includes("unknown")) {
    return "No se pudo abrir el documento por un problema de conexión.";
  }
  return "No se pudo abrir el documento. Intentá nuevamente.";
};

const openArticleDocument = async (postId, button) => {
  const post = getAllPosts().find((item) => item.id === postId);
  const documentUrl = getArticleDocumentUrl(post);
  const documentPath = getArticleDocumentPath(post);
  if (!post || (!documentUrl && !documentPath)) {
    showBitacoraNotice("Esta publicación no tiene un documento asociado.", "warning");
    return;
  }
  setActionBusy(button, true, "Abriendo...");
  try {
    const url = documentUrl || (storage && documentPath ? await getDownloadURL(storageRef(storage, documentPath)) : "");
    if (!url) {
      showBitacoraNotice("No se pudo abrir el documento. Intentá nuevamente.", "error");
      return;
    }
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      showBitacoraNotice("El navegador bloqueó la apertura del documento. Permití ventanas emergentes para verlo.", "warning");
    }
  } catch (error) {
    console.warn("[Bitácora] No se pudo abrir el documento.", {
      code: error?.code || "",
      articleId: postId,
      hasStoragePath: Boolean(documentPath),
      hasDocumentUrl: Boolean(documentUrl)
    });
    showBitacoraNotice(getDocumentOpenErrorMessage(error), "error");
  } finally {
    setActionBusy(button, false);
  }
};

const handleToggleLike = async (postId, button) => {
  if (!repository || !state.currentUser) return;
  if (button) button.disabled = true;
  try {
    await repository.toggleArticleLike(postId, state.currentUser);
  } catch (error) {
    showArticleActionError("No se pudo actualizar el me gusta. Verificá la sesión o la conexión.");
  } finally {
    if (button) button.disabled = false;
  }
};

const handleToggleCommentLike = async (postId, commentId, button) => {
  if (!repository || !state.currentUser || !postId || !commentId) return;
  if (button) button.disabled = true;
  try {
    await repository.toggleCommentLike(postId, commentId, state.currentUser);
  } catch (error) {
    showArticleActionError("No se pudo actualizar el me gusta del comentario. Verificá la sesión o la conexión.");
  } finally {
    if (button) button.disabled = false;
  }
};

const focusCommentsForPost = (postId) => {
  if (state.expandedPostId !== postId) {
    state.expandedPostId = postId;
    renderPosts();
  }
  window.requestAnimationFrame(() => {
    const card = $(`.bitacora-post[data-post-id="${escapeSelector(postId)}"]`);
    card?.querySelector("[data-bitacora-comment-text]")?.focus({ preventScroll: false });
  });
};

const handleCommentSubmit = async (event) => {
  const form = event.target.closest("[data-bitacora-comment-form]");
  if (!form) return;
  event.preventDefault();
  const card = form.closest(".bitacora-post");
  const postId = card?.dataset?.postId || "";
  const textarea = form.querySelector("[data-bitacora-comment-text]");
  const text = cleanUserText(textarea?.value || "");
  if (!postId || !text || !repository) return;
  const button = form.querySelector("button[type='submit']");
  setActionBusy(button, true, "Comentando...");
  try {
    await repository.addArticleComment(postId, text, state.currentUser);
    if (textarea) textarea.value = "";
  } catch (error) {
    showArticleActionError("No se pudo guardar el comentario. Usá texto simple de hasta 1000 caracteres.");
  } finally {
    setActionBusy(button, false);
  }
};

const handleCommentEditSubmit = async (event) => {
  const form = event.target.closest("[data-bitacora-comment-edit-form]");
  if (!form) return;
  event.preventDefault();
  const card = form.closest(".bitacora-post");
  const commentNode = form.closest(".bitacora-comment");
  const postId = card?.dataset?.postId || "";
  const commentId = commentNode?.dataset?.commentId || "";
  const textarea = form.querySelector("[data-bitacora-comment-edit-text]");
  const text = cleanUserText(textarea?.value || "");
  if (!postId || !commentId || !text || !repository) return;
  const button = form.querySelector("button[type='submit']");
  setActionBusy(button, true, "Guardando...");
  try {
    await repository.updateArticleComment(postId, commentId, text, state.currentUser);
    state.editingCommentId = "";
  } catch (error) {
    showArticleActionError("No se pudo editar el comentario. Usá texto simple de hasta 1000 caracteres.");
  } finally {
    setActionBusy(button, false);
  }
};

const handleDeleteComment = async (postId, commentId, button) => {
  if (!postId || !commentId || !repository) return;
  const confirmed = window.confirm("Eliminar comentario\n\nEsta acción eliminará el comentario.");
  if (!confirmed) return;
  if (button) button.disabled = true;
  try {
    await repository.deleteArticleComment(postId, commentId, state.currentUser);
  } catch (error) {
    showArticleActionError("No se pudo eliminar el comentario. Verificá permisos o conexión.");
  } finally {
    if (button) button.disabled = false;
  }
};

const buildMethodologyProfileFromForm = ({ studyDesign = "", studyLocationEs = "" } = {}) => {
  const existingProfile =
    state.articleDraftMeta.methodologyProfile ||
    state.editingArticleSnapshot?.methodologyProfile ||
    {};
  return {
    studyFamily: $("#article-methodology-family")?.value || "",
    studyFamilyEs: $("#article-methodology-family-es")?.value || "",
    specificDesign: $("#article-methodology-specific-design")?.value || studyDesign,
    designCategoryEs: $("#article-methodology-design-category")?.value || studyDesign,
    temporalDirection: $("#article-methodology-temporal-direction")?.value || "",
    centerScope: $("#article-methodology-center-scope")?.value || "",
    isMulticenter: $("#article-methodology-is-multicenter")?.value === "true",
    multicenterRationale: $("#article-methodology-multicenter-rationale")?.value || "",
    setting: $("#article-methodology-setting")?.value || "",
    countryOrRegion: $("#article-methodology-country-region")?.value || studyLocationEs,
    countriesIncluded: splitTags($("#article-methodology-countries")?.value || ""),
    institutions: splitTags($("#article-methodology-institutions")?.value || ""),
    studyPopulation: $("#article-methodology-population")?.value || $("#article-study-population")?.value || "",
    sampleSize: $("#article-methodology-sample-size")?.value || "",
    sampleDescription: $("#article-methodology-sample-description")?.value || "",
    studyPeriod: $("#article-methodology-study-period")?.value || $("#article-study-period")?.value || "",
    studyDuration: $("#article-methodology-study-duration")?.value || "",
    recruitmentPeriod: $("#article-methodology-recruitment-period")?.value || "",
    followUpDuration: $("#article-methodology-follow-up-duration")?.value || "",
    dataSource: $("#article-methodology-data-source")?.value || "",
    interventionOrExposure: $("#article-methodology-intervention")?.value || "",
    comparator: $("#article-methodology-comparator")?.value || "",
    primaryOutcome: $("#article-methodology-primary-outcome")?.value || "",
    secondaryOutcomes: splitLines($("#article-methodology-secondary-outcomes")?.value || ""),
    statisticalApproach: $("#article-methodology-statistical-approach")?.value || "",
    effectMeasures: splitTags($("#article-methodology-effect-measures")?.value || ""),
    reportingGuideline: $("#article-methodology-reporting-guideline")?.value || "",
    methodologicalStrengths: splitLines($("#article-methodology-strengths")?.value || ""),
    methodologicalLimitations: splitLines($("#article-methodology-limitations")?.value || ""),
    applicabilityNotes: splitLines($("#article-methodology-applicability")?.value || ""),
    classificationRationale: $("#article-methodology-rationale")?.value || "",
    classificationConfidence: $("#article-methodology-classification-confidence")?.value || "",
    evidenceSupport: existingProfile.evidenceSupport || {},
    methodologyWarnings: splitLines($("#article-methodology-warnings")?.value || "")
  };
};

const buildArticlePayload = (status) => {
  const officialUrl = (
    $("#article-official-url")?.value ||
    els.pdfOfficialUrl?.value ||
    els.pastedUrl?.value ||
    els.articleUrl?.value ||
    ""
  ).trim();
  const urlInfo = validateOptionalArticleUrl(officialUrl);
  const sourceDomain = urlInfo.ok
    ? urlInfo.domain
    : state.articleDraftMeta.sourceDomain || validateOptionalArticleUrl(els.articleUrl?.value || "").domain || "";
  const sourceName =
    ($("#article-source-name")?.value || $("#article-journal")?.value || "").trim() ||
    (sourceDomain ? inferSourceNameFromDomain(sourceDomain) : "");
  const objective = $("#article-clinical-question")?.value || "";
  const mainMessage = $("#article-main-result")?.value || "";
  const studyDesign = $("#article-study-design")?.value || $("#article-methodology")?.value || "";
  const studyLocationEs = $("#article-study-location-es")?.value || $("#article-study-location")?.value || "";
  const briefDescriptionEs = $("#article-brief-description")?.value || $("#article-card-summary")?.value || "";
  const expandedDescriptionEs = $("#article-expanded-description")?.value || $("#article-executive-summary")?.value || "";
  const generatedExpandedSections = normalizeExpandedDescriptionSections(state.articleDraftMeta.expandedDescriptionSections);
  const expandedDescriptionWasEdited =
    cleanUserText(expandedDescriptionEs) !== cleanUserText(state.articleDraftMeta.expandedDescriptionText || "");
  const expandedDescriptionSections = expandedDescriptionWasEdited ? [] : generatedExpandedSections;

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
    studyType: $("#article-study-type")?.value || studyDesign,
    evidenceType: $("#article-evidence-type")?.value || "",
    publicationDate: $("#article-publication-date")?.value || "",
    originalLanguage: $("#article-original-language")?.value || "",
    studyLocation: studyLocationEs,
    studyDesignEs: studyDesign,
    studyContextEs: $("#article-study-context")?.value || "",
    studyPopulationEs: $("#article-study-population")?.value || "",
    studyLocationEs,
    studyPeriodEs: $("#article-study-period")?.value || "",
    briefDescriptionEs,
    expandedDescriptionEs,
    expandedDescriptionSections,
    expandedDescriptionQuality: expandedDescriptionWasEdited
      ? "partial"
      : normalizeExpandedDescriptionQuality(state.articleDraftMeta.expandedDescriptionQuality),
    cardSummaryEs: $("#article-card-summary")?.value || briefDescriptionEs,
    executiveSummary: $("#article-executive-summary")?.value || expandedDescriptionEs,
    executiveSummaryEs: $("#article-executive-summary")?.value || expandedDescriptionEs,
    abstractSummaryEs: $("#article-abstract-summary")?.value || "",
    objectiveEs: objective,
    clinicalQuestion: objective,
    clinicalQuestionEs: objective,
    mainMessageEs: mainMessage,
    mainResult: mainMessage,
    mainResultEs: mainMessage,
    methodologyEs: studyDesign,
    keyPointsEs: splitLines($("#article-key-points")?.value || ""),
    limitationsEs: $("#article-limitations")?.value || "",
    localApplicabilityEs: $("#article-local-applicability")?.value || "",
    occupationalHealthRelevanceEs: $("#article-occupational-relevance")?.value || "",
    methodologyProfile: buildMethodologyProfileFromForm({ studyDesign, studyLocationEs }),
    tags: splitTags($("#article-tags")?.value || ""),
    accessType: $("#article-access-type")?.value || "Pendiente",
    userComment: $("#article-user-comment")?.value || "",
    sourcePages: state.articleDraftMeta.sourcePages || [],
    extractionSource: state.articleDraftMeta.extractionSource || "manual",
    originalFileName: state.articleDraftMeta.originalFileName || "",
    storagePath: state.articleDraftMeta.storagePath || "",
    fileSize: state.articleDraftMeta.fileSize || 0,
    documentContentType: state.articleDraftMeta.documentContentType || "",
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

const getArticleSaveErrorMessage = (error = {}) => {
  const code = String(error?.code || error?.message || "");
  if (code === "AUTH_REQUIRED" || /unauthenticated|auth|token/i.test(code)) {
    return "No se pudo guardar porque la sesión no está activa.";
  }
  if (code === "FIRESTORE_PERMISSION_DENIED" || /permission-denied|missing or insufficient permissions/i.test(code)) {
    return "No se pudo guardar porque las reglas de Firestore aún no permiten estos campos. Actualizá reglas y reintentá.";
  }
  if (code === "FIRESTORE_SAVE_FAILED") {
    return "No se pudo confirmar el guardado en Firestore. La publicación quedó abierta para que puedas reintentar sin perder la ficha.";
  }
  if (/invalid-argument|failed-precondition|payload|document/i.test(code)) {
    return "No se pudo guardar porque Firestore rechazó el contenido de la ficha. Revisá los campos generados e intentá nuevamente.";
  }
  if (/unavailable|deadline-exceeded|network|offline/i.test(code)) {
    return "No se pudo guardar por un problema de conexión. Revisá la red e intentá nuevamente.";
  }
  return "No se pudo guardar el artículo. Revisá la conexión e intentá nuevamente.";
};

const setActionBusy = (button, busy, busyText = "Procesando...") => {
  if (!button) return;
  button.disabled = busy;
  button.dataset.originalHtml = button.dataset.originalHtml || button.innerHTML;
  button.textContent = busy ? busyText : "";
  if (!busy) {
    button.innerHTML = button.dataset.originalHtml;
    if (window.lucide) window.lucide.createIcons();
  }
};

const showBitacoraNotice = (message, type = "info") => {
  const text = String(message || "").trim();
  if (!text) return;
  if (!els.noticeRegion) {
    console.warn("[Bitácora] Aviso:", text);
    return;
  }
  window.clearTimeout(state.noticeTimeout);
  const safeType = ["info", "success", "warning", "error"].includes(type) ? type : "info";
  els.noticeRegion.innerHTML = `
    <div class="bitacora-notice bitacora-notice--${escapeHtml(safeType)}" role="${safeType === "error" ? "alert" : "status"}">
      <span>${escapeHtml(text)}</span>
      <button type="button" class="bitacora-notice__close" aria-label="Cerrar aviso">Cerrar</button>
    </div>
  `;
  els.noticeRegion.querySelector(".bitacora-notice__close")?.addEventListener("click", () => {
    window.clearTimeout(state.noticeTimeout);
    els.noticeRegion.innerHTML = "";
  });
  state.noticeTimeout = window.setTimeout(() => {
    if (els.noticeRegion) els.noticeRegion.innerHTML = "";
  }, safeType === "error" ? 7000 : 5000);
};

const showArticleActionError = (message) => {
  showBitacoraNotice(message, "error");
};

const setReauthError = (message = "") => {
  if (!els.reauthError) return;
  els.reauthError.hidden = !message;
  els.reauthError.textContent = message;
};

const getReauthProviderMode = () => {
  const providers = state.currentUser?.providerData?.map((provider) => provider.providerId) || [];
  if (providers.includes("password")) return "password";
  if (providers.includes("google.com")) return "google";
  return providers[0] || "unsupported";
};

const openReauthModal = ({ action, postId, trigger }) => {
  const post = getAllPosts().find((item) => item.id === postId);
  if (!post || !canManageArticle(post)) return;
  state.pendingSensitiveAction = { action, postId, trigger };
  const mode = getReauthProviderMode();
  const actionLabel = action === "edit" ? "edición" : "eliminación";
  if (els.reauthTitle) {
    els.reauthTitle.textContent = action === "edit" ? "Confirmar edición" : "Confirmar eliminación";
  }
  if (els.reauthDescription) {
    els.reauthDescription.textContent =
      mode === "password"
        ? `Por seguridad, ingresá tu contraseña para continuar con la ${actionLabel}.`
        : `Por seguridad, reautenticate con tu proveedor para continuar con la ${actionLabel}.`;
  }
  if (els.reauthPasswordSection) els.reauthPasswordSection.hidden = mode !== "password";
  if (els.reauthProviderSection) els.reauthProviderSection.hidden = mode === "password";
  if (els.reauthProviderName) {
    els.reauthProviderName.textContent =
      mode === "google" ? "Google" : "Este proveedor no tiene reautenticación disponible en esta vista.";
  }
  if (els.reauthPassword) els.reauthPassword.value = "";
  if (els.reauthSubmit) {
    els.reauthSubmit.disabled = mode !== "password" && mode !== "google";
    els.reauthSubmit.textContent = mode === "password" ? "Confirmar" : "Reautenticar";
    delete els.reauthSubmit.dataset.originalText;
  }
  setReauthError("");
  openModal(els.reauthModal, trigger);
};

const reauthenticateCurrentUser = async () => {
  const user = state.currentUser || auth.currentUser;
  if (!user) throw new Error("AUTH_REQUIRED");
  const mode = getReauthProviderMode();
  if (mode === "password") {
    const email = user.email || "";
    const password = els.reauthPassword?.value || "";
    if (!email || !password) {
      throw new Error("PASSWORD_REQUIRED");
    }
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
    return;
  }
  if (mode === "google") {
    await reauthenticateWithPopup(user, new GoogleAuthProvider());
    return;
  }
  throw new Error("UNSUPPORTED_PROVIDER");
};

const openDeleteConfirmation = (postId, trigger) => {
  const post = getAllPosts().find((item) => item.id === postId);
  if (!post || !canManageArticle(post)) return;
  state.pendingDeleteArticleId = postId;
  if (els.deleteConfirmText) {
    els.deleteConfirmText.textContent = `Esta acción eliminará "${post.title || "esta publicación"}" de la Bitácora. Si tiene PDF asociado, también se intentará eliminar el archivo privado.`;
  }
  openModal(els.deleteConfirmModal, trigger);
};

const handleReauthSubmit = async (event) => {
  event.preventDefault();
  const submitter = event.submitter || els.reauthSubmit;
  setActionBusy(submitter, true, "Validando...");
  setReauthError("");
  try {
    await reauthenticateCurrentUser();
    const pending = state.pendingSensitiveAction;
    state.pendingSensitiveAction = null;
    closeModal(els.reauthModal);
    if (pending?.action === "edit") {
      openEditArticleModal(pending.postId, pending.trigger);
    } else if (pending?.action === "delete") {
      openDeleteConfirmation(pending.postId, pending.trigger);
    }
  } catch (error) {
    const code = String(error?.code || error?.message || "");
    const message =
      code === "PASSWORD_REQUIRED"
        ? "Ingresá tu contraseña para continuar."
        : code === "UNSUPPORTED_PROVIDER"
          ? "Este proveedor de inicio de sesión no permite reautenticación desde esta vista."
          : "Contraseña incorrecta o sesión no validada.";
    setReauthError(message);
  } finally {
    setActionBusy(submitter, false);
  }
};

const handleDeleteArticle = async (postId, button) => {
  const post = getAllPosts().find((item) => item.id === postId);
  if (!post || !repository || !canManageArticle(post)) return false;
  setActionBusy(button, true, "Eliminando...");
  try {
    await repository.deleteArticle(post.id, { storagePath: post.storagePath || "" });
    state.userArticles = state.userArticles.filter((article) => article.id !== post.id);
    if (state.expandedPostId === post.id) state.expandedPostId = "";
    state.socialSummaries.delete(post.id);
    state.commentsByPost.delete(post.id);
    state.likeUnsubscribers.get(post.id)?.();
    state.likeUnsubscribers.delete(post.id);
    state.commentLikeUnsubscribers.forEach((unsubscribe, key) => {
      if (key.startsWith(`${post.id}::`)) {
        unsubscribe?.();
        state.commentLikeUnsubscribers.delete(key);
        state.commentLikeSummaries.delete(key);
      }
    });
    renderFilterOptions();
    renderPosts();
    return true;
  } catch (error) {
    const message =
      error?.message === "AUTH_REQUIRED"
        ? "La sesión no está activa. Iniciá sesión nuevamente."
        : "No se pudo eliminar el artículo. Verificá permisos o conexión.";
    showArticleActionError(message);
    return false;
  } finally {
    setActionBusy(button, false);
  }
};

const handleDeleteConfirmSubmit = async (event) => {
  event.preventDefault();
  const postId = state.pendingDeleteArticleId;
  const submitter = event.submitter || els.deleteConfirmSubmit;
  if (!postId) return;
  const deleted = await handleDeleteArticle(postId, submitter);
  if (deleted) {
    state.pendingDeleteArticleId = "";
    closeModal(els.deleteConfirmModal);
    if (els.deleteConfirmText) {
      els.deleteConfirmText.textContent =
        "Esta acción eliminará la publicación de la Bitácora. Si tiene PDF asociado, también se intentará eliminar el archivo privado.";
    }
    resetArticleForm();
  }
};

const handleArticleSubmit = async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const isEditing = state.articleModalMode === "edit" && state.editingArticleId;
  const requestedStatus = isEditing
    ? state.editingArticleSnapshot?.status || "pending_review"
    : submitter?.dataset?.saveStatus === "draft"
      ? "draft"
      : "pending_review";
  const validation = validateArticleBeforeSave(requestedStatus);
  if (!validation || !repository) return;
  setSaveBusy(submitter, true);
  try {
    const payload = buildArticlePayload(requestedStatus);
    const article = isEditing
      ? await repository.updateArticle(state.editingArticleId, {
          ...payload,
          id: state.editingArticleSnapshot?.id,
          createdBy: state.editingArticleSnapshot?.createdBy,
          createdAt: state.editingArticleSnapshot?.createdAt
        })
      : await repository.createArticle(payload);
    if (article) {
      upsertUserArticle(article);
      state.repositoryMode = article.repositoryMode || repository.getMode();
    }
    renderFilterOptions();
    renderPosts();
    showBitacoraNotice(
      article?.repositoryMode === "memory"
        ? "Artículo guardado localmente porque Firebase no está disponible en esta sesión."
        : "Artículo guardado en la Bitácora.",
      article?.repositoryMode === "memory" ? "warning" : "success"
    );
    closeModal(els.addArticleModal);
    resetArticleForm();
  } catch (error) {
    setArticleError(els.articleFormError, getArticleSaveErrorMessage(error));
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

const collapseOpenAnalysis = () => {
  if (!state.expandedPostId) return;
  state.expandedPostId = "";
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

const initBitacoraQuickDock = ({ assistantShell } = {}) => {
  const dock = $("[data-bitacora-quick-dock]");
  if (!dock) return;
  const botButton = dock.querySelector("[data-bitacora-quick-action='bot']");

  const getAssistantShell = () => assistantShell || window.__dmAssistantShell || null;
  const syncAssistantButtonState = (event) => {
    const shell = event?.detail?.api || getAssistantShell();
    const stateSnapshot = shell?.state || {};
    const isOpen = Boolean(stateSnapshot.pickerOpen || stateSnapshot.panelOpen);
    botButton?.setAttribute("aria-expanded", isOpen ? "true" : "false");
    botButton?.classList.toggle("is-selected", isOpen);
  };

  window.addEventListener("dm:assistant-shell-state", syncAssistantButtonState);
  syncAssistantButtonState();

  dock.addEventListener("click", (event) => {
    const button = event.target.closest("[data-bitacora-quick-action]");
    if (!button || !dock.contains(button)) return;
    event.preventDefault();

    const action = button.dataset.bitacoraQuickAction;
    button.classList.add("is-pressed");
    window.setTimeout(() => button.classList.remove("is-pressed"), 150);

    if (action === "methodology") {
      openModal(els.methodologyGuideModal, button);
      return;
    }

    if (action === "sources") {
      openModal(els.sourcesModal, button);
      return;
    }

    if (action === "add-article") {
      openAddArticleModal(button);
      return;
    }

    if (action === "bot") {
      const shell = getAssistantShell();
      shell?.openPicker?.();
      syncAssistantButtonState();
    }
  });
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
    event.stopPropagation();
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
    if (action === "edit-article") {
      openReauthModal({ action: "edit", postId, trigger: actionButton });
      return;
    }
    if (action === "delete-article") {
      openReauthModal({ action: "delete", postId, trigger: actionButton });
      return;
    }
    if (action === "view-document") {
      openArticleDocument(postId, actionButton);
      return;
    }
    if (action === "toggle-like") {
      handleToggleLike(postId, actionButton);
      return;
    }
    if (action === "focus-comments") {
      focusCommentsForPost(postId);
      return;
    }
    if (action === "show-all-comments") {
      state.expandedCommentsAll.add(postId);
      renderPosts();
      return;
    }
    if (action === "delete-comment") {
      const commentId = actionButton.closest(".bitacora-comment")?.dataset?.commentId || "";
      handleDeleteComment(postId, commentId, actionButton);
      return;
    }
    if (action === "edit-comment") {
      const commentId = actionButton.closest(".bitacora-comment")?.dataset?.commentId || "";
      state.editingCommentId = commentId;
      renderPosts();
      window.requestAnimationFrame(() => {
        const card = $(`.bitacora-post[data-post-id="${escapeSelector(postId)}"]`);
        card?.querySelector(`.bitacora-comment[data-comment-id="${escapeSelector(commentId)}"] [data-bitacora-comment-edit-text]`)?.focus({
          preventScroll: true
        });
      });
      return;
    }
    if (action === "cancel-edit-comment") {
      state.editingCommentId = "";
      renderPosts();
      return;
    }
    if (action === "toggle-comment-like") {
      const commentId = actionButton.closest(".bitacora-comment")?.dataset?.commentId || "";
      handleToggleCommentLike(postId, commentId, actionButton);
      return;
    }
    if (action === "toggle-expanded-description") {
      const bodyId = actionButton.getAttribute("aria-controls") || "";
      const body = bodyId ? document.getElementById(bodyId) : null;
      if (!body) return;
      const isOpen = actionButton.getAttribute("aria-expanded") === "true";
      actionButton.setAttribute("aria-expanded", isOpen ? "false" : "true");
      body.hidden = isOpen;
      const label = actionButton.querySelector("[data-expanded-description-toggle-label]");
      if (label) label.textContent = isOpen ? "Ver descripción" : "Ocultar descripción";
      const icon = actionButton.querySelector("[data-lucide]");
      if (icon) icon.setAttribute("data-lucide", isOpen ? "chevron-down" : "chevron-up");
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    if (action !== "toggle-analysis") return;
    state.expandedPostId = state.expandedPostId === postId ? "" : postId;
    renderPosts();
    const restored = $(`.bitacora-post[data-post-id="${escapeSelector(postId)}"]`);
    restored?.querySelector('[data-bitacora-action="toggle-analysis"]')?.focus({ preventScroll: true });
  });

  els.posts?.addEventListener("submit", (event) => {
    if (event.target.closest("[data-bitacora-comment-edit-form]")) {
      handleCommentEditSubmit(event);
      return;
    }
    handleCommentSubmit(event);
  });

  document.addEventListener("click", (event) => {
    if (!state.expandedPostId) return;
    if (event.target.closest("[data-bitacora-action='toggle-analysis']")) return;
    const openCard = $(`.bitacora-post[data-post-id="${escapeSelector(state.expandedPostId)}"]`);
    if (openCard?.contains(event.target)) return;
    collapseOpenAnalysis();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && event.target.closest?.(".bitacora-social-action, .bitacora-comment-action")) {
      event.target.blur?.();
      return;
    }
    if (event.key === "Escape" && !state.activeModal && state.expandedPostId) {
      collapseOpenAnalysis();
    }
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
  $$("[data-open-methodology-guide]").forEach((trigger) => {
    trigger.addEventListener("click", () => openModal(els.methodologyGuideModal, trigger));
  });
  els.methodologyGuideContent?.addEventListener("click", handleMethodologyGuideNavigation);
  els.methodologyGuideContent?.addEventListener("click", handleMethodologyGuideTermInteraction);
  els.methodologyGuideContent?.addEventListener("keydown", handleMethodologyGuideKeyboard);
  els.methodologyGuideContent?.addEventListener("scroll", handleMethodologyGuideScroll);
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
  els.selectPdfButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    els.pdfInput?.click();
  });
  els.pdfDropzone?.addEventListener("click", (event) => {
    if (event.target.closest("[data-select-pdf]")) return;
    els.pdfInput?.click();
  });
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
    if (file) handleDocumentFileSelected(file);
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
  els.pdfOfficialUrl?.addEventListener("change", () => {
    const validation = validateOptionalArticleUrl(els.pdfOfficialUrl?.value || "");
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
  els.advancedToggle?.addEventListener("click", () => {
    const expanded = els.advancedToggle.getAttribute("aria-expanded") === "true";
    setAdvancedVisible(!expanded);
  });
  els.previewExpandedToggle?.addEventListener("click", togglePreviewExpandedDescription);
  els.assistedToggle?.addEventListener("click", () => {
    const expanded = els.assistedToggle.getAttribute("aria-expanded") === "true";
    setAssistedModeVisible(true, !expanded);
  });
  els.assistedAnalyzeButton?.addEventListener("click", () => handleAnalyzeArticle(getAssistedEvidence()));
  els.addArticleForm?.addEventListener("submit", handleArticleSubmit);
  els.reauthForm?.addEventListener("submit", handleReauthSubmit);
  els.deleteConfirmForm?.addEventListener("submit", handleDeleteConfirmSubmit);
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
  const assistantShell = initAssistantShell({ variant: resolveAssistantVariant() });
  initReturnHomeLink();
  initScrollUp();
  initBitacoraQuickDock({ assistantShell });
  renderFilterOptions();
  renderSourceScopeControls();
  renderSources();
  renderMethodologyGuide();
  renderPosts();
  bindEvents();
  initArticleRepository();
  ensureBitacoraChatLoaded();
  if (window.lucide) window.lucide.createIcons();
};

window.addEventListener("beforeunload", () => {
  if (typeof unsubscribeArticles === "function") unsubscribeArticles();
  state.likeUnsubscribers.forEach((unsubscribe) => unsubscribe?.());
  state.commentLikeUnsubscribers.forEach((unsubscribe) => unsubscribe?.());
  if (typeof state.activeCommentsUnsubscribe === "function") state.activeCommentsUnsubscribe();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
