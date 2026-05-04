const crypto = require("crypto");
const pdfParse = require("pdf-parse");

const DOCUMENT_MODES = new Set(["pdf", "pasted_text"]);
const ACCESS_TYPES = ["Open access", "Suscripción", "Resumen disponible", "Pendiente"];
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MIN_DOCUMENT_TEXT_LENGTH = 500;
const MAX_PASTED_TEXT_CHARS = 80000;
const MAX_AI_TEXT_CHARS = 22000;
const SECTION_HEADINGS = [
  "abstract",
  "summary",
  "resumen",
  "introducción",
  "introduction",
  "background",
  "methods",
  "methodology",
  "métodos",
  "metodos",
  "results",
  "resultados",
  "discussion",
  "discusión",
  "discusion",
  "conclusion",
  "conclusions",
  "conclusiones",
  "limitations",
  "limitaciones"
];

const DOCUMENT_ARTICLE_KEYS = [
  "title",
  "sourceName",
  "journal",
  "authors",
  "officialUrl",
  "doi",
  "publicationDate",
  "originalLanguage",
  "articleType",
  "studyType",
  "evidenceType",
  "accessType",
  "cardSummaryEs",
  "executiveSummaryEs",
  "abstractSummaryEs",
  "clinicalQuestionEs",
  "mainResultEs",
  "methodologyEs",
  "keyPointsEs",
  "limitationsEs",
  "localApplicabilityEs",
  "occupationalHealthRelevanceEs",
  "tags",
  "sourcePages",
  "extractionConfidence",
  "warnings"
];

const cleanString = (value = "") => String(value || "").replace(/\s+/g, " ").trim();

const cleanLongText = (value = "") =>
  String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const normalizeList = (value = [], limit = 14) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : String(value || "").split(/[,;|]/))
        .map(cleanString)
        .filter(Boolean)
    )
  ).slice(0, limit);

const hashText = (value = "") =>
  crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");

const safeFileName = (value = "") =>
  cleanString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120) || "documento.pdf";

const validatePublicUrl = (value = "") => {
  const raw = cleanString(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    ) {
      return "";
    }
    return url.href;
  } catch (error) {
    return "";
  }
};

const validateStoragePathForUid = (storagePath = "", uid = "") => {
  const path = cleanString(storagePath);
  const userId = cleanString(uid);
  if (!path || !userId) return { ok: false, code: "invalid_storage_path", message: "La ruta del PDF no es válida." };
  if (path.includes("..") || path.startsWith("/") || path.includes("//")) {
    return { ok: false, code: "invalid_storage_path", message: "La ruta del PDF no es válida." };
  }
  const prefix = `bitacora/article-documents/${userId}/`;
  if (!path.startsWith(prefix) || !path.toLowerCase().endsWith(".pdf")) {
    return { ok: false, code: "forbidden_storage_path", message: "No podés procesar archivos de otro usuario." };
  }
  return { ok: true, path };
};

const parseJsonObjectFromText = (text = "") => {
  const clean = cleanString(text);
  if (!clean) return null;
  try {
    return JSON.parse(clean);
  } catch (error) {}
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (error) {
    return null;
  }
};

const detectDoi = (text = "") => {
  const match = String(text || "").match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  return match ? cleanString(match[0]).replace(/[.,;]+$/g, "") : "";
};

const detectPublicationDate = (text = "") => {
  const patterns = [
    /\b(20\d{2}|19\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/,
    /\b(0?[1-9]|[12]\d|3[01])\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2}|19\d{2})\b/i,
    /\b(Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre)\s+(20\d{2}|19\d{2})\b/i,
    /\b(20\d{2}|19\d{2})\b/
  ];
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) return cleanString(match[0]);
  }
  return "";
};

const detectLanguage = (text = "") => {
  const clean = String(text || "").toLowerCase();
  const sample = clean.slice(0, 8000);
  const spanishHits = (sample.match(/\b(el|la|los|las|de|del|para|con|salud|pacientes|resultados|métodos|metodos|conclusiones)\b/g) || []).length;
  const englishHits = (sample.match(/\b(the|and|of|for|with|health|patients|results|methods|conclusions|background)\b/g) || []).length;
  if (spanishHits >= englishHits && spanishHits >= 8) return "es";
  if (englishHits > spanishHits && englishHits >= 8) return "en";
  return "und";
};

