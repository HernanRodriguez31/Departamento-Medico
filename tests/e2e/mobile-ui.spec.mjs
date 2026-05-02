import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const QA_EMAIL = process.env.MOBILE_QA_EMAIL || "mobile.qa@departamento-medico.test";
const QA_PASSWORD = process.env.MOBILE_QA_PASSWORD || "MobileQa!12345";
const CAPTURE_PHASE = process.env.MOBILE_QA_CAPTURE_PHASE || "after";
const SHOULD_ASSERT = CAPTURE_PHASE !== "before";
const PROFILE_AVATAR_VERSION = "20260430-orgtree-avatars-1";
const PROFILE_AVATAR_JS_VERSION = "20260430-orgtree-avatars-1";
const EXPECTED_COMMITTEE_ASSET_VERSION = "20260502-committee-cards-precision-1";
const EXPECTED_COMMITTEE_IMAGE_FILES = [
  "committee-emergencias.png",
  "committee-salud-ocupacional.png",
  "committee-calidad-seguridad.png",
  "committee-salud-digital-innovacion.png",
  "committee-docencia-investigacion.png",
  "committee-farmacia-terapeutica.png",
  "committee-bioetica.png"
];
const MOBILE_MAX_COMMITTEE_GAP_DELTA = 5;
const DEFAULT_AVATAR_EXPECTATIONS = [
  { uid: "HRodriguez", name: "Hernan Rodriguez", file: "coord-rodriguez-new.png" },
  { uid: "LCura", name: "Dra. Leila Cura", file: "avatar-leila-cura-featured-tight-20260411.png" },
  { uid: "GSilva", name: "Gustavo Silva", file: "avatar-silva-new.png" },
  { uid: "JAzcarate", name: "Juan Martin Azcarate", file: "avatar-azcarate-new.png" },
  { uid: "LMedina", name: "Leandro Medina", file: "avatar-medina-new.png" },
  { uid: "JMaurino", name: "Juan Maurino", file: "coord-maurino-new.png" },
  { uid: "MBianchi", name: "Mario Bianchi", file: "coord-bianchi-new.png" },
  { uid: "SAciar", name: "Sergio Aciar", file: "coord-aciar-new.png" },
  { uid: "RSabha", name: "Roberto Sabha", file: "coord-sabha-new.png" }
];

const screenshotDir = (testInfo) =>
  path.join("test-results", "mobile", CAPTURE_PHASE, testInfo.project.name);

const capture = async (page, testInfo, name) => {
  const dir = screenshotDir(testInfo);
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: false
  });
};

const recordOrAssert = async (testInfo, pass, message, details = null) => {
  if (pass) return;
  console.error(`[mobile-qa] ${message}`, JSON.stringify(details || { message }, null, 2));
  await testInfo.attach(`mobile-qa-${message.replace(/\W+/g, "-").toLowerCase()}`, {
    body: JSON.stringify(details || { message }, null, 2),
    contentType: "application/json"
  });
  if (SHOULD_ASSERT) {
    expect(pass, message).toBeTruthy();
  }
};

const visibleBox = async (locator) =>
  locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });

const assertWithinViewport = async (locator, testInfo, label) => {
  await expect(locator).toBeVisible();
  const box = await visibleBox(locator);
  const pass =
    box.left >= -1 &&
    box.top >= -1 &&
    box.right <= box.viewportWidth + 1 &&
    box.bottom <= box.viewportHeight + 1;
  await recordOrAssert(testInfo, pass, `${label} stays inside viewport`, box);
};

const checkNoHorizontalOverflow = async (page, testInfo, label) => {
  const payload = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const main = document.querySelector("main.main");
    const activeView = body?.dataset?.view === "carrete" ? "muro" : body?.dataset?.view;
    const activePage =
      document.querySelector(`.dm-mobile-page[data-view="${activeView}"]:not(.dm-mobile-page--ghost)`) ||
      document.querySelector(`[data-view="${body?.dataset?.view || ""}"]`);
    const metrics = [root, body, main, activePage].filter(Boolean).map((el) => ({
      label:
        el === root
          ? "html"
          : el === body
            ? "body"
            : el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ""),
      scrollWidth: Math.ceil(el.scrollWidth || 0),
      clientWidth: Math.ceil(el.clientWidth || window.innerWidth || 0)
      }));
    const offenders = [...document.querySelectorAll("body *")]
      .map((el) => {
	        const style = window.getComputedStyle(el);
	        const rect = el.getBoundingClientRect();
	        const pagerPage = el.closest(".dm-mobile-page");
	        const isPagerTrack = el.classList.contains("dm-mobile-pager-track-inner");
	        return {
	          el,
	          rect,
	          isPagerTrack,
	          inInactivePagerPage: Boolean(pagerPage && pagerPage !== activePage),
	          visible:
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || 1) > 0 &&
            rect.width > 1 &&
            rect.height > 1
        };
      })
	      .filter(({ rect, visible, inInactivePagerPage, isPagerTrack }) =>
	        visible &&
	        !isPagerTrack &&
	        !inInactivePagerPage &&
	        (rect.left < -1 || rect.right > window.innerWidth + 1)
	      )
      .slice(0, 12)
      .map(({ el, rect }) => ({
        selector:
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : "") +
          (typeof el.className === "string"
            ? `.${el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".")}`
            : ""),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width)
      }));
    return { metrics, offenders };
  });
  const pass =
    payload.metrics.every((item) => item.scrollWidth <= item.clientWidth + 1) &&
    payload.offenders.length === 0;
  await recordOrAssert(testInfo, pass, `${label} has no horizontal overflow`, payload);
};

