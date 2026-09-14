// App "Avance": ficha del proyecto (etapa 1–5, fechas, objetivo) e indicadores
// derivados (tareas, documentos, eventos). Escribe sobre el documento del
// proyecto (committee_topics) con los mismos campos que la tarjeta del comité.
import { h, clear, icon, button, openDialog, toast, formatDate, formatDateLong, describeCountdown, isDateKey, text, debounce, formatRelative } from "../ui.js";
import { taskStats } from "./tasks.js";
import { upcomingEvents } from "./calendar.js";

export const PROJECT_STAGES = Object.freeze([
  { id: 1, label: "Planificación", short: "Plan.", desc: "Definición del objetivo, criterios, recursos y alcance del proyecto." },
  { id: 2, label: "Programación", short: "Prog.", desc: "Organización de tareas, responsables y tiempos para ejecutar el plan." },
  { id: 3, label: "Desarrollo", short: "Des.", desc: "Construcción o elaboración del contenido técnico o solución del proyecto." },
  { id: 4, label: "Ejecución", short: "Ejec.", desc: "Implementación en el entorno real, con seguimiento operativo y ajustes." },
  { id: 5, label: "Finalizado", short: "Fin.", desc: "Cierre formal del proyecto y registro de resultados, impacto y aprendizajes." }
]);

export function stageOf(topic) {
  const n = Number(topic?.stage);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 1;
}

export async function setStage(ctx, stage) {
  const topic = ctx.state.get("topic");
  if (!topic) return;
  const updates = { stage };
  if (stage === 5) updates.finishedDate = new Date().toISOString();
  else if (stageOf(topic) === 5) updates.finishedDate = null;
  try {
    await ctx.store.updateTopic(updates);
    ctx.store.logActivity("stage", "project", `Etapa: ${PROJECT_STAGES[stage - 1].label}`);
    toast(`Etapa actualizada: ${PROJECT_STAGES[stage - 1].label}.`, { type: "success" });
  } catch (error) {
    console.error(error);
    toast(ctx.explainTopicError(error), { type: "error", timeout: 5000 });
  }
}

export function stepper(ctx, topic, { interactive = true, compact = false } = {}) {
  const current = stageOf(topic);
  const wrap = h("div", { className: `pd-stepper${compact ? " pd-stepper--compact" : ""}`, role: "group", "aria-label": "Proceso de avance" });
  PROJECT_STAGES.forEach((stage) => {
    const state = stage.id < current ? "is-complete" : stage.id === current ? "is-current" : "";
    const node = h(interactive ? "button" : "span", {
      type: interactive ? "button" : null,
      className: `pd-stepper__step ${state}`.trim(),
      title: `${stage.label}: ${stage.desc}`,
      "aria-label": interactive ? `Mover a ${stage.id}. ${stage.label}` : `${stage.id}. ${stage.label}${stage.id === current ? ", etapa actual" : ""}`,
      "aria-current": stage.id === current ? "step" : null,
      onclick: interactive ? () => setStage(ctx, stage.id === current ? Math.max(1, stage.id - 1) : stage.id) : null
    });
    node.appendChild(h("span", { className: "pd-stepper__dot" }, String(stage.id)));
    node.appendChild(h("span", { className: "pd-stepper__label" }, compact ? stage.short : stage.label));
    wrap.appendChild(node);
  });
  return wrap;
}

