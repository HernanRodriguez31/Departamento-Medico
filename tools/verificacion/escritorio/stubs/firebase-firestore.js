// Firestore en memoria para verificación del escritorio de proyecto (sin red).
// Implementa el subconjunto de la API modular usado por el frontend.
const store = new Map(); // path -> data
const listeners = new Set();
let idCounter = 0;

export class Timestamp {
  constructor(seconds, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static now() {
    const ms = Date.now();
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  static fromDate(date) {
    return new Timestamp(Math.floor(date.getTime() / 1000), (date.getTime() % 1000) * 1e6);
  }
  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  toDate() {
    return new Date(this.toMillis());
  }
}

const SERVER_TS = Symbol("serverTimestamp");
const DELETE = Symbol("deleteField");
export const serverTimestamp = () => SERVER_TS;
export const deleteField = () => DELETE;

const autoId = () => `auto-${(idCounter += 1).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

class DocumentReference {
  constructor(path) {
    this.path = path;
    this.type = "document";
  }
  get id() {
    return this.path.split("/").pop();
  }
  get parent() {
    return new CollectionReference(this.path.split("/").slice(0, -1).join("/"));
  }
}

class CollectionReference {
  constructor(path) {
    this.path = path;
    this.type = "collection";
  }
}

const joinPath = (segments) => segments.filter((s) => s !== undefined && s !== null && s !== "").join("/");

export const getFirestore = () => ({ type: "firestore-stub" });

export function collection(parent, ...segments) {
  const base = parent && parent.path ? parent.path : "";
  return new CollectionReference(joinPath([base, ...segments]));
}

export function doc(parent, ...segments) {
  if (parent instanceof CollectionReference) {
    return new DocumentReference(joinPath([parent.path, segments[0] || autoId()]));
  }
  const base = parent && parent.path ? parent.path : "";
  return new DocumentReference(joinPath([base, ...segments]));
}

const clone = (value) => {
  if (value === null || value === undefined) return value;
  if (value instanceof Timestamp) return new Timestamp(value.seconds, value.nanoseconds);
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
};

const materialize = (data) => {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === DELETE) continue;
    if (v === SERVER_TS) out[k] = Timestamp.now();
    else if (v instanceof Date) out[k] = Timestamp.fromDate(v);
    else out[k] = clone(v);
  }
  return out;
};

const snapshotOf = (ref) => {
  const data = store.get(ref.path);
  return {
    id: ref.id,
    ref,
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : clone(data))
  };
};

const notify = () => {
  listeners.forEach((entry) => {
    try {
      if (entry.type === "doc") entry.cb(snapshotOf(entry.ref));
      else entry.cb(runQuery(entry.query));
    } catch (error) {
      console.error("[firestore-stub] listener error", error);
    }
  });
};

export async function getDoc(ref) {
  return snapshotOf(ref);
}

export async function setDoc(ref, data, options = {}) {
  const current = store.get(ref.path);
  const next = options.merge && current ? { ...current, ...materialize(data) } : materialize(data);
  store.set(ref.path, next);
  notify();
}

export async function updateDoc(ref, patch) {
  const current = store.get(ref.path);
  if (current === undefined) {
    const error = new Error(`No document to update: ${ref.path}`);
    error.code = "not-found";
    throw error;
  }
  const next = { ...current };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === DELETE) delete next[k];
    else if (v === SERVER_TS) next[k] = Timestamp.now();
    else if (v instanceof Date) next[k] = Timestamp.fromDate(v);
    else next[k] = clone(v);
  }
  store.set(ref.path, next);
  notify();
}

export async function addDoc(coll, data) {
  const ref = doc(coll);
  store.set(ref.path, materialize(data));
  notify();
  return ref;
}

export async function deleteDoc(ref) {
  store.delete(ref.path);
  notify();
}

class Query {
  constructor(coll, constraints = []) {
    this.coll = coll;
    this.constraints = constraints;
    this.type = "query";
  }
}

export const query = (coll, ...constraints) => new Query(coll instanceof Query ? coll.coll : coll, [...(coll instanceof Query ? coll.constraints : []), ...constraints]);
export const where = (field, op, value) => ({ kind: "where", field, op, value });
export const orderBy = (field, direction = "asc") => ({ kind: "orderBy", field, direction });
export const limit = (n) => ({ kind: "limit", n });

const valueOf = (v) => (v instanceof Timestamp ? v.toMillis() : v);

const matches = (data, c) => {
  const actual = data[c.field];
  switch (c.op) {
    case "==":
      return actual === c.value;
    case "!=":
      return actual !== c.value;
    case "<":
      return valueOf(actual) < valueOf(c.value);
    case "<=":
      return valueOf(actual) <= valueOf(c.value);
    case ">":
      return valueOf(actual) > valueOf(c.value);
    case ">=":
      return valueOf(actual) >= valueOf(c.value);
    case "in":
      return Array.isArray(c.value) && c.value.includes(actual);
    case "array-contains":
      return Array.isArray(actual) && actual.includes(c.value);
    default:
      return true;
  }
};

function runQuery(q) {
  const coll = q instanceof Query ? q.coll : q;
  const constraints = q instanceof Query ? q.constraints : [];
  const depth = coll.path.split("/").length + 1;
  let docs = [];
  for (const [path, data] of store.entries()) {
    if (path.startsWith(`${coll.path}/`) && path.split("/").length === depth) {
      docs.push({ ref: new DocumentReference(path), data });
    }
  }
  constraints.filter((c) => c.kind === "where").forEach((c) => {
    docs = docs.filter((entry) => matches(entry.data, c));
  });
  constraints.filter((c) => c.kind === "orderBy").forEach((c) => {
    docs.sort((a, b) => {
      const av = valueOf(a.data[c.field]);
      const bv = valueOf(b.data[c.field]);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return c.direction === "desc" ? -cmp : cmp;
    });
  });
  const lim = constraints.find((c) => c.kind === "limit");
  if (lim) docs = docs.slice(0, lim.n);
  const snaps = docs.map((entry) => snapshotOf(entry.ref));
  return { docs: snaps, size: snaps.length, empty: snaps.length === 0, forEach: (fn) => snaps.forEach(fn) };
}

export async function getDocs(q) {
  return runQuery(q);
}

export function onSnapshot(target, onNext, onError) {
  const entry = target instanceof DocumentReference ? { type: "doc", ref: target, cb: onNext } : { type: "query", query: target, cb: onNext };
  listeners.add(entry);
  setTimeout(() => {
    try {
      if (entry.type === "doc") onNext(snapshotOf(entry.ref));
      else onNext(runQuery(entry.query));
    } catch (error) {
      onError?.(error);
    }
  }, 0);
  return () => listeners.delete(entry);
}

export function writeBatch() {
  const ops = [];
  return {
    set: (ref, data, options) => ops.push(() => setDoc(ref, data, options)),
    update: (ref, patch) => ops.push(() => updateDoc(ref, patch)),
    delete: (ref) => ops.push(() => deleteDoc(ref)),
    commit: async () => {
      for (const op of ops) await op();
    }
  };
}

export const increment = (n) => n;
export const arrayUnion = (...items) => items;
export const arrayRemove = () => [];

// Semilla inicial (window.__PD_SEED__ = [{ path, data }]) y utilidades de prueba.
if (typeof window !== "undefined") {
  (window.__PD_SEED__ || []).forEach((entry) => store.set(entry.path, materialize(entry.data)));
  window.__PD_STORE__ = {
    dump: () => Object.fromEntries(Array.from(store.entries()).map(([k, v]) => [k, clone(v)])),
    get: (path) => clone(store.get(path)),
    set: (path, data) => {
      store.set(path, materialize(data));
      notify();
    },
    listeners: () => listeners.size
  };
}