const firstNonEmptyLine = (text = "") =>
  String(text || "")
    .split(/\n+/)
    .map(cleanString)
    .find((line) => line.length >= 24 && line.length <= 260 && !/^doi\b/i.test(line)) || "";

const detectAuthors = (text = "") => {
  const lines = String(text || "")
    .split(/\n+/)
    .map(cleanString)
    .filter(Boolean)
    .slice(0, 16);
  const candidate = lines.find((line) => {
    const commaCount = (line.match(/,/g) || []).length;
    const hasInitial = /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-Z]\.)?\b/.test(line);
    return line.length <= 320 && commaCount >= 1 && hasInitial && !/abstract|summary|introduction|doi/i.test(line);
  });
  return candidate ? normalizeList(candidate, 24) : [];
};

const detectSourceName = (text = "", fallback = "") => {
  if (cleanString(fallback)) return cleanString(fallback);
  const lines = String(text || "")
    .split(/\n+/)
    .map(cleanString)
    .filter(Boolean)
    .slice(0, 40);
  const journalLine = lines.find((line) =>
    /\b(journal|revista|lancet|jama|bmj|nejm|cochrane|medicina|salud|health|medicine)\b/i.test(line) &&
    line.length <= 180
  );
  return journalLine || cleanString(fallback);
};

const detectKeywords = (text = "") => {
  const match = String(text || "").match(/(?:keywords|palabras clave|key words)\s*[:.-]\s*([^\n]{20,400})/i);
  return match ? normalizeList(match[1], 10) : [];
};

const extractSectionsFromText = (text = "") => {
  const normalized = cleanLongText(text);
  const lines = normalized.split(/\n+/);
  const sections = [];
  let current = { heading: "Texto principal", text: "" };
  const headingRegex = new RegExp(`^(${SECTION_HEADINGS.join("|")})\\s*:?$`, "i");
  for (const rawLine of lines) {
    const line = cleanString(rawLine);
    if (!line) continue;
    if (headingRegex.test(line) && line.length <= 60) {
      if (cleanString(current.text).length >= 80) sections.push(current);
      current = { heading: line, text: "" };
      continue;
    }
    current.text += `${line}\n`;
  }
  if (cleanString(current.text).length >= 80) sections.push(current);
  return sections.slice(0, 12).map((section) => ({
    heading: cleanString(section.heading),
    text: cleanLongText(section.text).slice(0, 4500),
    pages: []
  }));
};

const buildDetectedMetadata = ({ text = "", officialUrl = "", pastedSource = "" } = {}) => {
  const title = firstNonEmptyLine(text);
  const doi = detectDoi(text) || detectDoi(officialUrl);
  const authors = detectAuthors(text);
  const sourceName = detectSourceName(text, pastedSource);
  const publicationDate = detectPublicationDate(text);
  const keywords = detectKeywords(text);
  return {
    title,
    authors,
    sourceName,
    journal: sourceName,
    institution: "",
    publicationDate,
    doi,
    keywords,
    articleType: ""
  };
};

const buildQualitySignals = (sections = [], metadata = {}, text = "") => {
  const headings = sections.map((section) => section.heading.toLowerCase());
  const hasHeading = (patterns) => headings.some((heading) => patterns.some((pattern) => heading.includes(pattern)));
  const textLength = cleanString(text).length;
  return {
    hasTitle: Boolean(metadata.title),
    hasAbstractOrSummary: hasHeading(["abstract", "summary", "resumen"]) || /abstract|summary|resumen/i.test(text.slice(0, 4000)),
    hasMethods: hasHeading(["method", "método", "metodo"]),
    hasResults: hasHeading(["result", "resultado", "finding"]),
    hasReferences: /references|referencias/i.test(text.slice(-6000)),
    scannedOrLowText: textLength < MIN_DOCUMENT_TEXT_LENGTH
  };
};

