const DEFAULT_ENDPOINT = "/api/extractScientificArticle";
const PUBLISHED_FUNCTION_ENDPOINT =
  "https://us-central1-departamento-medico-brisa.cloudfunctions.net/extractScientificArticle";

const KNOWN_SOURCE_NAMES = new Map([
  ["pubmed.ncbi.nlm.nih.gov", "PubMed / MEDLINE"],
  ["pmc.ncbi.nlm.nih.gov", "PubMed Central / PMC"],
  ["www.cochranelibrary.com", "Cochrane Library"],
  ["cochranelibrary.com", "Cochrane Library"],
  ["www.nejm.org", "NEJM"],
  ["nejm.org", "NEJM"],
  ["www.thelancet.com", "The Lancet"],
  ["thelancet.com", "The Lancet"],
  ["jamanetwork.com", "JAMA Network"],
  ["www.bmj.com", "The BMJ"],
  ["bmj.com", "The BMJ"],
  ["www.nature.com", "Nature Medicine"],
  ["nature.com", "Nature Medicine"],
  ["www.sciencedirect.com", "ScienceDirect / Elsevier"],
  ["sciencedirect.com", "ScienceDirect / Elsevier"],
  ["bvsalud.org", "LILACS / BVS"],
  ["scielo.org", "SciELO"]
]);

const cleanString = (value = "") => String(value || "").trim();
const AUTH_MESSAGE = "Necesitás iniciar sesión para analizar enlaces.";
const RATE_LIMIT_MESSAGE = "Se alcanzó el límite de análisis. Reintentá más tarde.";
const NOT_CONFIGURED_MESSAGE = "El servicio de IA no está configurado en backend.";
const METADATA_ONLY_MESSAGE = "Solo se detectaron metadatos básicos. Completá el resto manualmente.";
const FAILED_MESSAGE =
  "No se pudo extraer información suficiente desde la página. Podés completar el artículo manualmente.";
const AI_DRAFT_MESSAGE = "Borrador cargado por IA. Revisá la información antes de guardar.";

const normalizeTags = (value = []) =>
  (Array.isArray(value) ? value : String(value || "").split(","))
    .map((item) => cleanString(item))
    .filter(Boolean)
    .slice(0, 12);

const firstText = (input = {}, keys = []) => {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) return cleanString(value);
    if (Array.isArray(value)) {
      const first = value.find((entry) => typeof entry === "string" && entry.trim());
      if (first) return cleanString(first);
    }
    if (value && typeof value === "object") {
      for (const nestedKey of ["name", "title", "headline"]) {
        if (typeof value[nestedKey] === "string" && value[nestedKey].trim()) {
          return cleanString(value[nestedKey]);
        }
      }
    }
  }
  return "";
};

export const inferSourceNameFromDomain = (domain = "") => {
  const cleanDomain = cleanString(domain).toLowerCase();
  if (!cleanDomain) return "";
  if (KNOWN_SOURCE_NAMES.has(cleanDomain)) return KNOWN_SOURCE_NAMES.get(cleanDomain);
  return cleanDomain.replace(/^www\./, "").split(".").slice(0, 2).join(".");
};

export const validateArticleUrl = (value = "") => {
  try {
    const url = new URL(cleanString(value));
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return {
        ok: false,
        message: "Ingresá una URL web válida que comience con http o https."
      };
    }
    const hostname = url.hostname.toLowerCase();
    const isLocalHost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal");
    if (isLocalHost) {
      return {
        ok: false,
        message: "Ingresá una URL pública del artículo científico."
      };
    }
    return {
      ok: true,
      href: url.href,
      domain: hostname,
      sourceName: inferSourceNameFromDomain(hostname)
    };
  } catch (error) {
    return {
      ok: false,
      message: "Ingresá una URL válida del artículo o paper."
    };
  }
};

const buildManualFallback = (urlInfo, status = "not_configured", message = "") => ({
  ok: false,
  extractionStatus: status,
  error:
    message ||
    "No se pudo completar con IA. Revisá o completá los campos manualmente.",
  article: {
    title: "",
    sourceName: urlInfo.sourceName,
    officialUrl: urlInfo.href,
    sourceDomain: urlInfo.domain,
    studyType: "",
    evidenceType: "",
    publicationDate: "",
    studyLocation: "",
    executiveSummary: "",
    clinicalQuestion: "",
    mainResult: "",
    tags: [],
    accessType: "Pendiente",
    extractionConfidence: 0,
    warnings: [message || "No se pudo completar con IA."]
  }
});

const resolveExtractionEndpoint = (endpoint) => {
  if (endpoint) return endpoint;
  if (typeof window === "undefined") return DEFAULT_ENDPOINT;
  if (window.BITACORA_AI_EXTRACT_ENDPOINT) return window.BITACORA_AI_EXTRACT_ENDPOINT;

  const host = window.location.hostname;
  const port = window.location.port;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  const isFirebaseEmulator = isLocalHost && port === "5002";
  if (isLocalHost && !isFirebaseEmulator) {
    return PUBLISHED_FUNCTION_ENDPOINT;
  }
  return DEFAULT_ENDPOINT;
};

const getEndpointErrorMessage = (status, payload) => {
  const code =
    typeof payload?.error === "string" ? payload.error : payload?.error?.code || "";
  const backendMessage =
    typeof payload?.error === "object" && typeof payload.error.message === "string"
      ? payload.error.message
      : "";
  if (status === 401 || code === "auth_required" || code === "auth_invalid") {
    return AUTH_MESSAGE;
  }
  if (status === 404 || status === 405) {
    return NOT_CONFIGURED_MESSAGE;
  }
  if (status === 429 || code === "rate_limited") {
    return RATE_LIMIT_MESSAGE;
  }
  if (code === "missing_openai_api_key" || code === "not_configured") {
    return NOT_CONFIGURED_MESSAGE;
  }
  return backendMessage || FAILED_MESSAGE;
};

