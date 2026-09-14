// Apps auxiliares: Actividad, Papelera, Ajustes y Ayuda.
import { h, clear, icon, button, confirmDialog, toast, formatDateTime, formatRelative, emptyState, text, avatarNode } from "../ui.js";
import { WALLPAPERS } from "../store.js";

const ACTION_LABELS = {
  created: "creó",
  updated: "actualizó",
  edited: "editó",
  deleted: "eliminó",
  restored: "restauró",
  moved: "movió",
  completed: "completó",
  added: "sumó",
  removed: "quitó",
  stage: "cambió la etapa",
  provisioned: "inauguró",
  wallpaper: "cambió el fondo"
};

const ENTITY_LABELS = {
  item: "el enlace",
  folder: "la carpeta",
  task: "la tarea",
  note: "el documento",
  event: "el evento",
  board: "una nota de pizarra",
  team: "al equipo:",
  project: "el proyecto:",
  links: "los accesos M365",
  desktop: "el escritorio",
  config: "la configuración"
};

export function describeActivity(entry) {
  const action = ACTION_LABELS[entry.action] || entry.action || "actualizó";
  const entity = ENTITY_LABELS[entry.entity] || entry.entity || "";
  return `${action} ${entity} ${text(entry.label)}`.replace(/\s+/g, " ").trim();
}

export const activityApp = {
  id: "activity",
  title: "Actividad",
  icon: "activity",
  tone: "slate",
  defaultSize: { w: 620, h: 600 },
  mount(container, ctx) {
    const list = h("div", { className: "pd-activity" });
    clear(container).appendChild(list);
    const render = () => {
      clear(list);
      const entries = ctx.state.get("activity") || [];
      if (!entries.length) {
        list.appendChild(emptyState({ icon: "activity", title: "Sin actividad registrada", message: "Cada cambio en archivos, tareas, actas, calendario o equipo queda registrado acá." }));
        return;
      }
      entries.forEach((entry) => {
        const row = h("article", { className: "pd-activity__row" });
        row.appendChild(avatarNode({ name: entry.authorName, uid: entry.authorUid, size: 28 }));
        const body = h("div", { className: "pd-activity__body" });
        body.appendChild(h("p", {}, h("strong", {}, entry.authorName || "Alguien"), ` ${describeActivity(entry)}`));
        body.appendChild(h("small", { title: formatDateTime(entry.createdAt) }, formatRelative(entry.createdAt)));
        row.appendChild(body);
        list.appendChild(row);
      });
      ctx.hydrateAvatars(list);
    };
    const unwatch = ctx.state.watch(["activity"], render);
    render();
    return { destroy: () => unwatch() };
  }
};

