#!/usr/bin/env node
// Verificación del escritorio de proyecto en navegador real (Chromium headless)
// sin red: Firebase se reemplaza por stubs en memoria y las CDN se bloquean.
//
// Uso: node tools/verificacion/escritorio/run-escritorio.mjs [--out DIR] [--headed]
// Requiere: playwright (npm i -D playwright o instalación global) y Chromium.
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
const OUT = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : path.resolve(ROOT, "test-results/escritorio");
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
  if (filePath.endsWith("/")) filePath += "index.html";
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(filePath).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

const COMMITTEE = "comite_docencia_investigacion";
const TOPIC = "topic-demo-1";
const APP = "departamento-medico-brisa";
const dataPath = (...rest) => ["artifacts", APP, "public", "data", ...rest].join("/");

const seed = [
  { path: dataPath("committee_topics", TOPIC), data: { title: "Ateneos Clínicos, Revisión Bibliográfica y Actualización Científica", startDate: "2026-07-24", proposedBy: "Bartra Alberto, Dal Mas Adriane", committeeId: COMMITTEE, projectNumber: 1, docLinks: {}, stage: 4, nextMeeting: "2026-09-07", createdByUid: "user-a", createdAt: new Date() } },
  { path: dataPath("committee_topics", "topic-other"), data: { title: "Otro proyecto", committeeId: "comite_bioetica", stage: 1, createdByUid: "user-b", createdAt: new Date() } },
  { path: dataPath("committee_meta", COMMITTEE), data: { committeeId: COMMITTEE, title: "Comité de Docencia e Investigación", subtitle: "Formación continua" } },
  { path: dataPath("committee_members", "m1"), data: { committeeId: COMMITTEE, name: "Dra. Adriane Dal Mas", userUid: "user-b", committeeRole: "referente", isLeader: true, businessUnit: "Upstream", managementUnit: "Golfo San Jorge", createdAt: new Date() } },
  { path: dataPath("committee_members", "m2"), data: { committeeId: COMMITTEE, name: "Dr. Alberto Bartra", userUid: "user-c", committeeRole: "vocal", isLeader: false, businessUnit: "Downstream", managementUnit: "Refinería Campana", createdAt: new Date() } },
  { path: dataPath("committee_notes", "n1"), data: { committeeId: COMMITTEE, scope: "project", projectId: TOPIC, projectTitle: "Ateneos", text: "Recordar enviar la bibliografía antes del viernes.", authorUid: "user-b", authorName: "Dra. Adriane Dal Mas", createdAt: new Date(), updatedAt: new Date(), likedBy: { "user-a": "Dr. Hernán" } } },
  { path: "usuarios/user-a", data: { displayName: "Dr. Hernán Rodríguez", email: "h@example.test" } },
  { path: "usuarios/user-b", data: { displayName: "Dra. Adriane Dal Mas" } }
];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ headless: !args.includes("--headed") });

async function newPage({ viewport = { width: 1440, height: 900 }, user = { uid: "user-a", email: "h@example.test", displayName: "Hernán" } } = {}) {
  const context = await browser.newContext({ viewport, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", deviceScaleFactor: 1 });
  await context.addInitScript(({ seedData, testUser }) => {
    window.__PD_SEED__ = seedData.map((entry) => ({ path: entry.path, data: entry.data }));
    window.__PD_TEST_USER__ = testUser;
  }, { seedData: seed.map((e) => ({ path: e.path, data: JSON.parse(JSON.stringify(e.data)) })), testUser: user });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") errors.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/.*\/(firebase-[a-z-]+)\.js/, (route, request) => {
    const name = request.url().match(/(firebase-[a-z-]+)\.js/)[1];
    const stub = path.join(__dirname, "stubs", `${name}.js`);
    if (fs.existsSync(stub)) route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: fs.readFileSync(stub, "utf8") });
    else route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: "export default {};" });
  });
  await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdn\.jsdelivr\.net|cdn\.tailwindcss\.com)\/.*/, (route) => route.abort());
  return { page, context, errors };
}

