const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AI_ARTICLE_FIELD_KEYS,
  buildEvidencePacket,
  buildMetadataOnlyArticle,
  buildOpenAiArticleExtractionPayload,
  buildRawEvidence,
  callArticleExtractionAI,
  detectScientificIdentifiers,
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
  parsePmcXml,
  parsePubMedXml,
  resolveScientificArticle,
  scoreExtractionCompleteness,
  validateAIArticleSchema,
  validateScientificUrl
} = require("../scientificArticleExtraction");

const {
  buildEvidencePacket: buildDocumentEvidencePacket,
  buildOpenAiDocumentPayload,
  callDocumentExtractionAI,
  computeExtractionStatus: computeDocumentExtractionStatus,
  detectDoi: detectDocumentDoi,
  detectLanguage: detectDocumentLanguage,
  getConfiguredDocumentModels,
  resolveScientificArticleDocument,
  validateStoragePathForUid
} = require("../scientificArticleDocumentExtraction");

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

  assert.equal(article.title, "Official Article Title");
  assert.equal(article.sourceName, "The Lancet Regional Health - Americas");
  assert.equal(article.officialUrl, articleUrl.href);
  assert.equal(article.sourceDomain, articleUrl.hostname);
  assert.equal(article.publicationDate, "2026-05-03");
  assert.equal(article.executiveSummary.startsWith("Resumen ejecutivo"), true);
  assert.deepEqual(article.tags, ["Salud pública", "Epidemiología"]);
  assert.equal(article.extractionConfidence, 1);
});

