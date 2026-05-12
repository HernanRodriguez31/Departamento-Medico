const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createUserSecurityHandlers,
  generateStrongTemporaryPassword,
  maskEmail,
  sanitizeAuditMetadata,
  validateEmail,
  validateUsername,
} = require("../admin/userSecurity");

const makeHttpsErrorCode = async (fn) => {
  try {
    await fn();
  } catch (error) {
    return error.code;
  }
  return "";
};

const fakeTimestamp = () => "SERVER_TIMESTAMP";
const fakeDelete = () => "DELETE_FIELD";

const createFakeDeps = () => {
  const writes = [];
  const authUpdates = [];
  const users = {
    "target-a": {
      uid: "target-a",
      email: "target.a@example.test",
      displayName: "Target A",
      disabled: false,
      providerData: [{ providerId: "password" }],
      customClaims: {},
    },
    "super-target": {
      uid: "super-target",
      email: "super.target@example.test",
      displayName: "Super Target",
      disabled: false,
      providerData: [{ providerId: "password" }],
      customClaims: { superAdmin: true },
    },
  };

  const docs = new Map([
    ["dm_session_controls/target-a", { forcePasswordChange: true }],
    ["usuarios/target-a", { email: "target.old@example.test", role: "user" }],
  ]);

  const docRef = (collectionName, id) => ({
    async get() {
      const key = `${collectionName}/${id}`;
      const data = docs.get(key);
      return {
        exists: Boolean(data),
        data: () => data || {},
      };
    },
    async set(data) {
      writes.push({ collectionName, id, data });
      docs.set(`${collectionName}/${id}`, {
        ...(docs.get(`${collectionName}/${id}`) || {}),
        ...data,
      });
    },
  });

  const db = {
    collection(collectionName) {
      return {
        doc(id) {
          return docRef(collectionName, id);
        },
        async add(data) {
          writes.push({ collectionName, id: "auto", data });
        },
      };
    },
    async runTransaction(fn) {
      return fn({
        get: (ref) => ref.get(),
        set: (ref, data) => ref.set(data),
        delete: async () => {},
      });
    },
  };

  const admin = {
    firestore: {
      FieldValue: {
        serverTimestamp: fakeTimestamp,
        delete: fakeDelete,
      },
    },
    auth() {
      return {
        async getUser(uid) {
          const user = users[uid];
          if (!user) {
            const error = new Error("not found");
            error.code = "auth/user-not-found";
            throw error;
          }
          return user;
        },
        async getUserByEmail(email) {
          const found = Object.values(users).find((user) => user.email === email);
          if (!found) {
            const error = new Error("not found");
            error.code = "auth/user-not-found";
            throw error;
          }
          return found;
        },
        async updateUser(uid, patch) {
          authUpdates.push({ uid, patch });
          users[uid] = { ...users[uid], ...patch };
        },
        async revokeRefreshTokens(uid) {
          authUpdates.push({ uid, revokeRefreshTokens: true });
        },
        async generatePasswordResetLink(email) {
          return `https://example.test/reset?email=${encodeURIComponent(email)}`;
        },
      };
    },
  };

  return { admin, db, writes, authUpdates, users, docs };
};

test("username validation normalizes and rejects invalid or reserved values", () => {
  assert.deepEqual(validateUsername(" Usuario.Ok "), {
    ok: true,
    username: "usuario.ok",
  });
  assert.equal(validateUsername("ab").reason, "invalid_username");
  assert.equal(validateUsername("superadmin").reason, "reserved_username");
});

test("maskEmail hides the local part", () => {
  assert.equal(maskEmail("HRodriguez@pan-energy.com"), "hr******@pan-energy.com");
});

test("validateEmail normalizes and rejects invalid values", () => {
  assert.equal(validateEmail(" User.Name@Example.Test "), "user.name@example.test");
  let code = "";
  try {
    validateEmail("bad-email");
  } catch (error) {
    code = error.code;
  }
  assert.equal(code, "invalid-argument");
});

