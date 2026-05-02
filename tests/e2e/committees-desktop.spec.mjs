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
const EXPECTED_IMAGE_FILES = [
  "committee-emergencias.png",
  "committee-salud-ocupacional.png",
  "committee-calidad-seguridad.png",
  "committee-salud-digital-innovacion.png",
  "committee-docencia-investigacion.png",
  "committee-farmacia-terapeutica.png",
  "committee-bioetica.png"
];
const EXPECTED_COMMITTEE_ASSET_VERSION = "20260502-committee-cards-precision-1";
const DESKTOP_MAX_COMMITTEE_GAP_DELTA = 4;
const parseAssetUrl = (src) => new URL(src, "https://departamento-medico.local/");

const submitLogin = async (page) => {
  await page.locator("#email").fill(QA_EMAIL);
  await page.locator("#password").fill(QA_PASSWORD);
  await page.locator("#login-form").evaluate((form) => form.requestSubmit());
  await page.waitForLoadState("domcontentloaded");
};

const openCommittees = async (page) => {
  await page.goto(COMMITTEES_URL);
  if (await page.locator("#login-form").isVisible({ timeout: 2000 }).catch(() => false)) {
    await submitLogin(page);
    await page.goto(COMMITTEES_URL);
  }
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
  await submitLogin(page);
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
    const fits = (elements) => elements.every((el) => el.scrollWidth <= el.clientWidth + 1);

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
      cards: cards.map((card) => {
        const imageWrap = card.querySelector(".comite__image-wrap");
        const overlay = card.querySelector(".comite__text-overlay");
        const title = card.querySelector(".comite__title");
        const desc = card.querySelector(".comite__desc");
        const titleLines = [...card.querySelectorAll(".comite__title-line")];
        const descLines = [...card.querySelectorAll(".comite__desc-line")];
        const cardRect = card.getBoundingClientRect();
        const imageRect = imageWrap?.getBoundingClientRect();
        const overlayRect = overlay?.getBoundingClientRect();
        const titleRect = title?.getBoundingClientRect();
        const descRect = desc?.getBoundingClientRect();
        const overlayStyle = overlay ? getComputedStyle(overlay) : null;
        const imageBeforeStyle = imageWrap ? getComputedStyle(imageWrap, "::before") : null;
        const imageAfterStyle = imageWrap ? getComputedStyle(imageWrap, "::after") : null;
        const circleBottom = imageRect ? imageRect.top + imageRect.height * (676 / 1254) : 0;
        const heartTop = imageRect ? imageRect.top + imageRect.height * (1062 / 1254) : 0;
        const railTopGap = titleRect ? titleRect.top - circleBottom : Infinity;
        const railBottomGap = descRect ? heartTop - descRect.bottom : Infinity;

        return {
          id: card.getAttribute("data-committee-id"),
          link: card.getAttribute("data-link"),
          role: card.getAttribute("role"),
          tabindex: card.getAttribute("tabindex"),
          ariaLabel: card.getAttribute("aria-label"),
          width: Math.round(cardRect.width),
          height: Math.round(cardRect.height),
          overlayVisible:
            Boolean(overlay) &&
            overlayStyle.display !== "none" &&
            overlayStyle.visibility !== "hidden" &&
            Number(overlayStyle.opacity || 1) > 0 &&
            overlayRect.width > 20 &&
            overlayRect.height > 20,
          overlayInsideImage:
            Boolean(imageRect && overlayRect) &&
            overlayRect.left >= imageRect.left - 1 &&
            overlayRect.right <= imageRect.right + 1 &&
            overlayRect.top >= imageRect.top - 1 &&
            overlayRect.bottom <= imageRect.bottom + 1,
          overlayPointerEvents: overlayStyle?.pointerEvents,
          overlayBackground: overlayStyle?.backgroundColor,
          overlayBorderWidth: overlayStyle?.borderTopWidth,
          overlayBorderRadius: overlayStyle?.borderTopLeftRadius,
          overlayBoxShadow: overlayStyle?.boxShadow,
          imageBeforeBorderWidth: imageBeforeStyle?.borderTopWidth,
          imageBeforeBoxShadow: imageBeforeStyle?.boxShadow,
          imageAfterContent: imageAfterStyle?.content,
          imageAfterDisplay: imageAfterStyle?.display,
          imageAfterBorderWidth: imageAfterStyle?.borderTopWidth,
          titleLineCount: titleLines.length,
          descLineCount: descLines.length,
          railTopGap: Math.round(railTopGap),
          railBottomGap: Math.round(railBottomGap),
          railGapDelta: Math.round(Math.abs(railTopGap - railBottomGap)),
          textFits: fits([...titleLines, ...descLines])
        };
      })
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
      (img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0 && img.alt
    )
  ).toBeTruthy();
  expect(payload.images.map((img) => parseAssetUrl(img.src).pathname.split("/").pop())).toEqual(
    EXPECTED_IMAGE_FILES
  );
  expect(
    payload.images.every(
      (img) => parseAssetUrl(img.src).searchParams.get("v") === EXPECTED_COMMITTEE_ASSET_VERSION
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
  expect(
    payload.cards.every(
      (card) =>
        card.overlayVisible &&
        card.overlayInsideImage &&
        card.overlayPointerEvents === "none" &&
        (card.overlayBackground === "rgba(0, 0, 0, 0)" || card.overlayBackground === "transparent") &&
        card.overlayBorderWidth === "0px" &&
        card.overlayBorderRadius === "0px" &&
        card.overlayBoxShadow === "none" &&
        card.imageBeforeBorderWidth === "0px" &&
        card.imageBeforeBoxShadow !== "none" &&
        card.imageAfterContent === "none" &&
        card.imageAfterDisplay === "none" &&
        card.imageAfterBorderWidth === "0px" &&
        card.titleLineCount === 2 &&
        card.descLineCount === 2 &&
        card.railTopGap > 0 &&
        card.railBottomGap > 0 &&
        card.railGapDelta <= DESKTOP_MAX_COMMITTEE_GAP_DELTA &&
        card.textFits
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
