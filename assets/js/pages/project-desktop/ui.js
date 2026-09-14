// Helpers de interfaz del escritorio de proyecto: construcción segura de DOM,
// diálogos, menús contextuales, avisos y formato de fechas (es-AR).
import { iconSvg } from "./icons.js";
import { sanitizeURL } from "../../utils/safe-dom.js";

export { iconSvg };

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "className" || key === "class") {
        el.className = String(value);
      } else if (key === "dataset" && typeof value === "object") {
        for (const [dk, dv] of Object.entries(value)) {
          if (dv !== undefined && dv !== null) el.dataset[dk] = String(dv);
        }
      } else if (key === "style" && typeof value === "object") {
        for (const [prop, val] of Object.entries(value)) {
          if (val === null || val === undefined) continue;
          if (prop.startsWith("--")) el.style.setProperty(prop, String(val));
          else el.style[prop] = val;
        }
      } else if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === "html") {
        // Solo para fragmentos ESTÁTICOS de confianza (íconos SVG generados).
        el.innerHTML = String(value);
      } else if (key === "text") {
        el.textContent = String(value);
      } else if (value === true) {
        el.setAttribute(key, "");
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  list.flat(Infinity).forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  });
  return parent;
}

export function clear(el) {
  if (!el) return el;
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function icon(name, options = {}) {
  const span = document.createElement("span");
  span.className = `pd-icon-wrap${options.className ? ` ${options.className}` : ""}`;
  span.innerHTML = iconSvg(name, { size: options.size || 18, strokeWidth: options.strokeWidth || 2, label: options.label || "" });
  return span;
}

export function button({ label = "", icon: iconName = "", className = "", title = "", onClick, type = "button", disabled = false, ariaLabel = "" } = {}) {
  const btn = h("button", {
    type,
    className: `pd-btn ${className}`.trim(),
    title: title || null,
    "aria-label": ariaLabel || (label ? null : title || null),
    disabled: disabled || null,
    onclick: onClick
  });
  if (iconName) btn.appendChild(icon(iconName, { size: 16 }));
  if (label) btn.appendChild(h("span", { className: "pd-btn__label" }, label));
  return btn;
}

export const debounce = (fn, wait = 400) => {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
};

export const uid = () => `pd-${Math.random().toString(36).slice(2, 10)}`;

// ---------------------------------------------------------------------------
// Texto y URLs
// ---------------------------------------------------------------------------
export const text = (value) => (value === null || value === undefined ? "" : String(value));

export function initialsOf(name) {
  const clean = text(name).replace(/^\s*dra?\.?\s+/i, "").trim();
  if (!clean) return "··";
  return clean
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function safeHttpsUrl(value) {
  return sanitizeURL(value, { allowRelative: false, allowedProtocols: ["https:"], allowLocalHttp: false });
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}

export function openExternal(url) {
  const safe = safeHttpsUrl(url);
  if (!safe) return false;
  const win = window.open(safe, "_blank", "noopener,noreferrer");
  if (win) win.opener = null;
  return true;
}

export async function copyToClipboard(value) {
  try {
    await navigator.clipboard.writeText(String(value));
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Fechas (claves YYYY-MM-DD, presentación es-AR)
// ---------------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, "0");

export function toDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export const todayKey = () => toDateKey(new Date());

export function parseDateKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(key));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export const isDateKey = (value) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(text(value));

export function formatDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : parseDateKey(value) || new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function capitalize(value) {
  const str = text(value);
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

export function formatDateLong(value) {
  const date = value instanceof Date ? value : parseDateKey(value);
  if (!date) return "";
  return capitalize(date.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
}

export function formatDateShort(value) {
  const date = value instanceof Date ? value : parseDateKey(value);
  if (!date) return "";
  return date.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
}

export function tsToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateTime(value) {
  const date = tsToDate(value);
  if (!date) return "";
  return date.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatRelative(value) {
  const date = tsToDate(value);
  if (!date) return "";
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return formatDate(date);
}

export function minutesToTime(minutes) {
  if (minutes === null || minutes === undefined || minutes === "") return "";
  const n = Number(minutes);
  if (!Number.isFinite(n)) return "";
  return `${pad2(Math.floor(n / 60))}:${pad2(n % 60)}`;
}

export function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text(value));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function daysUntil(key) {
  const date = parseDateKey(key);
  if (!date) return null;
  const today = parseDateKey(todayKey());
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

export function describeCountdown(key) {
  const days = daysUntil(key);
  if (days === null) return "";
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  if (days < 0) return `Hace ${Math.abs(days)} d`;
  return `En ${days} días`;
}

// ---------------------------------------------------------------------------
// Avisos (toast)
// ---------------------------------------------------------------------------
let toastRoot = null;
export function toast(message, { type = "info", timeout = 3200 } = {}) {
  if (!toastRoot) {
    toastRoot = h("div", { className: "pd-toasts", role: "status", "aria-live": "polite" });
    document.body.appendChild(toastRoot);
  }
  const iconName = type === "error" ? "triangle-alert" : type === "success" ? "circle-check" : "info";
  const item = h("div", { className: `pd-toast pd-toast--${type}` }, icon(iconName, { size: 16 }), h("span", {}, message));
  toastRoot.appendChild(item);
  requestAnimationFrame(() => item.classList.add("is-visible"));
  setTimeout(() => {
    item.classList.remove("is-visible");
    setTimeout(() => item.remove(), 260);
  }, timeout);
  return item;
}

// ---------------------------------------------------------------------------
// Diálogos modales (formularios y confirmaciones)
// ---------------------------------------------------------------------------
let dialogStack = [];

function trapFocus(container, event) {
  const focusable = container.querySelectorAll(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function buildField(field) {
  const id = uid();
  const wrap = h("label", { className: `pd-field pd-field--${field.type || "text"}`, for: id });
  if (field.type !== "checkbox") {
    wrap.appendChild(h("span", { className: "pd-field__label" }, field.label, field.required ? h("em", { "aria-hidden": "true" }, " *") : null));
  }
  let control;
  const base = {
    id,
    name: field.name,
    required: field.required || null,
    placeholder: field.placeholder || null,
    "aria-required": field.required ? "true" : null,
    autocomplete: "off"
  };
  switch (field.type) {
    case "textarea":
      control = h("textarea", { ...base, rows: field.rows || 4, maxlength: field.maxLength || 20000 });
      control.value = text(field.value);
      break;
    case "select":
      control = h("select", base);
      (field.options || []).forEach((opt) => {
        const option = h("option", { value: opt.value }, opt.label);
        if (String(opt.value) === String(field.value ?? "")) option.selected = true;
        control.appendChild(option);
      });
      break;
    case "checkbox":
      control = h("input", { ...base, type: "checkbox" });
      control.checked = Boolean(field.value);
      wrap.classList.add("pd-field--inline");
      wrap.appendChild(control);
      wrap.appendChild(h("span", { className: "pd-field__label" }, field.label));
      if (field.help) wrap.appendChild(h("small", { className: "pd-field__help" }, field.help));
      return { wrap, control };
    default:
      control = h("input", {
        ...base,
        type: field.type || "text",
        maxlength: field.maxLength || (field.type === "url" ? 2000 : 300),
        min: field.min || null,
        max: field.max || null,
        step: field.step || null,
        inputmode: field.type === "url" ? "url" : null
      });
      control.value = text(field.value);
  }
  wrap.appendChild(control);
  if (field.help) wrap.appendChild(h("small", { className: "pd-field__help" }, field.help));
  return { wrap, control };
}

export function openDialog({
  title,
  description = "",
  fields = [],
  submitLabel = "Guardar",
  cancelLabel = "Cancelar",
  danger = false,
  size = "md",
  validate = null,
  render = null
} = {}) {
  return new Promise((resolve) => {
    const overlay = h("div", { className: "pd-modal-overlay", role: "presentation" });
    const titleId = uid();
    const form = h("form", { className: `pd-modal pd-modal--${size}`, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, novalidate: true });
    const controls = {};
    const header = h("div", { className: "pd-modal__header" }, h("h2", { id: titleId, className: "pd-modal__title" }, title));
    const closeBtn = button({ icon: "x", className: "pd-btn--ghost pd-btn--icon", title: "Cerrar", onClick: () => finish(null) });
    header.appendChild(closeBtn);
    form.appendChild(header);
    if (description) form.appendChild(h("p", { className: "pd-modal__description" }, description));
    const body = h("div", { className: "pd-modal__body" });
    if (typeof render === "function") {
      const custom = render();
      if (custom) body.appendChild(custom);
    }
    fields.forEach((field) => {
      const { wrap, control } = buildField(field);
      controls[field.name] = control;
      body.appendChild(wrap);
    });
    const errorBox = h("p", { className: "pd-modal__error", role: "alert", hidden: true });
    body.appendChild(errorBox);
    form.appendChild(body);
    const footer = h("div", { className: "pd-modal__footer" });
    footer.appendChild(button({ label: cancelLabel, className: "pd-btn--secondary", onClick: () => finish(null) }));
    const submit = button({ label: submitLabel, className: danger ? "pd-btn--danger" : "pd-btn--primary", type: "submit" });
    footer.appendChild(submit);
    form.appendChild(footer);
    overlay.appendChild(form);

    const previousFocus = document.activeElement;
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        finish(null);
      } else if (event.key === "Tab") {
        trapFocus(form, event);
      }
    };
    function finish(result) {
      overlay.removeEventListener("keydown", onKeydown);
      overlay.classList.remove("is-visible");
      dialogStack = dialogStack.filter((entry) => entry !== overlay);
      setTimeout(() => overlay.remove(), 180);
      if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
      resolve(result);
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = {};
      for (const field of fields) {
        const control = controls[field.name];
        values[field.name] = field.type === "checkbox" ? Boolean(control.checked) : text(control.value).trim();
        if (field.required && !values[field.name]) {
          errorBox.textContent = `Completá el campo "${field.label}".`;
          errorBox.hidden = false;
          control.focus();
          return;
        }
        if (field.type === "url" && values[field.name] && !safeHttpsUrl(values[field.name])) {
          errorBox.textContent = `El enlace de "${field.label}" debe comenzar con https://`;
          errorBox.hidden = false;
          control.focus();
          return;
        }
      }
      if (typeof validate === "function") {
        const message = validate(values, controls);
        if (message) {
          errorBox.textContent = message;
          errorBox.hidden = false;
          return;
        }
      }
      finish(values);
    });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) finish(null);
    });
    overlay.addEventListener("keydown", onKeydown);
    document.body.appendChild(overlay);
    dialogStack.push(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add("is-visible");
      const first = form.querySelector("input, select, textarea, button.pd-btn--primary, button.pd-btn--danger");
      if (first) first.focus();
    });
  });
}

export function confirmDialog({ title, message, confirmLabel = "Confirmar", danger = false }) {
  return openDialog({ title, description: message, fields: [], submitLabel: confirmLabel, danger, size: "sm" }).then((result) => result !== null);
}

export const hasOpenDialog = () => dialogStack.length > 0;

// ---------------------------------------------------------------------------
// Menú contextual / desplegable
// ---------------------------------------------------------------------------
let activeMenu = null;

export function closeMenus() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

export function showMenu(items, { x, y, anchor = null, align = "start" } = {}) {
  closeMenus();
  const menu = h("div", { className: "pd-menu", role: "menu" });
  items.forEach((item) => {
    if (!item) return;
    if (item.separator) {
      menu.appendChild(h("div", { className: "pd-menu__separator", role: "separator" }));
      return;
    }
    const entry = h(
      "button",
      {
        type: "button",
        role: "menuitem",
        className: `pd-menu__item${item.danger ? " is-danger" : ""}${item.checked ? " is-checked" : ""}`,
        disabled: item.disabled || null,
        onclick: (event) => {
          event.stopPropagation();
          closeMenus();
          item.onSelect?.(event);
        }
      },
      item.icon ? icon(item.icon, { size: 15 }) : h("span", { className: "pd-menu__spacer" }),
      h("span", { className: "pd-menu__label" }, item.label),
      item.shortcut ? h("kbd", { className: "pd-menu__kbd" }, item.shortcut) : null
    );
    menu.appendChild(entry);
  });
  document.body.appendChild(menu);
  activeMenu = menu;
  const rect = menu.getBoundingClientRect();
  let left = x;
  let top = y;
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    left = align === "end" ? a.right - rect.width : a.left;
    top = a.bottom + 6;
  }
  left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  requestAnimationFrame(() => {
    menu.classList.add("is-visible");
    menu.querySelector("button:not([disabled])")?.focus();
  });
  const onKey = (event) => {
    if (event.key === "Escape") {
      closeMenus();
      anchor?.focus?.();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const entries = Array.from(menu.querySelectorAll("button:not([disabled])"));
      const index = entries.indexOf(document.activeElement);
      const next = event.key === "ArrowDown" ? entries[(index + 1) % entries.length] : entries[(index - 1 + entries.length) % entries.length];
      next?.focus();
    }
  };
  menu.addEventListener("keydown", onKey);
  return menu;
}