const checkTouchTargets = async (page, testInfo, label) => {
  const smallTargets = await page.evaluate(() => {
    const selectors = [
      ".dm-bottom-nav__item",
      ".dm-bottom-nav__fab",
      "body[data-view='carrete'] .dm-muro-composer button",
      "body[data-view='comites'] #comites .comite__card",
      "body[data-view='comites'] #comites .comite__btn-secondary",
      "body[data-view='comites'] #comites .comite__join-btn",
      "body[data-view='foro'] .dm-foro-send-btn",
      "body[data-view='foro'] .dm-foro-message-side button",
      ".user-panel-trigger",
      ".dm-notif-btn",
      ".dm-ai-close"
    ];
    return selectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)]
        .filter((el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        })
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            selector,
            text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 60),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          };
        })
        .filter((item) => item.width < 44 || item.height < 44)
    );
  });
  await recordOrAssert(testInfo, smallTargets.length === 0, `${label} touch targets are at least 44px`, smallTargets);
};

const checkCommitteeImages = async (page, testInfo, label) => {
  const payload = await page.evaluate(() => {
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
  const imageUrls = payload.images.map((img) => new URL(img.src, "https://departamento-medico.local/"));
  const pass =
    payload.cardCount === 7 &&
    payload.imageCount === 7 &&
    payload.statsCount === 0 &&
    payload.footerCount === 0 &&
    payload.actionButtonCount === 0 &&
    imageUrls.map((url) => url.pathname.split("/").pop()).join("|") ===
      EXPECTED_COMMITTEE_IMAGE_FILES.join("|") &&
    payload.images.every(
      (img) =>
        img.complete &&
        img.naturalWidth > 0 &&
        img.naturalHeight > 0 &&
        img.alt
    ) &&
    imageUrls.every(
      (url) =>
        url.searchParams.get("v") === EXPECTED_COMMITTEE_ASSET_VERSION &&
        !url.pathname.includes("committee-graphic-3")
    ) &&
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
        card.railGapDelta <= MOBILE_MAX_COMMITTEE_GAP_DELTA &&
        card.textFits
    );
  await recordOrAssert(testInfo, pass, `${label} committee images load`, payload);
};

const checkDefaultProfileAvatars = async (page, testInfo, label) => {
  const payload = await page.evaluate(
    async ({ users, assetVersion, jsVersion }) => {
      const profiles = await import(`/assets/js/common/user-profiles.js?v=${jsVersion}`);
      const root = document.createElement("div");
      root.setAttribute("data-mobile-qa-avatar-root", "1");
      root.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;";
      root.innerHTML = users
        .map(
          (user) => `
            <span data-author-uid="${user.uid}" data-author-name="${user.name}">
              <img data-author-avatar alt="" hidden>
              <span data-avatar-fallback="initials"></span>
            </span>
          `
        )
        .join("");
      document.body.appendChild(root);

      await profiles.hydrateAvatars(root);
      const images = [...root.querySelectorAll("img")];
      await Promise.all(
        images.map((img) => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
            setTimeout(resolve, 3000);
          });
        })
      );

      const resolved = users.map((user, index) => {
        const node = root.querySelector(`[data-author-uid="${user.uid}"]`);
        const img = images[index];
        const fallback = node?.querySelector("[data-avatar-fallback]");
        return {
          uid: user.uid,
          file: user.file,
          src: img?.src || "",
          hidden: Boolean(img?.hidden),
          complete: Boolean(img?.complete),
          naturalWidth: img?.naturalWidth || 0,
          fallbackHidden: Boolean(fallback?.hidden)
        };
      });
      root.remove();

      const userSelectedProfile = profiles.buildProfileFromDoc(
        {
          nombre: "Hernan Rodriguez",
          avatarUrl: "/custom/avatar.jpg",
          avatarUpdatedAt: 123,
          defaultAvatarUrl: "/assets/images/coord-rodriguez-new.png?v=firestore-default",
          defaultAvatarUpdatedAt: 456,
          profilePhotoUrl: "/legacy/profile.jpg",
          photoURL: "/legacy/auth.jpg"
        },
        "",
        { uid: "HRodriguez", email: "HRodriguez@pan-energy.com" }
      );
      const firestoreDefaultProfile = profiles.buildProfileFromDoc(
        {
          nombre: "Hernan Rodriguez",
          defaultAvatarUrl: "/assets/images/coord-rodriguez-new.png?v=firestore-default",
          defaultAvatarUpdatedAt: 456,
          profilePhotoUrl: "/legacy/profile.jpg",
          photoURL: "/legacy/auth.jpg"
        },
        "",
        { uid: "HRodriguez", email: "HRodriguez@pan-energy.com" }
      );
      const localDefaultProfile = profiles.buildProfileFromDoc(
        {
          nombre: "Hernan Rodriguez",
          profilePhotoUrl: "/legacy/profile.jpg",
          photoURL: "/legacy/auth.jpg"
        },
        "",
        { uid: "HRodriguez", email: "HRodriguez@pan-energy.com" }
      );
      const legacyProfile = profiles.buildProfileFromDoc(
        {
          nombre: "Usuario Legacy",
          profilePhotoUrl: "/legacy/profile.jpg",
          photoURL: "/legacy/auth.jpg"
        },
        "",
        { uid: "UnknownUser", email: "unknown@example.com" }
      );
      const authLegacyProfile = profiles.buildProfileFromDoc(
        {
          nombre: "Usuario Legacy",
          photoURL: "/legacy/auth.jpg"
        },
        "",
        { uid: "UnknownUser2", email: "unknown2@example.com" }
      );
      const input = document.querySelector("[data-dm-user-avatar-input]");

      return {
        resolved,
        assetVersion,
        userSelectedProfile,
        firestoreDefaultProfile,
        localDefaultProfile,
        legacyProfile,
        authLegacyProfile,
        input: {
          found: Boolean(input),
          accept: input?.getAttribute("accept") || ""
        }
      };
    },
    {
      users: DEFAULT_AVATAR_EXPECTATIONS,
      assetVersion: PROFILE_AVATAR_VERSION,
      jsVersion: PROFILE_AVATAR_JS_VERSION
    }
  );

  const pass =
    payload.resolved.length === DEFAULT_AVATAR_EXPECTATIONS.length &&
    payload.resolved.every(
      (item) =>
        !item.hidden &&
        item.complete &&
        item.naturalWidth > 0 &&
        item.fallbackHidden &&
        item.src.includes(item.file) &&
        item.src.includes(PROFILE_AVATAR_VERSION)
    ) &&
    payload.userSelectedProfile.avatarUrl === "/custom/avatar.jpg" &&
    payload.userSelectedProfile.avatarUpdatedAt === 123 &&
    payload.firestoreDefaultProfile.avatarUrl.includes("firestore-default") &&
    payload.firestoreDefaultProfile.avatarUpdatedAt === 456 &&
    payload.localDefaultProfile.avatarUrl.includes("coord-rodriguez-new.png") &&
    payload.localDefaultProfile.avatarUrl.includes(PROFILE_AVATAR_VERSION) &&
    !payload.localDefaultProfile.avatarUrl.includes("/legacy/") &&
    payload.legacyProfile.avatarUrl === "/legacy/profile.jpg" &&
    payload.authLegacyProfile.avatarUrl === "/legacy/auth.jpg" &&
    payload.input.found &&
    payload.input.accept === "image/*";

  await recordOrAssert(testInfo, pass, `${label} default avatars resolve`, payload);
};

