// Escritorio de proyecto — arranque: autenticación, datos en tiempo real,
// escritorio (barra de menú, íconos, widgets, dock) y registro de apps.
import { getFirebase } from "../../common/firebaseClient.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initSessionGuard, performManagedLogout } from "../../shared/sessionGuard.js";
import { getUserProfile, hydrateAvatars } from "../../common/user-profiles.js";
import { getCommitteeInfo, isSafeId, buildCommitteePageUrl } from "../../common/project-desktop-link.js";
import { createDesktopStore } from "./store.js";
import { createWindowManager } from "./wm.js";
import { resolveProjectLinks, M365_QUICK_LINKS, kindMeta } from "./links.js";
import {
  h,
  clear,
  icon,
  toast,
  showMenu,
  openExternal,
  formatDate,
  formatDateShort,
  describeCountdown,
  todayKey,
  text,
  isCompactViewport,
  avatarNode
} from "./ui.js";
import { filesApp, linkTile, quickLinkTile, itemMenu, promptNewFolder, promptNewLink, sortItems } from "./apps/files.js";
import { calendarApp, promptEvent, upcomingEvents, EVENT_KINDS } from "./apps/calendar.js";
import { tasksApp, promptTask, taskStats } from "./apps/tasks.js";
import { notesApp, promptNewNote, NOTE_KINDS } from "./apps/notes.js";
import { boardApp } from "./apps/board.js";
import { teamApp } from "./apps/team.js";
import { progressApp, stepper, stageOf, PROJECT_STAGES } from "./apps/progress.js";
import { m365App, configureLinks } from "./apps/m365.js";
import { activityApp, trashApp, settingsApp, helpApp } from "./apps/misc.js";

const APP_ID = "departamento-medico-brisa";
const APPS = [filesApp, calendarApp, tasksApp, notesApp, boardApp, teamApp, progressApp, m365App, activityApp, trashApp, settingsApp, helpApp];
const DOCK_APPS = ["files", "calendar", "tasks", "notes", "board", "team", "progress", "m365", "activity", "trash", "settings"];

// ---------------------------------------------------------------------------
// Estado observable (clave → valor) con suscripción por claves.
// ---------------------------------------------------------------------------
function createState() {
  const values = new Map();
  const listeners = new Set();
  return {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
      listeners.forEach((entry) => {
        if (entry.keys.includes(key)) {
          try {
            entry.cb(key, value);
          } catch (error) {
            console.error("[Escritorio] Error en suscriptor de estado:", error);
          }
        }
      });
    },
    watch: (keys, cb) => {
      const entry = { keys, cb };
      listeners.add(entry);
      return () => listeners.delete(entry);
    }
  };
}

// ---------------------------------------------------------------------------
// Parámetros y validación
// ---------------------------------------------------------------------------
const params = new URLSearchParams(window.location.search);
const committeeId = text(params.get("comite"));
const topicId = text(params.get("proyecto"));
const committee = getCommitteeInfo(committeeId);

const root = document.getElementById("pd-root");
const boot = document.getElementById("pd-boot");

function fatal(title, message, { backHref = "../../index.html", backLabel = "Volver al Departamento Médico" } = {}) {
  clear(boot);
  boot.hidden = false;
  boot.appendChild(
    h("div", { className: "pd-boot__card" },
      icon("triangle-alert", { size: 36 }),
      h("h1", {}, title),
      h("p", {}, message),
      h("a", { className: "pd-btn pd-btn--primary", href: backHref }, backLabel))
  );
}

if (!committee || !isSafeId(topicId)) {
  fatal("Escritorio no disponible", "El enlace no indica un comité y un proyecto válidos. Volvé al comité y abrí el proyecto desde su tarjeta.");
  throw new Error("Parámetros inválidos del escritorio");
}

document.title = `Escritorio · ${committee.name} | Departamento Médico`;

let auth = null;
let db = null;
try {
  const firebase = getFirebase();
  auth = firebase?.auth || null;
  db = firebase?.db || null;
} catch (error) {
  console.error("[Escritorio] Error inicializando Firebase:", error);
}

