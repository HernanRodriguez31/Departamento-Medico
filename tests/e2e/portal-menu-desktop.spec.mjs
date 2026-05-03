import { expect, test } from "@playwright/test";

const QA_EMAIL = process.env.MOBILE_QA_EMAIL || "mobile.qa@departamento-medico.test";
const QA_PASSWORD = process.env.MOBILE_QA_PASSWORD || "MobileQa!12345";
const PORTAL_URL = "/index.html?desktop=1&dmEmulators=1#kpi";
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
  await expect(page.locator("#portal-bubble .portal-link")).toHaveCount(3);
};

const tooltipOpacity = async (locator) =>
  locator.locator(".portal-link__tooltip").evaluate((el) => Number(getComputedStyle(el).opacity));

const expectTooltipVisible = async (locator) => {
  await expect.poll(() => tooltipOpacity(locator)).toBeGreaterThan(0.9);
};

const expectTooltipHidden = async (locator) => {
  await expect.poll(() => tooltipOpacity(locator)).toBeLessThan(0.1);
};

test("desktop portal cube opens three accessible actions", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(LOGIN_URL);
  await expect(page.locator("#login-form")).toBeVisible();
  await submitLogin(page);
  await page.waitForURL(/\/index\.html\?desktop=1&dmEmulators=1#kpi$/, { timeout: 30_000 });

  await expect(page.locator(".dm-desktop-sidebar")).toBeVisible();
  await openPortalMenu(page);

  const actions = page.locator("#portal-bubble .portal-link");
  await expect(actions.nth(0)).toHaveAttribute("aria-label", "Galería de Arte");
  await expect(actions.nth(1)).toHaveAttribute("aria-label", "Gestión operativa");
  await expect(actions.nth(2)).toHaveAttribute("aria-label", "Bitácora Científica");
  await expect(page.locator("#portal-action")).toHaveAttribute(
    "href",
    "https://brisasaludybienestar.com/"
  );
  await expect(page.locator("#portal-logbook")).toHaveAttribute("aria-disabled", "true");

  await expect(page.locator("#portal-gallery")).not.toBeFocused();
  await expectTooltipHidden(page.locator("#portal-gallery"));
  await expectTooltipHidden(page.locator("#portal-action"));
  await expectTooltipHidden(page.locator("#portal-logbook"));

  await page.locator("#portal-gallery").hover();
  await expectTooltipVisible(page.locator("#portal-gallery"));
  await page.locator("#portal-action").hover();
  await expectTooltipVisible(page.locator("#portal-action"));
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
  await expect(page.locator("#portal-logbook")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#portal-action")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#btn-portal")).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.locator("#portal-gallery")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#btn-portal")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#portal-bubble")).toHaveAttribute("aria-hidden", "true");

  await openPortalMenu(page);
  const beforeDisabled = await page.evaluate(() => ({ href: location.href, scrollY: window.scrollY }));
  await page.locator("#portal-logbook").click({ force: true });
  await page.waitForTimeout(200);
  const afterDisabled = await page.evaluate(() => ({ href: location.href, scrollY: window.scrollY }));
  expect(afterDisabled.href).toBe(beforeDisabled.href);
  expect(Math.abs(afterDisabled.scrollY - beforeDisabled.scrollY)).toBeLessThanOrEqual(2);
  await expect(page.locator("#btn-portal")).toHaveAttribute("aria-expanded", "true");

  await page.locator("#portal-gallery").click();
  await page.waitForFunction(() => {
    const target = document.querySelector("#carrete");
    const header = document.querySelector("#header");
    if (!target) return false;
    const expectedTop = (header?.getBoundingClientRect().height || 0) + 16;
    return Math.abs(target.getBoundingClientRect().top - expectedTop) <= 28;
  });
  await expect(page.locator("#btn-portal")).toHaveAttribute("aria-expanded", "false");

  const criticalErrors = consoleErrors.filter(
    (text) => !/favicon|net::ERR_ABORTED|ResizeObserver loop|Could not reach Cloud Firestore backend/i.test(text)
  );
  expect(criticalErrors).toEqual([]);
});
