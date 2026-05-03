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

const normalizeTags = (value = []) =>
  (Array.isArray(value) ? value : String(value || "").split(","))
    .map((item) => cleanString(item))
    .filter(Boolean)
    .slice(0, 12);

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
    return {
      ok: true,
      href: url.href,
      domain: url.hostname.toLowerCase(),
      sourceName: inferSourceNameFromDomain(url.hostname)
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
  const code = payload?.error || "";
  if (status === 401 || code === "auth_required" || code === "auth_invalid") {
    return "Iniciá sesión nuevamente para usar el análisis con IA.";
  }
  if (status === 404 || status === 405) {
    return "El servicio de IA no está publicado en este entorno.";
  }
  if (status === 429 || code === "rate_limited") {
    return "Límite de análisis alcanzado. Probá nuevamente en un minuto.";
  }
  if (code === "missing_openai_api_key") {
    return "Falta configurar OPENAI_API_KEY para completar el análisis.";
  }
  return "No se pudo completar con IA. Revisá o completá los campos manualmente.";
};

const getExtractionStatusMessage = (status, article) => {
  if (status === "not_configured") {
    return article?.warnings?.[0] || "Falta configurar OPENAI_API_KEY para completar el análisis.";
  }
  if (status === "failed") {
    return article?.warnings?.[0] || "La IA no pudo completar el análisis. Revisá los campos.";
  }
  return "";
};

const normalizeExtractionArticle = (input = {}, urlInfo) => ({
  title: cleanString(input.title),
  sourceName: cleanString(input.sourceName) || urlInfo.sourceName,
  officialUrl: cleanString(input.officialUrl) || urlInfo.href,
  sourceDomain: cleanString(input.sourceDomain) || urlInfo.domain,
  studyType: cleanString(input.studyType),
  evidenceType: cleanString(input.evidenceType),
  publicationDate: cleanString(input.publicationDate),
  studyLocation: cleanString(input.studyLocation),
  executiveSummary: cleanString(input.executiveSummary),
  clinicalQuestion: cleanString(input.clinicalQuestion),
  mainResult: cleanString(input.mainResult),
  tags: normalizeTags(input.tags),
  accessType: cleanString(input.accessType) || "Pendiente",
  extractionConfidence: Number.isFinite(Number(input.extractionConfidence))
    ? Math.max(0, Math.min(1, Number(input.extractionConfidence)))
    : 0,
  warnings: normalizeTags(input.warnings || input.extractionWarnings)
});

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
      "No se pudo autenticar la solicitud de análisis. Completá los campos manualmente."
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
    const hasStructuredDraft = Boolean(
      article.title ||
        article.executiveSummary ||
        article.clinicalQuestion ||
        article.mainResult ||
        article.evidenceType ||
        article.studyType
    );

    const extractionStatus =
      payload.extractionStatus ||
      (hasStructuredDraft ? "ai_draft" : "not_configured");

    return {
      ok: true,
      extractionStatus,
      message: getExtractionStatusMessage(extractionStatus, article),
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
      "No se pudo conectar con el servicio de IA desde este entorno."
    );
  }
}