test("schema and scoring prevent false ai_draft responses", () => {
  assert.equal(validateAIArticleSchema(completeAiArticle).ok, true);
  assert.equal(validateAIArticleSchema({ ...completeAiArticle, tags: "salud" }).ok, false);
  assert.equal(validateAIArticleSchema({ ...completeAiArticle, extractionConfidence: "alta" }).ok, false);

  assert.equal(getAiDraftQuality({}).isUseful, false);
  assert.equal(getAiDraftQuality({ title: "Only title", sourceName: "Journal" }).isUseful, false);
  assert.equal(
    getAiDraftQuality({
      title: "Title",
      sourceName: "Journal",
      officialUrl: "https://example.org/article",
      executiveSummary: "Resumen en español con suficiente detalle clínico para revisión.",
      publicationDate: "2026-05-03",
      extractionConfidence: 0.8
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

test("detectScientificIdentifiers extracts DOI, PMID, PMCID, NCT and Lancet PII", () => {
  const identifiers = detectScientificIdentifiers(
    articleUrl,
    "PMID: 41438613 PMCID: PMC12719693 DOI 10.1016/j.lana.2025.101311 NCT12345678"
  );
  assert.equal(identifiers.pii, "S2667-193X(25)00322-9");
  assert.equal(identifiers.pmid, "41438613");
  assert.equal(identifiers.pmcid, "PMC12719693");
  assert.equal(identifiers.nctId, "NCT12345678");
  assert.equal(identifiers.doi, "10.1016/j.lana.2025.101311");
});

test("parsePubMedXml and parsePmcXml extract biomedical metadata", () => {
  const pubmed = parsePubMedXml(`
    <PubmedArticle>
      <MedlineCitation>
        <PMID>41438613</PMID>
        <Article>
          <Journal><Title>Lancet regional health. Americas</Title><JournalIssue><PubDate><Year>2026</Year><Month>Jan</Month></PubDate></JournalIssue></Journal>
          <ArticleTitle>HEARTS quality title.</ArticleTitle>
          <ELocationID EIdType="doi">10.1016/j.lana.2025.101311</ELocationID>
          <Abstract><AbstractText>Public abstract with objective and findings.</AbstractText></Abstract>
          <PublicationTypeList><PublicationType>Review</PublicationType></PublicationTypeList>
        </Article>
        <KeywordList><Keyword>Hypertension</Keyword></KeywordList>
      </MedlineCitation>
      <PubmedData><ArticleIdList><ArticleId IdType="pmc">PMC12719693</ArticleId><ArticleId IdType="pii">S2667-193X(25)00322-9</ArticleId></ArticleIdList></PubmedData>
    </PubmedArticle>
  `);
  assert.equal(pubmed.title, "HEARTS quality title.");
  assert.equal(pubmed.sourceName, "Lancet regional health. Americas");
  assert.equal(pubmed.publicationDate, "2026-01");
  assert.equal(pubmed.pmcid, "PMC12719693");
  assert.equal(pubmed.pii, "S2667-193X(25)00322-9");

  const pmc = parsePmcXml(`
    <article article-type="review-article">
      <front><journal-meta><journal-title-group><journal-title>Lancet Regional Health - Americas</journal-title></journal-title-group></journal-meta>
      <article-meta>
        <article-id pub-id-type="pmcid">PMC12719693</article-id>
        <article-id pub-id-type="pmid">41438613</article-id>
        <article-id pub-id-type="doi">10.1016/j.lana.2025.101311</article-id>
        <title-group><article-title>HEARTS quality title.</article-title></title-group>
        <pub-date pub-type="collection"><year>2026</year><month>1</month></pub-date>
        <abstract><p>PMC summary text.</p></abstract>
        <kwd-group><kwd>Hypertension</kwd></kwd-group>
      </article-meta></front>
    </article>
  `);
  assert.equal(pmc.title, "HEARTS quality title.");
  assert.equal(pmc.sourceName, "Lancet Regional Health - Americas");
  assert.equal(pmc.abstract, "PMC summary text.");
  assert.equal(pmc.accessType, "Resumen disponible");
});

test("resolveScientificArticle continues after publisher 403 and resolves Lancet PII via PubMed", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const textResponse = (status, body, contentType = "text/html") => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : "") },
      text: async () => body
    });
    if (String(url).includes("thelancet.com")) {
      return textResponse(403, "<html><title>Heath Advance</title><body>Complete this captcha to verify you are human.</body></html>");
    }
    if (String(url).includes("esearch.fcgi") && String(url).includes("db=pubmed")) {
      return textResponse(200, JSON.stringify({ esearchresult: { idlist: ["41438613"] } }), "application/json");
    }
    if (String(url).includes("efetch.fcgi") && String(url).includes("db=pubmed")) {
      return textResponse(200, `
        <PubmedArticle>
          <MedlineCitation>
            <PMID>41438613</PMID>
            <Article>
              <Journal><Title>Lancet regional health. Americas</Title><JournalIssue><PubDate><Year>2026</Year><Month>Jan</Month></PubDate></JournalIssue></Journal>
              <ArticleTitle>HEARTS quality: a policy framework to strengthen hypertension.</ArticleTitle>
              <ELocationID EIdType="doi">10.1016/j.lana.2025.101311</ELocationID>
              <Abstract><AbstractText>HEARTS in the Americas is a regional implementation framework with findings for primary health care quality improvement.</AbstractText></Abstract>
              <PublicationTypeList><PublicationType>Review</PublicationType></PublicationTypeList>
            </Article>
          </MedlineCitation>
          <PubmedData><ArticleIdList><ArticleId IdType="pmc">PMC12719693</ArticleId><ArticleId IdType="pii">S2667-193X(25)00322-9</ArticleId></ArticleIdList></PubmedData>
        </PubmedArticle>
      `, "text/xml");
    }
    if (String(url).includes("efetch.fcgi") && String(url).includes("db=pmc")) {
      return textResponse(200, `
        <article article-type="review-article"><front><journal-meta><journal-title-group><journal-title>The Lancet Regional Health - Americas</journal-title></journal-title-group></journal-meta>
        <article-meta><article-id pub-id-type="pmcid">PMC12719693</article-id><article-id pub-id-type="pmid">41438613</article-id><article-id pub-id-type="doi">10.1016/j.lana.2025.101311</article-id>
        <title-group><article-title>HEARTS quality: a policy framework to strengthen hypertension.</article-title></title-group>
        <abstract><p>PMC public summary with objective, context and findings.</p></abstract><kwd-group><kwd>Hypertension</kwd></kwd-group></article-meta></front></article>
      `, "text/xml");
    }
    if (String(url).includes("api.crossref.org")) {
      return textResponse(200, JSON.stringify({ message: { title: ["HEARTS quality: a policy framework to strengthen hypertension."], "container-title": ["The Lancet Regional Health - Americas"], DOI: "10.1016/j.lana.2025.101311", issued: { "date-parts": [[2026, 1]] } } }), "application/json");
    }
    if (String(url).includes("api.openalex.org")) {
      return textResponse(200, JSON.stringify({
        title: "HEARTS quality: a policy framework to strengthen hypertension.",
        primary_location: { source: { display_name: "The Lancet Regional Health - Americas" } },
        ids: { doi: "https://doi.org/10.1016/j.lana.2025.101311", pmid: "https://pubmed.ncbi.nlm.nih.gov/41438613", pmcid: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12719693" },
        publication_date: "2026-01-01",
        type: "article",
        open_access: { is_oa: true },
        abstract_inverted_index: { Regional: [0], framework: [1], findings: [2] }
      }), "application/json");
    }
    if (String(url).includes("api.openai.com")) {
      return textResponse(200, JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          studyType: "Revisión / marco de política sanitaria",
          evidenceType: "Marco de política sanitaria",
          studyLocation: "Américas",
          executiveSummary: "Resumen en español basado en la evidencia pública de PubMed y PMC.",
          clinicalQuestion: "Qué marco puede fortalecer la calidad del manejo de hipertensión en atención primaria.",
          mainResult: "El marco HEARTS Quality organiza objetivos e indicadores para fortalecer la implementación regional.",
          tags: ["hipertensión", "atención primaria", "calidad"],
          warnings: [],
          extractionConfidence: 0.86
        }) } }]
      }), "application/json");
    }
    return textResponse(404, "{}");
  };

  const result = await resolveScientificArticle({ url: articleUrl.href }, { apiKey: "test-key", fetchImpl });
  assert.equal(result.extractionStatus, "ai_draft");
  assert.equal(result.article.pii, "S2667-193X(25)00322-9");
  assert.equal(result.article.pmid, "41438613");
  assert.equal(result.article.pmcid, "PMC12719693");
  assert.equal(result.article.sourceName, "The Lancet Regional Health - Americas");
  assert.match(result.article.executiveSummary, /español/);
  assert.ok(result.rawEvidence.blockedResolvers.includes("publisher_html"));
  assert.ok(result.rawEvidence.successfulResolvers.includes("pubmed"));
  assert.ok(calls.some((url) => url.includes("esearch.fcgi")));
});