export const progressApp = {
  id: "progress",
  title: "Avance del proyecto",
  icon: "target",
  tone: "green",
  defaultSize: { w: 860, h: 640 },
  mount(container, ctx) {
    const layout = h("div", { className: "pd-progress" });
    clear(container).appendChild(layout);
    let descriptionDirty = false;

    const saveDescription = debounce(async (value) => {
      try {
        await ctx.store.updateConfig({ description: text(value).slice(0, 2000) });
        descriptionDirty = false;
        descStatus.textContent = `Guardado · ${formatRelative(new Date())}`;
      } catch (error) {
        console.error(error);
        descStatus.textContent = "No se pudo guardar.";
      }
    }, 900);
    const descStatus = h("span", { className: "pd-notes__status" });
    const descArea = h("textarea", {
      className: "pd-input pd-progress__description",
      rows: 4,
      maxlength: 2000,
      placeholder: "Objetivo y alcance del proyecto, población destinataria, resultados esperados…",
      "aria-label": "Objetivo del proyecto",
      oninput: () => {
        descriptionDirty = true;
        descStatus.textContent = "Escribiendo…";
        saveDescription(descArea.value);
      }
    });

    const editDates = async () => {
      const topic = ctx.state.get("topic");
      const values = await openDialog({
        title: "Ficha del proyecto",
        fields: [
          { name: "title", label: "Nombre del proyecto", type: "text", required: true, value: topic?.title || "", maxLength: 300 },
          { name: "proposedBy", label: "Propuesto por", type: "text", value: topic?.proposedBy || "", maxLength: 200 },
          { name: "startDate", label: "Fecha de inicio", type: "date", value: topic?.startDate || "" },
          { name: "nextMeeting", label: "Próxima reunión", type: "date", value: topic?.nextMeeting || "", help: "Se actualiza sola al agendar reuniones en el calendario." }
        ],
        validate: (v) => ((v.startDate && !isDateKey(v.startDate)) || (v.nextMeeting && !isDateKey(v.nextMeeting)) ? "Revisá las fechas." : ""),
        submitLabel: "Guardar"
      });
      if (!values) return;
      try {
        await ctx.store.updateTopic({ title: values.title, proposedBy: values.proposedBy, startDate: values.startDate, nextMeeting: values.nextMeeting });
        ctx.store.logActivity("updated", "project", "Ficha del proyecto");
        toast("Ficha actualizada.", { type: "success" });
      } catch (error) {
        console.error(error);
        toast(ctx.explainTopicError(error), { type: "error", timeout: 5000 });
      }
    };

    const render = () => {
      const topic = ctx.state.get("topic") || {};
      const config = ctx.state.get("config") || {};
      const tasks = taskStats(ctx.state.get("tasks") || []);
      const items = (ctx.state.get("items") || []).filter((item) => !item.archived);
      const notes = (ctx.state.get("notes") || []).filter((note) => !note.archived);
      const events = ctx.state.get("events") || [];
      const stage = stageOf(topic);
      clear(layout);

      const hero = h("section", { className: "pd-progress__hero" });
      hero.appendChild(h("p", { className: "pd-progress__eyebrow" }, ctx.committee.name));
      hero.appendChild(h("h3", { className: "pd-progress__title" }, text(topic.title) || "Proyecto"));
      const facts = h("dl", { className: "pd-progress__facts" });
      const fact = (label, value) => facts.appendChild(h("div", {}, h("dt", {}, label), h("dd", {}, value || "—")));
      fact("Propuesto por", text(topic.proposedBy));
      fact("Inicio", formatDate(topic.startDate));
      fact("Próxima reunión", topic.nextMeeting ? `${formatDate(topic.nextMeeting)} · ${describeCountdown(topic.nextMeeting)}` : "Sin fecha");
      fact(stage === 5 ? "Finalizado" : "Etapa actual", stage === 5 ? formatDate(topic.finishedDate) : PROJECT_STAGES[stage - 1].label);
      hero.appendChild(facts);
      hero.appendChild(button({ icon: "pencil", label: "Editar ficha", className: "pd-btn--secondary pd-btn--sm", onClick: editDates }));
      layout.appendChild(hero);

      const stageBlock = h("section", { className: "pd-progress__block" });
      stageBlock.appendChild(h("div", { className: "pd-progress__block-head" }, h("h4", {}, "Proceso de avance"), h("span", { className: "pd-progress__percent" }, `${stage * 20}%`)));
      stageBlock.appendChild(stepper(ctx, topic));
      stageBlock.appendChild(h("p", { className: "pd-progress__stage-desc" }, PROJECT_STAGES[stage - 1].desc));
      layout.appendChild(stageBlock);

      const kpis = h("section", { className: "pd-progress__kpis" });
      const kpi = (iconName, value, label, onClick) => {
        const node = h("button", { type: "button", className: "pd-kpi", onclick: onClick }, icon(iconName, { size: 18 }), h("strong", {}, String(value)), h("span", {}, label));
        kpis.appendChild(node);
      };
      kpi("list-checks", `${tasks.done}/${tasks.total}`, tasks.overdue ? `tareas hechas · ${tasks.overdue} vencidas` : "tareas hechas", () => ctx.openApp("tasks"));
      kpi("folder", items.length, "archivos y carpetas", () => ctx.openApp("files"));
      kpi("notebook-pen", notes.length, "actas y notas", () => ctx.openApp("notes"));
      kpi("calendar-days", upcomingEvents(events, 99).length, "eventos próximos", () => ctx.openApp("calendar"));
      layout.appendChild(kpis);

      const objective = h("section", { className: "pd-progress__block" });
      objective.appendChild(h("div", { className: "pd-progress__block-head" }, h("h4", {}, "Objetivo y alcance"), descStatus));
      if (!descriptionDirty && document.activeElement !== descArea) descArea.value = text(config.description);
      objective.appendChild(descArea);
      layout.appendChild(objective);

      if (topic.finishedDate) {
        layout.appendChild(h("p", { className: "pd-progress__finished" }, icon("badge-check", { size: 16 }), h("span", {}, `Proyecto finalizado el ${formatDateLong(text(topic.finishedDate).slice(0, 10))}. Quedó en "Trabajos finalizados" del comité.`)));
      }
    };

    const unwatch = ctx.state.watch(["topic", "config", "tasks", "items", "notes", "events"], render);
    render();
    return {
      destroy: () => {
        if (descriptionDirty) saveDescription.flush(descArea.value);
        unwatch();
      }
    };
  }
};
