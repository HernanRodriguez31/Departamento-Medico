import { expect, test } from "@playwright/test";

const QA_EMAIL = process.env.MOBILE_QA_EMAIL || "mobile.qa@departamento-medico.test";
const QA_PASSWORD = process.env.MOBILE_QA_PASSWORD || "MobileQa!12345";
const LOGIN_URL = `/login.html?dmEmulators=1&next=${encodeURIComponent("/bitacora-cientifica")}`;

const submitLogin = async (page, email = QA_EMAIL, password = QA_PASSWORD) => {
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#login-form").evaluate((form) => form.requestSubmit());
};

const expectNoHorizontalOverflow = async (page) => {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
  expect(overflow).toBeLessThanOrEqual(2);
};

const confirmSensitiveAction = async (page) => {
  const reauthModal = page.locator("#bitacora-reauth-modal");
  await expect(reauthModal).toBeVisible({ timeout: 10_000 });
  await reauthModal.getByLabel("Contraseña actual").fill(QA_PASSWORD);
  await reauthModal.getByRole("button", { name: "Confirmar" }).click();
  await expect(reauthModal).toBeHidden({ timeout: 15_000 });
};

const confirmDeleteAction = async (page) => {
  await confirmSensitiveAction(page);
  const deleteModal = page.locator("#bitacora-delete-confirm-modal");
  await expect(deleteModal).toBeVisible({ timeout: 10_000 });
  await deleteModal.getByRole("button", { name: "Eliminar definitivamente" }).click();
  await expect(deleteModal).toBeHidden({ timeout: 15_000 });
};