const waitForMobileViewSettled = async (page, route) => {
  const bodyView = route === "muro" ? "carrete" : route;
  await page.waitForFunction((view) => document.body?.dataset?.view === view, bodyView);
  await page.waitForFunction((routeName) => {
    const activeView = routeName === "muro" ? "muro" : routeName;
    const activePage = document.querySelector(`.dm-mobile-page[data-view="${activeView}"]:not(.dm-mobile-page--ghost)`);
    if (!activePage) return true;
    const rect = activePage.getBoundingClientRect();
    return Math.abs(rect.left) <= 1 && Math.abs(rect.right - window.innerWidth) <= 1;
  }, route);
};

const navigateMobile = async (page, route) => {
  await page.locator(`[data-route="${route}"]`).click();
  await waitForMobileViewSettled(page, route);
};

const checkVerticalScroll = async (page, testInfo, route) => {
  await navigateMobile(page, route);
  const result = await page.evaluate((view) => {
    const bodyView = view === "muro" ? "carrete" : view;
    const scroller =
      view === "foro"
        ? document.querySelector("#forum-messages-general")
        : document.querySelector(`.dm-mobile-page[data-view="${view}"] .dm-mobile-page__scroller`) ||
          document.querySelector("main.main");
    if (!scroller) return { view, found: false };
    const before = scroller.scrollTop;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTop = Math.min(Math.max(maxScroll, 0), 140);
    return {
      view: bodyView,
      found: true,
      before,
      after: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      canScroll: scroller.scrollHeight > scroller.clientHeight + 20,
      moved: scroller.scrollTop > before || scroller.scrollHeight <= scroller.clientHeight + 20
    };
  }, route);
  await recordOrAssert(testInfo, result.found && result.moved, `${route} vertical scroll works`, result);
};

