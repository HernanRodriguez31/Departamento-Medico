// App "Calendario": reuniones, hitos, plazos y recordatorios del proyecto.
// Los eventos se guardan en calendar_events con projectId, por lo que también
// se ven en el calendario del comité y del departamento. La primera reunión
// futura actualiza "Próxima reunión" en la tarjeta del proyecto.
import {
  h,
  clear,
  icon,
  button,
  openDialog,
  confirmDialog,
  toast,
  openExternal,
  formatDateLong,
  formatDateShort,
  minutesToTime,
  timeToMinutes,
  todayKey,
  toDateKey,
  parseDateKey,
  isDateKey,
  describeCountdown,
  emptyState,
  text
} from "../ui.js";

export const EVENT_KINDS = Object.freeze({
  reunion: { label: "Reunión", color: "green", icon: "users" },
  hito: { label: "Hito", color: "violet", icon: "flag" },
  plazo: { label: "Plazo / entrega", color: "red", icon: "alarm-clock" },
  recordatorio: { label: "Recordatorio", color: "amber", icon: "bell" }
});

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function eventsForDay(events, dateKey) {
  return events
    .filter((event) => text(event.startDateKey || event.dateKey) <= dateKey && text(event.endDateKey || event.dateKey) >= dateKey)
    .sort((a, b) => (a.allDay === b.allDay ? (a.startMinutes || 0) - (b.startMinutes || 0) : a.allDay ? -1 : 1));
}

export function upcomingEvents(events, limitCount = 6) {
  const today = todayKey();
  return [...events]
    .filter((event) => text(event.endDateKey || event.dateKey) >= today)
    .sort((a, b) => (text(a.dateKey) + minutesToTime(a.startMinutes)).localeCompare(text(b.dateKey) + minutesToTime(b.startMinutes)))
    .slice(0, limitCount);
}

export async function promptEvent(ctx, { event = null, dateKey = todayKey() } = {}) {
  const kindOptions = Object.entries(EVENT_KINDS).map(([value, meta]) => ({ value, label: meta.label }));
  const values = await openDialog({
    title: event ? "Editar evento" : "Nuevo evento del proyecto",
    description: "Las reuniones actualizan automáticamente la fecha de \"Próxima reunión\" de la tarjeta del proyecto y se ven en el calendario del comité.",
    fields: [
      { name: "title", label: "Título", type: "text", required: true, value: event?.title || "", placeholder: "Ej. Reunión de avance", maxLength: 200 },
      { name: "eventKind", label: "Tipo", type: "select", options: kindOptions, value: event?.eventKind || "reunion" },
      { name: "dateKey", label: "Fecha", type: "date", required: true, value: event?.dateKey || dateKey },
      { name: "endDateKey", label: "Fecha de fin (opcional, para eventos de varios días)", type: "date", value: event && event.endDateKey !== event.dateKey ? event.endDateKey : "" },
      { name: "allDay", label: "Todo el día", type: "checkbox", value: event ? Boolean(event.allDay) : false },
      { name: "startTime", label: "Hora de inicio", type: "time", value: event && !event.allDay ? minutesToTime(event.startMinutes) : "" },
      { name: "endTime", label: "Hora de fin", type: "time", value: event && !event.allDay ? minutesToTime(event.endMinutes) : "" },
      { name: "link", label: "Enlace de la reunión (Teams, opcional)", type: "url", value: event?.link || "", placeholder: "https://teams.microsoft.com/l/meetup-join/…" },
      { name: "note", label: "Nota / agenda", type: "textarea", rows: 3, value: event?.note || "", maxLength: 2000 }
    ],
    validate: (v) => {
      if (!isDateKey(v.dateKey)) return "Indicá una fecha válida.";
      if (v.endDateKey && (!isDateKey(v.endDateKey) || v.endDateKey < v.dateKey)) return "La fecha de fin debe ser posterior a la de inicio.";
      if (!v.allDay && v.startTime && v.endTime && timeToMinutes(v.endTime) <= timeToMinutes(v.startTime)) return "La hora de fin debe ser posterior a la de inicio.";
      return "";
    },
    submitLabel: event ? "Guardar cambios" : "Crear evento"
  });
  if (!values) return false;
  const kind = EVENT_KINDS[values.eventKind] ? values.eventKind : "reunion";
  const payload = {
    title: values.title,
    eventKind: kind,
    dateKey: values.dateKey,
    endDateKey: values.endDateKey || values.dateKey,
    allDay: values.allDay || !values.startTime,
    startMinutes: values.allDay ? null : timeToMinutes(values.startTime),
    endMinutes: values.allDay ? null : timeToMinutes(values.endTime),
    link: values.link,
    note: values.note,
    colorKey: EVENT_KINDS[kind].color
  };
  const meta = { projectTitle: ctx.projectTitle(), committeeName: ctx.committee.name };
  try {
    if (event) await ctx.store.updateEvent(event.id, payload, meta);
    else await ctx.store.addEvent(payload, meta);
    toast(event ? "Evento actualizado." : "Evento creado.", { type: "success" });
    ctx.scheduleMeetingSync();
    return true;
  } catch (error) {
    console.error(error);
    toast("No se pudo guardar el evento.", { type: "error" });
    return false;
  }
}

