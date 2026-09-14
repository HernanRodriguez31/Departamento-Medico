// App "Microsoft 365": accesos del proyecto en Teams / SharePoint (carpeta,
// Word, PowerPoint, Excel, canal, OneNote), creación de documentos nuevos y
// configuración de los enlaces (se guardan en docLinks del proyecto, los mismos
// que edita la tarjeta del comité).
import { h, clear, icon, button, openDialog, toast, openExternal, copyToClipboard, hostOf, text } from "../ui.js";
import { M365_QUICK_LINKS, NEW_DOCUMENT_SHORTCUTS, kindMeta } from "../links.js";
import { promptNewLink } from "./files.js";

export async function configureLinks(ctx) {
  const links = ctx.links();
  const values = await openDialog({
    title: "Configurar accesos Microsoft 365",
    description: "Pegá los enlaces compartidos desde Teams / SharePoint. Si un campo queda vacío se usa el enlace predeterminado del comité (cuando existe).",
    fields: [
      { name: "folder", label: "Carpeta del proyecto (Teams / SharePoint)", type: "url", value: links.manual.folder, placeholder: links.slot.folder ? "Predeterminado del comité en uso" : "https://…sharepoint.com/:f:/…" },
      { name: "doc", label: "Documento de trabajo (Word)", type: "url", value: links.manual.doc, placeholder: links.slot.doc ? "Predeterminado del comité en uso" : "https://…sharepoint.com/:w:/…" },
      { name: "ppt", label: "Presentación (PowerPoint)", type: "url", value: links.manual.ppt, placeholder: links.slot.ppt ? "Predeterminado del comité en uso" : "https://…sharepoint.com/:p:/…" },
      { name: "xlsx", label: "Planilla (Excel)", type: "url", value: links.manual.xlsx, placeholder: "https://…sharepoint.com/:x:/…" },
      { name: "teams", label: "Canal o chat de Teams", type: "url", value: links.manual.teams, placeholder: "https://teams.microsoft.com/l/channel/…" },
      { name: "onenote", label: "Bloc de notas (OneNote)", type: "url", value: links.manual.onenote, placeholder: "https://…sharepoint.com/:o:/…" }
    ],
    submitLabel: "Guardar accesos",
    size: "lg"
  });
  if (!values) return false;
  const topic = ctx.state.get("topic") || {};
  const current = topic.docLinks && typeof topic.docLinks === "object" ? topic.docLinks : {};
  const docLinks = { ...current, folder: values.folder, doc: values.doc, ppt: values.ppt, xlsx: values.xlsx, teams: values.teams, onenote: values.onenote };
  try {
    await ctx.store.updateTopic({ docLinks });
    ctx.store.logActivity("updated", "links", "Accesos Microsoft 365");
    toast("Accesos actualizados.", { type: "success" });
    return true;
  } catch (error) {
    console.error(error);
    toast(ctx.explainTopicError(error), { type: "error", timeout: 5000 });
    return false;
  }
}

export const m365App = {
  id: "m365",
  title: "Microsoft 365",
  icon: "cloud",
  tone: "ms",
  defaultSize: { w: 900, h: 620 },
  mount(container, ctx) {
    const layout = h("div", { className: "pd-m365" });
    clear(container).appendChild(layout);

    const render = () => {
      clear(layout);
      const links = ctx.links();
      const intro = h("section", { className: "pd-m365__intro" });
      intro.appendChild(h("h3", {}, "Trabajo colaborativo en Teams y SharePoint"));
      intro.appendChild(h("p", {}, "Todo el equipo tiene acceso a la carpeta del proyecto en el equipo \"Departamento Médico\". Los documentos se abren en Word, PowerPoint o Excel (web o escritorio) y se editan en simultáneo; el escritorio los organiza y los deja a un clic."));
      intro.appendChild(button({ icon: "settings", label: "Configurar accesos", className: "pd-btn--secondary pd-btn--sm", onClick: () => configureLinks(ctx) }));
      layout.appendChild(intro);

      const grid = h("div", { className: "pd-m365__grid" });
      M365_QUICK_LINKS.forEach((entry) => {
        const url = links[entry.key];
        const meta = kindMeta(entry.kind);
        const card = h("article", { className: `pd-m365__card${url ? "" : " is-empty"}`, style: { "--kind-color": meta.color } });
        card.appendChild(h("span", { className: "pd-m365__glyph" }, icon(entry.icon, { size: 26 }), meta.badge ? h("b", {}, meta.badge) : null));
        card.appendChild(h("h4", {}, entry.title));
        card.appendChild(h("p", {}, url ? hostOf(url) : entry.subtitle));
        const actions = h("div", { className: "pd-m365__actions" });
        if (url) {
          actions.appendChild(button({ icon: "external-link", label: "Abrir", className: "pd-btn--primary pd-btn--sm", onClick: () => openExternal(url) }));
          actions.appendChild(button({ icon: "copy", title: "Copiar enlace", className: "pd-btn--ghost pd-btn--icon", onClick: async () => toast((await copyToClipboard(url)) ? "Enlace copiado." : "No se pudo copiar.") }));
        } else {
          actions.appendChild(button({ icon: "plus", label: "Cargar enlace", className: "pd-btn--secondary pd-btn--sm", onClick: () => configureLinks(ctx) }));
        }
        card.appendChild(actions);
        grid.appendChild(card);
      });
      layout.appendChild(grid);

      const create = h("section", { className: "pd-m365__create" });
      create.appendChild(h("h4", {}, "Crear un documento nuevo"));
      create.appendChild(h("p", {}, "Recomendado: abrí la carpeta del proyecto y usá \"+ Nuevo\" en Teams / SharePoint para que el archivo quede dentro del proyecto. Luego registrá su enlace en Archivos para tenerlo a mano."));
      const row = h("div", { className: "pd-m365__create-row" });
      if (links.folder) row.appendChild(button({ icon: "folder-open", label: "Abrir carpeta y crear ahí", className: "pd-btn--primary pd-btn--sm", onClick: () => openExternal(links.folder) }));
      NEW_DOCUMENT_SHORTCUTS.forEach((shortcut) => {
        const meta = kindMeta(shortcut.kind);
        const btn = button({ icon: meta.icon, label: shortcut.label, className: "pd-btn--secondary pd-btn--sm", title: `${shortcut.url} · se crea en tu OneDrive`, onClick: () => openExternal(shortcut.url) });
        btn.style.setProperty("--kind-color", meta.color);
        row.appendChild(btn);
      });
      row.appendChild(button({ icon: "link", label: "Registrar enlace en Archivos", className: "pd-btn--ghost pd-btn--sm", onClick: () => promptNewLink(ctx, "") }));
      create.appendChild(row);
      create.appendChild(h("p", { className: "pd-m365__note" }, "word.new · excel.new · powerpoint.new crean el archivo en el OneDrive de la cuenta con sesión iniciada; movelo a la carpeta del proyecto para que lo vea todo el equipo."));
      layout.appendChild(create);
    };
    const unwatch = ctx.state.watch(["topic"], render);
    render();
    return { destroy: () => unwatch() };
  }
};
