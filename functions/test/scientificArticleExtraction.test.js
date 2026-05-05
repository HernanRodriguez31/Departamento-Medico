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

const {
  SCIENTIFIC_METHODOLOGY_TAXONOMY,
  buildMethodologyEvidence,
  preclassifyMethodology
} = require("../scientificMethodologyTaxonomy");

const articleUrl = new URL("https://www.thelancet.com/journals/lanam/article/PIIS2667-193X(25)00322-9/fulltext");

const methodologyProfileFixture = (overrides = {}) => ({
  studyFamily: "implementation_health_policy",
  studyFamilyEs: "Implementación / política sanitaria",
  specificDesign: "Marco de implementación",
  designCategoryEs: "Marco de implementación",
  temporalDirection: "no aplica",
  centerScope: "regional",
  isMulticenter: false,
  multicenterRationale: "Alcance regional programático, no estudio clínico multicéntrico.",
  setting: "atención primaria",
  countryOrRegion: "Américas",
  countriesIncluded: [],
  institutions: ["PAHO"],
  studyPopulation: "Redes y equipos de atención primaria",
  sampleSize: "",
  sampleDescription: "Alcance programático regional, no muestra clínica.",
  studyPeriod: "2017-2025",
  studyDuration: "No especificado en el documento",
  recruitmentPeriod: "",
  followUpDuration: "",
  dataSource: "Evidencia documental y experiencia regional.",
  interventionOrExposure: "HEARTS Quality Framework",
  comparator: "",
  primaryOutcome: "Fortalecer la calidad de implementación.",
  secondaryOutcomes: [],
  statisticalApproach: "",
  effectMeasures: [],
  reportingGuideline: "",
  methodologicalStrengths: ["Integra evidencia y experiencia regional."],
  methodologicalLimitations: ["No es un estudio clínico primario."],
  applicabilityNotes: ["Aplicable a gestión sanitaria."],
  classificationRationale: "El documento describe un marco de política sanitaria e implementación.",
  classificationConfidence: "alta",
  evidenceSupport: {
    specificDesign: {
      supportLevel: "inferido_con_soporte",
      evidenceText: "Health Policy y framework de implementación regional.",
      sourceSection: "Summary"
    },
    temporalDirection: {
      supportLevel: "no_aplica",
      evidenceText: "No es estudio clínico primario.",
      sourceSection: "Methods"
    },
    centerScope: {
      supportLevel: "inferido_con_soporte",
      evidenceText: "Participan países de las Américas.",
      sourceSection: "Summary"
    },
    studyPopulation: {
      supportLevel: "inferido_con_soporte",
      evidenceText: "Atención primaria e hipertensión en la región.",
      sourceSection: "Summary"
    },
    sampleSize: {
      supportLevel: "no_aplica",
      evidenceText: "No corresponde muestra clínica.",
      sourceSection: "Methods"
    },
    studyPeriod: {
      supportLevel: "explicito",
      evidenceText: "2017-2025.",
      sourceSection: "Methods"
    },
    institutions: {
      supportLevel: "explicito",
      evidenceText: "PAHO.",
      sourceSection: "Summary"
    }
  },
  methodologyWarnings: [],
  ...overrides
});

const expandedDescriptionSectionsFixture = () => [
  {
    heading: "Contexto",
    body:
      "El documento aborda un problema clínico y sanitario relevante para la lectura médica institucional, con foco en el modo en que la evidencia disponible ayuda a interpretar decisiones de prevención, diagnóstico, tratamiento o gestión."
      + " Cuando corresponde, permite describir un marco regional sin confundirlo con un ensayo clínico primario. La síntesis mantiene una mirada editorial y explica por qué el tema importa para equipos que necesitan priorizar lectura crítica sin reemplazar el análisis completo de la fuente."
  },
  {
    heading: "Diseño y población",
    body:
      "La ficha distingue el tipo de documento publicado del diseño o evidencia analizada, describe la población o ámbito cuando está especificado y evita clasificar como estudio primario aquello que corresponde a revisión, guía, consenso o política sanitaria. También conserva cautela cuando el tamaño muestral, país, institución o seguimiento no aparecen explícitamente en el texto."
  },
  {
    heading: "Qué evaluó",
    body:
      "La síntesis resume el objetivo, la exposición, intervención, estrategia o fenómeno evaluado, junto con los métodos declarados por la fuente y las variables principales disponibles en el texto aportado. Cuando el documento describe una evidencia subyacente, separa esa evidencia del formato editorial de publicación para evitar una lectura metodológica simplificada."
  },
  {
    heading: "Hallazgos relevantes",
    body:
      "El resumen identifica los mensajes y hallazgos principales sin copiar el abstract completo ni transformar asociaciones en causalidad cuando el diseño no lo permite. La redacción prioriza resultados, contribuciones o mensajes sustentados, evita frases genéricas y mantiene el alcance de la interpretación dentro de lo que el documento realmente informa."
  },
  {
    heading: "Lectura práctica",
    body:
      "La interpretación final ubica la relevancia clínica, sanitaria u ocupacional y señala cautelas de aplicabilidad para que el equipo médico pueda decidir si debe leer el documento completo. Incluye la utilidad potencial para práctica clínica, gestión institucional, salud ocupacional o planificación sanitaria sin convertir la síntesis en una recomendación clínica automática."
      + " También ayuda a separar lo que el documento demuestra de aquello que solo sugiere para discusión local."
  }
];