export const trashApp = {
  id: "trash",
  title: "Papelera",
  icon: "trash",
  tone: "gray",
  defaultSize: { w: 720, h: 520 },
  mount(container, ctx) {
    const layout = h("div", { className: "pd-trash" });
    clear(container).appendChild(layout);
    const render = () => {
      clear(layout);
      const groups = [
        { key: "items", label: "Archivos y carpetas", icon: "folder", entries: (ctx.state.get("items") || []).filter((e) => e.archived), restore: (e) => ctx.store.updateItem(e.id, { archived: false }, { label: `${e.name} restaurado`, action: "restored" }), remove: (e) => ctx.store.deleteItem(e.id, e.name), name: (e) => e.name },
        { key: "tasks", label: "Tareas", icon: "list-checks", entries: (ctx.state.get("tasks") || []).filter((e) => e.archived), restore: (e) => ctx.store.updateTask(e.id, { archived: false }, { label: `${e.title} restaurada`, action: "restored" }), remove: (e) => ctx.store.deleteTask(e.id, e.title), name: (e) => e.title },
        { key: "notes", label: "Actas y notas", icon: "notebook-pen", entries: (ctx.state.get("notes") || []).filter((e) => e.archived), restore: (e) => ctx.store.updateNote(e.id, { archived: false }, { label: `${e.title} restaurado`, action: "restored" }), remove: (e) => ctx.store.deleteNote(e.id, e.title), name: (e) => e.title }
      ];
      const total = groups.reduce((sum, group) => sum + group.entries.length, 0);
      layout.appendChild(h("p", { className: "pd-trash__intro" }, "Lo que se quita del escritorio queda acá. Restaurar lo devuelve a su lugar; eliminar definitivamente solo puede hacerlo quien lo creó o un administrador."));
      if (!total) {
        layout.appendChild(emptyState({ icon: "trash", title: "La papelera está vacía" }));
        return;
      }
      groups.forEach((group) => {
        if (!group.entries.length) return;
        const section = h("section", { className: "pd-trash__group" }, h("h4", {}, icon(group.icon, { size: 14 }), h("span", {}, group.label)));
        group.entries.forEach((entry) => {
          const row = h("div", { className: "pd-trash__row" });
          row.appendChild(h("span", { className: "pd-trash__name" }, group.name(entry)));
          row.appendChild(h("small", {}, `quitado ${formatRelative(entry.updatedAt)}${entry.updatedByName ? ` por ${entry.updatedByName}` : ""}`));
          row.appendChild(button({ icon: "archive-restore", label: "Restaurar", className: "pd-btn--secondary pd-btn--sm", onClick: async () => {
            try { await group.restore(entry); toast("Restaurado.", { type: "success" }); } catch (error) { console.error(error); toast("No se pudo restaurar.", { type: "error" }); }
          } }));
          row.appendChild(button({ icon: "trash", title: "Eliminar definitivamente", className: "pd-btn--ghost pd-btn--icon pd-btn--danger-text", onClick: async () => {
            const ok = await confirmDialog({ title: "Eliminar definitivamente", message: `"${group.name(entry)}" se eliminará de forma permanente.`, confirmLabel: "Eliminar", danger: true });
            if (!ok) return;
            try { await group.remove(entry); toast("Eliminado definitivamente.", { type: "success" }); } catch (error) { console.error(error); toast(error?.code === "permission-denied" ? "Solo quien lo creó o un administrador puede eliminarlo definitivamente." : "No se pudo eliminar.", { type: "error", timeout: 5000 }); }
          } }));
          section.appendChild(row);
        });
        layout.appendChild(section);
      });
    };
    const unwatch = ctx.state.watch(["items", "tasks", "notes"], render);
    render();
    return { destroy: () => unwatch() };
  }
};

export const settingsApp = {
  id: "settings",
  title: "Ajustes del escritorio",
  icon: "settings",
  tone: "gray",
  defaultSize: { w: 680, h: 560 },
  mount(container, ctx) {
    const layout = h("div", { className: "pd-settings" });
    clear(container).appendChild(layout);
    const render = () => {
      clear(layout);
      const config = ctx.state.get("config") || {};
      const wallpaperBlock = h("section", { className: "pd-settings__block" }, h("h4", {}, "Fondo del escritorio"), h("p", {}, "Compartido por todo el equipo del proyecto."));
      const options = h("div", { className: "pd-settings__wallpapers" });
      WALLPAPERS.forEach((wallpaper) => {
        const active = (config.wallpaper || "brisa") === wallpaper.key;
        options.appendChild(h("button", {
          type: "button",
          className: `pd-wallpaper-option pd-wallpaper-option--${wallpaper.key}${active ? " is-active" : ""}`,
          "aria-pressed": active ? "true" : "false",
          onclick: async () => {
            try {
              await ctx.store.updateConfig({ wallpaper: wallpaper.key });
              ctx.store.logActivity("wallpaper", "desktop", wallpaper.label);
            } catch (error) {
              console.error(error);
              toast("No se pudo cambiar el fondo.", { type: "error" });
            }
          }
        }, h("span", { className: "pd-wallpaper-option__preview" }), h("span", { className: "pd-wallpaper-option__label" }, wallpaper.label)));
      });
      wallpaperBlock.appendChild(options);
      layout.appendChild(wallpaperBlock);

      const layoutBlock = h("section", { className: "pd-settings__block" }, h("h4", {}, "Ventanas"), h("p", {}, "La posición y el tamaño de las ventanas se recuerdan en este dispositivo."));
      layoutBlock.appendChild(button({ icon: "refresh-cw", label: "Restablecer disposición de ventanas", className: "pd-btn--secondary pd-btn--sm", onClick: () => { ctx.resetLayout(); toast("Disposición restablecida.", { type: "success" }); } }));
      layout.appendChild(layoutBlock);

      const infoBlock = h("section", { className: "pd-settings__block" }, h("h4", {}, "Datos técnicos"));
      const dl = h("dl", { className: "pd-settings__facts" });
      const add = (k, v) => dl.appendChild(h("div", {}, h("dt", {}, k), h("dd", {}, v)));
      add("Comité", `${ctx.committee.name} (${ctx.committee.id})`);
      add("Proyecto", ctx.topicId);
      add("Escritorio creado", config.createdAt ? `${formatDateTime(config.createdAt)}${config.createdByName ? ` · ${config.createdByName}` : ""}` : "—");
      add("Última edición de la configuración", config.updatedAt ? `${formatDateTime(config.updatedAt)}${config.updatedByName ? ` · ${config.updatedByName}` : ""}` : "—");
      infoBlock.appendChild(dl);
      layout.appendChild(infoBlock);
    };
    const unwatch = ctx.state.watch(["config"], render);
    render();
    return { destroy: () => unwatch() };
  }
};

