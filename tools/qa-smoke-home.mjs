import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME_URL = "https://127.0.0.1:5502/index.html";
const LOGIN_PATH = "/login.html";
const QA_PROFILE_LABEL = "~/.dm-brisa-qa/playwright/dm-local-qa-profile";
const SAFE_CONSOLE_PATTERNS = [
  /cdn\.tailwindcss\.com should not be used in production/i,
  /babel/i,
  /ssl certificate/i,
  /failed to load resource.*favicon/i,
];

const workspaceRoot = path.resolve(process.cwd());
const profilePath = path.resolve(
  path.join(os.homedir(), ".dm-brisa-qa", "playwright", "dm-local-qa-profile")
);

const loadPlaywright = async () => {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("FAIL: Playwright no esta disponible en node_modules. No instales dependencias en este segmento.");
    process.exitCode = 1;
    return null;
  }
};

const isSafeConsoleError = (text = "") =>
  SAFE_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));

const rectsIntersect = (a, b) =>
  Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);

const assertProfileOutsideWorkspace = () => {
  const relative = path.relative(workspaceRoot, profilePath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("El perfil QA debe estar fuera del workspace para evitar reload loop de Live Server.");
  }
};

const runPageChecks = async (page) =>
  page.evaluate(() => {
    const toRect = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    };

    const findMissionCard = (title) =>
      Array.from(document.querySelectorAll(".mision__item")).find((card) =>
        Array.from(card.querySelectorAll("h3")).some(
          (heading) => heading.textContent.trim().toLowerCase() === title.toLowerCase()
        )
      ) || null;

    const banner = document.querySelector("#push-permission-banner");
    const bannerStyle = banner ? getComputedStyle(banner) : null;
    const bannerVisible =
      Boolean(banner) &&
      !banner.hidden &&
      !banner.classList.contains("hidden") &&
      bannerStyle?.display !== "none" &&
      bannerStyle?.visibility !== "hidden" &&
      Number.parseFloat(bannerStyle?.opacity || "1") > 0;

    const bannerRect = bannerVisible ? toRect(banner) : null;
    const missionCards = ["Misión", "Visión", "Valores"].map((title) => ({
      title,
      rect: toRect(findMissionCard(title)),
    }));
    const bannerOverlaps = bannerVisible
      ? missionCards
          .filter((card) => {
            const a = bannerRect;
            const b = card.rect;
            return Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
          })
          .map((card) => card.title)
      : [];

    return {
      href: location.href,
      backendMode: window.__DM_BACKEND_MODE__,
      localRealBackend: window.__DM_LOCAL_REAL_BACKEND__,
      emulatorsEnabled: window.__DM_FIREBASE_EMULATORS_ENABLED__,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bannerVisible,
      bannerRect,
      missionCards,
      bannerOverlaps,
    };
  });

const runPortalChecks = async (page) => {
  const portalButton = page.locator("#btn-portal");
  const portalBubble = page.locator("#portal-bubble");

  await portalButton.waitFor({ state: "attached", timeout: 10_000 });
  await portalButton.click({ timeout: 10_000 });
  await page.waitForTimeout(250);

  const opened = await page.evaluate(() => {
    const wrapper = document.querySelector("#portal-wrapper");
    const button = document.querySelector("#btn-portal");
    const bubble = document.querySelector("#portal-bubble");
    const links = Array.from(document.querySelectorAll("#portal-bubble .portal-link"));
    return {
      ariaExpanded: button?.getAttribute("aria-expanded") || "",
      wrapperOpen: wrapper?.classList.contains("is-open") === true,
      bubbleDisplay: bubble ? getComputedStyle(bubble).display : "",
      linksPointerAuto: links.every((link) => getComputedStyle(link).pointerEvents !== "none"),
    };
  });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  const closed = await page.evaluate(() => {
    const wrapper = document.querySelector("#portal-wrapper");
    const button = document.querySelector("#btn-portal");
    const bubble = document.querySelector("#portal-bubble");
    const links = Array.from(document.querySelectorAll("#portal-bubble .portal-link"));
    return {
      ariaExpanded: button?.getAttribute("aria-expanded") || "",
      wrapperOpen: wrapper?.classList.contains("is-open") === true,
      bubbleDisplay: bubble ? getComputedStyle(bubble).display : "",
      bubblePointerEvents: bubble ? getComputedStyle(bubble).pointerEvents : "",
      ghostLinks: links.filter((link) => {
        const style = getComputedStyle(link);
        const rect = link.getBoundingClientRect();
        return style.pointerEvents !== "none" && rect.width > 0 && rect.height > 0;
      }).length,
    };
  });

  await portalBubble.waitFor({ state: "attached", timeout: 10_000 });
  return { opened, closed };
};

