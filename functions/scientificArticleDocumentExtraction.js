const crypto = require("crypto");
const pdfParse = require("pdf-parse");
const {
  EVIDENCE_SUPPORT_FIELDS,
  METHODOLOGY_BOOLEAN_FIELDS,
  METHODOLOGY_LIST_FIELDS,
  METHODOLOGY_OBJECT_FIELDS,
  METHODOLOGY_PROFILE_KEYS,
  SCIENTIFIC_METHODOLOGY_TAXONOMY,
  STUDY_FAMILIES,
  buildEmptyMethodologyProfile,
  buildMethodologyEvidence,
  inferDesignCategoryFromProfile,
  normalizeMethodologyProfile,
  preclassifyMethodology
} = require("./scientificMethodologyTaxonomy");

const DOCUMENT_MODES = new Set(["pdf", "pasted_text"]);
const ACCESS_TYPES = ["Open access", "Suscripción", "Resumen disponible", "Pendiente"];
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MIN_DOCUMENT_TEXT_LENGTH = 500;
const MAX_PASTED_TEXT_CHARS = 80000;
const MAX_AI_TEXT_CHARS = 22000;
const DEFAULT_DOCUMENT_EXTRACTION_MODEL = "gpt-5.5";
const DOCUMENT_EXTRACTION_FALLBACK_MODEL = "gpt-4o-mini";
const EXPANDED_DESCRIPTION_QUALITY_VALUES = ["complete", "partial", "insufficient"];
const EXPANDED_DESCRIPTION_MIN_WORDS = 280;
const EXPANDED_DESCRIPTION_COMPLETE_WORDS = 300;
const EXPANDED_DESCRIPTION_MAX_WORDS = 650;
const SECTION_HEADINGS = [
  "abstract",
  "summary",
  "resumen",
  "introducción",
  "introduction",
  "background",
  "population",
  "participants",
  "setting",
  "población",
  "poblacion",
  "participantes",
  "ámbito",
  "ambito",
  "methods",
  "methodology",
  "search strategy",
  "selection criteria",
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
  "briefDescriptionEs",
  "expandedDescriptionEs",
  "expandedDescriptionSections",
  "expandedDescriptionQuality",
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
  "methodologyProfile",
  "tags",
  "warnings",
  "extractionConfidence"
];