const selectEvidenceTextForAI = (sections = [], fullText = "") => {
  const priority = ["abstract", "summary", "resumen", "introduction", "introducción", "methods", "métodos", "results", "resultados", "discussion", "conclusion", "conclusiones", "limitations"];
  const ordered = [...sections].sort((a, b) => {
    const ai = priority.findIndex((key) => a.heading.toLowerCase().includes(key));
    const bi = priority.findIndex((key) => b.heading.toLowerCase().includes(key));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const combined = ordered.length
    ? ordered.map((section) => `${section.heading}\n${section.text}`).join("\n\n")
    : cleanLongText(fullText);
  return combined.slice(0, MAX_AI_TEXT_CHARS);
};

const buildEvidencePacket = ({
  mode,
  originalFileName = "",
  officialUrl = "",
  uploadedBy = {},
  text = "",
  pageCount = 0,
  pastedSource = "",
  storagePath = ""
} = {}) => {
  const cleanText = cleanLongText(text);
  const sections = extractSectionsFromText(cleanText);
  const detectedMetadata = buildDetectedMetadata({ text: cleanText, officialUrl, pastedSource });
  const detectedLanguage = detectLanguage(cleanText);
  const qualitySignals = buildQualitySignals(sections, detectedMetadata, cleanText);
  const contentHash = hashText(cleanText);
  return {
    mode,
    originalFileName: cleanString(originalFileName),
    officialUrl: validatePublicUrl(officialUrl),
    storagePath: cleanString(storagePath),
    uploadedBy,
    detectedLanguage,
    pageCount: Number(pageCount) || 0,
    textLength: cleanText.length,
    contentHash,
    detectedMetadata,
    sections,
    snippets: [
      {
        label: "Contenido priorizado",
        text: selectEvidenceTextForAI(sections, cleanText),
        pages: []
      }
    ],
    qualitySignals
  };
};

const buildEmptyArticle = () => ({
  title: "",
  sourceName: "",
  journal: "",
  authors: [],
  officialUrl: "",
  doi: "",
  publicationDate: "",
  originalLanguage: "",
  articleType: "",
  studyType: "",
  evidenceType: "",
  accessType: "Pendiente",
  cardSummaryEs: "",
  executiveSummaryEs: "",
  abstractSummaryEs: "",
  clinicalQuestionEs: "",
  mainResultEs: "",
  methodologyEs: "",
  keyPointsEs: [],
  limitationsEs: "",
  localApplicabilityEs: "",
  occupationalHealthRelevanceEs: "",
  tags: [],
  sourcePages: [],
  extractionConfidence: 0,
  warnings: []
});

const buildRawEvidence = (packet = {}) => ({
  mode: packet.mode || "",
  originalFileName: packet.originalFileName || "",
  detectedLanguage: packet.detectedLanguage || "und",
  pageCount: packet.pageCount || 0,
  fileSize: packet.fileSize || 0,
  textLength: packet.textLength || 0,
  contentHash: packet.contentHash || "",
  storagePath: packet.storagePath || "",
  detectedFields: Object.entries(packet.detectedMetadata || {})
    .filter(([, value]) => (Array.isArray(value) ? value.length : Boolean(value)))
    .map(([key]) => key),
  extractedSections: (packet.sections || []).map((section) => section.heading).slice(0, 16),
  qualitySignals: packet.qualitySignals || {}
});

const normalizeSourcePages = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((item) => ({
      field: cleanString(item?.field).slice(0, 80),
      pages: (Array.isArray(item?.pages) ? item.pages : [])
        .map((page) => Number(page))
        .filter((page) => Number.isFinite(page) && page > 0)
        .slice(0, 12)
    }))
    .filter((item) => item.field)
    .slice(0, 20);

const normalizeAiDocumentOutput = (input = {}, packet = {}) => {
  const metadata = packet.detectedMetadata || {};
  const article = buildEmptyArticle();
  article.title = cleanString(input.title) || metadata.title || "";
  article.sourceName = cleanString(input.sourceName) || metadata.sourceName || metadata.journal || "";
  article.journal = cleanString(input.journal) || metadata.journal || article.sourceName;
  article.authors = normalizeList(input.authors?.length ? input.authors : metadata.authors, 30);
  article.officialUrl = packet.officialUrl || validatePublicUrl(input.officialUrl);
  article.doi = metadata.doi || "";
  article.publicationDate = metadata.publicationDate ? metadata.publicationDate : "";
  article.originalLanguage = cleanString(input.originalLanguage) || packet.detectedLanguage || "";
  article.articleType = cleanString(input.articleType || metadata.articleType);
  article.studyType = cleanString(input.studyType);
  article.evidenceType = cleanString(input.evidenceType);
  article.accessType = ACCESS_TYPES.includes(input.accessType) ? input.accessType : "Pendiente";
  article.cardSummaryEs = cleanString(input.cardSummaryEs);
  article.executiveSummaryEs = cleanString(input.executiveSummaryEs);
  article.abstractSummaryEs = cleanString(input.abstractSummaryEs);
  article.clinicalQuestionEs = cleanString(input.clinicalQuestionEs);
  article.mainResultEs = cleanString(input.mainResultEs);
  article.methodologyEs = cleanString(input.methodologyEs);
  article.keyPointsEs = normalizeList(input.keyPointsEs, 8);
  article.limitationsEs = cleanString(input.limitationsEs);
  article.localApplicabilityEs = cleanString(input.localApplicabilityEs);
  article.occupationalHealthRelevanceEs = cleanString(input.occupationalHealthRelevanceEs);
  article.tags = normalizeList(input.tags?.length ? input.tags : metadata.keywords, 12);
  article.sourcePages = normalizeSourcePages(input.sourcePages);
  article.extractionConfidence = Number.isFinite(Number(input.extractionConfidence))
    ? Math.max(0, Math.min(1, Number(input.extractionConfidence)))
    : 0;
  article.warnings = normalizeList(input.warnings, 10);
  return article;
};

const validateStructuredAIOutput = (article = {}) => {
  const invalid = [];
  DOCUMENT_ARTICLE_KEYS.forEach((key) => {
    if (!(key in article)) invalid.push(key);
  });
  if (!Array.isArray(article.authors)) invalid.push("authors_type");
  if (!Array.isArray(article.keyPointsEs)) invalid.push("keyPointsEs_type");
  if (!Array.isArray(article.tags)) invalid.push("tags_type");
  if (!Array.isArray(article.sourcePages)) invalid.push("sourcePages_type");
  if (!Array.isArray(article.warnings)) invalid.push("warnings_type");
  if (!ACCESS_TYPES.includes(article.accessType)) invalid.push("accessType");
  if (!Number.isFinite(Number(article.extractionConfidence))) invalid.push("extractionConfidence");
  return { ok: invalid.length === 0, invalid };
};

const scoreDocumentArticle = (article = {}) => {
  const useful = [
    cleanString(article.executiveSummaryEs).length >= 32,
    cleanString(article.clinicalQuestionEs).length >= 24,
    cleanString(article.mainResultEs).length >= 24,
    cleanString(article.methodologyEs).length >= 24,
    Boolean(cleanString(article.evidenceType)),
    Boolean(cleanString(article.studyType))
  ].filter(Boolean).length;
  const hasTitle = Boolean(cleanString(article.title));
  const hasSource = Boolean(cleanString(article.sourceName || article.journal));
  const hasCard = cleanString(article.cardSummaryEs).length >= 24;
  return {
    usefulFieldCount: useful,
    hasTitle,
    hasSource,
    hasCard,
    completedFields: DOCUMENT_ARTICLE_KEYS.filter((key) => {
      const value = article[key];
      return Array.isArray(value) ? value.length > 0 : Boolean(cleanString(value));
    })
  };
};

const computeExtractionStatus = (article = {}) => {
  const score = scoreDocumentArticle(article);
  if (
    score.hasTitle &&
    score.hasSource &&
    score.hasCard &&
    score.usefulFieldCount >= 2 &&
    Number(article.extractionConfidence || 0) >= 0.55
  ) {
    return "ai_draft";
  }
  if (score.hasTitle || score.hasSource || article.doi || article.publicationDate) {
    return "metadata_only";
  }
  return "failed";
};

const buildDocumentExtractionResponse = ({ extractionStatus, article, rawEvidence, error } = {}) => ({
  ok: extractionStatus === "ai_draft" || extractionStatus === "metadata_only",
  extractionStatus: extractionStatus || "failed",
  article: {
    ...buildEmptyArticle(),
    ...(article || {})
  },
  rawEvidence: {
    mode: "",
    originalFileName: "",
    detectedLanguage: "und",
    pageCount: 0,
    textLength: 0,
    detectedFields: [],
    extractedSections: [],
    qualitySignals: {},
    ...(rawEvidence || {})
  },
  ...(error ? { error } : {})
});

const buildOpenAiDocumentPayload = (packet = {}) => ({
  model: "gpt-4o-mini",
  temperature: 0.1,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "scientific_article_document_extraction",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: DOCUMENT_ARTICLE_KEYS,
        properties: {
          title: { type: "string" },
          sourceName: { type: "string" },
          journal: { type: "string" },
          authors: { type: "array", items: { type: "string" } },
          officialUrl: { type: "string" },
          doi: { type: "string" },
          publicationDate: { type: "string" },
          originalLanguage: { type: "string" },
          articleType: { type: "string" },
          studyType: { type: "string" },
          evidenceType: { type: "string" },
          accessType: { type: "string", enum: ACCESS_TYPES },
          cardSummaryEs: { type: "string" },
          executiveSummaryEs: { type: "string" },
          abstractSummaryEs: { type: "string" },
          clinicalQuestionEs: { type: "string" },
          mainResultEs: { type: "string" },
          methodologyEs: { type: "string" },
          keyPointsEs: { type: "array", items: { type: "string" } },
          limitationsEs: { type: "string" },
          localApplicabilityEs: { type: "string" },
          occupationalHealthRelevanceEs: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          sourcePages: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["field", "pages"],
              properties: {
                field: { type: "string" },
                pages: { type: "array", items: { type: "number" } }
              }
            }
          },
          warnings: { type: "array", items: { type: "string" } },
          extractionConfidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    }
  },
  messages: [
    {
      role: "system",
      content:
        "Sos un agente experto en lectura crítica inicial de publicaciones científicas médicas para una Bitácora Científica institucional. Respondé exclusivamente JSON válido conforme al schema. Todo texto explicativo debe estar en español. No inventes datos ni uses conocimiento externo. Conservá títulos oficiales, nombres de revistas, instituciones, autores y DOI tal como aparecen. No hagas recomendaciones clínicas directas ni modifiques protocolos. Si falta información, devolvé string vacío y agregá warning."
    },
    {
      role: "user",
      content: `Analizá este evidencePacket y generá una ficha estructurada para revisión humana:\n${JSON.stringify({
        ...packet,
        snippets: (packet.snippets || []).map((snippet) => ({
          ...snippet,
          text: cleanLongText(snippet.text).slice(0, MAX_AI_TEXT_CHARS)
        }))
      })}`
    }
  ]
});

