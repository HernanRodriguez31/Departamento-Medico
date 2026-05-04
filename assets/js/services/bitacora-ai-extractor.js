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
  if (status === "metadata_only") {
    return article?.warnings?.[0] || "Se cargaron metadatos básicos. Completá los datos clínicos antes de guardar.";
  }
  if (status === "not_configured") {
    return article?.warnings?.[0] || "Falta configurar OPENAI_API_KEY para completar el análisis.";
  }
  if (status === "failed") {
    return article?.warnings?.[0] || "La IA no pudo completar el análisis. Revisá los campos.";
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

const hasUsefulAiDraft = (article = {}) =>
  Boolean(
    cleanString(article.executiveSummary).length >= 24 ||
      cleanString(article.clinicalQuestion).length >= 24 ||
      cleanString(article.mainResult).length >= 24 ||
      article.studyType ||
      article.evidenceType ||
      article.studyLocation ||
      (Array.isArray(article.tags) && article.tags.length >= 2)
  );

const hasMetadataDraft = (article = {}) =>
  Boolean(article.title || article.executiveSummary || article.publicationDate);

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
    const backendStatus = cleanString(payload.extractionStatus);
    const usefulAiDraft = hasUsefulAiDraft(article);
    let extractionStatus = backendStatus || (usefulAiDraft ? "ai_draft" : "metadata_only");
    if (extractionStatus === "ai_draft" && !usefulAiDraft) {
      extractionStatus = hasMetadataDraft(article) ? "metadata_only" : "failed";
    }

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