const DOCUMENT_CORE_AI_ARTICLE_KEYS = [
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
  "briefDescriptionEs",
  "expandedDescriptionEs",
  "expandedDescriptionSections",
  "expandedDescriptionQuality",
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

const stripHtml = (value = "") =>
  String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");

const countWords = (value = "") =>
  cleanString(value)
    .split(/\s+/)
    .filter((word) => /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/.test(word)).length;

const limitWords = (value = "", maxWords = EXPANDED_DESCRIPTION_MAX_WORDS) => {
  const words = cleanString(value).split(/\s+/).filter(Boolean);
  return words.length > maxWords ? words.slice(0, maxWords).join(" ") : words.join(" ");
};

const sanitizeEditorialText = (value = "", { maxChars = 6000, maxWords = 0 } = {}) => {
  const clean = cleanString(stripHtml(value)).slice(0, maxChars);
  return maxWords ? limitWords(clean, maxWords) : clean;
};

const normalizeExpandedDescriptionQuality = (value = "") =>
  EXPANDED_DESCRIPTION_QUALITY_VALUES.includes(cleanString(value)) ? cleanString(value) : "";

const normalizeExpandedDescriptionSections = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((section) => ({
      heading: sanitizeEditorialText(section?.heading, { maxChars: 50 }),
      body: sanitizeEditorialText(section?.body, { maxChars: 1200, maxWords: 130 })
    }))
    .filter((section) => section.heading && section.body)
    .slice(0, 6);

const buildExpandedDescriptionFromSections = (sections = []) =>
  limitWords(
    normalizeExpandedDescriptionSections(sections)
      .map((section) => `${section.heading}\n${section.body}`)
      .join("\n\n"),
    EXPANDED_DESCRIPTION_MAX_WORDS
  );

const getExpandedDescriptionText = (article = {}) =>
  sanitizeEditorialText(article.expandedDescriptionEs || article.executiveSummaryEs || "", {
    maxChars: 6000,
    maxWords: EXPANDED_DESCRIPTION_MAX_WORDS
  });

const hasSubstantialEvidenceForExpandedDescription = (packet = {}) => {
  const signals = packet.qualitySignals || {};
  const sectionCount = (packet.sections || []).filter((section) => cleanString(section.text).length >= 300).length;
  return Boolean(
    Number(packet.textLength || 0) >= 2500 ||
      (Number(packet.textLength || 0) >= 1500 && (signals.hasAbstractOrSummary || signals.hasMethods || signals.hasResults)) ||
      sectionCount >= 3
  );
};

const isGenericExpandedDescription = (text = "") =>
  /el documento trata sobre un tema importante|el estudio aporta información relevante|se recomienda leer el artículo completo|este artículo habla de/i.test(
    cleanString(text)
  );

const scoreExpandedDescriptionCues = (text = "", article = {}) => {
  const haystack = cleanString(`${text} ${article.studyDesignEs || ""} ${article.articleType || ""} ${article.evidenceType || ""}`).toLowerCase();
  return [
    /contexto|problema|antecedente|sanitari|clínic|clinico|salud/.test(haystack),
    /tipo de documento|documento|revisión|revision|seminar|policy|guía|guia|consenso|cohorte|ensayo|transversal|metaanálisis|metaanalisis|diseño|diseno/.test(haystack),
    /población|poblacion|participantes|pacientes|ámbito|ambito|centros|país|pais|región|region|instituci/.test(haystack),
    /método|metodo|metodolog|evaluó|evaluo|variables|intervención|intervencion|exposición|exposicion|seguimiento|análisis|analisis/.test(haystack),
    /hallazgo|resultado|mensaje|conclusi|encontró|encontro|identific/.test(haystack),
    /aplicabilidad|relevancia|práctica|practica|implicancia|cautela|limitaci/.test(haystack)
  ].filter(Boolean).length;
};

const validateExpandedDescriptionQuality = (article = {}, packet = {}) => {
  const sections = normalizeExpandedDescriptionSections(article.expandedDescriptionSections);
  const text = getExpandedDescriptionText(article) || buildExpandedDescriptionFromSections(sections);
  const words = countWords(text);
  const hasEvidence = hasSubstantialEvidenceForExpandedDescription(packet);
  const repeatsBrief =
    cleanString(article.briefDescriptionEs || article.cardSummaryEs).length >= 80 &&
    cleanString(text).toLowerCase() === cleanString(article.briefDescriptionEs || article.cardSummaryEs).toLowerCase();
  const cueCount = scoreExpandedDescriptionCues(text, article);

  if (!text || isGenericExpandedDescription(text) || repeatsBrief) {
    return { quality: "insufficient", wordCount: words, cueCount, sections };
  }
  if (
    words >= EXPANDED_DESCRIPTION_COMPLETE_WORDS &&
    words <= EXPANDED_DESCRIPTION_MAX_WORDS &&
    sections.length >= 4 &&
    sections.length <= 6 &&
    cueCount >= 4
  ) {
    return { quality: "complete", wordCount: words, cueCount, sections };
  }
  if (hasEvidence && words < EXPANDED_DESCRIPTION_MIN_WORDS) {
    return { quality: "insufficient", wordCount: words, cueCount, sections };
  }
  if (words >= 120 || sections.length >= 2 || cueCount >= 3) {
    return { quality: "partial", wordCount: words, cueCount, sections };
  }
  return { quality: "insufficient", wordCount: words, cueCount, sections };
};

const finalizeExpandedDescriptionFields = (article = {}, packet = {}) => {
  const next = { ...article };
  next.briefDescriptionEs = sanitizeEditorialText(next.briefDescriptionEs || next.cardSummaryEs, { maxChars: 280 });
  next.cardSummaryEs = sanitizeEditorialText(next.cardSummaryEs || next.briefDescriptionEs, { maxChars: 280 });
  next.expandedDescriptionSections = normalizeExpandedDescriptionSections(next.expandedDescriptionSections);
  const fromSections = buildExpandedDescriptionFromSections(next.expandedDescriptionSections);
  next.expandedDescriptionEs = getExpandedDescriptionText(next) || fromSections;
  next.executiveSummaryEs = sanitizeEditorialText(next.executiveSummaryEs || next.expandedDescriptionEs, {
    maxChars: 6000,
    maxWords: EXPANDED_DESCRIPTION_MAX_WORDS
  });
  if (!next.expandedDescriptionEs && next.executiveSummaryEs) next.expandedDescriptionEs = next.executiveSummaryEs;
  if (!next.executiveSummaryEs && next.expandedDescriptionEs) next.executiveSummaryEs = next.expandedDescriptionEs;
  const assessed = validateExpandedDescriptionQuality(next, packet);
  next.expandedDescriptionQuality = assessed.quality;
  return next;
};

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
  if (/population|participant|setting|poblaci|participante|ámbito|ambito/.test(clean)) return "Population / Setting";
  if (/search|selection|criteria|búsqueda|busqueda|selección|seleccion/.test(clean)) return "Search strategy / Selection criteria";
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
  if (normalized.includes("population") || normalized.includes("setting")) return 2;
  if (normalized.includes("methodology") || normalized.includes("strategy") || normalized.includes("selection")) return 3;
  if (normalized.includes("framework") || normalized.includes("findings")) return 4;
  if (normalized.includes("discussion") || normalized.includes("conclusion") || normalized.includes("forward")) return 5;
  if (normalized.includes("limitations")) return 6;
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

const splitSentences = (text = "") =>
  cleanLongText(text)
    .split(/(?<=[.!?])\s+/)
    .map(cleanString)
    .filter((sentence) => sentence.length >= 20);

const getSummaryEvidenceText = (packet = {}) => {
  const summarySection = (packet.sections || []).find((section) =>
    /summary|abstract|resumen/i.test(section.heading)
  );
  if (summarySection?.text) return cleanLongText(summarySection.text).slice(0, 1800);
  const summaryBucket = packet.methodologyEvidence?.abstractOrSummary?.text;
  if (summaryBucket) return cleanLongText(summaryBucket).slice(0, 1800);
  const snippet = packet.snippets?.[0]?.text || "";
  return cleanLongText(snippet).slice(0, 1800);
};

const buildDeterministicDocumentFallback = (packet = {}, {
  warnings = [],
  extractionConfidence = 0.24
} = {}) => {
  const metadata = packet.detectedMetadata || {};
  const summaryText = getSummaryEvidenceText(packet);
  const summarySentences = splitSentences(summaryText);
  const preclassification = packet.preclassification || {};
  const likelyDesign = cleanString(preclassification.likelyDesigns?.[0]);
  const family = cleanString(preclassification.possibleFamilies?.[0]);
  const taxonomyFamily = family ? SCIENTIFIC_METHODOLOGY_TAXONOMY[family] : null;
  const spanishSummaryAvailable = packet.detectedLanguage === "es";
  const briefDescriptionEs = spanishSummaryAvailable ? cleanString(summarySentences.slice(0, 1).join(" ")).slice(0, 280) : "";
  const expandedDescriptionEs = spanishSummaryAvailable
    ? sanitizeEditorialText(summarySentences.slice(0, 8).join(" "), { maxChars: 3000, maxWords: EXPANDED_DESCRIPTION_MAX_WORDS })
    : "";
  const expandedDescriptionSections =
    spanishSummaryAvailable && expandedDescriptionEs
      ? [
          {
            heading: "Síntesis disponible",
            body: expandedDescriptionEs
          }
        ]
      : [];
  const objectiveEs = spanishSummaryAvailable ? cleanString(summarySentences.slice(0, 2).join(" ")).slice(0, 500) : "";

  const article = {
    ...buildEmptyArticle(),
    title: metadata.title || "",
    sourceName: metadata.sourceName || metadata.journal || "",
    journal: metadata.journal || metadata.sourceName || "",
    authors: normalizeList(metadata.authors, 30),
    officialUrl: packet.officialUrl || "",
    doi: metadata.doi || "",
    publicationDate: metadata.publicationDate || "",
    originalLanguage: packet.detectedLanguage || "und",
    articleType: metadata.articleType || likelyDesign || "",
    evidenceType: taxonomyFamily?.labelEs || likelyDesign || "",
    accessType: "Pendiente",
    briefDescriptionEs,
    expandedDescriptionEs,
    expandedDescriptionSections,
    expandedDescriptionQuality: expandedDescriptionEs ? "partial" : "insufficient",
    cardSummaryEs: briefDescriptionEs,
    executiveSummaryEs: expandedDescriptionEs,
    abstractSummaryEs: summaryText,
    objectiveEs,
    clinicalQuestionEs: objectiveEs,
    mainMessageEs: "",
    mainResultEs: "",
    studyDesignEs: likelyDesign || taxonomyFamily?.labelEs || "",
    studyContextEs: "",
    methodologyEs: likelyDesign || taxonomyFamily?.labelEs || "",
    tags: normalizeList(metadata.keywords, 8),
    extractionConfidence,
    warnings: normalizeList(warnings, 10)
  };

  article.methodologyProfile = normalizeMethodologyProfile({
    ...buildEmptyMethodologyProfile(),
    studyFamily: STUDY_FAMILIES.includes(family) ? family : "",
    studyFamilyEs: taxonomyFamily?.labelEs || "",
    specificDesign: likelyDesign,
    designCategoryEs: likelyDesign || taxonomyFamily?.labelEs || "",
    classificationRationale: preclassification.classificationRationale || "",
    methodologyWarnings: preclassification.warnings || []
  });
  return article;
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
    .slice(0, 10)
    .map((section) => ({
      ...section,
      heading: normalizeSectionHeading(section.heading),
      text: cleanLongText(section.text).slice(0, getSectionPriority(section.heading) === 0 ? 6500 : 3600)
    }));
  const detectedMetadata = buildDetectedMetadata({ text: cleanText, officialUrl, pastedSource });
  const detectedLanguage = detectLanguage(cleanText);
  const qualitySignals = buildQualitySignals(sections, detectedMetadata, cleanText);
  const contentHash = hashText(cleanText);
  const basePacket = {
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
  basePacket.methodologyEvidence = buildMethodologyEvidence({ ...basePacket, fullText: cleanText });
  basePacket.preclassification = preclassifyMethodology(basePacket, SCIENTIFIC_METHODOLOGY_TAXONOMY);
  return basePacket;
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
  briefDescriptionEs: "",
  expandedDescriptionEs: "",
  expandedDescriptionSections: [],
  expandedDescriptionQuality: "insufficient",
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
  methodologyProfile: buildEmptyMethodologyProfile(),
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
  methodologyEvidenceSections: Object.entries(packet.methodologyEvidence || {})
    .filter(([, section]) => cleanString(section?.text))
    .map(([key]) => key)
    .slice(0, 20),
  preclassification: packet.preclassification || {},
  qualitySignals: packet.qualitySignals || {},
  expandedDescriptionQuality: packet.expandedDescriptionQuality || "",
  expandedDescriptionWordCount: Number(packet.expandedDescriptionWordCount || 0),
  expandedDescriptionSectionCount: Number(packet.expandedDescriptionSectionCount || 0),
  expandedDescriptionRetryAttempted: Boolean(packet.expandedDescriptionRetryAttempted),
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
  article.doi = cleanString(input.doi) || metadata.doi || "";
  article.publicationDate = cleanString(input.publicationDate) || metadata.publicationDate || "";
  article.originalLanguage = cleanString(input.originalLanguage) || packet.detectedLanguage || "";
  article.articleType = cleanString(input.articleType || input.documentType || metadata.articleType);
  article.studyType = cleanString(input.studyType);
  article.evidenceType = cleanString(input.evidenceType);
  article.accessType = ACCESS_TYPES.includes(input.accessType) ? input.accessType : "Pendiente";
  article.briefDescriptionEs = sanitizeEditorialText(input.briefDescriptionEs || input.cardSummaryEs, { maxChars: 280 });
  article.expandedDescriptionEs = sanitizeEditorialText(input.expandedDescriptionEs || input.executiveSummaryEs, {
    maxChars: 6000,
    maxWords: EXPANDED_DESCRIPTION_MAX_WORDS
  });
  article.expandedDescriptionSections = normalizeExpandedDescriptionSections(input.expandedDescriptionSections);
  article.expandedDescriptionQuality = normalizeExpandedDescriptionQuality(input.expandedDescriptionQuality);
  article.cardSummaryEs = sanitizeEditorialText(input.cardSummaryEs, { maxChars: 280 }) || article.briefDescriptionEs;
  article.executiveSummaryEs = sanitizeEditorialText(input.executiveSummaryEs, {
    maxChars: 6000,
    maxWords: EXPANDED_DESCRIPTION_MAX_WORDS
  }) || article.expandedDescriptionEs;
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
  article.methodologyProfile = normalizeMethodologyProfile(input.methodologyProfile);
  article.methodologyProfile.specificDesign = article.methodologyProfile.specificDesign || article.studyDesignEs;
  article.methodologyProfile.designCategoryEs =
    article.methodologyProfile.designCategoryEs ||
    inferDesignCategoryFromProfile(article.methodologyProfile) ||
    article.evidenceType ||
    article.studyDesignEs;
  article.methodologyProfile.studyPopulation = article.methodologyProfile.studyPopulation || article.studyPopulationEs;
  article.methodologyProfile.countryOrRegion = article.methodologyProfile.countryOrRegion || article.studyLocationEs;
  article.methodologyProfile.studyPeriod = article.methodologyProfile.studyPeriod || article.studyPeriodEs;
  article.methodologyProfile.dataSource = article.methodologyProfile.dataSource || article.studyContextEs;
  article.tags = normalizeList(input.tags?.length ? input.tags : metadata.keywords, 8);
  article.sourcePages = normalizeSourcePages(input.sourcePages);
  article.extractionConfidence = Number.isFinite(Number(input.extractionConfidence))
    ? Math.max(0, Math.min(1, Number(input.extractionConfidence)))
    : 0;
  article.warnings = normalizeList(input.warnings, 10);
  return finalizeExpandedDescriptionFields(article, packet);
};

const validateStructuredAIOutput = (article = {}) => {
  const invalid = [];
  DOCUMENT_AI_ARTICLE_KEYS.forEach((key) => {
    if (!(key in article)) invalid.push(key);
  });
  if (!Array.isArray(article.authors)) invalid.push("authors_type");
  if (!Array.isArray(article.expandedDescriptionSections)) invalid.push("expandedDescriptionSections_type");
  if (Array.isArray(article.expandedDescriptionSections)) {
    article.expandedDescriptionSections.forEach((section, index) => {
      if (!section || typeof section !== "object" || Array.isArray(section)) invalid.push(`expandedDescriptionSections.${index}_type`);
      if (typeof section?.heading !== "string") invalid.push(`expandedDescriptionSections.${index}.heading_type`);
      if (typeof section?.body !== "string") invalid.push(`expandedDescriptionSections.${index}.body_type`);
    });
  }
  if (!EXPANDED_DESCRIPTION_QUALITY_VALUES.includes(article.expandedDescriptionQuality)) {
    invalid.push("expandedDescriptionQuality");
  }
  if (!Array.isArray(article.keyPointsEs)) invalid.push("keyPointsEs_type");
  if (!Array.isArray(article.tags)) invalid.push("tags_type");
  if (!Array.isArray(article.warnings)) invalid.push("warnings_type");
  if (!article.methodologyProfile || typeof article.methodologyProfile !== "object" || Array.isArray(article.methodologyProfile)) {
    invalid.push("methodologyProfile_type");
  } else {
    METHODOLOGY_PROFILE_KEYS.forEach((key) => {
      if (!(key in article.methodologyProfile)) invalid.push(`methodologyProfile.${key}`);
      if (METHODOLOGY_LIST_FIELDS.has(key) && !Array.isArray(article.methodologyProfile[key])) {
        invalid.push(`methodologyProfile.${key}_type`);
      }
      if (METHODOLOGY_BOOLEAN_FIELDS.has(key) && typeof article.methodologyProfile[key] !== "boolean") {
        invalid.push(`methodologyProfile.${key}_type`);
      }
      if (
        METHODOLOGY_OBJECT_FIELDS.has(key) &&
        (!article.methodologyProfile[key] ||
          typeof article.methodologyProfile[key] !== "object" ||
          Array.isArray(article.methodologyProfile[key]))
      ) {
        invalid.push(`methodologyProfile.${key}_type`);
      }
      if (
        !METHODOLOGY_LIST_FIELDS.has(key) &&
        !METHODOLOGY_BOOLEAN_FIELDS.has(key) &&
        !METHODOLOGY_OBJECT_FIELDS.has(key) &&
        typeof article.methodologyProfile[key] !== "string"
      ) {
        invalid.push(`methodologyProfile.${key}_type`);
      }
    });
  }
  if (!ACCESS_TYPES.includes(article.accessType)) invalid.push("accessType");
  if (!Number.isFinite(Number(article.extractionConfidence))) invalid.push("extractionConfidence");
  return { ok: invalid.length === 0, invalid };
};

const validateStructuredCoreAIOutput = (article = {}) => {
  const invalid = [];
  DOCUMENT_CORE_AI_ARTICLE_KEYS.forEach((key) => {
    if (!(key in article)) invalid.push(key);
  });
  if (!Array.isArray(article.authors)) invalid.push("authors_type");
  if (!Array.isArray(article.expandedDescriptionSections)) invalid.push("expandedDescriptionSections_type");
  if (Array.isArray(article.expandedDescriptionSections)) {
    article.expandedDescriptionSections.forEach((section, index) => {
      if (!section || typeof section !== "object" || Array.isArray(section)) invalid.push(`expandedDescriptionSections.${index}_type`);
      if (typeof section?.heading !== "string") invalid.push(`expandedDescriptionSections.${index}.heading_type`);
      if (typeof section?.body !== "string") invalid.push(`expandedDescriptionSections.${index}.body_type`);
    });
  }
  if (!EXPANDED_DESCRIPTION_QUALITY_VALUES.includes(article.expandedDescriptionQuality)) {
    invalid.push("expandedDescriptionQuality");
  }
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
  const hasCard = cleanString(article.briefDescriptionEs || article.cardSummaryEs).length >= 24;
  const hasExecutiveSummary =
    cleanString(article.expandedDescriptionEs || article.executiveSummaryEs).length >= 32 ||
    (Array.isArray(article.expandedDescriptionSections) && article.expandedDescriptionSections.length >= 2);
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
  const hasUsefulNarrative =
    score.hasCard ||
    score.hasExecutiveSummary ||
    cleanString(article.objectiveEs || article.clinicalQuestionEs).length >= 24 ||
    cleanString(article.mainMessageEs || article.mainResultEs).length >= 24 ||
    (Array.isArray(article.keyPointsEs) && article.keyPointsEs.length >= 2);
  if (score.hasTitle && score.hasSource && hasUsefulNarrative) {
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

const buildEvidenceSupportSchema = () => ({
  type: "object",
  additionalProperties: false,
  required: EVIDENCE_SUPPORT_FIELDS,
  properties: EVIDENCE_SUPPORT_FIELDS.reduce((properties, key) => {
    properties[key] = {
      type: "object",
      additionalProperties: false,
      required: ["supportLevel", "evidenceText", "sourceSection"],
      properties: {
        supportLevel: {
          type: "string",
          enum: key === "sampleSize" || key === "centerScope" || key === "temporalDirection"
            ? ["explicito", "inferido_con_soporte", "no_especificado", "no_aplica"]
            : ["explicito", "inferido_con_soporte", "no_especificado"]
        },
        evidenceText: { type: "string" },
        sourceSection: { type: "string" }
      }
    };
    return properties;
  }, {})
});

const buildMethodologyProfileSchema = () => ({
  type: "object",
  additionalProperties: false,
  required: METHODOLOGY_PROFILE_KEYS,
  properties: METHODOLOGY_PROFILE_KEYS.reduce((properties, key) => {
    if (METHODOLOGY_LIST_FIELDS.has(key)) {
      properties[key] = { type: "array", items: { type: "string" } };
    } else if (METHODOLOGY_BOOLEAN_FIELDS.has(key)) {
      properties[key] = { type: "boolean" };
    } else if (METHODOLOGY_OBJECT_FIELDS.has(key) && key === "evidenceSupport") {
      properties[key] = buildEvidenceSupportSchema();
    } else if (key === "studyFamily") {
      properties[key] = { type: "string", enum: STUDY_FAMILIES };
    } else {
      properties[key] = { type: "string" };
    }
    return properties;
  }, {})
});

const buildExpandedDescriptionSectionsSchema = () => ({
  type: "array",
  minItems: 0,
  maxItems: 6,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["heading", "body"],
    properties: {
      heading: {
        type: "string",
        description: "Subtítulo breve en español, máximo 50 caracteres."
      },
      body: {
        type: "string",
        description: "Cuerpo de sección en español, 45 a 110 palabras cuando haya evidencia."
      }
    }
  }
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
          briefDescriptionEs: {
            type: "string",
            description: "Descripción breve en español, máximo 280 caracteres, para tarjeta. Responde de qué trata y por qué importa."
          },
          expandedDescriptionEs: {
            type: "string",
            description: "Síntesis editorial ampliada en español, 350 a 550 palabras ideal, máximo 650. Debe unir contexto, tipo de documento, diseño/evidencia, población, metodología, hallazgos, cautelas y aplicabilidad sin inventar datos."
          },
          expandedDescriptionSections: {
            ...buildExpandedDescriptionSectionsSchema(),
            description: "4 a 6 secciones breves para renderizar la descripción ampliada. Usar [] solo si el documento no tiene evidencia suficiente."
          },
          expandedDescriptionQuality: {
            type: "string",
            enum: EXPANDED_DESCRIPTION_QUALITY_VALUES,
            description: "complete si la descripción ampliada cumple extensión, secciones y contenido; partial si hay evidencia limitada; insufficient si falta contenido útil."
          },
          cardSummaryEs: {
            type: "string",
            description: "Alias de briefDescriptionEs. Usar el mismo contenido si no hay diferencia editorial."
          },
          executiveSummaryEs: {
            type: "string",
            description: "Alias de expandedDescriptionEs. Usar el mismo contenido si no hay diferencia editorial."
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
          methodologyProfile: buildMethodologyProfileSchema(),
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
        [
          "Sos un agente experto en metodología de investigación clínica, epidemiología, salud pública, implementación sanitaria y comunicación científica médica.",
          "Tu tarea es analizar evidencia real extraída de un PDF o texto científico y generar una ficha en español para una Bitácora de Ciencia Médica.",
          "Actuás como médico científico, metodólogo clínico, epidemiólogo, editor médico y comunicador científico en español.",
          "Tu prioridad es generar una ficha editorial útil para lectores médicos, no solo extraer metadatos.",
          "Respondé solo JSON válido conforme al schema. Todo texto editorial debe estar en español.",
          "Conservá título oficial, autores, DOI, revista e instituciones tal como aparecen. No inventes datos y no uses conocimiento externo.",
          "No inventes población, país, institución, tamaño muestral, duración, resultados, DOI ni conclusiones. Si un dato no está en el documento, dejalo vacío o indicá 'No especificado en el documento' de forma discreta.",
          "No fuerces todos los documentos a ensayo clínico, prospectivo, retrospectivo o multicéntrico.",
          "Si un documento es guía, consenso, health policy, informe técnico o marco de implementación, clasificalo como tal.",
          "Diferenciá siempre el tipo de documento publicado del diseño o evidencia principal analizada. Si es una revisión o focus seminar sobre una cohorte, describí ambos sin confundir el paper con el estudio subyacente.",
          "Si un documento no es estudio clínico primario, usá 'no aplica' para temporalidad prospectivo/retrospectivo cuando corresponda.",
          "Si hay múltiples países o instituciones en implementación o política sanitaria, describilo como regional/internacional o alcance programático, no como multicéntrico clínico salvo que sea un estudio clínico multicéntrico.",
          "Si se puede inferir un diseño con soporte fuerte, usá supportLevel='inferido_con_soporte' y explicá la base. Si no hay soporte, usá 'No especificado en el documento'.",
          "Diferenciá: ensayo clínico, cohorte prospectiva, cohorte retrospectiva, caso-control, transversal, revisión sistemática/metaanálisis, guía/consenso, health policy/marco de implementación, quality improvement, evaluación económica, diagnóstico/pronóstico y modelo predictivo.",
          "Si no hay muestra clínica, no inventarla. Si hay alcance programático, usá sampleDescription. Si no hay duración, no la inventes.",
          "La descripción breve debe tener 180 a 280 caracteres, una sola idea, sin subtítulos ni listas, y responder de qué trata y por qué importa.",
          "La descripción ampliada es prioritaria: 350 a 550 palabras ideal, mínimo 280 si hay evidencia suficiente, máximo absoluto 650.",
          "Dividí expandedDescriptionSections en 4 a 6 secciones con subtítulos claros como Contexto, Diseño y población, Qué evaluó, Hallazgos relevantes y Lectura práctica.",
          "Cada sección debe tener 45 a 110 palabras cuando haya evidencia suficiente. Omití secciones sin evidencia o señalá 'No especificado en el documento' sin rellenar.",
          "expandedDescriptionEs debe ser el texto plano equivalente a esas secciones, sin HTML ni markdown peligroso.",
          "La descripción ampliada debe explicar contexto, objetivo, tipo de documento, diseño o evidencia, población, ámbito, período, metodología, variables o intervención, hallazgos/mensajes, limitaciones, relevancia y aplicabilidad cuando estén disponibles.",
          "No repitas la descripción breve, no copies textualmente el abstract completo, no uses frases vagas y no conviertas asociaciones en causalidad.",
          "Evitá frases genéricas como 'El documento trata sobre' o 'Este artículo habla de'. La clasificación metodológica debe ayudar a un médico a entender qué tipo de evidencia está leyendo."
        ].join(" ")
    },
    {
      role: "user",
      content: `Analizá este evidencePacket, la preclasificación determinística y la taxonomía metodológica. Generá la ficha editorial en español y methodologyProfile completo:\n${JSON.stringify({
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
        methodologyEvidence: packet.methodologyEvidence,
        preclassification: packet.preclassification,
        scientificMethodologyTaxonomy: SCIENTIFIC_METHODOLOGY_TAXONOMY,
        qualitySignals: packet.qualitySignals
      })}`
    }
  ]
});

const buildOpenAiDocumentCorePayload = (packet = {}, { model = "" } = {}) => ({
  model: cleanString(model) || DEFAULT_DOCUMENT_EXTRACTION_MODEL,
  temperature: 0.1,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "scientific_article_core_card",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: DOCUMENT_CORE_AI_ARTICLE_KEYS,
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
          briefDescriptionEs: {
            type: "string",
            description: "Descripción breve en español, máximo 280 caracteres, para tarjeta."
          },
          expandedDescriptionEs: {
            type: "string",
            description: "Síntesis editorial ampliada en español. Ideal 350 a 550 palabras cuando el evidencePacket tiene contenido suficiente; máximo 650."
          },
          expandedDescriptionSections: {
            ...buildExpandedDescriptionSectionsSchema(),
            description: "4 a 6 secciones breves para la descripción ampliada, o [] si no hay evidencia suficiente."
          },
          expandedDescriptionQuality: {
            type: "string",
            enum: EXPANDED_DESCRIPTION_QUALITY_VALUES
          },
          cardSummaryEs: { type: "string" },
          executiveSummaryEs: { type: "string" },
          objectiveEs: { type: "string" },
          studyDesignEs: { type: "string" },
          studyContextEs: { type: "string" },
          studyPopulationEs: { type: "string" },
          studyLocationEs: { type: "string" },
          studyPeriodEs: { type: "string" },
          mainMessageEs: { type: "string" },
          keyPointsEs: { type: "array", items: { type: "string" } },
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
        [
          "Sos un editor científico médico y comunicador clínico.",
          "Generá primero una ficha editorial útil en español para revisar antes de guardar.",
          "Respondé solo JSON válido conforme al schema.",
          "No inventes datos y no uses conocimiento externo.",
          "Conservá título, autores, DOI, revista, fecha y URL tal como aparecen.",
          "La descripción breve debe orientar de qué trata el documento y por qué importa, máximo 280 caracteres.",
          "La descripción ampliada debe ser una síntesis editorial técnica de 350 a 550 palabras cuando el evidencePacket tenga contenido suficiente, en 4 a 6 secciones breves.",
          "Diferenciá tipo de documento publicado y diseño o evidencia principal analizada. No confundas una revisión o focus seminar con el estudio subyacente.",
          "Incluí contexto, objetivo, población/ámbito, metodología, hallazgos o mensajes, cautelas y aplicabilidad cuando estén sustentados.",
          "Clasificá el tipo de documento en términos médicos útiles: ensayo, cohorte, revisión, guía, consenso, health policy, marco de implementación u otro.",
          "Si un dato no aparece, dejalo vacío o indicá 'No especificado en el documento' solo cuando sea necesario para entender la ficha.",
          "No completes metodología avanzada ni evidenceSupport en esta etapa."
        ].join(" ")
    },
    {
      role: "user",
      content: `Generá la ficha core en español desde este evidencePacket:\n${JSON.stringify({
        mode: packet.mode,
        originalFileName: packet.originalFileName,
        officialUrl: packet.officialUrl,
        detectedLanguage: packet.detectedLanguage,
        pageCount: packet.pageCount,
        textLength: packet.textLength,
        detectedMetadata: packet.detectedMetadata,
        sections: (packet.sections || []).map((section) => ({
          heading: normalizeSectionHeading(section.heading),
          text: cleanLongText(section.text).slice(0, getSectionPriority(section.heading) === 0 ? 5200 : 2400),
          pages: section.pages || []
        })),
        snippets: (packet.snippets || []).map((snippet) => ({
          label: snippet.label,
          text: cleanLongText(snippet.text).slice(0, 12000),
          pages: snippet.pages || []
        })),
        methodologyHints: {
          possibleFamilies: packet.preclassification?.possibleFamilies || [],
          likelyDesigns: packet.preclassification?.likelyDesigns || [],
          explicitClaims: packet.preclassification?.explicitClaims || [],
          inferredClaims: packet.preclassification?.inferredClaims || []
        },
        qualitySignals: packet.qualitySignals
      })}`
    }
  ]
});

