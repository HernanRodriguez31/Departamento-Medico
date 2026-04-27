import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const QA_EMAIL = process.env.MOBILE_QA_EMAIL || "mobile.qa@departamento-medico.test";
const QA_PASSWORD = process.env.MOBILE_QA_PASSWORD || "MobileQa!12345";
const COMMITTEES_URL = "/index.html?desktop=1&dmEmulators=1#comites";
const LOGIN_URL = `/login.html?dmEmulators=1&next=${encodeURIComponent(COMMITTEES_URL)}`;

const screenshotPath = path.join(
  "test-results",
  "committees",
  "after",
  "desktop-1440",
  "comites.png"
);

const openCommittees = async (page) => {
  await page.goto(COMMITTEES_URL);
  await page.locator("#comites").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#comites .comite__image")].every(
      (img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
    )
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#comites .comite__card")].every(
      (card) => card.getAttribute("role") === "link" && card.getAttribute("tabindex") === "0"
    )
  );
};

test("desktop committees image cards render and remain clickable", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(LOGIN_URL);
  await expect(page.locator("#login-form")).toBeVisible();
  await page.locator("#email").fill(QA_EMAIL);
  await page.locator("#password").fill(QA_PASSWORD);
  await page.locator("#login-form").evaluate((form) => form.requestSubmit());
  await page.waitForURL(/\/index\.html\?desktop=1&dmEmulators=1#comites$/, { timeout: 30_000 });

  await openCommittees(page);

  const payload = await page.evaluate(() => {
    const root = document.documentElement;
    const cards = [...document.querySelectorAll("#comites .comite__card")];
    const images = [...document.querySelectorAll("#comites .comite__image")];
    const stats = [...document.querySelectorAll("#comites .committee-stats")];
    const footers = [...document.querySelectorAll("#comites .comite__card-footer")];
    const actionButtons = [
      ...document.querySelectorAll("#comites .comite__join-btn, #comites .comite__btn-secondary")
    ];
    return {
      cardCount: cards.length,
      imageCount: images.length,
      statsCount: stats.length,
      footerCount: footers.length,
      actionButtonCount: actionButtons.length,
      documentWidth: root.scrollWidth,
      viewportWidth: root.clientWidth,
      images: images.map((img) => ({
        src: img.getAttribute("src"),
        alt: img.getAttribute("alt"),
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      })),
      cards: cards.map((card) => ({
        id: card.getAttribute("data-committee-id"),
        link: card.getAttribute("data-link"),
        role: card.getAttribute("role"),
        tabindex: card.getAttribute("tabindex"),
        ariaLabel: card.getAttribute("aria-label"),
        width: Math.round(card.getBoundingClientRect().width),
        height: Math.round(card.getBoundingClientRect().height)
      }))
    };
  });

  expect(payload.cardCount).toBe(7);
  expect(payload.imageCount).toBe(7);
  expect(payload.statsCount).toBe(0);
  expect(payload.footerCount).toBe(0);
  expect(payload.actionButtonCount).toBe(0);
  expect(payload.documentWidth).toBeLessThanOrEqual(payload.viewportWidth + 1);
  expect(
    payload.images.every(
      (img) =>
        img.complete &&
        img.naturalWidth > 0 &&
        img.naturalHeight > 0 &&
        img.alt &&
        img.src.includes("committee-graphic-3")
    )
  ).toBeTruthy();
  expect(
    payload.cards.every(
      (card) =>
        card.id &&
        card.link &&
        card.role === "link" &&
        card.tabindex === "0" &&
        card.ariaLabel &&
        card.width >= 44 &&
        card.height >= 44
    )
  ).toBeTruthy();

  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const criticalErrors = consoleErrors.filter(
    (text) => !/favicon|net::ERR_ABORTED|ResizeObserver loop|Could not reach Cloud Firestore backend/i.test(text)
  );
  expect(criticalErrors).toEqual([]);

  const links = payload.cards.map((card) => card.link);
  for (let index = 0; index < links.length; index += 1) {
    await openCommittees(page);
    const expectedPath = new URL(links[index], page.url()).pathname;
    await page.locator("#comites .comite__card").nth(index).click();
    await page.waitForURL((url) => url.pathname === expectedPath, { timeout: 10_000 });
  }
});