test.describe.configure({ mode: "serial" });

test("mobile isolated audit flow", async ({ page }, testInfo) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/login.html?dmEmulators=1&next=%23foro");
  await expect(page.locator("#login-form")).toBeVisible();
  await capture(page, testInfo, "01-login");

  await page.locator(".forgot-password").click();
  await assertWithinViewport(page.locator("#forgot-modal.active .modal-card"), testInfo, "forgot modal");
  await capture(page, testInfo, "02-login-forgot-modal");
  await page.locator("#forgot-modal .modal-close-btn").click();

  await page.locator("#email").fill(QA_EMAIL);
  await page.locator("#password").fill(QA_PASSWORD);
  await page.locator("#login-form").evaluate((form) => form.requestSubmit());
  await page.waitForURL(/\/app\/index\.html\?dmEmulators=1#foro$/, { timeout: 30_000 });

  await expect(page.locator(".dm-bottom-nav")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__dmMobileShell) && document.body?.dataset?.view);
  await page.locator("#app-splash").waitFor({ state: "detached", timeout: 6_000 }).catch(() => {});
  await waitForMobileViewSettled(page, "foro");
  await capture(page, testInfo, "03-foro-after-login");
  await checkNoHorizontalOverflow(page, testInfo, "foro after login");
  await checkTouchTargets(page, testInfo, "foro after login");

  await page.locator("#forum-messages-general").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(150);
  const forumTopBefore = await page.locator("#forum-messages-general").evaluate((el) => el.scrollTop);
  await page.waitForTimeout(500);
  const forumTopAfter = await page.locator("#forum-messages-general").evaluate((el) => el.scrollTop);
  await recordOrAssert(
    testInfo,
    Math.abs(forumTopAfter - forumTopBefore) <= 2,
    "forum does not force-scroll while reading",
    { forumTopBefore, forumTopAfter }
  );

  await navigateMobile(page, "muro");
  await capture(page, testInfo, "04-muro");
  await checkNoHorizontalOverflow(page, testInfo, "muro");
  await checkTouchTargets(page, testInfo, "muro");

  await navigateMobile(page, "estructura");
  await capture(page, testInfo, "05-estructura");
  await checkNoHorizontalOverflow(page, testInfo, "estructura");

  await navigateMobile(page, "comites");
  await capture(page, testInfo, "06-comites");
  await checkNoHorizontalOverflow(page, testInfo, "comites");
  await checkCommitteeImages(page, testInfo, "comites");
  await checkTouchTargets(page, testInfo, "comites");

  await navigateMobile(page, "foro");
  await capture(page, testInfo, "07-foro");

  for (const route of ["muro", "estructura", "comites", "foro"]) {
    await checkVerticalScroll(page, testInfo, route);
  }

  await page.locator("[data-dm-user-trigger]").click();
  await assertWithinViewport(page.locator("[data-dm-user-dropdown]"), testInfo, "user menu");
  await capture(page, testInfo, "08-user-menu");
  await checkDefaultProfileAvatars(page, testInfo, "profile avatars");

  await page.keyboard.press("Escape").catch(() => {});
  await navigateMobile(page, "ia");
  await expect(page.locator(".dm-mobile-page__ai-host")).toBeVisible();
  await capture(page, testInfo, "09-ia");
  const aiPanel = page.locator(".dm-ai-shell--embedded .dm-ai-panel").first();
  if (await aiPanel.count()) {
    await assertWithinViewport(aiPanel, testInfo, "embedded AI panel");
  }

  await checkNoHorizontalOverflow(page, testInfo, "final app state");
  await recordOrAssert(
    testInfo,
    consoleErrors.filter(
      (text) => !/favicon|net::ERR_ABORTED|ResizeObserver loop|Could not reach Cloud Firestore backend/i.test(text)
    ).length === 0,
    "no critical console errors",
    consoleErrors
      .filter((text) => !/favicon|net::ERR_ABORTED|ResizeObserver loop|Could not reach Cloud Firestore backend/i.test(text))
      .slice(0, 20)
  );
});
