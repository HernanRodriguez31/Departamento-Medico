import { expect, test } from "@playwright/test";

const QA_EMAIL = process.env.MOBILE_QA_EMAIL || "mobile.qa@departamento-medico.test";
const QA_PASSWORD = process.env.MOBILE_QA_PASSWORD || "MobileQa!12345";

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

const loginToMobileApp = async (page, hash = "carrete") => {
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
  await expect(page.locator(".dm-bottom-nav")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__dmMobileShell?.getPagerState) && document.body?.dataset?.view);
  await page.locator("#app-splash").waitFor({ state: "detached", timeout: 6_000 }).catch(() => {});
  await waitForPagerStable(page);
};

const getScrollDiagnostics = async (page) =>
  page.evaluate(() => {
    const shellState = window.__dmMobileShell?.debugScrollState?.() || {};
    const pagerState = window.__dmMobileShell?.getPagerState?.() || shellState.pagerState || {};
    const track = document.querySelector(".dm-mobile-pager-track");
    const activeView = window.__dmMobileShell?.getCurrentViewId?.() || "muro";
    const activePage = document.querySelector(`.dm-mobile-page[data-view="${activeView}"]:not(.dm-mobile-page--ghost)`);
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
    const width = track?.clientWidth || 1;
    const pagePosition = (track?.scrollLeft || 0) / width;
    return {
      ...shellState,
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
      pagerScrollLeft: Math.round(track?.scrollLeft || 0),
      pagerClientWidth: track?.clientWidth || 0,
      pagerScrollWidth: track?.scrollWidth || 0,
      pagerAligned: Math.abs(pagePosition - Math.round(pagePosition)) < 0.03,
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
    const track = document.querySelector(".dm-mobile-pager-track");
    const state = window.__dmMobileShell?.getPagerState?.();
    if (!track || !state) return false;
    const width = track.clientWidth || window.innerWidth || 1;
    const position = track.scrollLeft / width;
    return (
      !state.activeUserGesture &&
      !state.isProgrammaticPagerScroll &&
      Math.abs(position - Math.round(position)) < 0.03
    );
  }, null, { timeout: 6_000 });
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

test("pager allows immediate reverse horizontal gesture during momentum", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await loginToMobileApp(page, "carrete");

  await dragTouch(page, {
    startX: page.viewportSize().width - 28,
    startY: Math.round(page.viewportSize().height * 0.48),
    endX: 34,
    endY: Math.round(page.viewportSize().height * 0.49),
    steps: 5,
    delay: 10
  });
  await page.waitForTimeout(45);
  await dragTouch(page, {
    startX: 34,
    startY: Math.round(page.viewportSize().height * 0.48),
    endX: page.viewportSize().width - 28,
    endY: Math.round(page.viewportSize().height * 0.49),
    steps: 5,
    delay: 10
  });

  await waitForPagerStable(page);
  const diagnostics = await getScrollDiagnostics(page);
  expect(["muro", "estructura", "ia", "comites", "foro"]).toContain(diagnostics.activeView);
  expect(diagnostics.pagerAligned, "pager aligned to a real page").toBe(true);
  expect(diagnostics.pagerState.isProgrammaticPagerScroll, "programmatic flag released").toBe(false);
  expect(diagnostics.pagerState.activeUserGesture, "gesture flag released").toBe(false);
  expect(diagnostics.documentOverflowOk && diagnostics.bodyOverflowOk, "no horizontal overflow").toBe(true);
  assertNoCriticalConsoleErrors(consoleErrors);
});

test("vertical feed scroll remains primary and horizontal swipe still changes views", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await loginToMobileApp(page, "carrete");

  const verticalResult = await assertCanScrollActiveViewVertically(page, 140);
  expect(verticalResult.after.activeView, "vertical drag keeps Muro active").toBe("muro");
  await page.waitForTimeout(450);
  await page.evaluate(() => window.__dmMobileShell?.refreshScrollState?.("qa-before-horizontal-swipe"));

  await dragTouch(page, {
    startX: page.viewportSize().width - 28,
    startY: Math.round(page.viewportSize().height * 0.46),
    endX: 32,
    endY: Math.round(page.viewportSize().height * 0.46),
    steps: 10,
    delay: 10
  });
  await waitForPagerStable(page);
  const afterHorizontal = await getScrollDiagnostics(page);
  expect(afterHorizontal.activeView, "clear horizontal swipe changes view").not.toBe("muro");

  await page.locator('[data-route="muro"]').click();
  await waitForPagerStable(page);
  const backToMuro = await getScrollDiagnostics(page);
  expect(backToMuro.activeView).toBe("muro");
  assertNoCriticalConsoleErrors(consoleErrors);
});

test("minimizing chat releases scroll and active feed remains scrollable", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await loginToMobileApp(page, "carrete");

  await openChatDetail(page);
  await page.locator("#brisa-chat-window-min").click();
  await page.waitForFunction(() => !document.getElementById("brisa-chat-root")?.classList.contains("brisa-chat-root--mobile-open"));
  await assertNoMobileScrollLock(page);
  await assertCanScrollActiveViewVertically(page, 180);
  assertNoCriticalConsoleErrors(consoleErrors);
});

test("chat overlay close paths do not leave invisible interceptors", async ({ page }) => {
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
  await assertCanScrollActiveViewVertically(page, 160);
  assertNoCriticalConsoleErrors(consoleErrors);
});
