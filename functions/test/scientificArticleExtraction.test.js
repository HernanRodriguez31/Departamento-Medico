const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AI_ARTICLE_FIELD_KEYS,
  buildEvidencePacket,
  buildMetadataOnlyArticle,
  buildOpenAiArticleExtractionPayload,
  buildRawEvidence,
  callArticleExtractionAI,
  extractCitationMetadata,
  extractHtmlSignals,
  extractOpenGraphMetadata,
  extractScientificMetadata,
  extractStructuredMetadata,
  fetchScientificPage,
  getAiDraftQuality,
  hasMetadataContent,
  normalizeAiArticleOutput,
  parseJsonObjectFromText,
  scoreExtractionCompleteness,
  validateAIArticleSchema,
  validateScientificUrl
} = require("../scientificArticleExtraction");

const articleUrl = new URL("https://www.thelancet.com/journals/lanam/article/PIIS2667-193X(25)00322-9/fulltext");

const completeAiArticle = {
  title: "Official clinical title",
  sourceName: "The Lancet Regional Health - Americas",
  studyType: "Estudio observacional",
  evidenceType: "Investigación clínica",
  publicationDate: "2026-05-03",
  studyLocation: "América Latina",
  executiveSummary: "Resumen ejecutivo en español basado en el abstract público disponible.",
  clinicalQuestion: "Pregunta clínica en español derivada del objetivo del artículo.",
  mainResult: "Resultado principal en español derivado de los hallazgos del artículo.",
  tags: ["salud pública", "epidemiología"],
  accessType: "Open access",
  warnings: [],
  extractionConfidence: 0.88
};

const htmlFixture = `
  <html>
    <head>
      <title>Official Article Title | Journal</title>
      <meta name="citation_title" content="Official Article Title">
      <meta name="citation_journal_title" content="The Lancet Regional Health - Americas">
      <meta name="citation_publication_date" content="2026-05-03">
      <meta name="citation_doi" content="10.1016/example">
      <meta name="citation_author" content="Ana Perez">
      <meta name="citation_author" content="Luis Gomez">
      <meta name="citation_abstract" content="Objective: assess outcomes. Results: relevant clinical signal.">
      <meta name="citation_keywords" content="public health; epidemiology">
      <meta property="og:title" content="OG title fallback">
      <meta property="og:site_name" content="Lancet site">
      <meta property="og:description" content="OG description fallback">
      <meta name="twitter:description" content="Twitter description fallback">
      <script>window.bad = true;</script>
      <script type="application/ld+json">
        {
          "@type": "ScholarlyArticle",
          "headline": "JSON-LD scholarly title",
          "datePublished": "2026-05-02",
          "publisher": { "name": "JSON-LD Journal" },
          "author": [{ "name": "Author A" }],
          "abstract": "JSON-LD abstract text"
        }
      </script>
    </head>
    <body>
      <nav>Navigation should not be extracted</nav>
      <h1>Visible H1 title</h1>
      <section class="abstract">Abstract text with public findings and objective for extraction.</section>
      <h2>Methods</h2><p>Methods text with study design and population.</p>
      <h2>Results</h2><p>Results text with main findings and measurements.</p>
      <footer>Footer should not be extracted</footer>
    </body>
  </html>
`;

test("validateScientificUrl accepts public HTTP(S) and rejects unsafe URLs", () => {
  assert.equal(validateScientificUrl("https://pubmed.ncbi.nlm.nih.gov/123").ok, true);
  assert.equal(validateScientificUrl("http://example.org/article").ok, true);

  for (const value of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///tmp/paper.html",
    "ftp://example.org/paper",
    "http://localhost/paper",
    "http://127.0.0.1/paper",
    "http://10.0.0.4/paper",
    "http://192.168.1.10/paper",
    "http://172.20.0.2/paper",
    "http://site.internal/paper"
  ]) {
    assert.equal(validateScientificUrl(value).ok, false, value);
  }
});

