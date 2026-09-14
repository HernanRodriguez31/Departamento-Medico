// App "Actas y notas": documentos internos del proyecto (actas de reunión,
// notas de trabajo e informes breves) con guardado automático colaborativo.
import {
  h,
  clear,
  icon,
  button,
  openDialog,
  confirmDialog,
  showMenu,
  toast,
  debounce,
  formatDate,
  formatDateLong,
  formatRelative,
  todayKey,
  isDateKey,
  emptyState,
  text,
  copyToClipboard
} from "../ui.js";

export const NOTE_KINDS = Object.freeze({
  acta: { label: "Acta de reunión", icon: "clipboard-check" },
  nota: { label: "Nota de trabajo", icon: "notebook-pen" },
  informe: { label: "Informe breve", icon: "file-text" }
});

export function actaTemplate({ projectTitle, committeeName, dateKey, author }) {
  return [
    `ACTA DE REUNIÓN — ${projectTitle}`,
    `${committeeName} · ${formatDateLong(dateKey)}`,
    "",
    "Asistentes:",
    `- ${author}`,
    "- ",
    "",
    "Temas tratados:",
    "1. ",
    "",
    "Acuerdos y decisiones:",
    "- ",
    "",
    "Próximos pasos (responsable · fecha):",
    "- ",
    "",
    "Próxima reunión: "
  ].join("\n");
}

export async function promptNewNote(ctx, presetKind = "nota") {
  const values = await openDialog({
    title: "Nuevo documento interno",
    fields: [
      { name: "kind", label: "Tipo", type: "select", options: Object.entries(NOTE_KINDS).map(([value, meta]) => ({ value, label: meta.label })), value: presetKind },
      { name: "title", label: "Título", type: "text", required: true, placeholder: "Ej. Acta reunión de avance", maxLength: 200 },
      { name: "meetingDate", label: "Fecha (para actas)", type: "date", value: todayKey() }
    ],
    validate: (v) => (v.meetingDate && !isDateKey(v.meetingDate) ? "La fecha no es válida." : ""),
    submitLabel: "Crear"
  });
  if (!values) return null;
  const kind = NOTE_KINDS[values.kind] ? values.kind : "nota";
  const body = kind === "acta" ? actaTemplate({ projectTitle: ctx.projectTitle(), committeeName: ctx.committee.name, dateKey: values.meetingDate || todayKey(), author: ctx.user.displayName }) : "";
  try {
    const id = await ctx.store.addNote({ kind, title: values.title, body, meetingDate: kind === "acta" ? values.meetingDate : "" });
    toast("Documento creado.", { type: "success" });
    return id;
  } catch (error) {
    console.error(error);
    toast("No se pudo crear el documento.", { type: "error" });
    return null;
  }
}

