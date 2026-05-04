const crypto = require("crypto");
const pdfParse = require("pdf-parse");

const DOCUMENT_MODES = new Set(["pdf", "pasted_text"]);
const ACCESS_TYPES = ["Open access", "Suscripción", "Resumen disponible", "Pendiente"];
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MIN_DOCUMENT_TEXT_LENGTH = 500;
const MAX_PASTED_TEXT_CHARS = 80000;
const MAX_AI_TEXT_CHARS = 22000;
const DEFAULT_DOCUMENT_EXTRACTION_MODEL = "gpt-5.5";
const DOCUMENT_EXTRACTION_FALLBACK_MODEL = "gpt-4o-mini";
const SECTION_HEADINGS = [
  "abstract",
  "summary",
  "resumen",
  "introducción",
  "introduction",
  "background",
  "methods",
  "methodology",
  "search strategy",
  "strategy",
  "métodos",
  "metodos",
  "results",
  "resultados",
  "findings",
  "hallazgos",
  "framework",
  "quality framework",
  "implementation",
  "implementación",
  "implementacion",
  "discussion",
  "discusión",
  "discusion",
  "forward view",
  "view",
  "conclusion",
  "conclusions",
  "conclusiones",
  "limitations",
  "limitaciones"
];

const DOCUMENT_AI_ARTICLE_KEYS = [
  "title",
  "sourceName",
  "journal",
  "authors",
  "officialUrl",
  "doi",
  "publicationDate",
  "originalLanguage",
  "articleType",
  "evidenceType",
  "accessType",
  "cardSummaryEs",
  "executiveSummaryEs",
  "objectiveEs",
  "studyDesignEs",
  "studyContextEs",
  "studyPopulationEs",
  "studyLocationEs",
  "studyPeriodEs",
  "mainMessageEs",
  "keyPointsEs",
  "localApplicabilityEs",
  "occupationalHealthRelevanceEs",
  "limitationsEs",
  "tags",
  "warnings",
  "extractionConfidence"
];

const DOCUMENT_ARTICLE_KEYS = [
  ...DOCUMENT_AI_ARTICLE_KEYS,
  "studyType",
  "methodologyEs",
  "abstractSummaryEs",
  "clinicalQuestionEs",
  "mainResultEs",
  "sourcePages"
];

const cleanString = (value = "") => String(value || "").replace(/\s+/g, " ").trim();

const getConfiguredDocumentModels = ({ model = "" } = {}) =>
  Array.from(
    new Set(
      [
        cleanString(model) ||
          cleanString(process.env.OPENAI_DOCUMENT_MODEL) ||
          cleanString(process.env.OPENAI_MODEL) ||
          DEFAULT_DOCUMENT_EXTRACTION_MODEL,
        DOCUMENT_EXTRACTION_FALLBACK_MODEL
      ].filter(Boolean)
    )
  );

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

const isReferencesHeading = (line = "") => /^(references|referencias|bibliography|bibliografía|bibliografia)\s*:?$/i.test(cleanString(line));

const stripReferencesAndDenseTables = (text = "") => {
  const lines = cleanLongText(text).split(/\n+/);
  const kept = [];
  for (const rawLine of lines) {
    const line = cleanString(rawLine);
    if (isReferencesHeading(line)) break;
    const numericTokens = (line.match(/\b\d+(?:[.,]\d+)?\b/g) || []).length;
    const separators = (line.match(/[|;]/g) || []).length;
    if (line.length > 260 && numericTokens >= 10 && separators >= 3) continue;
    kept.push(rawLine);
  }
  return cleanLongText(kept.join("\n"));
};