const expandedDescriptionTextFixture = () =>
  expandedDescriptionSectionsFixture()
    .map((section) => `${section.heading}. ${section.body}`)
    .join(" ");

const completeAiArticle = {
  title: "Official clinical title",
  sourceName: "The Lancet Regional Health - Americas",
  studyType: "Estudio observacional",
  evidenceType: "Investigación clínica",
  publicationDate: "2026-05-03",
  studyLocation: "América Latina",
  briefDescriptionEs: "Síntesis breve en español para orientar lectura científica.",
  expandedDescriptionEs: expandedDescriptionTextFixture(),
  expandedDescriptionSections: expandedDescriptionSectionsFixture(),
  expandedDescriptionQuality: "complete",
  executiveSummary: "Resumen ejecutivo en español basado en el abstract público disponible.",
  clinicalQuestion: "Pregunta clínica en español derivada del objetivo del artículo.",
  mainResult: "Resultado principal en español derivado de los hallazgos del artículo.",
  methodologyProfile: methodologyProfileFixture(),
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
  assert.ok(payload.messages[0].content.includes("350 a 550 palabras"));
  assert.ok(payload.response_format.json_schema.schema.required.includes("expandedDescriptionSections"));
  assert.ok(payload.response_format.json_schema.schema.required.includes("expandedDescriptionQuality"));
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

test("preclassifies core methodology families deterministically", () => {
  const trialPacket = {
    sections: [
      {
        heading: "Methods",
        text: "This randomized controlled trial used random allocation, placebo control, blinding, intervention, comparator and follow-up outcomes."
      }
    ],
    methodologyEvidence: buildMethodologyEvidence({
      sections: [{ heading: "Methods", text: "randomized controlled trial placebo blinding intervention comparator follow-up" }]
    })
  };
  const cohortPacket = {
    sections: [
      {
        heading: "Methods",
        text: "A retrospective cohort study used electronic health records and medical records from 2016 to 2020 to assess exposure and outcome."
      }
    ],
    methodologyEvidence: buildMethodologyEvidence({
      sections: [{ heading: "Methods", text: "retrospective cohort electronic health records exposure outcome" }]
    })
  };
  const reviewPacket = {
    sections: [
      {
        heading: "Search strategy",
        text: "This systematic review followed PRISMA, databases searched, inclusion criteria, risk of bias and meta-analysis."
      }
    ],
    methodologyEvidence: buildMethodologyEvidence({
      sections: [{ heading: "Search strategy", text: "systematic review PRISMA databases searched inclusion criteria risk of bias meta-analysis" }]
    })
  };

  assert.equal(preclassifyMethodology(trialPacket, SCIENTIFIC_METHODOLOGY_TAXONOMY).possibleFamilies[0], "experimental_interventional");
  assert.equal(preclassifyMethodology(cohortPacket, SCIENTIFIC_METHODOLOGY_TAXONOMY).possibleFamilies[0], "observational_analytical");
  assert.equal(preclassifyMethodology(reviewPacket, SCIENTIFIC_METHODOLOGY_TAXONOMY).possibleFamilies[0], "evidence_synthesis");
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
	          briefDescriptionEs: "Presenta HEARTS Quality como marco regional para fortalecer hipertensión en atención primaria.",
	          expandedDescriptionEs: expandedDescriptionTextFixture(),
          expandedDescriptionSections: expandedDescriptionSectionsFixture(),
          expandedDescriptionQuality: "complete",
	          executiveSummary: "Resumen en español basado en la evidencia pública de PubMed y PMC.",
	          clinicalQuestion: "Qué marco puede fortalecer la calidad del manejo de hipertensión en atención primaria.",
	          mainResult: "El marco HEARTS Quality organiza objetivos e indicadores para fortalecer la implementación regional.",
	          methodologyProfile: methodologyProfileFixture(),
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
  assert.match(result.article.executiveSummary, /clínico|sanitario|síntesis/i);
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
	              briefDescriptionEs: "Resumen breve en español desde abstract pegado.",
	              expandedDescriptionEs: expandedDescriptionTextFixture(),
              expandedDescriptionSections: expandedDescriptionSectionsFixture(),
              expandedDescriptionQuality: "complete",
	              executiveSummary: "Resumen en español desde abstract pegado.",
	              clinicalQuestion: "Pregunta sintetizada desde el abstract pegado.",
	              mainResult: "Resultado principal derivado del texto pegado.",
	              methodologyProfile: methodologyProfileFixture({ studyFamily: "observational_analytical", studyFamilyEs: "Observacional analítico", specificDesign: "Estudio observacional", designCategoryEs: "Estudio observacional", countryOrRegion: "" }),
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
  assert.ok(payload.messages[0].content.includes("350 a 550 palabras"));
  assert.ok(payload.response_format.json_schema.schema.required.includes("objectiveEs"));
  assert.ok(payload.response_format.json_schema.schema.required.includes("mainMessageEs"));
  assert.ok(payload.response_format.json_schema.schema.required.includes("studyDesignEs"));
  assert.ok(payload.response_format.json_schema.schema.required.includes("studyContextEs"));
  assert.ok(payload.response_format.json_schema.schema.required.includes("expandedDescriptionSections"));
  assert.ok(payload.response_format.json_schema.schema.required.includes("expandedDescriptionQuality"));
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
    briefDescriptionEs: "Presenta el HEARTS Quality Framework para fortalecer el control de hipertensión en atención primaria de las Américas.",
    expandedDescriptionEs: expandedDescriptionTextFixture(),
    expandedDescriptionSections: expandedDescriptionSectionsFixture(),
    expandedDescriptionQuality: "complete",
    cardSummaryEs: "Presenta el HEARTS Quality Framework para fortalecer la calidad de atención en hipertensión y riesgo cardiovascular en atención primaria.",
    executiveSummaryEs: expandedDescriptionTextFixture(),
    objectiveEs: "Describir y fundamentar un marco de calidad para institucionalizar y escalar HEARTS en las Américas.",
    studyDesignEs: "Health Policy basado en implementación regional, evidencia internacional, experiencia de países y consenso experto.",
    studyContextEs: "Marco desarrollado para países de las Américas, con foco en atención primaria, hipertensión y riesgo cardiovascular.",
    studyPopulationEs: "Personas adultas con hipertensión o riesgo cardiovascular atendidas en redes de atención primaria.",
    studyLocationEs: "Américas / América Latina y el Caribe.",
    studyPeriodEs: "Implementación regional y desarrollo del marco entre 2016 y 2025.",
    mainMessageEs: "La mejora sostenida del control de hipertensión requiere protocolos estandarizados, equipos capacitados, dispositivos validados, medicamentos esenciales, monitoreo continuo y gobernanza sanitaria.",
    keyPointsEs: [
      "HEARTS se implementa regionalmente en atención primaria.",
      "El marco prioriza calidad, estandarización y monitoreo.",
      "La gobernanza sanitaria es clave para sostener resultados."
    ],
    localApplicabilityEs: "Puede orientar revisión institucional de procesos de atención primaria y gestión de riesgo cardiovascular.",
    occupationalHealthRelevanceEs: "Aporta criterios de gestión sanitaria poblacional aplicables a programas preventivos y seguimiento de riesgo cardiovascular.",
    limitationsEs: "Es un marco de política sanitaria; no reemplaza evaluación local ni protocolos institucionales.",
    methodologyProfile: methodologyProfileFixture({
      institutions: ["PAHO", "OPS", "WHO"],
      countriesIncluded: ["33 países de las Américas"],
      sampleSize: "",
      sampleDescription: "33 países participantes, alrededor de 10.000 centros de atención primaria y más de 6 millones de personas en tratamiento, según el documento.",
      studyPeriod: "2016/2017-2025",
      studyDuration: "No especificado en el documento",
      temporalDirection: "no aplica"
    }),
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
  assert.equal(result.article.studyDesignEs.length > 0, true);
  assert.equal(result.article.studyContextEs.length > 0, true);
  assert.equal(result.article.studyLocationEs.length > 0, true);
  assert.equal(result.article.methodologyEs, result.article.studyDesignEs);
  assert.equal(result.article.briefDescriptionEs.length <= 280, true);
  assert.match(result.article.expandedDescriptionEs, /marco regional/i);
  assert.equal(result.article.methodologyProfile.studyFamily, "implementation_health_policy");
  assert.match(result.article.methodologyProfile.designCategoryEs, /Marco de implementación/i);
  assert.equal(result.article.methodologyProfile.isMulticenter, false);
  assert.match(result.article.methodologyProfile.multicenterRationale, /no estudio clínico multicéntrico|programático/i);
  assert.match(result.article.methodologyProfile.countryOrRegion, /Américas/i);
  assert.ok(result.article.methodologyProfile.institutions.some((institution) => /PAHO|OPS/.test(institution)));
  assert.match(result.article.methodologyProfile.sampleDescription, /10\.000|10000|programático|países/i);
  assert.equal(result.article.methodologyProfile.sampleSize, "");
  assert.match(result.article.methodologyProfile.studyDuration, /No especificado/i);
  assert.doesNotMatch(result.article.methodologyProfile.temporalDirection, /prospectivo|retrospectivo/i);
  assert.equal(result.article.methodologyProfile.evidenceSupport.temporalDirection.supportLevel, "no_aplica");
  assert.ok(result.rawEvidence.preclassification.possibleFamilies.includes("implementation_health_policy"));
  assert.equal(result.article.mainMessageEs.length > 0, true);
  assert.equal(result.article.keyPointsEs.length >= 3 && result.article.keyPointsEs.length <= 5, true);
  assert.deepEqual(result.article.tags.slice(0, 3), ["Hipertensión", "Riesgo cardiovascular", "Atención primaria"]);
  assert.match(bodySent, /Summary/);
  assert.doesNotMatch(bodySent, /This reference section should not be sent/);
});

test("document resolver separates PESA focus seminar from underlying prospective cohort", async () => {
  const pesaText = `
JACC Focus Seminar: The Best of Population Research Studies
Focus Seminar
The PESA study is an ongoing prospective cohort evaluating progression of subclinical atherosclerosis in asymptomatic middle-aged adults.
The cohort enrolled 4,184 Banco Santander employees in Madrid, Spain, between 2010 and 2014.
Participants undergo serial visits initially every three years with questionnaires, blood samples, ECG, accelerometry and multiterritorial non-invasive imaging.
The review summarizes accumulated contributions of PESA and discusses early detection and cardiovascular risk stratification.
`.repeat(4);
  const pesaSections = [
    {
      heading: "Contexto",
      body:
        "El documento publicado corresponde a un Focus Seminar que revisa aportes acumulados del estudio PESA sobre aterosclerosis subclínica. No debe leerse como un ensayo clínico ni como un artículo primario simple, sino como una síntesis editorial de evidencia poblacional orientada a comprender detección temprana y estratificación de riesgo cardiovascular."
        + " Esta distinción es importante porque el formato de publicación organiza una lectura panorámica del programa PESA y no equivale a presentar un único análisis causal o una intervención experimental."
    },
    {
      heading: "Diseño y población",
      body:
        "La evidencia central analizada es PESA, una cohorte prospectiva en curso con 4.184 adultos asintomáticos de mediana edad, empleados del Banco Santander en Madrid, España. El enrolamiento se describe entre 2010 y 2014, con visitas seriadas inicialmente cada tres años y seguimiento prolongado según el texto fuente."
        + " La población laboral y el ámbito geográfico deben conservarse explícitos para evitar extrapolaciones automáticas a otras comunidades clínicas."
    },
    {
      heading: "Qué evaluó",
      body:
        "La cohorte evalúa presencia y progresión de aterosclerosis subclínica mediante entrevistas, cuestionarios, muestras biológicas, ECG, acelerometría e imágenes no invasivas multiterritoriales. La publicación revisa cómo esas mediciones permiten caracterizar trayectorias de enfermedad antes de síntomas clínicos y relacionarlas con factores de riesgo."
        + " El énfasis metodológico está en mediciones seriadas, integración fenotípica y observación longitudinal de cambios subclínicos."
    },
    {
      heading: "Hallazgos relevantes",
      body:
        "La lectura destaca contribuciones acumuladas de PESA para entender progresión aterosclerótica, carga subclínica y utilidad de mediciones seriadas. La síntesis evita presentar un resultado único porque el documento revisa un programa de investigación longitudinal, no un análisis aislado con una sola comparación."
    },
    {
      heading: "Lectura práctica",
      body:
        "La relevancia práctica se ubica en prevención cardiovascular, detección temprana y discusión de herramientas de estratificación en población aparentemente sana. La aplicabilidad requiere cautela porque se trata de una cohorte específica de trabajadores en España y sus hallazgos deben interpretarse según contexto y representatividad."
        + " La lectura es útil para equipos que evalúan vigilancia preventiva y comunicación del riesgo en personas sin síntomas."
    }
  ];
  const pesaExpanded = pesaSections.map((section) => `${section.heading}. ${section.body}`).join(" ");
  const aiArticle = {
    title: "JACC Focus Seminar: The Best of Population Research Studies",
    sourceName: "JACC",
    journal: "JACC",
    authors: ["Equipo PESA"],
    officialUrl: "https://example.org/pesa",
    doi: "",
    publicationDate: "2026",
    originalLanguage: "en",
    articleType: "Focus Seminar / revisión narrativa",
    evidenceType: "Revisión sobre cohorte prospectiva",
    accessType: "Open access",
    briefDescriptionEs: "Revisa aportes de PESA, cohorte prospectiva española sobre aterosclerosis subclínica y prevención cardiovascular.",
    expandedDescriptionEs: pesaExpanded,
    expandedDescriptionSections: pesaSections,
    expandedDescriptionQuality: "complete",
    cardSummaryEs: "Revisa aportes de PESA, cohorte prospectiva española sobre aterosclerosis subclínica y prevención cardiovascular.",
    executiveSummaryEs: pesaExpanded,
    objectiveEs: "Sintetizar contribuciones del estudio PESA para comprender aterosclerosis subclínica y riesgo cardiovascular.",
    studyDesignEs: "Focus Seminar sobre cohorte prospectiva en curso.",
    studyContextEs: "Cohorte PESA en empleados del Banco Santander, Madrid, España.",
    studyPopulationEs: "4.184 adultos asintomáticos de mediana edad.",
    studyLocationEs: "Madrid, España.",
    studyPeriodEs: "2010-2014; seguimiento seriado posterior.",
    mainMessageEs: "PESA aporta evidencia longitudinal para caracterizar aterosclerosis subclínica antes de síntomas clínicos.",
    keyPointsEs: ["Focus Seminar, no ensayo clínico.", "Cohorte prospectiva subyacente.", "Imágenes no invasivas seriadas."],
    limitationsEs: "Cohorte laboral específica; interpretar representatividad con cautela.",
    localApplicabilityEs: "Útil para lectura crítica de prevención cardiovascular y estratificación de riesgo.",
    occupationalHealthRelevanceEs: "Relevante para vigilancia preventiva en poblaciones laborales asintomáticas.",
    methodologyProfile: methodologyProfileFixture({
      studyFamily: "observational_analytical",
      studyFamilyEs: "Estudio observacional analítico",
      specificDesign: "Cohorte prospectiva",
      designCategoryEs: "Cohorte prospectiva",
      temporalDirection: "prospectivo",
      centerScope: "institucional",
      setting: "población laboral",
      countryOrRegion: "España",
      institutions: ["CNIC", "Banco Santander"],
      studyPopulation: "Adultos asintomáticos de mediana edad",
      sampleSize: "4.184 participantes",
      sampleDescription: "Empleados del Banco Santander en Madrid.",
      studyPeriod: "2010-2014",
      followUpDuration: "Visitas inicialmente cada tres años",
      dataSource: "Cuestionarios, muestras, ECG, acelerometría e imágenes no invasivas.",
      interventionOrExposure: "Evaluación de aterosclerosis subclínica",
      primaryOutcome: "Presencia y progresión de aterosclerosis subclínica",
      classificationRationale: "El documento es un Focus Seminar; la evidencia subyacente principal es una cohorte prospectiva."
    }),
    tags: ["PESA", "Aterosclerosis", "Cohorte prospectiva"],
    warnings: [],
    extractionConfidence: 0.92
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiArticle) } }] })
  });

  const result = await resolveScientificArticleDocument(
    { mode: "pasted_text", pastedText: pesaText, pastedSource: "JACC", officialUrl: "https://example.org/pesa" },
    { uid: "user-a", user: { uid: "user-a" }, apiKey: "test-key", fetchImpl }
  );

  assert.equal(result.extractionStatus, "ai_draft");
  assert.match(result.article.articleType, /Focus Seminar|revisión/i);
  assert.match(result.article.studyDesignEs, /cohorte prospectiva/i);
  assert.equal(result.article.expandedDescriptionQuality, "complete");
  assert.equal(result.article.expandedDescriptionSections.length >= 4, true);
  assert.equal(result.article.expandedDescriptionEs.split(/\s+/).length >= 300, true);
  assert.match(result.article.expandedDescriptionEs, /4\.184|Banco Santander|Madrid|2010/i);
  assert.doesNotMatch(`${result.article.studyDesignEs} ${result.article.methodologyProfile.specificDesign}`, /ensayo clínico/i);
});

