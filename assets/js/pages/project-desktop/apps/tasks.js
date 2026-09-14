// App "Tareas": tablero pendiente / en curso / hecha con responsables,
// prioridades y fechas límite. Arrastrar entre columnas o usar el menú.
import {
  h,
  clear,
  icon,
  button,
  openDialog,
  confirmDialog,
  showMenu,
  toast,
  formatDateShort,
  todayKey,
  isDateKey,
  emptyState,
  text,
  avatarNode
} from "../ui.js";

export const TASK_STATUS = Object.freeze({
  todo: { label: "Pendiente", icon: "circle" },
  doing: { label: "En curso", icon: "circle-dot" },
  done: { label: "Hecha", icon: "circle-check" }
});

export const TASK_PRIORITY = Object.freeze({
  alta: { label: "Alta", className: "is-high" },
  media: { label: "Media", className: "is-medium" },
  baja: { label: "Baja", className: "is-low" }
});

export function taskStats(tasks) {
  const active = (tasks || []).filter((task) => !task.archived);
  const done = active.filter((task) => task.status === "done").length;
  const overdue = active.filter((task) => task.status !== "done" && task.dueDate && task.dueDate < todayKey()).length;
  return { total: active.length, done, overdue, percent: active.length ? Math.round((done / active.length) * 100) : 0 };
}

export function assigneeOptions(ctx) {
  const members = ctx.state.get("members") || [];
  const team = ctx.state.get("config")?.team || [];
  const names = new Map();
  team.forEach((member) => names.set(text(member.name), text(member.uid)));
  members.forEach((member) => {
    if (!names.has(text(member.name))) names.set(text(member.name), text(member.userUid));
  });
  const me = ctx.user;
  if (me?.displayName && !names.has(me.displayName)) names.set(me.displayName, me.uid);
  const options = [{ value: "", label: "Sin responsable" }];
  Array.from(names.keys())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es"))
    .forEach((name) => options.push({ value: name, label: name }));
  return { options, uidByName: names };
}

export async function promptTask(ctx, { task = null, status = "todo" } = {}) {
  const { options, uidByName } = assigneeOptions(ctx);
  if (task?.assignee && !uidByName.has(task.assignee)) options.push({ value: task.assignee, label: task.assignee });
  const values = await openDialog({
    title: task ? "Editar tarea" : "Nueva tarea",
    fields: [
      { name: "title", label: "Tarea", type: "text", required: true, value: task?.title || "", placeholder: "Ej. Redactar borrador del protocolo", maxLength: 300 },
      { name: "details", label: "Detalle (opcional)", type: "textarea", rows: 3, value: task?.details || "", maxLength: 2000 },
      { name: "assignee", label: "Responsable", type: "select", options, value: task?.assignee || "" },
      { name: "assigneeOther", label: "Otro responsable (si no figura en la lista)", type: "text", value: "", placeholder: "Nombre y apellido", maxLength: 120 },
      { name: "dueDate", label: "Fecha límite", type: "date", value: task?.dueDate || "" },
      { name: "priority", label: "Prioridad", type: "select", options: Object.entries(TASK_PRIORITY).map(([value, meta]) => ({ value, label: meta.label })), value: task?.priority || "media" },
      { name: "status", label: "Estado", type: "select", options: Object.entries(TASK_STATUS).map(([value, meta]) => ({ value, label: meta.label })), value: task?.status || status }
    ],
    validate: (v) => (v.dueDate && !isDateKey(v.dueDate) ? "La fecha límite no es válida." : ""),
    submitLabel: task ? "Guardar cambios" : "Crear tarea"
  });
  if (!values) return false;
  const assignee = values.assigneeOther || values.assignee;
  const payload = {
    title: values.title,
    details: values.details,
    assignee,
    assigneeUid: uidByName.get(assignee) || "",
    dueDate: values.dueDate,
    priority: values.priority,
    status: values.status
  };
  try {
    if (task) {
      if (payload.status === "done" && task.status !== "done") payload.doneAt = new Date();
      if (payload.status !== "done") payload.doneAt = null;
      await ctx.store.updateTask(task.id, payload, { label: payload.title });
    } else {
      await ctx.store.addTask({ ...payload, order: Date.now() });
    }
    toast(task ? "Tarea actualizada." : "Tarea creada.", { type: "success" });
    return true;
  } catch (error) {
    console.error(error);
    toast("No se pudo guardar la tarea.", { type: "error" });
    return false;
  }
}

