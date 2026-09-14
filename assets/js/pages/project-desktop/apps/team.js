// App "Equipo": integrantes del proyecto (guardados en desktop_meta/config.team)
// y nómina del comité (committee_members) para sumarlos con un clic.
import { h, clear, icon, button, openDialog, confirmDialog, showMenu, toast, emptyState, text, avatarNode } from "../ui.js";
import { groupCommitteeMembers } from "../../../common/committee-member-roles.js";

export const TEAM_ROLES = Object.freeze({
  responsable: "Responsable",
  colaborador: "Colaborador/a",
  asesor: "Asesor/a",
  invitado: "Invitado/a"
});

const normalizeTeam = (config) => (Array.isArray(config?.team) ? config.team.filter((m) => m && text(m.name)) : []);

export async function saveTeam(ctx, team) {
  const clean = team.slice(0, 40).map((member) => ({
    name: text(member.name).trim().slice(0, 120),
    role: TEAM_ROLES[member.role] ? member.role : "colaborador",
    uid: text(member.uid).slice(0, 128),
    unit: text(member.unit).slice(0, 120)
  }));
  await ctx.store.updateConfig({ team: clean });
}

export async function addTeamMember(ctx, preset = {}) {
  const team = normalizeTeam(ctx.state.get("config"));
  const values = await openDialog({
    title: "Sumar integrante al proyecto",
    fields: [
      { name: "name", label: "Nombre y apellido", type: "text", required: true, value: preset.name || "", maxLength: 120 },
      { name: "role", label: "Rol en el proyecto", type: "select", options: Object.entries(TEAM_ROLES).map(([value, label]) => ({ value, label })), value: preset.role || "colaborador" },
      { name: "unit", label: "Unidad / sector (opcional)", type: "text", value: preset.unit || "", maxLength: 120 }
    ],
    submitLabel: "Agregar"
  });
  if (!values) return false;
  if (team.some((member) => member.name.toLowerCase() === values.name.toLowerCase())) {
    toast("Esa persona ya integra el proyecto.", { type: "info" });
    return false;
  }
  try {
    await saveTeam(ctx, [...team, { name: values.name, role: values.role, uid: preset.uid || "", unit: values.unit }]);
    ctx.store.logActivity("added", "team", values.name);
    toast(`${values.name} se sumó al proyecto.`, { type: "success" });
    return true;
  } catch (error) {
    console.error(error);
    toast("No se pudo guardar el equipo.", { type: "error" });
    return false;
  }
}

