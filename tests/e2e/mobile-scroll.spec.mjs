import { expect, test } from "@playwright/test";

const QA_EMAIL = process.env.MOBILE_QA_EMAIL || "mobile.qa@departamento-medico.test";
const QA_PASSWORD = process.env.MOBILE_QA_PASSWORD || "MobileQa!12345";
const MOBILE_BASE_URL = (process.env.MOBILE_BASE_URL || "").replace(/\/+$/, "");
const LIVE_EMAIL = process.env.MOBILE_LIVE_EMAIL || QA_EMAIL;
const LIVE_PASSWORD = process.env.MOBILE_LIVE_PASSWORD || QA_PASSWORD;

const ignoredConsolePattern =
  /favicon|net::ERR_ABORTED|ResizeObserver loop|Could not reach Cloud Firestore backend|Tailwind CDN|Notification permission|messaging\/permission-blocked/i;

test.describe.configure({ mode: "serial" });

const collectConsoleErrors = (page) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  return consoleErrors;
};

const liveAppUrl = (hash = "carrete") => `${MOBILE_BASE_URL}/app/index.html#${hash}`;

const waitForMobileAppReady = async (page) => {
  await expect(page.locator(".dm-bottom-nav")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__dmMobileShell?.getPagerState) && document.body?.dataset?.view);
  await page.locator("#app-splash").waitFor({ state: "detached", timeout: 6_000 }).catch(() => {});
  await waitForPagerStable(page);
};

const loginToMobileApp = async (page, hash = "carrete") => {
  if (MOBILE_BASE_URL) {
    await page.goto(liveAppUrl(hash), { waitUntil: "domcontentloaded" });
    const loginForm = page.locator("#login-form");
    await page.waitForTimeout(900);
    if (page.url().includes("/login.html") || (await loginForm.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await page.locator("#email").fill(LIVE_EMAIL);
      await page.locator("#password").fill(LIVE_PASSWORD);
      await loginForm.evaluate((form) => form.requestSubmit());
      await page.waitForURL(new RegExp(`/app/index\\.html(?:\\?[^#]*)?#${hash}$`), { timeout: 35_000 });
    }
    await waitForMobileAppReady(page);
    return;
  }

  const targetPattern = new RegExp(`/app/index\\.html\\?dmEmulators=1#${hash}$`);
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto(`/login.html?dmEmulators=1&next=%23${hash}&scrollRetry=${attempt}`);
    await expect(page.locator("#login-form")).toBeVisible();
    await page.locator("#email").fill(QA_EMAIL);
    await page.locator("#password").fill(QA_PASSWORD);
    await page.locator("#login-form").evaluate((form) => form.requestSubmit());
    try {
      await page.waitForURL(targetPattern, { timeout: attempt === 1 ? 20_000 : 35_000 });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const errorText = await page.locator("#error-msg").textContent().catch(() => "");
      const hasVisibleError = await page.locator("#error-msg").isVisible().catch(() => false);
      if (hasVisibleError && String(errorText || "").trim()) {
        throw error;
      }
    }
  }
  if (lastError) throw lastError;
  await waitForMobileAppReady(page);
};

const getScrollDiagnostics = async (page) =>
  page.evaluate(() => {
    const shellState = window.__dmMobileShell?.debugScrollState?.() || {};
    const verticalState = window.__dmMobileShell?.getVerticalScrollDiagnostics?.() || {};
    const pagerState = window.__dmMobileShell?.getPagerState?.() || shellState.pagerState || {};
    const track = document.querySelector(".dm-mobile-pager-track");
    const activeView = window.__dmMobileShell?.getCurrentViewId?.() || "muro";
    const activePage = document.querySelector(`.dm-mobile-page[data-view="${activeView}"]`);
    const scroller =
      activeView === "foro"
        ? document.querySelector("#forum-messages-general")
        : activePage?.querySelector(".dm-mobile-page__scroller") || document.querySelector("main.main");
    const root = document.getElementById("brisa-chat-root");
    const overlay = document.getElementById("brisa-chat-mobile-overlay");
    const viewport = document.getElementById("brisa-chat-mobile-viewport");
    const overlayStyle = overlay ? getComputedStyle(overlay) : null;
    const bodyStyle = getComputedStyle(document.body);
    const htmlStyle = getComputedStyle(document.documentElement);
    const pagerIndex = Number.isFinite(pagerState.pageIndex) ? pagerState.pageIndex : 0;
    const pagerDragX = Number.isFinite(pagerState.dragX) ? pagerState.dragX : 0;
    return {
      ...shellState,
      ...verticalState,
      activeView,
      bodyInlineOverflow: document.body.style.overflow || "",
      bodyInlineTouchAction: document.body.style.touchAction || "",
      htmlInlineOverflow: document.documentElement.style.overflow || "",
      htmlInlineTouchAction: document.documentElement.style.touchAction || "",
      bodyComputedOverflow: bodyStyle.overflow || "",
      bodyComputedTouchAction: bodyStyle.touchAction || "",
      htmlComputedOverflow: htmlStyle.overflow || "",
      htmlComputedTouchAction: htmlStyle.touchAction || "",
      pagerState,
      pagerIndex,
      pagerDragX,
      pagerScrollLeft: Math.round(track?.scrollLeft || 0),
      pagerClientWidth: track?.clientWidth || 0,
      pagerScrollWidth: track?.scrollWidth || 0,
      pagerTransform: pagerState.track?.transform || "",
      pagerAligned: Math.abs(pagerDragX) < 1 && Number.isInteger(pagerIndex),
      scrollerFound: Boolean(scroller),
      scrollerScrollTop: scroller?.scrollTop || 0,
      scrollerClientHeight: scroller?.clientHeight || 0,
      scrollerScrollHeight: scroller?.scrollHeight || 0,
      chatRootClasses: root?.className || "",
      chatRootPointerEvents: root?.style.pointerEvents || "",
      overlayHidden: overlay ? overlay.classList.contains("hidden") : true,
      overlayAriaHidden: overlay?.getAttribute("aria-hidden") || "",
      overlayPointerEvents: overlay?.style.pointerEvents || overlayStyle?.pointerEvents || "",
      viewportAriaHidden: viewport?.getAttribute("aria-hidden") || "",
      viewportInert: Boolean(viewport?.inert),
      documentOverflowOk: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      bodyOverflowOk: document.body.scrollWidth <= document.body.clientWidth + 1
    };
  });