const callDocumentExtractionAI = async (packet = {}, { apiKey = "", fetchImpl = fetch } = {}) => {
  if (!apiKey) {
    return { ok: false, error: { code: "missing_openai_api_key", message: "El servicio de IA no está configurado en backend." } };
  }
  const payload = buildOpenAiDocumentPayload(packet);
  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
    const raw = await response.text();
    const data = parseJsonObjectFromText(raw);
    if (!response.ok) {
      return { ok: false, error: { code: "openai_error", message: `OpenAI respondió ${response.status}.` } };
    }
    const content = data?.choices?.[0]?.message?.content || data?.output_text || "";
    const parsed = typeof content === "string" ? parseJsonObjectFromText(content) : content;
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: { code: "invalid_ai_json", message: "La IA no devolvió JSON válido." } };
    }
    const validation = validateStructuredAIOutput(parsed);
    if (!validation.ok) {
      return { ok: false, error: { code: "invalid_ai_schema", message: "La IA devolvió un schema incompleto." } };
    }
    return { ok: true, article: parsed };
  } catch (error) {
    return { ok: false, error: { code: "ai_request_failed", message: "No se pudo conectar con el servicio de IA." } };
  }
};

const extractPdfTextFromStorage = async ({ bucket, storagePath, pdfParseImpl = pdfParse } = {}) => {
  const file = bucket.file(storagePath);
  const [metadata] = await file.getMetadata();
  const contentType = cleanString(metadata?.contentType);
  const fileSize = Number(metadata?.size || 0);
  if (contentType !== "application/pdf") {
    return { ok: false, error: { code: "invalid_pdf_type", message: "El archivo no es PDF." } };
  }
  if (!fileSize || fileSize > MAX_PDF_BYTES) {
    return { ok: false, error: { code: "pdf_too_large", message: "El archivo supera el tamaño permitido." } };
  }
  const [buffer] = await file.download();
  const parsed = await pdfParseImpl(buffer);
  return {
    ok: true,
    text: cleanLongText(parsed?.text || ""),
    pageCount: Number(parsed?.numpages || 0),
    fileSize,
    contentType
  };
};