const buildOpenAiDocumentExpansionPayload = (packet = {}, { model = "", article = {} } = {}) => ({
  model: cleanString(model) || DEFAULT_DOCUMENT_EXTRACTION_MODEL,
  temperature: 0.1,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "scientific_article_core_card",
      strict: true,
      schema: buildOpenAiDocumentCorePayload({}, { model }).response_format.json_schema.schema
    }
  },
  messages: [
    {
      role: "system",
      content:
        [
          "Sos un editor médico científico especializado en síntesis editorial en español.",
          "Corregí exclusivamente una ficha cuyo campo expandedDescriptionEs quedó demasiado corto.",
          "Respondé solo JSON válido conforme al schema.",
          "No uses conocimiento externo ni inventes datos ausentes.",
          "Conservá metadatos, título, fuente, DOI, autores y clasificación cuando ya estén disponibles.",
          "Generá expandedDescriptionEs de 350 a 550 palabras si el evidencePacket tiene contenido suficiente; mínimo 280 palabras, máximo 650.",
          "Generá expandedDescriptionSections con 4 a 6 secciones breves: Contexto, Diseño y población, Qué evaluó, Hallazgos relevantes y Lectura práctica u otros subtítulos equivalentes.",
          "Cada sección debe tener contenido concreto sustentado por la evidencia. Si falta un dato, indicá 'No especificado en el documento' de forma discreta.",
          "Diferenciá tipo de documento publicado y diseño o evidencia principal analizada. No confundas focus seminar, revisión, guía o health policy con el estudio subyacente.",
          "No repitas la descripción breve, no copies textualmente el abstract completo y no uses frases genéricas."
        ].join(" ")
    },
    {
      role: "user",
      content: `La ficha actual tiene una descripción ampliada insuficiente. Regenerá una descripción editorial amplia y devolvé la ficha core completa.\n${JSON.stringify({
        currentArticle: {
          title: article.title || "",
          sourceName: article.sourceName || article.journal || "",
          journal: article.journal || "",
          authors: article.authors || [],
          officialUrl: article.officialUrl || packet.officialUrl || "",
          doi: article.doi || "",
          publicationDate: article.publicationDate || "",
          originalLanguage: article.originalLanguage || packet.detectedLanguage || "",
          articleType: article.articleType || "",
          evidenceType: article.evidenceType || "",
          accessType: article.accessType || "Pendiente",
          briefDescriptionEs: article.briefDescriptionEs || article.cardSummaryEs || "",
          expandedDescriptionEs: article.expandedDescriptionEs || article.executiveSummaryEs || "",
          objectiveEs: article.objectiveEs || "",
          studyDesignEs: article.studyDesignEs || article.methodologyEs || "",
          studyContextEs: article.studyContextEs || "",
          studyPopulationEs: article.studyPopulationEs || "",
          studyLocationEs: article.studyLocationEs || "",
          studyPeriodEs: article.studyPeriodEs || "",
          mainMessageEs: article.mainMessageEs || article.mainResultEs || "",
          keyPointsEs: article.keyPointsEs || [],
          tags: article.tags || []
        },
        evidencePacket: {
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
          methodologyHints: {
            possibleFamilies: packet.preclassification?.possibleFamilies || [],
            likelyDesigns: packet.preclassification?.likelyDesigns || [],
            explicitClaims: packet.preclassification?.explicitClaims || [],
            inferredClaims: packet.preclassification?.inferredClaims || []
          },
          qualitySignals: packet.qualitySignals
        }
      })}`
    }
  ]
});

