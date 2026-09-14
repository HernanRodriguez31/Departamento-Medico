// Gestor de ventanas del escritorio de proyecto: ventanas arrastrables y
// redimensionables, foco/z-order, minimizar a la barra (dock), maximizar,
// persistencia de geometría y modo compacto (móvil: ventanas a pantalla completa).
import { h, icon, clear, isCompactViewport, uid } from "./ui.js";

const MIN_W = 320;
const MIN_H = 240;
const MENUBAR_H = 34;
const DOCK_H = 92;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createWindowManager({ root, dockEl, storageKey = "pd:wm", onChange = () => {} }) {
  const windows = new Map(); // appId -> record
  let zCounter = 20;
  let geometry = {};
  try {
    geometry = JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
  } catch (e) {
    geometry = {};
  }
  const persist = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(geometry));
    } catch (e) {
      /* almacenamiento no disponible */
    }
  };

  const area = () => ({
    width: root.clientWidth,
    height: root.clientHeight
  });

  const defaultRect = (app, index) => {
    const { width, height } = area();
    const w = clamp(app.defaultSize?.w || 860, MIN_W, Math.max(MIN_W, width - 24));
    const hh = clamp(app.defaultSize?.h || 560, MIN_H, Math.max(MIN_H, height - DOCK_H - 12));
    const offset = (index % 6) * 28;
    return {
      x: clamp(Math.round((width - w) / 2) + offset, 8, Math.max(8, width - w - 8)),
      y: clamp(Math.round((height - DOCK_H - hh) / 2) + offset, 8, Math.max(8, height - DOCK_H - hh)),
      w,
      h: hh
    };
  };

  const applyRect = (record) => {
    const { el, rect, maximized } = record;
    if (isCompactViewport()) {
      el.style.left = "0px";
      el.style.top = "0px";
      el.style.width = "100%";
      el.style.height = "100%";
      return;
    }
    if (maximized) {
      const { width, height } = area();
      el.style.left = "6px";
      el.style.top = "6px";
      el.style.width = `${width - 12}px`;
      el.style.height = `${height - DOCK_H - 4}px`;
      return;
    }
    const { width, height } = area();
    rect.w = clamp(rect.w, MIN_W, Math.max(MIN_W, width - 16));
    rect.h = clamp(rect.h, MIN_H, Math.max(MIN_H, height - 16));
    rect.x = clamp(rect.x, -rect.w + 120, Math.max(0, width - 120));
    rect.y = clamp(rect.y, 0, Math.max(0, height - 60));
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
  };

  const focus = (appId) => {
    const record = windows.get(appId);
    if (!record) return;
    if (record.minimized) restore(appId);
    zCounter += 1;
    record.el.style.zIndex = String(zCounter);
    windows.forEach((other) => other.el.classList.toggle("is-active", other === record));
    onChange(snapshot());
  };

  const activeApp = () => {
    let best = null;
    windows.forEach((record) => {
      if (record.minimized) return;
      const z = Number(record.el.style.zIndex || 0);
      if (!best || z > best.z) best = { z, record };
    });
    return best?.record || null;
  };

  const snapshot = () => ({
    open: Array.from(windows.keys()),
    minimized: Array.from(windows.values()).filter((r) => r.minimized).map((r) => r.app.id),
    active: activeApp()?.app.id || null
  });

  const restore = (appId) => {
    const record = windows.get(appId);
    if (!record) return;
    record.minimized = false;
    record.el.classList.remove("is-minimized");
    record.el.removeAttribute("aria-hidden");
    onChange(snapshot());
  };

  const minimize = (appId) => {
    const record = windows.get(appId);
    if (!record) return;
    record.minimized = true;
    record.el.classList.add("is-minimized");
    record.el.setAttribute("aria-hidden", "true");
    const next = activeApp();
    if (next) focus(next.app.id);
    else onChange(snapshot());
  };

  const toggleMaximize = (appId) => {
    const record = windows.get(appId);
    if (!record || isCompactViewport()) return;
    record.maximized = !record.maximized;
    record.el.classList.toggle("is-maximized", record.maximized);
    applyRect(record);
    geometry[appId] = { ...record.rect, maximized: record.maximized };
    persist();
  };

  const close = (appId) => {
    const record = windows.get(appId);
    if (!record) return;
    try {
      record.instance?.destroy?.();
    } catch (error) {
      console.warn("[Escritorio] Error al cerrar la app:", error);
    }
    record.el.classList.add("is-closing");
    windows.delete(appId);
    setTimeout(() => record.el.remove(), 160);
    const next = activeApp();
    if (next) focus(next.app.id);
    else onChange(snapshot());
  };

  const closeAll = () => Array.from(windows.keys()).forEach(close);

  const installDrag = (record, handle) => {
    let dragging = null;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || isCompactViewport() || record.maximized) return;
      if (event.target.closest("button")) return;
      dragging = { startX: event.clientX, startY: event.clientY, originX: record.rect.x, originY: record.rect.y };
      handle.setPointerCapture(event.pointerId);
      record.el.classList.add("is-dragging");
      focus(record.app.id);
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      record.rect.x = dragging.originX + (event.clientX - dragging.startX);
      record.rect.y = dragging.originY + (event.clientY - dragging.startY);
      applyRect(record);
    });
    const stop = (event) => {
      if (!dragging) return;
      dragging = null;
      record.el.classList.remove("is-dragging");
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch (e) {
        /* ya liberado */
      }
      geometry[record.app.id] = { ...record.rect, maximized: false };
      persist();
    };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
    handle.addEventListener("dblclick", (event) => {
      if (event.target.closest("button")) return;
      toggleMaximize(record.app.id);
    });
  };

  const installResize = (record, grip) => {
    let resizing = null;
    grip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || isCompactViewport() || record.maximized) return;
      resizing = { startX: event.clientX, startY: event.clientY, originW: record.rect.w, originH: record.rect.h };
      grip.setPointerCapture(event.pointerId);
      record.el.classList.add("is-resizing");
      focus(record.app.id);
      event.preventDefault();
    });
    grip.addEventListener("pointermove", (event) => {
      if (!resizing) return;
      record.rect.w = resizing.originW + (event.clientX - resizing.startX);
      record.rect.h = resizing.originH + (event.clientY - resizing.startY);
      applyRect(record);
    });
    const stop = (event) => {
      if (!resizing) return;
      resizing = null;
      record.el.classList.remove("is-resizing");
      try {
        grip.releasePointerCapture(event.pointerId);
      } catch (e) {
        /* ya liberado */
      }
      geometry[record.app.id] = { ...record.rect, maximized: false };
      persist();
    };
    grip.addEventListener("pointerup", stop);
    grip.addEventListener("pointercancel", stop);
  };

  const open = (app, ctx, options = {}) => {
    const existing = windows.get(app.id);
    if (existing) {
      focus(app.id);
      if (options.params && existing.instance?.update) existing.instance.update(options.params);
      return existing;
    }
    const saved = geometry[app.id];
    const rect = saved && saved.w ? { x: saved.x, y: saved.y, w: saved.w, h: saved.h } : defaultRect(app, windows.size);
    const titleId = uid();
    const el = h("section", {
      className: `pd-window pd-window--${app.id}`,
      role: "dialog",
      "aria-labelledby": titleId,
      dataset: { app: app.id },
      tabindex: "-1"
    });
    const titlebar = h("header", { className: "pd-window__titlebar" });
    const lights = h("div", { className: "pd-window__lights" });
    const mkLight = (kind, label, handler) =>
      h("button", { type: "button", className: `pd-window__light pd-window__light--${kind}`, title: label, "aria-label": `${label} ventana ${app.title}`, onclick: handler });
    lights.appendChild(mkLight("close", "Cerrar", () => close(app.id)));
    lights.appendChild(mkLight("min", "Minimizar", () => minimize(app.id)));
    lights.appendChild(mkLight("max", "Ampliar", () => toggleMaximize(app.id)));
    titlebar.appendChild(lights);
    const title = h("div", { className: "pd-window__title", id: titleId }, icon(app.icon, { size: 15 }), h("span", {}, app.title));
    titlebar.appendChild(title);
    const mobileClose = h("button", { type: "button", className: "pd-window__mobile-close", "aria-label": `Cerrar ${app.title}`, onclick: () => close(app.id) }, icon("x", { size: 18 }));
    titlebar.appendChild(mobileClose);
    el.appendChild(titlebar);
    const body = h("div", { className: "pd-window__body" });
    el.appendChild(body);
    const grip = h("div", { className: "pd-window__grip", "aria-hidden": "true" });
    el.appendChild(grip);
    root.appendChild(el);

    const record = { app, el, body, rect, maximized: Boolean(saved?.maximized), minimized: false, instance: null };
    if (record.maximized) el.classList.add("is-maximized");
    windows.set(app.id, record);
    applyRect(record);
    installDrag(record, titlebar);
    installResize(record, grip);
    el.addEventListener("pointerdown", () => {
      if (activeApp() !== record) focus(app.id);
    });
    el.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector(".pd-modal-overlay.is-visible") && !document.querySelector(".pd-menu")) {
        close(app.id);
      }
    });
    try {
      record.instance = app.mount(body, ctx, options.params || {}) || null;
    } catch (error) {
      console.error(`[Escritorio] Error al abrir ${app.id}:`, error);
      clear(body).appendChild(h("div", { className: "pd-empty" }, h("p", { className: "pd-empty__title" }, "No se pudo abrir esta ventana."), h("p", { className: "pd-empty__message" }, String(error?.message || error))));
    }
    requestAnimationFrame(() => {
      el.classList.add("is-open");
      focus(app.id);
      const focusable = body.querySelector("input, textarea, select, button, [tabindex='0']");
      (focusable || el).focus({ preventScroll: true });
    });
    onChange(snapshot());
    return record;
  };

  const isOpen = (appId) => windows.has(appId);
  const get = (appId) => windows.get(appId) || null;

  const resetLayout = () => {
    geometry = {};
    persist();
    let index = 0;
    windows.forEach((record) => {
      record.maximized = false;
      record.el.classList.remove("is-maximized");
      record.rect = defaultRect(record.app, index);
      index += 1;
      applyRect(record);
    });
  };

  window.addEventListener("resize", () => windows.forEach(applyRect));

  return { open, close, closeAll, focus, minimize, restore, toggleMaximize, isOpen, get, snapshot, activeApp, resetLayout, MENUBAR_H, DOCK_H };
}
