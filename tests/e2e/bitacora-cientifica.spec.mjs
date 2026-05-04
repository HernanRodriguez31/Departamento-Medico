import { expect, test } from "@playwright/test";

const QA_EMAIL = process.env.MOBILE_QA_EMAIL || "mobile.qa@departamento-medico.test";
const QA_PASSWORD = process.env.MOBILE_QA_PASSWORD || "MobileQa!12345";
const LOGIN_URL = `/login.html?dmEmulators=1&next=${encodeURIComponent("/bitacora-cientifica")}`;

const submitLogin = async (page) => {
  await page.locator("#email").fill(QA_EMAIL);
  await page.locator("#password").fill(QA_PASSWORD);
  await page.locator("#login-form").evaluate((form) => form.requestSubmit());
};

const expectNoHorizontalOverflow = async (page) => {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
  expect(overflow).toBeLessThanOrEqual(2);
};

test("scientific logbook renders as operational hub with modals and article creation", async ({ page }, testInfo) => {
  const articleTitle = `Artículo QA Bitácora ${testInfo.project.name}`;
  const extractionRequests = [];
  const documentExtractionRequests = [];
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.route("**/api/extractScientificArticleDocument", async (route) => {
    const request = route.request();
    const payload = request.postDataJSON();
    documentExtractionRequests.push({
      mode: payload?.mode || "",
      storagePath: payload?.storagePath || "",
      pastedText: payload?.pastedText || "",
      authorization: request.headers().authorization || ""
    });
    const isTextMode = payload?.mode === "pasted_text";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        extractionStatus: "ai_draft",
        article: {
          title: isTextMode ? "Texto QA traducido" : "PDF QA Bitácora",
          sourceName: isTextMode ? payload.pastedSource || "Revista Texto" : "Revista PDF",
          journal: isTextMode ? payload.pastedSource || "Revista Texto" : "Revista PDF",
          authors: ["Equipo QA"],
          officialUrl: payload.officialUrl || "",
          doi: "10.1000/documento",
          publicationDate: "2026-05-04",
          originalLanguage: "en",
          articleType: "Artículo científico",
          studyType: "Revisión narrativa",
          evidenceType: "Revisión científica",
          accessType: "Pendiente",
          cardSummaryEs: isTextMode
            ? "Resumen breve en español desde texto pegado."
            : "Resumen breve en español desde PDF.",
          executiveSummaryEs: isTextMode
            ? "Resumen ejecutivo en español generado desde texto pegado."
            : "Resumen ejecutivo en español generado desde PDF.",
          abstractSummaryEs: "Abstract sintetizado y traducido al español.",
          clinicalQuestionEs: "Pregunta científica sintetizada en español.",
          mainResultEs: "Resultado o mensaje principal en español.",
          methodologyEs: "Metodología resumida en español.",
          keyPointsEs: ["Punto clave uno", "Punto clave dos"],
          limitationsEs: "Limitaciones sintetizadas en español.",
          localApplicabilityEs: "Aplicabilidad local para revisión del equipo.",
          occupationalHealthRelevanceEs: "Relevancia para salud ocupacional y gestión sanitaria.",
          tags: ["PDF", "IA", "Revisión", "QA", "Documento"],
          sourcePages: [{ field: "executiveSummaryEs", pages: [1] }],
          extractionConfidence: 0.86,
          warnings: ["Revisión humana obligatoria antes de publicar."]
        },
        rawEvidence: {
          mode: payload?.mode || "pdf",
          originalFileName: payload?.originalFileName || "",
          detectedLanguage: "en",
          pageCount: payload?.mode === "pdf" ? 4 : 0,
          textLength: payload?.mode === "pasted_text" ? payload.pastedText.length : 5600,
          contentHash: "b".repeat(64),
          storagePath: payload?.storagePath || "",
          detectedFields: ["title", "doi", "sourceName"],
          extractedSections: ["Abstract", "Methods", "Results"],
          qualitySignals: { hasTitle: true, hasAbstractOrSummary: true }
        }
      })
    });
  });
  await page.route("**/api/extractScientificArticle", async (route) => {
    const request = route.request();
    const payload = request.postDataJSON();
    extractionRequests.push({
      url: payload?.url || "",
      pastedAbstract: payload?.pastedAbstract || "",
      authorization: request.headers().authorization || ""
    });
    if (payload?.pastedAbstract) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          extractionStatus: "ai_draft",
          article: {
            title: payload.pastedTitle || "Artículo asistido",
            sourceName: payload.pastedSource || "Fuente asistida",
            officialUrl: payload.url,
            sourceDomain: "example.org",
            doi: payload.doi || "",
            pmid: payload.pmid || "",
            pmcid: payload.pmcid || "",
            nctId: "",
            pii: "",
            studyType: "Revisión narrativa",
            evidenceType: "Artículo científico",
            publicationDate: "2026-05-04",
            studyLocation: "Contexto asistido",
            executiveSummary: "Resumen asistido en español desde datos pegados.",
            clinicalQuestion: "Pregunta asistida en español.",
            mainResult: "Resultado asistido en español.",
            tags: ["Asistido", "IA"],
            accessType: "Resumen disponible",
            extractionConfidence: 0.74,
            warnings: ["Parte de la evidencia fue aportada manualmente por el usuario."]
          },
          rawEvidence: {
            attemptedResolvers: ["manual_evidence"],
            successfulResolvers: ["manual_evidence"],
            failedResolvers: [],
            blockedResolvers: [],
            metadataFieldsDetected: ["manual_evidence.abstract"],
            scientificTextLength: payload.pastedAbstract.length,
            identifiersDetected: { doi: payload.doi || "", pmid: payload.pmid || "", pmcid: payload.pmcid || "", nctId: "", pii: "" }
          }
        })
      });
      return;
    }
    if (payload?.url === "https://example.org/partial") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          extractionStatus: "metadata_only",
          article: {
            sourceName: "Revista parcial",
            officialUrl: "https://example.org/partial",
            sourceDomain: "example.org",
            doi: "",
            pmid: "",
            pmcid: "",
            nctId: "",
            pii: "",
            warnings: ["Solo se detectaron metadatos básicos. Completá el resto manualmente."]
          }
        })
      });
      return;
    }
    if (payload?.url === "https://example.org/auth") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: {
            code: "auth_required",
            message: "Necesitás iniciar sesión para analizar enlaces."
          }
        })
      });
      return;
    }
    if (payload?.url === "https://example.org/failed") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          extractionStatus: "failed",
          article: {
            title: "",
            sourceName: "",
            officialUrl: "https://example.org/failed",
            sourceDomain: "example.org",
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
            warnings: [
              "El sitio limita el acceso al contenido público. Se extrajeron solo metadatos disponibles.",
              "La fuente respondió HTTP 403."
            ]
          },
          rawEvidence: {
            attemptedResolvers: ["publisher_html", "pubmed"],
            successfulResolvers: [],
            failedResolvers: ["pubmed"],
            blockedResolvers: ["publisher_html"],
            metadataFieldsDetected: [],
            scientificTextLength: 0,
            identifiersDetected: { doi: "", pmid: "", pmcid: "", nctId: "", pii: "" }
          }
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        extractionStatus: "ai_draft",
        article: {
          title: articleTitle,
          sourceName: "PubMed / MEDLINE",
          officialUrl: "https://pubmed.ncbi.nlm.nih.gov/123456/",
          sourceDomain: "pubmed.ncbi.nlm.nih.gov",
          doi: "10.1000/qa",
          pmid: "123456",
          pmcid: "",
          nctId: "",
          pii: "",
          studyType: "Ensayo clínico",
          evidenceType: "Investigación clínica",
          publicationDate: "2026-05-03",
          studyLocation: "Contexto hospitalario",
          executiveSummary: "Resumen generado por IA desde Playwright.",
          clinicalQuestion: "Pregunta clínica generada por IA.",
          mainResult: "Resultado principal generado por IA.",
          tags: ["QA", "Lectura crítica", "PubMed", "IA"],
          accessType: "Resumen disponible",
          extractionConfidence: 0.82,
          warnings: ["Revisar antes de guardar."]
        }
      })
    });
  });

  await page.goto(LOGIN_URL);
  await expect(page.locator("#login-form")).toBeVisible();
  await submitLogin(page);
  await page.waitForURL(/\/bitacora-cientifica\?dmEmulators=1$/, { timeout: 30_000 });

  await expect(page.locator("body")).toHaveClass(/art-gallery-page/);
  await expect(page.locator("body")).toHaveClass(/bitacora-page/);
  await expect(page.locator(".art-gallery-header")).toBeVisible();
  await expect(page.locator(".art-gallery-header__logo img[alt='Brisa Salud y Bienestar']")).toBeVisible();
  await expect(page.locator(".art-gallery-header__brand")).toHaveText("Departamento Médico");
  await expect(page.locator(".footer")).toHaveCount(1);
  await expect(page.locator("#scroll-up")).toHaveCount(1);
  await expect(page.locator("#art-gallery-return-home")).toHaveText("Regresar a Página de Inicio");
  await expect(page.locator("#art-gallery-return-home svg.lucide-arrow-left")).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator("#art-gallery-return-home").evaluate((link) => {
        const url = new URL(link.href);
        return `${url.pathname}${url.search}`;
      }),
    )
    .toBe("/index.html?dmEmulators=1");

  const bodyBackground = await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundImage);
  expect(bodyBackground).not.toBe("none");

  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("#bitacora-heading")).toHaveText("Bitácora Científica");
  await expect(page.locator(".bitacora-intro-segment")).toHaveCount(1);
  await expect(page.locator(".bitacora-publications-segment")).toHaveCount(1);
  await expect(page.locator(".bitacora-breadcrumb")).toHaveText("Portal");
  await expect(page.locator(".bitacora-intro-segment")).not.toContainText("Evidencia médica curada");
  await expect(page.locator(".bitacora-intro-segment")).not.toContainText("Centralización de publicaciones");
  const sourcesTrigger = page.getByRole("button", { name: "Fuentes recomendadas" });
  await expect(sourcesTrigger).toBeVisible();
  await expect(page.locator(".bitacora-publications-panel")).toBeVisible();
  await expect(page.locator(".bitacora-publications-panel")).toHaveCSS("background-color", /rgba?|rgb/);
  await expect(page.locator("#bitacora-publicaciones-title")).toHaveText("Publicaciones científicas");
  await expect(page.getByRole("button", { name: "Agregar artículo" })).toBeVisible();
  await expect(page.locator(".bitacora-filters-card")).toHaveCount(0);
  await expect(page.locator("#bitacora-search")).toHaveCount(0);
  await expect(page.locator("#bitacora-filter-evidence")).toHaveCount(0);
  await expect(page.locator("#bitacora-reset")).toHaveCount(0);
  await expect(page.locator(".bitacora-publications-panel")).not.toContainText("Los preprints");

  await expect(page.locator(".bitacora-editorial-model")).toHaveCount(0);
  await expect(page.locator(".bitacora-value-strip")).toHaveCount(0);
  await expect(page.locator(".bitacora-anchor-nav")).toHaveCount(0);
  await expect(page.getByText("Modelo editorial")).toHaveCount(0);
  await expect(page.getByText("Criterio editorial")).toHaveCount(0);
  await expect(page.getByText("Cómo leer cada entrada")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Advertencia sobre preprints y evidencia");
  await expect(page.locator(".scientific-source-card:visible")).toHaveCount(0);

  await expect.poll(() => page.locator(".bitacora-post").count(), { timeout: 30_000 }).toBe(1);
  await expect(page.locator("#bitacora-results-count")).toHaveText("0 artículos agregados");
  await expect(page.locator(".bitacora-post").first()).toHaveCSS("background-color", /rgba?|rgb/);
  await expect(page.locator(".bitacora-post").first()).toContainText("Ejemplo de artículo científico");
  await page.getByRole("button", { name: "Quitar ejemplo" }).click();
  await expect(page.locator(".bitacora-post")).toHaveCount(0);
  await expect(page.locator("#bitacora-empty")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await sourcesTrigger.click();
  const sourcesModal = page.locator("#scientific-sources-modal");
  await expect(sourcesModal).toBeVisible();
  await expect(sourcesModal.getByRole("dialog")).toBeVisible();
  const internationalToggle = sourcesModal.getByRole("button", { name: /Fuentes Internacionales/ });
  const nationalToggle = sourcesModal.getByRole("button", { name: /Fuentes Nacionales/ });
  await expect(internationalToggle).toHaveAttribute("aria-pressed", "true");
  await expect(nationalToggle).toHaveAttribute("aria-pressed", "false");
  const sourceCards = sourcesModal.locator(".scientific-source-card");
  await expect(sourceCards).toHaveCount(15);
  await expect(sourcesModal.locator('.scientific-source-card[data-source-scope="international"]')).toHaveCount(15);
  await expect(sourcesModal.locator(".scientific-source-logo")).toHaveCount(15);
  await expect(sourcesModal.locator(".scientific-sources-segmented [data-source-scope]")).toHaveCount(2);
  await expect(sourcesModal.locator("[data-source-group]")).toHaveCount(0);
  await expect(sourcesModal.locator(".scientific-sources-toolbar")).toHaveCount(0);
  for (const label of [
    "Todas",
    "Bases",
    "Evidencia secundaria",
    "Revistas",
    "Open access",
    "Regionales",
    "Salud ocupacional",
    "Argentina",
    "Epidemiología",
    "Bases nacionales",
    "Evidencia sanitaria",
    "Investigación nacional",
    "Revistas argentinas",
    "Sociedades argentinas"
  ]) {
    await expect(sourcesModal.getByRole("button", { name: label })).toHaveCount(0);
  }
  await expect(sourcesModal.getByText("Visitar")).toHaveCount(0);
  await expect(sourcesModal.locator('a.scientific-source-card[target="_blank"][rel="noopener noreferrer"]')).toHaveCount(15);
  await expect(sourcesModal.locator(".scientific-source-card__external-icon svg")).toHaveCount(15);
  await expect(sourceCards.first()).toHaveAttribute("aria-label", /Abrir .* en una pestaña nueva/);
  const logoShape = await sourcesModal.locator(".scientific-source-logo").first().evaluate((node) => {
    const styles = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      radius: styles.borderRadius
    };
  });
  expect(logoShape.width).toBe(48);
  expect(logoShape.height).toBe(48);
  expect(logoShape.radius).toBe("999px");
  await expect(sourcesModal.locator('.scientific-source-logo img[src="/assets/images/BMJ.png"]')).toHaveCount(1);
  await expect(sourcesModal.locator('.scientific-source-logo img[src="/assets/images/Lancet.png"]')).toHaveCount(1);
  await expect(sourcesModal.locator('.scientific-source-logo img[src="/assets/images/LILACS.png"]')).toHaveCount(1);
  await expect(sourcesModal.locator('.scientific-source-logo img[src="/assets/images/Mayo Clinic.png"]')).toHaveCount(1);
  await expect(sourcesModal.locator('.scientific-source-logo img[src="/assets/images/Scielo.png"]')).toHaveCount(1);
  const logoWidth = async (id) =>
    sourcesModal
      .locator(`.scientific-source-card[data-source-id="${id}"] .scientific-source-logo img`)
      .evaluate((node) => Math.round(node.getBoundingClientRect().width));
  expect(await logoWidth("pubmed")).toBeLessThanOrEqual(36);
  expect(await logoWidth("pmc")).toBeLessThanOrEqual(36);
  expect(await logoWidth("sciencedirect")).toBeLessThanOrEqual(36);
  expect(await logoWidth("mayo-clinic-proceedings")).toBeGreaterThanOrEqual(52);
  expect(await logoWidth("scielo")).toBeGreaterThanOrEqual(52);
  const titleLayout = await sourceCards.filter({ hasText: "Mayo Clinic Proceedings" }).locator("h3").evaluate((node) => {
    const styles = getComputedStyle(node);
    return {
      text: node.textContent?.trim(),
      whiteSpace: styles.whiteSpace,
      textOverflow: styles.textOverflow,
      lines: Math.round(node.getBoundingClientRect().height / parseFloat(styles.lineHeight))
    };
  });
  expect(titleLayout.text).toBe("Mayo Clinic Proceedings");
  expect(titleLayout.whiteSpace).toBe("normal");
  expect(titleLayout.textOverflow).toBe("clip");
  expect(titleLayout.lines).toBeLessThanOrEqual(2);

  await sourcesModal.getByLabel("Buscar fuente").fill("SciELO");
  await expect(sourcesModal.locator(".scientific-source-card")).toHaveCount(1);
  await expect(sourcesModal.locator(".scientific-source-card")).toContainText("SciELO");
  await sourcesModal.getByLabel("Buscar fuente").fill("");
  await expect(sourcesModal.locator(".scientific-source-card")).toHaveCount(15);

  await nationalToggle.click();
  await expect(nationalToggle).toHaveAttribute("aria-pressed", "true");
  await expect(internationalToggle).toHaveAttribute("aria-pressed", "false");
  await expect(sourcesModal.locator(".scientific-source-card")).toHaveCount(15);
  await expect(sourcesModal.locator('.scientific-source-card[data-source-scope="national"]')).toHaveCount(15);
  await expect(sourcesModal.locator(".scientific-source-logo")).toHaveCount(15);
  await expect(sourcesModal.locator('a.scientific-source-card[target="_blank"][rel="noopener noreferrer"]')).toHaveCount(15);
  await expect(sourcesModal.locator("[data-source-group]")).toHaveCount(0);
  await expect(sourcesModal.locator('.scientific-source-card[data-source-id="srt"]')).toHaveAttribute(
    "href",
    "https://www.argentina.gob.ar/srt"
  );
  await expect(sourcesModal.locator('.scientific-source-card[data-source-id="conetec"]')).toHaveAttribute(
    "href",
    "https://www.argentina.gob.ar/salud/conetec"
  );
  await expect(
    sourcesModal.locator('.scientific-source-card[data-source-id="medicina-buenos-aires"] .scientific-source-logo img')
  ).toHaveAttribute("src", "/assets/images/Rev%20Arg%20Medicina.png");
  await expect(
    sourcesModal.locator('.scientific-source-card[data-source-id="ramr"] .scientific-source-logo img')
  ).toHaveAttribute("src", "/assets/images/RAMR.png");
  await expect(
    sourcesModal.locator('.scientific-source-card[data-source-id="medicina-buenos-aires"] .scientific-source-logo')
  ).not.toHaveClass(/is-logo-fallback/);
  await expect(
    sourcesModal.locator('.scientific-source-card[data-source-id="ramr"] .scientific-source-logo')
  ).not.toHaveClass(/is-logo-fallback/);
  expect(await logoWidth("medicina-buenos-aires")).toBeGreaterThanOrEqual(48);
  const ramrLogoWidth = await logoWidth("ramr");
  expect(ramrLogoWidth).toBeGreaterThanOrEqual(48);
  expect(ramrLogoWidth).toBeLessThanOrEqual(52);
  for (const name of [
    "Ministerio de Salud",
    "CONETEC",
    "ANMAT",
    "Boletín Epidemiológico Nacional",
    "SRT",
    "Medicina (Buenos Aires)",
    "SADI"
  ]) {
    await expect(sourcesModal.locator(".scientific-source-card").filter({ hasText: name })).toHaveCount(1);
  }
  await sourcesModal.getByLabel("Buscar fuente").fill("SADI");
  await expect(sourcesModal.locator(".scientific-source-card")).toHaveCount(1);
  await expect(sourcesModal.locator(".scientific-source-card")).toContainText("SADI");
  await sourcesModal.getByLabel("Buscar fuente").fill("");
  await expect(sourcesModal.locator(".scientific-source-card")).toHaveCount(15);
  await sourcesModal.locator(".scientific-sources-directory").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const lastSourceCardIsFullyVisible = await sourcesModal.locator(".scientific-source-card").last().evaluate((node) => {
    const cardRect = node.getBoundingClientRect();
    const directoryRect = node.closest(".scientific-sources-directory").getBoundingClientRect();
    return cardRect.top >= directoryRect.top - 1 && cardRect.bottom <= directoryRect.bottom + 1;
  });
  expect(lastSourceCardIsFullyVisible).toBe(true);

  await internationalToggle.click();
  await expect(internationalToggle).toHaveAttribute("aria-pressed", "true");
  await expect(nationalToggle).toHaveAttribute("aria-pressed", "false");
  await expect(sourcesModal.locator(".scientific-source-card")).toHaveCount(15);
  await page.keyboard.press("Escape");
  await expect(sourcesModal).toBeHidden();

  await sourcesTrigger.click();
  await expect(sourcesModal).toBeVisible();
  await sourcesModal.getByRole("button", { name: "Cerrar" }).click();
  await expect(sourcesModal).toBeHidden();

  await page.getByRole("button", { name: "Agregar artículo" }).click();
  const articleModal = page.locator("#add-article-modal");
  await expect(articleModal).toBeVisible();
  await expect(articleModal.getByRole("dialog")).toBeVisible();
  await expect(articleModal.getByRole("tab", { name: "Desde PDF" })).toBeVisible();
  await expect(articleModal.getByRole("tab", { name: "Texto pegado" })).toBeVisible();
  await expect(articleModal.getByRole("tab", { name: "Datos manuales" })).toBeVisible();
  await expect(articleModal).toContainText("Cargado por");
  await expect(articleModal).toContainText("Pendiente de revisión");

  const saveArticleButton = articleModal.getByRole("button", { name: "Guardar artículo" });
  await expect(saveArticleButton).toBeVisible();
  await articleModal.locator(".bitacora-article-form__body").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(saveArticleButton).toBeVisible();
  const saveButtonInsideModal = await saveArticleButton.evaluate((button) => {
    const buttonRect = button.getBoundingClientRect();
    const dialogRect = button.closest(".bitacora-modal__dialog").getBoundingClientRect();
    return buttonRect.top >= dialogRect.top && buttonRect.bottom <= dialogRect.bottom;
  });
  expect(saveButtonInsideModal).toBe(true);

  await articleModal.getByRole("button", { name: "Guardar como borrador" }).click();
  await expect(articleModal).toBeHidden({ timeout: 30_000 });
  const incompleteDraft = page.locator(".bitacora-post").filter({ hasText: "Borrador científico sin título" }).first();
  await expect(incompleteDraft).toBeVisible({ timeout: 30_000 });
  await expect(incompleteDraft).toContainText("Borrador incompleto");
  page.once("dialog", (dialog) => dialog.accept());
  await incompleteDraft.getByRole("button", { name: "Eliminar" }).click();
  await expect(page.locator(".bitacora-post")).toHaveCount(0);

  await page.getByRole("button", { name: "Agregar artículo" }).click();
  await expect(articleModal).toBeVisible();

  await articleModal.locator("#article-pdf-input").setInputFiles({
    name: "paper-qa.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF")
  });
  await expect(articleModal.locator("#article-pdf-file")).toBeVisible();
  await expect(articleModal.locator("#article-pdf-name")).toHaveText("paper-qa.pdf");
  await articleModal.getByRole("button", { name: "Analizar PDF con IA" }).click();
  await expect(articleModal.locator("#article-ai-status")).toContainText("Ficha generada por IA", {
    timeout: 30_000
  });
  await expect(articleModal.getByLabel("Título")).toHaveValue("PDF QA Bitácora");
  await expect(articleModal.getByLabel("Resumen breve para tarjeta")).toHaveValue("Resumen breve en español desde PDF.");
  await expect(articleModal.getByLabel("Resumen ejecutivo")).toHaveValue("Resumen ejecutivo en español generado desde PDF.");
  await saveArticleButton.click();
  await expect(articleModal).toBeHidden({ timeout: 30_000 });

  const pdfPost = page.locator(".bitacora-post").filter({ hasText: "PDF QA Bitácora" }).first();
  await expect(pdfPost).toBeVisible({ timeout: 30_000 });
  await expect(pdfPost).toContainText("PDF");
  await expect(pdfPost).toContainText("Resumen breve en español desde PDF.");
  await expect(pdfPost.getByRole("button", { name: "Ver PDF" })).toBeVisible();
  await pdfPost.getByRole("button", { name: "Leer análisis" }).click();
  await expect(pdfPost.locator(".bitacora-analysis")).toContainText("Abstract sintetizado y traducido al español.");
  page.once("dialog", (dialog) => dialog.accept());
  await pdfPost.getByRole("button", { name: "Eliminar" }).click();
  await expect(page.locator(".bitacora-post")).toHaveCount(0);

  await page.getByRole("button", { name: "Agregar artículo" }).click();
  await expect(articleModal).toBeVisible();
  await articleModal.getByRole("tab", { name: "Texto pegado" }).click();
  const pastedText =
    "Title from pasted text. Abstract. This scientific document includes methods, results, discussion and conclusions for review. ".repeat(8);
  await articleModal.getByLabel("Texto del artículo o documento").fill(pastedText);
  await articleModal.locator("#article-pasted-source").fill("Revista Texto QA");
  await articleModal.getByRole("button", { name: "Analizar texto con IA" }).click();
  await expect(articleModal.locator("#article-ai-status")).toContainText("Ficha generada por IA", {
    timeout: 30_000
  });
  await expect(articleModal.getByLabel("Título")).toHaveValue("Texto QA traducido");
  await expect(articleModal.getByLabel("Resumen ejecutivo")).toHaveValue("Resumen ejecutivo en español generado desde texto pegado.");
  await articleModal.getByRole("button", { name: "Guardar como borrador" }).click();
  await expect(articleModal).toBeHidden({ timeout: 30_000 });
  const textDraft = page.locator(".bitacora-post").filter({ hasText: "Texto QA traducido" }).first();
  await expect(textDraft).toBeVisible({ timeout: 30_000 });
  await expect(textDraft).toContainText("Texto pegado");
  page.once("dialog", (dialog) => dialog.accept());
  await textDraft.getByRole("button", { name: "Eliminar" }).click();
  await expect(page.locator(".bitacora-post")).toHaveCount(0);

  await page.getByRole("button", { name: "Agregar artículo" }).click();
  await expect(articleModal).toBeVisible();
  await articleModal.getByRole("tab", { name: "Datos manuales" }).click();
  await expect(articleModal.getByLabel("URL del artículo o paper")).toBeVisible();

  await articleModal.getByLabel("URL del artículo o paper").fill("javascript:alert(1)");
  await articleModal.getByRole("button", { name: "Analizar enlace con IA" }).click();
  await expect(articleModal.locator("#article-url-error")).toContainText("URL", { timeout: 10_000 });

  await articleModal.getByLabel("URL del artículo o paper").fill("https://example.org/partial");
  await articleModal.getByRole("button", { name: "Analizar enlace con IA" }).click();
  await expect(articleModal.locator("#article-ai-status")).not.toContainText("Datos cargados por IA", {
    timeout: 10_000
  });
  await expect(articleModal.locator("#article-ai-status")).toContainText("Se detectaron metadatos básicos");
  await expect(articleModal.locator("#article-source-name")).toHaveValue("Revista parcial");
  await expect(articleModal.getByLabel("Título")).toHaveValue("");
  await saveArticleButton.click();
  await expect(articleModal.locator("#article-form-error")).toContainText("Ingresá el título");
  await expect(page.locator(".bitacora-post")).toHaveCount(0);
  await expect(page.locator("#bitacora-results-count")).toHaveText("0 artículos agregados");

  await articleModal.getByLabel("URL del artículo o paper").fill("https://example.org/auth");
  await articleModal.getByRole("button", { name: "Analizar enlace con IA" }).click();
  await expect(articleModal.locator("#article-ai-status")).toContainText("Necesitás iniciar sesión para analizar enlaces.", {
    timeout: 10_000
  });

  await articleModal.getByLabel("Título").fill("Título manual preservado");
  await articleModal.getByLabel("URL del artículo o paper").fill("https://example.org/failed");
  await articleModal.getByRole("button", { name: "Analizar enlace con IA" }).click();
  await expect(articleModal.locator("#article-ai-status")).toContainText("No se pudo extraer información suficiente", {
    timeout: 10_000
  });
  await expect(articleModal.getByLabel("Título")).toHaveValue("Título manual preservado");
  await articleModal.getByLabel("URL del artículo o paper").fill("https://pubmed.ncbi.nlm.nih.gov/123456/");
  await expect(articleModal.locator("#article-domain-detected")).toContainText("pubmed.ncbi.nlm.nih.gov");
  await articleModal.getByRole("button", { name: "Analizar enlace con IA" }).click();
  await expect(articleModal.locator("#article-ai-status")).toContainText("Borrador cargado por IA", {
    timeout: 30_000
  });
  await expect(articleModal.getByLabel("Título")).toHaveValue(articleTitle);
  await expect(articleModal.locator("#article-source-name")).toHaveValue("PubMed / MEDLINE");
  await expect(articleModal.getByLabel("Tipo de estudio")).toHaveValue("Ensayo clínico");
  await expect(articleModal.getByLabel("Tipo de evidencia")).toHaveValue("Investigación clínica");
  await expect(articleModal.getByLabel("Fecha de publicación")).toHaveValue("2026-05-03");
  await expect(articleModal.getByLabel("Pregunta que busca responder")).toHaveValue("Pregunta clínica generada por IA.");
  await expect(articleModal.getByLabel("Resultado o mensaje principal")).toHaveValue("Resultado principal generado por IA.");
  await expect(articleModal.getByLabel("Etiquetas")).toHaveValue("QA, Lectura crítica, PubMed, IA");
  await expect(articleModal.getByLabel("Acceso")).toHaveValue("Resumen disponible");
  await expect(articleModal.getByLabel("Resumen ejecutivo")).toHaveValue("Resumen generado por IA desde Playwright.");
  expect(documentExtractionRequests).toHaveLength(2);
  expect(documentExtractionRequests[0].mode).toBe("pdf");
  expect(documentExtractionRequests[0].storagePath).toMatch(/^bitacora\/article-documents\/.+\/.+paper-qa\.pdf$/);
  expect(documentExtractionRequests[1].mode).toBe("pasted_text");
  expect(documentExtractionRequests[1].pastedText).toContain("Title from pasted text");
  expect(documentExtractionRequests.every((entry) => /^Bearer\s+/.test(entry.authorization))).toBe(true);
  expect(extractionRequests).toHaveLength(4);
  expect(extractionRequests[0].url).toBe("https://example.org/partial");
  expect(extractionRequests[1].url).toBe("https://example.org/auth");
  expect(extractionRequests[2].url).toBe("https://example.org/failed");
  expect(extractionRequests[3].url).toBe("https://pubmed.ncbi.nlm.nih.gov/123456/");
  expect(extractionRequests.every((entry) => /^Bearer\s+/.test(entry.authorization))).toBe(true);
  await articleModal.getByLabel("Comentario breve del usuario").fill("Comentario interno de prueba.");
  await saveArticleButton.click();
  await expect(articleModal).toBeHidden({ timeout: 30_000 });

  const newPost = page.locator(".bitacora-post").filter({ hasText: articleTitle }).first();
  await expect(newPost).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".bitacora-post")).toHaveCount(1);
  await expect(page.locator("#bitacora-results-count")).toHaveText("1 artículo agregado");
  await expect(newPost).toContainText("Pendiente de revisión");
  await expect(newPost).toContainText("Borrador automático");
  await expect(newPost).toContainText("Dra. Mobile QA");
  await expect(newPost).toContainText("Resumen generado por IA desde Playwright.");
  await expect(newPost.locator(".bitacora-tag")).toHaveCount(4);
  await expect(newPost.getByRole("link", { name: "Ver fuente original" })).toHaveAttribute(
    "href",
    "https://pubmed.ncbi.nlm.nih.gov/123456/"
  );
  await expect(newPost.getByRole("link", { name: "Ver fuente original" })).toHaveAttribute("target", "_blank");

  await newPost.getByRole("button", { name: "Leer análisis" }).click();
  await expect(newPost.getByRole("button", { name: "Ocultar análisis" })).toHaveAttribute("aria-expanded", "true");
  await expect(newPost.locator(".bitacora-analysis")).toBeVisible();
  await expect(newPost.locator(".bitacora-analysis")).toContainText("Pregunta clínica generada por IA.");
  await newPost.getByRole("button", { name: "Ocultar análisis" }).click();
  await expect(newPost.getByRole("button", { name: "Leer análisis" })).toHaveAttribute("aria-expanded", "false");
  await expect(newPost.locator(".bitacora-analysis")).toBeHidden();

  page.once("dialog", (dialog) => dialog.accept());
  await newPost.getByRole("button", { name: "Eliminar" }).click();
  await expect(page.locator(".bitacora-post")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(articleTitle);
  await expect(page.locator("#bitacora-empty")).toBeVisible();
  await expect(page.locator("#bitacora-results-count")).toHaveText("0 artículos agregados");

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const reachedScrollThreshold = await page.evaluate(() => window.scrollY > 420);
  if (reachedScrollThreshold) {
    await expect(page.locator("#scroll-up")).toHaveClass(/show-scroll/);
    await page.locator("#scroll-up").click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(20);
  }
  await expectNoHorizontalOverflow(page);

  if ((page.viewportSize()?.width || 0) >= 1024) {
    await page.goto("/index.html?dmEmulators=1");
    await expect(page.locator("#portal-logbook")).toHaveAttribute("href", "/bitacora-cientifica");
  }

  const criticalErrors = consoleErrors.filter(
    (text) =>
      !/favicon|ResizeObserver loop|net::ERR_ABORTED|Could not reach Cloud Firestore backend|Failed to load resource|404|500|OPENAI_API_KEY/i.test(
        text
      )
  );
  expect(criticalErrors).toEqual([]);
});