const main = async () => {
  const playwright = await loadPlaywright();
  if (!playwright) return;

  const criticalConsoleErrors = [];
  const warnings = [];
  let context = null;

  try {
    assertProfileOutsideWorkspace();
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });

    if (!fs.existsSync(profilePath)) {
      console.error(`FAIL: no existe el perfil QA persistente en ${QA_PROFILE_LABEL}.`);
      console.error("Ejecuta primero: node tools/capture-qa-session.mjs");
      process.exitCode = 1;
      return;
    }

    context = await playwright.chromium.launchPersistentContext(profilePath, {
      headless: true,
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 },
      acceptDownloads: false,
    });

    const page = context.pages()[0] || (await context.newPage());
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (isSafeConsoleError(text)) {
        warnings.push(text);
        return;
      }
      criticalConsoleErrors.push(text);
    });
    page.on("pageerror", (error) => {
      criticalConsoleErrors.push(error?.message || String(error));
    });

    const response = await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2500);

    const currentUrl = new URL(page.url());
    if (currentUrl.pathname === LOGIN_PATH) {
      throw new Error("La sesion QA no esta activa: index.html redirigio a login.html.");
    }

    const pageChecks = await runPageChecks(page);
    const portalChecks = await runPortalChecks(page);

    const failures = [];
    if (!response || !response.ok()) failures.push(`index.html no respondio OK: ${response?.status() || "sin respuesta"}`);
    if (pageChecks.backendMode !== "real") failures.push(`backendMode esperado real, recibido ${pageChecks.backendMode}`);
    if (pageChecks.localRealBackend !== true) failures.push("localRealBackend esperado true");
    if (pageChecks.emulatorsEnabled !== false) failures.push("emulatorsEnabled esperado false");
    if (pageChecks.scrollWidth !== pageChecks.clientWidth) {
      failures.push(`overflow horizontal: scrollWidth=${pageChecks.scrollWidth}, clientWidth=${pageChecks.clientWidth}`);
    }
    if (pageChecks.bannerOverlaps.length) {
      failures.push(`banner intersecta cards: ${pageChecks.bannerOverlaps.join(", ")}`);
    }
    if (!portalChecks.opened.wrapperOpen || portalChecks.opened.ariaExpanded !== "true") {
      failures.push("Portal no abre con estado real is-open/aria-expanded=true");
    }
    if (portalChecks.opened.bubbleDisplay === "none") {
      failures.push("Portal abierto conserva #portal-bubble display:none");
    }
    if (!portalChecks.opened.linksPointerAuto) {
      failures.push("Portal abierto tiene links sin pointer-events");
    }
    if (portalChecks.closed.ariaExpanded !== "false") {
      failures.push(`Portal cerrado aria-expanded esperado false, recibido ${portalChecks.closed.ariaExpanded}`);
    }
    if (portalChecks.closed.wrapperOpen) {
      failures.push("Portal cerrado conserva .is-open");
    }
    if (portalChecks.closed.bubbleDisplay !== "none") {
      failures.push(`Portal cerrado #portal-bubble display esperado none, recibido ${portalChecks.closed.bubbleDisplay}`);
    }
    if (portalChecks.closed.ghostLinks > 0) {
      failures.push(`Portal cerrado conserva ${portalChecks.closed.ghostLinks} links fantasma clickeables`);
    }
    if (criticalConsoleErrors.length) {
      failures.push(`errores JS criticos en consola: ${criticalConsoleErrors.length}`);
    }

    const report = {
      url: pageChecks.href,
      responseStatus: response?.status() || null,
      backend: {
        mode: pageChecks.backendMode,
        localReal: pageChecks.localRealBackend,
        emulators: pageChecks.emulatorsEnabled,
      },
      overflow: {
        scrollWidth: pageChecks.scrollWidth,
        clientWidth: pageChecks.clientWidth,
      },
      banner: {
        visible: pageChecks.bannerVisible,
        overlaps: pageChecks.bannerOverlaps,
      },
      portal: portalChecks,
      warnings,
    };

    if (failures.length) {
      console.error("FAIL: smoke autenticado home no paso.");
      console.error(JSON.stringify({ ...report, failures, criticalConsoleErrors }, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log("PASS: smoke autenticado home OK.");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error("FAIL: smoke autenticado home no pudo completarse.");
    console.error(error?.message || error);
    process.exitCode = 1;
  } finally {
    if (context) await context.close().catch(() => {});
  }
};

main();
