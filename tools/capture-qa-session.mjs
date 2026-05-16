import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

const LOGIN_URL = "https://127.0.0.1:5502/login.html";
const INDEX_URL = "https://127.0.0.1:5502/index.html";
const INDEX_PATH = "/index.html";
const QA_NAME_FRAGMENT = "QA Visual";
const QA_PROFILE_LABEL = "~/.dm-brisa-qa/playwright/dm-local-qa-profile";

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

const verifySession = async (page) =>
  page.evaluate((nameFragment) => {
    const flags = {
      isLoggedIn: sessionStorage.getItem("isLoggedIn"),
      userName: localStorage.getItem("user_nombre") || "",
      backendMode: window.__DM_BACKEND_MODE__,
      localRealBackend: window.__DM_LOCAL_REAL_BACKEND__,
      emulatorsEnabled: window.__DM_FIREBASE_EMULATORS_ENABLED__,
    };

    return {
      ...flags,
      ok:
        flags.isLoggedIn === "true" &&
        flags.userName.includes(nameFragment) &&
        flags.backendMode === "real" &&
        flags.localRealBackend === true &&
        flags.emulatorsEnabled === false,
    };
  }, QA_NAME_FRAGMENT);

const getPathname = (url = "") => {
  try {
    return new URL(url).pathname;
  } catch (error) {
    return "";
  }
};

const getActivePage = (context, fallbackPage) => {
  const pages = context.pages().filter((candidate) => !candidate.isClosed());
  return pages.at(-1) || fallbackPage;
};

const assertProfileOutsideWorkspace = () => {
  const relative = path.relative(workspaceRoot, profilePath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("El perfil QA debe estar fuera del workspace para evitar reload loop de Live Server.");
  }
};

const main = async () => {
  const playwright = await loadPlaywright();
  if (!playwright) return;

  let context = null;
  let rl = null;

  try {
    assertProfileOutsideWorkspace();
    fs.mkdirSync(profilePath, { recursive: true });

    context = await playwright.chromium.launchPersistentContext(profilePath, {
      headless: false,
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 },
      acceptDownloads: false,
    });

    const page = context.pages()[0] || (await context.newPage());

    console.log("Iniciá sesión manualmente con el usuario QA en la ventana de Chromium.");
    console.log("Cuando veas https://127.0.0.1:5502/index.html, volvé a esta terminal y presioná Enter.");
    console.log("No pegues contraseña en terminal.");
    console.log(`Perfil persistente externo: ${QA_PROFILE_LABEL}`);
    console.log(`Abriendo: ${LOGIN_URL}`);

    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

    rl = createInterface({ input, output });
    await rl.question("");

    const activePage = getActivePage(context, page);
    if (!activePage || activePage.isClosed()) {
      throw new Error("La pagina de Chromium ya no esta disponible.");
    }

    if (getPathname(activePage.url()) !== INDEX_PATH) {
      await activePage.goto(INDEX_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } else {
      await activePage.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
    }
    await activePage.waitForTimeout(1200);

    const session = await verifySession(activePage);
    if (!session.ok) {
      console.error("FAIL: la sesion QA no cumple las verificaciones esperadas.");
      console.error(
        JSON.stringify(
          {
            isLoggedIn: session.isLoggedIn,
            userNameMatchesQA: session.userName.includes(QA_NAME_FRAGMENT),
            backendMode: session.backendMode,
            localRealBackend: session.localRealBackend,
            emulatorsEnabled: session.emulatorsEnabled,
          },
          null,
          2
        )
      );
      process.exitCode = 1;
      return;
    }

    console.log("PASS: sesion QA capturada y verificada.");
    console.log(`La sesion queda guardada fuera del workspace en ${QA_PROFILE_LABEL}.`);
  } catch (error) {
    console.error("FAIL: no se pudo capturar la sesion QA.");
    console.error(error?.message || error);
    process.exitCode = 1;
  } finally {
    rl?.close();
    if (context) await context.close().catch(() => {});
  }
};

main();
