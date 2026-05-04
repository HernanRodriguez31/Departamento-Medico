const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMetadataOnlyArticle,
  buildOpenAiArticleExtractionPayload,
  extractScientificMetadata,
  getAiDraftQuality,
  normalizeAiArticleOutput,
  parseJsonObjectFromText
} = require("../scientificArticleExtraction");

const articleUrl = new URL("https://www.thelancet.com/journals/lanam/article/PIIS2667-193X(25)00322-9/fulltext");

test("OpenAI extraction payload requires Spanish text and exact camelCase JSON keys", () => {
  const payload = buildOpenAiArticleExtractionPayload(articleUrl, {
    title: "Official clinical title",
    sourceName: "The Lancet Regional Health - Americas",
    publicationDate: "2026-05-03",
    description: "Public abstract",
    doi: "10.1016/example",
    warnings: [],
    publicText: "Background Methods Results Conclusions"
  });

  assert.equal(payload.response_format.type, "json_schema");
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.ok(payload.messages[0].content.includes("valores textuales en español"));
  assert.ok(payload.messages[0].content.includes("claves camelCase"));
  assert.deepEqual(payload.response_format.json_schema.schema.required, [
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
  ]);
});

test("normalizeAiArticleOutput accepts aliases but preserves canonical URL and domain", () => {
  const article = normalizeAiArticleOutput(
    articleUrl,
    {
      title: "Official source title",
      sourceName: "The Lancet",
      publicationDate: "2026-05-03",
      description: "",
      warnings: []
    },
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

test("sparse AI output is not considered a useful ai_draft", () => {
  assert.equal(getAiDraftQuality({}).isUseful, false);
  assert.equal(getAiDraftQuality({ title: "Only title", sourceName: "Journal" }).isUseful, false);
  assert.equal(
    getAiDraftQuality({
      executiveSummary: "Resumen en español con suficiente detalle clínico para revisión."
    }).isUseful,
    true
  );
});

test("extractScientificMetadata reads citation meta and JSON-LD publisher objects", () => {
  const html = `
    <html>
      <head>
        <meta name="citation_title" content="Official Article Title">
        <meta name="citation_publication_date" content="2026-05-03">
        <meta name="citation_abstract" content="Objective: assess outcomes. Results: relevant clinical signal.">
        <script type="application/ld+json">
          {"@type":"ScholarlyArticle","publisher":{"name":"Journal Publisher"}}
        </script>
      </head>
      <body><section class="abstract">Abstract text with public findings.</section></body>
    </html>
  `;

  const metadata = extractScientificMetadata(articleUrl, html);
  assert.equal(metadata.title, "Official Article Title");
  assert.equal(metadata.publicationDate, "2026-05-03");
  assert.equal(metadata.description, "Objective: assess outcomes. Results: relevant clinical signal.");
  assert.match(metadata.publicText, /Abstract text/);

  const metadataOnly = buildMetadataOnlyArticle(articleUrl, metadata);
  assert.equal(metadataOnly.title, "Official Article Title");
  assert.equal(metadataOnly.extractionConfidence, 0.3);
});

test("parseJsonObjectFromText supports plain JSON and embedded JSON", () => {
  assert.deepEqual(parseJsonObjectFromText('{"title":"A"}'), { title: "A" });
  assert.deepEqual(parseJsonObjectFromText('Respuesta: {"title":"B","tags":["x"]}'), {
    title: "B",
    tags: ["x"]
  });
  assert.equal(parseJsonObjectFromText("sin json"), null);
});