const newTouchSession = async (page) => page.context().newCDPSession(page);

const dragTouch = async (page, { startX, startY, endX, endY, steps = 8, delay = 16 }) => {
  const client = await newTouchSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y: startY, id: 1 }]
  });
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: startX + (endX - startX) * progress,
          y: startY + (endY - startY) * progress,
          id: 1
        }
      ]
    });
    await page.waitForTimeout(delay);
  }
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: []
  });
  await client.detach();
};

const waitForPagerStable = async (page) => {
  await page.waitForFunction(() => {
    const state = window.__dmMobileShell?.getPagerState?.();
    if (!state) return false;
    const pageIndex = Number.isFinite(state.pageIndex) ? state.pageIndex : -1;
    const dragX = Number.isFinite(state.dragX) ? state.dragX : 0;
    return (
      !state.activeUserGesture &&
      !state.isProgrammaticPagerScroll &&
      Number.isInteger(pageIndex) &&
      Math.abs(dragX) < 1
    );
  }, null, { timeout: 6_000 });
};

const swipeHorizontal = async (page, direction = "next") => {
  const width = page.viewportSize().width;
  const y = Math.round(page.viewportSize().height * 0.48);
  const isNext = direction === "next";
  await dragTouch(page, {
    startX: isNext ? width - 28 : 32,
    startY: y,
    endX: isNext ? 32 : width - 28,
    endY: y,
    steps: 12,
    delay: 12
  });
  await waitForPagerStable(page);
};

const assertNoCriticalConsoleErrors = (consoleErrors) => {
  const critical = consoleErrors.filter((text) => !ignoredConsolePattern.test(text));
  expect(critical, "no critical console errors").toEqual([]);
};

const assertNoMobileScrollLock = async (page) => {
  const diagnostics = await getScrollDiagnostics(page);
  expect(diagnostics.bodyInlineOverflow, "body inline overflow released").not.toBe("hidden");
  expect(diagnostics.htmlInlineOverflow, "html inline overflow released").not.toBe("hidden");
  expect(diagnostics.bodyInlineTouchAction, "body inline touch action released").not.toBe("none");
  expect(diagnostics.htmlInlineTouchAction, "html inline touch action released").not.toBe("none");
  expect(diagnostics.chatRootClasses, "mobile chat open class released").not.toContain("brisa-chat-root--mobile-open");
  expect(diagnostics.chatRootClasses, "mobile chat detail class released").not.toContain("brisa-chat-root--mobile-detail");
  expect(diagnostics.chatRootPointerEvents, "chat root no longer intercepts").toBe("");
  expect(diagnostics.overlayHidden, "overlay hidden").toBe(true);
  expect(diagnostics.overlayAriaHidden, "overlay aria-hidden").toBe("true");
  expect(diagnostics.viewportAriaHidden, "viewport aria-hidden").toBe("true");
  expect(diagnostics.documentOverflowOk, "document horizontal overflow").toBe(true);
  expect(diagnostics.bodyOverflowOk, "body horizontal overflow").toBe(true);
  return diagnostics;
};

const assertCanScrollActiveViewVertically = async (page, minDelta = 160) => {
  const before = await getScrollDiagnostics(page);
  expect(before.scrollerFound, "active scroller found").toBe(true);
  await dragTouch(page, {
    startX: Math.round(page.viewportSize().width / 2),
    startY: Math.round(page.viewportSize().height * 0.74),
    endX: Math.round(page.viewportSize().width / 2),
    endY: Math.round(page.viewportSize().height * 0.28),
    steps: 12,
    delay: 14
  });
  await page.waitForTimeout(250);
  const after = await getScrollDiagnostics(page);
  const maxScroll = after.scrollerScrollHeight - after.scrollerClientHeight;
  expect(
    after.scrollerScrollTop - before.scrollerScrollTop > minDelta || maxScroll <= minDelta,
    `active view scrollTop changes by ${minDelta}px`
  ).toBe(true);
  return { before, after };
};