const getExtractionStatusMessage = (status) => {
  if (status === "ai_draft") return AI_DRAFT_MESSAGE;
  if (status === "metadata_only") {
    return METADATA_ONLY_MESSAGE;
  }
  if (status === "not_configured") {
    return NOT_CONFIGURED_MESSAGE;
  }
  if (status === "failed") {
    return FAILED_MESSAGE;
  }
  return "";
};

const normalizeExtractionArticle = (input = {}, urlInfo) => ({
  title: firstText(input, ["title", "titulo", "articleTitle", "headline"]),
  sourceName:
    firstText(input, ["sourceName", "source", "journal", "journalTitle", "revista", "fuente", "publisher"]) ||
    urlInfo.sourceName,
  officialUrl: urlInfo.href,
  sourceDomain: urlInfo.domain,
  studyType: firstText(input, ["studyType", "typeOfStudy", "study_design", "studyDesign", "tipoEstudio", "tipo_de_estudio", "design"]),
  evidenceType: firstText(input, ["evidenceType", "typeOfEvidence", "evidence_level", "evidenceLevel", "tipoEvidencia", "tipo_de_evidencia"]),
  publicationDate: firstText(input, ["publicationDate", "publishedAt", "publication_date", "datePublished", "fechaPublicacion", "fecha_de_publicacion"]),
  studyLocation: firstText(input, ["studyLocation", "location", "studyCountry", "setting", "lugar", "contexto"]),
  executiveSummary: firstText(input, ["executiveSummary", "summary", "abstract", "resumen", "resumenEjecutivo", "resumen_ejecutivo"]),
  clinicalQuestion: firstText(input, ["clinicalQuestion", "question", "researchQuestion", "preguntaClinica", "pregunta_clinica", "pregunta"]),
  mainResult: firstText(input, ["mainResult", "result", "results", "findings", "conclusion", "resultadoPrincipal", "resultado_principal", "mainFinding"]),
  tags: normalizeTags(input.tags || input.keywords || input.etiquetas || input.palabrasClave || input.palabras_clave),
  accessType: firstText(input, ["accessType", "access", "acceso", "availability"]) || "Pendiente",
  extractionConfidence: Number.isFinite(Number(input.extractionConfidence ?? input.confidence ?? input.confianza))
    ? Math.max(0, Math.min(1, Number(input.extractionConfidence ?? input.confidence ?? input.confianza)))
    : 0,
  warnings: normalizeTags(input.warnings || input.extractionWarnings || input.advertencias)
});

const hasCanonicalSource = (article = {}) => {
  const sourceName = cleanString(article.sourceName).toLowerCase();
  const sourceDomain = cleanString(article.sourceDomain).toLowerCase();
  if (!sourceName) return false;
  if (!sourceDomain) return true;
  return sourceName !== sourceDomain && sourceName !== sourceDomain.replace(/^www\./, "");
};

const hasUsefulAiDraft = (article = {}) => {
  const hasTitleOrSource = Boolean(cleanString(article.title) || hasCanonicalSource(article));
  const usefulFieldCount = [
    cleanString(article.executiveSummary).length >= 24,
    cleanString(article.clinicalQuestion).length >= 24,
    cleanString(article.mainResult).length >= 24,
    Boolean(cleanString(article.studyType)),
    Boolean(cleanString(article.evidenceType)),
    Boolean(cleanString(article.publicationDate))
  ].filter(Boolean).length;
  return hasTitleOrSource && usefulFieldCount >= 2;
};

const hasMetadataDraft = (article = {}) =>
  Boolean(article.title || hasCanonicalSource(article) || article.publicationDate);

export async function requestArticleExtraction(url, { auth, endpoint } = {}) {
  const validation = validateArticleUrl(url);
  if (!validation.ok) {
    return {
      ok: false,
      extractionStatus: "failed",
      article: null,
      error: validation.message
    };
  }

  const resolvedEndpoint = resolveExtractionEndpoint(endpoint);

  if (!resolvedEndpoint) {
    return buildManualFallback(validation);
  }

  let token = "";
  try {
    token = auth?.currentUser ? await auth.currentUser.getIdToken() : "";
  } catch (error) {
    token = "";
  }

  if (!token) {
    return buildManualFallback(
      validation,
      "failed",
      AUTH_MESSAGE
    );
  }

  try {
    const response = await fetch(resolvedEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ url: validation.href })
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok || payload?.ok === false) {
      const status = response.status === 404 || response.status === 405 ? "not_configured" : "failed";
      return buildManualFallback(
        validation,
        status,
        getEndpointErrorMessage(response.status, payload)
      );
    }

    const article = normalizeExtractionArticle(payload.article || payload, validation);
    const backendStatus = cleanString(payload.extractionStatus);
    const usefulAiDraft = hasUsefulAiDraft(article);
    let extractionStatus = backendStatus || (usefulAiDraft ? "ai_draft" : "metadata_only");
    if (extractionStatus === "ai_draft" && !usefulAiDraft) {
      extractionStatus = hasMetadataDraft(article) ? "metadata_only" : "failed";
    }

    return {
      ok: true,
      extractionStatus,
      message: getExtractionStatusMessage(extractionStatus),
      rawEvidence: payload.rawEvidence || null,
      article: {
        ...article,
        warnings: article.warnings.length
          ? article.warnings
          : ["El resumen automático debe ser revisado por el equipo médico."]
      }
    };
  } catch (error) {
    return buildManualFallback(
      validation,
      "not_configured",
      NOT_CONFIGURED_MESSAGE
    );
  }
}