export async function removeEvent(ctx, event) {
  const ok = await confirmDialog({ title: "Eliminar evento", message: `¿Eliminar "${event.title}" del calendario del proyecto?`, confirmLabel: "Eliminar", danger: true });
  if (!ok) return false;
  try {
    await ctx.store.deleteEvent(event.id, event.title);
    toast("Evento eliminado.", { type: "success" });
    ctx.scheduleMeetingSync();
    return true;
  } catch (error) {
    console.error(error);
    toast("No se pudo eliminar el evento.", { type: "error" });
    return false;
  }
}

export function eventRow(ctx, event, { showDate = false } = {}) {
  const meta = EVENT_KINDS[event.eventKind] || EVENT_KINDS.reunion;
  const row = h("article", { className: `pd-event pd-event--${meta.color}` });
  const when = h("div", { className: "pd-event__when" });
  if (showDate) when.appendChild(h("strong", {}, formatDateShort(event.dateKey)));
  when.appendChild(h("span", {}, event.allDay ? "Todo el día" : `${minutesToTime(event.startMinutes) || "—"}${event.endMinutes ? ` – ${minutesToTime(event.endMinutes)}` : ""}`));
  row.appendChild(when);
  const body = h("div", { className: "pd-event__body" });
  body.appendChild(h("p", { className: "pd-event__title" }, icon(meta.icon, { size: 14 }), h("span", {}, event.title)));
  const details = [];
  details.push(meta.label);
  if (event.endDateKey && event.endDateKey !== event.dateKey) details.push(`hasta ${formatDateShort(event.endDateKey)}`);
  if (event.createdByName) details.push(`por ${event.createdByName}`);
  body.appendChild(h("p", { className: "pd-event__meta" }, details.join(" · ")));
  if (event.note) body.appendChild(h("p", { className: "pd-event__note" }, event.note));
  row.appendChild(body);
  const actions = h("div", { className: "pd-event__actions" });
  if (event.link) actions.appendChild(button({ icon: "video", title: "Unirse a la reunión", className: "pd-btn--ghost pd-btn--icon", onClick: () => openExternal(event.link) }));
  actions.appendChild(button({ icon: "pencil", title: "Editar", className: "pd-btn--ghost pd-btn--icon", onClick: () => promptEvent(ctx, { event }) }));
  actions.appendChild(button({ icon: "trash", title: "Eliminar", className: "pd-btn--ghost pd-btn--icon pd-btn--danger-text", onClick: () => removeEvent(ctx, event) }));
  row.appendChild(actions);
  return row;
}

