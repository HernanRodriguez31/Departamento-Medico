const COMMITTEE_ROLE_PRIORITY = Object.freeze({
  referente: 0,
  secretario: 1,
  vocal: 2,
});

const DEPARTMENT_ROLE_PRIORITY = Object.freeze({
  directora: 0,
  subdirector: 1,
  coordinador: 2,
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

export function resolveCommitteeRole(member = {}) {
  const role = String(member.committeeRole || "").trim().toLowerCase();
  if (role === "referente" || role === "secretario" || role === "vocal") {
    return role;
  }
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
  };
}

export function sortCommitteeMembers(members = []) {
  return [...members]
    .map((member) => decorateCommitteeMember(member))
    .sort((left, right) => {
      const committeePriority =
        (COMMITTEE_ROLE_PRIORITY[left.committeeRole] ?? COMMITTEE_ROLE_PRIORITY.vocal) -
        (COMMITTEE_ROLE_PRIORITY[right.committeeRole] ?? COMMITTEE_ROLE_PRIORITY.vocal);
      if (committeePriority !== 0) return committeePriority;

      const departmentPriority =
        (DEPARTMENT_ROLE_PRIORITY[left.departmentRole] ?? Number.MAX_SAFE_INTEGER) -
        (DEPARTMENT_ROLE_PRIORITY[right.departmentRole] ?? Number.MAX_SAFE_INTEGER);
      if (departmentPriority !== 0) return departmentPriority;

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
