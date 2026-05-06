import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const USERS_COLLECTION = "usuarios";
const CALENDAR_COLLECTION = "calendar_events";
const DATE_KEY_PATTERN = /^(2026|2027)-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const CALENDAR_SCOPE_HOME = "home";
const CALENDAR_SCOPE_COMMITTEE = "committee";

export const COMMITTEE_CALENDAR_LABELS = Object.freeze({
  comite_ejecutivo_emergencias: "Comité Ejecutivo de Emergencias",
  comite_salud_ocupacional: "Comité de Salud Ocupacional",
  comite_calidad_seguridad: "Comité de Calidad y Seguridad",
  comite_salud_digital: "Comité de Salud Digital e Innovación",
  comite_docencia_investigacion: "Comité de Docencia e Investigación",
  comite_farmacia_terapeutica: "Comité de Farmacia y Terapéutica",
  comite_bioetica: "Comité de Bioética",
});

export const CALENDAR_COLOR_KEYS = Object.freeze([
  "green",
  "blue",
  "amber",
  "red",
  "violet",
  "slate",
]);

export const DEFAULT_CALENDAR_COLOR_KEY = "green";

const resolveUserValue = (obj, keys, fallback = "") => {
  for (const key of keys) {
    if (obj && obj[key]) return obj[key];
  }
  return fallback;
};

const normalizeMinutes = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const isValidCalendarDateKey = (value) => DATE_KEY_PATTERN.test(String(value || ""));

const normalizeColorKey = (value) =>
  CALENDAR_COLOR_KEYS.includes(String(value || ""))
    ? String(value)
    : DEFAULT_CALENDAR_COLOR_KEY;

const normalizeCalendarContext = (context = {}) => {
  const requestedScope = String(context?.scope || CALENDAR_SCOPE_HOME);
  const committeeId = String(context?.committeeId || "");
  if (
    requestedScope === CALENDAR_SCOPE_COMMITTEE &&
    Object.prototype.hasOwnProperty.call(COMMITTEE_CALENDAR_LABELS, committeeId)
  ) {
    return {
      scope: CALENDAR_SCOPE_COMMITTEE,
      committeeId,
      committeeName: String(context?.committeeName || COMMITTEE_CALENDAR_LABELS[committeeId]).trim() ||
        COMMITTEE_CALENDAR_LABELS[committeeId],
    };
  }
  return { scope: CALENDAR_SCOPE_HOME };
};

const buildOriginCreatePayload = (calendarContext) => {
  if (calendarContext.scope === CALENDAR_SCOPE_COMMITTEE) {
    return {
      calendarScope: CALENDAR_SCOPE_COMMITTEE,
      committeeId: calendarContext.committeeId,
      committeeName: calendarContext.committeeName,
    };
  }
  return {
    calendarScope: CALENDAR_SCOPE_HOME,
  };
};

const normalizeDateWindow = (input) => {
  const fallbackDateKey = String(input?.startDateKey || input?.dateKey || "");
  const startDateKey = isValidCalendarDateKey(fallbackDateKey) ? fallbackDateKey : "";
  const requestedEndDateKey = String(input?.endDateKey || startDateKey || "");
  const endDateKey =
    isValidCalendarDateKey(requestedEndDateKey) && requestedEndDateKey >= startDateKey
      ? requestedEndDateKey
      : startDateKey;

  return {
    dateKey: startDateKey,
    startDateKey,
    endDateKey,
  };
};

const normalizeBasePayload = (input) => {
  const title = String(input?.title || "").trim();
  const note = String(input?.note || "").trim();
  const dateWindow = normalizeDateWindow(input);
  const isMultiDay =
    Boolean(dateWindow.startDateKey) && dateWindow.endDateKey > dateWindow.startDateKey;
  const allDay = isMultiDay ? true : Boolean(input?.allDay);
  const startMinutes = allDay ? null : normalizeMinutes(input?.startMinutes);
  const endMinutes = allDay ? null : normalizeMinutes(input?.endMinutes);
  const colorKey = normalizeColorKey(input?.colorKey);

  return {
    title,
    note,
    ...dateWindow,
    allDay,
    startMinutes,
    endMinutes,
    colorKey,
  };
};