export const calendarApp = {
  id: "calendar",
  title: "Calendario",
  icon: "calendar-days",
  tone: "blue",
  defaultSize: { w: 960, h: 620 },
  mount(container, ctx, params = {}) {
    const today = parseDateKey(todayKey());
    let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
    let selected = isDateKey(params.dateKey) ? params.dateKey : todayKey();

    const layout = h("div", { className: "pd-calendar" });
    const monthPane = h("div", { className: "pd-calendar__month" });
    const sidePane = h("aside", { className: "pd-calendar__side" });
    layout.appendChild(monthPane);
    layout.appendChild(sidePane);
    clear(container).appendChild(layout);

    const renderMonth = () => {
      clear(monthPane);
      const events = (ctx.state.get("events") || []);
      const monthLabel = cursor.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
      const head = h("div", { className: "pd-calendar__head" });
      head.appendChild(button({ icon: "chevron-left", title: "Mes anterior", className: "pd-btn--ghost pd-btn--icon", onClick: () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); renderMonth(); } }));
      head.appendChild(h("h3", { className: "pd-calendar__title" }, monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)));
      head.appendChild(button({ icon: "chevron-right", title: "Mes siguiente", className: "pd-btn--ghost pd-btn--icon", onClick: () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); renderMonth(); } }));
      head.appendChild(h("span", { className: "pd-toolbar__spacer" }));
      head.appendChild(button({ label: "Hoy", className: "pd-btn--secondary pd-btn--sm", onClick: () => { cursor = new Date(today.getFullYear(), today.getMonth(), 1); selected = todayKey(); render(); } }));
      head.appendChild(button({ icon: "plus", label: "Nuevo evento", className: "pd-btn--primary pd-btn--sm", onClick: () => promptEvent(ctx, { dateKey: selected }) }));
      monthPane.appendChild(head);

      const grid = h("div", { className: "pd-calendar__grid", role: "grid", "aria-label": `Calendario de ${monthLabel}` });
      WEEKDAYS.forEach((day) => grid.appendChild(h("div", { className: "pd-calendar__weekday", role: "columnheader" }, day)));
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const offset = (first.getDay() + 6) % 7; // lunes = 0
      const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const cells = [];
      for (let i = 0; i < offset; i += 1) cells.push(null);
      for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
      while (cells.length % 7 !== 0) cells.push(null);
      const nextMeeting = text(ctx.state.get("topic")?.nextMeeting);
      cells.forEach((date) => {
        if (!date) {
          grid.appendChild(h("div", { className: "pd-calendar__cell is-empty", role: "gridcell" }));
          return;
        }
        const key = toDateKey(date);
        const dayEvents = eventsForDay(events, key);
        const cell = h("button", {
          type: "button",
          role: "gridcell",
          className: `pd-calendar__cell${key === todayKey() ? " is-today" : ""}${key === selected ? " is-selected" : ""}${key === nextMeeting ? " is-next-meeting" : ""}`,
          "aria-label": `${formatDateLong(key)}${dayEvents.length ? `, ${dayEvents.length} eventos` : ""}`,
          "aria-selected": key === selected ? "true" : "false",
          onclick: () => { selected = key; render(); },
          ondblclick: () => promptEvent(ctx, { dateKey: key })
        });
        cell.appendChild(h("span", { className: "pd-calendar__day" }, String(date.getDate())));
        if (dayEvents.length) {
          const dots = h("span", { className: "pd-calendar__dots", "aria-hidden": "true" });
          dayEvents.slice(0, 4).forEach((event) => dots.appendChild(h("i", { className: `pd-dot pd-dot--${(EVENT_KINDS[event.eventKind] || EVENT_KINDS.reunion).color}` })));
          cell.appendChild(dots);
          const preview = dayEvents[0];
          cell.appendChild(h("span", { className: "pd-calendar__preview" }, preview.title));
          if (dayEvents.length > 1) cell.appendChild(h("span", { className: "pd-calendar__more" }, `+${dayEvents.length - 1}`));
        }
        grid.appendChild(cell);
      });
      monthPane.appendChild(grid);
      const legend = h("div", { className: "pd-calendar__legend" });
      Object.entries(EVENT_KINDS).forEach(([key, meta]) => legend.appendChild(h("span", { className: "pd-legend" }, h("i", { className: `pd-dot pd-dot--${meta.color}` }), meta.label)));
      monthPane.appendChild(legend);
    };

    const renderSide = () => {
      clear(sidePane);
      const events = ctx.state.get("events") || [];
      const topic = ctx.state.get("topic");
      const dayEvents = eventsForDay(events, selected);
      sidePane.appendChild(h("h3", { className: "pd-calendar__side-title" }, formatDateLong(selected)));
      if (topic?.nextMeeting) {
        sidePane.appendChild(h("p", { className: "pd-calendar__next" }, icon("users", { size: 14 }), h("span", {}, `Próxima reunión: ${formatDateShort(topic.nextMeeting)} · ${describeCountdown(topic.nextMeeting)}`)));
      }
      if (!dayEvents.length) {
        sidePane.appendChild(emptyState({ icon: "calendar-plus", title: "Sin eventos este día", message: "Doble clic en un día o \"Nuevo evento\" para agendar una reunión, hito o plazo.", action: button({ icon: "plus", label: "Nuevo evento", className: "pd-btn--primary pd-btn--sm", onClick: () => promptEvent(ctx, { dateKey: selected }) }) }));
      } else {
        dayEvents.forEach((event) => sidePane.appendChild(eventRow(ctx, event)));
      }
      const upcoming = upcomingEvents(events, 8).filter((event) => text(event.dateKey) !== selected);
      if (upcoming.length) {
        sidePane.appendChild(h("h4", { className: "pd-calendar__side-subtitle" }, "Próximos"));
        upcoming.forEach((event) => sidePane.appendChild(eventRow(ctx, event, { showDate: true })));
      }
      sidePane.appendChild(
        h("p", { className: "pd-calendar__foot" }, "Estos eventos también se muestran en el calendario del comité y del departamento.")
      );
    };

    const render = () => {
      renderMonth();
      renderSide();
    };
    const unwatch = ctx.state.watch(["events", "topic"], render);
    render();
    return {
      destroy: () => unwatch(),
      update: (next) => {
        if (next?.dateKey && isDateKey(next.dateKey)) {
          selected = next.dateKey;
          const date = parseDateKey(next.dateKey);
          cursor = new Date(date.getFullYear(), date.getMonth(), 1);
          render();
        }
        if (next?.create) promptEvent(ctx, { dateKey: selected });
      }
    };
  }
};
