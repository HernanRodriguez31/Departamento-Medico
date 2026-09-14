const test = require("node:test");
const assert = require("node:assert/strict");

const { createHubHandlers, FEDERATED_UID_PREFIX, toSeconds } = require("../hub");

const codeOf = async (fn) => {
  try {
    await fn();
  } catch (error) {
    return error.code;
  }
  return "";
};

const createFakeDeps = ({ controls = {}, users = {}, verify } = {}) => {
  const issued = [];
  const admin = {
    apps: [],
    auth() {
      return {
        async getUser(uid) {
          const user = users[uid];
          if (!user) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
          return user;
        },
        async createCustomToken(uid, claims) {
          issued.push({ uid, claims });
          return `custom-token-for-${uid}`;
        },
      };
    },
  };
  const db = {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              const data = name === "dm_session_controls" ? controls[id] : undefined;
              return { exists: Boolean(data), data: () => data || {} };
            },
          };
        },
      };
    },
  };
  const handlers = createHubHandlers({ admin, db, verifyNursingToken: verify });
  return { handlers, issued };
};

test("hubHandoff emite un token de traspaso para el usuario autenticado", async () => {
  const { handlers, issued } = createFakeDeps({
    users: { "user-a": { uid: "user-a", disabled: false } },
  });
  const result = await handlers.hubHandoff({ auth: { uid: "user-a", token: { auth_time: 1000 } } });
  assert.equal(result.token, "custom-token-for-user-a");
  assert.equal(result.expiresInSeconds, 3600);
  assert.deepEqual(issued, [{ uid: "user-a", claims: { hubHandoff: true } }]);
});

test("hubHandoff exige sesión", async () => {
  const { handlers } = createFakeDeps();
  assert.equal(await codeOf(() => handlers.hubHandoff({ auth: null })), "unauthenticated");
});

test("hubHandoff rechaza identidades federadas (hubOnly)", async () => {
  const { handlers } = createFakeDeps({ users: { "enf_x": { uid: "enf_x" } } });
  const code = await codeOf(() => handlers.hubHandoff({ auth: { uid: "enf_x", token: { hubOnly: true } } }));
  assert.equal(code, "permission-denied");
});

test("hubHandoff rechaza cuentas deshabilitadas", async () => {
  const { handlers } = createFakeDeps({ users: { "user-a": { uid: "user-a", disabled: true } } });
  const code = await codeOf(() => handlers.hubHandoff({ auth: { uid: "user-a", token: { auth_time: 1000 } } }));
  assert.equal(code, "permission-denied");
});

test("hubHandoff respeta el cierre forzado posterior al inicio de sesión", async () => {
  const { handlers } = createFakeDeps({
    users: { "user-a": { uid: "user-a", disabled: false } },
    controls: { "user-a": { forcedLogoutAt: { seconds: 2000 } } },
  });
  const code = await codeOf(() => handlers.hubHandoff({ auth: { uid: "user-a", token: { auth_time: 1000 } } }));
  assert.equal(code, "unauthenticated");
  const ok = await handlers.hubHandoff({ auth: { uid: "user-a", token: { auth_time: 3000 } } });
  assert.equal(ok.token, "custom-token-for-user-a");
});

test("hubHandoff respeta sessionValidAfter", async () => {
  const { handlers } = createFakeDeps({
    users: { "user-a": { uid: "user-a", disabled: false } },
    controls: { "user-a": { sessionValidAfter: 5000 } },
  });
  const code = await codeOf(() => handlers.hubHandoff({ auth: { uid: "user-a", token: { auth_time: 4000 } } }));
  assert.equal(code, "unauthenticated");
});

test("hubExchange emite una identidad federada de Enfermería con claims acotados", async () => {
  const { handlers, issued } = createFakeDeps({
    verify: async (idToken) => {
      assert.equal(idToken, "nursing-id-token");
      return {
        uid: "nurse-1",
        aud: "departamento-enfermeria-brisa",
        email: "Nurse@Example.test",
        name: "Enf. Ejemplo",
        firebase: { sign_in_provider: "password" },
      };
    },
  });
  const result = await handlers.hubExchange({ data: { idToken: "nursing-id-token", dept: "enfermeria" } });
  assert.equal(result.uid, `${FEDERATED_UID_PREFIX}nurse-1`);
  assert.equal(result.token, `custom-token-for-${FEDERATED_UID_PREFIX}nurse-1`);
  assert.deepEqual(issued[0].claims, {
    hubOnly: true,
    hubDept: "enfermeria",
    hubEmail: "nurse@example.test",
    hubName: "Enf. Ejemplo",
    hubSourceUid: "nurse-1",
  });
});

test("hubExchange rechaza tokens inválidos, de otro proyecto o de proveedor custom", async () => {
  const invalid = createFakeDeps({ verify: async () => { throw new Error("bad"); } });
  assert.equal(await codeOf(() => invalid.handlers.hubExchange({ data: { idToken: "x" } })), "unauthenticated");

  const otherProject = createFakeDeps({ verify: async () => ({ uid: "u", aud: "otro-proyecto", firebase: { sign_in_provider: "password" } }) });
  assert.equal(await codeOf(() => otherProject.handlers.hubExchange({ data: { idToken: "x" } })), "unauthenticated");

  const custom = createFakeDeps({ verify: async () => ({ uid: "u", aud: "departamento-enfermeria-brisa", firebase: { sign_in_provider: "custom" } }) });
  assert.equal(await codeOf(() => custom.handlers.hubExchange({ data: { idToken: "x" } })), "permission-denied");

  const missing = createFakeDeps();
  assert.equal(await codeOf(() => missing.handlers.hubExchange({ data: {} })), "invalid-argument");
  assert.equal(await codeOf(() => missing.handlers.hubExchange({ data: { idToken: "x", dept: "medico" } })), "invalid-argument");
});

test("toSeconds normaliza Timestamp, milisegundos, segundos e ISO", () => {
  assert.equal(toSeconds({ seconds: 42 }), 42);
  assert.equal(toSeconds({ toMillis: () => 42000 }), 42);
  assert.equal(toSeconds(42), 42);
  assert.equal(toSeconds(1_700_000_000_000), 1_700_000_000);
  assert.equal(toSeconds("1970-01-01T00:01:00Z"), 60);
  assert.equal(toSeconds(null), 0);
});