test("scientific logbook renders as operational hub with modals and article creation", async ({ page }, testInfo) => {
  const articleTitle = `Artículo QA Bitácora ${testInfo.project.name}`;
  const extractionRequests = [];
  const documentExtractionRequests = [];
  const consoleErrors = [];
  const methodologyProfile = (overrides = {}) => ({
    studyFamily: "implementation_health_policy",
    studyFamilyEs: "Implementación y política sanitaria",
    specificDesign: "Marco de implementación",
    designCategoryEs: "Marco de implementación",
    temporalDirection: "no aplica",
    centerScope: "regional",
    isMulticenter: false,
    multicenterRationale: "Alcance regional programático, no estudio clínico multicéntrico.",
    setting: "atención primaria",
    countryOrRegion: "Américas",
    countriesIncluded: ["Argentina", "Brasil", "Chile"],
    institutions: ["OPS/PAHO", "Organización Mundial de la Salud"],
    studyPopulation: "Personas adultas con hipertensión en programas de atención primaria.",
    sampleSize: "",
    sampleDescription: "Alcance programático regional con 33 países participantes.",
    studyPeriod: "2016/2017-2025",
    studyDuration: "No especificado en el documento",
    recruitmentPeriod: "",
    followUpDuration: "",
    dataSource: "Documentos técnicos e indicadores programáticos regionales.",
    interventionOrExposure: "Marco de calidad HEARTS para atención primaria.",
    comparator: "",
    primaryOutcome: "Mejorar el control de la hipertensión y la calidad asistencial.",
    secondaryOutcomes: ["Equidad de acceso", "Calidad de medición de presión arterial"],
    statisticalApproach: "Síntesis descriptiva del marco y sus indicadores.",
    effectMeasures: [],
    reportingGuideline: "",
    methodologicalStrengths: ["Describe componentes operativos y trazabilidad institucional."],
    methodologicalLimitations: ["No presenta evaluación causal de impacto clínico."],
    applicabilityNotes: ["Aplicable a gestión sanitaria y programas de salud ocupacional."],
    classificationRationale: "El documento propone un marco regional de implementación sanitaria.",
    classificationConfidence: "alta",
    evidenceSupport: {
      specificDesign: {
        supportLevel: "inferido_con_soporte",
        evidenceText: "Marco regional de implementación sanitaria.",
        sourceSection: "Summary"
      },
      temporalDirection: {
        supportLevel: "no_aplica",
        evidenceText: "No es estudio clínico primario.",
        sourceSection: "Methods"
      },
      centerScope: {
        supportLevel: "inferido_con_soporte",
        evidenceText: "33 países participantes.",
        sourceSection: "Summary"
      },
      studyPopulation: {
        supportLevel: "inferido_con_soporte",
        evidenceText: "Personas con hipertensión en atención primaria.",
        sourceSection: "Summary"
      },
      sampleSize: {
        supportLevel: "no_aplica",
        evidenceText: "Alcance programático regional.",
        sourceSection: "Summary"
      },
      studyPeriod: {
        supportLevel: "explicito",
        evidenceText: "2016/2017-2025.",
        sourceSection: "Methods"
      },
      institutions: {
        supportLevel: "explicito",
        evidenceText: "OPS/PAHO.",
        sourceSection: "Summary"
      }
    },
    methodologyWarnings: ["No interpretar como ensayo clínico ni cohorte."],
    ...overrides
  });
  const expandedDescriptionSections = (label = "documento") => [
    {
      heading: "Contexto",
      body: `El ${label} se presenta como una síntesis editorial en español para orientar lectura médica, explicar el problema abordado y ubicar la relevancia clínica, sanitaria o institucional sin sustituir la revisión completa de la fuente original.`
    },
    {
      heading: "Diseño y población",
      body: "La ficha distingue el tipo de publicación del diseño o evidencia analizada, describe población, ámbito y período cuando están disponibles, y evita clasificar como ensayo clínico aquello que corresponde a revisión, guía o política sanitaria."
    },
    {
      heading: "Qué evaluó",
      body: "La descripción resume objetivo, metodología, exposición, intervención o estrategia evaluada, junto con variables principales y datos de soporte aportados por el documento o por la extracción automatizada."
    },
    {
      heading: "Hallazgos relevantes",
      body: "El bloque identifica mensajes principales y hallazgos útiles para lectura crítica, evitando repetir la descripción breve, copiar el abstract completo o exagerar conclusiones más allá del diseño disponible."
    },
    {
      heading: "Lectura práctica",
      body: "La sección final sintetiza aplicabilidad, cautelas y relevancia para práctica clínica, gestión sanitaria o salud ocupacional, manteniendo una redacción compacta y accionable para el equipo médico."
    }
  ];
  const expandedDescriptionText = (label = "documento") =>
    expandedDescriptionSections(label)
      .map((section) => `${section.heading}. ${section.body}`)
      .join(" ");
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.addInitScript(() => {
    window.__bitacoraOpenCalls = [];
    window.open = (url, target, features) => {
      window.__bitacoraOpenCalls.push({ url, target, features });
      return { closed: false, focus: () => {} };
    };
  });
  await page.route("**/asistente-ia/index.html**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html>
        <html lang="es">
          <body>
            <main id="qa-assistant">Asistente IA QA</main>
            <script>
              window.parent.postMessage({ type: "dm-ai-ready" }, window.location.origin);
              window.addEventListener("message", (event) => {
                if (event.origin !== window.location.origin) return;
                if (event.data && event.data.type === "dm-ai-select-model") {
                  document.body.dataset.model = event.data.model || "";
                }
              });
            </script>
          </body>
        </html>`
    });
  });
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
    await new Promise((resolve) => setTimeout(resolve, 150));
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
          studyDesignEs: "Revisión narrativa documentada en español.",
          studyContextEs: isTextMode
            ? "Documento aportado para revisión editorial del equipo médico."
            : "Documento PDF revisado por IA en backend.",
          studyPopulationEs: "Población indicada por el documento de prueba.",
          studyLocationEs: "Contexto QA.",
          studyPeriodEs: "2026",
          evidenceType: "Revisión científica",
          accessType: "Pendiente",
          briefDescriptionEs: isTextMode
            ? "Descripción breve en español desde documento aportado."
            : "Descripción breve en español desde PDF.",
          expandedDescriptionEs: expandedDescriptionText(isTextMode ? "documento aportado" : "PDF científico"),
          expandedDescriptionSections: expandedDescriptionSections(isTextMode ? "documento aportado" : "PDF científico"),
          expandedDescriptionQuality: "complete",
          cardSummaryEs: isTextMode
            ? "Descripción breve en español desde documento aportado."
            : "Descripción breve en español desde PDF.",
          executiveSummaryEs: expandedDescriptionText(isTextMode ? "documento aportado" : "PDF científico"),
          abstractSummaryEs: "Abstract sintetizado y traducido al español.",
          objectiveEs: "Objetivo o pregunta sintetizada en español.",
          clinicalQuestionEs: "Objetivo o pregunta sintetizada en español.",
          mainMessageEs: "Mensaje principal en español.",
          mainResultEs: "Mensaje principal en español.",
          methodologyEs: "Revisión narrativa documentada en español.",
          methodologyProfile: methodologyProfile({
            specificDesign: isTextMode ? "Revisión narrativa" : "Marco de implementación",
            designCategoryEs: isTextMode ? "Revisión narrativa" : "Marco de implementación"
          }),
          keyPointsEs: ["Punto clave uno", "Punto clave dos", "Punto clave tres"],
          limitationsEs: "Limitaciones sintetizadas en español.",
          localApplicabilityEs: "Aplicabilidad local para revisión del equipo.",
          occupationalHealthRelevanceEs: "Relevancia para salud ocupacional y gestión sanitaria.",
          tags: ["Documento", "IA", "Revisión", "Gestión sanitaria", "QA"],
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
            briefDescriptionEs: "Descripción breve asistida en español desde datos pegados.",
            expandedDescriptionEs: expandedDescriptionText("artículo asistido"),
            expandedDescriptionSections: expandedDescriptionSections("artículo asistido"),
            expandedDescriptionQuality: "complete",
            cardSummaryEs: "Descripción breve asistida en español desde datos pegados.",
            executiveSummary: expandedDescriptionText("artículo asistido"),
            executiveSummaryEs: expandedDescriptionText("artículo asistido"),
            clinicalQuestion: "Pregunta asistida en español.",
            mainResult: "Resultado asistido en español.",
            methodologyProfile: methodologyProfile({
              studyFamily: "evidence_synthesis",
              studyFamilyEs: "Síntesis de evidencia",
              specificDesign: "Revisión narrativa",
              designCategoryEs: "Revisión narrativa"
            }),
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
            briefDescriptionEs: "",
            expandedDescriptionEs: "",
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
          briefDescriptionEs: "Descripción breve generada por IA desde Playwright.",
          expandedDescriptionEs: expandedDescriptionText("artículo PubMed"),
          expandedDescriptionSections: expandedDescriptionSections("artículo PubMed"),
          expandedDescriptionQuality: "complete",
          cardSummaryEs: "Descripción breve generada por IA desde Playwright.",
          executiveSummary: expandedDescriptionText("artículo PubMed"),
          executiveSummaryEs: expandedDescriptionText("artículo PubMed"),
          clinicalQuestion: "Pregunta clínica generada por IA.",
          mainResult: "Resultado principal generado por IA.",
          methodologyProfile: methodologyProfile({
            studyFamily: "experimental_interventional",
            studyFamilyEs: "Experimental/intervencional",
            specificDesign: "Ensayo clínico aleatorizado",
            designCategoryEs: "Ensayo clínico",
            temporalDirection: "prospectivo",
            centerScope: "multicéntrico",
            setting: "hospital",
            countryOrRegion: "Argentina",
            countriesIncluded: ["Argentina"],
            institutions: ["Hospital QA"],
            sampleSize: "240 participantes",
            sampleDescription: "Participantes adultos incluidos en centros hospitalarios.",
            studyDuration: "12 meses",
            dataSource: "Registro clínico del ensayo.",
            interventionOrExposure: "Intervención clínica QA.",
            comparator: "Atención habitual",
            primaryOutcome: "Cambio en el desenlace clínico principal.",
            statisticalApproach: "Comparación entre grupos por intención de tratar.",
            reportingGuideline: "CONSORT"
          }),
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
  const headerAvatarLayout = await page.locator(".art-gallery-header .user-panel-trigger .user-panel-icon").evaluate((icon) => {
    const image = icon.querySelector(".user-avatar-img");
    const dropdownImage = document.querySelector(".art-gallery-header .user-panel-dropdown .user-menu__avatar .user-avatar-img");
    const rect = icon.getBoundingClientRect();
    const styles = getComputedStyle(icon);
    return {
      hasImage: Boolean(image),
      triggerTransform: image ? getComputedStyle(image).transform : "",
      dropdownTransform: dropdownImage ? getComputedStyle(dropdownImage).transform : "",
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      overflow: styles.overflow
    };
  });
  expect(headerAvatarLayout.hasImage).toBe(true);
  expect(headerAvatarLayout.triggerTransform).not.toBe("none");
  expect(headerAvatarLayout.dropdownTransform).toBe("none");
  expect(headerAvatarLayout.width).toBe(headerAvatarLayout.height);
  expect(headerAvatarLayout.overflow).toBe("hidden");
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
  await expect(page.locator("#bitacora-heading")).toHaveText("Bitácora de Ciencia Médica");
  await expect(page.locator(".bitacora-intro-segment")).toHaveCount(1);
  await expect(page.locator(".bitacora-publications-segment")).toHaveCount(1);
  await expect(page.locator(".bitacora-breadcrumb")).toHaveText("Portal");
  await expect(page.locator(".bitacora-intro-segment")).not.toContainText("Evidencia médica curada");
  await expect(page.locator(".bitacora-intro-segment")).not.toContainText("Centralización de publicaciones");
  await expect(page.locator(".bitacora-hero__actions")).toHaveCount(0);
  await expect(page.locator(".bitacora-hero__action--sources")).toHaveCount(0);
  await expect(page.locator(".bitacora-hero__action--methodology")).toHaveCount(0);
  await expect(page.locator(".bitacora-publications-panel")).toBeVisible();
  await expect(page.locator(".bitacora-publications-panel")).toHaveCSS("background-color", /rgba?|rgb/);
  await expect(page.locator("#bitacora-publicaciones-title")).toHaveText("Publicaciones recomendadas");
  const addArticleTrigger = page.locator(".bitacora-add-article-button");
  await expect(addArticleTrigger).toBeVisible();
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

  const quickDock = page.locator("[data-bitacora-quick-dock]");
  await expect(quickDock).toBeVisible();
  const quickCubes = quickDock.locator("[data-bitacora-quick-action]");
  await expect(quickCubes).toHaveCount(4);
  await expect(quickCubes.nth(0)).toContainText("Guía");
  await expect(quickCubes.nth(0)).toContainText("Metodológica");
  await expect(quickCubes.nth(1)).toContainText("Fuentes");
  await expect(quickCubes.nth(1)).toContainText("recomendadas");
  await expect(quickCubes.nth(2)).toContainText("Agregar");
  await expect(quickCubes.nth(2)).toContainText("artículo");
  await expect(quickCubes.nth(3)).toContainText("Bot");
  await expect(quickCubes.nth(3)).toContainText("IA");
  await expect
    .poll(() =>
      quickCubes.evaluateAll((buttons) => buttons.map((button) => button.dataset.bitacoraQuickAction)),
    )
    .toEqual(["methodology", "sources", "add-article", "bot"]);
  if ((page.viewportSize()?.width || 0) >= 1181) {
    const dockDoesNotCoverContent = await page.evaluate(() => {
      const dock = document.querySelector("[data-bitacora-quick-dock]");
      const shell = document.querySelector(".bitacora-shell");
      if (!dock || !shell) return false;
      const dockRect = dock.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      return dockRect.right <= shellRect.left - 8;
    });
    expect(dockDoesNotCoverContent).toBe(true);
    const dockAlignsWithIntro = await page.evaluate(() => {
      const dock = document.querySelector("[data-bitacora-quick-dock]");
      const intro = document.querySelector(".bitacora-intro-segment");
      if (!dock || !intro) return Number.POSITIVE_INFINITY;
      return Math.abs(dock.getBoundingClientRect().top - intro.getBoundingClientRect().top);
    });
    expect(dockAlignsWithIntro).toBeLessThanOrEqual(1);
  }

  const dockMethodology = quickDock.locator("[data-bitacora-quick-action='methodology']");
  const dockSources = quickDock.locator("[data-bitacora-quick-action='sources']");
  const dockAddArticle = quickDock.locator("[data-bitacora-quick-action='add-article']");
  const dockBot = quickDock.locator("[data-bitacora-quick-action='bot']");
  await expect.poll(() =>
    quickCubes.evaluateAll((buttons) => buttons.every((button) => button.classList.contains("dm-cube"))),
  ).toBe(true);
  if ((page.viewportSize()?.width || 0) >= 1181) {
    const cubeMetrics = await quickCubes.evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      }),
    );
    expect(cubeMetrics.every(({ width, height }) => width === 88 && height === 88)).toBe(true);
    const botImageCoversTile = await dockBot.locator("img").evaluate((img) => {
      const imageRect = img.getBoundingClientRect();
      const buttonRect = img.closest("button").getBoundingClientRect();
      return (
        Math.abs(imageRect.left - buttonRect.left) <= 1 &&
        Math.abs(imageRect.top - buttonRect.top) <= 1 &&
        Math.abs(imageRect.width - buttonRect.width) <= 2 &&
        Math.abs(imageRect.height - buttonRect.height) <= 2
      );
    });
    expect(botImageCoversTile).toBe(true);
  }
  await dockMethodology.click();
  const methodologyModalFromDock = page.locator("#methodology-guide-modal");
  await expect(methodologyModalFromDock).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(methodologyModalFromDock).toBeHidden();
  await dockSources.click();
  const sourcesModalFromDock = page.locator("#scientific-sources-modal");
  await expect(sourcesModalFromDock).toBeVisible();
  const dockBehindModal = await page.evaluate(() => {
    const modal = document.querySelector("#scientific-sources-modal");
    const dock = document.querySelector("[data-bitacora-quick-dock]");
    const modalZ = Number.parseInt(getComputedStyle(modal).zIndex || "0", 10);
    const dockZ = Number.parseInt(getComputedStyle(dock).zIndex || "0", 10);
    return modalZ > dockZ;
  });
  expect(dockBehindModal).toBe(true);
  await page.keyboard.press("Escape");
  await expect(sourcesModalFromDock).toBeHidden();
  await dockAddArticle.click();
  const articleModalFromDock = page.locator("#add-article-modal");
  await expect(articleModalFromDock).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(articleModalFromDock).toBeHidden();
  await expect(page.locator("[data-dm-ai-shell]")).toHaveCount(1);
  await dockBot.click();
  await expect(page.locator(".dm-ai-selector")).toHaveClass(/is-open/);
  await expect(dockBot).toHaveAttribute("aria-expanded", "true");
  await page.locator(".dm-ai-selector [data-dm-ai-model='gemini']").click();
  await expect(page.locator("[data-dm-ai-shell]")).toHaveClass(/is-open/);
  await expect(page.locator("[data-dm-ai-shell]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dm-ai-shell]")).not.toHaveClass(/is-open/);

  await expect(page.locator("#brisa-chat-root")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator("#brisa-chat-root")).toHaveAttribute("data-chat-context", "bitacora");
  await expect(page.locator("#brisa-chat-delete-modal")).toBeHidden();
  await expect(page.locator("#brisa-chat-delete-conv-modal")).toBeHidden();
  const chatBubble = page.locator("#brisa-chat-bubble");
  await expect(chatBubble).toBeVisible({ timeout: 30_000 });
  const bubbleVisual = await chatBubble.evaluate((bubble) => {
    const style = window.getComputedStyle(bubble);
    const icon = bubble.querySelector(".brisa-chat-bubble-icon");
    return {
      backgroundImage: style.backgroundImage,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      iconColor: icon ? window.getComputedStyle(icon).color : "",
    };
  });
  expect(bubbleVisual.backgroundImage).toContain("radial-gradient");
  expect(bubbleVisual.borderRadius).toBe("999px");
  expect(bubbleVisual.iconColor).toBe("rgb(255, 255, 255)");
  expect(bubbleVisual.boxShadow).toContain("rgba");
  await chatBubble.click();
  if ((page.viewportSize()?.width || 0) <= 640) {
    await expect(page.locator("#brisa-chat-mobile-overlay:not(.hidden)")).toBeVisible();
  } else {
    await expect(page.locator("#brisa-chat-panel[data-chat-state='open']")).toBeVisible();
  }
  await expect(page.locator("#brisa-chat-root")).toHaveCount(1);
  await expect(page.locator("[data-dm-ai-shell]")).toHaveCount(1);
  await expect(page.locator("#brisa-chat-quick-ai")).toBeVisible();
  await page.locator("#brisa-chat-quick-ai").click();
  await expect(page.locator("[data-dm-ai-shell]")).toHaveClass(/is-open/);
  await expect(page.locator("[data-dm-ai-shell]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dm-ai-shell]")).not.toHaveClass(/is-open/);
  await expectNoHorizontalOverflow(page);

  await expect.poll(() => page.locator(".bitacora-post").count(), { timeout: 30_000 }).toBe(1);
  await expect(page.locator("#bitacora-results-count")).toHaveText("0 artículos agregados");
  await expect(page.locator(".bitacora-post").first()).toHaveCSS("background-color", /rgba?|rgb/);
  await expect(page.locator(".bitacora-post").first()).toContainText("Ejemplo de artículo científico");
  await page.getByRole("button", { name: "Quitar ejemplo" }).click();
  await expect(page.locator(".bitacora-post")).toHaveCount(0);
  await expect(page.locator("#bitacora-empty")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await dockSources.click();
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
  const ramrLogoLayout = await sourcesModal.locator('.scientific-source-card[data-source-id="ramr"]').evaluate((card) => {
    const image = card.querySelector(".scientific-source-logo img");
    const container = card.querySelector(".scientific-source-logo");
    const imageRect = image.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return {
      offsetX: getComputedStyle(card).getPropertyValue("--source-logo-offset-x").trim(),
      containerOverflow: getComputedStyle(container).overflow,
      imageShiftedLeft: imageRect.left < containerRect.left,
      horizontalShiftWithinOffset:
        imageRect.left >= containerRect.left - 2.5 &&
        imageRect.right <= containerRect.right + 1,
      imageVerticallyInsideContainer:
        imageRect.top >= containerRect.top - 1 &&
        imageRect.bottom <= containerRect.bottom + 1
    };
  });
  expect(ramrLogoLayout.offsetX).toBe("-1.5px");
  expect(ramrLogoLayout.containerOverflow).toBe("hidden");
  expect(ramrLogoLayout.imageShiftedLeft).toBe(true);
  expect(ramrLogoLayout.horizontalShiftWithinOffset).toBe(true);
  expect(ramrLogoLayout.imageVerticallyInsideContainer).toBe(true);
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

  await dockSources.click();
  await expect(sourcesModal).toBeVisible();
  await sourcesModal.getByRole("button", { name: "Cerrar" }).click();
  await expect(sourcesModal).toBeHidden();

  await dockMethodology.click();
  const methodologyModal = page.locator("#methodology-guide-modal");
  await expect(methodologyModal).toBeVisible();
  await expect(methodologyModal.getByRole("dialog")).toBeVisible();
  await expect(methodologyModal.getByRole("heading", { name: "Metodología de estudios científicos" })).toBeVisible();
  await expect(methodologyModal).toContainText("Cómo interpretar rápidamente un diseño");
  const methodologyGuideNav = methodologyModal.getByRole("navigation", { name: "Navegación de guía metodológica" });
  await expect(methodologyGuideNav).toBeVisible();
  for (const item of ["Fórmula", "Diferencias clave", "Familias", "Clasificaciones", "Diseños", "Checklist", "Medidas", "Guías"]) {
    await expect(methodologyGuideNav.getByRole("button", { name: item })).toBeVisible();
  }
  await methodologyGuideNav.scrollIntoViewIfNeeded();
  const navHasVisibleHeight = await methodologyGuideNav.evaluate((nav) => {
    const firstButton = nav.querySelector("button");
    if (!firstButton) return false;
    const navRect = nav.getBoundingClientRect();
    const buttonRect = firstButton.getBoundingClientRect();
    return navRect.height >= 52 && buttonRect.height >= 30;
  });
  expect(navHasVisibleHeight).toBe(true);
  await expect(methodologyModal).toContainText("1 Diseño");
  await expect(methodologyModal).toContainText("Fórmula visual");
  await expect(methodologyModal).toContainText("8 Análisis");
  const methodologyWorkflow = methodologyModal.locator(".methodology-guide-workflow");
  await expect(methodologyWorkflow.locator(".methodology-guide-workflow__number")).toHaveCount(8);
  await expect(methodologyWorkflow.locator(".methodology-guide-workflow__label")).toHaveCount(8);
  if ((page.viewportSize()?.width || 0) >= 900) {
    const workflowGeometry = await methodologyWorkflow.evaluate((workflow) => {
      const steps = Array.from(workflow.querySelectorAll(".methodology-guide-workflow__step"));
      const tops = new Set(steps.map((step) => Math.round(step.getBoundingClientRect().top)));
      const widths = steps.map((step) => step.getBoundingClientRect().width);
      const shortWidths = [widths[0], widths[1], widths[4], widths[7]];
      const longWidths = [widths[2], widths[3], widths[6]];
      const numbers = Array.from(workflow.querySelectorAll(".methodology-guide-workflow__number"));
      const labels = Array.from(workflow.querySelectorAll(".methodology-guide-workflow__label"));
      return {
        stepsInOneRow: steps.length === 8 && tops.size === 1,
        numbersAreCircular: numbers.every((number) => {
          const rect = number.getBoundingClientRect();
          const styles = getComputedStyle(number);
          return Math.abs(rect.width - rect.height) <= 1 && rect.width >= 20 && rect.width <= 24 && styles.borderRadius === "999px";
        }),
        numbersInsideSteps: numbers.every((number) => {
          const numberRect = number.getBoundingClientRect();
          const stepRect = number.closest(".methodology-guide-workflow__step").getBoundingClientRect();
          return (
            numberRect.left >= stepRect.left - 1 &&
            numberRect.top >= stepRect.top - 1 &&
            numberRect.right <= stepRect.right + 1 &&
            numberRect.bottom <= stepRect.bottom + 1
          );
        }),
        labelsInsideSteps: labels.every((label) => {
          const labelRect = label.getBoundingClientRect();
          const stepRect = label.closest(".methodology-guide-workflow__step").getBoundingClientRect();
          return (
            labelRect.left >= stepRect.left - 1 &&
            labelRect.top >= stepRect.top - 1 &&
            labelRect.right <= stepRect.right + 1 &&
            labelRect.bottom <= stepRect.bottom + 1
          );
        }),
        longColumnsWiderThanShortColumns: Math.min(...longWidths) > Math.max(...shortWidths)
      };
    });
    expect(workflowGeometry.stepsInOneRow).toBe(true);
    expect(workflowGeometry.numbersAreCircular).toBe(true);
    expect(workflowGeometry.numbersInsideSteps).toBe(true);
    expect(workflowGeometry.labelsInsideSteps).toBe(true);
    expect(workflowGeometry.longColumnsWiderThanShortColumns).toBe(true);
  }
  if ((page.viewportSize()?.width || 0) <= 640) {
    const workflowScrollsInternally = await methodologyWorkflow.evaluate((workflow) => {
      const styles = getComputedStyle(workflow);
      return (
        styles.display === "flex" &&
        styles.flexWrap === "nowrap" &&
        (styles.overflowX === "auto" || styles.overflowX === "scroll") &&
        workflow.scrollWidth > workflow.clientWidth
      );
    });
    expect(workflowScrollsInternally).toBe(true);
  }
  await expect(methodologyModal).toContainText("Diferencias clave");
  await expect(methodologyModal).toContainText("Prospectivo vs retrospectivo");
  await expect(methodologyModal).toContainText("Grandes familias de estudios");
  await expect(methodologyModal).toContainText("Revisión sistemática ≠ Metaanálisis");
  await expect(methodologyModal).toContainText("Clasificaciones clave");
  await expect(methodologyModal.getByRole("button", { name: "Ver definición de Prospectivo" })).toBeVisible();
  await expect(methodologyModal.getByRole("button", { name: "Ver definición de Retrospectivo" })).toBeVisible();
  await expect(methodologyModal.getByRole("button", { name: "Ver definición de Ambispectivo" })).toBeVisible();
  await expect(methodologyModal).toContainText("Diseños más frecuentes");
  await expect(methodologyModal).toContainText("Parámetros mínimos");
  await expect(methodologyModal).toContainText("Medidas frecuentes");
  await expect(methodologyModal).toContainText("Guías de reporte");
  await expect(methodologyModal).toContainText("CONSORT");
  await expect(methodologyModal).toContainText("Una buena metodología permite interpretar la validez");
  const guideScrolls = await methodologyModal.locator(".methodology-guide-modal__body").evaluate((node) => {
    const styles = getComputedStyle(node);
    return styles.overflowY === "auto" || styles.overflowY === "scroll";
  });
  expect(guideScrolls).toBe(true);
  await methodologyModal.locator(".methodology-guide-modal__body").evaluate((node) => {
    node.scrollTop = 0;
  });
  const beforeGuideNavScroll = await methodologyModal.locator(".methodology-guide-modal__body").evaluate((node) => node.scrollTop);
  await methodologyModal.getByRole("button", { name: "Diseños" }).click();
  await expect(methodologyModal.locator("#methodology-guide-section-designs")).toBeInViewport();
  const afterGuideNavScroll = await methodologyModal.locator(".methodology-guide-modal__body").evaluate((node) => node.scrollTop);
  expect(afterGuideNavScroll).toBeGreaterThan(beforeGuideNavScroll);
  await methodologyModal.getByRole("button", { name: "Clasificaciones" }).click();
  const prospectivoTerm = methodologyModal.getByRole("button", { name: "Ver definición de Prospectivo" });
  await expect(prospectivoTerm).toBeInViewport();
  await prospectivoTerm.click();
  const termPopover = methodologyModal.locator("#methodology-term-popover");
  await expect(termPopover).toBeVisible();
  await expect(termPopover.getByRole("dialog", { name: "Prospectivo" })).toBeVisible();
  await expect(termPopover).toContainText("Recolecta datos hacia adelante");
  await expect(termPopover).toContainText("Cohorte que sigue pacientes durante 12 meses");
  await expect(termPopover).toContainText("Tiempo");
  await page.keyboard.press("Escape");
  await expect(termPopover).toBeHidden();
  await expect(prospectivoTerm).toBeFocused();
  await methodologyModal.getByRole("button", { name: "Ver definición de Retrospectivo" }).click();
  await expect(termPopover).toBeVisible();
  await expect(termPopover.getByRole("dialog", { name: "Retrospectivo" })).toBeVisible();
  await expect(termPopover).toContainText("Analiza datos ya ocurridos");
  await methodologyModal.locator(".methodology-guide-modal__body").click({ position: { x: 12, y: 12 } });
  await expect(termPopover).toBeHidden();
  await expect(methodologyModal).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(methodologyModal).toBeHidden();
  await expect(dockMethodology).toBeFocused();
  await dockMethodology.click();
  await expect(methodologyModal).toBeVisible();
  await methodologyModal.click({ position: { x: 6, y: 6 } });
  await expect(methodologyModal).toBeHidden();
  await expectNoHorizontalOverflow(page);

  await addArticleTrigger.click();
  const articleModal = page.locator("#add-article-modal");
  await expect(articleModal).toBeVisible();
  await expect(articleModal.getByRole("dialog")).toBeVisible();
  await expect(articleModal.getByRole("tab", { name: "Desde PDF" })).toBeVisible();
  await expect(articleModal.getByRole("tab", { name: "Texto pegado" })).toBeVisible();
  await expect(articleModal.getByRole("tab", { name: "Datos manuales" })).toBeVisible();
  await expect(articleModal).not.toContainText("Cargado por");
  await expect(articleModal).not.toContainText("Pendiente de revisión");

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
  await expect(incompleteDraft).not.toContainText("Borrador incompleto");
  await incompleteDraft.getByRole("button", { name: "Eliminar publicación" }).click();
  await confirmDeleteAction(page);
  await expect(page.locator(".bitacora-post")).toHaveCount(0);

  await addArticleTrigger.click();
  await expect(articleModal).toBeVisible();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await articleModal.locator("[data-select-pdf]").click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "paper-qa.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF")
  });
  await articleModal.locator("#article-pdf-official-url").fill("https://doi.org/10.1000/documento");
  await expect(articleModal.locator("#article-pdf-file")).toBeVisible();
  await expect(articleModal.locator("#article-pdf-name")).toHaveText("paper-qa.pdf");
  await expect(articleModal.getByText("PDF único, máximo 20 MB.")).toBeVisible();
  await expect(articleModal).not.toContainText("El procesamiento se realiza en backend");
  await articleModal.getByRole("button", { name: "Analizar PDF con IA" }).click();
  await expect(articleModal.locator("#article-ai-processing-overlay")).toBeVisible();
  await expect(articleModal.locator("#article-ai-processing-overlay")).toContainText(
    "La inteligencia artificial está procesando los datos. Aguarde un momento."
  );
  await expect(articleModal.locator("#article-ai-processing-overlay")).toBeHidden({ timeout: 30_000 });
  await expect(articleModal.locator("#article-ai-status")).toContainText("Ficha generada por IA", {
    timeout: 30_000
  });
  await expect(articleModal.locator("#article-preview-zone")).toBeVisible();
  await expect(articleModal.locator("#article-preview-zone")).toContainText("Vista previa generada");
  await expect(articleModal.getByLabel("DOI (Identificador Digital de Objeto)")).toBeVisible();
  await expect(articleModal.locator("#article-advanced-zone")).toBeHidden();
  await expect(articleModal.getByLabel("Título")).toHaveValue("PDF QA Bitácora");
  await expect(articleModal.getByLabel("Descripción breve para tarjeta")).toHaveValue("Descripción breve en español desde PDF.");
  await articleModal.getByRole("button", { name: "Editar detalles avanzados" }).click();
  await expect(articleModal.locator("#article-advanced-zone")).toBeVisible();
  await expect(articleModal.getByLabel("Descripción ampliada")).toHaveValue(/PDF científico/);
  await saveArticleButton.click();
  await expect(articleModal).toBeHidden({ timeout: 30_000 });

  const pdfPost = page.locator(".bitacora-post").filter({ hasText: "PDF QA Bitácora" }).first();
  await expect(pdfPost).toBeVisible({ timeout: 30_000 });
  await expect(pdfPost).not.toContainText("Pendiente de revisión");
  await expect(pdfPost).not.toContainText("Borrador automático");
  await expect(pdfPost).not.toContainText("Metadatos básicos");
  await expect(pdfPost).not.toContainText("Extracción fallida");
  await expect(pdfPost).toContainText("Descripción breve en español desde PDF.");
  const sourceTitleGap = await pdfPost.locator(".bitacora-post-card__source-line").evaluate((sourceLine) => {
    const title = sourceLine.closest(".bitacora-post-card__header")?.querySelector(".bitacora-post-card__title");
    if (!title) return 0;
    return Math.round(title.getBoundingClientRect().top - sourceLine.getBoundingClientRect().bottom);
  });
  expect(sourceTitleGap).toBeGreaterThanOrEqual(5);
  await expect(pdfPost).not.toContainText("Ver PDF");
  await expect(pdfPost).not.toContainText("Leer análisis");
  const pdfDocumentButton = pdfPost.getByRole("button", { name: "Ver documento asociado" });
  await expect(pdfDocumentButton).toBeVisible();
  await expect(pdfDocumentButton).toContainText("Ver Documento");
  await expect(pdfDocumentButton.locator("svg")).toHaveCount(1);
  await pdfDocumentButton.click();
  await expect
    .poll(() => page.evaluate(() => window.__bitacoraOpenCalls?.length || 0), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const documentOpenCall = await page.evaluate(() => window.__bitacoraOpenCalls.at(-1));
  expect(documentOpenCall.url).toMatch(/(firebasestorage|127\.0\.0\.1:9199|localhost:9199)/);
  expect(documentOpenCall.target).toBe("_blank");
  expect(documentOpenCall.features).toContain("noopener");
  const pdfSourceLink = pdfPost.getByRole("link", { name: "Ver fuente original" });
  await expect(pdfSourceLink).toHaveAttribute("href", "https://doi.org/10.1000/documento");
  await expect(pdfSourceLink.locator("svg")).toHaveCount(1);
  const articleLikeButton = pdfPost.locator("[data-bitacora-action='toggle-like']").first();
  await expect(articleLikeButton).toHaveAttribute("aria-pressed", "false");
  await expect(pdfPost.locator("[data-bitacora-like-count]")).toHaveText("0");
  await expect(articleLikeButton).not.toContainText("Me gusta");
  await articleLikeButton.click();
  await expect(articleLikeButton).toHaveAttribute("aria-pressed", "true");
  await expect(pdfPost.locator("[data-bitacora-like-count]")).toHaveText("1");
  await articleLikeButton.hover();
  await expect(pdfPost.locator(".bitacora-like-button .bitacora-social-tooltip")).toContainText("Dra. Mobile QA");
  await articleLikeButton.click();
  await expect(articleLikeButton).toHaveAttribute("aria-pressed", "false");
  await expect(pdfPost.locator("[data-bitacora-like-count]")).toHaveText("0");
  const articleCommentButton = pdfPost.locator("[data-bitacora-action='focus-comments']").first();
  await expect(articleCommentButton).toHaveAccessibleName("0 comentarios en esta publicación");
  await expect(articleCommentButton).not.toContainText("Comentarios");
  await pdfPost.getByRole("button", { name: "Resumen Técnico" }).click();
  const pdfAnalysis = pdfPost.locator(".bitacora-analysis");
  await expect(pdfAnalysis).toContainText("Objetivo");
  await expect(pdfAnalysis).toContainText("Puntos clave");
  await expect(pdfAnalysis).toContainText("Descripción ampliada");
  const pdfExpandedToggle = pdfPost.locator(".bitacora-expanded-description__toggle").first();
  const pdfExpandedBody = pdfPost.locator(".bitacora-expanded-description__body").first();
  await expect(pdfExpandedToggle).toHaveAttribute("aria-expanded", "false");
  await expect(pdfExpandedBody).toBeHidden();
  await pdfExpandedToggle.click();
  await expect(pdfExpandedToggle).toHaveAttribute("aria-expanded", "true");
  await expect(pdfExpandedBody).toBeVisible();
  await expect(pdfExpandedBody.locator(".bitacora-expanded-description__section")).toHaveCount(5);
  await expect(pdfExpandedBody).toContainText("PDF científico");
  await pdfExpandedToggle.click();
  await expect(pdfExpandedToggle).toHaveAttribute("aria-expanded", "false");
  await expect(pdfExpandedBody).toBeHidden();
  await expect(pdfPost.locator(".bitacora-analysis")).toContainText("Ficha metodológica");
  await expect(pdfPost.locator(".bitacora-analysis")).toContainText("Marco de implementación");
  await expect(pdfPost.locator(".bitacora-analysis")).toContainText("¿Multicéntrico?");
  await expect(pdfPost.locator(".bitacora-analysis")).toContainText("no estudio clínico multicéntrico");
  await expect(pdfPost.locator(".bitacora-analysis")).toContainText("Américas");
  await expect(pdfPost.locator(".bitacora-analysis")).toContainText("OPS/PAHO");
  await expect(pdfPost.locator(".bitacora-analysis")).toContainText("33 países");
  await expect(pdfPost.locator(".bitacora-analysis")).toContainText("Objetivo o pregunta sintetizada en español.");
  await expect(pdfPost.locator(".bitacora-analysis")).toContainText("Mensaje principal en español.");
  await expect(pdfPost.locator(".bitacora-comments")).toContainText("Sé el primero en comentar esta publicación.");
  const pdfComment = "Comentario E2E de lectura crítica.";
  await pdfPost.locator("[data-bitacora-comment-text]").fill(pdfComment);
  await pdfPost.getByRole("button", { name: "Comentar", exact: true }).click();
  const postedComment = pdfPost.locator(".bitacora-comment").filter({ hasText: pdfComment }).first();
  await expect(postedComment).toBeVisible({ timeout: 15_000 });
  await expect(postedComment.locator(".bitacora-comment__meta strong")).toContainText("Dra. Mobile QA");
  await expect(postedComment.locator(".bitacora-comment__meta span")).not.toHaveText("");
  await expect(pdfPost.locator("[data-bitacora-comment-count]")).toHaveText("1");
  await expect(pdfPost.locator(".bitacora-comment-preview")).toContainText(pdfComment);
  const commentLikeButton = postedComment.locator("[data-bitacora-action='toggle-comment-like']");
  await commentLikeButton.click();
  await expect(commentLikeButton).toHaveAttribute("aria-pressed", "true");
  await expect(postedComment.locator("[data-bitacora-comment-like-count]")).toHaveText("1");
  await commentLikeButton.hover();
  await expect(postedComment.locator(".bitacora-social-tooltip")).toContainText("Dra. Mobile QA");
  await postedComment.getByRole("button", { name: "Editar comentario" }).click();
  await postedComment.locator("[data-bitacora-comment-edit-text]").fill("Comentario E2E editado.");
  await postedComment.getByRole("button", { name: "Guardar" }).click();
  await expect(pdfPost.locator(".bitacora-comment").filter({ hasText: "Comentario E2E editado." })).toBeVisible({
    timeout: 15_000
  });

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Eliminar comentario");
    await dialog.accept();
  });
  await pdfPost.locator(".bitacora-comment").filter({ hasText: "Comentario E2E editado." }).getByRole("button", { name: "Eliminar comentario" }).click();
  await expect(pdfPost.locator(".bitacora-comments__empty")).toContainText("Sé el primero en comentar esta publicación.", {
    timeout: 15_000
  });
  await expect(pdfPost.locator("[data-bitacora-comment-count]")).toHaveText("0");
  await page.locator("#bitacora-publicaciones-title").scrollIntoViewIfNeeded();
  await page.locator("#bitacora-publicaciones-title").click();
  await expect(pdfPost.locator(".bitacora-analysis")).toBeHidden();
  await pdfPost.scrollIntoViewIfNeeded();
  await pdfPost.getByRole("button", { name: "Eliminar publicación" }).click();
  await confirmDeleteAction(page);
  await expect(page.locator(".bitacora-post")).toHaveCount(0);

  await addArticleTrigger.click();
  await expect(articleModal).toBeVisible();
  await articleModal.getByRole("tab", { name: "Texto pegado" }).click();
  const pastedText =
    "Title from pasted text. Abstract. This scientific document includes methods, results, discussion and conclusions for review. ".repeat(8);
  await articleModal.getByLabel("Texto del artículo o documento").fill(pastedText);
  await articleModal.locator("#article-pasted-source").fill("Revista Texto QA");
  await articleModal.getByRole("button", { name: "Analizar texto con IA" }).click();
  await expect(articleModal.locator("#article-ai-processing-overlay")).toBeVisible();
  await expect(articleModal.locator("#article-ai-processing-overlay")).toBeHidden({ timeout: 30_000 });
  await expect(articleModal.locator("#article-ai-status")).toContainText("Ficha generada por IA", {
    timeout: 30_000
  });
  await expect(articleModal.getByLabel("Título")).toHaveValue("Texto QA traducido");
  await expect(articleModal.locator("#article-advanced-zone")).toBeHidden();
  await articleModal.getByRole("button", { name: "Editar detalles avanzados" }).click();
  await expect(articleModal.locator("#article-advanced-zone")).toBeVisible();
  await expect(articleModal.getByLabel("Descripción ampliada")).toHaveValue(/documento aportado/);
  await articleModal.getByRole("button", { name: "Guardar como borrador" }).click();
  await expect(articleModal).toBeHidden({ timeout: 30_000 });
  const textDraft = page.locator(".bitacora-post").filter({ hasText: "Texto QA traducido" }).first();
  await expect(textDraft).toBeVisible({ timeout: 30_000 });
  await expect(textDraft).not.toContainText("Texto pegado");
  await textDraft.getByRole("button", { name: "Eliminar publicación" }).click();
  await confirmDeleteAction(page);
  await expect(page.locator(".bitacora-post")).toHaveCount(0);

  await addArticleTrigger.click();
  await expect(articleModal).toBeVisible();
  await articleModal.getByRole("tab", { name: "Datos manuales" }).click();
  const manualUrlInput = articleModal.locator("#article-tab-manual").getByLabel("URL oficial del artículo", { exact: true });
  await expect(manualUrlInput).toBeVisible();

  await manualUrlInput.fill("javascript:alert(1)");
  await articleModal.getByRole("button", { name: "Analizar enlace con IA" }).click();
  await expect(articleModal.locator("#article-url-error")).toContainText("URL", { timeout: 10_000 });

  await manualUrlInput.fill("https://example.org/partial");
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

  await manualUrlInput.fill("https://example.org/auth");
  await articleModal.getByRole("button", { name: "Analizar enlace con IA" }).click();
  await expect(articleModal.locator("#article-ai-status")).toContainText("Necesitás iniciar sesión para analizar enlaces.", {
    timeout: 10_000
  });

  await articleModal.getByLabel("Título").fill("Título manual preservado");
  await manualUrlInput.fill("https://example.org/failed");
  await articleModal.getByRole("button", { name: "Analizar enlace con IA" }).click();
  await expect(articleModal.locator("#article-ai-status")).toContainText("No se pudo extraer información suficiente", {
    timeout: 10_000
  });
  await expect(articleModal.getByLabel("Título")).toHaveValue("Título manual preservado");
  await manualUrlInput.fill("https://pubmed.ncbi.nlm.nih.gov/123456/");
  await expect(articleModal.locator("#article-domain-detected")).toContainText("pubmed.ncbi.nlm.nih.gov");
  await articleModal.getByRole("button", { name: "Analizar enlace con IA" }).click();
  await expect(articleModal.locator("#article-ai-status")).toContainText("Borrador cargado por IA", {
    timeout: 30_000
  });
  await expect(articleModal.getByLabel("Título")).toHaveValue(articleTitle);
  await expect(articleModal.locator("#article-source-name")).toHaveValue("PubMed / MEDLINE");
  await expect(articleModal.getByLabel("Fecha de publicación")).toHaveValue("2026-05-03");
  await expect(articleModal.getByLabel("Objetivo / pregunta")).toHaveValue("Pregunta clínica generada por IA.");
  await expect(articleModal.getByLabel("Mensaje principal")).toHaveValue("Resultado principal generado por IA.");
  await articleModal.getByRole("button", { name: "Editar detalles avanzados" }).click();
  await expect(articleModal.getByLabel("Tipo de estudio")).toHaveValue("Ensayo clínico");
  await expect(articleModal.getByLabel("Tipo de evidencia")).toHaveValue("Investigación clínica");
  await expect(articleModal.getByLabel("Etiquetas")).toHaveValue("QA, Lectura crítica, PubMed, IA");
  await expect(articleModal.getByLabel("Acceso")).toHaveValue("Resumen disponible");
  await expect(articleModal.getByLabel("Descripción ampliada")).toHaveValue(/artículo PubMed/);
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
  await expect(newPost).not.toContainText("Pendiente de revisión");
  await expect(newPost).not.toContainText("Borrador automático");
  await expect(newPost).toContainText("Subido por");
  await expect(newPost).toContainText("Dra. Mobile QA");
  await expect(newPost).toContainText("Carga");
  await expect(newPost).toContainText("Descripción breve generada por IA desde Playwright.");
  await expect(newPost.locator(".bitacora-tag")).toHaveCount(4);
  await expect(newPost.getByRole("link", { name: "Ver fuente original" })).toHaveAttribute(
    "href",
    "https://pubmed.ncbi.nlm.nih.gov/123456/"
  );
  await expect(newPost.getByRole("link", { name: "Ver fuente original" })).toHaveAttribute("target", "_blank");
  await expect(newPost.getByRole("link", { name: "Ver fuente original" }).locator("svg")).toHaveCount(1);
  await expect(newPost.getByRole("button", { name: "Ver documento asociado" })).toHaveCount(0);

  await newPost.getByRole("button", { name: "Resumen Técnico" }).click();
  await expect(newPost.getByRole("button", { name: "Ocultar Resumen Técnico" })).toHaveAttribute("aria-expanded", "true");
  await expect(newPost.locator(".bitacora-analysis")).toBeVisible();
  const newPostExpandedToggle = newPost.locator(".bitacora-expanded-description__toggle").first();
  const newPostExpandedBody = newPost.locator(".bitacora-expanded-description__body").first();
  await expect(newPostExpandedToggle).toHaveAttribute("aria-expanded", "false");
  await expect(newPostExpandedBody).toBeHidden();
  await newPostExpandedToggle.click();
  await expect(newPostExpandedToggle).toHaveAttribute("aria-expanded", "true");
  await expect(newPostExpandedBody).toBeVisible();
  await expect(newPostExpandedBody).toContainText("artículo PubMed");
  await expect(newPost.locator(".bitacora-analysis")).toContainText("Ficha metodológica");
  await expect(newPost.locator(".bitacora-analysis")).toContainText("Ensayo clínico");
  await expect(newPost.locator(".bitacora-analysis")).toContainText("Hospital QA");
  await expect(newPost.locator(".bitacora-analysis")).toContainText("Pregunta clínica generada por IA.");
  await expect(newPost.locator(".bitacora-analysis")).not.toContainText("Confianza");
  await expect(newPost.locator(".bitacora-analysis")).not.toContainText("Usuario");
  await page.keyboard.press("Escape");
  await expect(newPost.locator(".bitacora-analysis")).toBeHidden();
  await newPost.getByRole("button", { name: "Resumen Técnico" }).click();
  await newPost.getByRole("button", { name: "Ocultar Resumen Técnico" }).click();
  await expect(newPost.getByRole("button", { name: "Resumen Técnico" })).toHaveAttribute("aria-expanded", "false");
  await expect(newPost.locator(".bitacora-analysis")).toBeHidden();

  await expect(newPost.getByRole("button", { name: "Editar publicación" })).toBeVisible();
  await newPost.getByRole("button", { name: "Editar publicación" }).click();
  const reauthModal = page.locator("#bitacora-reauth-modal");
  await expect(reauthModal).toBeVisible({ timeout: 10_000 });
  await reauthModal.getByLabel("Contraseña actual").fill("PasswordIncorrecta!123");
  await reauthModal.getByRole("button", { name: "Confirmar" }).click();
  await expect(reauthModal).toContainText("Contraseña incorrecta");
  await reauthModal.getByRole("button", { name: "Cancelar" }).click();
  await expect(reauthModal).toBeHidden();
  await newPost.getByRole("button", { name: "Editar publicación" }).click();
  await confirmSensitiveAction(page);
  await expect(articleModal).toBeVisible({ timeout: 10_000 });
  await expect(articleModal.locator("#add-article-title")).toHaveText("Editar artículo científico");
  await articleModal.getByLabel("Título").fill(`${articleTitle} editado`);
  await articleModal.getByLabel("Descripción breve para tarjeta").fill("Resumen breve actualizado por edición segura.");
  await articleModal.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(articleModal).toBeHidden({ timeout: 30_000 });
  const editedPost = page.locator(".bitacora-post").filter({ hasText: `${articleTitle} editado` }).first();
  await expect(editedPost).toBeVisible({ timeout: 30_000 });
  await expect(editedPost).toContainText("Resumen breve actualizado por edición segura.");

  await editedPost.getByRole("button", { name: "Eliminar publicación" }).click();
  await confirmDeleteAction(page);
  await expect(page.locator(".bitacora-post")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(`${articleTitle} editado`);
  await expect(page.locator("#bitacora-empty")).toBeVisible();
  await expect(page.locator("#bitacora-results-count")).toHaveText("0 artículos agregados");

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const reachedScrollThreshold = await page.evaluate(() => window.scrollY > 420);
  if (reachedScrollThreshold) {
    await expect(page.locator("#scroll-up")).toHaveClass(/show-scroll/);
    const chatBubbleAndScrollUpDoNotOverlap = await page.evaluate(() => {
      const bubble = document.querySelector("#brisa-chat-bubble");
      const scrollUp = document.querySelector("#scroll-up");
      if (!bubble || !scrollUp) return true;
      const bubbleRect = bubble.getBoundingClientRect();
      const scrollRect = scrollUp.getBoundingClientRect();
      return (
        bubbleRect.right <= scrollRect.left ||
        scrollRect.right <= bubbleRect.left ||
        bubbleRect.bottom <= scrollRect.top ||
        scrollRect.bottom <= bubbleRect.top
      );
    });
    expect(chatBubbleAndScrollUpDoNotOverlap).toBe(true);
    await page.locator("#scroll-up").click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(20);
  }
  await expectNoHorizontalOverflow(page);

  if ((page.viewportSize()?.width || 0) >= 1024) {
    await page.goto("/index.html?dmEmulators=1");
    await expect(page.locator("#portal-logbook")).toHaveAttribute("href", "/bitacora-cientifica.html");
  }

  const criticalErrors = consoleErrors.filter(
    (text) =>
      !/favicon|ResizeObserver loop|net::ERR_ABORTED|Could not reach Cloud Firestore backend|Failed to load resource|404|500|OPENAI_API_KEY/i.test(
        text
      )
  );
  expect(criticalErrors).toEqual([]);
});