if (!auth || !db) {
  fatal("Sin conexión con la plataforma", "No se pudo inicializar la sesión. Recargá la página o volvé a ingresar.", { backHref: "../../login.html", backLabel: "Ir al ingreso" });
  throw new Error("Firebase no disponible");
}

initSessionGuard({ auth, db, loginPath: "../../login.html" });

// ---------------------------------------------------------------------------
// Arranque con usuario autenticado
// ---------------------------------------------------------------------------
let started = false;
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../../login.html";
    return;
  }
  if (started) return;
  started = true;
  try {
    await startDesktop(user);
  } catch (error) {
    console.error("[Escritorio] Error al iniciar:", error);
    fatal("No se pudo abrir el escritorio", String(error?.message || error), { backHref: buildCommitteePageUrl(committeeId), backLabel: "Volver al comité" });
  }
});

async function resolveAdmin(user) {
  try {
    const token = await user.getIdTokenResult();
    if (token?.claims?.admin === true) return true;
  } catch (e) {
    /* sin claims */
  }
  try {
    const snap = await getDoc(doc(db, "admin_whitelist", user.uid));
    return snap.exists();
  } catch (e) {
    return false;
  }
}

async function startDesktop(user) {
  const state = createState();
  const profile = await getUserProfile(user.uid, { db, fallbackName: user.displayName || user.email || "Usuario" });
  const currentUser = { uid: user.uid, displayName: profile.displayName, email: user.email || "" };
  state.set("profile", profile);
  const isAdmin = await resolveAdmin(user);

  const store = createDesktopStore({ db, auth, appId: APP_ID, committeeId, topicId, getActor: () => ({ displayName: currentUser.displayName }) });

  // Comprobar que el proyecto exista antes de dibujar.
  const topicSnap = await getDoc(store.refs.topicRef);
  if (!topicSnap.exists()) {
    fatal("Proyecto no encontrado", "El proyecto ya no existe o el enlace es incorrecto.", { backHref: buildCommitteePageUrl(committeeId), backLabel: "Volver al comité" });
    return;
  }
  const initialTopic = { id: topicSnap.id, ...topicSnap.data() };
  if (text(initialTopic.committeeId) && initialTopic.committeeId !== committeeId) {
    fatal("El proyecto pertenece a otro comité", "Abrilo desde la página de su comité.", { backHref: buildCommitteePageUrl(initialTopic.committeeId), backLabel: "Ir al comité correcto" });
    return;
  }
  state.set("topic", initialTopic);

  const committeeMeta = await store.readCommitteeMeta();
  const committeeName = text(committeeMeta?.title) || committee.name;
  const committeeInfo = { ...committee, name: committeeName };

  // Circuito para proyectos nuevos: el escritorio se inaugura solo la primera vez.
  try {
    const created = await store.ensureProvisioned();
    if (created) toast("Escritorio del proyecto inaugurado con carpetas base.", { type: "success", timeout: 4200 });
  } catch (error) {
    console.warn("[Escritorio] No se pudo aprovisionar el escritorio:", error);
  }

  // Contexto compartido con las apps.
  const hooks = { onWindowsChange: () => {} };
  const wm = createWindowManager({ root: document.getElementById("pd-windows"), storageKey: `pd:${topicId}:wm`, onChange: (snapshot) => hooks.onWindowsChange(snapshot) });
  let meetingSyncTimer = null;
  const ctx = {
    state,
    store,
    user: currentUser,
    isAdmin,
    committee: committeeInfo,
    topicId,
    hydrateAvatars: (rootEl) => hydrateAvatars(rootEl).catch(() => {}),
    links: () => resolveProjectLinks(committeeId, state.get("topic")),
    projectTitle: () => text(state.get("topic")?.title) || "Proyecto",
    openApp: (id, appParams) => openApp(id, appParams),
    closeApp: (id) => wm.close(id),
    resetLayout: () => wm.resetLayout(),
    scheduleMeetingSync: () => {
      clearTimeout(meetingSyncTimer);
      meetingSyncTimer = setTimeout(async () => {
        try {
          const changed = await store.syncNextMeeting(state.get("events") || [], state.get("topic"));
          if (changed !== null) toast(changed ? `Próxima reunión de la tarjeta: ${formatDate(changed)}.` : "La tarjeta ya no tiene próxima reunión.", { type: "info" });
        } catch (error) {
          console.warn("[Escritorio] No se pudo sincronizar la próxima reunión:", error);
        }
      }, 1200);
    },
    explainTopicError: (error) => {
      if (error?.code === "permission-denied") {
        return "No tenés permiso para editar la ficha de este proyecto (proyecto sin autor registrado: solo un administrador puede editarlo).";
      }
      return "No se pudo guardar el cambio. Intentá nuevamente.";
    }
  };

  const appById = new Map(APPS.map((app) => [app.id, app]));
  function openApp(id, appParams) {
    const app = appById.get(id);
    if (!app) return;
    wm.open(app, ctx, { params: appParams });
  }

  // Suscripciones en tiempo real.
  const unsubs = [];
  const onError = (error, label) => {
    if (error?.code === "permission-denied") toast(`Sin permiso para leer ${label}. Pedí a un administrador que publique las reglas del escritorio.`, { type: "error", timeout: 6000 });
  };
  unsubs.push(store.subscribeTopic((topic) => {
    if (!topic) {
      fatal("El proyecto fue eliminado", "Este proyecto ya no existe en el comité.", { backHref: buildCommitteePageUrl(committeeId), backLabel: "Volver al comité" });
      return;
    }
    state.set("topic", topic);
  }, onError));
  unsubs.push(store.subscribeConfig((config) => state.set("config", config), onError));
  unsubs.push(store.subscribeItems((items) => state.set("items", items), onError));
  unsubs.push(store.subscribeTasks((tasks) => state.set("tasks", tasks), onError));
  unsubs.push(store.subscribeNotes((notes) => state.set("notes", notes), onError));
  unsubs.push(store.subscribeEvents((events) => state.set("events", events), onError));
  unsubs.push(store.subscribeBoardNotes((notes) => state.set("boardNotes", notes), onError));
  unsubs.push(store.subscribeMembers((members) => state.set("members", members), onError));
  unsubs.push(store.subscribeActivity((entries) => state.set("activity", entries), onError));
  window.addEventListener("beforeunload", () => unsubs.forEach((fn) => fn && fn()));

  hooks.onWindowsChange = buildShell(ctx, wm, openApp);
  boot.hidden = true;
  root.hidden = false;
  document.body.classList.add("is-ready");

  const initialApp = text(params.get("app"));
  if (initialApp && appById.has(initialApp)) openApp(initialApp);
}