const buildUploadedBy = (user = {}) => ({
  uid: cleanString(user.uid),
  displayName: cleanString(user.displayName || user.name || user.email),
  email: cleanString(user.email)
});

const resolveScientificArticleDocument = async (input = {}, {
  uid = "",
  user = {},
  bucket = null,
  apiKey = "",
  fetchImpl = fetch,
  pdfParseImpl = pdfParse,
  now = () => Date.now()
} = {}) => {
  const startedAt = now();
  const agentDurations = {};
  const warnings = [];
  const mode = cleanString(input.mode);
  if (!DOCUMENT_MODES.has(mode)) {
    return buildDocumentExtractionResponse({
      extractionStatus: "failed",
      article: { ...buildEmptyArticle(), warnings: ["Modo de extracción no válido."] },
      rawEvidence: { mode },
      error: { code: "invalid_mode", message: "Modo de extracción no válido." }
    });
  }

  let text = "";
  let pageCount = 0;
  let fileSize = 0;
  let storagePath = "";
  const ingestionStart = now();
  const officialUrl = validatePublicUrl(input.officialUrl);

  if (mode === "pdf") {
    const pathValidation = validateStoragePathForUid(input.storagePath, uid);
    if (!pathValidation.ok) {
      return buildDocumentExtractionResponse({
        extractionStatus: "failed",
        article: { ...buildEmptyArticle(), warnings: [pathValidation.message] },
        rawEvidence: { mode, originalFileName: cleanString(input.originalFileName) },
        error: { code: pathValidation.code, message: pathValidation.message }
      });
    }
    if (!bucket) {
      return buildDocumentExtractionResponse({
        extractionStatus: "failed",
        article: { ...buildEmptyArticle(), warnings: ["Firebase Storage no está disponible en backend."] },
        rawEvidence: { mode, originalFileName: cleanString(input.originalFileName) },
        error: { code: "storage_unavailable", message: "Firebase Storage no está disponible en backend." }
      });
    }
    storagePath = pathValidation.path;
    const pdfResult = await extractPdfTextFromStorage({ bucket, storagePath, pdfParseImpl });
    if (!pdfResult.ok) {
      return buildDocumentExtractionResponse({
        extractionStatus: "failed",
        article: { ...buildEmptyArticle(), warnings: [pdfResult.error.message] },
        rawEvidence: { mode, originalFileName: cleanString(input.originalFileName), storagePath },
        error: pdfResult.error
      });
    }
    text = pdfResult.text;
    pageCount = pdfResult.pageCount;
    fileSize = pdfResult.fileSize;
  } else {
    text = cleanLongText(input.pastedText || "");
    if (text.length < MIN_DOCUMENT_TEXT_LENGTH) {
      return buildDocumentExtractionResponse({
        extractionStatus: "failed",
        article: { ...buildEmptyArticle(), warnings: ["El texto pegado es demasiado breve para generar una ficha confiable."] },
        rawEvidence: { mode, textLength: text.length },
        error: { code: "text_too_short", message: "El texto pegado es demasiado breve para generar una ficha confiable." }
      });
    }
    if (text.length > MAX_PASTED_TEXT_CHARS) {
      warnings.push("El texto pegado superó el límite; se analizó una versión truncada.");
      text = text.slice(0, MAX_PASTED_TEXT_CHARS);
    }
  }
  agentDurations.ingestionMs = now() - ingestionStart;

  const metadataStart = now();
  const packet = buildEvidencePacket({
    mode,
    originalFileName: input.originalFileName || safeFileName(input.storagePath || ""),
    officialUrl,
    uploadedBy: buildUploadedBy({ ...user, uid }),
    text,
    pageCount,
    pastedSource: input.pastedSource,
    storagePath
  });
  agentDurations.metadataMs = now() - metadataStart;
  agentDurations.structureMs = 0;
  packet.fileSize = fileSize;
  packet.warnings = warnings;
  packet.agentDurations = agentDurations;

  if (packet.textLength < MIN_DOCUMENT_TEXT_LENGTH || packet.qualitySignals.scannedOrLowText) {
    const article = {
      ...buildEmptyArticle(),
      title: packet.detectedMetadata.title,
      sourceName: packet.detectedMetadata.sourceName,
      journal: packet.detectedMetadata.journal,
      authors: packet.detectedMetadata.authors,
      officialUrl: packet.officialUrl,
      doi: packet.detectedMetadata.doi,
      publicationDate: packet.detectedMetadata.publicationDate,
      originalLanguage: packet.detectedLanguage,
      warnings: [
        mode === "pdf"
          ? "El PDF no contiene texto extraíble suficiente. Puede requerir OCR o carga manual."
          : "No se detectó contenido científico suficiente."
      ],
      extractionConfidence: 0.12
    };
    agentDurations.validationMs = now() - startedAt;
    return buildDocumentExtractionResponse({
      extractionStatus: computeExtractionStatus(article),
      article,
      rawEvidence: { ...buildRawEvidence(packet), agentDurations },
      error: { code: "insufficient_text", message: "No se pudo extraer texto suficiente." }
    });
  }

  if (!apiKey) {
    return buildDocumentExtractionResponse({
      extractionStatus: "not_configured",
      article: {
        ...buildEmptyArticle(),
        title: packet.detectedMetadata.title,
        sourceName: packet.detectedMetadata.sourceName,
        journal: packet.detectedMetadata.journal,
        authors: packet.detectedMetadata.authors,
        officialUrl: packet.officialUrl,
        doi: packet.detectedMetadata.doi,
        publicationDate: packet.detectedMetadata.publicationDate,
        originalLanguage: packet.detectedLanguage,
        warnings: ["El servicio de IA no está configurado en backend."]
      },
      rawEvidence: { ...buildRawEvidence(packet), agentDurations },
      error: { code: "missing_openai_api_key", message: "El servicio de IA no está configurado en backend." }
    });
  }

  const aiStart = now();
  const ai = await callDocumentExtractionAI(packet, { apiKey, fetchImpl });
  agentDurations.aiMs = now() - aiStart;

  if (!ai.ok) {
    const article = {
      ...buildEmptyArticle(),
      title: packet.detectedMetadata.title,
      sourceName: packet.detectedMetadata.sourceName,
      journal: packet.detectedMetadata.journal,
      authors: packet.detectedMetadata.authors,
      officialUrl: packet.officialUrl,
      doi: packet.detectedMetadata.doi,
      publicationDate: packet.detectedMetadata.publicationDate,
      originalLanguage: packet.detectedLanguage,
      warnings: ["La IA no pudo generar una ficha confiable.", ...(packet.warnings || [])],
      extractionConfidence: 0.22
    };
    return buildDocumentExtractionResponse({
      extractionStatus: computeExtractionStatus(article),
      article,
      rawEvidence: { ...buildRawEvidence(packet), agentDurations },
      error: ai.error
    });
  }

  const article = normalizeAiDocumentOutput(ai.article, packet);
  article.warnings = Array.from(new Set([...(packet.warnings || []), ...(article.warnings || [])])).slice(0, 10);
  const status = computeExtractionStatus(article);
  if (status !== "ai_draft") {
    article.warnings.push("La IA no detectó suficientes campos útiles para generar una ficha final.");
  }
  agentDurations.validationMs = now() - startedAt;
  return buildDocumentExtractionResponse({
    extractionStatus: status,
    article,
    rawEvidence: { ...buildRawEvidence(packet), agentDurations },
    error: status === "failed" ? { code: "insufficient_document_fields", message: "No se detectó contenido científico suficiente." } : undefined
  });
};

module.exports = {
  ACCESS_TYPES,
  DOCUMENT_ARTICLE_KEYS,
  MAX_PDF_BYTES,
  MAX_PASTED_TEXT_CHARS,
  MIN_DOCUMENT_TEXT_LENGTH,
  buildDocumentExtractionResponse,
  buildEvidencePacket,
  buildOpenAiDocumentPayload,
  buildRawEvidence,
  callDocumentExtractionAI,
  cleanLongText,
  computeExtractionStatus,
  detectDoi,
  detectLanguage,
  extractSectionsFromText,
  normalizeAiDocumentOutput,
  parseJsonObjectFromText,
  resolveScientificArticleDocument,
  scoreDocumentArticle,
  validateStoragePathForUid
};