test("resolveScientificArticle uses pasted abstract as manual evidence with warning", async () => {
  const fetchImpl = async (url) => ({
    ok: String(url).includes("api.openai.com"),
    status: String(url).includes("api.openai.com") ? 200 : 404,
    headers: { get: () => "application/json" },
    text: async () =>
      String(url).includes("api.openai.com")
        ? JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              studyType: "Estudio observacional",
              evidenceType: "Investigación clínica",
              studyLocation: "",
              executiveSummary: "Resumen en español desde abstract pegado.",
              clinicalQuestion: "Pregunta sintetizada desde el abstract pegado.",
              mainResult: "Resultado principal derivado del texto pegado.",
              tags: ["abstract pegado"],
              warnings: ["Parte de la evidencia fue aportada manualmente por el usuario."],
              extractionConfidence: 0.74
            }) } }]
          })
        : "{}"
  });
  const result = await resolveScientificArticle(
    {
      url: "https://example.org/article",
      pastedTitle: "Título aportado",
      pastedSource: "Revista aportada",
      pastedAbstract: "Objective and findings with enough scientific text to synthesize fields for review."
    },
    { apiKey: "test-key", fetchImpl }
  );
  assert.equal(result.extractionStatus, "ai_draft");
  assert.equal(result.article.title, "Título aportado");
  assert.ok(result.article.warnings.some((warning) => /aportada manualmente/i.test(warning)));
});

test("document resolver validates storage ownership and detects PDF/text metadata", async () => {
  assert.equal(validateStoragePathForUid("bitacora/article-documents/user-a/paper.pdf", "user-a").ok, true);
  assert.equal(validateStoragePathForUid("bitacora/article-documents/user-b/paper.pdf", "user-a").ok, false);
  assert.equal(validateStoragePathForUid("../paper.pdf", "user-a").ok, false);

  const text = `
    HEARTS quality: a policy framework to strengthen hypertension and cardiovascular risk management
    Esteban Londoño, Reena Gupta
    The Lancet Regional Health - Americas
    DOI: 10.1016/j.lana.2025.101311
    Abstract
    HEARTS in the Americas is a regional implementation framework for primary healthcare quality improvement.
    Methods
    The document synthesizes implementation lessons and defines quality indicators.
    Results
    It describes objectives and indicators for institutionalizing quality improvement.
    Conclusions
    The framework supports scale-up and equitable outcomes.
  `;
  const packet = buildDocumentEvidencePacket({
    mode: "pasted_text",
    text,
    officialUrl: "https://example.org/paper",
    pastedSource: "The Lancet Regional Health - Americas"
  });

  assert.equal(packet.detectedMetadata.doi, "10.1016/j.lana.2025.101311");
  assert.equal(packet.detectedMetadata.sourceName, "The Lancet Regional Health - Americas");
  assert.equal(detectDocumentDoi(text), "10.1016/j.lana.2025.101311");
  assert.equal(detectDocumentLanguage(text), "en");
  assert.ok(packet.sections.some((section) => /Abstract|Summary/i.test(section.heading)));
});

