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
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

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
  await expect(page.locator(".bitacora-intro-segment")).toContainText(
    "Evidencia médica curada para lectura crítica"
  );
  const sourcesTrigger = page.getByRole("button", { name: "Fuentes recomendadas" });
  await expect(sourcesTrigger).toBeVisible();
  await expect(page.locator(".bitacora-publications-panel")).toBeVisible();
  await expect(page.locator(".bitacora-publications-panel")).toHaveCSS("background-color", /rgba?|rgb/);
  await expect(page.locator("#bitacora-publicaciones-title")).toHaveText("Publicaciones científicas");
  await expect(page.getByRole("button", { name: "Agregar artículo" })).toBeVisible();

  await expect(page.locator(".bitacora-editorial-model")).toHaveCount(0);
  await expect(page.locator(".bitacora-value-strip")).toHaveCount(0);
  await expect(page.locator(".bitacora-anchor-nav")).toHaveCount(0);
  await expect(page.getByText("Modelo editorial")).toHaveCount(0);
  await expect(page.getByText("Criterio editorial")).toHaveCount(0);
  await expect(page.getByText("Cómo leer cada entrada")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Advertencia sobre preprints y evidencia");
  await expect(page.locator(".scientific-source-card:visible")).toHaveCount(0);

  await expect.poll(() => page.locator(".bitacora-post").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  await expect(page.locator(".bitacora-post").first()).toHaveCSS("background-color", /rgba?|rgb/);
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
  await expect(articleModal.getByLabel("URL del artículo o paper")).toBeVisible();
  await expect(articleModal).toContainText("Cargado por");
  await expect(articleModal).toContainText("Pendiente de revisión");

  await articleModal.getByLabel("URL del artículo o paper").fill("javascript:alert(1)");
  await articleModal.getByRole("button", { name: "Analizar enlace con IA" }).click();
  await expect(articleModal.locator("#article-url-error")).toContainText("URL", { timeout: 10_000 });

  await articleModal.getByLabel("URL del artículo o paper").fill("https://pubmed.ncbi.nlm.nih.gov/123456/");
  await expect(articleModal.locator("#article-domain-detected")).toContainText("pubmed.ncbi.nlm.nih.gov");
  await articleModal.getByRole("button", { name: "Analizar enlace con IA" }).click();
  await expect(articleModal.locator("#article-ai-status")).toContainText(/Borrador|endpoint seguro|manual|Analizando/i, {
    timeout: 30_000
  });

  await articleModal.getByLabel("Título").fill(articleTitle);
  await articleModal.getByLabel("Fuente / revista / sitio científico").fill("PubMed / MEDLINE");
  await articleModal.getByLabel("Enlace oficial").fill("https://pubmed.ncbi.nlm.nih.gov/123456/");
  await articleModal.getByLabel("Tipo de estudio").fill("Ensayo clínico");
  await articleModal.getByLabel("Tipo de evidencia").fill("Investigación clínica");
  await articleModal.getByLabel("Fecha de publicación").fill("2026-05-03");
  await articleModal.getByLabel("Lugar / contexto del estudio").fill("Contexto hospitalario");
  await articleModal.getByLabel("Resumen ejecutivo").fill("Resumen manual cargado desde Playwright.");
  await articleModal.getByLabel("Pregunta que busca responder").fill("Pregunta clínica de prueba.");
  await articleModal.getByLabel("Resultado principal").fill("Resultado principal de prueba.");
  await articleModal.getByLabel("Etiquetas").fill("QA, Lectura crítica, PubMed, Extra");
  await articleModal.getByLabel("Comentario breve del usuario").fill("Comentario interno de prueba.");
  await articleModal.getByRole("button", { name: "Guardar artículo" }).click();
  await expect(articleModal).toBeHidden({ timeout: 30_000 });

  const newPost = page.locator(".bitacora-post").filter({ hasText: articleTitle }).first();
  await expect(newPost).toBeVisible({ timeout: 30_000 });
  await expect(newPost).toContainText("Pendiente de revisión");
  await expect(newPost).toContainText("Dra. Mobile QA");
  await expect(newPost).toContainText("Resumen manual cargado desde Playwright.");
  await expect(newPost.locator(".bitacora-tag")).toHaveCount(4);

  await newPost.getByRole("button", { name: "Leer análisis" }).click();
  await expect(newPost.getByRole("button", { name: "Ocultar análisis" })).toHaveAttribute("aria-expanded", "true");
  await expect(newPost.locator(".bitacora-analysis")).toBeVisible();
  await expect(newPost.locator(".bitacora-analysis")).toContainText("Pregunta clínica de prueba.");
  await newPost.getByRole("button", { name: "Ocultar análisis" }).click();
  await expect(newPost.getByRole("button", { name: "Leer análisis" })).toHaveAttribute("aria-expanded", "false");
  await expect(newPost.locator(".bitacora-analysis")).toBeHidden();

  await page.locator("#bitacora-reset").click();
  await page.locator("#bitacora-search").fill(articleTitle);
  await expect(page.locator(".bitacora-post")).toHaveCount(1);
  await expect(page.locator(".bitacora-post")).toContainText(articleTitle);
  await page.locator("#bitacora-reset").click();
  await page.locator("#bitacora-filter-evidence").selectOption("Investigación clínica");
  await expect(page.locator(".bitacora-post").filter({ hasText: articleTitle })).toHaveCount(1);
  await page.locator("#bitacora-reset").click();
  await page.locator("#bitacora-filter-status").selectOption("pending_review");
  await expect(page.locator(".bitacora-post").filter({ hasText: articleTitle })).toHaveCount(1);
  await page.locator("#bitacora-reset").click();
  await page.locator("#bitacora-search").fill("sin resultados para auditoria");
  await expect(page.locator(".bitacora-post")).toHaveCount(0);
  await expect(page.locator("#bitacora-empty")).toBeVisible();
  await page.locator("#bitacora-reset").click();

  await page.locator("#art-gallery-return-home").scrollIntoViewIfNeeded();
  await expect(page.locator("#scroll-up")).toHaveClass(/show-scroll/);
  await page.locator("#scroll-up").click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(20);
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
