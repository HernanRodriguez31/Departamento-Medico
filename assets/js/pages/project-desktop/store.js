// Capa de datos del escritorio de proyecto (Firestore).
//
// Todo lo propio del escritorio vive en subcolecciones del documento del proyecto:
//   artifacts/{appId}/public/data/committee_topics/{topicId}/
//     desktop_meta/config       configuración del escritorio (fondo, objetivo, equipo)
//     desktop_items/{id}        carpetas y enlaces (archivos M365, Drive, web)
//     desktop_tasks/{id}        tareas (tablero pendiente / en curso / hecha)
//     desktop_notes/{id}        actas de reunión, notas e informes internos
//     desktop_activity/{id}     registro de actividad (solo creación)
// Se integra con colecciones existentes del portal:
//   calendar_events (eventos con projectId → aparecen también en el calendario del comité)
//   committee_notes (pizarra de comunicaciones, scope "project")
//   committee_members (integrantes del comité)
//   committee_meta (título editable del comité)
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { text, todayKey } from "./ui.js";

export const DESKTOP_SCHEMA_VERSION = 1;

export const DEFAULT_FOLDERS = Object.freeze([
  { id: "seed-documentos", name: "Documentos", order: 1 },
  { id: "seed-presentaciones", name: "Presentaciones", order: 2 },
  { id: "seed-planillas", name: "Planillas", order: 3 },
  { id: "seed-actas", name: "Actas y minutas", order: 4 },
  { id: "seed-bibliografia", name: "Bibliografía y evidencia", order: 5 }
]);

export const WALLPAPERS = Object.freeze([
  { key: "brisa", label: "Brisa (predeterminado)" },
  { key: "aurora", label: "Aurora verde" },
  { key: "cielo", label: "Cielo" },
  { key: "grafito", label: "Grafito suave" },
  { key: "abstracto", label: "Abstracto (imagen)" },
  { key: "adn", label: "ADN (imagen)" }
]);