const callOpenAiStructuredDocument = async ({
  packet = {},
  apiKey = "",
  fetchImpl = fetch,
  model = "",
  buildPayload,
  validateOutput,
  invalidSchemaMessage = "La IA devolvió un schema incompleto."
} = {}) => {
  if (!apiKey) {
    return { ok: false, error: { code: "missing_openai_api_key", message: "El servicio de IA no está configurado en backend." } };
  }
  let lastError = { code: "ai_request_failed", message: "No se pudo conectar con el servicio de IA." };
  for (const candidateModel of getConfiguredDocumentModels({ model })) {
    const payload = buildPayload(packet, { model: candidateModel });
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
      const validation = validateOutput(parsed);
      if (!validation.ok) {
        lastError = { code: "invalid_ai_schema", message: invalidSchemaMessage, modelUsed: candidateModel, invalid: validation.invalid };
        continue;
      }
      return { ok: true, article: parsed, modelUsed: candidateModel };
    } catch (error) {
      lastError = { code: "ai_request_failed", message: "No se pudo conectar con el servicio de IA.", modelUsed: candidateModel };
    }
  }
  return { ok: false, error: lastError };
};

const callDocumentExtractionAI = async (packet = {}, { apiKey = "", fetchImpl = fetch, model = "" } = {}) => {
  return callOpenAiStructuredDocument({
    packet,
    apiKey,
    fetchImpl,
    model,
    buildPayload: buildOpenAiDocumentPayload,
    validateOutput: validateStructuredAIOutput,
    invalidSchemaMessage: "La IA devolvió un schema metodológico incompleto."
  });
};