const normalizeSectionHeading = (heading = "") => {
  const clean = cleanString(heading).toLowerCase();
  if (/summary|abstract|resumen/.test(clean)) return "Summary / Abstract";
  if (/intro|background|antecedentes/.test(clean)) return "Introduction / Background";
  if (/method|método|metodo|strategy|estrategia/.test(clean)) return "Methodology / Strategy";
  if (/result|finding|hallazgo|framework|quality|implementation|implementaci/.test(clean)) return "Framework / Findings";
  if (/discussion|discusi|forward|conclusion|conclusi/.test(clean)) return "Discussion / Forward view / Conclusion";
  if (/limitation|limitaci/.test(clean)) return "Limitations";
  return cleanString(heading) || "Texto principal";
};

const getSectionPriority = (heading = "") => {
  const normalized = normalizeSectionHeading(heading).toLowerCase();
  if (normalized.includes("summary") || normalized.includes("abstract")) return 0;
  if (normalized.includes("introduction") || normalized.includes("background")) return 1;
  if (normalized.includes("methodology") || normalized.includes("strategy")) return 2;
  if (normalized.includes("framework") || normalized.includes("findings")) return 3;
  if (normalized.includes("discussion") || normalized.includes("conclusion") || normalized.includes("forward")) return 4;
  if (normalized.includes("limitations")) return 5;
  return 8;
};

