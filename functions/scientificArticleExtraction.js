const FINAL_ARTICLE_FIELD_KEYS = [
  "title",
  "sourceName",
  "officialUrl",
  "sourceDomain",
  "studyType",
  "evidenceType",
  "publicationDate",
  "studyLocation",
  "executiveSummary",
  "clinicalQuestion",
  "mainResult",
  "tags",
  "accessType",
  "extractionConfidence",
  "warnings"
];

const AI_ARTICLE_FIELD_KEYS = [
  "title",
  "sourceName",
  "studyType",
  "evidenceType",
  "publicationDate",
  "studyLocation",
  "executiveSummary",
  "clinicalQuestion",
  "mainResult",
  "tags",
  "accessType",
  "warnings",
  "extractionConfidence"
];

const ACCESS_TYPES = ["Open access", "Suscripción", "Resumen disponible", "Pendiente"];
const MAX_URL_LENGTH = 2048;
const MAX_HTML_BYTES = 450000;
const MAX_VISIBLE_TEXT_CHARS = 14000;
const MAX_SECTION_CHARS = 4500;

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

  return {
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
  studyType: "",
  evidenceType: "",
  publicationDate: cleanString(metadata.publicationDate),
  studyLocation: "",
  executiveSummary: cleanString(metadata.description),
  clinicalQuestion: "",
  mainResult: "",
  tags: normalizeList(metadata.keywords || [], 12),
  accessType: evidencePacket?.pageSignals?.hasAccessLimit
    ? "Suscripción"
    : metadata.description
      ? "Resumen disponible"
      : "Pendiente",
  extractionConfidence: metadata.title || metadata.description || metadata.publicationDate ? 0.3 : 0.1,
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
  studyType: readStringAlias(input, ["studyType", "typeOfStudy", "study_design", "studyDesign", "tipoEstudio", "tipo_de_estudio", "design"]),
  evidenceType: readStringAlias(input, ["evidenceType", "typeOfEvidence", "evidence_level", "evidenceLevel", "tipoEvidencia", "tipo_de_evidencia"]),
  publicationDate: readStringAlias(input, ["publicationDate", "publishedAt", "publication_date", "datePublished", "fechaPublicacion", "fecha_de_publicacion"]),
  studyLocation: readStringAlias(input, ["studyLocation", "location", "studyCountry", "setting", "lugar", "contexto"]),
  executiveSummary: readStringAlias(input, ["executiveSummary", "summary", "abstract", "resumen", "resumenEjecutivo", "resumen_ejecutivo"]),
  clinicalQuestion: readStringAlias(input, ["clinicalQuestion", "question", "researchQuestion", "preguntaClinica", "pregunta_clinica", "pregunta"]),
  mainResult: readStringAlias(input, ["mainResult", "result", "results", "findings", "conclusion", "resultadoPrincipal", "resultado_principal", "mainFinding"]),
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
  const metadata = evidenceOrMetadata.detectedMetadata || evidenceOrMetadata || {};
  const fallback = buildMetadataOnlyArticle(url, metadata, evidenceOrMetadata);
  const normalized = normalizeAiInputAliases(input);
  const article = {
    ...fallback,
    title: normalized.title || fallback.title,
    sourceName: normalized.sourceName || fallback.sourceName,
    officialUrl: url.href,
    sourceDomain: url.hostname,
    studyType: normalized.studyType,
    evidenceType: normalized.evidenceType,
    publicationDate: normalized.publicationDate || fallback.publicationDate,
    studyLocation: normalized.studyLocation,
    executiveSummary: normalized.executiveSummary || fallback.executiveSummary,
    clinicalQuestion: normalized.clinicalQuestion,
    mainResult: normalized.mainResult,
    tags: normalized.tags.length ? normalized.tags : fallback.tags,
    accessType: normalizeAccessType(normalized.accessType || fallback.accessType),
    extractionConfidence: normalized.extractionConfidence ?? 0.45,
    warnings: normalized.warnings.length ? normalized.warnings : fallback.warnings
  };
  if (!article.warnings.length) {
    article.warnings.push("El resumen automático debe ser revisado por el equipo médico.");
  }
  return article;
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
  const stringFields = AI_ARTICLE_FIELD_KEYS.filter((key) => !["tags", "warnings", "extractionConfidence"].includes(key));
  const badString = stringFields.find((key) => typeof input[key] !== "string");
  if (badString) return { ok: false, code: "invalid_field_type", message: `${badString} debe ser string.` };
  if (!Array.isArray(input.tags) || !input.tags.every((item) => typeof item === "string")) {
    return { ok: false, code: "invalid_tags", message: "tags debe ser array de strings." };
  }
  if (!Array.isArray(input.warnings) || !input.warnings.every((item) => typeof item === "string")) {
    return { ok: false, code: "invalid_warnings", message: "warnings debe ser array de strings." };
  }
  if (!Number.isFinite(Number(input.extractionConfidence))) {
    return { ok: false, code: "invalid_confidence", message: "extractionConfidence debe ser numérico." };
  }
  if (!ACCESS_TYPES.includes(input.accessType)) {
    return { ok: false, code: "invalid_access_type", message: "accessType no pertenece al enum permitido." };
  }
  return { ok: true };
};