export async function moveTask(ctx, task, status) {
  if (!TASK_STATUS[status] || task.status === status) return;
  try {
    await ctx.store.updateTask(task.id, { status, doneAt: status === "done" ? new Date() : null }, { label: `${task.title} → ${TASK_STATUS[status].label}`, action: status === "done" ? "completed" : "moved" });
  } catch (error) {
    console.error(error);
    toast("No se pudo mover la tarea.", { type: "error" });
  }
}

export async function archiveTask(ctx, task) {
  const ok = await confirmDialog({ title: "Mover tarea a la papelera", message: `"${task.title}" pasará a la papelera del proyecto.`, confirmLabel: "Mover a la papelera", danger: true });
  if (!ok) return;
  try {
    await ctx.store.updateTask(task.id, { archived: true }, { label: `${task.title} a papelera` });
    toast("Tarea movida a la papelera.", { type: "success" });
  } catch (error) {
    console.error(error);
    toast("No se pudo archivar la tarea.", { type: "error" });
  }
}

export function taskCard(ctx, task, { draggable = true } = {}) {
  const priority = TASK_PRIORITY[task.priority] || TASK_PRIORITY.media;
  const overdue = task.status !== "done" && task.dueDate && task.dueDate < todayKey();
  const card = h("article", {
    className: `pd-task ${priority.className}${task.status === "done" ? " is-done" : ""}${overdue ? " is-overdue" : ""}`,
    draggable: draggable ? "true" : null,
    dataset: { taskId: task.id },
    tabindex: "0",
    "aria-label": `${task.title}, ${TASK_STATUS[task.status]?.label || ""}`
  });
  const head = h("div", { className: "pd-task__head" });
  const check = h("button", {
    type: "button",
    className: "pd-task__check",
    title: task.status === "done" ? "Marcar como pendiente" : "Marcar como hecha",
    "aria-label": task.status === "done" ? "Marcar como pendiente" : "Marcar como hecha",
    onclick: () => moveTask(ctx, task, task.status === "done" ? "todo" : "done")
  }, icon(task.status === "done" ? "circle-check" : "circle", { size: 18 }));
  head.appendChild(check);
  head.appendChild(h("p", { className: "pd-task__title" }, task.title));
  const menuBtn = button({ icon: "ellipsis", title: "Opciones", className: "pd-btn--ghost pd-btn--icon pd-task__menu", onClick: (event) => {
    event.stopPropagation();
    showMenu(
      [
        { label: "Editar", icon: "pencil", onSelect: () => promptTask(ctx, { task }) },
        { separator: true },
        ...Object.entries(TASK_STATUS).filter(([key]) => key !== task.status).map(([key, meta]) => ({ label: `Mover a ${meta.label}`, icon: meta.icon, onSelect: () => moveTask(ctx, task, key) })),
        { separator: true },
        { label: "Mover a la papelera", icon: "trash", danger: true, onSelect: () => archiveTask(ctx, task) }
      ],
      { anchor: menuBtn, align: "end" }
    );
  } });
  head.appendChild(menuBtn);
  card.appendChild(head);
  if (task.details) card.appendChild(h("p", { className: "pd-task__details" }, task.details));
  const foot = h("div", { className: "pd-task__foot" });
  foot.appendChild(h("span", { className: `pd-task__priority ${priority.className}` }, priority.label));
  if (task.dueDate) foot.appendChild(h("span", { className: `pd-task__due${overdue ? " is-overdue" : ""}` }, icon("calendar", { size: 12 }), h("span", {}, formatDateShort(task.dueDate))));
  if (task.assignee) {
    const who = h("span", { className: "pd-task__assignee", title: `Responsable: ${task.assignee}` });
    who.appendChild(avatarNode({ name: task.assignee, uid: task.assigneeUid || "", size: 20 }));
    who.appendChild(h("span", {}, task.assignee.split(" ").slice(0, 2).join(" ")));
    foot.appendChild(who);
  }
  card.appendChild(foot);
  card.addEventListener("dblclick", () => promptTask(ctx, { task }));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter") promptTask(ctx, { task });
  });
  if (draggable) {
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", task.id);
      event.dataTransfer.effectAllowed = "move";
      card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
  }
  return card;
}

