const FINAL_ARTICLE_FIELD_KEYS = [
  "title",
  "sourceName",
  "officialUrl",
  "sourceDomain",
  "doi",
  "pmid",
  "pmcid",
  "nctId",
  "pii",
  "studyType",
  "evidenceType",
  "publicationDate",
  "studyLocation",
  "briefDescriptionEs",
  "expandedDescriptionEs",
  "expandedDescriptionSections",
  "expandedDescriptionQuality",
  "executiveSummary",
  "clinicalQuestion",
  "mainResult",
  "methodologyProfile",
  "tags",
  "accessType",
  "extractionConfidence",
  "warnings"
];

const AI_ARTICLE_FIELD_KEYS = [
  "studyType",
  "evidenceType",
  "studyLocation",
  "briefDescriptionEs",
  "expandedDescriptionEs",
  "expandedDescriptionSections",
  "expandedDescriptionQuality",
  "executiveSummary",
  "clinicalQuestion",
  "mainResult",
  "methodologyProfile",
  "tags",
  "warnings",
  "extractionConfidence"
];

const ACCESS_TYPES = ["Open access", "Suscripción", "Resumen disponible", "Pendiente"];
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
const MAX_URL_LENGTH = 2048;
const MAX_HTML_BYTES = 450000;
const MAX_VISIBLE_TEXT_CHARS = 14000;
const MAX_SECTION_CHARS = 4500;
const MAX_RESOLVER_TEXT_CHARS = 9000;
const NCBI_TOOL_NAME = "DepartamentoMedicoBrisa";
const EXPANDED_DESCRIPTION_QUALITY_VALUES = ["complete", "partial", "insufficient"];
const EXPANDED_DESCRIPTION_MAX_WORDS = 650;

const SCIENTIFIC_SECTION_NAMES = [
  "abstract",
  "summary",
  "methods",
  "results",
  "discussion",
  "conclusion",
  "conclusions",
  "background",
  "interpretation",
  "findings",
  "objective",
  "objectives",
  "aim",
  "aims"
];

const SECTION_LABELS = new Map([
  ["abstract", "Abstract"],
  ["summary", "Summary"],
  ["methods", "Methods"],
  ["results", "Results"],
  ["discussion", "Discussion"],
  ["conclusion", "Conclusion"],
  ["conclusions", "Conclusions"],
  ["background", "Background"],
  ["interpretation", "Interpretation"],
  ["findings", "Findings"],
  ["objective", "Objective"],
  ["objectives", "Objectives"],
  ["aim", "Aim"],
  ["aims", "Aims"]
]);

const cleanString = (value = "") => String(value || "").replace(/\s+/g, " ").trim();

const normalizeList = (value = [], limit = 12) =>
  (Array.isArray(value) ? value : String(value || "").split(/[,;|]/))
    .map(cleanString)
    .filter(Boolean)
    .slice(0, limit);

const decodeHtmlEntities = (value = "") =>
  cleanString(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const stripHtmlToText = (html = "") =>
  decodeHtmlEntities(
    String(html || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  ).slice(0, 12000);

const countWords = (value = "") =>
  cleanString(value)
    .split(/\s+/)
    .filter((word) => /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/.test(word)).length;

const limitWords = (value = "", maxWords = EXPANDED_DESCRIPTION_MAX_WORDS) => {
  const words = cleanString(value).split(/\s+/).filter(Boolean);
  return words.length > maxWords ? words.slice(0, maxWords).join(" ") : words.join(" ");
};

const sanitizeEditorialText = (value = "", { maxChars = 6000, maxWords = 0 } = {}) => {
  const clean = stripHtmlToText(value).slice(0, maxChars);
  return maxWords ? limitWords(clean, maxWords) : cleanString(clean);
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

const hasSubstantialPublicEvidence = (packet = {}) => {
  const sections = packet.visibleTextSections || packet.merged?.visibleSections || [];
  const sectionCount = sections.filter((section) => cleanString(section.text).length >= 300).length;
  const contentLength = Number(packet.pageSignals?.contentLength || packet.scientificTextLength || 0);
  return Boolean(
    contentLength >= 2500 ||
      sectionCount >= 3 ||
      cleanString(packet.merged?.abstract || packet.merged?.summary).length >= 1800
  );
};

const assessExpandedDescriptionQuality = (article = {}, packet = {}) => {
  const sections = normalizeExpandedDescriptionSections(article.expandedDescriptionSections);
  const text =
    sanitizeEditorialText(article.expandedDescriptionEs || article.executiveSummary, {
      maxChars: 6000,
      maxWords: EXPANDED_DESCRIPTION_MAX_WORDS
    }) || buildExpandedDescriptionFromSections(sections);
  const words = countWords(text);
  const cueCount = [
    /contexto|problema|sanitari|clínic|clinico|salud/i.test(text),
    /tipo de documento|revisión|revision|seminar|policy|guía|guia|consenso|cohorte|ensayo|diseño|diseno/i.test(`${text} ${article.studyType}`),
    /población|poblacion|participantes|pacientes|ámbito|ambito|país|pais|región|region/i.test(text),
    /método|metodo|metodolog|evaluó|evaluo|variables|intervención|intervencion|exposición|exposicion|seguimiento/i.test(text),
    /hallazgo|resultado|mensaje|conclusi/i.test(text),
    /aplicabilidad|relevancia|práctica|practica|limitaci|cautela/i.test(text)
  ].filter(Boolean).length;
  if (
    !text ||
    /el documento trata sobre un tema importante|el estudio aporta información relevante|se recomienda leer el artículo completo/i.test(text)
  ) {
    return "insufficient";
  }
  if (words >= 300 && words <= EXPANDED_DESCRIPTION_MAX_WORDS && sections.length >= 4 && cueCount >= 4) {
    return "complete";
  }
  if (hasSubstantialPublicEvidence(packet) && words < 280) return "insufficient";
  return words >= 120 || sections.length >= 2 || cueCount >= 3 ? "partial" : "insufficient";
};

const finalizeExpandedDescriptionFields = (article = {}, packet = {}) => {
  const next = { ...article };
  next.briefDescriptionEs = sanitizeEditorialText(next.briefDescriptionEs, { maxChars: 280 });
  next.expandedDescriptionSections = normalizeExpandedDescriptionSections(next.expandedDescriptionSections);
  const fromSections = buildExpandedDescriptionFromSections(next.expandedDescriptionSections);
  next.expandedDescriptionEs =
    sanitizeEditorialText(next.expandedDescriptionEs || next.executiveSummary, {
      maxChars: 6000,
      maxWords: EXPANDED_DESCRIPTION_MAX_WORDS
    }) || fromSections;
  next.executiveSummary = sanitizeEditorialText(next.executiveSummary || next.expandedDescriptionEs, {
    maxChars: 6000,
    maxWords: EXPANDED_DESCRIPTION_MAX_WORDS
  });
  next.expandedDescriptionQuality =
    normalizeExpandedDescriptionQuality(next.expandedDescriptionQuality) ||
    assessExpandedDescriptionQuality(next, packet);
  if (hasSubstantialPublicEvidence(packet) && assessExpandedDescriptionQuality(next, packet) === "insufficient") {
    next.expandedDescriptionQuality = "insufficient";
  }
  return next;
};

const stripNonContentHtml = (html = "") =>
  String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form\b[\s\S]*?<\/form>/gi, " ");

const isPrivateIPv4 = (host = "") => {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
};

const isBlockedArticleHost = (hostname = "") => {
  const host = cleanString(hostname).toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".corp")
  ) {
    return true;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isPrivateIPv4(host)) {
    return true;
  }
  return false;
};

const validateScientificUrl = (value = "") => {
  const raw = cleanString(value);
  if (!raw || raw.length > MAX_URL_LENGTH) {
    return { ok: false, code: "invalid_url", message: "La URL del artículo no es válida." };
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, code: "invalid_protocol", message: "La URL debe comenzar con http o https." };
    }
    if (url.username || url.password) {
      return { ok: false, code: "credentials_not_allowed", message: "La URL no puede incluir credenciales." };
    }
    if (isBlockedArticleHost(url.hostname)) {
      return { ok: false, code: "blocked_host", message: "No se permite analizar URLs locales o internas." };
    }
    return { ok: true, url, href: url.href, domain: url.hostname.toLowerCase() };
  } catch (error) {
    return { ok: false, code: "invalid_url", message: "La URL del artículo no es válida." };
  }
};

const normalizeScientificUrl = (value = "") => {
  const validation = validateScientificUrl(value);
  return validation.ok ? validation.url : null;
};

const parseArticleUrl = (value = "") => normalizeScientificUrl(value);

const cleanDoi = (value = "") =>
  cleanString(value)
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[<>"'\s]+$/g, "")
    .replace(/[.,;]+$/g, "");

const normalizePii = (value = "") => {
  const clean = cleanString(value)
    .replace(/^PII/i, "")
    .replace(/[^0-9A-Z()\-]/gi, "");
  if (!clean) return "";
  return clean.toUpperCase().startsWith("S") ? clean : `S${clean}`;
};

const compactPii = (value = "") => normalizePii(value).replace(/[^0-9A-Z]/gi, "");

const extractPiiIssn = (pii = "") => {
  const match = normalizePii(pii).match(/^S?(\d{4}-?\d{3,4}[A-Z]?)/i);
  return match ? match[1].toUpperCase().replace(/^(\d{4})(\d{3,4}[A-Z]?)$/, "$1-$2") : "";
};

const mergeIdentifierValues = (...items) => {
  const merged = { doi: "", pmid: "", pmcid: "", nctId: "", pii: "" };
  items.forEach((item = {}) => {
    if (!merged.doi && item.doi) merged.doi = cleanDoi(item.doi);
    if (!merged.pmid && item.pmid) merged.pmid = cleanString(item.pmid).replace(/\D/g, "");
    if (!merged.pmcid && item.pmcid) merged.pmcid = cleanString(item.pmcid).toUpperCase().match(/PMC\d+/)?.[0] || "";
    if (!merged.nctId && item.nctId) merged.nctId = cleanString(item.nctId).toUpperCase().match(/NCT\d{8}/)?.[0] || "";
    if (!merged.pii && item.pii) merged.pii = normalizePii(item.pii);
  });
  return merged;
};

const detectScientificIdentifiers = (urlOrValue = "", htmlOrText = "", manual = {}) => {
  const rawUrl = urlOrValue instanceof URL ? urlOrValue.href : cleanString(urlOrValue);
  const decodedUrl = (() => {
    try {
      return decodeURIComponent(rawUrl);
    } catch (e) {
      return rawUrl;
    }
  })();
  const text = `${decodedUrl} ${stripHtmlToText(htmlOrText || "").slice(0, 25000)}`;
  const doi =
    cleanDoi(manual.doi) ||
    cleanDoi((text.match(/(?:doi\.org\/|doi[:/\s]+)(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i) || [])[1] || "") ||
    cleanDoi((text.match(/\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i) || [])[1] || "");
  const pmid =
    cleanString(manual.pmid).replace(/\D/g, "") ||
    (decodedUrl.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,10})/i) || [])[1] ||
    (text.match(/\bPMID[:\s]*(\d{5,10})\b/i) || [])[1] ||
    (text.match(/[?&]pmid=(\d{5,10})\b/i) || [])[1] ||
    "";
  const pmcid =
    cleanString(manual.pmcid).toUpperCase().match(/PMC\d+/)?.[0] ||
    (text.match(/\b(PMC\d{5,12})\b/i) || [])[1]?.toUpperCase() ||
    "";
  const nctId =
    cleanString(manual.nctId).toUpperCase().match(/NCT\d{8}/)?.[0] ||
    (text.match(/\b(NCT\d{8})\b/i) || [])[1]?.toUpperCase() ||
    "";
  const pii =
    normalizePii(manual.pii) ||
    normalizePii((decodedUrl.match(/\/article\/(?:PII)?(S?\d{4}-?\d{3,4}[A-Z]?\(\d{2}\)\d{5}-?\d)/i) || [])[1] || "") ||
    normalizePii((decodedUrl.match(/\/pii\/(?:PII)?(S?\d{4}-?\d{3,4}[A-Z]?\(\d{2}\)\d{5}-?\d)/i) || [])[1] || "") ||
    normalizePii((text.match(/\b(?:PII[:\s]*)?(S\d{4}-?\d{3,4}[A-Z]?\(\d{2}\)\d{5}-?\d)\b/i) || [])[1] || "");
  return mergeIdentifierValues({ doi, pmid, pmcid, nctId, pii });
};