const desktopUrl = (params = {}) => {
  const search = new URLSearchParams({ comite: COMMITTEE, proyecto: TOPIC, ...params });
  return `${BASE}/pages/comites/escritorio.html?${search.toString()}`;
};

const waitReady = async (page) => {
  await page.waitForSelector("body.is-ready", { timeout: 15000 });
  await page.waitForTimeout(300);
};

const openDock = async (page, appId) => {
  await page.click(`.pd-dock__app[aria-label="${appId}"]`);
  await page.waitForSelector(`.pd-window[data-app]`, { timeout: 5000 });
  await page.waitForTimeout(250);
};

const fillDialog = async (page, values, submit = true) => {
  await page.waitForSelector(".pd-modal-overlay.is-visible form", { timeout: 5000 });
  for (const [name, value] of Object.entries(values)) {
    const control = page.locator(`.pd-modal-overlay.is-visible [name="${name}"]`);
    const tag = await control.evaluate((el) => (el.tagName.toLowerCase() === "select" ? "select" : el.tagName.toLowerCase() + (el.type ? `:${el.type}` : "")));
    if (tag === "select") await control.selectOption(value);
    else if (tag === "input:checkbox") await control.setChecked(Boolean(value));
    else await control.fill(String(value));
  }
  if (submit) {
    await page.click(".pd-modal-overlay.is-visible .pd-modal__footer button[type=submit]");
    await page.waitForSelector(".pd-modal-overlay", { state: "detached", timeout: 5000 });
    await page.waitForTimeout(250);
  }
};

const dump = (page) => page.evaluate(() => window.__PD_STORE__.dump());