const callDocumentCoreExtractionAI = async (packet = {}, { apiKey = "", fetchImpl = fetch, model = "" } = {}) =>
  callOpenAiStructuredDocument({
    packet,
    apiKey,
    fetchImpl,
    model,
    buildPayload: buildOpenAiDocumentCorePayload,
    validateOutput: validateStructuredCoreAIOutput,
    invalidSchemaMessage: "La IA devolvió una ficha core incompleta."
  });

const shouldRetryExpandedDescription = (article = {}, packet = {}) => {
  const assessment = validateExpandedDescriptionQuality(article, packet);
  return Boolean(
    hasSubstantialEvidenceForExpandedDescription(packet) &&
      assessment.quality === "insufficient" &&
      assessment.wordCount < EXPANDED_DESCRIPTION_MIN_WORDS
  );
};

const retryExpandedDescriptionIfNeeded = async (
  article = {},
  packet = {},
  { apiKey = "", fetchImpl = fetch, model = "" } = {}
) => {
  const current = finalizeExpandedDescriptionFields(article, packet);
  if (!apiKey || !shouldRetryExpandedDescription(current, packet)) {
    return { attempted: false, ok: false, article: current, error: null, modelUsed: "" };
  }
  const ai = await callOpenAiStructuredDocument({
    packet,
    apiKey,
    fetchImpl,
    model,
    buildPayload: (retryPacket, { model: retryModel } = {}) =>
      buildOpenAiDocumentExpansionPayload(retryPacket, { model: retryModel, article: current }),
    validateOutput: validateStructuredCoreAIOutput,
    invalidSchemaMessage: "La IA no pudo regenerar una descripción ampliada suficiente."
  });
  if (!ai.ok) {
    return { attempted: true, ok: false, article: current, error: ai.error, modelUsed: ai.error?.modelUsed || "" };
  }
  const regenerated = normalizeAiDocumentOutput(ai.article, packet);
  const next = finalizeExpandedDescriptionFields(
    {
      ...current,
      briefDescriptionEs: regenerated.briefDescriptionEs || current.briefDescriptionEs,
      cardSummaryEs: regenerated.cardSummaryEs || regenerated.briefDescriptionEs || current.cardSummaryEs,
      expandedDescriptionEs: regenerated.expandedDescriptionEs || current.expandedDescriptionEs,
      expandedDescriptionSections: regenerated.expandedDescriptionSections?.length
        ? regenerated.expandedDescriptionSections
        : current.expandedDescriptionSections,
      expandedDescriptionQuality: regenerated.expandedDescriptionQuality,
      executiveSummaryEs: regenerated.executiveSummaryEs || regenerated.expandedDescriptionEs || current.executiveSummaryEs,
      objectiveEs: regenerated.objectiveEs || current.objectiveEs,
      studyDesignEs: regenerated.studyDesignEs || current.studyDesignEs,
      studyContextEs: regenerated.studyContextEs || current.studyContextEs,
      studyPopulationEs: regenerated.studyPopulationEs || current.studyPopulationEs,
      studyLocationEs: regenerated.studyLocationEs || current.studyLocationEs,
      studyPeriodEs: regenerated.studyPeriodEs || current.studyPeriodEs,
      mainMessageEs: regenerated.mainMessageEs || current.mainMessageEs,
      keyPointsEs: regenerated.keyPointsEs?.length ? regenerated.keyPointsEs : current.keyPointsEs,
      tags: regenerated.tags?.length ? regenerated.tags : current.tags,
      warnings: [
        ...(current.warnings || []),
        "La IA regeneró la descripción ampliada porque la primera versión era demasiado breve."
      ]
    },
    packet
  );
  if (shouldRetryExpandedDescription(next, packet)) {
    return {
      attempted: true,
      ok: false,
      article: next,
      error: {
        code: "expanded_description_retry_insufficient",
        message: "El reintento editorial no alcanzó la extensión mínima de descripción ampliada."
      },
      modelUsed: ai.modelUsed || ""
    };
  }
  return { attempted: true, ok: true, article: next, error: null, modelUsed: ai.modelUsed || "" };
};