export const notesApp = {
  id: "notes",
  title: "Actas y notas",
  icon: "notebook-pen",
  tone: "yellow",
  defaultSize: { w: 980, h: 620 },
  mount(container, ctx, params = {}) {
    let selectedId = text(params.noteId);
    let dirty = false;
    let lastSavedBody = null;

    const layout = h("div", { className: "pd-notes" });
    const list = h("aside", { className: "pd-notes__list" });
    const editor = h("section", { className: "pd-notes__editor" });
    layout.appendChild(list);
    layout.appendChild(editor);
    clear(container).appendChild(layout);

    const currentNote = () => (ctx.state.get("notes") || []).find((note) => note.id === selectedId && !note.archived) || null;

    const save = debounce(async (id, body) => {
      const note = (ctx.state.get("notes") || []).find((entry) => entry.id === id);
      if (!note || note.body === body) return;
      try {
        await ctx.store.updateNote(id, { body }, { silent: true });
        lastSavedBody = body;
        dirty = false;
        status.textContent = `Guardado · ${formatRelative(new Date())}`;
        ctx.store.logActivity("edited", "note", note.title);
      } catch (error) {
        console.error(error);
        status.textContent = "No se pudo guardar. Reintentando…";
        toast("No se pudo guardar el documento.", { type: "error" });
      }
    }, 900);

    const status = h("span", { className: "pd-notes__status", "aria-live": "polite" });
    const textarea = h("textarea", {
      className: "pd-notes__textarea",
      spellcheck: "true",
      "aria-label": "Contenido del documento",
      maxlength: 20000,
      oninput: () => {
        dirty = true;
        status.textContent = "Escribiendo…";
        save(selectedId, textarea.value);
      }
    });

    const renderList = () => {
      clear(list);
      const notes = (ctx.state.get("notes") || []).filter((note) => !note.archived);
      const head = h("div", { className: "pd-notes__list-head" });
      head.appendChild(button({ icon: "plus", label: "Nuevo", className: "pd-btn--primary pd-btn--sm", onClick: async () => { const id = await promptNewNote(ctx); if (id) { selectedId = id; renderEditor(true); } } }));
      head.appendChild(button({ icon: "clipboard-check", label: "Acta", title: "Nueva acta de reunión con plantilla", className: "pd-btn--secondary pd-btn--sm", onClick: async () => { const id = await promptNewNote(ctx, "acta"); if (id) { selectedId = id; renderEditor(true); } } }));
      list.appendChild(head);
      if (!notes.length) {
        list.appendChild(h("p", { className: "pd-notes__hint" }, "Actas de reunión, notas de trabajo e informes breves. Todo se guarda automáticamente y lo ve todo el equipo."));
        return;
      }
      const sorted = [...notes].sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return ctx.store.compactTimestamp(b.updatedAt) - ctx.store.compactTimestamp(a.updatedAt);
      });
      sorted.forEach((note) => {
        const meta = NOTE_KINDS[note.kind] || NOTE_KINDS.nota;
        const row = h("button", {
          type: "button",
          className: `pd-notes__item${note.id === selectedId ? " is-active" : ""}`,
          onclick: () => { selectedId = note.id; renderList(); renderEditor(true); }
        });
        row.appendChild(h("span", { className: "pd-notes__item-icon" }, icon(meta.icon, { size: 15 })));
        const body = h("span", { className: "pd-notes__item-body" });
        body.appendChild(h("strong", {}, note.title, note.pinned ? icon("pin", { size: 11, className: "pd-notes__pin" }) : null));
        body.appendChild(h("small", {}, `${meta.label}${note.meetingDate ? ` · ${formatDate(note.meetingDate)}` : ""} · ${note.updatedByName || note.createdByName || ""} · ${formatRelative(note.updatedAt || note.createdAt)}`));
        row.appendChild(body);
        list.appendChild(row);
      });
    };

    const renderEditor = (force = false) => {
      const note = currentNote();
      if (!note) {
        clear(editor).appendChild(emptyState({ icon: "notebook-pen", title: "Elegí un documento", message: "O creá una nueva acta o nota desde el panel izquierdo." }));
        return;
      }
      const alreadyMounted = editor.dataset.noteId === note.id && editor.contains(textarea);
      if (alreadyMounted && !force) {
        // Actualización remota: solo reemplazar el texto si no hay edición local en curso.
        if (!dirty && textarea.value !== text(note.body) && document.activeElement !== textarea) {
          textarea.value = text(note.body);
        }
        headerTitle.textContent = note.title;
        headerMeta.textContent = describeNote(note);
        return;
      }
      if (dirty && selectedId !== editor.dataset.noteId) save.flush(editor.dataset.noteId, textarea.value);
      clear(editor);
      editor.dataset.noteId = note.id;
      dirty = false;
      const header = h("div", { className: "pd-notes__editor-head" });
      const meta = NOTE_KINDS[note.kind] || NOTE_KINDS.nota;
      const titleWrap = h("div", { className: "pd-notes__editor-title" });
      headerTitle = h("h3", {}, note.title);
      headerMeta = h("p", { className: "pd-notes__editor-meta" }, describeNote(note));
      titleWrap.appendChild(headerTitle);
      titleWrap.appendChild(headerMeta);
      header.appendChild(h("span", { className: "pd-notes__editor-icon" }, icon(meta.icon, { size: 18 })));
      header.appendChild(titleWrap);
      header.appendChild(h("span", { className: "pd-toolbar__spacer" }));
      header.appendChild(status);
      const menuBtn = button({ icon: "ellipsis", title: "Opciones del documento", className: "pd-btn--ghost pd-btn--icon", onClick: () => {
        showMenu(
          [
            { label: "Renombrar / datos", icon: "pencil", onSelect: () => editMeta(note) },
            { label: note.pinned ? "Desfijar" : "Fijar arriba", icon: note.pinned ? "pin-off" : "pin", onSelect: () => ctx.store.updateNote(note.id, { pinned: !note.pinned }, { silent: true }).catch(() => toast("No se pudo actualizar.", { type: "error" })) },
            { separator: true },
            { label: "Copiar texto", icon: "copy", onSelect: async () => toast((await copyToClipboard(textarea.value)) ? "Texto copiado." : "No se pudo copiar.") },
            { label: "Imprimir / guardar PDF", icon: "printer", onSelect: () => printNote(note, textarea.value) },
            { separator: true },
            { label: "Mover a la papelera", icon: "trash", danger: true, onSelect: async () => {
              const ok = await confirmDialog({ title: "Mover a la papelera", message: `"${note.title}" pasará a la papelera del proyecto.`, confirmLabel: "Mover a la papelera", danger: true });
              if (!ok) return;
              try {
                await ctx.store.updateNote(note.id, { archived: true }, { label: `${note.title} a papelera` });
                selectedId = "";
                toast("Documento movido a la papelera.", { type: "success" });
              } catch (error) {
                console.error(error);
                toast("No se pudo mover a la papelera.", { type: "error" });
              }
            } }
          ],
          { anchor: menuBtn, align: "end" }
        );
      } });
      header.appendChild(menuBtn);
      editor.appendChild(header);
      textarea.value = text(note.body);
      lastSavedBody = textarea.value;
      status.textContent = note.updatedAt ? `Guardado ${formatRelative(note.updatedAt)}` : "";
      editor.appendChild(textarea);
      editor.appendChild(h("p", { className: "pd-notes__foot" }, "Guardado automático. Los cambios de otros integrantes se reflejan al instante cuando no estás escribiendo."));
    };

    let headerTitle = h("h3");
    let headerMeta = h("p");
    const describeNote = (note) => {
      const meta = NOTE_KINDS[note.kind] || NOTE_KINDS.nota;
      const parts = [meta.label];
      if (note.meetingDate) parts.push(formatDateLong(note.meetingDate));
      if (note.createdByName) parts.push(`creado por ${note.createdByName}`);
      if (note.updatedByName && note.updatedByName !== note.createdByName) parts.push(`última edición: ${note.updatedByName}`);
      return parts.join(" · ");
    };

    const editMeta = async (note) => {
      const values = await openDialog({
        title: "Datos del documento",
        fields: [
          { name: "title", label: "Título", type: "text", required: true, value: note.title, maxLength: 200 },
          { name: "kind", label: "Tipo", type: "select", options: Object.entries(NOTE_KINDS).map(([value, meta]) => ({ value, label: meta.label })), value: note.kind || "nota" },
          { name: "meetingDate", label: "Fecha", type: "date", value: note.meetingDate || "" }
        ],
        validate: (v) => (v.meetingDate && !isDateKey(v.meetingDate) ? "La fecha no es válida." : ""),
        submitLabel: "Guardar"
      });
      if (!values) return;
      try {
        await ctx.store.updateNote(note.id, { title: values.title, kind: values.kind, meetingDate: values.meetingDate }, { label: values.title });
        toast("Documento actualizado.", { type: "success" });
      } catch (error) {
        console.error(error);
        toast("No se pudieron guardar los datos.", { type: "error" });
      }
    };

    const printNote = (note, body) => {
      const win = window.open("", "_blank", "noopener,width=900,height=700");
      if (!win) {
        toast("El navegador bloqueó la ventana de impresión.", { type: "error" });
        return;
      }
      const doc = win.document;
      doc.open();
      doc.write("<!DOCTYPE html><html lang=\"es\"><head><meta charset=\"utf-8\"><title></title><style>body{font-family:Manrope,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;margin:2.2cm;line-height:1.5}h1{font-size:20px;margin:0 0 4px}p.meta{color:#64748b;font-size:12px;margin:0 0 18px}pre{white-space:pre-wrap;font:14px/1.6 Manrope,Segoe UI,Helvetica,Arial,sans-serif}footer{margin-top:28px;font-size:11px;color:#94a3b8}</style></head><body></body></html>");
      doc.close();
      doc.title = note.title;
      const h1 = doc.createElement("h1");
      h1.textContent = note.title;
      const meta = doc.createElement("p");
      meta.className = "meta";
      meta.textContent = `${ctx.projectTitle()} · ${ctx.committee.name} · ${describeNote(note)}`;
      const pre = doc.createElement("pre");
      pre.textContent = body;
      const footer = doc.createElement("footer");
      footer.textContent = `Departamento Médico · Brisa Salud y Bienestar · impreso el ${formatDate(new Date())}`;
      doc.body.append(h1, meta, pre, footer);
      setTimeout(() => win.print(), 250);
    };

    const render = () => {
      renderList();
      renderEditor();
    };
    const unwatch = ctx.state.watch(["notes"], render);
    render();
    if (params.create) promptNewNote(ctx, params.kind || "nota").then((id) => { if (id) { selectedId = id; renderEditor(true); } });
    return {
      destroy: () => {
        if (dirty && selectedId) save.flush(selectedId, textarea.value);
        unwatch();
      },
      update: (next) => {
        if (next?.noteId) { selectedId = next.noteId; render(); }
        if (next?.create) promptNewNote(ctx, next.kind || "nota").then((id) => { if (id) { selectedId = id; renderEditor(true); } });
      }
    };
  }
};
