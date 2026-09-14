// App "Archivos": explorador tipo Finder sobre desktop_items (carpetas y enlaces)
// + accesos Microsoft 365 del proyecto (virtuales, derivados de docLinks/slots).
import {
  h,
  clear,
  icon,
  button,
  openDialog,
  confirmDialog,
  showMenu,
  toast,
  openExternal,
  copyToClipboard,
  formatRelative,
  emptyState,
  text,
  safeHttpsUrl
} from "../ui.js";
import { detectKind, kindMeta, KIND_OPTIONS, M365_QUICK_LINKS } from "../links.js";

const VIEW_KEY = "pd:files:view";

export function sortItems(items) {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    const ao = Number(a.order) || 0;
    const bo = Number(b.order) || 0;
    if (a.type === "folder" && ao !== bo) return ao - bo;
    return text(a.name).localeCompare(text(b.name), "es", { sensitivity: "base" });
  });
}

export function folderPath(items, folderId) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const path = [];
  let current = folderId ? byId.get(folderId) : null;
  let guard = 0;
  while (current && guard < 20) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : null;
    guard += 1;
  }
  return path;
}

export function isDescendant(items, folderId, candidateParentId) {
  // true si candidateParentId está dentro de folderId (evita mover una carpeta a sí misma).
  const path = folderPath(items, candidateParentId);
  return path.some((entry) => entry.id === folderId);
}

export function linkTile(item, { onOpen, onMenu, compact = false }) {
  const meta = kindMeta(item.kind || (item.type === "folder" ? "folder" : detectKind(item.url, item.name)));
  const tile = h("button", {
    type: "button",
    className: `pd-file${compact ? " pd-file--row" : ""}`,
    dataset: { itemId: item.id, itemType: item.type },
    title: item.type === "folder" ? `Carpeta ${item.name}` : `${meta.label} · abrir en pestaña nueva`,
    onclick: (event) => {
      event.stopPropagation();
      onOpen?.(item);
    },
    oncontextmenu: (event) => {
      event.preventDefault();
      onMenu?.(item, { x: event.clientX, y: event.clientY });
    }
  });
  const glyph = h("span", { className: `pd-file__glyph pd-file__glyph--${item.type === "folder" ? "folder" : "link"}`, style: { "--kind-color": meta.color } });
  glyph.appendChild(icon(item.type === "folder" ? (item.pinned ? "folder-symlink" : "folder") : meta.icon, { size: compact ? 20 : 30 }));
  if (item.type !== "folder" && meta.badge) glyph.appendChild(h("span", { className: "pd-file__badge" }, meta.badge));
  tile.appendChild(glyph);
  const label = h("span", { className: "pd-file__label" }, item.name);
  tile.appendChild(label);
  if (compact) {
    tile.appendChild(h("span", { className: "pd-file__meta" }, item.type === "folder" ? "Carpeta" : meta.label));
    tile.appendChild(h("span", { className: "pd-file__meta pd-file__meta--muted" }, item.updatedAt ? formatRelative(item.updatedAt) : ""));
  }
  if (item.pinned) tile.appendChild(h("span", { className: "pd-file__pin", title: "Fijado en el escritorio" }, icon("pin", { size: 11 })));
  const more = h("span", {
    className: "pd-file__more",
    role: "button",
    tabindex: "0",
    "aria-label": `Opciones de ${item.name}`,
    onclick: (event) => {
      event.stopPropagation();
      onMenu?.(item, { anchor: more });
    },
    onkeydown: (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        onMenu?.(item, { anchor: more });
      }
    }
  }, icon("ellipsis", { size: 14 }));
  tile.appendChild(more);
  return tile;
}

export async function promptNewFolder(ctx, parentId) {
  const values = await openDialog({
    title: "Nueva carpeta",
    fields: [{ name: "name", label: "Nombre de la carpeta", type: "text", required: true, placeholder: "Ej. Protocolos 2026", maxLength: 200 }],
    submitLabel: "Crear carpeta"
  });
  if (!values) return null;
  try {
    const id = await ctx.store.addItem({ type: "folder", name: values.name, parentId, order: Date.now() });
    toast(`Carpeta "${values.name}" creada.`, { type: "success" });
    return id;
  } catch (error) {
    console.error(error);
    toast("No se pudo crear la carpeta.", { type: "error" });
    return null;
  }
}