test("OpenAI extraction payload uses strict structured output and Spanish anti-hallucination rules", () => {
  const signals = extractHtmlSignals(htmlFixture, articleUrl, { statusCode: 200, warnings: [] });
  const evidencePacket = buildEvidencePacket(signals, articleUrl, { statusCode: 200, contentType: "text/html" });
  const payload = buildOpenAiArticleExtractionPayload(evidencePacket);

  assert.equal(payload.response_format.type, "json_schema");
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.deepEqual(payload.response_format.json_schema.schema.required, AI_ARTICLE_FIELD_KEYS);
  assert.ok(payload.messages[0].content.includes("Todo el texto libre debe estar en español"));
  assert.ok(payload.messages[0].content.includes("No inventes datos"));
  assert.ok(payload.messages[0].content.includes("No uses conocimiento externo"));
});

test("extracts citation metadata, Open Graph/Twitter and JSON-LD fields", () => {
  const citation = extractCitationMetadata(htmlFixture);
  assert.equal(citation.fields.title, "Official Article Title");
  assert.equal(citation.fields.sourceName, "The Lancet Regional Health - Americas");
  assert.equal(citation.fields.publicationDate, "2026-05-03");
  assert.equal(citation.fields.doi, "10.1016/example");
  assert.deepEqual(citation.fields.authors, ["Ana Perez", "Luis Gomez"]);

  const openGraph = extractOpenGraphMetadata(htmlFixture);
  assert.equal(openGraph.fields.title, "OG title fallback");
  assert.equal(openGraph.fields.sourceName, "Lancet site");
  assert.equal(openGraph.fields.description, "OG description fallback");

  const structured = extractStructuredMetadata(htmlFixture);
  assert.equal(structured.fields.title, "JSON-LD scholarly title");
  assert.equal(structured.fields.sourceName, "JSON-LD Journal");
  assert.equal(structured.fields.publicationDate, "2026-05-02");
});

test("builds evidence packet from scientific sections without scripts, nav or footer", () => {
  const signals = extractHtmlSignals(htmlFixture, articleUrl, { statusCode: 200, warnings: [] });
  const packet = buildEvidencePacket(signals, articleUrl, { statusCode: 200, contentType: "text/html" });
  const raw = buildRawEvidence(packet);
  const visibleText = packet.visibleTextSections.map((section) => section.text).join(" ");

  assert.equal(packet.officialUrl, articleUrl.href);
  assert.equal(packet.sourceDomain, articleUrl.hostname);
  assert.equal(packet.detectedMetadata.title, "Official Article Title");
  assert.equal(packet.detectedMetadata.sourceName, "The Lancet Regional Health - Americas");
  assert.equal(packet.pageSignals.hasScientificContent, true);
  assert.ok(raw.metadataFieldsDetected.includes("citation.title"));
  assert.ok(raw.usedSources.includes("citation_meta"));
  assert.match(visibleText, /Methods text/);
  assert.doesNotMatch(visibleText, /Navigation should not be extracted/);
  assert.doesNotMatch(visibleText, /Footer should not be extracted/);
  assert.doesNotMatch(visibleText, /window.bad/);
});

test("detects CAPTCHA and avoids using blocked page title as a useful draft", () => {
  const blockedHtml = `
    <html>
      <head><title>Heath Advance</title></head>
      <body><h1>Heath Advance</h1><p>Complete this captcha to verify you are human.</p></body>
    </html>
  `;
  const signals = extractHtmlSignals(blockedHtml, articleUrl, {
    statusCode: 403,
    warnings: ["La fuente respondió HTTP 403."]
  });
  const packet = buildEvidencePacket(signals, articleUrl, { statusCode: 403, contentType: "text/html" });
  const article = buildMetadataOnlyArticle(articleUrl, packet.detectedMetadata, packet);

  assert.equal(signals.pageSignals.hasAccessLimit, true);
  assert.equal(signals.pageSignals.hasScientificContent, false);
  assert.equal(packet.detectedMetadata.title, "");
  assert.equal(hasMetadataContent(article), false);
  assert.match(article.warnings.join(" "), /limita el acceso|No se pudo detectar título/);
});