try {
  // ---------------------------------------------------------------------
  // 1. Escritorio completo (1440×900)
  // ---------------------------------------------------------------------
  const { page, errors } = await newPage();
  await page.goto(desktopUrl());
  await waitReady(page);
  check("Escritorio carga con usuario autenticado", await page.isVisible("#pd-root"));
  check("Barra de menú muestra el proyecto", (await page.textContent(".pd-menubar__project")).includes("Ateneos"));
  check("Widgets del proyecto visibles", (await page.locator(".pd-widget").count()) >= 5);
  let store = await dump(page);
  check("Aprovisionamiento automático: config creada", Boolean(store[dataPath("committee_topics", TOPIC, "desktop_meta", "config")]));
  check("Aprovisionamiento automático: 5 carpetas base", Object.keys(store).filter((k) => k.includes("/desktop_items/seed-")).length === 5);
  check("Íconos M365 en el escritorio (slots del comité)", (await page.locator(".pd-icons .pd-file--m365").count()) === 3);
  await page.screenshot({ path: path.join(OUT, "01-escritorio.png") });

  // Archivos
  await openDock(page, "Archivos");
  check("Ventana Archivos abierta", await page.isVisible(".pd-window--files"));
  check("Archivos muestra carpetas base", (await page.locator(".pd-window--files .pd-file[data-item-type=folder]").count()) === 5);
  await page.click(".pd-window--files .pd-files__toolbar button:has-text('Nueva carpeta')");
  await fillDialog(page, { name: "Protocolos 2026" });
  check("Nueva carpeta creada", (await page.locator(".pd-window--files .pd-file__label:has-text('Protocolos 2026')").count()) === 1);
  await page.click(".pd-window--files .pd-files__toolbar button:has-text('Agregar enlace')");
  await fillDialog(page, { url: "https://panamericanenergy.sharepoint.com/:x:/t/DepartamentoMdico/planilla-demo", name: "Planilla de asistencia", pinned: true });
  store = await dump(page);
  const linkDoc = Object.values(store).find((d) => d && d.name === "Planilla de asistencia");
  check("Enlace guardado con tipo detectado (excel) y fijado", linkDoc && linkDoc.kind === "excel" && linkDoc.pinned === true, linkDoc ? linkDoc.kind : "sin doc");
  check("Enlace fijado aparece como ícono del escritorio", (await page.locator(".pd-icons .pd-file__label:has-text('Planilla de asistencia')").count()) === 1);
  await page.dblclick(".pd-window--files .pd-file__label:has-text('Protocolos 2026')");
  await page.waitForTimeout(200);
  check("Navegación a carpeta (migas)", (await page.textContent(".pd-window--files .pd-files__crumbs")).includes("Protocolos 2026"));
  await page.screenshot({ path: path.join(OUT, "02-archivos.png") });
  // Menú contextual → papelera
  await page.click(".pd-window--files .pd-crumb:first-child");
  await page.waitForTimeout(150);
  await page.click(".pd-window--files .pd-file:has(.pd-file__label:has-text('Protocolos 2026'))", { button: "right" });
  await page.click(".pd-menu .pd-menu__item:has-text('Mover a la papelera')");
  await page.click(".pd-modal-overlay.is-visible .pd-modal__footer button[type=submit]");
  await page.waitForTimeout(300);
  store = await dump(page);
  const archivedFolder = Object.values(store).find((d) => d && d.name === "Protocolos 2026");
  check("Carpeta archivada (papelera) por menú contextual", archivedFolder && archivedFolder.archived === true);

  // Calendario
  await openDock(page, "Calendario");
  check("Ventana Calendario abierta", await page.isVisible(".pd-window--calendar"));
  await page.click(".pd-window--calendar .pd-calendar__head button:has-text('Nuevo evento')");
  const nextMonth = new Date();
  nextMonth.setDate(nextMonth.getDate() + 10);
  const dateKey = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-${String(nextMonth.getDate()).padStart(2, "0")}`;
  await fillDialog(page, { title: "Reunión de avance", eventKind: "reunion", dateKey, startTime: "10:00", endTime: "11:00", link: "https://teams.microsoft.com/l/meetup-join/demo", note: "Revisión de bibliografía" });
  await page.waitForTimeout(1800);
  store = await dump(page);
  const eventDoc = Object.entries(store).find(([k, d]) => k.includes("calendar_events/") && d.title === "Reunión de avance");
  check("Evento creado en calendar_events con projectId y scope comité", eventDoc && eventDoc[1].projectId === TOPIC && eventDoc[1].calendarScope === "committee" && eventDoc[1].committeeId === COMMITTEE && eventDoc[1].startMinutes === 600);
  check("Próxima reunión sincronizada en la tarjeta", store[dataPath("committee_topics", TOPIC)].nextMeeting === dateKey, store[dataPath("committee_topics", TOPIC)].nextMeeting);
  check("Widget muestra próxima reunión", (await page.textContent(".pd-widget--meeting")).includes("Próxima reunión"));
  await page.screenshot({ path: path.join(OUT, "03-calendario.png") });

  // Tareas
  await openDock(page, "Tareas");
  await page.click(".pd-window--tasks .pd-tasks__toolbar button:has-text('Nueva tarea')");
  await fillDialog(page, { title: "Redactar borrador del protocolo", assignee: "Dra. Adriane Dal Mas", dueDate: dateKey, priority: "alta" });
  check("Tarea creada en columna Pendiente", (await page.locator(".pd-window--tasks .pd-tasks__column--todo .pd-task").count()) === 1);
  await page.click(".pd-window--tasks .pd-task .pd-task__check");
  await page.waitForTimeout(250);
  check("Tarea marcada como hecha", (await page.locator(".pd-window--tasks .pd-tasks__column--done .pd-task").count()) === 1);
  check("Widget de tareas refleja 1/1", (await page.textContent(".pd-widget--tasks")).includes("1/1"));
  await page.screenshot({ path: path.join(OUT, "04-tareas.png") });

  // Actas y notas
  await openDock(page, "Actas y notas");
  await page.click(".pd-window--notes .pd-notes__list-head button:has-text('Acta')");
  await fillDialog(page, { title: "Acta reunión de avance" });
  await page.waitForSelector(".pd-window--notes .pd-notes__textarea", { timeout: 5000 });
  const template = await page.inputValue(".pd-window--notes .pd-notes__textarea");
  check("Acta creada con plantilla", template.includes("ACTA DE REUNIÓN") && template.includes("Acuerdos"));
  await page.fill(".pd-window--notes .pd-notes__textarea", `${template}\nAcuerdo: enviar bibliografía.`);
  await page.waitForTimeout(1400);
  store = await dump(page);
  const noteDoc = Object.values(store).find((d) => d && d.title === "Acta reunión de avance");
  check("Acta guardada automáticamente", noteDoc && noteDoc.body.includes("Acuerdo: enviar bibliografía"));
  await page.screenshot({ path: path.join(OUT, "05-actas.png") });

  // Equipo
  await openDock(page, "Equipo");
  check("Nómina del comité visible", (await page.locator(".pd-window--team .pd-team__row").count()) === 2);
  await page.locator(".pd-window--team .pd-team__row button[title^='Sumar a']").first().click();
  await fillDialog(page, { role: "responsable" });
  store = await dump(page);
  const config = store[dataPath("committee_topics", TOPIC, "desktop_meta", "config")];
  check("Integrante sumado al equipo del proyecto", config && config.team.length === 1 && config.team[0].role === "responsable" && config.team[0].uid === "user-b");
  check("Widget de equipo muestra avatar", (await page.locator(".pd-widget--team .pd-avatar").count()) === 1);
  await page.screenshot({ path: path.join(OUT, "06-equipo.png") });

  // Pizarra
  await openDock(page, "Pizarra del comité");
  check("Pizarra muestra nota existente del proyecto", (await page.textContent(".pd-window--board")).includes("bibliografía antes del viernes"));
  await page.fill(".pd-window--board .pd-board__input", "Nota de prueba desde el escritorio");
  await page.click(".pd-window--board .pd-board__form button[type=submit]");
  await page.waitForTimeout(300);
  store = await dump(page);
  const boardDoc = Object.values(store).find((d) => d && d.text === "Nota de prueba desde el escritorio");
  check("Nota de pizarra publicada en committee_notes con forma válida", boardDoc && boardDoc.scope === "project" && boardDoc.projectId === TOPIC && boardDoc.authorUid === "user-a" && typeof boardDoc.likedBy === "object");

  // Avance
  await openDock(page, "Avance del proyecto");
  await page.click(".pd-window--progress .pd-stepper__step:nth-child(3)");
  await page.waitForTimeout(300);
  store = await dump(page);
  check("Etapa cambiada a 3 desde Avance", store[dataPath("committee_topics", TOPIC)].stage === 3);
  check("Widget de avance muestra 60%", (await page.textContent(".pd-widget--stage")).includes("60%"));
  await page.fill(".pd-window--progress .pd-progress__description", "Objetivo: fortalecer la actualización científica del equipo.");
  await page.waitForTimeout(1400);
  store = await dump(page);
  check("Objetivo guardado en config", store[dataPath("committee_topics", TOPIC, "desktop_meta", "config")].description.includes("fortalecer"));
  await page.screenshot({ path: path.join(OUT, "07-avance.png") });

  // Microsoft 365
  await openDock(page, "Microsoft 365");
  check("M365 muestra accesos del comité", (await page.locator(".pd-window--m365 .pd-m365__card:not(.is-empty)").count()) === 3);
  await page.click(".pd-window--m365 button:has-text('Configurar accesos')");
  await fillDialog(page, { xlsx: "https://panamericanenergy.sharepoint.com/:x:/t/DepartamentoMdico/demo-xlsx", teams: "https://teams.microsoft.com/l/channel/demo" });
  store = await dump(page);
  check("docLinks actualizado con xlsx y teams", store[dataPath("committee_topics", TOPIC)].docLinks.xlsx.includes("demo-xlsx") && store[dataPath("committee_topics", TOPIC)].docLinks.teams.includes("channel"));
  check("Íconos M365 del escritorio ahora 5", (await page.locator(".pd-icons .pd-file--m365").count()) === 5);
  await page.screenshot({ path: path.join(OUT, "08-m365.png") });

  // Actividad, papelera, ajustes, ayuda
  await openDock(page, "Actividad");
  check("Actividad registra eventos", (await page.locator(".pd-window--activity .pd-activity__row").count()) >= 5);
  await openDock(page, "Papelera");
  check("Papelera lista la carpeta archivada", (await page.textContent(".pd-window--trash")).includes("Protocolos 2026"));
  await page.click(".pd-window--trash button:has-text('Restaurar')");
  await page.waitForTimeout(300);
  store = await dump(page);
  check("Carpeta restaurada desde la papelera", Object.values(store).find((d) => d && d.name === "Protocolos 2026").archived === false);
  await openDock(page, "Ajustes del escritorio");
  await page.click(".pd-window--settings .pd-wallpaper-option--aurora");
  await page.waitForTimeout(300);
  check("Fondo cambiado a aurora (compartido en config)", (await page.getAttribute("body", "data-wallpaper")) === "aurora");
  await page.screenshot({ path: path.join(OUT, "09-ajustes.png") });

  // Gestor de ventanas
  const openCount = await page.locator(".pd-window:not(.is-minimized)").count();
  check("Varias ventanas abiertas simultáneamente", openCount >= 6, String(openCount));
  await page.click(".pd-window--settings .pd-window__light--min");
  await page.waitForTimeout(200);
  check("Minimizar oculta la ventana", await page.locator(".pd-window--settings").evaluate((el) => el.classList.contains("is-minimized")));
  await page.click(".pd-dock__app[aria-label='Ajustes del escritorio']");
  await page.waitForTimeout(200);
  check("Clic en dock restaura la ventana", !(await page.locator(".pd-window--settings").evaluate((el) => el.classList.contains("is-minimized"))));
  const before = await page.locator(".pd-window--settings").boundingBox();
  await page.mouse.move(before.x + 200, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 320, before.y + 140, { steps: 8 });
  await page.mouse.up();
  const after = await page.locator(".pd-window--settings").boundingBox();
  check("Ventana arrastrable desde la barra de título", Math.round(after.x - before.x) === 120 && Math.round(after.y - before.y) === 120, `${Math.round(after.x - before.x)},${Math.round(after.y - before.y)}`);
  await page.dblclick(".pd-window--settings .pd-window__titlebar", { position: { x: 300, y: 20 } });
  await page.waitForTimeout(200);
  check("Doble clic en título amplía", await page.locator(".pd-window--settings").evaluate((el) => el.classList.contains("is-maximized")));
  await page.click(".pd-window--settings .pd-window__light--close");
  await page.waitForTimeout(300);
  check("Cerrar ventana", (await page.locator(".pd-window--settings").count()) === 0);
  // Esc cierra la ventana activa
  await page.click(".pd-window--activity .pd-window__titlebar");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Esc cierra la ventana activa", (await page.locator(".pd-window--activity").count()) === 0);

  // Búsqueda rápida
  await page.keyboard.press("Control+k");
  await page.waitForSelector(".pd-spotlight__input", { timeout: 3000 });
  await page.fill(".pd-spotlight__input", "Planilla");
  await page.waitForTimeout(150);
  check("Búsqueda rápida encuentra el enlace", (await page.textContent(".pd-spotlight__results")).includes("Planilla de asistencia"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check("Esc cierra la búsqueda", (await page.locator(".pd-spotlight").count()) === 0);

  // Menú de la barra: Archivo
  await page.click(".pd-menubar__item:has-text('Archivo')");
  await page.waitForSelector(".pd-menu.is-visible");
  check("Menú Archivo con acciones", (await page.locator(".pd-menu .pd-menu__item").count()) >= 8);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(OUT, "10-multiventana.png") });

  const relevantErrors = errors.filter((e) => !/fonts|net::ERR_FAILED|Failed to load resource|ERR_BLOCKED/i.test(e));
  check("Consola sin errores relevantes (1440×900)", relevantErrors.length === 0, relevantErrors.slice(0, 5).join(" | "));
  await page.context().close();

  // ---------------------------------------------------------------------
  // 2. Móvil (390×844)
  // ---------------------------------------------------------------------
  const mobile = await newPage({ viewport: { width: 390, height: 844 } });
  await mobile.page.goto(desktopUrl());
  await waitReady(mobile.page);
  check("Móvil: escritorio carga", await mobile.page.isVisible("#pd-root"));
  const scrollWidth = await mobile.page.evaluate(() => document.documentElement.scrollWidth);
  check("Móvil: sin scroll horizontal", scrollWidth <= 390, String(scrollWidth));
  await mobile.page.screenshot({ path: path.join(OUT, "11-movil-escritorio.png") });
  await mobile.page.click(".pd-dock__app[aria-label='Archivos']");
  await mobile.page.waitForSelector(".pd-window--files", { timeout: 5000 });
  await mobile.page.waitForTimeout(300);
  const box = await mobile.page.locator(".pd-window--files").boundingBox();
  check("Móvil: ventana a pantalla completa", box && Math.round(box.width) === 390, box ? String(Math.round(box.width)) : "sin caja");
  await mobile.page.screenshot({ path: path.join(OUT, "12-movil-archivos.png") });
  await mobile.page.click(".pd-window--files .pd-window__mobile-close");
  await mobile.page.waitForTimeout(300);
  check("Móvil: botón cerrar visible y funcional", (await mobile.page.locator(".pd-window--files").count()) === 0);
  await mobile.page.click(".pd-dock__app[aria-label='Calendario']");
  await mobile.page.waitForTimeout(400);
  await mobile.page.screenshot({ path: path.join(OUT, "13-movil-calendario.png") });
  const mobileErrors = mobile.errors.filter((e) => !/fonts|net::ERR_FAILED|Failed to load resource|ERR_BLOCKED/i.test(e));
  check("Móvil: consola sin errores relevantes", mobileErrors.length === 0, mobileErrors.slice(0, 5).join(" | "));
  await mobile.context.close();

  // ---------------------------------------------------------------------
  // 3. Rutas de error
  // ---------------------------------------------------------------------
  const bad = await newPage();
  await bad.page.goto(`${BASE}/pages/comites/escritorio.html?comite=comite_invalido&proyecto=x`);
  await bad.page.waitForSelector(".pd-boot__card h1", { timeout: 5000 });
  check("Parámetros inválidos → pantalla de error", (await bad.page.textContent(".pd-boot__card h1")).includes("no disponible"));
  await bad.page.goto(`${BASE}/pages/comites/escritorio.html?comite=${COMMITTEE}&proyecto=no-existe`);
  await bad.page.waitForSelector(".pd-boot__card h1:has-text('Proyecto no encontrado')", { timeout: 8000 });
  check("Proyecto inexistente → pantalla de error", true);
  await bad.page.goto(`${BASE}/pages/comites/escritorio.html?comite=${COMMITTEE}&proyecto=topic-other`);
  await bad.page.waitForSelector(".pd-boot__card h1:has-text('otro comité')", { timeout: 8000 });
  check("Proyecto de otro comité → aviso", true);
  await bad.context.close();

  // Sin sesión → redirección al login
  const anon = await newPage({ user: null });
  await anon.page.goto(desktopUrl());
  await anon.page.waitForURL(/login\.html/, { timeout: 8000 });
  check("Sin sesión → redirige a login.html", anon.page.url().includes("login.html"));
  await anon.context.close();
} catch (error) {
  console.error("ERROR en la verificación:", error);
  results.push({ name: "Ejecución completa", ok: false, detail: String(error?.message || error) });
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, "resultado.json"), JSON.stringify({ when: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK · capturas en ${OUT}`);
process.exit(failed.length ? 1 : 0);