export async function promptNewLink(ctx, parentId, presets = {}) {
  const values = await openDialog({
    title: presets.title || "Agregar archivo o enlace",
    description: "Pegá el enlace compartido de Teams, SharePoint, OneDrive, Google Drive o cualquier sitio. El archivo se abre en su aplicación original; acá queda ordenado dentro del proyecto.",
    fields: [
      { name: "url", label: "Enlace (https)", type: "url", required: true, placeholder: "https://panamericanenergy.sharepoint.com/…", value: presets.url || "" },
      { name: "name", label: "Nombre para mostrar", type: "text", required: true, placeholder: "Ej. Protocolo de ergonomía v3", value: presets.name || "", maxLength: 200 },
      { name: "kind", label: "Tipo", type: "select", options: KIND_OPTIONS, value: presets.kind || "" },
      { name: "note", label: "Descripción (opcional)", type: "textarea", rows: 2, placeholder: "¿Qué contiene? ¿Quién lo mantiene?", maxLength: 1000 },
      { name: "pinned", label: "Mostrar como ícono en el escritorio", type: "checkbox", value: Boolean(presets.pinned) }
    ],
    submitLabel: "Guardar"
  });
  if (!values) return null;
  try {
    const kind = values.kind || detectKind(values.url, values.name);
    const id = await ctx.store.addItem({ type: "link", name: values.name, url: values.url, kind, note: values.note, parentId, pinned: values.pinned, order: Date.now() });
    toast(`"${values.name}" agregado al proyecto.`, { type: "success" });
    return id;
  } catch (error) {
    console.error(error);
    toast("No se pudo guardar el enlace.", { type: "error" });
    return null;
  }
}

export async function promptEditItem(ctx, item) {
  const isFolder = item.type === "folder";
  const values = await openDialog({
    title: isFolder ? "Renombrar carpeta" : "Editar enlace",
    fields: isFolder
      ? [{ name: "name", label: "Nombre", type: "text", required: true, value: item.name, maxLength: 200 }]
      : [
          { name: "name", label: "Nombre para mostrar", type: "text", required: true, value: item.name, maxLength: 200 },
          { name: "url", label: "Enlace (https)", type: "url", required: true, value: item.url },
          { name: "kind", label: "Tipo", type: "select", options: KIND_OPTIONS, value: item.kind || "" },
          { name: "note", label: "Descripción", type: "textarea", rows: 2, value: item.note || "", maxLength: 1000 },
          { name: "pinned", label: "Mostrar como ícono en el escritorio", type: "checkbox", value: Boolean(item.pinned) }
        ],
    submitLabel: "Guardar cambios"
  });
  if (!values) return false;
  try {
    const patch = isFolder
      ? { name: values.name }
      : { name: values.name, url: values.url, kind: values.kind || detectKind(values.url, values.name), note: values.note, pinned: values.pinned };
    await ctx.store.updateItem(item.id, patch, { label: values.name });
    toast("Cambios guardados.", { type: "success" });
    return true;
  } catch (error) {
    console.error(error);
    toast("No se pudieron guardar los cambios.", { type: "error" });
    return false;
  }
}

export async function promptMoveItem(ctx, item) {
  const items = (ctx.state.get("items") || []).filter((entry) => !entry.archived);
  const folders = sortItems(items.filter((entry) => entry.type === "folder" && entry.id !== item.id && !isDescendant(items, item.id, entry.id)));
  const options = [{ value: "", label: "Raíz del proyecto" }].concat(
    folders.map((folder) => ({ value: folder.id, label: folderPath(items, folder.id).map((f) => f.name).join(" / ") }))
  );
  const values = await openDialog({
    title: `Mover "${item.name}"`,
    fields: [{ name: "parentId", label: "Carpeta de destino", type: "select", options, value: item.parentId || "" }],
    submitLabel: "Mover"
  });
  if (!values) return false;
  try {
    await ctx.store.updateItem(item.id, { parentId: values.parentId }, { label: `${item.name} movido` });
    toast("Elemento movido.", { type: "success" });
    return true;
  } catch (error) {
    console.error(error);
    toast("No se pudo mover el elemento.", { type: "error" });
    return false;
  }
}

