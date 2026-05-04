const DEFAULT_ENDPOINT = "/api/extractScientificArticle";
const PUBLISHED_FUNCTION_ENDPOINT =
  "https://us-central1-departamento-medico-brisa.cloudfunctions.net/extractScientificArticle";
const DEFAULT_DOCUMENT_ENDPOINT = "/api/extractScientificArticleDocument";
const PUBLISHED_DOCUMENT_FUNCTION_ENDPOINT =
  "https://us-central1-departamento-medico-brisa.cloudfunctions.net/extractScientificArticleDocument";

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
const METADATA_ONLY_MESSAGE =
  "Se detectaron metadatos básicos, pero no contenido científico suficiente. Completá el análisis manualmente.";
const FAILED_MESSAGE =
  "No se pudo extraer información suficiente desde esta URL. Probá con DOI, PubMed, PMC, PDF open access o completá manualmente.";
const AI_DRAFT_MESSAGE = "Borrador cargado por IA. Revisá la información antes de guardar.";
const DOCUMENT_AUTH_MESSAGE = "Necesitás iniciar sesión para analizar documentos.";
const DOCUMENT_FAILED_MESSAGE = "No se pudo analizar el documento. Podés completar la publicación manualmente.";
const DOCUMENT_AI_DRAFT_MESSAGE = "Ficha generada por IA. Revisá la información antes de guardar.";
const DOCUMENT_METADATA_ONLY_MESSAGE =
  "Se detectaron datos básicos, pero falta contenido suficiente. Completá los campos necesarios antes de guardar.";

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