const extractSectionsFromText = (text = "") => {
  const normalized = stripReferencesAndDenseTables(text);
  const lines = normalized.split(/\n+/);
  const sections = [];
  let current = { heading: "Texto principal", text: "" };
  const headingRegex = new RegExp(`^(${SECTION_HEADINGS.join("|")})\\s*:?$`, "i");
  for (const rawLine of lines) {
    const line = cleanString(rawLine);
    if (!line) continue;
    if (isReferencesHeading(line)) break;
    if (headingRegex.test(line) && line.length <= 60) {
      if (cleanString(current.text).length >= 80) sections.push(current);
      current = { heading: normalizeSectionHeading(line), text: "" };
      continue;
    }
    current.text += `${line}\n`;
  }
  if (cleanString(current.text).length >= 80) sections.push(current);
  return sections.slice(0, 18).map((section) => ({
    heading: cleanString(section.heading),
    text: stripReferencesAndDenseTables(section.text).slice(0, getSectionPriority(section.heading) === 0 ? 6500 : 3600),
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
  const ordered = [...sections].sort((a, b) => getSectionPriority(a.heading) - getSectionPriority(b.heading));
  const combined = ordered.length
    ? ordered.map((section) => `${normalizeSectionHeading(section.heading)}\n${section.text}`).join("\n\n")
    : stripReferencesAndDenseTables(fullText);
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
  const cleanText = stripReferencesAndDenseTables(text);
  const sections = extractSectionsFromText(cleanText);
  const prioritySections = [...sections]
    .sort((a, b) => getSectionPriority(a.heading) - getSectionPriority(b.heading))
    .slice(0, 8)
    .map((section) => ({
      ...section,
      heading: normalizeSectionHeading(section.heading),
      text: cleanLongText(section.text).slice(0, getSectionPriority(section.heading) === 0 ? 6500 : 3600)
    }));
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
    sections: prioritySections.length ? prioritySections : sections,
    snippets: [
      {
        label: "Secciones editoriales priorizadas",
        text: selectEvidenceTextForAI(prioritySections.length ? prioritySections : sections, cleanText),
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
  objectiveEs: "",
  clinicalQuestionEs: "",
  mainMessageEs: "",
  mainResultEs: "",
  studyDesignEs: "",
  studyContextEs: "",
  studyPopulationEs: "",
  studyLocationEs: "",
  studyPeriodEs: "",
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
  documentContentType: packet.documentContentType || "",
  textLength: packet.textLength || 0,
  contentHash: packet.contentHash || "",
  storagePath: packet.storagePath || "",
  detectedFields: Object.entries(packet.detectedMetadata || {})
    .filter(([, value]) => (Array.isArray(value) ? value.length : Boolean(value)))
    .map(([key]) => key),
  extractedSections: (packet.sections || []).map((section) => section.heading).slice(0, 16),
  qualitySignals: packet.qualitySignals || {},
  modelUsed: cleanString(packet.modelUsed || "")
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
  article.objectiveEs = cleanString(
    input.objectiveEs || input.objective || input.purposeEs || input.clinicalQuestionEs || input.clinicalQuestion
  );
  article.clinicalQuestionEs = article.objectiveEs;
  article.mainMessageEs = cleanString(
    input.mainMessageEs || input.mainMessage || input.messageEs || input.mainResultEs || input.mainResult
  );
  article.mainResultEs = article.mainMessageEs;
  article.studyDesignEs = cleanString(input.studyDesignEs || input.studyDesign || input.designEs || input.methodologyEs);
  article.studyContextEs = cleanString(input.studyContextEs || input.studyContext || input.contextoEstudio);
  article.studyPopulationEs = cleanString(input.studyPopulationEs || input.studyPopulation || input.populationEs);
  article.studyLocationEs = cleanString(input.studyLocationEs || input.studyLocation || input.locationEs || metadata.studyLocation);
  article.studyPeriodEs = cleanString(input.studyPeriodEs || input.studyPeriod || input.periodEs);
  article.methodologyEs = article.studyDesignEs;
  article.keyPointsEs = normalizeList(input.keyPointsEs, 5);
  article.limitationsEs = cleanString(input.limitationsEs);
  article.localApplicabilityEs = cleanString(input.localApplicabilityEs);
  article.occupationalHealthRelevanceEs = cleanString(input.occupationalHealthRelevanceEs);
  article.tags = normalizeList(input.tags?.length ? input.tags : metadata.keywords, 8);
  article.sourcePages = normalizeSourcePages(input.sourcePages);
  article.extractionConfidence = Number.isFinite(Number(input.extractionConfidence))
    ? Math.max(0, Math.min(1, Number(input.extractionConfidence)))
    : 0;
  article.warnings = normalizeList(input.warnings, 10);
  return article;
};

const validateStructuredAIOutput = (article = {}) => {
  const invalid = [];
  DOCUMENT_AI_ARTICLE_KEYS.forEach((key) => {
    if (!(key in article)) invalid.push(key);
  });
  if (!Array.isArray(article.authors)) invalid.push("authors_type");
  if (!Array.isArray(article.keyPointsEs)) invalid.push("keyPointsEs_type");
  if (!Array.isArray(article.tags)) invalid.push("tags_type");
  if (!Array.isArray(article.warnings)) invalid.push("warnings_type");
  if (!ACCESS_TYPES.includes(article.accessType)) invalid.push("accessType");
  if (!Number.isFinite(Number(article.extractionConfidence))) invalid.push("extractionConfidence");
  return { ok: invalid.length === 0, invalid };
};

const scoreDocumentArticle = (article = {}) => {
  const useful = [
    cleanString(article.objectiveEs || article.clinicalQuestionEs).length >= 24,
    cleanString(article.studyDesignEs || article.methodologyEs).length >= 24,
    cleanString(article.studyContextEs).length >= 24,
    cleanString(article.mainMessageEs || article.mainResultEs).length >= 24,
    Boolean(cleanString(article.evidenceType)),
    Array.isArray(article.keyPointsEs) && article.keyPointsEs.length >= 3
  ].filter(Boolean).length;
  const hasTitle = Boolean(cleanString(article.title));
  const hasSource = Boolean(cleanString(article.sourceName || article.journal));
  const hasCard = cleanString(article.cardSummaryEs).length >= 24;
  const hasExecutiveSummary = cleanString(article.executiveSummaryEs).length >= 32;
  return {
    usefulFieldCount: useful,
    hasTitle,
    hasSource,
    hasCard,
    hasExecutiveSummary,
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
    score.hasExecutiveSummary &&
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
    fileSize: 0,
    documentContentType: "",
    textLength: 0,
    detectedFields: [],
    extractedSections: [],
    qualitySignals: {},
    ...(rawEvidence || {})
  },
  ...(error ? { error } : {})
});

const buildOpenAiDocumentPayload = (packet = {}, { model = "" } = {}) => ({
  model: cleanString(model) || DEFAULT_DOCUMENT_EXTRACTION_MODEL,
  temperature: 0.1,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "scientific_article_editorial_card",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: DOCUMENT_AI_ARTICLE_KEYS,
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
          evidenceType: { type: "string" },
          accessType: { type: "string", enum: ACCESS_TYPES },
          cardSummaryEs: {
            type: "string",
            description: "Resumen breve en español, máximo 280 caracteres, para mostrar en la tarjeta cerrada."
          },
          executiveSummaryEs: {
            type: "string",
            description: "Resumen ejecutivo en español, claro y profesional, máximo 120 palabras."
          },
          objectiveEs: {
            type: "string",
            description: "Objetivo, pregunta o propósito principal del documento."
          },
          studyDesignEs: {
            type: "string",
            description: "Diseño real del estudio o tipo de documento: ensayo clínico, cohorte, revisión, guía, consenso, health policy, marco de implementación, informe técnico u otro si corresponde."
          },
          studyContextEs: {
            type: "string",
            description: "Resumen breve de dónde, cuándo y en qué población/contexto se realizó o se basa el trabajo."
          },
          studyPopulationEs: {
            type: "string",
            description: "Población estudiada, población objetivo o actores/sistemas abordados. Dejar vacío o indicar no especificado si no hay evidencia."
          },
          studyLocationEs: {
            type: "string",
            description: "País, región, continente, institución, red sanitaria o ámbito explícito o claramente sustentado."
          },
          studyPeriodEs: {
            type: "string",
            description: "Período, año de recolección, implementación, revisión o publicación si está sustentado por el documento."
          },
          mainMessageEs: {
            type: "string",
            description: "Mensaje principal o conclusión práctica del documento."
          },
          keyPointsEs: {
            type: "array",
            items: { type: "string" },
            description: "Entre 3 y 5 puntos clave en español."
          },
          localApplicabilityEs: {
            type: "string",
            description: "Aplicabilidad prudente al contexto clínico, institucional o de gestión."
          },
          occupationalHealthRelevanceEs: {
            type: "string",
            description: "Relevancia para salud ocupacional o gestión sanitaria, si corresponde."
          },
          limitationsEs: {
            type: "string",
            description: "Limitaciones del documento o cautelas interpretativas."
          },
          tags: { type: "array", items: { type: "string" } },
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
        "Sos un agente experto en comunicación científica médica, lectura crítica inicial y síntesis editorial para una Bitácora Científica institucional. Tu tarea es transformar evidencia real extraída de un PDF o texto pegado en una ficha breve, clara y útil en español para médicos y equipos de salud. Respondé exclusivamente JSON válido conforme al schema. Todo texto editorial debe estar en español. Conservá título oficial, DOI, autores, revista e instituciones tal como aparecen. No inventes datos. No inventes DOI, autores, fecha, resultados, población, país ni período. No uses conocimiento externo. Sí podés sintetizar, traducir y ordenar ideas presentes en el documento. No traduzcas literalmente todo el paper. La ficha debe orientar al lector para decidir si quiere leer el artículo completo. El resumen breve debe ser corto y no superar 280 caracteres. El resumen ejecutivo debe ser claro, máximo 100 a 120 palabras. El mensaje principal debe ser una frase o párrafo corto. Los puntos clave deben ser 3 a 5, breves y accionables. Identificá el tipo real de estudio o documento con precisión. Si es un estudio clínico, indicá si es prospectivo, retrospectivo, transversal, cohorte, caso-control, ensayo clínico, multicéntrico u otro solo cuando esté sustentado. Si no es estudio clínico, no lo fuerces: clasificalo como guía, consenso, health policy, marco de implementación, revisión, informe técnico u otro tipo real. Siempre intentá extraer dónde y población: país/región, ámbito, población o contexto. Si no está especificado, dejá el campo vacío o indicá 'No especificado en el documento'. No hagas recomendaciones clínicas directas, no cambies protocolos institucionales y no presentes conclusiones como conducta obligatoria. Tags en español, salvo nombres propios como HEARTS, OPS u OMS."
    },
    {
      role: "user",
      content: `Analizá el siguiente evidencePacket extraído del documento y generá una ficha editorial científica en español para la Bitácora Científica:\n${JSON.stringify({
        mode: packet.mode,
        originalFileName: packet.originalFileName,
        officialUrl: packet.officialUrl,
        detectedLanguage: packet.detectedLanguage,
        pageCount: packet.pageCount,
        textLength: packet.textLength,
        detectedMetadata: packet.detectedMetadata,
        sections: (packet.sections || []).map((section) => ({
          heading: normalizeSectionHeading(section.heading),
          text: cleanLongText(section.text).slice(0, getSectionPriority(section.heading) === 0 ? 6500 : 3600),
          pages: section.pages || []
        })),
        snippets: (packet.snippets || []).map((snippet) => ({
          label: snippet.label,
          text: cleanLongText(snippet.text).slice(0, MAX_AI_TEXT_CHARS),
          pages: snippet.pages || []
        })),
        qualitySignals: packet.qualitySignals
      })}`
    }
  ]
});

const callDocumentExtractionAI = async (packet = {}, { apiKey = "", fetchImpl = fetch, model = "" } = {}) => {
  if (!apiKey) {
    return { ok: false, error: { code: "missing_openai_api_key", message: "El servicio de IA no está configurado en backend." } };
  }
  let lastError = { code: "ai_request_failed", message: "No se pudo conectar con el servicio de IA." };
  for (const candidateModel of getConfiguredDocumentModels({ model })) {
    const payload = buildOpenAiDocumentPayload(packet, { model: candidateModel });
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
        lastError = { code: "openai_error", message: `OpenAI respondió ${response.status}.`, modelUsed: candidateModel };
        continue;
      }
      const content = data?.choices?.[0]?.message?.content || data?.output_text || "";
      const parsed = typeof content === "string" ? parseJsonObjectFromText(content) : content;
      if (!parsed || typeof parsed !== "object") {
        lastError = { code: "invalid_ai_json", message: "La IA no devolvió JSON válido.", modelUsed: candidateModel };
        continue;
      }
      const validation = validateStructuredAIOutput(parsed);
      if (!validation.ok) {
        lastError = { code: "invalid_ai_schema", message: "La IA devolvió un schema incompleto.", modelUsed: candidateModel };
        continue;
      }
      return { ok: true, article: parsed, modelUsed: candidateModel };
    } catch (error) {
      lastError = { code: "ai_request_failed", message: "No se pudo conectar con el servicio de IA.", modelUsed: candidateModel };
    }
  }
  return { ok: false, error: lastError };
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
  documentModel = "",
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
  let documentContentType = "";
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
    documentContentType = pdfResult.contentType || "application/pdf";
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
  packet.documentContentType = documentContentType || (mode === "pdf" ? "application/pdf" : "text/plain");
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
  const ai = await callDocumentExtractionAI(packet, { apiKey, fetchImpl, model: documentModel });
  agentDurations.aiMs = now() - aiStart;
  packet.modelUsed = ai.modelUsed || ai.error?.modelUsed || "";

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
  DOCUMENT_AI_ARTICLE_KEYS,
  DOCUMENT_ARTICLE_KEYS,
  DEFAULT_DOCUMENT_EXTRACTION_MODEL,
  DOCUMENT_EXTRACTION_FALLBACK_MODEL,
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
  getConfiguredDocumentModels,
  normalizeAiDocumentOutput,
  parseJsonObjectFromText,
  resolveScientificArticleDocument,
  scoreDocumentArticle,
  validateStoragePathForUid
};
