import { expect, test } from "@playwright/test";

const QA_EMAIL = process.env.MOBILE_QA_EMAIL || "mobile.qa@departamento-medico.test";
const QA_PASSWORD = process.env.MOBILE_QA_PASSWORD || "MobileQa!12345";
const PORTAL_URL = "/index.html?dmEmulators=1#kpi";
const LOGIN_URL = `/login.html?dmEmulators=1&next=${encodeURIComponent(PORTAL_URL)}`;

const submitLogin = async (page) => {
  await page.locator("#email").fill(QA_EMAIL);
  await page.locator("#password").fill(QA_PASSWORD);
  await page.locator("#login-form").evaluate((form) => form.requestSubmit());
  await page.waitForLoadState("domcontentloaded");
};

const openPortalMenu = async (page) => {
  const portalButton = page.locator("#btn-portal");
  await expect(portalButton).toBeVisible();
  await portalButton.click();
  await expect(portalButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#portal-bubble")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#portal-bubble .portal-link")).toHaveCount(4);
};

const tooltipOpacity = async (locator) =>
  locator.locator(".portal-link__tooltip").evaluate((el) => Number(getComputedStyle(el).opacity));

const expectTooltipVisible = async (locator) => {
  await expect.poll(() => tooltipOpacity(locator)).toBeGreaterThan(0.9);
};

const expectTooltipHidden = async (locator) => {
  await expect.poll(() => tooltipOpacity(locator)).toBeLessThan(0.1);
};

test("desktop portal cube opens four accessible radial actions", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(LOGIN_URL);
  await expect(page.locator("#login-form")).toBeVisible();
  await submitLogin(page);
  await page.waitForURL(/\/index\.html\?dmEmulators=1#kpi$/, { timeout: 30_000 });

  await expect(page.locator(".dm-desktop-sidebar")).toBeVisible();
  await openPortalMenu(page);

  const actions = page.locator("#portal-bubble .portal-link");
  await expect(actions.nth(0)).toHaveAttribute("aria-label", "Galería de Arte");
  await expect(actions.nth(1)).toHaveAttribute("aria-label", "Gestión operativa");
  await expect(actions.nth(2)).toHaveAttribute("aria-label", "Intereses y Hobbies del Equipo");
  await expect(actions.nth(3)).toHaveAttribute("aria-label", "Abrir Bitácora Científica");
  await expect(page.locator("#portal-action")).toHaveAttribute(
    "href",
    "https://brisasaludybienestar.com/"
  );
  await expect(page.locator("#portal-gallery")).toHaveAttribute("href", "/galeriadearte.html");
  await expect(page.locator("#portal-hobbies")).toHaveAttribute("href", "#intereses-hobbies");
  await expect(page.locator("#portal-logbook")).toHaveAttribute("href", "/bitacora-cientifica.html");

  const radialLayout = await page.locator("#portal-wrapper").evaluate((wrapper) => {
    const cube = wrapper.querySelector("#btn-portal")?.getBoundingClientRect();
    const links = Array.from(wrapper.querySelectorAll(".portal-link")).map((link) => {
      const rect = link.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        width: Math.round(rect.width)
      };
    });
    return {
      centerX: cube ? Math.round(cube.left + cube.width / 2) : 0,
      centerY: cube ? Math.round(cube.top + cube.height / 2) : 0,
      links
    };
  });
  expect(radialLayout.links).toHaveLength(4);
  expect(radialLayout.links.every((link) => link.x > radialLayout.centerX)).toBe(true);
  expect(new Set(radialLayout.links.map((link) => link.x)).size).toBeGreaterThan(1);
  expect(new Set(radialLayout.links.map((link) => link.y)).size).toBe(4);
  expect(radialLayout.links[0].x).toBeLessThan(radialLayout.links[1].x);
  expect(radialLayout.links[3].x).toBeLessThan(radialLayout.links[2].x);
  const adjacentDistances = radialLayout.links.slice(1).map((link, index) => {
    const previous = radialLayout.links[index];
    return Math.hypot(link.x - previous.x, link.y - previous.y);
  });
  expect(Math.max(...adjacentDistances) - Math.min(...adjacentDistances)).toBeLessThanOrEqual(4);
  expect(Math.min(...adjacentDistances)).toBeGreaterThanOrEqual(radialLayout.links[0].width + 2);

  await expect(page.locator("#portal-gallery")).not.toBeFocused();
  await expectTooltipHidden(page.locator("#portal-gallery"));
  await expectTooltipHidden(page.locator("#portal-action"));
  await expectTooltipHidden(page.locator("#portal-hobbies"));
  await expectTooltipHidden(page.locator("#portal-logbook"));

  await page.locator("#portal-gallery").hover();
  await expectTooltipVisible(page.locator("#portal-gallery"));
  await page.locator("#portal-action").hover();
  await expectTooltipVisible(page.locator("#portal-action"));
  await page.locator("#portal-hobbies").hover();
  await expectTooltipVisible(page.locator("#portal-hobbies"));
  await page.locator("#portal-logbook").hover();
  await expectTooltipVisible(page.locator("#portal-logbook"));

  await page.locator("#btn-portal").click();
  await expect(page.locator("#btn-portal")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#btn-portal").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#portal-gallery")).toBeFocused();
  await expectTooltipVisible(page.locator("#portal-gallery"));
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#portal-action")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#portal-hobbies")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#portal-logbook")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#portal-hobbies")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#btn-portal")).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.locator("#portal-gallery")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#btn-portal")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#portal-bubble")).toHaveAttribute("aria-hidden", "true");

  await openPortalMenu(page);
  await page.locator("#portal-gallery").click();
  await page.waitForURL(/\/galeriadearte\.html\?dmEmulators=1$/, { timeout: 30_000 });
  await expect(page.locator("#art-gallery-heading")).toHaveText("Galería de Arte");

  await page.goto(PORTAL_URL);
  await openPortalMenu(page);
  await page.locator("#portal-logbook").click();
  await page.waitForURL(/\/bitacora-cientifica\.html\?dmEmulators=1$/, { timeout: 30_000 });
  await expect(page.locator("#bitacora-heading")).toHaveText("Bitácora de Ciencia Médica");

  const criticalErrors = consoleErrors.filter(
    (text) => !/favicon|net::ERR_ABORTED|ResizeObserver loop|Could not reach Cloud Firestore backend/i.test(text)
  );
  expect(criticalErrors).toEqual([]);
});