document.addEventListener("mousedown", (event) => {
  if (activeMenu && !activeMenu.contains(event.target)) closeMenus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeMenu) closeMenus();
});
window.addEventListener("resize", closeMenus);

// ---------------------------------------------------------------------------
// Varios
// ---------------------------------------------------------------------------
export function avatarNode({ name, uid: userUid = "", size = 32, className = "" }) {
  const wrap = h("span", {
    className: `pd-avatar ${className}`.trim(),
    style: { width: `${size}px`, height: `${size}px` },
    dataset: userUid ? { dmUid: userUid, dmAvatarName: name || "" } : { dmAuthor: name || "" }
  });
  const img = h("img", { className: "pd-avatar__img", alt: "", hidden: true, dataset: { dmAvatarImg: "1" } });
  const fallback = h("span", { className: "pd-avatar__initials", dataset: { dmAvatarFallback: "initials" } }, initialsOf(name));
  wrap.appendChild(img);
  wrap.appendChild(fallback);
  return wrap;
}

export function emptyState({ icon: iconName = "inbox", title = "", message = "", action = null }) {
  const box = h("div", { className: "pd-empty" }, icon(iconName, { size: 30 }), h("p", { className: "pd-empty__title" }, title));
  if (message) box.appendChild(h("p", { className: "pd-empty__message" }, message));
  if (action) box.appendChild(action);
  return box;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export const isTouchDevice = () => window.matchMedia("(pointer: coarse)").matches;
export const isCompactViewport = () => window.matchMedia("(max-width: 760px)").matches;