const getHtmlAttr = (tag, attr) => {
  const quoted = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, "i"));
  if (quoted) return decodeHtmlEntities(quoted[1]);
  const unquoted = tag.match(new RegExp(`${attr}\\s*=\\s*([^\\s>]+)`, "i"));
  return unquoted ? decodeHtmlEntities(unquoted[1]) : "";
};

const extractMetaEntries = (html = "") => {
  const entries = [];
  const tags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  tags.forEach((tag) => {
    const key = (getHtmlAttr(tag, "name") || getHtmlAttr(tag, "property")).toLowerCase();
    const content = getHtmlAttr(tag, "content");
    if (key && content) entries.push({ key, content });
  });
  return entries;
};

const extractMetadataMap = (html = "") => {
  const meta = {};
  extractMetaEntries(html).forEach(({ key, content }) => {
    if (!meta[key]) meta[key] = content;
  });
  return meta;
};

const extractMetadataValues = (html = "") => {
  const values = {};
  extractMetaEntries(html).forEach(({ key, content }) => {
    values[key] = values[key] || [];
    values[key].push(content);
  });
  return values;
};

const firstMeta = (values = {}, keys = []) => {
  for (const key of keys) {
    const list = values[key] || [];
    const value = list.find((entry) => cleanString(entry));
    if (value) return cleanString(value);
  }
  return "";
};

const listMeta = (values = {}, keys = [], limit = 20) => {
  const found = [];
  keys.forEach((key) => {
    (values[key] || []).forEach((value) => {
      const clean = cleanString(value);
      if (clean && !found.includes(clean)) found.push(clean);
    });
  });
  return found.slice(0, limit);
};

const extractTitleTag = (html = "") => {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].replace(/\s+/g, " ")) : "";
};

const extractH1Text = (html = "") => {
  const match = String(html || "").match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? stripHtmlToText(match[1]) : "";
};

const valueFromNestedObject = (value) => {
  if (!value || typeof value !== "object") return "";
  for (const key of ["name", "headline", "title", "@id"]) {
    if (typeof value[key] === "string" && value[key].trim()) return cleanString(value[key]);
  }
  return "";
};

const arrayFromNestedValue = (value, limit = 20) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => arrayFromNestedValue(entry, limit))
      .filter(Boolean)
      .slice(0, limit);
  }
  if (typeof value === "string") return normalizeList(value, limit);
  const nested = valueFromNestedObject(value);
  return nested ? [nested] : [];
};

const flattenJsonLd = (jsonLd) => {
  const queue = Array.isArray(jsonLd) ? [...jsonLd] : [jsonLd];
  const items = [];
  while (queue.length && items.length < 80) {
    const item = queue.shift();
    if (!item || typeof item !== "object") continue;
    items.push(item);
    Object.values(item).forEach((value) => {
      if (Array.isArray(value)) queue.push(...value);
      else if (value && typeof value === "object") queue.push(value);
    });
  }
  return items;
};

const pickJsonLdValue = (jsonLd, keys = []) => {
  for (const item of flattenJsonLd(jsonLd)) {
    for (const key of keys) {
      if (typeof item[key] === "string" && item[key].trim()) return cleanString(item[key]);
      if (Array.isArray(item[key])) {
        const firstString = item[key].find((entry) => typeof entry === "string" && entry.trim());
        if (firstString) return cleanString(firstString);
        const firstObjectValue = item[key].map(valueFromNestedObject).find(Boolean);
        if (firstObjectValue) return cleanString(firstObjectValue);
      }
      const nested = valueFromNestedObject(item[key]);
      if (nested) return cleanString(nested);
    }
  }
  return "";
};

const pickJsonLdList = (jsonLd, keys = [], limit = 20) => {
  const found = [];
  flattenJsonLd(jsonLd).forEach((item) => {
    keys.forEach((key) => {
      arrayFromNestedValue(item[key], limit).forEach((value) => {
        if (value && !found.includes(value)) found.push(value);
      });
    });
  });
  return found.slice(0, limit);
};

const extractJsonLd = (html = "") => {
  const scripts = String(html || "").match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const parsed = [];
  for (const script of scripts.slice(0, 12)) {
    const raw = script.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    if (!raw) continue;
    try {
      parsed.push(JSON.parse(raw));
    } catch (e) {}
  }
  if (!parsed.length) return null;
  return parsed.length === 1 ? parsed[0] : parsed;
};

const extractStructuredMetadata = (html = "") => {
  const jsonLd = extractJsonLd(html);
  if (!jsonLd) return { fields: {}, fieldsDetected: [] };
  const fields = {
    title: pickJsonLdValue(jsonLd, ["headline", "name"]),
    sourceName: pickJsonLdValue(jsonLd, ["publisher", "isPartOf"]),
    publicationDate: pickJsonLdValue(jsonLd, ["datePublished", "dateCreated"]),
    description: pickJsonLdValue(jsonLd, ["abstract", "description"]),
    authors: pickJsonLdList(jsonLd, ["author", "creator"]),
    keywords: pickJsonLdList(jsonLd, ["keywords", "about"]),
    doi: pickJsonLdValue(jsonLd, ["identifier", "sameAs"])
  };
  return {
    fields,
    fieldsDetected: Object.entries(fields)
      .filter(([, value]) => (Array.isArray(value) ? value.length : Boolean(value)))
      .map(([key]) => `jsonld.${key}`)
  };
};

const extractCitationMetadata = (html = "") => {
  const values = extractMetadataValues(html);
  const fields = {
    title: firstMeta(values, ["citation_title"]),
    sourceName: firstMeta(values, ["citation_journal_title", "citation_publisher"]),
    publicationDate: firstMeta(values, ["citation_publication_date", "citation_online_date"]),
    doi: firstMeta(values, ["citation_doi"]),
    authors: listMeta(values, ["citation_author"], 40),
    abstract: firstMeta(values, ["citation_abstract"]),
    keywords: normalizeList(listMeta(values, ["citation_keywords"], 20).join(","), 20),
    publisher: firstMeta(values, ["citation_publisher"]),
    fulltextHtmlUrl: firstMeta(values, ["citation_fulltext_html_url"]),
    pdfUrl: firstMeta(values, ["citation_pdf_url"])
  };
  return {
    fields,
    fieldsDetected: Object.entries(fields)
      .filter(([, value]) => (Array.isArray(value) ? value.length : Boolean(value)))
      .map(([key]) => `citation.${key}`)
  };
};

const extractOpenGraphMetadata = (html = "") => {
  const values = extractMetadataValues(html);
  const fields = {
    title: firstMeta(values, ["og:title", "twitter:title"]),
    sourceName: firstMeta(values, ["og:site_name"]),
    description: firstMeta(values, ["og:description", "twitter:description"]),
    officialUrl: firstMeta(values, ["og:url"]),
    publicationDate: firstMeta(values, ["article:published_time"]),
    section: firstMeta(values, ["article:section"]),
    tags: listMeta(values, ["article:tag"], 20)
  };
  return {
    fields,
    fieldsDetected: Object.entries(fields)
      .filter(([, value]) => (Array.isArray(value) ? value.length : Boolean(value)))
      .map(([key]) => `openGraph.${key}`)
  };
};

const looksLikeBlockedTitle = (title = "") =>
  /heath advance|access denied|just a moment|captcha|robot|forbidden|attention required|verify/i.test(title);

const detectAccessSignals = (html = "", responseStatus = 0) => {
  const text = stripHtmlToText(html).slice(0, 3000);
  const hasCaptcha = /captcha|not a robot|are you human|robot check|verify you are human|heath advance|unusual traffic/i.test(text);
  const hasAccessDenied = /access denied|request blocked|forbidden|temporarily unavailable|security check/i.test(text);
  const hasPaywall = /paywall|subscribe|subscription|purchase access|institutional access|access options|sign in to access/i.test(text);
  return {
    hasCaptcha,
    hasAccessDenied: hasAccessDenied || responseStatus === 401 || responseStatus === 403,
    hasPaywall,
    hasAccessLimit: hasCaptcha || hasAccessDenied || hasPaywall || responseStatus === 401 || responseStatus === 403
  };
};

const extractSectionBlocksByHeading = (html = "") => {
  const cleanHtml = stripNonContentHtml(html);
  const sections = [];
  const headingRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings = [];
  let match = headingRegex.exec(cleanHtml);
  while (match && headings.length < 120) {
    const headingText = stripHtmlToText(match[2]).toLowerCase();
    const key = SCIENTIFIC_SECTION_NAMES.find((name) => headingText.includes(name));
    if (key) headings.push({ key, label: SECTION_LABELS.get(key) || headingText, index: match.index, end: headingRegex.lastIndex });
    match = headingRegex.exec(cleanHtml);
  }
  headings.forEach((heading, index) => {
    const next = headings[index + 1]?.index || cleanHtml.length;
    const text = stripHtmlToText(cleanHtml.slice(heading.end, next)).slice(0, MAX_SECTION_CHARS);
    if (text && text.length >= 40) sections.push({ heading: heading.label, text });
  });
  return sections;
};