const mergeDocumentExtractionResults = (coreArticle = {}, methodologyArticle = {}) => {
  const core = coreArticle || {};
  const methodology = methodologyArticle || {};
  const merged = buildEmptyArticle();
  DOCUMENT_ARTICLE_KEYS.forEach((key) => {
    const advancedValue = methodology[key];
    const coreValue = core[key];
    if (Array.isArray(advancedValue) && advancedValue.length) {
      merged[key] = advancedValue;
    } else if (!Array.isArray(advancedValue) && cleanString(advancedValue)) {
      merged[key] = advancedValue;
    } else if (Array.isArray(coreValue) && coreValue.length) {
      merged[key] = coreValue;
    } else if (!Array.isArray(coreValue) && cleanString(coreValue)) {
      merged[key] = coreValue;
    }
  });
  merged.methodologyProfile = normalizeMethodologyProfile(
    Object.values(methodology.methodologyProfile || {}).some((value) =>
      Array.isArray(value) ? value.length : cleanString(value)
    )
      ? methodology.methodologyProfile
      : core.methodologyProfile
  );
  merged.cardSummaryEs = merged.cardSummaryEs || merged.briefDescriptionEs;
  merged.executiveSummaryEs = merged.executiveSummaryEs || merged.expandedDescriptionEs;
  merged.clinicalQuestionEs = merged.clinicalQuestionEs || merged.objectiveEs;
  merged.mainResultEs = merged.mainResultEs || merged.mainMessageEs;
  merged.methodologyEs = merged.methodologyEs || merged.studyDesignEs;
  merged.sourceName = merged.sourceName || merged.journal;
  merged.journal = merged.journal || merged.sourceName;
  merged.extractionConfidence = Math.max(
    Number(core.extractionConfidence || 0),
    Number(methodology.extractionConfidence || 0)
  );
  merged.warnings = normalizeList([...(core.warnings || []), ...(methodology.warnings || [])], 10);
  return merged;
};

