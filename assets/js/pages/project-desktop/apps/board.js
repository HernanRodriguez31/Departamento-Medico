// App "Pizarra": notas breves del proyecto en la pizarra de comunicaciones del
// comité (colección committee_notes, scope "project"). Lo que se escribe acá
// aparece en la columna del proyecto dentro de la página del comité, y viceversa.
import { h, clear, icon, button, confirmDialog, toast, formatDateTime, emptyState, text, avatarNode } from "../ui.js";

export const boardApp = {
  id: "board",
  title: "Pizarra del comité",
  icon: "message-square",
  tone: "teal",
  defaultSize: { w: 640, h: 600 },
  mount(container, ctx) {
    const layout = h("div", { className: "pd-board" });
    const intro = h("p", { className: "pd-board__intro" }, "Notas cortas visibles en la pizarra de comunicaciones del comité, en la columna de este proyecto.");
    const list = h("div", { className: "pd-board__list", "aria-live": "polite" });
    const form = h("form", { className: "pd-board__form" });
    const input = h("textarea", { className: "pd-input pd-board__input", rows: 3, placeholder: "Escribir una nota breve para el equipo…", maxlength: 4000, "aria-label": "Nueva nota de pizarra" });
    const submit = button({ icon: "send", label: "Publicar", className: "pd-btn--primary", type: "submit" });
    form.appendChild(input);
    form.appendChild(submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = text(input.value).trim();
      if (!body) return;
      submit.disabled = true;
      try {
        await ctx.store.addBoardNote(body, ctx.projectTitle());
        input.value = "";
        toast("Nota publicada en la pizarra.", { type: "success" });
      } catch (error) {
        console.error(error);
        toast("No se pudo publicar la nota.", { type: "error" });
      } finally {
        submit.disabled = false;
      }
    });
    input.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") form.requestSubmit();
    });
    layout.appendChild(intro);
    layout.appendChild(form);
    layout.appendChild(list);
    clear(container).appendChild(layout);

    const render = () => {
      clear(list);
      const notes = [...(ctx.state.get("boardNotes") || [])].sort((a, b) => ctx.store.compactTimestamp(b.createdAt) - ctx.store.compactTimestamp(a.createdAt));
      if (!notes.length) {
        list.appendChild(emptyState({ icon: "message-square-plus", title: "La pizarra del proyecto está vacía", message: "Publicá avisos, recordatorios o acuerdos breves. Se ven en la página del comité." }));
        return;
      }
      notes.forEach((note) => {
        const card = h("article", { className: "pd-board__note" });
        const head = h("div", { className: "pd-board__note-head" });
        head.appendChild(avatarNode({ name: note.authorName, uid: note.authorUid, size: 28 }));
        head.appendChild(h("div", { className: "pd-board__note-author" }, h("strong", {}, note.authorName || "Integrante"), h("small", {}, formatDateTime(note.createdAt))));
        const likes = note.likedBy && typeof note.likedBy === "object" ? Object.keys(note.likedBy).length : 0;
        if (likes) head.appendChild(h("span", { className: "pd-board__likes", title: "Me gusta en la pizarra" }, icon("star", { size: 12 }), h("span", {}, String(likes))));
        if (note.authorUid === ctx.user.uid || ctx.isAdmin) {
          head.appendChild(button({ icon: "trash", title: "Eliminar nota", className: "pd-btn--ghost pd-btn--icon pd-btn--danger-text", onClick: async () => {
            const ok = await confirmDialog({ title: "Eliminar nota", message: "La nota se quita de la pizarra del comité.", confirmLabel: "Eliminar", danger: true });
            if (!ok) return;
            try {
              await ctx.store.deleteBoardNote(note.id);
            } catch (error) {
              console.error(error);
              toast("No se pudo eliminar la nota.", { type: "error" });
            }
          } }));
        }
        card.appendChild(head);
        card.appendChild(h("p", { className: "pd-board__note-text" }, note.text));
        list.appendChild(card);
      });
      ctx.hydrateAvatars(list);
    };
    const unwatch = ctx.state.watch(["boardNotes"], render);
    render();
    return { destroy: () => unwatch() };
  }
};