export const teamApp = {
  id: "team",
  title: "Equipo",
  icon: "users",
  tone: "purple",
  defaultSize: { w: 900, h: 600 },
  mount(container, ctx) {
    const layout = h("div", { className: "pd-team" });
    const projectPane = h("section", { className: "pd-team__project" });
    const committeePane = h("aside", { className: "pd-team__committee" });
    layout.appendChild(projectPane);
    layout.appendChild(committeePane);
    clear(container).appendChild(layout);

    const renderProject = () => {
      clear(projectPane);
      const topic = ctx.state.get("topic");
      const team = normalizeTeam(ctx.state.get("config"));
      const head = h("div", { className: "pd-team__head" });
      head.appendChild(h("div", {}, h("h3", {}, "Integrantes del proyecto"), h("p", { className: "pd-team__lead" }, icon("lightbulb", { size: 13 }), h("span", {}, `Propuesto por: ${text(topic?.proposedBy) || "—"}`))));
      head.appendChild(h("span", { className: "pd-toolbar__spacer" }));
      head.appendChild(button({ icon: "user-plus", label: "Sumar", className: "pd-btn--primary pd-btn--sm", onClick: () => addTeamMember(ctx) }));
      projectPane.appendChild(head);
      if (!team.length) {
        projectPane.appendChild(emptyState({ icon: "users", title: "Todavía no hay integrantes asignados", message: "Sumá a quienes trabajan en este proyecto desde la nómina del comité o con \"Sumar\"." }));
        return;
      }
      const list = h("div", { className: "pd-team__list" });
      team.forEach((member, index) => {
        const card = h("article", { className: "pd-team__member" });
        card.appendChild(avatarNode({ name: member.name, uid: member.uid, size: 40 }));
        const body = h("div", { className: "pd-team__member-body" });
        body.appendChild(h("strong", {}, member.name));
        body.appendChild(h("small", {}, [TEAM_ROLES[member.role] || "Colaborador/a", member.unit].filter(Boolean).join(" · ")));
        card.appendChild(body);
        const menuBtn = button({ icon: "ellipsis", title: `Opciones de ${member.name}`, className: "pd-btn--ghost pd-btn--icon", onClick: () => {
          showMenu(
            [
              ...Object.entries(TEAM_ROLES).map(([value, label]) => ({ label, icon: value === member.role ? "check" : "user", checked: value === member.role, onSelect: async () => {
                const next = team.map((entry, i) => (i === index ? { ...entry, role: value } : entry));
                try { await saveTeam(ctx, next); } catch (error) { console.error(error); toast("No se pudo actualizar el rol.", { type: "error" }); }
              } })),
              { separator: true },
              { label: "Quitar del proyecto", icon: "trash", danger: true, onSelect: async () => {
                const ok = await confirmDialog({ title: "Quitar integrante", message: `${member.name} dejará de figurar en el equipo del proyecto.`, confirmLabel: "Quitar", danger: true });
                if (!ok) return;
                try {
                  await saveTeam(ctx, team.filter((_, i) => i !== index));
                  ctx.store.logActivity("removed", "team", member.name);
                } catch (error) { console.error(error); toast("No se pudo quitar.", { type: "error" }); }
              } }
            ],
            { anchor: menuBtn, align: "end" }
          );
        } });
        card.appendChild(menuBtn);
        list.appendChild(card);
      });
      projectPane.appendChild(list);
      ctx.hydrateAvatars(list);
    };

    const renderCommittee = () => {
      clear(committeePane);
      const members = ctx.state.get("members") || [];
      const team = normalizeTeam(ctx.state.get("config"));
      committeePane.appendChild(h("h3", {}, `Nómina del ${ctx.committee.name.replace(/^Comité (de |Ejecutivo de )?/i, "comité: ")}`));
      committeePane.appendChild(h("p", { className: "pd-team__hint" }, "Clic en + para sumar al proyecto."));
      if (!members.length) {
        committeePane.appendChild(h("p", { className: "pd-team__hint" }, "El comité todavía no tiene integrantes cargados."));
        return;
      }
      groupCommitteeMembers(members).forEach((group) => {
        if (!group.members.length) return;
        committeePane.appendChild(h("h4", { className: "pd-team__group" }, group.title));
        group.members.forEach((member) => {
          const inTeam = team.some((entry) => entry.name.toLowerCase() === text(member.name).toLowerCase());
          const row = h("div", { className: `pd-team__row${inTeam ? " is-in-team" : ""}` });
          row.appendChild(avatarNode({ name: member.name, uid: member.userUid, size: 28 }));
          row.appendChild(h("span", { className: "pd-team__row-name" }, h("strong", {}, member.name), h("small", {}, [member.committeeRoleLabel, member.businessUnit, member.managementUnit].filter(Boolean).join(" · "))));
          row.appendChild(
            inTeam
              ? h("span", { className: "pd-team__in", title: "Ya integra el proyecto" }, icon("badge-check", { size: 16 }))
              : button({ icon: "plus", title: `Sumar a ${member.name}`, className: "pd-btn--ghost pd-btn--icon", onClick: () => addTeamMember(ctx, { name: member.name, uid: member.userUid || "", unit: [member.businessUnit, member.managementUnit].filter(Boolean).join(" · ") }) })
          );
          committeePane.appendChild(row);
        });
      });
      ctx.hydrateAvatars(committeePane);
    };

    const render = () => {
      renderProject();
      renderCommittee();
    };
    const unwatch = ctx.state.watch(["config", "members", "topic"], render);
    render();
    return { destroy: () => unwatch() };
  }
};