test("document resolver retries short expanded description and keeps ai_draft when retry succeeds", async () => {
  const shortExpanded =
    "El documento resume un problema clínico relevante, describe el objetivo general, menciona aspectos metodológicos y presenta mensajes útiles para revisión institucional. La ficha permite orientar una primera lectura, aunque esta versión inicial no desarrolla con suficiente detalle el contexto, la población, el diseño, la metodología, los hallazgos ni la aplicabilidad práctica para el equipo médico.";
  const shortArticle = {
    title: "Short editorial PDF",
    sourceName: "Journal QA",
    journal: "Journal QA",
    authors: ["Autora QA"],
    officialUrl: "https://doi.org/10.1111/short",
    doi: "10.1111/short",
    publicationDate: "2026",
    originalLanguage: "en",
    articleType: "Artículo científico",
    evidenceType: "Investigación clínica",
    accessType: "Open access",
    briefDescriptionEs: "Evalúa evidencia clínica para orientar lectura crítica institucional.",
    expandedDescriptionEs: shortExpanded,
    expandedDescriptionSections: [],
    expandedDescriptionQuality: "insufficient",
    cardSummaryEs: "Evalúa evidencia clínica para orientar lectura crítica institucional.",
    executiveSummaryEs: shortExpanded,
    objectiveEs: "Sintetizar el objetivo clínico principal del documento.",
    studyDesignEs: "Estudio observacional con análisis de resultados clínicos.",
    studyContextEs: "Documento con resumen, métodos, resultados y discusión.",
    studyPopulationEs: "Pacientes adultos descriptos en el documento.",
    studyLocationEs: "No especificado en el documento.",
    studyPeriodEs: "No especificado en el documento.",
    mainMessageEs: "La evidencia debe interpretarse según diseño y contexto clínico.",
    keyPointsEs: ["Contexto clínico", "Métodos disponibles", "Aplicabilidad prudente"],
    localApplicabilityEs: "Útil para lectura crítica local.",
    occupationalHealthRelevanceEs: "Puede orientar discusión sanitaria institucional.",
    limitationsEs: "La primera descripción generada fue demasiado breve.",
    methodologyProfile: methodologyProfileFixture({
      studyFamily: "observational_analytical",
      studyFamilyEs: "Estudio observacional analítico",
      specificDesign: "Estudio observacional",
      designCategoryEs: "Estudio observacional"
    }),
    tags: ["QA", "Descripción ampliada"],
    warnings: [],
    extractionConfidence: 0.82
  };
  const retryArticle = {
    ...shortArticle,
    expandedDescriptionEs: expandedDescriptionTextFixture(),
    expandedDescriptionSections: expandedDescriptionSectionsFixture(),
    expandedDescriptionQuality: "complete",
    executiveSummaryEs: expandedDescriptionTextFixture()
  };
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    const content = body.messages.map((message) => message.content).join(" ");
    calls.push({
      schema: body.response_format?.json_schema?.name || "",
      retry: /Regenerá una descripción editorial amplia|descripción ampliada insuficiente/i.test(content)
    });
    const article = calls.at(-1).retry ? retryArticle : shortArticle;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(article) } }] })
    };
  };

  const result = await resolveScientificArticleDocument(
    {
      mode: "pasted_text",
      pastedText:
        "Short editorial PDF\nJournal QA\nAbstract\nThis document has clinical context, methods, participants, results, discussion, limitations and conclusion. ".repeat(35),
      pastedSource: "Journal QA",
      officialUrl: "https://doi.org/10.1111/short"
    },
    { uid: "user-a", user: { uid: "user-a" }, apiKey: "test-key", fetchImpl }
  );

  assert.equal(result.extractionStatus, "ai_draft");
  assert.equal(result.article.expandedDescriptionQuality, "complete");
  assert.equal(result.article.expandedDescriptionEs.split(/\s+/).length >= 280, true);
  assert.equal(result.article.expandedDescriptionSections.length >= 4, true);
  assert.equal(calls.some((call) => call.retry), true);
  assert.match(result.article.warnings.join(" "), /regeneró la descripción ampliada/i);
  assert.equal(Number(result.rawEvidence.agentDurations.expandedDescriptionRetryMs) >= 0, true);
  assert.equal(result.rawEvidence.expandedDescriptionQuality, "complete");
  assert.equal(result.rawEvidence.expandedDescriptionWordCount >= 280, true);
  assert.equal(result.rawEvidence.expandedDescriptionSectionCount >= 4, true);
  assert.equal(result.rawEvidence.expandedDescriptionRetryAttempted, true);
});