test("document OpenAI payload uses strict schema and Spanish anti-hallucination prompt", () => {
  const packet = buildDocumentEvidencePacket({
    mode: "pasted_text",
    text: "Official title\nAbstract\nThis document reports methods, results and conclusions for a scientific review. ".repeat(20),
    pastedSource: "Journal"
  });
  const payload = buildOpenAiDocumentPayload(packet);

  assert.equal(payload.response_format.type, "json_schema");
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.equal(payload.model, getConfiguredDocumentModels()[0]);
  assert.ok(payload.messages[0].content.includes("Todo texto editorial debe estar en español"));
  assert.ok(payload.messages[0].content.includes("No inventes datos"));
  assert.ok(payload.response_format.json_schema.schema.required.includes("objectiveEs"));
  assert.ok(payload.response_format.json_schema.schema.required.includes("mainMessageEs"));
  assert.equal(payload.response_format.json_schema.schema.required.includes("clinicalQuestionEs"), false);
});

test("document resolver treats HEARTS policy PDF summary as ai_draft editorial card", async () => {
  const heartsText = `
HEARTS quality: a policy framework to strengthen hypertension and cardiovascular risk management in primary healthcare—insights from HEARTS in the Americas
The Lancet Regional Health - Americas
Health Policy
Esteban Londoño, Reena Gupta, Patrick Van der Stuyft, Martin Heine, Gloria Giraldo, Grace Marie Ku
Open Access
1 December 2025
https://doi.org/10.1016/j.lana.2025.101311
Summary
HEARTS in the Americas is the largest-scale implementation of the WHO's global initiative, with 33 countries participating, 28 having adopted standardized clinical pathways, and about 10,000 primary healthcare facilities engaged. Despite progress, fragmented care, limited availability of validated blood pressure devices, restricted access to essential medicines, and weak quality assurance systems continue to hinder hypertension control and cardiovascular risk management. In response, PAHO and participating countries co-developed the HEARTS Quality Framework. Grounded in regional implementation, this model synthesizes global evidence and lessons from Latin America and the Caribbean.
Keywords
Americas Hypertension Cardiovascular diseases Primary health care Quality improvement Health systems strengthening
Introduction
The document presents the HEARTS Quality Framework as a model to institutionalize and scale quality improvement in primary healthcare for hypertension and cardiovascular risk.
Methods
The framework is based on regional implementation experience, global evidence, country lessons and expert consensus.
Framework
The quality framework defines standardized protocols, team-based care, validated devices, essential medicines, continuous monitoring, governance and implementation targets.
Forward view
Sustained improvements require institutionalization, quality improvement, primary healthcare strengthening and governance for equitable outcomes.
References
1. This reference section should not be sent as priority evidence.
`.repeat(3);
  let bodySent = "";
  const aiArticle = {
    title: "HEARTS quality: a policy framework to strengthen hypertension and cardiovascular risk management in primary healthcare—insights from HEARTS in the Americas",
    sourceName: "The Lancet Regional Health - Americas",
    journal: "The Lancet Regional Health - Americas",
    authors: ["Esteban Londoño", "Reena Gupta", "Patrick Van der Stuyft", "Martin Heine", "Gloria Giraldo", "Grace Marie Ku"],
    officialUrl: "https://doi.org/10.1016/j.lana.2025.101311",
    doi: "10.1016/j.lana.2025.101311",
    publicationDate: "1 December 2025",
    originalLanguage: "en",
    articleType: "Health Policy",
    evidenceType: "Marco de política sanitaria / implementación en salud pública",
    accessType: "Open access",
    cardSummaryEs: "Presenta el HEARTS Quality Framework para fortalecer la calidad de atención en hipertensión y riesgo cardiovascular en atención primaria.",
    executiveSummaryEs: "El documento describe un marco regional para institucionalizar y escalar HEARTS en las Américas. Integra evidencia, experiencia de países y consenso experto para mejorar protocolos, equipos, dispositivos, medicamentos, monitoreo y gobernanza en atención primaria.",
    objectiveEs: "Describir y fundamentar un marco de calidad para institucionalizar y escalar HEARTS en las Américas.",
    methodologyEs: "Health Policy basado en implementación regional, evidencia internacional, experiencia de países y consenso experto.",
    mainMessageEs: "La mejora sostenida del control de hipertensión requiere protocolos estandarizados, equipos capacitados, dispositivos validados, medicamentos esenciales, monitoreo continuo y gobernanza sanitaria.",
    keyPointsEs: [
      "HEARTS se implementa regionalmente en atención primaria.",
      "El marco prioriza calidad, estandarización y monitoreo.",
      "La gobernanza sanitaria es clave para sostener resultados."
    ],
    localApplicabilityEs: "Puede orientar revisión institucional de procesos de atención primaria y gestión de riesgo cardiovascular.",
    occupationalHealthRelevanceEs: "Aporta criterios de gestión sanitaria poblacional aplicables a programas preventivos y seguimiento de riesgo cardiovascular.",
    limitationsEs: "Es un marco de política sanitaria; no reemplaza evaluación local ni protocolos institucionales.",
    tags: ["Hipertensión", "Riesgo cardiovascular", "Atención primaria", "HEARTS", "Mejora de calidad"],
    warnings: [],
    extractionConfidence: 0.9
  };
  const fetchImpl = async (_url, options) => {
    bodySent = options.body;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiArticle) } }] })
    };
  };

  const result = await resolveScientificArticleDocument(
    {
      mode: "pasted_text",
      pastedText: heartsText,
      pastedSource: "The Lancet Regional Health - Americas",
      officialUrl: "https://doi.org/10.1016/j.lana.2025.101311"
    },
    { uid: "user-a", user: { uid: "user-a" }, apiKey: "test-key", fetchImpl }
  );

  assert.equal(result.extractionStatus, "ai_draft");
  assert.equal(result.article.articleType, "Health Policy");
  assert.equal(result.article.objectiveEs.length > 0, true);
  assert.equal(result.article.mainMessageEs.length > 0, true);
  assert.equal(result.article.keyPointsEs.length >= 3 && result.article.keyPointsEs.length <= 5, true);
  assert.deepEqual(result.article.tags.slice(0, 3), ["Hipertensión", "Riesgo cardiovascular", "Atención primaria"]);
  assert.match(bodySent, /Summary/);
  assert.doesNotMatch(bodySent, /This reference section should not be sent/);
});