test("normalizeAiArticleOutput accepts aliases but preserves canonical URL and domain", () => {
  const article = normalizeAiArticleOutput(
    articleUrl,
    buildEvidencePacket(extractHtmlSignals(htmlFixture, articleUrl), articleUrl),
    {
      titulo: "Titulo alternativo",
      journal: "Revista modelo",
      officialUrl: "https://evil.test/changed",
      sourceDomain: "evil.test",
      publication_date: "2026-05-04",
      summary: "Resumen ejecutivo en español con datos suficientes para completar la publicación.",
      pregunta_clinica: "Pregunta clínica generada desde el resumen público disponible.",
      resultado_principal: "Resultado principal sintetizado desde el abstract disponible.",
      keywords: ["Salud pública", "Epidemiología"],
      confidence: 1.7
    }
  );

  assert.equal(article.title, "Titulo alternativo");
  assert.equal(article.sourceName, "Revista modelo");
  assert.equal(article.officialUrl, articleUrl.href);
  assert.equal(article.sourceDomain, articleUrl.hostname);
  assert.equal(article.publicationDate, "2026-05-04");
  assert.equal(article.executiveSummary.startsWith("Resumen ejecutivo"), true);
  assert.deepEqual(article.tags, ["Salud pública", "Epidemiología"]);
  assert.equal(article.extractionConfidence, 1);
});

test("schema and scoring prevent false ai_draft responses", () => {
  assert.equal(validateAIArticleSchema(completeAiArticle).ok, true);
  assert.equal(validateAIArticleSchema({ ...completeAiArticle, tags: "salud" }).ok, false);
  assert.equal(validateAIArticleSchema({ ...completeAiArticle, accessType: "Libre" }).ok, false);

  assert.equal(getAiDraftQuality({}).isUseful, false);
  assert.equal(getAiDraftQuality({ title: "Only title", sourceName: "Journal" }).isUseful, false);
  assert.equal(
    getAiDraftQuality({
      title: "Title",
      sourceName: "Journal",
      executiveSummary: "Resumen en español con suficiente detalle clínico para revisión.",
      publicationDate: "2026-05-03"
    }).isUseful,
    true
  );
  assert.equal(scoreExtractionCompleteness(normalizeAiArticleOutput(articleUrl, {}, completeAiArticle)).isUseful, true);
});

test("extractScientificMetadata keeps backward-compatible metadata output", () => {
  const metadata = extractScientificMetadata(articleUrl, htmlFixture);
  assert.equal(metadata.title, "Official Article Title");
  assert.equal(metadata.sourceName, "The Lancet Regional Health - Americas");
  assert.equal(metadata.publicationDate, "2026-05-03");
  assert.equal(metadata.description, "Objective: assess outcomes. Results: relevant clinical signal.");
  assert.match(metadata.publicText, /Methods text/);
});

test("callArticleExtractionAI returns Spanish structured article and safe errors", async () => {
  const evidencePacket = buildEvidencePacket(extractHtmlSignals(htmlFixture, articleUrl), articleUrl);
  const result = await callArticleExtractionAI(evidencePacket, {
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(completeAiArticle) } }]
        })
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.article.executiveSummary.includes("español"), true);

  const failed = await callArticleExtractionAI(evidencePacket, {
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      text: async () => "server error"
    })
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "openai_500");
});

test("fetchScientificPage captures non-ok HTML body and warnings", async () => {
  const result = await fetchScientificPage(articleUrl, {
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      headers: {
        get: (name) => (name.toLowerCase() === "content-type" ? "text/html" : "")
      },
      text: async () => "<html><title>Heath Advance</title><body>captcha</body></html>"
    }),
    timeoutMs: 100,
    maxBytes: 2000
  });

  assert.equal(result.statusCode, 403);
  assert.match(result.html, /captcha/);
  assert.ok(result.warnings.includes("La fuente respondió HTTP 403."));
});

test("parseJsonObjectFromText supports plain JSON and embedded JSON", () => {
  assert.deepEqual(parseJsonObjectFromText('{"title":"A"}'), { title: "A" });
  assert.deepEqual(parseJsonObjectFromText('Respuesta: {"title":"B","tags":["x"]}'), {
    title: "B",
    tags: ["x"]
  });
  assert.equal(parseJsonObjectFromText("sin json"), null);
});