test("document resolver downgrades to metadata_only when expanded description retry stays too short", async () => {
  const shortExpanded =
    "El documento presenta un resumen clínico útil, con objetivo, método general y mensajes principales. Sin embargo, la descripción no desarrolla contexto, población, metodología, hallazgos, limitaciones ni aplicabilidad con la profundidad mínima necesaria para una ficha editorial completa.";
  const shortArticle = {
    title: "Still short PDF",
    sourceName: "Journal QA",
    journal: "Journal QA",
    authors: ["Autora QA"],
    officialUrl: "https://doi.org/10.1111/still-short",
    doi: "10.1111/still-short",
    publicationDate: "2026",
    originalLanguage: "en",
    articleType: "Artículo científico",
    evidenceType: "Investigación clínica",
    accessType: "Open access",
    briefDescriptionEs: "Resume evidencia clínica pero requiere revisión editorial.",
    expandedDescriptionEs: shortExpanded,
    expandedDescriptionSections: [],
    expandedDescriptionQuality: "insufficient",
    cardSummaryEs: "Resume evidencia clínica pero requiere revisión editorial.",
    executiveSummaryEs: shortExpanded,
    objectiveEs: "Sintetizar evidencia clínica del documento.",
    studyDesignEs: "Estudio observacional.",
    studyContextEs: "Documento con evidencia científica suficiente.",
    studyPopulationEs: "Pacientes adultos.",
    studyLocationEs: "",
    studyPeriodEs: "",
    mainMessageEs: "Requiere ampliación editorial antes de publicarse como ficha final.",
    keyPointsEs: ["Objetivo", "Método", "Mensaje"],
    localApplicabilityEs: "Debe revisarse localmente.",
    occupationalHealthRelevanceEs: "",
    limitationsEs: "Descripción ampliada insuficiente.",
    methodologyProfile: methodologyProfileFixture(),
    tags: ["QA"],
    warnings: [],
    extractionConfidence: 0.8
  };
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    const content = body.messages.map((message) => message.content).join(" ");
    calls.push(/Regenerá una descripción editorial amplia|descripción ampliada insuficiente/i.test(content));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(shortArticle) } }] })
    };
  };

  const result = await resolveScientificArticleDocument(
    {
      mode: "pasted_text",
      pastedText:
        "Still short PDF\nJournal QA\nAbstract\nThis document has enough scientific text with methods, participants, results, discussion, limitations and conclusions for editorial extraction. ".repeat(35),
      pastedSource: "Journal QA",
      officialUrl: "https://doi.org/10.1111/still-short"
    },
    { uid: "user-a", user: { uid: "user-a" }, apiKey: "test-key", fetchImpl }
  );

  assert.equal(result.extractionStatus, "metadata_only");
  assert.equal(result.article.expandedDescriptionQuality, "insufficient");
  assert.equal(calls.some(Boolean), true);
  assert.equal(result.article.title, "Still short PDF");
  assert.equal(result.rawEvidence.expandedDescriptionQuality, "insufficient");
  assert.equal(result.rawEvidence.expandedDescriptionWordCount < 280, true);
  assert.equal(result.rawEvidence.expandedDescriptionRetryAttempted, true);
  assert.match(result.article.warnings.join(" "), /no pudo regenerar una descripción ampliada suficiente|descripción ampliada suficiente/i);
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
    briefDescriptionEs: "Ficha breve en español para revisión del equipo médico.",
    expandedDescriptionEs: expandedDescriptionTextFixture(),
    expandedDescriptionSections: expandedDescriptionSectionsFixture(),
    expandedDescriptionQuality: "complete",
    cardSummaryEs: "Ficha breve en español para revisión del equipo médico.",
    executiveSummaryEs: expandedDescriptionTextFixture(),
    objectiveEs: "Presentar un marco que fortalece la gestión de hipertensión en atención primaria.",
    studyDesignEs: "Síntesis documental de implementación regional.",
    studyContextEs: "Documento de implementación regional en atención primaria.",
    studyPopulationEs: "Equipos y sistemas de atención primaria.",
    studyLocationEs: "Américas.",
    studyPeriodEs: "",
    mainMessageEs: "El documento organiza indicadores y objetivos de calidad para atención primaria.",
    keyPointsEs: ["Calidad", "Atención primaria", "Gestión sanitaria"],
    limitationsEs: "No especifica resultados clínicos individuales.",
    localApplicabilityEs: "Requiere adaptación institucional.",
    occupationalHealthRelevanceEs: "Puede orientar gestión sanitaria poblacional.",
    methodologyProfile: methodologyProfileFixture(),
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
  assert.equal(result.article.executiveSummaryEs.includes("evidencia"), true);
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