const extractCoreArticleFicha = async (packet = {}, { apiKey = "", fetchImpl = fetch, model = "" } = {}) => {
  const ai = await callDocumentCoreExtractionAI(packet, { apiKey, fetchImpl, model });
  if (!ai.ok) {
    return {
      ok: false,
      article: buildDeterministicDocumentFallback(packet, {
        warnings: ["La IA no pudo generar la ficha editorial core."]
      }),
      error: ai.error,
      modelUsed: ai.error?.modelUsed || ""
    };
  }
  return {
    ok: true,
    article: normalizeAiDocumentOutput(ai.article, packet),
    modelUsed: ai.modelUsed || ""
  };
};

const extractMethodologyProfile = async (packet = {}, { apiKey = "", fetchImpl = fetch, model = "" } = {}) => {
  const ai = await callDocumentExtractionAI(packet, { apiKey, fetchImpl, model });
  if (!ai.ok) {
    return {
      ok: false,
      article: buildEmptyArticle(),
      error: ai.error,
      modelUsed: ai.error?.modelUsed || ""
    };
  }
  return {
    ok: true,
    article: normalizeAiDocumentOutput(ai.article, packet),
    modelUsed: ai.modelUsed || ""
  };
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
    const article = finalizeExpandedDescriptionFields(buildDeterministicDocumentFallback(packet, {
      warnings: ["El servicio de IA no está configurado en backend."],
      extractionConfidence: 0.18
    }), packet);
    return buildDocumentExtractionResponse({
      extractionStatus: "not_configured",
      article,
      rawEvidence: { ...buildRawEvidence(packet), agentDurations },
      error: { code: "missing_openai_api_key", message: "El servicio de IA no está configurado en backend." }
    });
  }

  const aiStart = now();
  const coreStart = now();
  const corePromise = extractCoreArticleFicha(packet, { apiKey, fetchImpl, model: documentModel })
    .finally(() => {
      agentDurations.coreAiMs = now() - coreStart;
    });

  const methodologyStart = now();
  const methodologyPromise = extractMethodologyProfile(packet, { apiKey, fetchImpl, model: documentModel })
    .finally(() => {
      agentDurations.methodologyAiMs = now() - methodologyStart;
    });

  const [coreSettled, methodologySettled] = await Promise.allSettled([corePromise, methodologyPromise]);
  agentDurations.aiMs = now() - aiStart;
  const buildSettledAgentResult = (settled, agentName) => {
    if (settled.status === "fulfilled") return settled.value;
    const message = cleanString(settled.reason?.message || settled.reason?.code || settled.reason);
    return {
      ok: false,
      article:
        agentName === "core"
          ? buildDeterministicDocumentFallback(packet, {
              warnings: ["La IA no pudo generar la ficha editorial core."]
            })
          : buildEmptyArticle(),
      error: {
        code: `${agentName}_agent_failed`,
        message: message || `Falló el agente documental ${agentName}.`
      },
      modelUsed: ""
    };
  };
  const core = buildSettledAgentResult(coreSettled, "core");
  const methodology = buildSettledAgentResult(methodologySettled, "methodology");
  packet.modelUsed = [core.modelUsed, methodology.modelUsed].filter(Boolean).join(" + ");

  let article = finalizeExpandedDescriptionFields(
    mergeDocumentExtractionResults(core.article, methodology.ok ? methodology.article : {}),
    packet
  );
  const expansionRetryStart = now();
  const expansionRetry = await retryExpandedDescriptionIfNeeded(article, packet, {
    apiKey,
    fetchImpl,
    model: documentModel
  });
  if (expansionRetry.attempted) {
    agentDurations.expandedDescriptionRetryMs = now() - expansionRetryStart;
    article = expansionRetry.article;
    packet.expandedDescriptionRetryAttempted = true;
    if (expansionRetry.modelUsed) {
      packet.modelUsed = Array.from(new Set([packet.modelUsed, expansionRetry.modelUsed].filter(Boolean))).join(" + ");
    }
    if (!expansionRetry.ok) {
      article.warnings.push("La IA no pudo regenerar una descripción ampliada suficiente en el reintento editorial.");
    }
  }
  if (!core.ok) {
    article.warnings.push("La IA no pudo generar una ficha editorial confiable.");
  }
  if (core.ok && !methodology.ok) {
    article.warnings.push("No se pudo completar la metodología avanzada; se conservó la ficha editorial.");
  }
  article.warnings = Array.from(new Set([...(packet.warnings || []), ...(article.warnings || [])])).slice(0, 10);
  const finalDescriptionAssessment = validateExpandedDescriptionQuality(article, packet);
  article.expandedDescriptionQuality = finalDescriptionAssessment.quality;
  packet.expandedDescriptionQuality = finalDescriptionAssessment.quality;
  packet.expandedDescriptionWordCount = finalDescriptionAssessment.wordCount;
  packet.expandedDescriptionSectionCount = finalDescriptionAssessment.sections.length;
  let status = computeExtractionStatus(article);
  if (
    status === "ai_draft" &&
    article.expandedDescriptionQuality === "insufficient" &&
    hasSubstantialEvidenceForExpandedDescription(packet)
  ) {
    status = "metadata_only";
    article.warnings.push("La IA no generó una descripción ampliada suficiente para publicar sin revisión editorial.");
  }
  if (status !== "ai_draft") {
    article.warnings.push("La IA no detectó suficientes campos útiles para generar una ficha final.");
  }
  agentDurations.validationMs = now() - startedAt;
  return buildDocumentExtractionResponse({
    extractionStatus: status,
    article,
    rawEvidence: { ...buildRawEvidence(packet), agentDurations },
    error:
      status === "failed"
        ? core.error || methodology.error || { code: "insufficient_document_fields", message: "No se detectó contenido científico suficiente." }
        : methodology.ok
          ? undefined
          : methodology.error
  });
};