const buildCreatePayload = (input) => {
  const payload = normalizeBasePayload(input);
  const data = {
    title: payload.title,
    note: payload.note,
    dateKey: payload.dateKey,
    startDateKey: payload.startDateKey,
    endDateKey: payload.endDateKey,
    allDay: payload.allDay,
    colorKey: payload.colorKey,
  };

  if (!payload.allDay && payload.startMinutes !== null) {
    data.startMinutes = payload.startMinutes;
  }
  if (!payload.allDay && payload.endMinutes !== null) {
    data.endMinutes = payload.endMinutes;
  }

  return data;
};

const buildUpdatePayload = (input) => {
  const payload = normalizeBasePayload(input);

  return {
    title: payload.title,
    note: payload.note,
    dateKey: payload.dateKey,
    startDateKey: payload.startDateKey,
    endDateKey: payload.endDateKey,
    allDay: payload.allDay,
    colorKey: payload.colorKey,
    startMinutes:
      payload.allDay || payload.startMinutes === null
        ? deleteField()
        : payload.startMinutes,
    endMinutes:
      payload.allDay || payload.endMinutes === null
        ? deleteField()
        : payload.endMinutes,
  };
};

const normalizeStoredCalendarEvent = (eventId, input) => {
  const dateWindow = normalizeDateWindow(input);
  if (!dateWindow.startDateKey) {
    return null;
  }

  const isMultiDay = dateWindow.endDateKey > dateWindow.startDateKey;
  const allDay = isMultiDay ? true : Boolean(input?.allDay);
  const startMinutes = allDay ? null : normalizeMinutes(input?.startMinutes);
  const endMinutes = allDay ? null : normalizeMinutes(input?.endMinutes);

  return {
    id: eventId,
    ...input,
    title: String(input?.title || "").trim(),
    note: String(input?.note || "").trim(),
    dateKey: dateWindow.startDateKey,
    startDateKey: dateWindow.startDateKey,
    endDateKey: dateWindow.endDateKey,
    allDay,
    calendarScope: input?.calendarScope === CALENDAR_SCOPE_COMMITTEE
      ? CALENDAR_SCOPE_COMMITTEE
      : CALENDAR_SCOPE_HOME,
    committeeId: input?.calendarScope === CALENDAR_SCOPE_COMMITTEE
      ? String(input?.committeeId || "")
      : "",
    committeeName: input?.calendarScope === CALENDAR_SCOPE_COMMITTEE
      ? String(input?.committeeName || "")
      : "",
    colorKey: normalizeColorKey(input?.colorKey),
    ...(startMinutes !== null ? { startMinutes } : {}),
    ...(endMinutes !== null ? { endMinutes } : {}),
  };
};

const eventOverlapsRange = (event, monthStartKey, monthEndKey) =>
  Boolean(
    event &&
      event.startDateKey &&
      event.endDateKey &&
      event.startDateKey <= monthEndKey &&
      event.endDateKey >= monthStartKey,
  );

const calendarDataPath = (appId) => [
  "artifacts",
  appId,
  "public",
  "data",
  CALENDAR_COLLECTION,
];