test("document resolver keeps core ficha when advanced methodology extraction fails", async () => {
  const coreArticle = {
    title: "Core PDF title",
    sourceName: "Core Journal",
    journal: "Core Journal",
    authors: ["Autora Core"],
    officialUrl: "https://doi.org/10.5555/core",
    doi: "10.5555/core",
    publicationDate: "2026-05-04",
    originalLanguage: "en",
    articleType: "Artículo científico",
    evidenceType: "Revisión científica",
    accessType: "Open access",
    briefDescriptionEs: "Ficha breve en español con valor editorial para la tarjeta.",
    expandedDescriptionEs: expandedDescriptionTextFixture(),
    expandedDescriptionSections: expandedDescriptionSectionsFixture(),
    expandedDescriptionQuality: "complete",
    cardSummaryEs: "Ficha breve en español con valor editorial para la tarjeta.",
    executiveSummaryEs: expandedDescriptionTextFixture(),
    objectiveEs: "Sintetizar el propósito principal del documento científico aportado.",
    studyDesignEs: "Revisión científica.",
    studyContextEs: "Documento científico con resumen, métodos y conclusiones.",
    studyPopulationEs: "",
    studyLocationEs: "",
    studyPeriodEs: "2026",
    mainMessageEs: "La ficha core debe sobrevivir aunque falle la metodología avanzada.",
    keyPointsEs: ["Core", "Metodología opcional", "Resiliencia"],
    tags: ["Core", "PDF"],
    warnings: [],
    extractionConfidence: 0.78
  };
  let calls = 0;
  const fetchImpl = async (_url, options = {}) => {
    calls += 1;
    const body = JSON.parse(options.body || "{}");
    const prompt = (body.messages || []).map((message) => message.content || "").join("\n");
    if (/No completes metodología avanzada/i.test(prompt)) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(coreArticle) } }] })
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "incompleto" }) } }] })
    };
  };

  const result = await resolveScientificArticleDocument(
    {
      mode: "pasted_text",
      pastedText: "Core PDF title\nCore Journal\nAbstract\nThis document has enough scientific content, methods, results and conclusions for extraction. ".repeat(30),
      pastedSource: "Core Journal",
      officialUrl: "https://doi.org/10.5555/core"
    },
    { uid: "user-a", user: { uid: "user-a" }, apiKey: "test-key", fetchImpl }
  );

  assert.equal(result.extractionStatus, "ai_draft");
  assert.equal(result.article.title, "Core PDF title");
  assert.equal(result.article.doi, "10.5555/core");
  assert.match(result.article.warnings.join(" "), /metodología avanzada/i);
  assert.ok(calls >= 2);
});