module.exports = {
  ACCESS_TYPES,
  DOCUMENT_AI_ARTICLE_KEYS,
  DOCUMENT_ARTICLE_KEYS,
  DOCUMENT_CORE_AI_ARTICLE_KEYS,
  DEFAULT_DOCUMENT_EXTRACTION_MODEL,
  DOCUMENT_EXTRACTION_FALLBACK_MODEL,
  MAX_PDF_BYTES,
  MAX_PASTED_TEXT_CHARS,
  MIN_DOCUMENT_TEXT_LENGTH,
  buildDocumentExtractionResponse,
  buildEvidencePacket,
  buildOpenAiDocumentCorePayload,
  buildOpenAiDocumentPayload,
  buildRawEvidence,
  callDocumentExtractionAI,
  callDocumentCoreExtractionAI,
  cleanLongText,
  computeExtractionStatus,
  detectDoi,
  detectLanguage,
  extractSectionsFromText,
  extractCoreArticleFicha,
  extractMethodologyProfile,
  finalizeExpandedDescriptionFields,
  getConfiguredDocumentModels,
  hasSubstantialEvidenceForExpandedDescription,
  mergeDocumentExtractionResults,
  normalizeAiDocumentOutput,
  normalizeExpandedDescriptionSections,
  parseJsonObjectFromText,
  resolveScientificArticleDocument,
  scoreDocumentArticle,
  validateExpandedDescriptionQuality,
  validateStoragePathForUid
};