const scoreExtractionCompleteness = (article = {}) => {
  const usefulFields = [
    cleanString(article.executiveSummary).length >= 24,
    cleanString(article.clinicalQuestion).length >= 24,
    cleanString(article.mainResult).length >= 24,
    Boolean(cleanString(article.studyType)),
    Boolean(cleanString(article.evidenceType)),
    Boolean(cleanString(article.publicationDate))
  ].filter(Boolean).length;
  const hasIdentity = Boolean(cleanString(article.title) || cleanString(article.sourceName));
  const completedFields = FINAL_ARTICLE_FIELD_KEYS.filter((key) => {
    const value = article[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(cleanString(value));
  });
  return {
    isUseful: hasIdentity && usefulFields >= 2,
    usefulFieldCount: usefulFields,
    completedFields,
    completedFieldCount: completedFields.length,
    confidence: Math.max(0, Math.min(1, Number(article.extractionConfidence || 0)))
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
      title: { type: "string" },
      sourceName: { type: "string" },
      studyType: { type: "string" },
      evidenceType: { type: "string" },
      publicationDate: { type: "string" },
      studyLocation: { type: "string" },
      executiveSummary: { type: "string" },
      clinicalQuestion: { type: "string" },
      mainResult: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      accessType: { type: "string", enum: ACCESS_TYPES },
      warnings: { type: "array", items: { type: "string" } },
      extractionConfidence: { type: "number", minimum: 0, maximum: 1 }
    }
  };

  const input = {
    officialUrl: evidencePacket.officialUrl,
    sourceDomain: evidencePacket.sourceDomain,
    detectedMetadata: evidencePacket.detectedMetadata,
    visibleTextSections: (evidencePacket.visibleTextSections || [])
      .map((section) => ({
        heading: section.heading,
        text: cleanString(section.text).slice(0, MAX_SECTION_CHARS)
      }))
      .slice(0, 10),
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
          "Sos un asistente técnico para extracción de publicaciones científicas médicas.",
          "Tu tarea es convertir evidencia extraída de una página web científica en un objeto JSON estructurado para una bitácora médica institucional.",
          "Respondé exclusivamente con JSON válido ajustado al schema.",
          "Todo el texto libre debe estar en español.",
          "Conservá títulos oficiales, nombres de revistas, autores, DOI y nombres propios tal como aparecen.",
          "No inventes datos. No uses conocimiento externo ni memoria del modelo.",
          "No completes campos si no están sostenidos por la evidencia enviada.",
          "Si un dato no está disponible, devolvé string vacío.",
          "Si el tipo de estudio no puede determinarse, devolvé string vacío y agregá warning.",
          "Si solo hay metadatos mínimos, no simules resumen.",
          "El resumen ejecutivo debe basarse únicamente en abstract, summary o texto científico visible.",
          "La pregunta clínica debe derivarse del objetivo o pregunta del artículo si está disponible.",
          "El resultado principal debe derivarse de findings, results o conclusions si están disponibles.",
          "Las etiquetas deben ser breves, en español, y derivadas de título, abstract o keywords.",
          "No emitas recomendaciones clínicas ni sugieras conducta médica."
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
  getAiDraftQuality,
  hasMetadataContent,
  isBlockedArticleHost,
  isPrivateIPv4,
  logInternalAudit,
  normalizeAiArticleOutput,
  normalizeAiInputAliases,
  normalizeScientificUrl,
  parseArticleUrl,
  parseJsonObjectFromText,
  scoreExtractionCompleteness,
  stripHtmlToText,
  validateAIArticleSchema,
  validateScientificUrl
};