test("document resolver preserves core ficha when methodology transport rejects", async () => {
  const coreArticle = {
    title: "Core survives transport error",
    sourceName: "Transport Journal",
    journal: "Transport Journal",
    authors: ["Equipo QA"],
    officialUrl: "https://doi.org/10.5555/transport",
    doi: "10.5555/transport",
    publicationDate: "2026-05-04",
    originalLanguage: "en",
    articleType: "Artículo científico",
    evidenceType: "Revisión científica",
    accessType: "Open access",
    briefDescriptionEs: "Ficha breve en español para confirmar que el core sobrevive.",
    expandedDescriptionEs: expandedDescriptionTextFixture(),
    expandedDescriptionSections: expandedDescriptionSectionsFixture(),
    expandedDescriptionQuality: "complete",
    cardSummaryEs: "Ficha breve en español para confirmar que el core sobrevive.",
    executiveSummaryEs: expandedDescriptionTextFixture(),
    objectiveEs: "Validar resiliencia del análisis documental ante fallos parciales.",
    studyDesignEs: "Revisión científica.",
    studyContextEs: "Documento con contenido suficiente para extracción editorial.",
    studyPopulationEs: "Población documental indicada por el texto de prueba.",
    studyLocationEs: "Contexto QA.",
    studyPeriodEs: "2026",
    mainMessageEs: "La falla metodológica no debe impedir guardar la ficha.",
    keyPointsEs: ["Core completo", "Fallo metodológico aislado", "Guardado posible"],
    tags: ["Core", "Resiliencia"],
    warnings: [],
    extractionConfidence: 0.82
  };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(coreArticle) } }] })
      };
    }
    throw new Error("methodology transport down");
  };

  const result = await resolveScientificArticleDocument(
    {
      mode: "pasted_text",
      pastedText: "Core transport title\nTransport Journal\nAbstract\nThis document has enough scientific content, methods, results and conclusions for extraction. ".repeat(30),
      pastedSource: "Transport Journal",
      officialUrl: "https://doi.org/10.5555/transport"
    },
    { uid: "user-a", user: { uid: "user-a" }, apiKey: "test-key", fetchImpl }
  );

  assert.equal(result.extractionStatus, "ai_draft");
  assert.equal(result.article.title, "Core survives transport error");
  assert.equal(result.article.expandedDescriptionQuality, "complete");
  assert.match(result.article.warnings.join(" "), /metodología avanzada/i);
  assert.equal(Number(result.rawEvidence.agentDurations.methodologyAiMs) >= 0, true);
  assert.ok(calls >= 2);
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
    briefDescriptionEs: "Resumen breve en español para validar el fallback.",
    expandedDescriptionEs: expandedDescriptionTextFixture(),
    expandedDescriptionSections: expandedDescriptionSectionsFixture(),
    expandedDescriptionQuality: "complete",
    cardSummaryEs: "Resumen breve en español para validar el fallback.",
    executiveSummaryEs: expandedDescriptionTextFixture(),
    objectiveEs: "Validar el funcionamiento del modelo documental secundario.",
    studyDesignEs: "Prueba de fallback con structured outputs.",
    studyContextEs: "Documento de prueba con evidencia textual suficiente.",
    studyPopulationEs: "",
    studyLocationEs: "",
    studyPeriodEs: "2026",
    mainMessageEs: "El sistema puede continuar si falla el modelo configurado.",
    keyPointsEs: ["Fallback", "Structured outputs", "Validación"],
    localApplicabilityEs: "",
    occupationalHealthRelevanceEs: "",
    limitationsEs: "",
    methodologyProfile: methodologyProfileFixture({ studyFamily: "evidence_synthesis", studyFamilyEs: "Síntesis de evidencia", specificDesign: "Revisión", designCategoryEs: "Revisión" }),
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
    briefDescriptionEs: "Resumen breve en español para la tarjeta científica.",
    expandedDescriptionEs: expandedDescriptionTextFixture(),
    expandedDescriptionSections: expandedDescriptionSectionsFixture(),
    expandedDescriptionQuality: "complete",
    cardSummaryEs: "Resumen breve en español para la tarjeta científica.",
    executiveSummaryEs: expandedDescriptionTextFixture(),
    objectiveEs: "Describir qué propósito científico aborda el documento.",
    studyDesignEs: "Metodología descrita en el documento.",
    studyContextEs: "Documento con resumen, metodología, resultados y conclusiones.",
    studyPopulationEs: "",
    studyLocationEs: "",
    studyPeriodEs: "2026",
    mainMessageEs: "Mensaje principal derivado del texto aportado.",
    keyPointsEs: ["Punto clave uno", "Punto clave dos", "Punto clave tres"],
    limitationsEs: "",
    localApplicabilityEs: "",
    occupationalHealthRelevanceEs: "",
    methodologyProfile: methodologyProfileFixture({ studyFamily: "evidence_synthesis", studyFamilyEs: "Síntesis de evidencia", specificDesign: "Revisión", designCategoryEs: "Revisión" }),
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
  assert.match(pasted.article.executiveSummaryEs, /evidencia|documento/i);
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