test("document AI output is normalized and empty output is not ai_draft", async () => {
  const packet = buildDocumentEvidencePacket({
    mode: "pasted_text",
    text: "HEARTS quality title\nThe Lancet Regional Health - Americas\nAbstract\nScientific content with methods, results and conclusions for review. ".repeat(20),
    pastedSource: "The Lancet Regional Health - Americas"
  });
  const complete = {
    title: "HEARTS quality title",
    sourceName: "The Lancet Regional Health - Americas",
    journal: "The Lancet Regional Health - Americas",
    authors: ["Autora A"],
    officialUrl: "",
    doi: "",
    publicationDate: "",
    originalLanguage: "en",
    articleType: "Artículo científico",
    evidenceType: "Política sanitaria",
    accessType: "Pendiente",
    cardSummaryEs: "Ficha breve en español para revisión del equipo médico.",
    executiveSummaryEs: "Resumen ejecutivo en español basado exclusivamente en el texto aportado.",
    objectiveEs: "Presentar un marco que fortalece la gestión de hipertensión en atención primaria.",
    methodologyEs: "Síntesis documental de implementación regional.",
    mainMessageEs: "El documento organiza indicadores y objetivos de calidad para atención primaria.",
    keyPointsEs: ["Calidad", "Atención primaria", "Gestión sanitaria"],
    limitationsEs: "No especifica resultados clínicos individuales.",
    localApplicabilityEs: "Requiere adaptación institucional.",
    occupationalHealthRelevanceEs: "Puede orientar gestión sanitaria poblacional.",
    tags: ["hipertensión", "calidad"],
    warnings: [],
    extractionConfidence: 0.86
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(complete) } }] })
  });

  const result = await callDocumentExtractionAI(packet, { apiKey: "test-key", fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.article.executiveSummaryEs.includes("español"), true);
  assert.equal(computeDocumentExtractionStatus(result.article), "ai_draft");

  const emptyStatus = computeDocumentExtractionStatus({
    title: "",
    sourceName: "",
    journal: "",
    cardSummaryEs: "",
    extractionConfidence: 0
  });
  assert.equal(emptyStatus, "failed");
});