const compactTimestamp = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export function createDesktopStore({ db, auth, appId, committeeId, topicId, getActor }) {
  const dataPath = ["artifacts", appId, "public", "data"];
  const topicRef = doc(db, ...dataPath, "committee_topics", topicId);
  const sub = (name) => collection(db, ...dataPath, "committee_topics", topicId, name);
  const subDoc = (name, id) => doc(db, ...dataPath, "committee_topics", topicId, name, id);
  const configRef = subDoc("desktop_meta", "config");

  const actor = () => {
    const user = auth?.currentUser;
    const meta = typeof getActor === "function" ? getActor() : {};
    return {
      uid: user?.uid || "",
      name: text(meta?.displayName || user?.displayName || user?.email || "Usuario").slice(0, 160)
    };
  };

  const stampCreate = () => {
    const who = actor();
    return {
      createdByUid: who.uid,
      createdByName: who.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUid: who.uid,
      updatedByName: who.name
    };
  };

  const stampUpdate = () => {
    const who = actor();
    return { updatedAt: serverTimestamp(), updatedByUid: who.uid, updatedByName: who.name };
  };

  const listen = (ref, mapSnap, onChange, onError, label) =>
    onSnapshot(
      ref,
      (snap) => onChange(mapSnap(snap)),
      (error) => {
        console.error(`[Escritorio] Error en suscripción ${label}:`, error);
        onError?.(error, label);
      }
    );

  const docsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // -------------------------------------------------------------------------
  // Suscripciones
  // -------------------------------------------------------------------------
  const subscribeTopic = (onChange, onError) =>
    listen(topicRef, (snap) => (snap.exists() ? { id: snap.id, ...snap.data() } : null), onChange, onError, "proyecto");

  const subscribeConfig = (onChange, onError) =>
    listen(configRef, (snap) => (snap.exists() ? { id: snap.id, ...snap.data() } : null), onChange, onError, "configuración");

  const subscribeItems = (onChange, onError) =>
    listen(sub("desktop_items"), docsOf, onChange, onError, "archivos");

  const subscribeTasks = (onChange, onError) =>
    listen(sub("desktop_tasks"), docsOf, onChange, onError, "tareas");

  const subscribeNotes = (onChange, onError) =>
    listen(sub("desktop_notes"), docsOf, onChange, onError, "actas y notas");

  const subscribeActivity = (onChange, onError) =>
    listen(query(sub("desktop_activity"), orderBy("createdAt", "desc"), limit(80)), docsOf, onChange, onError, "actividad");

  const subscribeEvents = (onChange, onError) =>
    listen(
      query(collection(db, ...dataPath, "calendar_events"), where("projectId", "==", topicId)),
      docsOf,
      onChange,
      onError,
      "calendario"
    );

  const subscribeBoardNotes = (onChange, onError) =>
    listen(
      query(collection(db, ...dataPath, "committee_notes"), where("projectId", "==", topicId)),
      docsOf,
      onChange,
      onError,
      "pizarra"
    );

  const subscribeMembers = (onChange, onError) =>
    listen(
      query(collection(db, ...dataPath, "committee_members"), where("committeeId", "==", committeeId)),
      docsOf,
      onChange,
      onError,
      "integrantes"
    );

  const readCommitteeMeta = async () => {
    try {
      const snap = await getDoc(doc(db, ...dataPath, "committee_meta", committeeId));
      return snap.exists() ? snap.data() : null;
    } catch (error) {
      console.warn("[Escritorio] No se pudo leer committee_meta:", error);
      return null;
    }
  };

  // -------------------------------------------------------------------------
  // Aprovisionamiento automático (circuito para proyectos nuevos)
  // -------------------------------------------------------------------------
  const ensureProvisioned = async () => {
    const snap = await getDoc(configRef);
    if (snap.exists()) return false;
    const who = actor();
    const batch = writeBatch(db);
    batch.set(configRef, {
      committeeId,
      schemaVersion: DESKTOP_SCHEMA_VERSION,
      description: "",
      wallpaper: "brisa",
      team: [],
      seeded: true,
      ...stampCreate()
    });
    DEFAULT_FOLDERS.forEach((folder) => {
      batch.set(subDoc("desktop_items", folder.id), {
        type: "folder",
        name: folder.name,
        parentId: "",
        url: "",
        kind: "folder",
        note: "",
        pinned: false,
        archived: false,
        order: folder.order,
        ...stampCreate()
      });
    });
    batch.set(doc(sub("desktop_activity")), {
      action: "provisioned",
      entity: "desktop",
      label: "Escritorio del proyecto creado",
      authorUid: who.uid,
      authorName: who.name,
      createdAt: serverTimestamp()
    });
    await batch.commit();
    return true;
  };

  // -------------------------------------------------------------------------
  // Actividad
  // -------------------------------------------------------------------------
  const logActivity = async (action, entity, label) => {
    const who = actor();
    try {
      await addDoc(sub("desktop_activity"), {
        action: text(action).slice(0, 40),
        entity: text(entity).slice(0, 30),
        label: text(label).slice(0, 300),
        authorUid: who.uid,
        authorName: who.name,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      console.warn("[Escritorio] No se pudo registrar actividad:", error);
    }
  };

  // -------------------------------------------------------------------------
  // Proyecto y configuración
  // -------------------------------------------------------------------------
  const updateTopic = (patch) => updateDoc(topicRef, patch);

  const updateConfig = async (patch) => {
    try {
      await updateDoc(configRef, { ...patch, ...stampUpdate() });
    } catch (error) {
      if (error?.code === "not-found") {
        await ensureProvisioned();
        await updateDoc(configRef, { ...patch, ...stampUpdate() });
        return;
      }
      throw error;
    }
  };

  // -------------------------------------------------------------------------
  // Archivos y carpetas
  // -------------------------------------------------------------------------
  const addItem = async (data) => {
    const payload = {
      type: data.type === "folder" ? "folder" : "link",
      name: text(data.name).trim().slice(0, 200),
      parentId: text(data.parentId).slice(0, 128),
      url: data.type === "folder" ? "" : text(data.url).trim().slice(0, 2000),
      kind: text(data.kind || (data.type === "folder" ? "folder" : "web")).slice(0, 40),
      note: text(data.note).trim().slice(0, 1000),
      pinned: Boolean(data.pinned),
      archived: false,
      order: Number.isFinite(data.order) ? data.order : Date.now(),
      ...stampCreate()
    };
    const ref = await addDoc(sub("desktop_items"), payload);
    logActivity("created", payload.type === "folder" ? "folder" : "item", payload.name);
    return ref.id;
  };

  const updateItem = async (id, patch, { silent = false, label = "" } = {}) => {
    await updateDoc(subDoc("desktop_items", id), { ...patch, ...stampUpdate() });
    if (!silent) logActivity("updated", "item", label);
  };

  const deleteItem = async (id, label = "") => {
    await deleteDoc(subDoc("desktop_items", id));
    logActivity("deleted", "item", label);
  };

  // -------------------------------------------------------------------------
  // Tareas
  // -------------------------------------------------------------------------
  const addTask = async (data) => {
    const payload = {
      title: text(data.title).trim().slice(0, 300),
      details: text(data.details).trim().slice(0, 2000),
      status: ["todo", "doing", "done"].includes(data.status) ? data.status : "todo",
      priority: ["alta", "media", "baja"].includes(data.priority) ? data.priority : "media",
      assignee: text(data.assignee).trim().slice(0, 120),
      assigneeUid: text(data.assigneeUid).slice(0, 128),
      dueDate: text(data.dueDate).slice(0, 10),
      order: Number.isFinite(data.order) ? data.order : Date.now(),
      doneAt: null,
      archived: false,
      ...stampCreate()
    };
    const ref = await addDoc(sub("desktop_tasks"), payload);
    logActivity("created", "task", payload.title);
    return ref.id;
  };

  const updateTask = async (id, patch, { silent = false, label = "", action = "updated" } = {}) => {
    await updateDoc(subDoc("desktop_tasks", id), { ...patch, ...stampUpdate() });
    if (!silent) logActivity(action, "task", label);
  };

  const deleteTask = async (id, label = "") => {
    await deleteDoc(subDoc("desktop_tasks", id));
    logActivity("deleted", "task", label);
  };

  // -------------------------------------------------------------------------
  // Actas y notas
  // -------------------------------------------------------------------------
  const addNote = async (data) => {
    const payload = {
      kind: ["acta", "nota", "informe"].includes(data.kind) ? data.kind : "nota",
      title: text(data.title).trim().slice(0, 200),
      body: text(data.body).slice(0, 20000),
      meetingDate: text(data.meetingDate).slice(0, 10),
      pinned: Boolean(data.pinned),
      archived: false,
      ...stampCreate()
    };
    const ref = await addDoc(sub("desktop_notes"), payload);
    logActivity("created", "note", payload.title);
    return ref.id;
  };

  const updateNote = async (id, patch, { silent = false, label = "" } = {}) => {
    await updateDoc(subDoc("desktop_notes", id), { ...patch, ...stampUpdate() });
    if (!silent) logActivity("updated", "note", label);
  };

  const deleteNote = async (id, label = "") => {
    await deleteDoc(subDoc("desktop_notes", id));
    logActivity("deleted", "note", label);
  };

  // -------------------------------------------------------------------------
  // Calendario (colección compartida calendar_events)
  // -------------------------------------------------------------------------
  const eventsRef = () => collection(db, ...dataPath, "calendar_events");

  const buildEventPayload = (data, projectTitle, committeeName) => {
    const startDateKey = text(data.dateKey).slice(0, 10);
    const endDateKey = text(data.endDateKey || startDateKey).slice(0, 10);
    const allDay = Boolean(data.allDay) || endDateKey > startDateKey;
    const payload = {
      title: text(data.title).trim().slice(0, 200),
      note: text(data.note).trim().slice(0, 2000),
      dateKey: startDateKey,
      startDateKey,
      endDateKey: endDateKey >= startDateKey ? endDateKey : startDateKey,
      allDay,
      colorKey: text(data.colorKey || "green"),
      eventKind: ["reunion", "hito", "plazo", "recordatorio"].includes(data.eventKind) ? data.eventKind : "reunion",
      link: text(data.link).trim().slice(0, 2000)
    };
    if (!allDay && Number.isInteger(data.startMinutes)) payload.startMinutes = data.startMinutes;
    if (!allDay && Number.isInteger(data.endMinutes)) payload.endMinutes = data.endMinutes;
    return { payload, scope: { calendarScope: "committee", committeeId, committeeName: text(committeeName).slice(0, 200), projectId: topicId, projectTitle: text(projectTitle).slice(0, 300) } };
  };

  const addEvent = async (data, { projectTitle, committeeName }) => {
    const who = actor();
    const { payload, scope } = buildEventPayload(data, projectTitle, committeeName);
    const ref = await addDoc(eventsRef(), {
      ...payload,
      ...scope,
      createdByUid: who.uid,
      createdByName: who.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    logActivity("created", "event", payload.title);
    return ref.id;
  };

  const updateEvent = async (id, data, { projectTitle, committeeName }) => {
    const { payload } = buildEventPayload(data, projectTitle, committeeName);
    const patch = { ...payload, updatedAt: serverTimestamp() };
    // Los minutos se eliminan cuando el evento pasa a ser de todo el día.
    if (!("startMinutes" in payload)) patch.startMinutes = null;
    if (!("endMinutes" in payload)) patch.endMinutes = null;
    await updateDoc(doc(eventsRef(), id), patch);
    logActivity("updated", "event", payload.title);
  };

  const deleteEvent = async (id, label = "") => {
    await deleteDoc(doc(eventsRef(), id));
    logActivity("deleted", "event", label);
  };

  // Próxima reunión de la tarjeta = primera reunión futura del calendario del proyecto.
  const syncNextMeeting = async (events, currentTopic) => {
    const today = todayKey();
    const next = (events || [])
      .filter((event) => event.eventKind === "reunion" && text(event.dateKey) >= today)
      .map((event) => text(event.dateKey))
      .sort()[0] || "";
    if (!currentTopic) return null;
    const current = text(currentTopic.nextMeeting);
    if (next && next !== current) {
      await updateTopic({ nextMeeting: next });
      return next;
    }
    if (!next && current && current >= today && !(events || []).some((event) => text(event.dateKey) === current)) {
      // Se borró la reunión que respaldaba la fecha de la tarjeta.
      await updateTopic({ nextMeeting: "" });
      return "";
    }
    return null;
  };

  // -------------------------------------------------------------------------
  // Pizarra (committee_notes, scope project)
  // -------------------------------------------------------------------------
  const addBoardNote = async (body, projectTitle) => {
    const who = actor();
    const payload = {
      committeeId,
      scope: "project",
      projectId: topicId,
      projectTitle: text(projectTitle).slice(0, 300),
      text: text(body).trim().slice(0, 4000),
      authorUid: who.uid,
      authorName: who.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      likedBy: {}
    };
    const ref = await addDoc(collection(db, ...dataPath, "committee_notes"), payload);
    logActivity("created", "board", payload.text.slice(0, 120));
    return ref.id;
  };

  const deleteBoardNote = async (id) => {
    await deleteDoc(doc(db, ...dataPath, "committee_notes", id));
  };

  return {
    refs: { topicRef, configRef },
    subscribeTopic,
    subscribeConfig,
    subscribeItems,
    subscribeTasks,
    subscribeNotes,
    subscribeActivity,
    subscribeEvents,
    subscribeBoardNotes,
    subscribeMembers,
    readCommitteeMeta,
    ensureProvisioned,
    logActivity,
    updateTopic,
    updateConfig,
    addItem,
    updateItem,
    deleteItem,
    addTask,
    updateTask,
    deleteTask,
    addNote,
    updateNote,
    deleteNote,
    addEvent,
    updateEvent,
    deleteEvent,
    syncNextMeeting,
    addBoardNote,
    deleteBoardNote,
    actor,
    compactTimestamp
  };
}

export const sortByCreated = (list, direction = "desc") =>
  [...list].sort((a, b) => {
    const diff = compactTimestamp(a.createdAt) - compactTimestamp(b.createdAt);
    return direction === "desc" ? -diff : diff;
  });

export { compactTimestamp };