const assertCanScrollActiveViewVerticallyBothWays = async (page, minDelta = 250) => {
  const down = await assertCanScrollActiveViewVertically(page, minDelta);
  const beforeReverse = await getScrollDiagnostics(page);
  await dragTouch(page, {
    startX: Math.round(page.viewportSize().width / 2),
    startY: Math.round(page.viewportSize().height * 0.28),
    endX: Math.round(page.viewportSize().width / 2),
    endY: Math.round(page.viewportSize().height * 0.74),
    steps: 10,
    delay: 12
  });
  await page.waitForTimeout(180);
  const afterReverse = await getScrollDiagnostics(page);
  expect(afterReverse.activeView, "reverse vertical drag keeps active page").toBe(beforeReverse.activeView);
  expect(
    beforeReverse.scrollerScrollTop - afterReverse.scrollerScrollTop > Math.min(140, beforeReverse.scrollerScrollTop) ||
      beforeReverse.scrollerScrollTop <= 2,
    "active view scrollTop decreases after immediate reverse drag"
  ).toBe(true);
  return { down, beforeReverse, afterReverse };
};

const openChatHub = async (page) => {
  await page.locator("#brisa-chat-bubble").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator("#brisa-chat-bubble").click();
  await expect(page.locator("#brisa-chat-mobile-overlay:not(.hidden)")).toBeVisible({ timeout: 10_000 });
};

const openChatDetail = async (page) => {
  await openChatHub(page);
  await page.locator("#brisa-chat-quick-foro").click();
  await expect(page.locator("#brisa-chat-window[data-chat-state='open']")).toBeVisible({ timeout: 10_000 });
};

test("Muro vertical scroll is natural and stays on Muro", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await loginToMobileApp(page, "carrete");

  const result = await assertCanScrollActiveViewVerticallyBothWays(page, 250);
  expect(result.down.after.activeView, "vertical drag keeps Muro active").toBe("muro");
  expect(result.afterReverse.activeView, "reverse vertical drag keeps Muro active").toBe("muro");
  expect(result.down.after.documentOverflowOk && result.down.after.bodyOverflowOk, "no horizontal overflow").toBe(true);
  assertNoCriticalConsoleErrors(consoleErrors);
});

test("horizontal swipe moves through mobile sections and back", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await loginToMobileApp(page, "carrete");

  for (const expected of ["estructura", "ia", "comites", "foro"]) {
    await swipeHorizontal(page, "next");
    const diagnostics = await getScrollDiagnostics(page);
    expect(diagnostics.activeView, `swipe next reaches ${expected}`).toBe(expected);
    expect(diagnostics.pagerAligned, "pager aligned to a real page").toBe(true);
  }

  for (const expected of ["comites", "ia", "estructura", "muro"]) {
    await swipeHorizontal(page, "prev");
    const diagnostics = await getScrollDiagnostics(page);
    expect(diagnostics.activeView, `swipe prev reaches ${expected}`).toBe(expected);
    expect(diagnostics.pagerAligned, "pager aligned to a real page").toBe(true);
  }

  assertNoCriticalConsoleErrors(consoleErrors);
});

test("vertical drag does not trigger horizontal navigation", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await loginToMobileApp(page, "carrete");

  const before = await getScrollDiagnostics(page);
  expect(before.activeView).toBe("muro");
  const result = await assertCanScrollActiveViewVertically(page, 250);
  expect(result.after.activeView, "vertical drag keeps the active page").toBe("muro");
  expect(result.after.scrollerScrollTop, "feed scrollTop changes").toBeGreaterThan(before.scrollerScrollTop);
  assertNoCriticalConsoleErrors(consoleErrors);
});

test("chat close and minimize do not leave scroll locks or invisible overlays", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await loginToMobileApp(page, "carrete");

  await openChatHub(page);
  await page.locator("#brisa-chat-panel-close").click();
  await page.waitForTimeout(150);
  await assertNoMobileScrollLock(page);

  await openChatHub(page);
  await page.locator("#brisa-chat-mobile-overlay").click({ position: { x: 8, y: 8 } });
  await page.waitForTimeout(150);
  await assertNoMobileScrollLock(page);

  await openChatDetail(page);
  await page.locator("#brisa-chat-window-min").click();
  await page.waitForTimeout(150);
  await assertNoMobileScrollLock(page);
  await assertCanScrollActiveViewVertically(page, 220);
  await swipeHorizontal(page, "next");
  const afterSwipe = await getScrollDiagnostics(page);
  expect(afterSwipe.activeView, "horizontal swipe still works after chat").toBe("estructura");
  assertNoCriticalConsoleErrors(consoleErrors);
});