export async function archiveItem(ctx, item) {
  const items = ctx.state.get("items") || [];
  const children = item.type === "folder" ? items.filter((entry) => !entry.archived && folderPath(items, entry.parentId).some((f) => f.id === item.id)) : [];
  const ok = await confirmDialog({
    title: item.type === "folder" ? "Mover carpeta a la papelera" : "Mover a la papelera",
    message: children.length
      ? `La carpeta "${item.name}" y sus ${children.length} elementos pasarán a la papelera. Podés restaurarlos después.`
      : `"${item.name}" pasará a la papelera del proyecto. Podés restaurarlo después.`,
    confirmLabel: "Mover a la papelera",
    danger: true
  });
  if (!ok) return false;
  try {
    await ctx.store.updateItem(item.id, { archived: true }, { label: `${item.name} a papelera` });
    await Promise.all(children.map((child) => ctx.store.updateItem(child.id, { archived: true }, { silent: true })));
    toast("Movido a la papelera.", { type: "success" });
    return true;
  } catch (error) {
    console.error(error);
    toast("No se pudo mover a la papelera.", { type: "error" });
    return false;
  }
}

export function itemMenu(ctx, item, position, { onOpenFolder } = {}) {
  const entries = [];
  if (item.type === "folder") {
    entries.push({ label: "Abrir carpeta", icon: "folder-open", onSelect: () => onOpenFolder?.(item.id) });
  } else {
    entries.push({ label: "Abrir en pestaña nueva", icon: "external-link", onSelect: () => openExternal(item.url) });
    entries.push({
      label: "Copiar enlace",
      icon: "copy",
      onSelect: async () => toast((await copyToClipboard(item.url)) ? "Enlace copiado." : "No se pudo copiar.", { type: "info" })
    });
  }
  entries.push({ separator: true });
  entries.push({ label: item.type === "folder" ? "Renombrar" : "Editar", icon: "pencil", onSelect: () => promptEditItem(ctx, item) });
  entries.push({ label: "Mover a…", icon: "folder-input", onSelect: () => promptMoveItem(ctx, item) });
  entries.push({
    label: item.pinned ? "Quitar del escritorio" : "Fijar en el escritorio",
    icon: item.pinned ? "pin-off" : "pin",
    onSelect: () => ctx.store.updateItem(item.id, { pinned: !item.pinned }, { silent: true }).catch(() => toast("No se pudo actualizar.", { type: "error" }))
  });
  entries.push({ separator: true });
  entries.push({ label: "Mover a la papelera", icon: "trash", danger: true, onSelect: () => archiveItem(ctx, item) });
  showMenu(entries, position);
}

export function quickLinkTile(entry, url, { compact = false } = {}) {
  const meta = kindMeta(entry.kind);
  const tile = h("button", {
    type: "button",
    className: `pd-file pd-file--m365${compact ? " pd-file--row" : ""}${url ? "" : " is-disabled"}`,
    title: url ? `${entry.title} · abrir en pestaña nueva` : `${entry.title}: sin enlace configurado (Ajustes › Accesos Microsoft 365)`,
    "aria-disabled": url ? null : "true",
    onclick: (event) => {
      event.stopPropagation();
      if (url) openExternal(url);
      else toast("Este acceso no tiene enlace configurado. Podés cargarlo desde Microsoft 365 › Configurar accesos.", { type: "info" });
    }
  });
  const glyph = h("span", { className: "pd-file__glyph pd-file__glyph--link", style: { "--kind-color": meta.color } }, icon(entry.icon, { size: compact ? 20 : 30 }));
  if (meta.badge) glyph.appendChild(h("span", { className: "pd-file__badge" }, meta.badge));
  tile.appendChild(glyph);
  tile.appendChild(h("span", { className: "pd-file__label" }, entry.title));
  if (compact) tile.appendChild(h("span", { className: "pd-file__meta" }, entry.subtitle));
  return tile;
}