export const helpApp = {
  id: "help",
  title: "Ayuda",
  icon: "circle-question-mark",
  tone: "blue",
  defaultSize: { w: 720, h: 600 },
  mount(container, ctx) {
    const layout = h("div", { className: "pd-help" });
    const block = (title, iconName, lines) => {
      const section = h("section", { className: "pd-help__block" }, h("h4", {}, icon(iconName, { size: 16 }), h("span", {}, title)));
      const ul = h("ul", {});
      lines.forEach((line) => ul.appendChild(h("li", {}, line)));
      section.appendChild(ul);
      layout.appendChild(section);
    };
    layout.appendChild(h("p", { className: "pd-help__intro" }, "Este escritorio reúne todo lo que necesita el equipo para trabajar el proyecto: archivos en Teams / SharePoint, calendario, tareas, actas, pizarra y equipo. Todo es colaborativo y se actualiza al instante."));
    block("Cómo trabajar", "sparkles", [
      "Doble clic en un ícono del escritorio o clic en la barra inferior para abrir una app.",
      "Las ventanas se mueven desde su barra superior, se redimensionan desde la esquina inferior derecha y se amplían con doble clic en el título.",
      "Botones de colores: rojo cierra, amarillo minimiza a la barra, verde amplía. Esc cierra la ventana activa.",
      "⌘K / Ctrl+K abre la búsqueda rápida de archivos, tareas, documentos y eventos."
    ]);
    block("Archivos y Microsoft 365", "folder", [
      "Los documentos viven en la carpeta del proyecto en Teams / SharePoint (equipo Departamento Médico). Acá se registran sus enlaces y se ordenan en carpetas.",
      "Para crear un documento nuevo, abrí la carpeta del proyecto y usá \"+ Nuevo\"; después registrá el enlace con \"Agregar enlace\".",
      "Los archivos se abren siempre en una pestaña nueva, con la sesión Microsoft de cada persona.",
      "\"Fijar en el escritorio\" muestra un archivo o carpeta como ícono en el escritorio del proyecto."
    ]);
    block("Calendario, tareas y actas", "calendar-days", [
      "Las reuniones agendadas fijan automáticamente la \"Próxima reunión\" de la tarjeta del proyecto y se ven en el calendario del comité.",
      "Las tareas tienen responsable, prioridad y fecha límite; arrastralas entre columnas para cambiar su estado.",
      "Las actas usan una plantilla (asistentes, temas, acuerdos, próximos pasos) y se guardan solas mientras escribís."
    ]);
    block("Proyectos nuevos", "lightbulb", [
      "Cada proyecto creado desde \"Agregar nuevo proyecto\" en el comité tiene su escritorio de forma automática: se inaugura al abrirlo por primera vez, con carpetas base y los accesos M365 del comité."
    ]);
    layout.appendChild(h("p", { className: "pd-help__foot" }, `Usuario: ${ctx.user.displayName}${ctx.isAdmin ? " · administrador" : ""}`));
    clear(container).appendChild(layout);
    return { destroy: () => {} };
  }
};
