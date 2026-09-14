#!/usr/bin/env node
// Verifica la integración del escritorio en las 7 páginas de comités
// (tarjeta clickeable, título enlazado, botón Escritorio, finalizados) con
// Firebase y CDN reemplazados por stubs. Sin red.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const OUT = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : path.resolve(ROOT, "test-results/escritorio-comites");
fs.mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const filePath = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

const APP = "departamento-medico-brisa";
const PAGES = {
  comite_bioetica: "comite-bioetica.html",
  comite_calidad_seguridad: "comite-calidad-seguridad.html",
  comite_docencia_investigacion: "comite-docencia-investigacion.html",
  comite_ejecutivo_emergencias: "comite-ejecutivo-emergencias.html",
  comite_farmacia_terapeutica: "comite-farmacia-terapeutica.html",
  comite_salud_digital: "comite-salud-digital.html",
  comite_salud_ocupacional: "salud-ocupacional.html"
};

const CDN_STUBS = {
  lucide: "window.lucide = { createIcons: () => {} };",
  flatpickr: "window.flatpickr = function () { return { destroy() {} }; }; window.flatpickr.localize = () => {}; window.flatpickr.l10ns = { es: {} };",
  sweetalert2: "window.Swal = { fire: async () => ({ isConfirmed: false }), getPopup: () => null, showValidationMessage: () => {} };",
  tailwind: "window.tailwind = { config: {} };"
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
try {
  for (const [committeeId, file] of Object.entries(PAGES)) {
    const topicId = `topic-${committeeId}`;
    const seed = [
      { path: ["artifacts", APP, "public", "data", "committee_topics", topicId].join("/"), data: { title: `Proyecto activo ${committeeId}`, committeeId, stage: 2, projectNumber: 1, startDate: "2026-08-01", proposedBy: "Equipo", docLinks: {}, createdByUid: "user-a", createdAt: new Date() } },
      { path: ["artifacts", APP, "public", "data", "committee_topics", `${topicId}-fin`].join("/"), data: { title: `Proyecto finalizado ${committeeId}`, committeeId, stage: 5, projectNumber: 2, finishedDate: "2026-08-20", createdByUid: "user-a", createdAt: new Date() } },
      { path: "usuarios/user-a", data: { displayName: "Dr. Usuario A" } }
    ];
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-AR" });
    await context.addInitScript(({ seedData }) => {
      window.__PD_SEED__ = seedData;
      window.__PD_TEST_USER__ = { uid: "user-a", email: "a@example.test", displayName: "Dr. Usuario A" };
    }, { seedData: seed.map((e) => ({ path: e.path, data: JSON.parse(JSON.stringify(e.data)) })) });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`error: ${msg.text()}`);
    });
    await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/.*\/(firebase-[a-z-]+)\.js/, (route, request) => {
      const name = request.url().match(/(firebase-[a-z-]+)\.js/)[1];
      const stub = path.join(__dirname, "stubs", `${name}.js`);
      route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: fs.existsSync(stub) ? fs.readFileSync(stub, "utf8") : "export default {};" });
    });
    await page.route(/https:\/\/(unpkg\.com|cdn\.jsdelivr\.net|cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\/.*/, (route, request) => {
      const url = request.url();
      const key = Object.keys(CDN_STUBS).find((k) => url.includes(k));
      if (url.endsWith(".css") || url.includes("fonts.")) return route.fulfill({ status: 200, contentType: "text/css", body: "" });
      return route.fulfill({ status: 200, contentType: "text/javascript", body: key ? CDN_STUBS[key] : "" });
    });
    await page.goto(`${BASE}/pages/comites/${file}`);
    await page.waitForSelector(".committee-project-card--desktop", { timeout: 15000 });
    const card = page.locator(".committee-project-card--desktop").first();
    const expectedUrl = `escritorio.html?comite=${committeeId}&proyecto=${topicId}`;
    check(`${file}: tarjeta con data-project-desktop-id`, (await card.getAttribute("data-project-desktop-id")) === topicId);
    check(`${file}: título enlazado al escritorio`, (await card.locator(".committee-project-card__title-link").getAttribute("href")) === expectedUrl);
    check(`${file}: botón Escritorio en la tarjeta`, (await card.locator(".doc-icon-desktop").count()) === 1);
    check(`${file}: finalizado enlazado y con botón`, (await page.locator("#finished-list .committee-project-card__title-link--finished").count()) === 1 && (await page.locator("#finished-list .doc-icon-desktop").count()) === 1);
    const relevant = errors.filter((e) => !/ERR_FAILED|Failed to load resource|net::|Swal|lucide|flatpickr|tailwind/i.test(e));
    check(`${file}: sin errores de página`, relevant.length === 0, relevant.slice(0, 3).join(" | "));
    // Clic en la tarjeta (zona sin controles) → navega al escritorio.
    await card.locator(".committee-project-card__meta-item--lead").click();
    await page.waitForURL((u) => u.pathname.endsWith("/escritorio.html"), { timeout: 8000 }).catch(() => {});
    check(`${file}: clic en la tarjeta abre el escritorio`, page.url().includes(`escritorio.html?comite=${committeeId}&proyecto=${topicId}`), page.url());
    await page.goBack().catch(() => {});
    await page.waitForSelector(".committee-project-card--desktop", { timeout: 15000 }).catch(() => {});
    if (await page.locator(".committee-project-card--desktop .doc-icon-desktop").count()) {
      await page.locator(".committee-project-card--desktop .doc-icon-desktop").first().click();
      await page.waitForURL((u) => u.pathname.endsWith("/escritorio.html"), { timeout: 8000 }).catch(() => {});
      check(`${file}: botón Escritorio abre el escritorio`, page.url().includes(`escritorio.html?comite=${committeeId}`), page.url());
    }
    if (committeeId === "comite_docencia_investigacion") {
      await page.goBack().catch(() => {});
      await page.waitForSelector(".committee-project-card--desktop", { timeout: 15000 }).catch(() => {});
      await page.screenshot({ path: path.join(OUT, `${file}.png`), fullPage: false });
    }
    await context.close();
  }
} catch (error) {
  console.error("ERROR:", error);
  results.push({ name: "Ejecución completa", ok: false, detail: String(error?.message || error) });
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, "resultado.json"), JSON.stringify({ when: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK`);
process.exit(failed.length ? 1 : 0);