export const filesApp = {
  id: "files",
  title: "Archivos",
  icon: "folder",
  tone: "green",
  defaultSize: { w: 940, h: 600 },
  mount(container, ctx, params = {}) {
    let currentFolder = text(params.folderId);
    let view = "grid";
    let search = "";
    try {
      view = localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch (e) {
      view = "grid";
    }

    const layout = h("div", { className: "pd-files" });
    const sidebar = h("nav", { className: "pd-files__sidebar", "aria-label": "Secciones de archivos" });
    const main = h("div", { className: "pd-files__main" });
    const toolbar = h("div", { className: "pd-files__toolbar" });
    const crumbs = h("div", { className: "pd-files__crumbs", "aria-label": "Ubicación" });
    const content = h("div", { className: "pd-files__content" });
    main.appendChild(toolbar);
    main.appendChild(crumbs);
    main.appendChild(content);
    layout.appendChild(sidebar);
    layout.appendChild(main);
    clear(container).appendChild(layout);

    const goTo = (folderId) => {
      currentFolder = text(folderId);
      search = "";
      searchInput.value = "";
      render();
    };

    const searchInput = h("input", {
      type: "search",
      className: "pd-input pd-files__search",
      placeholder: "Buscar en el proyecto…",
      "aria-label": "Buscar archivos y carpetas",
      oninput: (event) => {
        search = text(event.target.value).trim().toLowerCase();
        renderContent();
      }
    });

    const viewToggle = h("div", { className: "pd-segmented", role: "group", "aria-label": "Vista" });
    const gridBtn = button({ icon: "layout-grid", title: "Vista de íconos", className: "pd-btn--ghost pd-btn--icon", onClick: () => setView("grid") });
    const listBtn = button({ icon: "list", title: "Vista de lista", className: "pd-btn--ghost pd-btn--icon", onClick: () => setView("list") });
    viewToggle.appendChild(gridBtn);
    viewToggle.appendChild(listBtn);
    const setView = (next) => {
      view = next;
      try {
        localStorage.setItem(VIEW_KEY, next);
      } catch (e) {
        /* sin almacenamiento */
      }
      renderContent();
    };

    toolbar.appendChild(button({ icon: "folder-plus", label: "Nueva carpeta", className: "pd-btn--secondary", onClick: () => promptNewFolder(ctx, currentFolder) }));
    toolbar.appendChild(button({ icon: "link", label: "Agregar enlace", className: "pd-btn--primary", onClick: () => promptNewLink(ctx, currentFolder) }));
    toolbar.appendChild(h("span", { className: "pd-toolbar__spacer" }));
    toolbar.appendChild(searchInput);
    toolbar.appendChild(viewToggle);

    const renderSidebar = () => {
      clear(sidebar);
      const items = (ctx.state.get("items") || []).filter((entry) => !entry.archived);
      const links = ctx.links();
      const section = (title) => {
        const block = h("div", { className: "pd-files__section" }, h("p", { className: "pd-files__section-title" }, title));
        sidebar.appendChild(block);
        return block;
      };
      const navItem = (label, iconName, active, onClick, extraClass = "") =>
        h("button", { type: "button", className: `pd-files__nav${active ? " is-active" : ""} ${extraClass}`.trim(), onclick: onClick }, icon(iconName, { size: 16 }), h("span", {}, label));

      const fav = section("Proyecto");
      fav.appendChild(navItem("Todos los archivos", "house", currentFolder === "" && !search, () => goTo("")));
      fav.appendChild(navItem("En el escritorio", "pin", currentFolder === "__pinned", () => goTo("__pinned")));
      fav.appendChild(navItem("Recientes", "clock", currentFolder === "__recent", () => goTo("__recent")));

      const m365 = section("Microsoft 365");
      M365_QUICK_LINKS.forEach((entry) => {
        const url = links[entry.key];
        if (!url && !["folder", "doc", "ppt"].includes(entry.key)) return;
        const meta = kindMeta(entry.kind);
        const node = navItem(entry.title, entry.icon, false, () => {
          if (url) openExternal(url);
          else toast("Sin enlace configurado. Cargalo desde Microsoft 365 › Configurar accesos.", { type: "info" });
        }, url ? "" : "is-muted");
        node.style.setProperty("--kind-color", meta.color);
        node.classList.add("pd-files__nav--kind");
        m365.appendChild(node);
      });

      const foldersBlock = section("Carpetas");
      const roots = sortItems(items.filter((entry) => entry.type === "folder" && !entry.parentId));
      if (!roots.length) foldersBlock.appendChild(h("p", { className: "pd-files__hint" }, "Todavía no hay carpetas."));
      roots.forEach((folder) => {
        foldersBlock.appendChild(navItem(folder.name, "folder", currentFolder === folder.id, () => goTo(folder.id)));
      });
    };

    const renderCrumbs = () => {
      clear(crumbs);
      const items = (ctx.state.get("items") || []).filter((entry) => !entry.archived);
      const path = currentFolder && !currentFolder.startsWith("__") ? folderPath(items, currentFolder) : [];
      const rootLabel = currentFolder === "__pinned" ? "En el escritorio" : currentFolder === "__recent" ? "Recientes" : "Proyecto";
      const rootBtn = h("button", { type: "button", className: "pd-crumb", onclick: () => goTo("") }, icon("house", { size: 14 }), h("span", {}, rootLabel));
      crumbs.appendChild(rootBtn);
      path.forEach((folder, index) => {
        crumbs.appendChild(h("span", { className: "pd-crumb__sep", "aria-hidden": "true" }, icon("chevron-right", { size: 13 })));
        crumbs.appendChild(
          h("button", { type: "button", className: `pd-crumb${index === path.length - 1 ? " is-current" : ""}`, "aria-current": index === path.length - 1 ? "page" : null, onclick: () => goTo(folder.id) }, folder.name)
        );
      });
    };

    const renderContent = () => {
      clear(content);
      gridBtn.classList.toggle("is-active", view === "grid");
      listBtn.classList.toggle("is-active", view === "list");
      const all = (ctx.state.get("items") || []).filter((entry) => !entry.archived);
      let visible;
      if (search) {
        visible = all.filter((entry) => `${entry.name} ${entry.note || ""} ${entry.url || ""}`.toLowerCase().includes(search));
      } else if (currentFolder === "__pinned") {
        visible = all.filter((entry) => entry.pinned);
      } else if (currentFolder === "__recent") {
        visible = [...all].sort((a, b) => ctx.store.compactTimestamp(b.updatedAt) - ctx.store.compactTimestamp(a.updatedAt)).slice(0, 24);
      } else {
        visible = all.filter((entry) => text(entry.parentId) === currentFolder);
      }
      const sorted = currentFolder === "__recent" && !search ? visible : sortItems(visible);
      const grid = h("div", { className: `pd-files__grid${view === "list" ? " pd-files__grid--list" : ""}`, role: "list" });

      if (!currentFolder && !search) {
        const links = ctx.links();
        const quick = M365_QUICK_LINKS.filter((entry) => links[entry.key] || ["folder", "doc", "ppt"].includes(entry.key));
        if (quick.length) {
          const block = h("section", { className: "pd-files__group" }, h("h3", { className: "pd-files__group-title" }, icon("cloud", { size: 14 }), h("span", {}, "Accesos Microsoft 365 del proyecto")));
          const quickGrid = h("div", { className: `pd-files__grid${view === "list" ? " pd-files__grid--list" : ""}` });
          quick.forEach((entry) => quickGrid.appendChild(quickLinkTile(entry, links[entry.key], { compact: view === "list" })));
          block.appendChild(quickGrid);
          content.appendChild(block);
        }
      }

      if (!sorted.length) {
        content.appendChild(
          emptyState({
            icon: search ? "search" : "folder-open",
            title: search ? "Sin resultados" : "Esta carpeta está vacía",
            message: search ? "Probá con otra palabra." : "Creá subcarpetas o agregá enlaces a documentos de Teams, SharePoint, OneDrive o Google Drive.",
            action: search ? null : button({ icon: "link", label: "Agregar enlace", className: "pd-btn--primary", onClick: () => promptNewLink(ctx, currentFolder) })
          })
        );
        return;
      }
      const block = h("section", { className: "pd-files__group" });
      if (!currentFolder && !search) block.appendChild(h("h3", { className: "pd-files__group-title" }, icon("folder", { size: 14 }), h("span", {}, "Carpetas y enlaces del proyecto")));
      sorted.forEach((item) => {
        const tile = linkTile(item, {
          compact: view === "list",
          onOpen: (entry) => {
            if (entry.type === "folder") goTo(entry.id);
            else openExternal(entry.url);
          },
          onMenu: (entry, position) => itemMenu(ctx, entry, position, { onOpenFolder: goTo })
        });
        tile.setAttribute("role", "listitem");
        grid.appendChild(tile);
      });
      block.appendChild(grid);
      content.appendChild(block);
    };

    content.addEventListener("contextmenu", (event) => {
      if (event.target.closest(".pd-file")) return;
      event.preventDefault();
      showMenu(
        [
          { label: "Nueva carpeta", icon: "folder-plus", onSelect: () => promptNewFolder(ctx, currentFolder.startsWith("__") ? "" : currentFolder) },
          { label: "Agregar enlace", icon: "link", onSelect: () => promptNewLink(ctx, currentFolder.startsWith("__") ? "" : currentFolder) }
        ],
        { x: event.clientX, y: event.clientY }
      );
    });

    const render = () => {
      renderSidebar();
      renderCrumbs();
      renderContent();
    };
    const unwatch = ctx.state.watch(["items", "topic"], render);
    render();
    return {
      destroy: () => unwatch(),
      update: (next) => {
        if (next?.folderId !== undefined) goTo(next.folderId);
      }
    };
  }
};