const extractSectionBlocksByClass = (html = "") => {
  const sections = [];
  const blockRegex =
    /<(section|div|article)\b[^>]*(?:id|class)=["'][^"']*(abstract|summary|methods|results|discussion|conclusion|background|interpretation|findings)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let match = blockRegex.exec(html);
  while (match && sections.length < 8) {
    const key = SCIENTIFIC_SECTION_NAMES.find((name) => match[2].toLowerCase().includes(name)) || match[2].toLowerCase();
    const text = stripHtmlToText(match[3]).slice(0, MAX_SECTION_CHARS);
    if (text && text.length >= 40) sections.push({ heading: SECTION_LABELS.get(key) || key, text });
    match = blockRegex.exec(html);
  }
  return sections;
};

const dedupeSections = (sections = []) => {
  const seen = new Set();
  return sections
    .map((section) => ({
      heading: cleanString(section.heading),
      text: cleanString(section.text).slice(0, MAX_SECTION_CHARS)
    }))
    .filter((section) => {
      if (!section.heading || !section.text) return false;
      const key = `${section.heading}:${section.text.slice(0, 140).toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
};

const extractVisibleScientificText = (html = "") => {
  const sections = dedupeSections([
    ...extractSectionBlocksByClass(html),
    ...extractSectionBlocksByHeading(html)
  ]);
  if (sections.length) return sections;

  const bodyText = stripHtmlToText(stripNonContentHtml(html));
  if (bodyText.length >= 500) {
    return [{ heading: "Contenido visible", text: bodyText.slice(0, MAX_SECTION_CHARS) }];
  }
  return [];
};

const extractPublicArticleText = (html = "") =>
  extractVisibleScientificText(html)
    .map((section) => `${section.heading}\n${section.text}`)
    .join("\n\n")
    .slice(0, MAX_VISIBLE_TEXT_CHARS);

const mergeKeywords = (...lists) => {
  const merged = [];
  lists.flat().forEach((value) => {
    normalizeList(value, 20).forEach((item) => {
      if (item && !merged.includes(item)) merged.push(item);
    });
  });
  return merged.slice(0, 20);
};

const buildDetectedMetadata = ({ citation, structured, openGraph, htmlTitle, h1Text, url, accessSignals }) => {
  const citationFields = citation.fields;
  const structuredFields = structured.fields;
  const openGraphFields = openGraph.fields;
  const rawTitle =
    citationFields.title ||
    structuredFields.title ||
    openGraphFields.title ||
    h1Text ||
    htmlTitle;
  const title = looksLikeBlockedTitle(rawTitle) || accessSignals.hasCaptcha ? "" : cleanString(rawTitle);
  const sourceName =
    citationFields.sourceName ||
    citationFields.publisher ||
    structuredFields.sourceName ||
    openGraphFields.sourceName ||
    url.hostname.replace(/^www\./, "");
  const description =
    citationFields.abstract ||
    structuredFields.description ||
    openGraphFields.description;

  return {
    title,
    sourceName: cleanString(sourceName),
    publicationDate: cleanString(citationFields.publicationDate || structuredFields.publicationDate || openGraphFields.publicationDate),
    description: accessSignals.hasCaptcha ? "" : cleanString(description),
    doi: cleanString(citationFields.doi || structuredFields.doi),
    authors: [...(citationFields.authors || []), ...(structuredFields.authors || [])].slice(0, 40),
    keywords: mergeKeywords(citationFields.keywords, structuredFields.keywords, openGraphFields.tags),
    publisher: cleanString(citationFields.publisher || structuredFields.sourceName || openGraphFields.sourceName),
    fulltextHtmlUrl: cleanString(citationFields.fulltextHtmlUrl),
    pdfUrl: cleanString(citationFields.pdfUrl),
    section: cleanString(openGraphFields.section)
  };
};

const extractHtmlSignals = (html = "", url, fetchInfo = {}) => {
  const responseStatus = Number(fetchInfo.statusCode || 0);
  const accessSignals = detectAccessSignals(html, responseStatus);
  const citation = extractCitationMetadata(html);
  const structured = extractStructuredMetadata(html);
  const openGraph = extractOpenGraphMetadata(html);
  const htmlTitle = extractTitleTag(html);
  const h1Text = extractH1Text(html);
  let visibleTextSections = extractVisibleScientificText(html);
  if (accessSignals.hasCaptcha) {
    visibleTextSections = visibleTextSections.filter((section) => /abstract|summary|methods|results|findings|conclusion/i.test(section.heading));
  }
  const detectedMetadata = buildDetectedMetadata({
    citation,
    structured,
    openGraph,
    htmlTitle,
    h1Text,
    url,
    accessSignals
  });

  const metadataFieldsDetected = [
    ...citation.fieldsDetected,
    ...structured.fieldsDetected,
    ...openGraph.fieldsDetected,
    ...(h1Text && !accessSignals.hasCaptcha ? ["html.h1"] : []),
    ...(htmlTitle && !looksLikeBlockedTitle(htmlTitle) && !accessSignals.hasCaptcha ? ["html.title"] : [])
  ];
  const contentLength = visibleTextSections.reduce((total, section) => total + cleanString(section.text).length, 0);

  const warnings = [];
  if (accessSignals.hasAccessLimit) {
    warnings.push("El sitio limita el acceso al contenido público. Se extrajeron solo metadatos disponibles.");
  }
  if (!detectedMetadata.title) warnings.push("No se pudo detectar título desde los metadatos públicos.");
  if (!detectedMetadata.description && !visibleTextSections.length) {
    warnings.push("No se pudo detectar resumen público; completar manualmente.");
  }
  if (!detectedMetadata.publicationDate) warnings.push("No se pudo detectar fecha de publicación.");
  if (/preprint|medrxiv|biorxiv/i.test(`${url.hostname} ${detectedMetadata.title} ${detectedMetadata.description}`)) {
    warnings.push("La fuente parece corresponder a preprint o contenido no revisado por pares.");
  }
  (fetchInfo.warnings || []).forEach((warning) => {
    if (warning && !warnings.includes(warning)) warnings.push(warning);
  });

  return {
    detectedMetadata,
    visibleTextSections,
    pageSignals: {
      ...accessSignals,
      hasAbstract: Boolean(detectedMetadata.description || visibleTextSections.some((section) => /abstract|summary/i.test(section.heading))),
      hasFullText: visibleTextSections.some((section) => /methods|results|discussion|findings|conclusion/i.test(section.heading)),
      hasScientificContent: Boolean(detectedMetadata.description || contentLength >= 500) && !accessSignals.hasCaptcha,
      contentLength,
      metadataFieldsDetected
    },
    warnings: warnings.slice(0, 8)
  };
};

const buildEvidencePacket = (htmlSignals, url, fetchInfo = {}) => {
  const usedSources = [];
  if (htmlSignals.pageSignals.metadataFieldsDetected.some((field) => field.startsWith("citation."))) usedSources.push("citation_meta");
  if (htmlSignals.pageSignals.metadataFieldsDetected.some((field) => field.startsWith("jsonld."))) usedSources.push("json_ld");
  if (htmlSignals.pageSignals.metadataFieldsDetected.some((field) => field.startsWith("openGraph."))) usedSources.push("open_graph");
  if (htmlSignals.visibleTextSections.length) usedSources.push("visible_text");
  if (!usedSources.length) usedSources.push("url");

  const packet = {
    officialUrl: url.href,
    sourceDomain: url.hostname,
    detectedMetadata: htmlSignals.detectedMetadata,
    visibleTextSections: htmlSignals.visibleTextSections
      .map((section) => ({ heading: section.heading, text: section.text.slice(0, MAX_SECTION_CHARS) }))
      .slice(0, 10),
    pageSignals: {
      ...htmlSignals.pageSignals,
      httpStatus: fetchInfo.statusCode || 0,
      contentType: fetchInfo.contentType || "",
      finalUrl: fetchInfo.finalUrl || url.href
    },
    warnings: htmlSignals.warnings,
    rawEvidence: {
      metadataFieldsDetected: htmlSignals.pageSignals.metadataFieldsDetected,
      contentLength: htmlSignals.pageSignals.contentLength,
      usedSources
    }
  };
  packet.methodologyEvidence = buildMethodologyEvidence(packet);
  packet.preclassification = preclassifyMethodology(packet, SCIENTIFIC_METHODOLOGY_TAXONOMY);
  packet.rawEvidence.methodologyEvidenceSections = Object.entries(packet.methodologyEvidence || {})
    .filter(([, section]) => cleanString(section?.text))
    .map(([key]) => key)
    .slice(0, 20);
  packet.rawEvidence.preclassification = packet.preclassification;
  return packet;
};

const buildRawEvidence = (evidencePacket = {}) =>
  evidencePacket.rawEvidence || {
    metadataFieldsDetected: [],
    contentLength: 0,
    usedSources: []
  };

const buildMetadataOnlyArticle = (url, metadata = {}, evidencePacket = {}) => ({
  title: cleanString(metadata.title),
  sourceName: cleanString(metadata.sourceName),
  sourceDomain: url.hostname,
  officialUrl: url.href,
  doi: cleanString(metadata.doi),
  pmid: cleanString(metadata.pmid),
  pmcid: cleanString(metadata.pmcid),
  nctId: cleanString(metadata.nctId),
  pii: cleanString(metadata.pii),
  studyType: "",
  evidenceType: "",
  publicationDate: cleanString(metadata.publicationDate),
  studyLocation: "",
  briefDescriptionEs: cleanString(metadata.description || metadata.summary || metadata.abstract).slice(0, 280),
  expandedDescriptionEs: cleanString(metadata.description || metadata.summary || metadata.abstract),
  expandedDescriptionSections: [],
  expandedDescriptionQuality: cleanString(metadata.description || metadata.summary || metadata.abstract).length >= 120
    ? "partial"
    : "insufficient",
  executiveSummary: cleanString(metadata.description || metadata.summary || metadata.abstract),
  clinicalQuestion: "",
  mainResult: "",
  methodologyProfile: buildEmptyMethodologyProfile(),
  tags: normalizeList(metadata.keywords || [], 12),
  accessType: normalizeAccessType(metadata.accessType) !== "Pendiente"
    ? normalizeAccessType(metadata.accessType)
    : evidencePacket?.pageSignals?.hasAccessLimit
    ? "Suscripción"
    : metadata.description || metadata.summary || metadata.abstract
      ? "Resumen disponible"
      : "Pendiente",
  extractionConfidence: metadata.title || metadata.description || metadata.summary || metadata.abstract || metadata.publicationDate ? 0.3 : 0.1,
  warnings: normalizeList(evidencePacket.warnings || metadata.warnings, 8)
});

const extractScientificMetadata = (url, html = "") => {
  const signals = extractHtmlSignals(html, url, { statusCode: 0, warnings: [] });
  const packet = buildEvidencePacket(signals, url);
  return {
    ...packet.detectedMetadata,
    sourceName: packet.detectedMetadata.sourceName,
    description: packet.detectedMetadata.description,
    publicText: packet.visibleTextSections.map((section) => section.text).join("\n\n").slice(0, MAX_VISIBLE_TEXT_CHARS),
    warnings: packet.warnings
  };
};

const readStringAlias = (input = {}, keys = []) => {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) return cleanString(value);
    if (Array.isArray(value)) {
      const first = value.find((entry) => typeof entry === "string" && entry.trim());
      if (first) return cleanString(first);
    }
    const nested = valueFromNestedObject(value);
    if (nested) return cleanString(nested);
  }
  return "";
};

const normalizeAiInputAliases = (input = {}) => ({
  title: readStringAlias(input, ["title", "titulo", "articleTitle", "headline"]),
  sourceName: readStringAlias(input, ["sourceName", "source", "journal", "journalTitle", "revista", "fuente", "publisher"]),
  officialUrl: readStringAlias(input, ["officialUrl", "articleUrl", "url", "link", "doiUrl"]),
  sourceDomain: readStringAlias(input, ["sourceDomain", "domain", "hostname", "source_host"]),
  doi: cleanDoi(readStringAlias(input, ["doi", "DOI"])),
  pmid: readStringAlias(input, ["pmid", "PMID"]).replace(/\D/g, ""),
  pmcid: readStringAlias(input, ["pmcid", "PMCID"]).toUpperCase().match(/PMC\d+/)?.[0] || "",
  nctId: readStringAlias(input, ["nctId", "nct_id", "NCT"]).toUpperCase().match(/NCT\d{8}/)?.[0] || "",
  pii: normalizePii(readStringAlias(input, ["pii", "PII"])),
  studyType: readStringAlias(input, ["studyType", "typeOfStudy", "study_design", "studyDesign", "tipoEstudio", "tipo_de_estudio", "design"]),
  evidenceType: readStringAlias(input, ["evidenceType", "typeOfEvidence", "evidence_level", "evidenceLevel", "tipoEvidencia", "tipo_de_evidencia"]),
  publicationDate: readStringAlias(input, ["publicationDate", "publishedAt", "publication_date", "datePublished", "fechaPublicacion", "fecha_de_publicacion"]),
  studyLocation: readStringAlias(input, ["studyLocation", "location", "studyCountry", "setting", "lugar", "contexto"]),
  briefDescriptionEs: readStringAlias(input, ["briefDescriptionEs", "cardSummaryEs", "briefDescription", "summaryCard", "resumenBreve"]),
  expandedDescriptionEs: readStringAlias(input, ["expandedDescriptionEs", "executiveSummaryEs", "expandedDescription", "summary", "abstract", "resumenAmpliado"]),
  expandedDescriptionSections: normalizeExpandedDescriptionSections(input.expandedDescriptionSections || input.expandedSections || input.seccionesDescripcionAmpliada),
  expandedDescriptionQuality: normalizeExpandedDescriptionQuality(input.expandedDescriptionQuality || input.descriptionQuality || input.calidadDescripcionAmpliada),
  executiveSummary: readStringAlias(input, ["executiveSummary", "summary", "abstract", "resumen", "resumenEjecutivo", "resumen_ejecutivo"]),
  clinicalQuestion: readStringAlias(input, ["clinicalQuestion", "question", "researchQuestion", "preguntaClinica", "pregunta_clinica", "pregunta"]),
  mainResult: readStringAlias(input, ["mainResult", "result", "results", "findings", "conclusion", "resultadoPrincipal", "resultado_principal", "mainFinding"]),
  methodologyProfile: normalizeMethodologyProfile(input.methodologyProfile),
  tags: normalizeList(input.tags || input.keywords || input.etiquetas || input.palabrasClave || input.palabras_clave),
  accessType: readStringAlias(input, ["accessType", "access", "acceso", "availability"]),
  extractionConfidence: Number.isFinite(Number(input.extractionConfidence ?? input.confidence ?? input.confianza))
    ? Math.max(0, Math.min(1, Number(input.extractionConfidence ?? input.confidence ?? input.confianza)))
    : null,
  warnings: normalizeList(input.warnings || input.advertencias || input.cautions, 8)
});

const normalizeAccessType = (value = "") => {
  const clean = cleanString(value);
  if (ACCESS_TYPES.includes(clean)) return clean;
  if (/open|free|libre/i.test(clean)) return "Open access";
  if (/suscrip|subscription|paywall|restricted/i.test(clean)) return "Suscripción";
  if (/resumen|abstract/i.test(clean)) return "Resumen disponible";
  return "Pendiente";
};

const normalizeAiArticleOutput = (url, evidenceOrMetadata = {}, input = {}) => {
  const metadata = evidenceOrMetadata.merged || evidenceOrMetadata.detectedMetadata || evidenceOrMetadata || {};
  const fallback = buildMetadataOnlyArticle(url, metadata, evidenceOrMetadata);
  const normalized = normalizeAiInputAliases(input);
  const identifiers = mergeIdentifierValues(evidenceOrMetadata.identifiers || {}, metadata || {}, normalized || {});
  const article = {
    ...fallback,
    title: fallback.title || normalized.title,
    sourceName: fallback.sourceName || normalized.sourceName,
    officialUrl: url.href,
    sourceDomain: url.hostname,
    doi: identifiers.doi,
    pmid: identifiers.pmid,
    pmcid: identifiers.pmcid,
    nctId: identifiers.nctId,
    pii: identifiers.pii,
    studyType: normalized.studyType,
    evidenceType: normalized.evidenceType,
    publicationDate: fallback.publicationDate || normalized.publicationDate,
    studyLocation: normalized.studyLocation,
    briefDescriptionEs: normalized.briefDescriptionEs || fallback.briefDescriptionEs,
    expandedDescriptionEs: normalized.expandedDescriptionEs || normalized.executiveSummary || fallback.expandedDescriptionEs,
    expandedDescriptionSections: normalized.expandedDescriptionSections.length
      ? normalized.expandedDescriptionSections
      : fallback.expandedDescriptionSections || [],
    expandedDescriptionQuality: normalized.expandedDescriptionQuality || fallback.expandedDescriptionQuality || "insufficient",
    executiveSummary: normalized.expandedDescriptionEs || normalized.executiveSummary || fallback.executiveSummary,
    clinicalQuestion: normalized.clinicalQuestion,
    mainResult: normalized.mainResult,
    methodologyProfile: normalizeMethodologyProfile(normalized.methodologyProfile),
    tags: normalized.tags.length ? normalized.tags : fallback.tags,
    accessType: normalizeAccessType(fallback.accessType || normalized.accessType),
    extractionConfidence: normalized.extractionConfidence ?? 0.45,
    warnings: normalized.warnings.length ? normalized.warnings : fallback.warnings
  };
  if (!article.warnings.length) {
    article.warnings.push("El resumen automático debe ser revisado por el equipo médico.");
  }
  article.methodologyProfile.specificDesign = article.methodologyProfile.specificDesign || article.studyType;
  article.methodologyProfile.designCategoryEs =
    article.methodologyProfile.designCategoryEs ||
    inferDesignCategoryFromProfile(article.methodologyProfile) ||
    article.studyType ||
    article.evidenceType;
  article.methodologyProfile.countryOrRegion = article.methodologyProfile.countryOrRegion || article.studyLocation;
  return finalizeExpandedDescriptionFields(article, evidenceOrMetadata);
};

const parseJsonObjectFromText = (text = "") => {
  const clean = cleanString(text);
  if (!clean) return null;
  try {
    return JSON.parse(clean);
  } catch (e) {}
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
};

const validateAIArticleSchema = (input = {}) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "invalid_schema", message: "La respuesta de IA no es un objeto válido." };
  }
  const missing = AI_ARTICLE_FIELD_KEYS.filter((key) => !(key in input));
  if (missing.length) {
    return { ok: false, code: "missing_fields", message: `Faltan campos requeridos: ${missing.join(", ")}` };
  }
  const stringFields = AI_ARTICLE_FIELD_KEYS.filter(
    (key) => !["tags", "warnings", "extractionConfidence", "methodologyProfile", "expandedDescriptionSections"].includes(key)
  );
  const badString = stringFields.find((key) => typeof input[key] !== "string");
  if (badString) return { ok: false, code: "invalid_field_type", message: `${badString} debe ser string.` };
  if (!Array.isArray(input.expandedDescriptionSections)) {
    return { ok: false, code: "invalid_expanded_description_sections", message: "expandedDescriptionSections debe ser array." };
  }
  if (
    !input.expandedDescriptionSections.every(
      (section) =>
        section &&
        typeof section === "object" &&
        !Array.isArray(section) &&
        typeof section.heading === "string" &&
        typeof section.body === "string"
    )
  ) {
    return {
      ok: false,
      code: "invalid_expanded_description_sections",
      message: "expandedDescriptionSections debe contener heading y body."
    };
  }
  if (!EXPANDED_DESCRIPTION_QUALITY_VALUES.includes(input.expandedDescriptionQuality)) {
    return { ok: false, code: "invalid_expanded_description_quality", message: "expandedDescriptionQuality no es válido." };
  }
  if (!input.methodologyProfile || typeof input.methodologyProfile !== "object" || Array.isArray(input.methodologyProfile)) {
    return { ok: false, code: "invalid_methodology_profile", message: "methodologyProfile debe ser objeto." };
  }
  for (const key of METHODOLOGY_PROFILE_KEYS) {
    if (!(key in input.methodologyProfile)) {
      return { ok: false, code: "invalid_methodology_profile", message: `Falta methodologyProfile.${key}.` };
    }
    if (METHODOLOGY_LIST_FIELDS.has(key) && !Array.isArray(input.methodologyProfile[key])) {
      return { ok: false, code: "invalid_methodology_profile", message: `${key} debe ser array.` };
    }
    if (METHODOLOGY_BOOLEAN_FIELDS.has(key) && typeof input.methodologyProfile[key] !== "boolean") {
      return { ok: false, code: "invalid_methodology_profile", message: `${key} debe ser boolean.` };
    }
    if (
      METHODOLOGY_OBJECT_FIELDS.has(key) &&
      (!input.methodologyProfile[key] ||
        typeof input.methodologyProfile[key] !== "object" ||
        Array.isArray(input.methodologyProfile[key]))
    ) {
      return { ok: false, code: "invalid_methodology_profile", message: `${key} debe ser objeto.` };
    }
    if (
      !METHODOLOGY_LIST_FIELDS.has(key) &&
      !METHODOLOGY_BOOLEAN_FIELDS.has(key) &&
      !METHODOLOGY_OBJECT_FIELDS.has(key) &&
      typeof input.methodologyProfile[key] !== "string"
    ) {
      return { ok: false, code: "invalid_methodology_profile", message: `${key} debe ser string.` };
    }
  }
  if (!Array.isArray(input.tags) || !input.tags.every((item) => typeof item === "string")) {
    return { ok: false, code: "invalid_tags", message: "tags debe ser array de strings." };
  }
  if (!Array.isArray(input.warnings) || !input.warnings.every((item) => typeof item === "string")) {
    return { ok: false, code: "invalid_warnings", message: "warnings debe ser array de strings." };
  }
  if (!Number.isFinite(Number(input.extractionConfidence))) {
    return { ok: false, code: "invalid_confidence", message: "extractionConfidence debe ser numérico." };
  }
  return { ok: true };
};

const scoreExtractionCompleteness = (article = {}) => {
  const usefulFields = [
    cleanString(article.briefDescriptionEs).length >= 24,
    cleanString(article.expandedDescriptionEs || article.executiveSummary).length >= 24 ||
      (Array.isArray(article.expandedDescriptionSections) && article.expandedDescriptionSections.length >= 2),
    cleanString(article.clinicalQuestion).length >= 24,
    cleanString(article.mainResult).length >= 24,
    Boolean(cleanString(article.studyType)),
    Boolean(cleanString(article.evidenceType)),
    Boolean(cleanString(article.publicationDate))
  ].filter(Boolean).length;
  const confidence = Math.max(0, Math.min(1, Number(article.extractionConfidence || 0)));
  const hasIdentity = Boolean(cleanString(article.title) && cleanString(article.sourceName) && cleanString(article.officialUrl));
  const completedFields = FINAL_ARTICLE_FIELD_KEYS.filter((key) => {
    const value = article[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(cleanString(value));
  });
  return {
    isUseful: hasIdentity && usefulFields >= 2 && confidence >= 0.55,
    usefulFieldCount: usefulFields,
    completedFields,
    completedFieldCount: completedFields.length,
    confidence
  };
};

const getAiDraftQuality = (input = {}) => scoreExtractionCompleteness(normalizeAiInputAliases(input));

const hasMetadataContent = (article = {}) => {
  const sourceName = cleanString(article.sourceName);
  const domain = cleanString(article.sourceDomain).replace(/^www\./, "");
  const sourceIsOnlyDomain = sourceName && domain && sourceName.replace(/^www\./, "") === domain;
  return Boolean(
    article.title ||
      article.publicationDate ||
      article.executiveSummary ||
      article.tags?.length ||
      (sourceName && !sourceIsOnlyDomain)
  );
};

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

const buildOpenAiArticleExtractionPayload = (evidenceOrUrl, maybeMetadata = {}) => {
  const evidencePacket =
    evidenceOrUrl instanceof URL
      ? {
          officialUrl: evidenceOrUrl.href,
          sourceDomain: evidenceOrUrl.hostname,
          detectedMetadata: maybeMetadata,
          visibleTextSections: maybeMetadata.publicText ? [{ heading: "Texto público", text: maybeMetadata.publicText }] : [],
          pageSignals: {
            hasPaywall: false,
            hasAbstract: Boolean(maybeMetadata.description || maybeMetadata.publicText),
            hasFullText: Boolean(maybeMetadata.publicText),
            contentLength: cleanString(maybeMetadata.publicText).length,
            metadataFieldsDetected: [],
            hasAccessLimit: false
          },
          warnings: maybeMetadata.warnings || []
      }
    : evidenceOrUrl;

  const schema = {
    type: "object",
    additionalProperties: false,
    required: AI_ARTICLE_FIELD_KEYS,
    properties: {
      studyType: {
        type: "string",
        description: "Tipo de estudio identificado desde la evidencia. Dejar vacío si no se puede determinar."
      },
      evidenceType: {
        type: "string",
        description: "Tipo de evidencia en español, derivado de la evidencia disponible."
      },
      studyLocation: {
        type: "string",
        description: "Lugar, región o contexto del estudio si está explícito o claramente sostenido."
      },
      briefDescriptionEs: {
        type: "string",
        description: "Descripción breve en español, máximo 280 caracteres, para tarjeta. Responde de qué trata y por qué importa."
      },
      expandedDescriptionEs: {
        type: "string",
        description: "Síntesis editorial ampliada en español, ideal 350 a 550 palabras cuando haya evidencia pública suficiente, máximo 650. Debe explicar contexto, tipo de documento, diseño/evidencia, población, metodología, hallazgos y aplicabilidad sin inventar datos."
      },
      expandedDescriptionSections: {
        type: "array",
        minItems: 0,
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["heading", "body"],
          properties: {
            heading: { type: "string" },
            body: { type: "string" }
          }
        },
        description: "4 a 6 secciones breves para la descripción ampliada; usar [] si la evidencia pública es insuficiente."
      },
      expandedDescriptionQuality: {
        type: "string",
        enum: EXPANDED_DESCRIPTION_QUALITY_VALUES,
        description: "complete, partial o insufficient según calidad de la descripción ampliada."
      },
      executiveSummary: {
        type: "string",
        description: "Resumen ejecutivo en español basado solo en abstract, summary o texto científico disponible."
      },
      clinicalQuestion: {
        type: "string",
        description: "Pregunta que busca responder el artículo, en español."
      },
      mainResult: {
        type: "string",
        description: "Resultado principal o mensaje central, sin inventar datos."
      },
      methodologyProfile: buildMethodologyProfileSchema(),
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Etiquetas breves en español derivadas de título, keywords o abstract."
      },
      warnings: { type: "array", items: { type: "string" } },
      extractionConfidence: { type: "number", minimum: 0, maximum: 1 }
    }
  };

  const input = {
    inputUrl: evidencePacket.inputUrl || evidencePacket.officialUrl,
    officialUrl: evidencePacket.officialUrl,
    sourceDomain: evidencePacket.sourceDomain,
    identifiers: evidencePacket.identifiers || {},
    merged: evidencePacket.merged || evidencePacket.detectedMetadata || {},
    sources: (evidencePacket.sources || []).map((source) => ({
      source: source.source,
      status: source.status,
      confidence: source.confidence,
      fields: source.fields,
      warnings: source.warnings
    })),
    visibleTextSections: (evidencePacket.visibleTextSections || evidencePacket.merged?.visibleSections || [])
      .map((section) => ({
        heading: section.heading,
        text: cleanString(section.text).slice(0, MAX_SECTION_CHARS)
      }))
      .slice(0, 10),
    methodologyEvidence: evidencePacket.methodologyEvidence,
    preclassification: evidencePacket.preclassification,
    scientificMethodologyTaxonomy: SCIENTIFIC_METHODOLOGY_TAXONOMY,
    pageSignals: evidencePacket.pageSignals,
    warnings: evidencePacket.warnings
  };

  return {
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "scientific_article_extraction",
        strict: true,
        schema
      }
    },
    messages: [
      {
        role: "system",
        content: [
          "Sos un agente de extracción y síntesis de publicaciones científicas médicas para una bitácora institucional.",
          "Trabajás únicamente con evidencia real recibida desde resolutores bibliográficos y páginas científicas públicas.",
          "Respondé exclusivamente JSON válido conforme al schema.",
          "Todo el texto libre debe estar en español.",
          "No inventes datos. No uses conocimiento externo.",
          "No agregues DOI, PMID, PMCID, autores, fechas ni resultados si no están en la evidencia.",
          "No conviertas una fuente bloqueada en éxito.",
          "Si no hay abstract, summary o texto científico, dejá executiveSummary, clinicalQuestion y mainResult vacíos y agregá warning.",
          "Clasificá primero si es estudio clínico primario, revisión, guía/consenso, health policy/implementación u otro/no claro.",
          "Diferenciá el tipo de documento publicado del diseño o evidencia principal analizada. Si una revisión o focus seminar describe una cohorte, explicá ambos sin confundirlos.",
          "Si el artículo es una guía, policy framework, health policy, trial record, revisión, estudio observacional, diagnóstico, modelo predictivo o evaluación económica, clasificalo correctamente.",
          "Generá briefDescriptionEs en 180 a 280 caracteres, sin listas ni subtítulos.",
          "Generá expandedDescriptionEs como síntesis editorial en español de 350 a 550 palabras si hay contenido suficiente, máximo 650, dividida también en expandedDescriptionSections con 4 a 6 secciones.",
          "Incluí contexto, objetivo, tipo de documento, diseño/evidencia, población o ámbito, metodología, hallazgos/mensajes, cautelas y aplicabilidad solo cuando estén sustentados.",
          "Si la evidencia pública no alcanza para una descripción amplia, devolvé expandedDescriptionSections=[] y expandedDescriptionQuality='partial' o 'insufficient'; no rellenes con invención.",
          "Completá methodologyProfile solo con datos presentes o deducidos directamente: diseño, familia, temporalidad, ámbito, lugar, instituciones, población, muestra/alcance, período, duración, fuente, intervención, comparador y desenlaces.",
          "Usá evidenceSupport para marcar explicito, inferido_con_soporte, no_especificado o no_aplica con texto de soporte breve.",
          "No inventes muestra clínica, país, institución, duración, retrospectivo/prospectivo ni multicéntrico.",
          "Si hay múltiples países o instituciones en implementación o política sanitaria, describilo como alcance regional/internacional programático, no como estudio clínico multicéntrico salvo evidencia directa.",
          "No emitas recomendaciones clínicas. No modifiques protocolos.",
          "Usá la preclasificación determinística como orientación, pero corregila si la evidencia lo justifica."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify(input)
      }
    ]
  };
};

const callArticleExtractionAI = async (evidencePacket, { apiKey, fetchImpl = fetch } = {}) => {
  if (!apiKey) {
    return { ok: false, error: { code: "missing_openai_api_key", message: "Falta configurar OPENAI_API_KEY." } };
  }
  const extractionPayload = buildOpenAiArticleExtractionPayload(evidencePacket);
  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: extractionPayload.response_format,
      messages: extractionPayload.messages
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      error: { code: `openai_${response.status}`, message: "La IA no pudo completar la extracción." }
    };
  }
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: { code: "openai_invalid_json", message: "La IA devolvió una respuesta inválida." } };
  }
  const text = typeof data?.choices?.[0]?.message?.content === "string" ? data.choices[0].message.content : "";
  const parsed = parseJsonObjectFromText(text);
  if (!parsed) {
    return { ok: false, error: { code: "openai_empty_content", message: "La IA no devolvió datos estructurados." } };
  }
  const validation = validateAIArticleSchema(parsed);
  if (!validation.ok) {
    return { ok: false, error: { code: validation.code, message: validation.message }, article: parsed };
  }
  return { ok: true, article: parsed };
};

const buildExtractionResponse = ({ article, extractionStatus, rawEvidence, error }) => ({
  ok: true,
  extractionStatus,
  article,
  rawEvidence,
  ...(error ? { error } : {})
});

const logInternalAudit = (logger, event = {}) => {
  if (typeof logger === "function") logger(event);
};

const readResponseTextLimited = async (response, maxBytes = MAX_HTML_BYTES) => {
  if (!response.body?.getReader) {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let output = "";
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      output += decoder.decode(value, { stream: true });
      if (received >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
    output += decoder.decode();
  } catch (error) {
    try {
      await reader.cancel();
    } catch (e) {}
  }
  return output.slice(0, maxBytes);
};

const fetchScientificPage = async (
  articleUrl,
  { fetchImpl = fetch, maxRedirects = 4, timeoutMs = 9000, maxBytes = MAX_HTML_BYTES } = {}
) => {
  let currentUrl = articleUrl;
  const warnings = [];
  const usedSources = [];
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(currentUrl.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "DepartamentoMedicoBrisa/1.0 scientific-metadata-extractor",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8"
        }
      });
      usedSources.push(currentUrl.href);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location") || "";
        if (!location) {
          warnings.push("La fuente redirigió sin destino procesable.");
          return { html: "", finalUrl: currentUrl.href, statusCode: response.status, contentType: "", warnings, usedSources };
        }
        const nextUrl = parseArticleUrl(new URL(location, currentUrl.href).href);
        if (!nextUrl) {
          warnings.push("La fuente redirigió a una URL no permitida.");
          return { html: "", finalUrl: currentUrl.href, statusCode: response.status, contentType: "", warnings, usedSources };
        }
        currentUrl = nextUrl;
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      const canReadBody = /html|xml|text/i.test(contentType);
      const html = canReadBody ? await readResponseTextLimited(response, maxBytes) : "";
      if (!response.ok) warnings.push(`La fuente respondió HTTP ${response.status}.`);
      if (!canReadBody) warnings.push("La fuente no devolvió HTML procesable.");
      return {
        html,
        finalUrl: currentUrl.href,
        statusCode: response.status,
        contentType,
        warnings,
        usedSources
      };
    } catch (error) {
      warnings.push(error?.name === "AbortError" ? "La lectura de la fuente superó el tiempo máximo." : "No se pudo leer la página pública del artículo.");
      return { html: "", finalUrl: currentUrl.href, statusCode: 0, contentType: "", warnings, usedSources };
    } finally {
      clearTimeout(timeout);
    }
  }
  warnings.push("La fuente superó el límite de redirecciones.");
  return { html: "", finalUrl: currentUrl.href, statusCode: 0, contentType: "", warnings, usedSources };
};

const withTimeout = async (url, { fetchImpl = fetch, timeoutMs = 9000, headers = {}, maxBytes = MAX_HTML_BYTES } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": `${NCBI_TOOL_NAME}/1.0 scientific-article-resolver`,
        Accept: "application/json,text/xml,application/xml,text/plain;q=0.8",
        ...headers
      }
    });
    const text = await readResponseTextLimited(response, maxBytes);
    return { ok: response.ok, status: response.status, text, contentType: response.headers?.get?.("content-type") || "" };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      error: error?.name === "AbortError" ? "timeout" : "fetch_failed",
      contentType: ""
    };
  } finally {
    clearTimeout(timeout);
  }
};

const fetchJson = async (url, options = {}) => {
  const response = await withTimeout(url, options);
  if (!response.ok) return { ok: false, status: response.status, error: response.error || `http_${response.status}` };
  try {
    return { ok: true, status: response.status, data: JSON.parse(response.text) };
  } catch (error) {
    return { ok: false, status: response.status, error: "invalid_json" };
  }
};

const xmlTagTexts = (xml = "", tag = "") => {
  const out = [];
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match = regex.exec(String(xml || ""));
  while (match && out.length < 80) {
    const text = stripHtmlToText(match[1]);
    if (text) out.push(text);
    match = regex.exec(String(xml || ""));
  }
  return out;
};

const xmlFirstTagText = (xml = "", tag = "") => xmlTagTexts(xml, tag)[0] || "";

const xmlBlocks = (xml = "", tag = "") => {
  const out = [];
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match = regex.exec(String(xml || ""));
  while (match && out.length < 40) {
    out.push(match[1]);
    match = regex.exec(String(xml || ""));
  }
  return out;
};

const xmlIdByType = (xml = "", tag = "ArticleId", attr = "IdType", type = "") => {
  const regex = new RegExp(`<${tag}\\b[^>]*${attr}=["']${type}["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  return cleanString(stripHtmlToText((String(xml || "").match(regex) || [])[1] || ""));
};

const xmlDateFromBlock = (block = "") => {
  const year = xmlFirstTagText(block, "Year");
  if (!year) return "";
  const month = xmlFirstTagText(block, "Month");
  const day = xmlFirstTagText(block, "Day");
  const monthMap = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12"
  };
  const monthValue = month
    ? monthMap[month.slice(0, 3).toLowerCase()] || String(month).padStart(2, "0")
    : "";
  const dayValue = day ? String(day).padStart(2, "0") : "";
  return [year, monthValue, dayValue].filter(Boolean).join("-");
};

const dateFromParts = (dateParts = []) => {
  const parts = Array.isArray(dateParts?.[0]) ? dateParts[0] : dateParts;
  return (parts || []).filter((part) => part !== undefined && part !== null).map((part, index) => (
    index === 0 ? String(part) : String(part).padStart(2, "0")
  )).join("-");
};

const reconstructOpenAlexAbstract = (inverted = {}) => {
  if (!inverted || typeof inverted !== "object") return "";
  const words = [];
  Object.entries(inverted).forEach(([word, positions]) => {
    if (!Array.isArray(positions)) return;
    positions.forEach((position) => {
      if (Number.isInteger(position)) words[position] = word;
    });
  });
  return cleanString(words.filter(Boolean).join(" ")).slice(0, MAX_RESOLVER_TEXT_CHARS);
};

const makeEvidenceSource = ({ source, status = "skipped", confidence = 0, fields = {}, warnings = [] }) => ({
  source,
  status,
  confidence: Math.max(0, Math.min(1, Number(confidence || 0))),
  fields: {
    title: cleanString(fields.title),
    sourceName: cleanString(fields.sourceName),
    publicationDate: cleanString(fields.publicationDate),
    abstract: cleanString(fields.abstract || fields.description).slice(0, MAX_RESOLVER_TEXT_CHARS),
    summary: cleanString(fields.summary).slice(0, MAX_RESOLVER_TEXT_CHARS),
    authors: normalizeList(fields.authors || [], 40),
    doi: cleanDoi(fields.doi),
    pmid: cleanString(fields.pmid).replace(/\D/g, ""),
    pmcid: cleanString(fields.pmcid).toUpperCase().match(/PMC\d+/)?.[0] || "",
    nctId: cleanString(fields.nctId).toUpperCase().match(/NCT\d{8}/)?.[0] || "",
    pii: normalizePii(fields.pii),
    keywords: normalizeList(fields.keywords || fields.tags || [], 20),
    articleType: cleanString(fields.articleType || fields.type),
    accessType: normalizeAccessType(fields.accessType),
    officialUrl: cleanString(fields.officialUrl),
    studyLocation: cleanString(fields.studyLocation),
    visibleSections: dedupeSections(fields.visibleSections || [])
  },
  warnings: normalizeList(warnings, 8)
});

const sourceHasUsefulFields = (source = {}) =>
  Boolean(
    source.fields?.title ||
      source.fields?.sourceName ||
      source.fields?.doi ||
      source.fields?.pmid ||
      source.fields?.pmcid ||
      source.fields?.nctId ||
      source.fields?.pii ||
      source.fields?.abstract ||
      source.fields?.summary ||
      source.fields?.visibleSections?.length
  );

const sourceFromPublisherHtml = (htmlSignals, articleUrl, fetched) => {
  const blocked = Boolean(htmlSignals.pageSignals?.hasAccessLimit);
  const fields = {
    ...htmlSignals.detectedMetadata,
    abstract: htmlSignals.detectedMetadata?.description || "",
    visibleSections: htmlSignals.visibleTextSections || [],
    accessType: blocked ? "Suscripción" : htmlSignals.detectedMetadata?.description ? "Resumen disponible" : "Pendiente",
    officialUrl: articleUrl.href
  };
  const status = blocked ? "blocked" : sourceHasUsefulFields({ fields }) ? "success" : "failed";
  return makeEvidenceSource({
    source: "publisher_html",
    status,
    confidence: status === "success" ? 0.68 : status === "blocked" ? 0.18 : 0,
    fields,
    warnings: htmlSignals.warnings || fetched?.warnings || []
  });
};

const sourceFromManualEvidence = (input = {}, articleUrl) => {
  const identifiers = detectScientificIdentifiers(articleUrl, "", input);
  const hasManualText = Boolean(cleanString(input.pastedAbstract || input.pastedTitle || input.pastedSource));
  const hasManualIdentifier = Boolean(cleanString(input.doi || input.pmid || input.pmcid || input.nctId));
  const hasManualEvidence = hasManualText || hasManualIdentifier;
  return makeEvidenceSource({
    source: "manual_evidence",
    status: hasManualEvidence ? "success" : "skipped",
    confidence: hasManualText ? 0.72 : hasManualIdentifier ? 0.46 : 0,
    fields: {
      ...identifiers,
      title: input.pastedTitle,
      sourceName: input.pastedSource,
      abstract: input.pastedAbstract,
      officialUrl: articleUrl.href,
      accessType: input.pastedAbstract ? "Resumen disponible" : "Pendiente"
    },
    warnings: hasManualEvidence ? ["Parte de la evidencia fue aportada manualmente por el usuario."] : []
  });
};

const buildNcbiQuery = (params = {}) => {
  const query = new URLSearchParams(params);
  const email = cleanString(params.email || process.env.UNPAYWALL_EMAIL || "");
  if (!query.has("tool")) query.set("tool", NCBI_TOOL_NAME);
  if (email && !query.has("email")) query.set("email", email);
  return query;
};

const parsePubMedXml = (xml = "") => {
  const articleDate = xmlBlocks(xml, "ArticleDate")[0] || "";
  const journalIssue = xmlBlocks(xml, "JournalIssue")[0] || "";
  const pubDate = xmlBlocks(journalIssue, "PubDate")[0] || "";
  const publicationTypes = xmlTagTexts(xmlBlocks(xml, "PublicationTypeList")[0] || "", "PublicationType");
  const keywords = xmlTagTexts(xml, "Keyword");
  const abstract = xmlTagTexts(xml, "AbstractText").join(" ");
  const articleIds = {
    doi: xmlIdByType(xml, "ArticleId", "IdType", "doi") || xmlIdByType(xml, "ELocationID", "EIdType", "doi"),
    pmid: xmlFirstTagText(xml, "PMID"),
    pmcid: xmlIdByType(xml, "ArticleId", "IdType", "pmc"),
    pii: xmlIdByType(xml, "ArticleId", "IdType", "pii") || xmlIdByType(xml, "ELocationID", "EIdType", "pii")
  };
  return {
    title: xmlFirstTagText(xml, "ArticleTitle"),
    sourceName: xmlFirstTagText(xmlBlocks(xml, "Journal")[0] || "", "Title") || xmlFirstTagText(xml, "ISOAbbreviation"),
    publicationDate: xmlDateFromBlock(articleDate) || xmlDateFromBlock(pubDate),
    abstract,
    authors: xmlBlocks(xml, "Author").map((block) => cleanString(`${xmlFirstTagText(block, "ForeName")} ${xmlFirstTagText(block, "LastName")}`)).filter(Boolean),
    keywords,
    articleType: publicationTypes.join(", "),
    accessType: articleIds.pmcid ? "Open access" : abstract ? "Resumen disponible" : "Pendiente",
    ...articleIds
  };
};

const resolveViaPubMed = async (identifiers = {}, seed = {}, { fetchImpl = fetch, ncbiEmail = "" } = {}) => {
  const warnings = [];
  let pmid = identifiers.pmid;
  const queryTerms = [];
  if (!pmid && identifiers.pii) queryTerms.push(identifiers.pii);
  if (!pmid && identifiers.doi) queryTerms.push(`${identifiers.doi}[AID]`);
  if (!pmid && seed.title) queryTerms.push(`${seed.title}[Title]`);
  if (!pmid && queryTerms.length) {
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${buildNcbiQuery({
      db: "pubmed",
      retmode: "json",
      retmax: "3",
      term: queryTerms[0],
      email: ncbiEmail
    })}`;
    const search = await fetchJson(url, { fetchImpl });
    if (search.ok) {
      pmid = search.data?.esearchresult?.idlist?.[0] || "";
    } else {
      warnings.push("PubMed no respondió a la búsqueda bibliográfica.");
    }
  }
  if (!pmid) {
    return makeEvidenceSource({ source: "pubmed", status: "skipped", warnings: ["No hay PMID ni consulta suficiente para PubMed."] });
  }
  const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${buildNcbiQuery({
    db: "pubmed",
    retmode: "xml",
    id: pmid,
    email: ncbiEmail
  })}`;
  const fetched = await withTimeout(fetchUrl, { fetchImpl, maxBytes: MAX_HTML_BYTES });
  if (!fetched.ok || !fetched.text) {
    return makeEvidenceSource({
      source: "pubmed",
      status: "failed",
      warnings: [...warnings, "No se pudo obtener metadata desde PubMed."]
    });
  }
  const fields = parsePubMedXml(fetched.text);
  return makeEvidenceSource({
    source: "pubmed",
    status: sourceHasUsefulFields({ fields }) ? "success" : "failed",
    confidence: fields.abstract ? 0.88 : 0.7,
    fields,
    warnings
  });
};

const parsePmcXml = (xml = "") => {
  const articleMeta = xmlBlocks(xml, "article-meta")[0] || xml;
  const abstract = xmlTagTexts(xmlBlocks(articleMeta, "abstract")[0] || "", "p").join(" ") || xmlTagTexts(articleMeta, "abstract").join(" ");
  const articleType = (String(xml || "").match(/<article\b[^>]*article-type=["']([^"']+)["']/i) || [])[1] || xmlFirstTagText(articleMeta, "subject");
  const collectionDate = String(articleMeta).match(/<pub-date\b[^>]*pub-type=["']collection["'][^>]*>([\s\S]*?)<\/pub-date>/i)?.[1] || "";
  const epubDate = String(articleMeta).match(/<pub-date\b[^>]*pub-type=["']epub["'][^>]*>([\s\S]*?)<\/pub-date>/i)?.[1] || "";
  return {
    title: xmlFirstTagText(articleMeta, "article-title"),
    sourceName: xmlFirstTagText(xmlBlocks(xml, "journal-title-group")[0] || "", "journal-title"),
    publicationDate: xmlDateFromBlock(collectionDate) || xmlDateFromBlock(epubDate),
    abstract,
    authors: xmlBlocks(articleMeta, "contrib").map((block) => cleanString(`${xmlFirstTagText(block, "given-names")} ${xmlFirstTagText(block, "surname")}`)).filter(Boolean),
    doi: xmlIdByType(articleMeta, "article-id", "pub-id-type", "doi"),
    pmid: xmlIdByType(articleMeta, "article-id", "pub-id-type", "pmid"),
    pmcid: xmlIdByType(articleMeta, "article-id", "pub-id-type", "pmcid"),
    pii: xmlIdByType(articleMeta, "article-id", "pub-id-type", "pii"),
    keywords: xmlTagTexts(articleMeta, "kwd"),
    articleType,
    accessType: /open access|cc by|pmc-prop-open-access<\/meta-name>\s*<meta-value>yes/i.test(xml) ? "Open access" : "Resumen disponible"
  };
};

const resolveViaPmc = async (identifiers = {}, { fetchImpl = fetch, ncbiEmail = "" } = {}) => {
  if (!identifiers.pmcid) {
    return makeEvidenceSource({ source: "pmc", status: "skipped", warnings: ["No hay PMCID para consultar PMC."] });
  }
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${buildNcbiQuery({
    db: "pmc",
    retmode: "xml",
    id: identifiers.pmcid,
    email: ncbiEmail
  })}`;
  const fetched = await withTimeout(url, { fetchImpl, maxBytes: MAX_HTML_BYTES });
  if (!fetched.ok || !fetched.text) {
    return makeEvidenceSource({ source: "pmc", status: "failed", warnings: ["No se pudo obtener texto desde PMC."] });
  }
  const fields = parsePmcXml(fetched.text);
  return makeEvidenceSource({
    source: "pmc",
    status: sourceHasUsefulFields({ fields }) ? "success" : "failed",
    confidence: fields.abstract ? 0.9 : 0.72,
    fields
  });
};

const resolveViaCrossref = async (identifiers = {}, seed = {}, { fetchImpl = fetch } = {}) => {
  let url = "";
  const warnings = [];
  if (identifiers.doi) {
    url = `https://api.crossref.org/works/${encodeURIComponent(identifiers.doi)}`;
  } else if (seed.title) {
    url = `https://api.crossref.org/works?${new URLSearchParams({ rows: "3", "query.bibliographic": seed.title })}`;
  } else if (identifiers.pii) {
    url = `https://api.crossref.org/works?${new URLSearchParams({ rows: "5", "query.bibliographic": identifiers.pii })}`;
  } else {
    return makeEvidenceSource({ source: "crossref", status: "skipped", warnings: ["No hay DOI, título ni PII para Crossref."] });
  }
  const response = await fetchJson(url, { fetchImpl });
  if (!response.ok) {
    return makeEvidenceSource({ source: "crossref", status: "failed", warnings: ["Crossref no respondió correctamente."] });
  }
  const message = response.data?.message || {};
  const item = message.items ? message.items[0] : message;
  if (!item) return makeEvidenceSource({ source: "crossref", status: "failed", warnings: ["Crossref no encontró coincidencias."] });
  if (identifiers.pii && !identifiers.doi && !seed.title) {
    const piiIssn = extractPiiIssn(identifiers.pii);
    const itemIssns = normalizeList(item.ISSN || item.issn || [], 10).map((entry) => entry.toUpperCase());
    if (piiIssn && !itemIssns.includes(piiIssn)) {
      warnings.push("Crossref devolvió coincidencias no confiables para el PII y fueron descartadas.");
      return makeEvidenceSource({ source: "crossref", status: "failed", warnings });
    }
  }
  const fields = {
    title: item.title?.[0],
    sourceName: item["container-title"]?.[0] || item.publisher,
    publicationDate:
      dateFromParts(item["published-online"]?.["date-parts"]) ||
      dateFromParts(item.published?.["date-parts"]) ||
      dateFromParts(item.issued?.["date-parts"]),
    abstract: stripHtmlToText(item.abstract || ""),
    doi: item.DOI,
    authors: (item.author || []).map((author) => cleanString(`${author.given || ""} ${author.family || ""}`)).filter(Boolean),
    keywords: item.subject || [],
    articleType: item.type,
    accessType: item.license?.length ? "Open access" : "Pendiente",
    officialUrl: item.URL
  };
  return makeEvidenceSource({
    source: "crossref",
    status: sourceHasUsefulFields({ fields }) ? "success" : "failed",
    confidence: fields.abstract ? 0.78 : 0.56,
    fields,
    warnings
  });
};

const resolveViaOpenAlex = async (identifiers = {}, seed = {}, { fetchImpl = fetch } = {}) => {
  let url = "";
  if (identifiers.pmid) url = `https://api.openalex.org/works/pmid:${identifiers.pmid}`;
  else if (identifiers.pmcid) url = `https://api.openalex.org/works/pmcid:${identifiers.pmcid}`;
  else if (identifiers.doi) url = `https://api.openalex.org/works/doi:${encodeURIComponent(identifiers.doi)}`;
  else if (seed.title) url = `https://api.openalex.org/works?${new URLSearchParams({ search: seed.title, "per-page": "3" })}`;
  else return makeEvidenceSource({ source: "openalex", status: "skipped", warnings: ["No hay identificador o título para OpenAlex."] });

  const response = await fetchJson(url, { fetchImpl });
  if (!response.ok) {
    return makeEvidenceSource({ source: "openalex", status: "failed", warnings: ["OpenAlex no respondió correctamente."] });
  }
  const item = response.data?.results ? response.data.results[0] : response.data;
  if (!item?.title) return makeEvidenceSource({ source: "openalex", status: "failed", warnings: ["OpenAlex no encontró coincidencias."] });
  const fields = {
    title: item.title,
    sourceName: item.primary_location?.source?.display_name || item.host_venue?.display_name,
    publicationDate: item.publication_date || (item.publication_year ? String(item.publication_year) : ""),
    abstract: reconstructOpenAlexAbstract(item.abstract_inverted_index),
    doi: cleanDoi(item.ids?.doi || item.doi),
    pmid: cleanString(item.ids?.pmid).match(/(\d{5,10})/)?.[1] || "",
    pmcid: cleanString(item.ids?.pmcid).toUpperCase().match(/PMC\d+/)?.[0] || "",
    keywords: (item.concepts || []).map((concept) => concept.display_name).filter(Boolean),
    articleType: item.type,
    accessType: item.open_access?.is_oa ? "Open access" : "Pendiente",
    officialUrl: item.primary_location?.landing_page_url || item.doi
  };
  return makeEvidenceSource({
    source: "openalex",
    status: sourceHasUsefulFields({ fields }) ? "success" : "failed",
    confidence: fields.abstract ? 0.76 : 0.58,
    fields
  });
};

const resolveViaUnpaywall = async (identifiers = {}, { fetchImpl = fetch, unpaywallEmail = "" } = {}) => {
  if (!identifiers.doi) {
    return makeEvidenceSource({ source: "unpaywall", status: "skipped", warnings: ["No hay DOI para Unpaywall."] });
  }
  if (!cleanString(unpaywallEmail)) {
    return makeEvidenceSource({ source: "unpaywall", status: "skipped", warnings: ["UNPAYWALL_EMAIL no configurado; se omitió Unpaywall."] });
  }
  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(identifiers.doi)}?${new URLSearchParams({ email: unpaywallEmail })}`;
  const response = await fetchJson(url, { fetchImpl });
  if (!response.ok) return makeEvidenceSource({ source: "unpaywall", status: "failed", warnings: ["Unpaywall no respondió correctamente."] });
  const data = response.data || {};
  const fields = {
    title: data.title,
    sourceName: data.journal_name,
    publicationDate: data.published_date,
    doi: data.doi,
    articleType: data.genre,
    accessType: data.is_oa ? "Open access" : "Suscripción",
    officialUrl: data.best_oa_location?.url_for_landing_page || data.best_oa_location?.url || data.doi_url
  };
  return makeEvidenceSource({
    source: "unpaywall",
    status: sourceHasUsefulFields({ fields }) ? "success" : "failed",
    confidence: 0.62,
    fields
  });
};

const resolveViaClinicalTrialsGov = async (identifiers = {}, { fetchImpl = fetch } = {}) => {
  if (!identifiers.nctId) {
    return makeEvidenceSource({ source: "clinicaltrials", status: "skipped", warnings: ["No hay NCT ID para ClinicalTrials.gov."] });
  }
  const response = await fetchJson(`https://clinicaltrials.gov/api/v2/studies/${identifiers.nctId}`, { fetchImpl });
  if (!response.ok) {
    return makeEvidenceSource({ source: "clinicaltrials", status: "failed", warnings: ["ClinicalTrials.gov no respondió correctamente."] });
  }
  const protocol = response.data?.protocolSection || {};
  const identification = protocol.identificationModule || {};
  const description = protocol.descriptionModule || {};
  const design = protocol.designModule || {};
  const conditions = protocol.conditionsModule || {};
  const contacts = protocol.contactsLocationsModule || {};
  const status = protocol.statusModule || {};
  const locations = (contacts.locations || [])
    .map((location) => cleanString([location.facility, location.city, location.country].filter(Boolean).join(", ")))
    .filter(Boolean)
    .slice(0, 6);
  const fields = {
    title: identification.officialTitle || identification.briefTitle,
    sourceName: "ClinicalTrials.gov",
    publicationDate: status.startDateStruct?.date || status.studyFirstSubmitDate,
    abstract: description.briefSummary || description.detailedDescription,
    nctId: identifiers.nctId,
    keywords: conditions.conditions || [],
    articleType: design.studyType,
    studyLocation: locations.join("; "),
    accessType: "Resumen disponible"
  };
  return makeEvidenceSource({
    source: "clinicaltrials",
    status: sourceHasUsefulFields({ fields }) ? "success" : "failed",
    confidence: 0.82,
    fields
  });
};

const findDeepString = (value, keys = []) => {
  const queue = [value];
  const lowered = keys.map((key) => key.toLowerCase());
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== "object") continue;
    for (const [key, nested] of Object.entries(item)) {
      if (lowered.includes(key.toLowerCase()) && typeof nested === "string" && nested.trim()) return cleanString(nested);
      if (nested && typeof nested === "object") queue.push(nested);
    }
  }
  return "";
};

const resolveViaElsevier = async (identifiers = {}, { fetchImpl = fetch, elsevierApiKey = "" } = {}) => {
  if (!identifiers.pii && !identifiers.doi) {
    return makeEvidenceSource({ source: "elsevier", status: "skipped", warnings: ["No hay PII o DOI para Elsevier."] });
  }
  if (!cleanString(elsevierApiKey)) {
    return makeEvidenceSource({ source: "elsevier", status: "skipped", warnings: ["ELSEVIER_API_KEY no configurada; se omitió resolutor Elsevier."] });
  }
  const endpoint = identifiers.pii
    ? `https://api.elsevier.com/content/article/pii/${compactPii(identifiers.pii)}`
    : `https://api.elsevier.com/content/article/doi/${encodeURIComponent(identifiers.doi)}`;
  const response = await fetchJson(endpoint, {
    fetchImpl,
    headers: {
      Accept: "application/json",
      "X-ELS-APIKey": elsevierApiKey
    }
  });
  if (!response.ok) {
    return makeEvidenceSource({ source: "elsevier", status: "failed", warnings: ["Elsevier no respondió con metadata utilizable."] });
  }
  const data = response.data || {};
  const fields = {
    title: findDeepString(data, ["dc:title", "title", "titleText"]),
    sourceName: findDeepString(data, ["prism:publicationName", "publicationName", "journalTitle"]),
    publicationDate: findDeepString(data, ["prism:coverDate", "coverDate", "publicationDate"]),
    abstract: stripHtmlToText(findDeepString(data, ["dc:description", "description", "abstract"])),
    doi: findDeepString(data, ["prism:doi", "doi"]),
    pii: identifiers.pii || findDeepString(data, ["pii"]),
    accessType: /open/i.test(findDeepString(data, ["openaccess", "openAccess"])) ? "Open access" : "Pendiente",
    officialUrl: findDeepString(data, ["prism:url", "url"])
  };
  return makeEvidenceSource({
    source: "elsevier",
    status: sourceHasUsefulFields({ fields }) ? "success" : "failed",
    confidence: fields.abstract ? 0.84 : 0.66,
    fields
  });
};

const pickFromSources = (sources = [], field = "", priority = []) => {
  const ordered = priority
    .map((name) => sources.find((source) => source.source === name && source.fields?.[field]))
    .filter(Boolean);
  const fallback = sources.find((source) => source.fields?.[field]);
  const source = ordered[0] || fallback;
  return source?.fields?.[field] || "";
};

const mergeEvidencePackets = ({ inputUrl, articleUrl, identifiers = {}, sources = [] }) => {
  const successfulSources = sources.filter((source) => source.status === "success");
  const sourceList = successfulSources.length ? successfulSources : sources.filter((source) => source.status === "blocked");
  const mergedIdentifiers = mergeIdentifierValues(identifiers, ...sources.map((source) => source.fields || {}));
  const visibleSections = dedupeSections(sources.flatMap((source) => source.fields?.visibleSections || []));
  const merged = {
    title: pickFromSources(sourceList, "title", ["publisher_html", "pmc", "pubmed", "crossref", "openalex", "elsevier", "manual_evidence", "clinicaltrials"]),
    sourceName: pickFromSources(sourceList, "sourceName", ["publisher_html", "pmc", "openalex", "crossref", "pubmed", "elsevier", "clinicaltrials", "manual_evidence"]),
    publicationDate: pickFromSources(sourceList, "publicationDate", ["publisher_html", "pubmed", "pmc", "crossref", "openalex", "elsevier", "clinicaltrials"]),
    abstract: pickFromSources(sourceList, "abstract", ["pubmed", "pmc", "publisher_html", "manual_evidence", "crossref", "openalex", "elsevier", "clinicaltrials"]),
    summary: pickFromSources(sourceList, "summary", ["publisher_html", "pmc", "pubmed", "manual_evidence"]),
    authors: sourceList.flatMap((source) => source.fields?.authors || []).slice(0, 40),
    keywords: mergeKeywords(...sourceList.map((source) => source.fields?.keywords || [])),
    articleType: pickFromSources(sourceList, "articleType", ["pubmed", "pmc", "publisher_html", "crossref", "openalex", "clinicaltrials"]),
    accessType: normalizeAccessType(pickFromSources(sourceList, "accessType", ["unpaywall", "pmc", "openalex", "publisher_html", "pubmed", "crossref"])),
    studyLocation: pickFromSources(sourceList, "studyLocation", ["clinicaltrials", "pmc", "pubmed", "manual_evidence"]),
    visibleSections,
    ...mergedIdentifiers
  };
  const scientificTextLength =
    cleanString(merged.abstract).length +
    cleanString(merged.summary).length +
    visibleSections.reduce((total, section) => total + cleanString(section.text).length, 0);
  const metadataFieldsDetected = [];
  sources.forEach((source) => {
    Object.entries(source.fields || {}).forEach(([key, value]) => {
      if (Array.isArray(value) ? value.length : Boolean(cleanString(value))) {
        metadataFieldsDetected.push(`${source.source}.${key}`);
      }
    });
  });
  const audit = {
    attemptedResolvers: sources.filter((source) => source.status !== "skipped").map((source) => source.source),
    successfulResolvers: sources.filter((source) => source.status === "success").map((source) => source.source),
    blockedResolvers: sources.filter((source) => source.status === "blocked").map((source) => source.source),
    failedResolvers: sources.filter((source) => source.status === "failed").map((source) => source.source),
    metadataFieldsDetected: Array.from(new Set(metadataFieldsDetected)).slice(0, 80),
    scientificTextLength,
    confidence: Math.max(...sources.map((source) => source.confidence || 0), 0)
  };
  const packet = {
    inputUrl,
    officialUrl: articleUrl.href,
    sourceDomain: articleUrl.hostname,
    identifiers: mergedIdentifiers,
    sources,
    merged,
    visibleTextSections: visibleSections.length
      ? visibleSections
      : [merged.abstract || merged.summary].filter(Boolean).map((text) => ({ heading: "Abstract", text })),
    pageSignals: {
      hasAbstract: Boolean(merged.abstract || merged.summary),
      hasFullText: visibleSections.length > 1,
      hasScientificContent: scientificTextLength >= 80,
      hasAccessLimit: sources.some((source) => source.status === "blocked"),
      contentLength: scientificTextLength,
      metadataFieldsDetected: audit.metadataFieldsDetected
    },
    warnings: Array.from(new Set(sources.flatMap((source) => source.warnings || []))).slice(0, 8),
    audit,
    rawEvidence: {
      attemptedResolvers: audit.attemptedResolvers,
      successfulResolvers: audit.successfulResolvers,
      failedResolvers: audit.failedResolvers,
      blockedResolvers: audit.blockedResolvers,
      metadataFieldsDetected: audit.metadataFieldsDetected,
      scientificTextLength,
      contentLength: scientificTextLength,
      identifiersDetected: mergedIdentifiers,
      usedSources: audit.successfulResolvers.length ? audit.successfulResolvers : audit.attemptedResolvers
    }
  };
  packet.methodologyEvidence = buildMethodologyEvidence(packet);
  packet.preclassification = preclassifyMethodology(packet, SCIENTIFIC_METHODOLOGY_TAXONOMY);
  packet.rawEvidence.methodologyEvidenceSections = Object.entries(packet.methodologyEvidence || {})
    .filter(([, section]) => cleanString(section?.text))
    .map(([key]) => key)
    .slice(0, 20);
  packet.rawEvidence.preclassification = packet.preclassification;
  return packet;
};

const hasScientificTextForAI = (packet = {}) =>
  Boolean(cleanString(packet.merged?.abstract || packet.merged?.summary).length >= 80 || packet.visibleTextSections?.some((section) => cleanString(section.text).length >= 80));

const computeExtractionStatus = (article = {}, evidencePacket = {}) => {
  const quality = scoreExtractionCompleteness(article);
  if (quality.isUseful) return "ai_draft";
  const hasMetadata = hasMetadataContent(article) || Object.values(evidencePacket.identifiers || {}).some(Boolean);
  return hasMetadata ? "metadata_only" : "failed";
};

const resolveScientificArticle = async (input = {}, {
  apiKey = "",
  fetchImpl = fetch,
  unpaywallEmail = process.env.UNPAYWALL_EMAIL || "",
  elsevierApiKey = process.env.ELSEVIER_API_KEY || "",
  ncbiEmail = process.env.UNPAYWALL_EMAIL || ""
} = {}) => {
  const validation = validateScientificUrl(input.url);
  if (!validation.ok) {
    return {
      ok: false,
      statusCode: 400,
      error: { code: validation.code, message: validation.message }
    };
  }
  const articleUrl = validation.url;
  const manualSource = sourceFromManualEvidence(input, articleUrl);
  let fetched = {
    html: "",
    finalUrl: articleUrl.href,
    statusCode: 0,
    contentType: "",
    warnings: ["No se pudo leer la página pública del artículo."],
    usedSources: []
  };
  try {
    fetched = await fetchScientificPage(articleUrl, { fetchImpl });
  } catch (error) {}

  const htmlSignals = extractHtmlSignals(fetched.html || "", articleUrl, fetched);
  const publisherSource = sourceFromPublisherHtml(htmlSignals, articleUrl, fetched);
  let identifiers = mergeIdentifierValues(
    detectScientificIdentifiers(articleUrl, fetched.html || "", input),
    htmlSignals.detectedMetadata || {},
    manualSource.fields || {}
  );
  const sources = [publisherSource, manualSource].filter((source) => source.status !== "skipped" || source.warnings.length);
  const seed = {
    title: htmlSignals.detectedMetadata?.title || manualSource.fields?.title || "",
    sourceName: htmlSignals.detectedMetadata?.sourceName || manualSource.fields?.sourceName || ""
  };

  const pubmed = await resolveViaPubMed(identifiers, seed, { fetchImpl, ncbiEmail });
  sources.push(pubmed);
  identifiers = mergeIdentifierValues(identifiers, pubmed.fields || {});

  const pmc = await resolveViaPmc(identifiers, { fetchImpl, ncbiEmail });
  sources.push(pmc);
  identifiers = mergeIdentifierValues(identifiers, pmc.fields || {});

  const clinicalTrials = await resolveViaClinicalTrialsGov(identifiers, { fetchImpl });
  sources.push(clinicalTrials);
  identifiers = mergeIdentifierValues(identifiers, clinicalTrials.fields || {});

  const crossrefSeed = {
    title: seed.title || pubmed.fields?.title || pmc.fields?.title || manualSource.fields?.title || "",
    sourceName: seed.sourceName || pubmed.fields?.sourceName || pmc.fields?.sourceName || ""
  };
  const crossref = await resolveViaCrossref(identifiers, crossrefSeed, { fetchImpl });
  sources.push(crossref);
  identifiers = mergeIdentifierValues(identifiers, crossref.fields || {});

  const openalexSeed = {
    title: crossrefSeed.title || crossref.fields?.title || "",
    sourceName: crossrefSeed.sourceName || crossref.fields?.sourceName || ""
  };
  const openalex = await resolveViaOpenAlex(identifiers, openalexSeed, { fetchImpl });
  sources.push(openalex);
  identifiers = mergeIdentifierValues(identifiers, openalex.fields || {});

  const unpaywall = await resolveViaUnpaywall(identifiers, { fetchImpl, unpaywallEmail });
  sources.push(unpaywall);

  const elsevier = await resolveViaElsevier(identifiers, { fetchImpl, elsevierApiKey });
  sources.push(elsevier);
  identifiers = mergeIdentifierValues(identifiers, elsevier.fields || {});

  const evidencePacket = mergeEvidencePackets({
    inputUrl: articleUrl.href,
    articleUrl,
    identifiers,
    sources
  });
  const fallbackArticle = buildMetadataOnlyArticle(articleUrl, evidencePacket.merged, evidencePacket);
  fallbackArticle.warnings = Array.from(new Set([...(fallbackArticle.warnings || []), ...(evidencePacket.warnings || [])])).slice(0, 8);

  if (!apiKey) {
    fallbackArticle.warnings.push("El servicio de IA no está configurado en backend.");
    return buildExtractionResponse({
      extractionStatus: "not_configured",
      article: fallbackArticle,
      rawEvidence: buildRawEvidence(evidencePacket),
      error: { code: "missing_openai_api_key", message: "El servicio de IA no está configurado en backend." }
    });
  }

  if (!hasScientificTextForAI(evidencePacket)) {
    const status = computeExtractionStatus(fallbackArticle, evidencePacket);
    fallbackArticle.warnings.push(
      status === "failed"
        ? "No se encontró evidencia científica suficiente en fuentes públicas ni resolutores bibliográficos."
        : "Se detectaron metadatos básicos, pero no contenido científico suficiente para síntesis automática."
    );
    return buildExtractionResponse({
      extractionStatus: status,
      article: fallbackArticle,
      rawEvidence: buildRawEvidence(evidencePacket),
      error: status === "failed"
        ? { code: "insufficient_evidence", message: "No se pudo extraer información suficiente desde esta URL." }
        : undefined
    });
  }

  const aiResult = await callArticleExtractionAI(evidencePacket, { apiKey, fetchImpl });
  if (!aiResult.ok) {
    fallbackArticle.warnings.push("No se pudo estructurar con IA; se conservaron los metadatos detectados.");
    const status = computeExtractionStatus(fallbackArticle, evidencePacket);
    return buildExtractionResponse({
      extractionStatus: status,
      article: fallbackArticle,
      rawEvidence: buildRawEvidence(evidencePacket),
      error: aiResult.error || { code: "ai_failed", message: "La IA no pudo completar la extracción." }
    });
  }

  const article = normalizeAiArticleOutput(articleUrl, evidencePacket, aiResult.article);
  article.warnings = Array.from(new Set([...(evidencePacket.warnings || []), ...(article.warnings || [])])).slice(0, 8);
  let status = computeExtractionStatus(article, evidencePacket);
  if (
    status === "ai_draft" &&
    article.expandedDescriptionQuality === "insufficient" &&
    hasSubstantialPublicEvidence(evidencePacket)
  ) {
    status = "metadata_only";
    article.warnings.push("La evidencia pública no permitió generar una descripción ampliada suficiente.");
  }
  if (status !== "ai_draft") {
    article.warnings.push("La IA no detectó suficientes campos útiles para generar un borrador final.");
  }
  return buildExtractionResponse({
    extractionStatus: status,
    article,
    rawEvidence: buildRawEvidence(evidencePacket),
    error: status === "failed" ? { code: "insufficient_ai_fields", message: "La IA no detectó suficientes datos útiles." } : undefined
  });
};

module.exports = {
  ACCESS_TYPES,
  AI_ARTICLE_FIELD_KEYS,
  ARTICLE_FIELD_KEYS: FINAL_ARTICLE_FIELD_KEYS,
  FINAL_ARTICLE_FIELD_KEYS,
  buildEvidencePacket,
  buildExtractionResponse,
  buildMetadataOnlyArticle,
  buildOpenAiArticleExtractionPayload,
  buildRawEvidence,
  callArticleExtractionAI,
  cleanString,
  decodeHtmlEntities,
  detectAccessSignals,
  detectScientificIdentifiers,
  extractCitationMetadata,
  extractHtmlSignals,
  extractJsonLd,
  extractMetadataMap,
  extractOpenGraphMetadata,
  extractPublicArticleText,
  extractScientificMetadata,
  extractStructuredMetadata,
  extractVisibleScientificText,
  fetchScientificPage,
  finalizeExpandedDescriptionFields,
  mergeEvidencePackets,
  computeExtractionStatus,
  getAiDraftQuality,
  hasMetadataContent,
  isBlockedArticleHost,
  isPrivateIPv4,
  logInternalAudit,
  normalizeAiArticleOutput,
  normalizeExpandedDescriptionSections,
  normalizeAiInputAliases,
  normalizePii,
  normalizeScientificUrl,
  parseArticleUrl,
  parsePmcXml,
  parsePubMedXml,
  parseJsonObjectFromText,
  resolveScientificArticle,
  resolveViaClinicalTrialsGov,
  resolveViaCrossref,
  resolveViaElsevier,
  resolveViaOpenAlex,
  resolveViaPmc,
  resolveViaPubMed,
  resolveViaUnpaywall,
  assessExpandedDescriptionQuality,
  scoreExtractionCompleteness,
  stripHtmlToText,
  validateAIArticleSchema,
  validateScientificUrl
};