test("temporary password has required character classes", () => {
  const password = generateStrongTemporaryPassword();
  assert.ok(password.length >= 16);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /[0-9]/);
  assert.match(password, /[!@#$%*\-_=+?]/);
});

test("audit metadata sanitizer removes secret-like keys", () => {
  assert.deepEqual(
    sanitizeAuditMetadata({
      method: "temporary_password",
      forcePasswordChange: true,
      temporaryPassword: "NeverStoreMe1!",
      resetLink: "https://example.test",
    }),
    {
      method: "temporary_password",
      forcePasswordChange: true,
    }
  );
});

test("updateMyProfile rejects unauthenticated and invalid display name", async () => {
  const handlers = createUserSecurityHandlers(createFakeDeps());
  assert.equal(
    await makeHttpsErrorCode(() => handlers.updateMyProfile({ data: { displayName: "Dr. A" } })),
    "unauthenticated"
  );
  assert.equal(
    await makeHttpsErrorCode(() =>
      handlers.updateMyProfile({
        auth: { uid: "user-a", token: {} },
        data: { displayName: "A" },
      })
    ),
    "invalid-argument"
  );
});

test("adminResolveUser rejects common users", async () => {
  const handlers = createUserSecurityHandlers(createFakeDeps());
  assert.equal(
    await makeHttpsErrorCode(() =>
      handlers.adminResolveUser({
        auth: { uid: "user-a", token: {} },
        data: { query: "target-a" },
      })
    ),
    "permission-denied"
  );
});

test("adminIssueTemporaryPassword enforces superAdmin and confirmation", async () => {
  const handlers = createUserSecurityHandlers(createFakeDeps());
  assert.equal(
    await makeHttpsErrorCode(() =>
      handlers.adminIssueTemporaryPassword({
        auth: { uid: "admin-a", token: { admin: true } },
        data: { uid: "target-a", confirmation: "RESTABLECER" },
      })
    ),
    "permission-denied"
  );
  assert.equal(
    await makeHttpsErrorCode(() =>
      handlers.adminIssueTemporaryPassword({
        auth: { uid: "super-a", token: { superAdmin: true } },
        data: { uid: "target-a", confirmation: "NO" },
      })
    ),
    "failed-precondition"
  );
});

test("adminIssueTemporaryPassword blocks self reset and target superAdmin", async () => {
  const handlers = createUserSecurityHandlers(createFakeDeps());
  assert.equal(
    await makeHttpsErrorCode(() =>
      handlers.adminIssueTemporaryPassword({
        auth: { uid: "target-a", token: { superAdmin: true } },
        data: { uid: "target-a", confirmation: "RESTABLECER" },
      })
    ),
    "permission-denied"
  );
  assert.equal(
    await makeHttpsErrorCode(() =>
      handlers.adminIssueTemporaryPassword({
        auth: { uid: "super-a", token: { superAdmin: true } },
        data: { uid: "super-target", confirmation: "RESTABLECER" },
      })
    ),
    "permission-denied"
  );
});

test("adminIssueTemporaryPassword marks force change and does not audit password", async () => {
  const deps = createFakeDeps();
  const handlers = createUserSecurityHandlers(deps);
  const result = await handlers.adminIssueTemporaryPassword({
    auth: { uid: "super-a", token: { superAdmin: true } },
    data: { uid: "target-a", confirmation: "RESTABLECER" },
  });

  assert.ok(result.temporaryPassword);
  assert.equal(result.forcePasswordChange, true);
  assert.equal(
    deps.writes.some(
      (write) =>
        write.collectionName === "dm_session_controls" &&
        write.id === "target-a" &&
        write.data.forcePasswordChange === true
    ),
    true
  );
  const auditWrites = deps.writes.filter((write) => write.collectionName === "securityAuditLogs");
  assert.equal(auditWrites.length, 1);
  assert.equal(JSON.stringify(auditWrites).includes(result.temporaryPassword), false);
});

test("completeForcedPasswordChange clears active flag", async () => {
  const deps = createFakeDeps();
  const handlers = createUserSecurityHandlers(deps);
  const result = await handlers.completeForcedPasswordChange({
    auth: { uid: "target-a", token: {} },
    data: {},
  });
  assert.equal(result.forcePasswordChange, false);
  assert.equal(
    deps.writes.some(
      (write) =>
        write.collectionName === "dm_session_controls" &&
        write.id === "target-a" &&
        write.data.forcePasswordChange === false
    ),
    true
  );
});

test("recordEmailChangeRequested requires auth and audits masked email only", async () => {
  const deps = createFakeDeps();
  const handlers = createUserSecurityHandlers(deps);
  assert.equal(
    await makeHttpsErrorCode(() =>
      handlers.recordEmailChangeRequested({ data: { newEmail: "next@example.test" } })
    ),
    "unauthenticated"
  );

  const result = await handlers.recordEmailChangeRequested({
    auth: { uid: "target-a", token: {} },
    data: { newEmail: "Next.Email@example.test" },
  });

  assert.equal(result.newEmailMasked, "ne******@example.test");
  const audit = deps.writes.find((write) => write.collectionName === "securityAuditLogs");
  assert.equal(audit.data.eventType, "email_change_requested");
  assert.equal(JSON.stringify(audit).includes("Next.Email@example.test"), false);
  assert.equal(JSON.stringify(audit).includes("next.email@example.test"), false);
  assert.equal(JSON.stringify(audit).includes("ne******@example.test"), true);
});

test("syncMyAuthEmail updates only email fields and audits masked change", async () => {
  const deps = createFakeDeps();
  deps.users["target-a"].email = "target.new@example.test";
  const handlers = createUserSecurityHandlers(deps);
  const result = await handlers.syncMyAuthEmail({
    auth: { uid: "target-a", token: {} },
    data: {},
  });

  assert.equal(result.updated, true);
  const profileWrite = deps.writes.find(
    (write) => write.collectionName === "usuarios" && write.id === "target-a"
  );
  assert.equal(profileWrite.data.email, "target.new@example.test");
  assert.equal(Object.prototype.hasOwnProperty.call(profileWrite.data, "role"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(profileWrite.data, "security"), false);

  const audit = deps.writes.find(
    (write) =>
      write.collectionName === "securityAuditLogs" &&
      write.data.eventType === "email_changed_by_user"
  );
  assert.equal(Boolean(audit), true);
  assert.equal(JSON.stringify(audit).includes("target.new@example.test"), false);
  assert.equal(JSON.stringify(audit).includes("ta******@example.test"), true);
});