export function createDepartmentCalendarService({ db, auth, appId, calendarContext: rawCalendarContext }) {
  const eventsCollectionRef = () => collection(db, ...calendarDataPath(appId));
  const eventDocRef = (eventId) => doc(db, ...calendarDataPath(appId), eventId);
  const calendarContext = normalizeCalendarContext(rawCalendarContext);
  let cachedUserMeta = null;

  const resolveCurrentUserMeta = async () => {
    const user = auth?.currentUser;
    const fallbackName = user?.displayName || user?.email || "Usuario";

    if (!db || !user) {
      return { displayName: fallbackName };
    }

    if (cachedUserMeta?.uid === user.uid && cachedUserMeta.displayName) {
      return { displayName: cachedUserMeta.displayName };
    }

    // Avoid blocking every create with an extra Firestore read when Auth already exposes a usable name.
    if (user.displayName || user.email) {
      cachedUserMeta = {
        uid: user.uid,
        displayName: fallbackName,
      };
      return { displayName: fallbackName };
    }

    try {
      const snap = await getDoc(doc(db, USERS_COLLECTION, user.uid));
      if (!snap.exists()) {
        cachedUserMeta = {
          uid: user.uid,
          displayName: fallbackName,
        };
        return { displayName: fallbackName };
      }

      const data = snap.data() || {};
      const displayName =
        resolveUserValue(
          data,
          [
            "displayName",
            "nombreCompleto",
            "apellidoNombre",
            "fullName",
            "name",
            "nombre",
          ],
          "",
        ) ||
        `${resolveUserValue(data, ["apellido", "lastName"], "")} ${resolveUserValue(
          data,
          ["nombre"],
          "",
        )}`.trim() ||
        fallbackName;

      cachedUserMeta = {
        uid: user.uid,
        displayName,
      };

      return { displayName };
    } catch (error) {
      console.warn("[Calendar] No se pudo resolver el nombre del usuario.", error);
      cachedUserMeta = {
        uid: user.uid,
        displayName: fallbackName,
      };
      return { displayName: fallbackName };
    }
  };

  const resolveAdminStatus = async (user) => {
    if (!user) return false;

    try {
      const token = await user.getIdTokenResult();
      if (token?.claims?.admin === true) return true;
    } catch (error) {
      console.warn("[Calendar] No se pudieron leer los custom claims.", error);
    }

    if (!db) return false;

    try {
      const snap = await getDoc(doc(db, "admin_whitelist", user.uid));
      return snap.exists();
    } catch (error) {
      console.warn("[Calendar] No se pudo leer admin_whitelist.", error);
      return false;
    }
  };

  const subscribeToMonthRange = ({
    monthStartKey,
    monthEndKey,
    onChange,
    onError,
  }) => {
    if (!db) {
      onError?.(new Error("FIRESTORE_UNAVAILABLE"));
      return () => {};
    }

    const eventsQuery =
      calendarContext.scope === CALENDAR_SCOPE_COMMITTEE
        ? query(
            eventsCollectionRef(),
            where("committeeId", "==", calendarContext.committeeId),
            where("dateKey", "<=", monthEndKey),
            orderBy("dateKey"),
          )
        : query(
            eventsCollectionRef(),
            where("dateKey", "<=", monthEndKey),
            orderBy("dateKey"),
          );

    return onSnapshot(
      eventsQuery,
      (snapshot) => {
        const events = snapshot.docs
          .map((docSnap) => normalizeStoredCalendarEvent(docSnap.id, docSnap.data()))
          .filter(Boolean)
          .filter((event) => eventOverlapsRange(event, monthStartKey, monthEndKey));
        onChange?.(events);
      },
      (error) => {
        onError?.(error);
      },
    );
  };

  const createEvent = async (input) => {
    const user = auth?.currentUser;
    if (!db || !user) {
      throw new Error("AUTH_REQUIRED");
    }

    const meta = await resolveCurrentUserMeta();
    const payload = buildCreatePayload(input);

    const optimisticCreatedAt = new Date();
    const docRef = await addDoc(eventsCollectionRef(), {
      ...payload,
      ...buildOriginCreatePayload(calendarContext),
      createdByUid: user.uid,
      createdByName: meta.displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return normalizeStoredCalendarEvent(docRef.id, {
      ...payload,
      ...buildOriginCreatePayload(calendarContext),
      createdByUid: user.uid,
      createdByName: meta.displayName,
      createdAt: optimisticCreatedAt,
      updatedAt: optimisticCreatedAt,
    });
  };

  const updateEvent = async (eventId, input) => {
    const user = auth?.currentUser;
    if (!db || !user) {
      throw new Error("AUTH_REQUIRED");
    }

    const payload = buildUpdatePayload(input);
    const optimisticUpdatedAt = new Date();
    await updateDoc(eventDocRef(eventId), {
      ...payload,
      updatedAt: serverTimestamp(),
    });

    return normalizeStoredCalendarEvent(eventId, {
      ...input,
      ...payload,
      updatedAt: optimisticUpdatedAt,
    });
  };

  const deleteEvent = async (eventId) => {
    const user = auth?.currentUser;
    if (!db || !user) {
      throw new Error("AUTH_REQUIRED");
    }

    await deleteDoc(eventDocRef(eventId));
    return eventId;
  };

  return {
    subscribeToMonthRange,
    createEvent,
    updateEvent,
    deleteEvent,
    resolveCurrentUserMeta,
    resolveAdminStatus,
  };
}