export const tasksApp = {
  id: "tasks",
  title: "Tareas",
  icon: "list-checks",
  tone: "orange",
  defaultSize: { w: 1040, h: 620 },
  mount(container, ctx, params = {}) {
    let filter = "";
    const layout = h("div", { className: "pd-tasks" });
    const toolbar = h("div", { className: "pd-tasks__toolbar" });
    const board = h("div", { className: "pd-tasks__board" });
    layout.appendChild(toolbar);
    layout.appendChild(board);
    clear(container).appendChild(layout);

    const summary = h("div", { className: "pd-tasks__summary" });
    const filterInput = h("input", {
      type: "search",
      className: "pd-input",
      placeholder: "Filtrar por texto o responsable…",
      "aria-label": "Filtrar tareas",
      oninput: (event) => {
        filter = text(event.target.value).trim().toLowerCase();
        renderBoard();
      }
    });
    toolbar.appendChild(button({ icon: "plus", label: "Nueva tarea", className: "pd-btn--primary", onClick: () => promptTask(ctx) }));
    toolbar.appendChild(summary);
    toolbar.appendChild(h("span", { className: "pd-toolbar__spacer" }));
    toolbar.appendChild(filterInput);

    const renderBoard = () => {
      clear(board);
      const tasks = (ctx.state.get("tasks") || []).filter((task) => !task.archived);
      const stats = taskStats(tasks);
      clear(summary);
      summary.appendChild(h("span", { className: "pd-tasks__progress", title: `${stats.done} de ${stats.total} tareas hechas` }, h("i", { style: { width: `${stats.percent}%` } })));
      summary.appendChild(h("span", { className: "pd-tasks__summary-text" }, `${stats.done}/${stats.total} hechas${stats.overdue ? ` · ${stats.overdue} vencidas` : ""}`));

      Object.entries(TASK_STATUS).forEach(([status, meta]) => {
        const column = h("section", { className: `pd-tasks__column pd-tasks__column--${status}`, dataset: { status }, "aria-label": meta.label });
        const items = tasks
          .filter((task) => task.status === status)
          .filter((task) => !filter || `${task.title} ${task.details || ""} ${task.assignee || ""}`.toLowerCase().includes(filter))
          .sort((a, b) => {
            if (status === "done") return ctx.store.compactTimestamp(b.updatedAt) - ctx.store.compactTimestamp(a.updatedAt);
            const pa = a.priority === "alta" ? 0 : a.priority === "baja" ? 2 : 1;
            const pb = b.priority === "alta" ? 0 : b.priority === "baja" ? 2 : 1;
            if (pa !== pb) return pa - pb;
            return text(a.dueDate || "9999").localeCompare(text(b.dueDate || "9999"));
          });
        const head = h("header", { className: "pd-tasks__column-head" }, icon(meta.icon, { size: 15 }), h("h3", {}, meta.label), h("span", { className: "pd-tasks__count" }, String(items.length)));
        head.appendChild(button({ icon: "plus", title: `Nueva tarea en ${meta.label}`, className: "pd-btn--ghost pd-btn--icon", onClick: () => promptTask(ctx, { status }) }));
        column.appendChild(head);
        const list = h("div", { className: "pd-tasks__list" });
        if (!items.length) list.appendChild(h("p", { className: "pd-tasks__empty" }, status === "todo" ? "Sin pendientes." : status === "doing" ? "Nada en curso." : "Todavía nada terminado."));
        items.forEach((task) => list.appendChild(taskCard(ctx, task)));
        column.appendChild(list);
        column.addEventListener("dragover", (event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          column.classList.add("is-drop-target");
        });
        column.addEventListener("dragleave", () => column.classList.remove("is-drop-target"));
        column.addEventListener("drop", (event) => {
          event.preventDefault();
          column.classList.remove("is-drop-target");
          const id = event.dataTransfer.getData("text/plain");
          const task = tasks.find((entry) => entry.id === id);
          if (task) moveTask(ctx, task, status);
        });
        board.appendChild(column);
      });
      if (!tasks.length) {
        board.appendChild(emptyState({ icon: "list-checks", title: "Sin tareas todavía", message: "Dividí el proyecto en tareas con responsable y fecha. El avance se refleja en el escritorio.", action: button({ icon: "plus", label: "Crear la primera tarea", className: "pd-btn--primary", onClick: () => promptTask(ctx) }) }));
      }
    };

    const unwatch = ctx.state.watch(["tasks", "members", "config"], renderBoard);
    renderBoard();
    if (params.create) promptTask(ctx);
    return {
      destroy: () => unwatch(),
      update: (next) => {
        if (next?.create) promptTask(ctx);
      }
    };
  }
};