const isPrivateHostname = (hostname = "") => {
  const cleanHostname = cleanString(hostname).toLowerCase().replace(/^\[|\]$/g, "");
  if (
    cleanHostname === "localhost" ||
    cleanHostname === "::1" ||
    cleanHostname.endsWith(".localhost") ||
    cleanHostname.endsWith(".local") ||
    cleanHostname.endsWith(".internal")
  ) {
    return true;
  }
  const ipv4 = cleanHostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
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
    if (isPrivateHostname(hostname)) {
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
    doi: "",
    pmid: "",
    pmcid: "",
    nctId: "",
    pii: "",
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

const resolveDocumentExtractionEndpoint = (endpoint) => {
  if (endpoint) return endpoint;
  if (typeof window === "undefined") return DEFAULT_DOCUMENT_ENDPOINT;
  if (window.BITACORA_DOCUMENT_EXTRACT_ENDPOINT) return window.BITACORA_DOCUMENT_EXTRACT_ENDPOINT;
  const host = window.location.hostname;
  const port = window.location.port;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  const isFirebaseEmulator = isLocalHost && port === "5002";
  if (isLocalHost && !isFirebaseEmulator) return PUBLISHED_DOCUMENT_FUNCTION_ENDPOINT;
  return DEFAULT_DOCUMENT_ENDPOINT;
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

const getDocumentEndpointErrorMessage = (status, payload) => {
  const code =
    typeof payload?.error === "string" ? payload.error : payload?.error?.code || "";
  const backendMessage =
    typeof payload?.error === "object" && typeof payload.error.message === "string"
      ? payload.error.message
      : "";
  if (status === 401 || code === "auth_required" || code === "auth_invalid") {
    return DOCUMENT_AUTH_MESSAGE;
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
  return backendMessage || DOCUMENT_FAILED_MESSAGE;
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

const getDocumentStatusMessage = (status) => {
  if (status === "ai_draft") return DOCUMENT_AI_DRAFT_MESSAGE;
  if (status === "metadata_only") return DOCUMENT_METADATA_ONLY_MESSAGE;
  if (status === "not_configured") return NOT_CONFIGURED_MESSAGE;
  return DOCUMENT_FAILED_MESSAGE;
};

const normalizeExtractionArticle = (input = {}, urlInfo) => ({
  title: firstText(input, ["title", "titulo", "articleTitle", "headline"]),
  sourceName:
    firstText(input, ["sourceName", "source", "journal", "journalTitle", "revista", "fuente", "publisher"]) ||
    urlInfo.sourceName,
  officialUrl: urlInfo.href,
  sourceDomain: urlInfo.domain,
  doi: firstText(input, ["doi", "DOI"]),
  pmid: firstText(input, ["pmid", "PMID"]).replace(/\D/g, ""),
  pmcid: firstText(input, ["pmcid", "PMCID"]).toUpperCase().match(/PMC\d+/)?.[0] || "",
  nctId: firstText(input, ["nctId", "nct_id", "NCT"]).toUpperCase().match(/NCT\d{8}/)?.[0] || "",
  pii: firstText(input, ["pii", "PII"]),
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
  const hasTitleAndSource = Boolean(cleanString(article.title) && hasCanonicalSource(article) && cleanString(article.officialUrl));
  const usefulFieldCount = [
    cleanString(article.executiveSummary).length >= 24,
    cleanString(article.clinicalQuestion).length >= 24,
    cleanString(article.mainResult).length >= 24,
    Boolean(cleanString(article.studyType)),
    Boolean(cleanString(article.evidenceType)),
    Boolean(cleanString(article.publicationDate))
  ].filter(Boolean).length;
  return hasTitleAndSource && usefulFieldCount >= 2 && Number(article.extractionConfidence || 0) >= 0.55;
};

const hasMetadataDraft = (article = {}) =>
  Boolean(article.title || hasCanonicalSource(article) || article.publicationDate || article.doi || article.pmid || article.pmcid || article.nctId || article.pii);

const normalizeDocumentArticle = (input = {}) => {
  const objectiveEs = firstText(input, [
    "objectiveEs",
    "objective",
    "purposeEs",
    "purpose",
    "clinicalQuestionEs",
    "clinicalQuestion",
    "researchQuestion",
    "preguntaClinica",
    "objetivo"
  ]);
  const mainMessageEs = firstText(input, [
    "mainMessageEs",
    "mainMessage",
    "messageEs",
    "mensajePrincipal",
    "mainResultEs",
    "mainResult",
    "result",
    "resultadoPrincipal"
  ]);
  return {
    title: firstText(input, ["title", "titulo", "articleTitle", "headline"]),
    sourceName: firstText(input, ["sourceName", "source", "journal", "journalTitle", "institution", "fuente", "publisher"]),
    journal: firstText(input, ["journal", "journalTitle", "revista"]),
    authors: normalizeTags(input.authors || input.author || input.autores),
    officialUrl: firstText(input, ["officialUrl", "url", "sourceUrl", "enlace"]),
    doi: firstText(input, ["doi", "DOI"]),
    publicationDate: firstText(input, ["publicationDate", "publishedAt", "datePublished", "fechaPublicacion"]),
    originalLanguage: firstText(input, ["originalLanguage", "language", "idioma"]),
    articleType: firstText(input, ["articleType", "documentType", "tipoArticulo", "tipo_de_articulo"]),
    studyType: firstText(input, ["studyType", "typeOfStudy", "studyDesign", "tipoEstudio"]),
    evidenceType: firstText(input, ["evidenceType", "typeOfEvidence", "tipoEvidencia"]),
    accessType: firstText(input, ["accessType", "access", "acceso"]) || "Pendiente",
    cardSummaryEs: firstText(input, ["cardSummaryEs", "cardSummary", "resumenBreve", "summaryCard"]),
    executiveSummaryEs: firstText(input, ["executiveSummaryEs", "executiveSummary", "resumenEjecutivo"]),
    abstractSummaryEs: firstText(input, ["abstractSummaryEs", "abstractSummary", "abstract", "resumenAbstract"]),
    objectiveEs,
    clinicalQuestionEs: objectiveEs,
    mainMessageEs,
    mainResultEs: mainMessageEs,
    studyDesignEs: firstText(input, ["studyDesignEs", "studyDesign", "designEs", "methodologyEs", "methodology", "methods", "metodologia"]),
    studyContextEs: firstText(input, ["studyContextEs", "studyContext", "contextoEstudio", "contextEs"]),
    studyPopulationEs: firstText(input, ["studyPopulationEs", "studyPopulation", "populationEs", "poblacion"]),
    studyLocationEs: firstText(input, ["studyLocationEs", "studyLocation", "locationEs", "lugar"]),
    studyPeriodEs: firstText(input, ["studyPeriodEs", "studyPeriod", "periodEs", "periodo"]),
    methodologyEs: firstText(input, ["methodologyEs", "methodology", "methods", "metodologia", "studyDesignEs", "studyDesign"]),
    keyPointsEs: normalizeTags(input.keyPointsEs || input.keyPoints || input.puntosClave).slice(0, 5),
    limitationsEs: firstText(input, ["limitationsEs", "limitations", "limitaciones"]),
    localApplicabilityEs: firstText(input, ["localApplicabilityEs", "localApplicability", "aplicabilidadLocal"]),
    occupationalHealthRelevanceEs: firstText(input, ["occupationalHealthRelevanceEs", "occupationalHealthRelevance", "relevanciaOcupacional"]),
    tags: normalizeTags(input.tags || input.keywords || input.etiquetas),
    sourcePages: Array.isArray(input.sourcePages) ? input.sourcePages : [],
    extractionConfidence: Number.isFinite(Number(input.extractionConfidence ?? input.confidence))
      ? Math.max(0, Math.min(1, Number(input.extractionConfidence ?? input.confidence)))
      : 0,
    warnings: normalizeTags(input.warnings || input.extractionWarnings || input.advertencias)
  };
};

const hasUsefulDocumentDraft = (article = {}) => {
  const usefulFieldCount = [
    cleanString(article.objectiveEs || article.clinicalQuestionEs).length >= 24,
    cleanString(article.studyDesignEs || article.methodologyEs).length >= 24,
    cleanString(article.studyContextEs).length >= 24,
    cleanString(article.mainMessageEs || article.mainResultEs).length >= 24,
    Boolean(cleanString(article.evidenceType)),
    Array.isArray(article.keyPointsEs) && article.keyPointsEs.length >= 3
  ].filter(Boolean).length;
  return Boolean(
    cleanString(article.title) &&
      cleanString(article.sourceName || article.journal) &&
      cleanString(article.cardSummaryEs).length >= 20 &&
      cleanString(article.executiveSummaryEs).length >= 24 &&
      usefulFieldCount >= 2 &&
      Number(article.extractionConfidence || 0) >= 0.55
  );
};

export async function requestArticleExtraction(url, { auth, endpoint, evidence = {} } = {}) {
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
      body: JSON.stringify({
        url: validation.href,
        doi: cleanString(evidence.doi),
        pmid: cleanString(evidence.pmid),
        pmcid: cleanString(evidence.pmcid),
        nctId: cleanString(evidence.nctId),
        pastedAbstract: cleanString(evidence.pastedAbstract),
        pastedTitle: cleanString(evidence.pastedTitle),
        pastedSource: cleanString(evidence.pastedSource)
      })
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
      error: payload.error?.message || "",
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

export async function requestArticleDocumentExtraction(payload = {}, { auth, endpoint } = {}) {
  const resolvedEndpoint = resolveDocumentExtractionEndpoint(endpoint);
  let token = "";
  try {
    token = auth?.currentUser ? await auth.currentUser.getIdToken() : "";
  } catch (error) {
    token = "";
  }
  if (!token) {
    return {
      ok: false,
      extractionStatus: "failed",
      error: DOCUMENT_AUTH_MESSAGE,
      article: null,
      rawEvidence: null
    };
  }

  try {
    const response = await fetch(resolvedEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    let body = null;
    try {
      body = await response.json();
    } catch (error) {
      body = null;
    }
    if (!response.ok || body?.ok === false) {
      const status = body?.extractionStatus || (response.status === 404 || response.status === 405 ? "not_configured" : "failed");
      return {
        ok: false,
        extractionStatus: status,
        error: getDocumentEndpointErrorMessage(response.status, body) || body?.error?.message || getDocumentStatusMessage(status),
        article: normalizeDocumentArticle(body?.article || {}),
        rawEvidence: body?.rawEvidence || null
      };
    }
    const article = normalizeDocumentArticle(body.article || {});
    let extractionStatus = body.extractionStatus || (hasUsefulDocumentDraft(article) ? "ai_draft" : "metadata_only");
    if (extractionStatus === "ai_draft" && !hasUsefulDocumentDraft(article)) {
      extractionStatus = article.title || article.sourceName || article.doi ? "metadata_only" : "failed";
    }
    return {
      ok: extractionStatus === "ai_draft" || extractionStatus === "metadata_only",
      extractionStatus,
      message: getDocumentStatusMessage(extractionStatus),
      article,
      rawEvidence: body.rawEvidence || null,
      error: body.error?.message || ""
    };
  } catch (error) {
    return {
      ok: false,
      extractionStatus: "failed",
      error: DOCUMENT_FAILED_MESSAGE,
      article: null,
      rawEvidence: null
    };
  }
}
