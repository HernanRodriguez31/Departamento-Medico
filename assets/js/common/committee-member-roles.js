const COMMITTEE_ROLE_PRIORITY = Object.freeze({
  referente: 0,
  secretario: 1,
  vocal: 2,
});

export const COMMITTEE_MEMBER_GROUPS = Object.freeze([
  {
    key: "referentes",
    title: "Referentes",
    committeeRole: "referente",
    emptyMessage: "Sin referentes",
  },
  {
    key: "secretaria",
    title: "Secretaría",
    committeeRole: "secretario",
    emptyMessage: "Sin secretaría",
  },
  {
    key: "vocales",
    title: "Vocales",
    committeeRole: "vocal",
    emptyMessage: "Sin vocales",
  },
]);

const COMMITTEE_ROLE_LABELS = Object.freeze({
  referente: "Referente",
  secretario: "Secretaría",
  vocal: "Vocal",
});

const DEPARTMENT_ROLE_LABELS = Object.freeze({
  directora: "Directora del Departamento",
  subdirector: "Subdirector",
  coordinador: "Coordinador",
});

const DEPARTMENT_ROLE_BY_UID = Object.freeze({});

const departmentRoleByNormalizedName = new Map();
const warnedCommitteeRoles = new Set();

const registerDepartmentRole = (departmentRole, names = []) => {
  names.forEach((name) => {
    const normalizedName = normalizeCommitteeMemberName(name);
    if (normalizedName) {
      departmentRoleByNormalizedName.set(normalizedName, departmentRole);
    }
  });
};

registerDepartmentRole("directora", [
  "Leila Cura",
  "Dra. Leila Cura",
]);

registerDepartmentRole("subdirector", [
  "Gustavo Silva",
  "Dr. Gustavo Silva",
  "Juan Martín Azcárate",
  "Juan Martin Azcarate",
  "Dr. Juan Martín Azcárate",
]);

registerDepartmentRole("coordinador", [
  "Hernán Rodríguez",
  "Hernan Rodriguez",
  "Juan Maurino",
  "Sergio Aciar",
  "Roberto Saba",
  "Roberto R. Saba",
  "Roberto R Saba",
  "Mario Bianchi",
  "Leandro Medina",
]);

export function normalizeCommitteeMemberName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(dra?|doctora?)\.?\s+/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCommitteeRoleValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function warnCommitteeRoleOnce(key, message) {
  if (warnedCommitteeRoles.has(key)) return;
  warnedCommitteeRoles.add(key);
  console.warn(message);
}

export function resolveCommitteeRole(member = {}) {
  const rawRole = String(member.committeeRole || "").trim();
  const role = normalizeCommitteeRoleValue(rawRole);
  if (role === "referente" || role === "coordinador" || role === "lider" || role === "responsable" || role === "presidente" || role === "chair") {
    return "referente";
  }
  if (role === "secretario" || role === "secretaria" || role === "secretaria/o" || role === "secretary") {
    return "secretario";
  }
  if (role === "vocal" || role === "miembro" || role === "integrante" || role === "member" || role === "participante") {
    return "vocal";
  }
  if (!rawRole) {
    warnCommitteeRoleOnce("empty", "committee_members: committeeRole vacio; se renderiza segun isLeader o como vocal.");
    return member.isLeader === true ? "referente" : "vocal";
  }
  warnCommitteeRoleOnce(`unknown:${role}`, `committee_members: committeeRole no mapeado "${rawRole}"; se renderiza segun isLeader o como vocal.`);
  return member.isLeader === true ? "referente" : "vocal";
}

export function resolveDepartmentRole(member = {}) {
  const userUid = String(member.userUid || "").trim();
  if (userUid && Object.prototype.hasOwnProperty.call(DEPARTMENT_ROLE_BY_UID, userUid)) {
    return DEPARTMENT_ROLE_BY_UID[userUid];
  }
  const normalizedName = normalizeCommitteeMemberName(member.name);
  return departmentRoleByNormalizedName.get(normalizedName) || null;
}

export function getCommitteeRoleLabel(committeeRole) {
  return COMMITTEE_ROLE_LABELS[committeeRole] || COMMITTEE_ROLE_LABELS.vocal;
}

export function getDepartmentRoleLabel(departmentRole) {
  return DEPARTMENT_ROLE_LABELS[departmentRole] || "";
}

export function decorateCommitteeMember(member = {}) {
  const committeeRole = resolveCommitteeRole(member);
  const departmentRole = resolveDepartmentRole(member);

  return {
    ...member,
    committeeRole,
    departmentRole,
    committeeRoleLabel: getCommitteeRoleLabel(committeeRole),
    departmentRoleLabel: getDepartmentRoleLabel(departmentRole),
    sortName: normalizeCommitteeMemberName(member.name),
    sortArrival: getCommitteeMemberArrivalMillis(member.createdAt),
  };
}

export function getCommitteeMemberArrivalMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
  }
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortCommitteeMembers(members = []) {
  return [...members]
    .map((member) => decorateCommitteeMember(member))
    .sort((left, right) => {
      const committeePriority =
        (COMMITTEE_ROLE_PRIORITY[left.committeeRole] ?? COMMITTEE_ROLE_PRIORITY.vocal) -
        (COMMITTEE_ROLE_PRIORITY[right.committeeRole] ?? COMMITTEE_ROLE_PRIORITY.vocal);
      if (committeePriority !== 0) return committeePriority;

      if (left.sortArrival !== right.sortArrival) {
        return right.sortArrival - left.sortArrival;
      }

      return left.sortName.localeCompare(right.sortName, "es");
    });
}

export function groupCommitteeMembers(members = []) {
  const decoratedMembers = sortCommitteeMembers(members);
  return COMMITTEE_MEMBER_GROUPS.map((group) => ({
    ...group,
    members: decoratedMembers.filter((member) => member.committeeRole === group.committeeRole),
  }));
}

export function buildCommitteeMemberWritePayload(baseData = {}, committeeRole = "vocal") {
  const normalizedCommitteeRole = resolveCommitteeRole({ committeeRole });
  return {
    ...baseData,
    committeeRole: normalizedCommitteeRole,
    isLeader: normalizedCommitteeRole === "referente",
  };
}