test("document AI falls back to secondary model when configured model fails", async () => {
  const packet = buildDocumentEvidencePacket({
    mode: "pasted_text",
    text: "Fallback title\nAbstract\nThis scientific document contains summary, methods, findings and conclusions. ".repeat(25),
    pastedSource: "Fallback Journal"
  });
  const article = {
    title: "Fallback title",
    sourceName: "Fallback Journal",
    journal: "Fallback Journal",
    authors: [],
    officialUrl: "",
    doi: "",
    publicationDate: "2026",
    originalLanguage: "en",
    articleType: "Artículo científico",
    evidenceType: "Revisión",
    accessType: "Pendiente",
    cardSummaryEs: "Resumen breve en español para validar el fallback.",
    executiveSummaryEs: "Resumen ejecutivo en español basado en evidencia real del documento.",
    objectiveEs: "Validar el funcionamiento del modelo documental secundario.",
    methodologyEs: "Prueba de fallback con structured outputs.",
    mainMessageEs: "El sistema puede continuar si falla el modelo configurado.",
    keyPointsEs: ["Fallback", "Structured outputs", "Validación"],
    localApplicabilityEs: "",
    occupationalHealthRelevanceEs: "",
    limitationsEs: "",
    tags: ["Validación", "IA"],
    warnings: [],
    extractionConfidence: 0.82
  };
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(JSON.parse(options.body).model);
    if (calls.length === 1) {
      return { ok: false, status: 404, text: async () => JSON.stringify({ error: "missing model" }) };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(article) } }] })
    };
  };

  const result = await callDocumentExtractionAI(packet, { apiKey: "test-key", fetchImpl, model: "modelo-no-disponible" });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["modelo-no-disponible", "gpt-4o-mini"]);
  assert.equal(result.modelUsed, "gpt-4o-mini");
});

test("document resolver processes pasted text, rejects short text and handles PDF low text", async () => {
  const aiArticle = {
    title: "Scientific document title",
    sourceName: "Institutional Journal",
    journal: "Institutional Journal",
    authors: [],
    officialUrl: "",
    doi: "",
    publicationDate: "2026",
    originalLanguage: "en",
    articleType: "Artículo científico",
    evidenceType: "Revisión",
    accessType: "Pendiente",
    cardSummaryEs: "Resumen breve en español para la tarjeta científica.",
    executiveSummaryEs: "Resumen ejecutivo en español basado en el documento aportado.",
    objectiveEs: "Describir qué propósito científico aborda el documento.",
    methodologyEs: "Metodología descrita en el documento.",
    mainMessageEs: "Mensaje principal derivado del texto aportado.",
    keyPointsEs: ["Punto clave uno", "Punto clave dos", "Punto clave tres"],
    limitationsEs: "",
    localApplicabilityEs: "",
    occupationalHealthRelevanceEs: "",
    tags: ["revisión"],
    warnings: [],
    extractionConfidence: 0.78
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiArticle) } }] })
  });

  const pasted = await resolveScientificArticleDocument(
    {
      mode: "pasted_text",
      pastedText: "Scientific document title\nAbstract\nThis document contains methods, results and conclusions for a review. ".repeat(30),
      pastedSource: "Institutional Journal"
    },
    { uid: "user-a", user: { uid: "user-a" }, apiKey: "test-key", fetchImpl }
  );
  assert.equal(pasted.extractionStatus, "ai_draft");
  assert.match(pasted.article.executiveSummaryEs, /español/);
  assert.equal(pasted.rawEvidence.mode, "pasted_text");

  const short = await resolveScientificArticleDocument(
    { mode: "pasted_text", pastedText: "too short" },
    { uid: "user-a", user: { uid: "user-a" }, apiKey: "test-key", fetchImpl }
  );
  assert.equal(short.extractionStatus, "failed");

  const fakeBucket = {
    file: () => ({
      getMetadata: async () => [{ contentType: "application/pdf", size: "1200" }],
      download: async () => [Buffer.from("%PDF")]
    })
  };
  const lowPdf = await resolveScientificArticleDocument(
    {
      mode: "pdf",
      storagePath: "bitacora/article-documents/user-a/scan.pdf",
      originalFileName: "scan.pdf"
    },
    {
      uid: "user-a",
      user: { uid: "user-a" },
      bucket: fakeBucket,
      apiKey: "test-key",
      pdfParseImpl: async () => ({ text: "short", numpages: 1 }),
      fetchImpl
    }
  );
  assert.equal(lowPdf.extractionStatus, "failed");
  assert.match(lowPdf.article.warnings.join(" "), /PDF no contiene texto extraíble/);
});