// ---------------------------------------------------------------------------
// Escritorio: barra de menú, íconos, widgets, dock y búsqueda rápida
// ---------------------------------------------------------------------------
function buildShell(ctx, wm, openApp) {
  const { state } = ctx;
  const menubar = document.getElementById("pd-menubar");
  const desktop = document.getElementById("pd-desktop");
  const iconsEl = document.getElementById("pd-icons");
  const widgetsEl = document.getElementById("pd-widgets");
  const dockEl = document.getElementById("pd-dock");

  // --- Barra de menú ------------------------------------------------------
  const buildMenubar = () => {
    clear(menubar);
    const left = h("div", { className: "pd-menubar__left" });
    const brand = h("a", { className: "pd-menubar__brand", href: "../../index.html", title: "Departamento Médico" }, h("img", { src: "../../assets/images/logo-identity.png", alt: "Brisa", width: 20, height: 20 }));
    left.appendChild(brand);
    const projectMenu = h("button", { type: "button", className: "pd-menubar__item pd-menubar__item--strong", "aria-haspopup": "menu" }, h("span", { className: "pd-menubar__project" }, ctx.projectTitle()));
    projectMenu.addEventListener("click", () => {
      showMenu(
        [
          { label: "Ficha y avance", icon: "target", onSelect: () => openApp("progress") },
          { label: "Ajustes del escritorio", icon: "settings", onSelect: () => openApp("settings") },
          { separator: true },
          { label: `Volver al ${ctx.committee.name}`, icon: "arrow-left", onSelect: () => { window.location.href = buildCommitteePageUrl(ctx.committee.id); } },
          { label: "Departamento Médico (inicio)", icon: "house", onSelect: () => { window.location.href = "../../index.html"; } }
        ],
        { anchor: projectMenu }
      );
    });
    left.appendChild(projectMenu);
    const menus = [
      {
        label: "Archivo",
        items: () => [
          { label: "Nueva carpeta", icon: "folder-plus", onSelect: () => promptNewFolder(ctx, "") },
          { label: "Agregar enlace o archivo", icon: "link", onSelect: () => promptNewLink(ctx, "") },
          { separator: true },
          { label: "Nuevo evento", icon: "calendar-plus", onSelect: () => promptEvent(ctx, { dateKey: todayKey() }) },
          { label: "Nueva tarea", icon: "square-check", onSelect: () => promptTask(ctx) },
          { label: "Nueva acta de reunión", icon: "clipboard-check", onSelect: () => openApp("notes", { create: true, kind: "acta" }) },
          { label: "Nueva nota", icon: "notebook-pen", onSelect: () => openApp("notes", { create: true, kind: "nota" }) },
          { separator: true },
          { label: "Abrir carpeta del proyecto (Teams)", icon: "folder-open", disabled: !ctx.links().folder, onSelect: () => openExternal(ctx.links().folder) },
          { label: "Configurar accesos Microsoft 365", icon: "cloud", onSelect: () => configureLinks(ctx) }
        ]
      },
      {
        label: "Ver",
        items: () => [
          ...APPS.filter((app) => DOCK_APPS.includes(app.id)).map((app) => ({ label: app.title, icon: app.icon, checked: wm.isOpen(app.id), onSelect: () => openApp(app.id) })),
          { separator: true },
          { label: "Cerrar todas las ventanas", icon: "x", disabled: !wm.snapshot().open.length, onSelect: () => wm.closeAll() },
          { label: "Restablecer disposición", icon: "refresh-cw", onSelect: () => wm.resetLayout() }
        ]
      },
      {
        label: "Ir",
        items: () => [
          { label: ctx.committee.name, icon: "arrow-left", onSelect: () => { window.location.href = buildCommitteePageUrl(ctx.committee.id); } },
          { label: "Calendario del comité", icon: "calendar-days", onSelect: () => { window.location.href = `${buildCommitteePageUrl(ctx.committee.id)}#calendario-comite`; } },
          { label: "Departamento Médico", icon: "house", onSelect: () => { window.location.href = "../../index.html"; } },
          { separator: true },
          ...M365_QUICK_LINKS.filter((entry) => ctx.links()[entry.key]).map((entry) => ({ label: entry.title, icon: entry.icon, onSelect: () => openExternal(ctx.links()[entry.key]) }))
        ]
      },
      {
        label: "Ayuda",
        items: () => [
          { label: "Cómo usar el escritorio", icon: "circle-question-mark", onSelect: () => openApp("help") },
          { label: "Búsqueda rápida", icon: "search", shortcut: "⌘K", onSelect: () => openSpotlight() }
        ]
      }
    ];
    menus.forEach((menu) => {
      const btn = h("button", { type: "button", className: "pd-menubar__item", "aria-haspopup": "menu" }, menu.label);
      btn.addEventListener("click", () => showMenu(menu.items(), { anchor: btn }));
      left.appendChild(btn);
    });
    menubar.appendChild(left);

    const right = h("div", { className: "pd-menubar__right" });
    const searchBtn = h("button", { type: "button", className: "pd-menubar__icon", title: "Búsqueda rápida (⌘K)", "aria-label": "Búsqueda rápida", onclick: () => openSpotlight() }, icon("search", { size: 15 }));
    right.appendChild(searchBtn);
    const committeeChip = h("a", { className: "pd-menubar__chip", href: buildCommitteePageUrl(ctx.committee.id), title: `Volver al ${ctx.committee.name}` }, icon("arrow-left", { size: 13 }), h("span", {}, ctx.committee.name));
    right.appendChild(committeeChip);
    const clock = h("span", { className: "pd-menubar__clock", "aria-live": "off" });
    const tick = () => {
      const now = new Date();
      clock.textContent = `${now.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })} ${now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
    };
    tick();
    setInterval(tick, 30000);
    right.appendChild(clock);
    const userBtn = h("button", { type: "button", className: "pd-menubar__user", "aria-haspopup": "menu", title: ctx.user.displayName });
    userBtn.appendChild(avatarNode({ name: ctx.user.displayName, uid: ctx.user.uid, size: 22, className: "pd-avatar--current" }));
    userBtn.appendChild(h("span", { className: "pd-menubar__user-name" }, ctx.user.displayName));
    userBtn.addEventListener("click", () => {
      showMenu(
        [
          { label: ctx.user.displayName, icon: "user", disabled: true },
          { separator: true },
          { label: "Mi perfil (inicio)", icon: "house", onSelect: () => { window.location.href = "../../index.html"; } },
          { label: "Cerrar sesión", icon: "log-out", danger: true, onSelect: () => performManagedLogout({ auth: getFirebase().auth, db: getFirebase().db, loginPath: "../../login.html" }) }
        ],
        { anchor: userBtn, align: "end" }
      );
    });
    right.appendChild(userBtn);
    menubar.appendChild(right);
    ctx.hydrateAvatars(menubar);
  };

  // --- Íconos del escritorio ---------------------------------------------
  const renderIcons = () => {
    clear(iconsEl);
    const links = ctx.links();
    const items = (state.get("items") || []).filter((item) => !item.archived);
    const groupM365 = h("div", { className: "pd-icons__group", role: "list", "aria-label": "Accesos Microsoft 365" });
    M365_QUICK_LINKS.filter((entry) => links[entry.key]).forEach((entry) => {
      const tile = quickLinkTile(entry, links[entry.key]);
      tile.classList.add("pd-file--desktop");
      tile.setAttribute("role", "listitem");
      groupM365.appendChild(tile);
    });
    if (groupM365.childElementCount) iconsEl.appendChild(groupM365);

    const pinned = sortItems(items.filter((item) => item.pinned));
    const rootFolders = sortItems(items.filter((item) => item.type === "folder" && !item.parentId && !item.pinned));
    const group = h("div", { className: "pd-icons__group", role: "list", "aria-label": "Carpetas y accesos del proyecto" });
    [...pinned, ...rootFolders].forEach((item) => {
      const tile = linkTile(item, {
        onOpen: (entry) => {
          if (entry.type === "folder") openApp("files", { folderId: entry.id });
          else openExternal(entry.url);
        },
        onMenu: (entry, position) => itemMenu(ctx, entry, position, { onOpenFolder: (id) => openApp("files", { folderId: id }) })
      });
      tile.classList.add("pd-file--desktop");
      tile.setAttribute("role", "listitem");
      group.appendChild(tile);
    });
    if (group.childElementCount) iconsEl.appendChild(group);
    if (!iconsEl.childElementCount) {
      iconsEl.appendChild(h("p", { className: "pd-icons__hint" }, "Fijá archivos o carpetas para verlos acá como íconos."));
    }
  };

  // --- Widgets --------------------------------------------------------------
  const renderWidgets = () => {
    clear(widgetsEl);
    const topic = state.get("topic") || {};
    const tasks = taskStats(state.get("tasks") || []);
    const events = state.get("events") || [];
    const team = Array.isArray(state.get("config")?.team) ? state.get("config").team : [];
    const stage = stageOf(topic);

    const header = h("div", { className: "pd-widget pd-widget--title" });
    header.appendChild(h("p", { className: "pd-widget__eyebrow" }, ctx.committee.name));
    header.appendChild(h("h1", { className: "pd-widget__project" }, ctx.projectTitle()));
    header.appendChild(h("p", { className: "pd-widget__meta" }, `Propuesto por ${text(topic.proposedBy) || "—"} · inicio ${formatDate(topic.startDate) || "—"}`));
    widgetsEl.appendChild(header);

    const stageWidget = h("button", { type: "button", className: "pd-widget pd-widget--stage", onclick: () => openApp("progress"), "aria-label": "Abrir avance del proyecto" });
    stageWidget.appendChild(h("p", { className: "pd-widget__label" }, icon("target", { size: 13 }), h("span", {}, "Avance")));
    stageWidget.appendChild(h("p", { className: "pd-widget__big" }, `${stage * 20}%`, h("small", {}, PROJECT_STAGES[stage - 1].label)));
    stageWidget.appendChild(stepper(ctx, topic, { interactive: false, compact: true }));
    widgetsEl.appendChild(stageWidget);

    const meetingWidget = h("button", { type: "button", className: "pd-widget pd-widget--meeting", onclick: () => openApp("calendar", { dateKey: topic.nextMeeting || todayKey() }), "aria-label": "Abrir calendario" });
    meetingWidget.appendChild(h("p", { className: "pd-widget__label" }, icon("calendar-days", { size: 13 }), h("span", {}, "Próxima reunión")));
    if (topic.nextMeeting) {
      meetingWidget.appendChild(h("p", { className: "pd-widget__big" }, formatDateShort(topic.nextMeeting), h("small", {}, describeCountdown(topic.nextMeeting))));
    } else {
      meetingWidget.appendChild(h("p", { className: "pd-widget__big pd-widget__big--muted" }, "Sin fecha", h("small", {}, "Agendá una reunión")));
    }
    const upcoming = upcomingEvents(events, 3);
    if (upcoming.length) {
      const ul = h("ul", { className: "pd-widget__list" });
      upcoming.forEach((event) => ul.appendChild(h("li", {}, h("i", { className: `pd-dot pd-dot--${(EVENT_KINDS[event.eventKind] || EVENT_KINDS.reunion).color}` }), h("span", {}, `${formatDateShort(event.dateKey)} · ${event.title}`))));
      meetingWidget.appendChild(ul);
    }
    widgetsEl.appendChild(meetingWidget);

    const tasksWidget = h("button", { type: "button", className: "pd-widget pd-widget--tasks", onclick: () => openApp("tasks"), "aria-label": "Abrir tareas" });
    tasksWidget.appendChild(h("p", { className: "pd-widget__label" }, icon("list-checks", { size: 13 }), h("span", {}, "Tareas")));
    tasksWidget.appendChild(h("p", { className: "pd-widget__big" }, `${tasks.done}/${tasks.total}`, h("small", {}, tasks.total ? `${tasks.percent}% hechas${tasks.overdue ? ` · ${tasks.overdue} vencidas` : ""}` : "Sin tareas todavía")));
    tasksWidget.appendChild(h("span", { className: "pd-widget__bar" }, h("i", { style: { width: `${tasks.percent}%` } })));
    widgetsEl.appendChild(tasksWidget);

    const teamWidget = h("button", { type: "button", className: "pd-widget pd-widget--team", onclick: () => openApp("team"), "aria-label": "Abrir equipo" });
    teamWidget.appendChild(h("p", { className: "pd-widget__label" }, icon("users", { size: 13 }), h("span", {}, "Equipo")));
    const avatars = h("div", { className: "pd-widget__avatars" });
    team.slice(0, 6).forEach((member) => avatars.appendChild(avatarNode({ name: member.name, uid: member.uid, size: 30 })));
    if (team.length > 6) avatars.appendChild(h("span", { className: "pd-widget__avatar-more" }, `+${team.length - 6}`));
    if (!team.length) avatars.appendChild(h("span", { className: "pd-widget__muted" }, "Sumá integrantes"));
    teamWidget.appendChild(avatars);
    widgetsEl.appendChild(teamWidget);
    ctx.hydrateAvatars(teamWidget);
  };

  // --- Dock ------------------------------------------------------------------
  const renderDock = (snapshot = wm.snapshot()) => {
    clear(dockEl);
    const inner = h("div", { className: "pd-dock__inner", role: "toolbar", "aria-label": "Aplicaciones del escritorio" });
    DOCK_APPS.forEach((id, index) => {
      const app = APPS.find((entry) => entry.id === id);
      if (!app) return;
      if (id === "activity" || id === "settings") inner.appendChild(h("span", { className: "pd-dock__sep", "aria-hidden": "true" }));
      const isOpen = snapshot.open.includes(id);
      const btn = h("button", {
        type: "button",
        className: `pd-dock__app pd-dock__app--${app.tone}${isOpen ? " is-open" : ""}${snapshot.active === id ? " is-active" : ""}`,
        "aria-label": app.title,
        "aria-pressed": isOpen ? "true" : "false",
        onclick: () => {
          if (isOpen && snapshot.active === id && !snapshot.minimized.includes(id)) wm.minimize(id);
          else openApp(id);
        }
      });
      btn.appendChild(h("span", { className: "pd-dock__glyph" }, icon(app.icon, { size: 26, strokeWidth: 1.9 })));
      btn.appendChild(h("span", { className: "pd-dock__label" }, app.title));
      if (id === "tasks") {
        const stats = taskStats(state.get("tasks") || []);
        if (stats.total - stats.done > 0) btn.appendChild(h("span", { className: "pd-dock__badge" }, String(stats.total - stats.done)));
      }
      if (id === "trash") {
        const archived = ["items", "tasks", "notes"].reduce((sum, key) => sum + (state.get(key) || []).filter((e) => e.archived).length, 0);
        if (archived) btn.classList.add("is-full");
      }
      inner.appendChild(btn);
    });
    dockEl.appendChild(inner);
  };

  // --- Búsqueda rápida (⌘K) -------------------------------------------------
  let spotlightOpen = false;
  const openSpotlight = () => {
    if (spotlightOpen) return;
    spotlightOpen = true;
    const overlay = h("div", { className: "pd-spotlight-overlay" });
    const box = h("div", { className: "pd-spotlight", role: "dialog", "aria-label": "Búsqueda rápida" });
    const input = h("input", { type: "search", className: "pd-spotlight__input", placeholder: "Buscar archivos, tareas, actas, eventos…", "aria-label": "Buscar" });
    const results = h("div", { className: "pd-spotlight__results", role: "listbox" });
    box.appendChild(h("span", { className: "pd-spotlight__icon" }, icon("search", { size: 18 })));
    box.appendChild(input);
    box.appendChild(results);
    overlay.appendChild(box);
    const close = () => {
      overlay.remove();
      spotlightOpen = false;
    };
    const collect = (term) => {
      const q = term.toLowerCase();
      const out = [];
      const push = (entry) => out.length < 12 && out.push(entry);
      APPS.filter((app) => DOCK_APPS.includes(app.id) && app.title.toLowerCase().includes(q)).forEach((app) => push({ icon: app.icon, title: app.title, subtitle: "Aplicación", run: () => openApp(app.id) }));
      (state.get("items") || []).filter((i) => !i.archived && `${i.name} ${i.note || ""}`.toLowerCase().includes(q)).forEach((item) => push({ icon: item.type === "folder" ? "folder" : kindMeta(item.kind).icon, title: item.name, subtitle: item.type === "folder" ? "Carpeta" : kindMeta(item.kind).label, run: () => (item.type === "folder" ? openApp("files", { folderId: item.id }) : openExternal(item.url)) }));
      (state.get("tasks") || []).filter((t) => !t.archived && `${t.title} ${t.assignee || ""}`.toLowerCase().includes(q)).forEach((task) => push({ icon: "square-check", title: task.title, subtitle: `Tarea · ${task.assignee || "sin responsable"}`, run: () => openApp("tasks") }));
      (state.get("notes") || []).filter((n) => !n.archived && `${n.title} ${n.body || ""}`.toLowerCase().includes(q)).forEach((note) => push({ icon: (NOTE_KINDS[note.kind] || NOTE_KINDS.nota).icon, title: note.title, subtitle: (NOTE_KINDS[note.kind] || NOTE_KINDS.nota).label, run: () => openApp("notes", { noteId: note.id }) }));
      (state.get("events") || []).filter((e) => `${e.title} ${e.note || ""}`.toLowerCase().includes(q)).forEach((event) => push({ icon: "calendar-days", title: event.title, subtitle: `Evento · ${formatDateShort(event.dateKey)}`, run: () => openApp("calendar", { dateKey: event.dateKey }) }));
      return out;
    };
    const renderResults = () => {
      clear(results);
      const term = text(input.value).trim();
      const entries = term ? collect(term) : APPS.filter((app) => DOCK_APPS.includes(app.id)).slice(0, 8).map((app) => ({ icon: app.icon, title: app.title, subtitle: "Aplicación", run: () => openApp(app.id) }));
      if (!entries.length) {
        results.appendChild(h("p", { className: "pd-spotlight__empty" }, "Sin resultados."));
        return;
      }
      entries.forEach((entry, index) => {
        results.appendChild(h("button", { type: "button", role: "option", className: `pd-spotlight__item${index === 0 ? " is-active" : ""}`, onclick: () => { close(); entry.run(); } }, icon(entry.icon, { size: 16 }), h("span", { className: "pd-spotlight__text" }, h("strong", {}, entry.title), h("small", {}, entry.subtitle))));
      });
    };
    input.addEventListener("input", renderResults);
    input.addEventListener("keydown", (event) => {
      const items = Array.from(results.querySelectorAll(".pd-spotlight__item"));
      const activeIndex = items.findIndex((el) => el.classList.contains("is-active"));
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!items.length) return;
        const next = event.key === "ArrowDown" ? (activeIndex + 1) % items.length : (activeIndex - 1 + items.length) % items.length;
        items.forEach((el, i) => el.classList.toggle("is-active", i === next));
      } else if (event.key === "Enter") {
        event.preventDefault();
        (items[activeIndex] || items[0])?.click();
      } else if (event.key === "Escape") {
        close();
      }
    });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) close();
    });
    document.body.appendChild(overlay);
    renderResults();
    requestAnimationFrame(() => input.focus());
  };

  // Atajos de teclado globales.
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSpotlight();
    }
  });

  // Menú contextual del escritorio.
  desktop.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".pd-window, .pd-file, .pd-widget, .pd-dock")) return;
    event.preventDefault();
    showMenu(
      [
        { label: "Nueva carpeta", icon: "folder-plus", onSelect: () => promptNewFolder(ctx, "") },
        { label: "Agregar enlace o archivo", icon: "link", onSelect: () => promptNewLink(ctx, "", { pinned: true }) },
        { separator: true },
        { label: "Nuevo evento", icon: "calendar-plus", onSelect: () => promptEvent(ctx, { dateKey: todayKey() }) },
        { label: "Nueva tarea", icon: "square-check", onSelect: () => promptTask(ctx) },
        { label: "Nueva acta", icon: "clipboard-check", onSelect: () => openApp("notes", { create: true, kind: "acta" }) },
        { separator: true },
        { label: "Cambiar fondo…", icon: "palette", onSelect: () => openApp("settings") }
      ],
      { x: event.clientX, y: event.clientY }
    );
  });

  const applyWallpaper = () => {
    const key = text(state.get("config")?.wallpaper) || "brisa";
    document.body.dataset.wallpaper = key;
  };

  buildMenubar();
  renderIcons();
  renderWidgets();
  renderDock();
  applyWallpaper();
  state.watch(["items", "topic"], renderIcons);
  state.watch(["topic", "tasks", "events", "config"], renderWidgets);
  state.watch(["tasks", "items", "notes"], () => renderDock());
  state.watch(["config"], applyWallpaper);
  state.watch(["topic"], () => {
    const title = ctx.projectTitle();
    document.title = `${title} · Escritorio | Departamento Médico`;
    const label = menubar.querySelector(".pd-menubar__project");
    if (label) label.textContent = title;
  });

  // En pantallas chicas, mostrar un aviso breve la primera vez.
  if (isCompactViewport()) {
    try {
      if (!localStorage.getItem("pd:compact-hint")) {
        toast("Modo compacto: las ventanas se abren a pantalla completa. Usá la barra inferior para cambiar de app.", { type: "info", timeout: 5000 });
        localStorage.setItem("pd:compact-hint", "1");
      }
    } catch (e) {
      /* sin almacenamiento */
    }
  }

  return renderDock;
}
