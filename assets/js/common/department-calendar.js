import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  CALENDAR_COLOR_KEYS,
  DEFAULT_CALENDAR_COLOR_KEY,
  createDepartmentCalendarService,
} from "../services/DepartmentCalendarService.js";
import {
  formatTime24h,
  normalizeTimePartInput,
  parseTimeParts,
  splitMinutesToTimeParts,
} from "./calendar-time.js";

const MODE_MONTH = "MONTH";
const MODE_AGENDA = "AGENDA";
const STORAGE_KEY = "dm-calendar-mode";
const HOME_PAGE_VARIANTS = new Set(["index", "app"]);
const MIN_DATE_KEY = "2026-01-01";
const MAX_DATE_KEY = "2027-12-31";
const MIN_MONTH = new Date(2026, 0, 1, 12, 0, 0, 0);
const MAX_MONTH = new Date(2027, 11, 1, 12, 0, 0, 0);
const MIN_DATE = new Date(2026, 0, 1, 12, 0, 0, 0);
const MAX_DATE = new Date(2027, 11, 31, 12, 0, 0, 0);
const WEEKDAY_LABELS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const DATE_KEY_PATTERN = /^(2026|2027)-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const MONTH_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  month: "long",
  year: "numeric",
});
const TODAY_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
});
const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  month: "long",
  year: "numeric",
});
const SHORT_MONTH_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  month: "short",
});
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
});
const META_DATETIME_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const COLOR_OPTIONS = Object.freeze([
  { key: "green", label: "Verde" },
  { key: "blue", label: "Azul" },
  { key: "amber", label: "Ámbar" },
  { key: "red", label: "Rojo" },
  { key: "violet", label: "Violeta" },
  { key: "slate", label: "Pizarra" },
]);

const capitalize = (value) =>
  String(value || "").replace(/^\p{L}/u, (letter) => letter.toUpperCase());

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const fromDateKey = (dateKey) => {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

const startOfMonth = (date) =>
  new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);

const endOfMonth = (date) =>
  new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0, 0);

const addMonths = (date, delta) =>
  new Date(date.getFullYear(), date.getMonth() + delta, 1, 12, 0, 0, 0);

const addDays = (date, delta) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta, 12, 0, 0, 0);

const getMondayFirstWeekdayIndex = (date) => (date.getDay() + 6) % 7;

const clampDate = (date) => {
  if (date < MIN_DATE) return new Date(MIN_DATE.getTime());
  if (date > MAX_DATE) return new Date(MAX_DATE.getTime());
  return new Date(date.getTime());
};

const clampMonth = (date) => {
  const month = startOfMonth(date);
  if (month < MIN_MONTH) return new Date(MIN_MONTH.getTime());
  if (month > MAX_MONTH) return new Date(MAX_MONTH.getTime());
  return month;
};

const compareDateKeys = (left, right) => String(left || "").localeCompare(String(right || ""));

const loadPersistedMode = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === MODE_AGENDA ? MODE_AGENDA : MODE_MONTH;
  } catch (error) {
    return MODE_MONTH;
  }
};

const persistMode = (mode) => {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch (error) {
    // Ignore storage errors.
  }
};

const formatMonthLabel = (date) => capitalize(MONTH_FORMATTER.format(date));
const formatTodayMeta = (date) => `Hoy: ${TODAY_FORMATTER.format(date)}`;

const truncateText = (value, maxLength) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
};

const normalizeColorKey = (value) =>
  CALENDAR_COLOR_KEYS.includes(String(value || ""))
    ? String(value)
    : DEFAULT_CALENDAR_COLOR_KEY;

const resolveTimestampDate = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value?.toDate === "function") {
    try {
      const nextDate = value.toDate();
      if (nextDate instanceof Date && !Number.isNaN(nextDate.getTime())) {
        return nextDate;
      }
    } catch (error) {
      return null;
    }
  }
  if (typeof value?.seconds === "number") {
    const milliseconds = value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1_000_000);
    const nextDate = new Date(milliseconds);
    return Number.isNaN(nextDate.getTime()) ? null : nextDate;
  }
  if (typeof value === "string" || typeof value === "number") {
    const nextDate = new Date(value);
    return Number.isNaN(nextDate.getTime()) ? null : nextDate;
  }
  return null;
};

const formatDateTime24h = (value) => {
  const date = resolveTimestampDate(value);
  if (!date) return "";
  return META_DATETIME_FORMATTER.format(date).replace(",", " ·");
};

const isPermissionError = (error) => {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return (
    code === "permission-denied" ||
    code === "unauthenticated" ||
    /missing or insufficient permissions/i.test(message)
  );
};

const humanizeMutationError = (error, fallbackMessage, actionLabel = "guardar") => {
  if (!error) return fallbackMessage;
  if (error.message === "AUTH_REQUIRED" || error.code === "auth/user-not-found") {
    return `Iniciá sesión para ${actionLabel} actividades del calendario.`;
  }
  if (isPermissionError(error)) {
    return `No tenés permisos para ${actionLabel} esta actividad. Si acabás de actualizar las reglas, recargá la página e intentá nuevamente.`;
  }
  if (error.code === "invalid-argument") {
    return "Revisá el rango de fechas, el horario y el color antes de guardar.";
  }
  if (error.code === "failed-precondition") {
    return "No pudimos validar la actividad en Firestore. Revisá los campos e intentá otra vez.";
  }
  return fallbackMessage;
};

const isDateKeyWithinRange = (dateKey) =>
  typeof dateKey === "string" &&
  DATE_KEY_PATTERN.test(dateKey) &&
  dateKey >= MIN_DATE_KEY &&
  dateKey <= MAX_DATE_KEY;

const isSameMonth = (left, right) =>
  left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();

const isMultiDayEvent = (event) =>
  Boolean(event?.startDateKey && event?.endDateKey && event.endDateKey > event.startDateKey);

const normalizeStoredEvent = (event) => {
  const startDateKey = isDateKeyWithinRange(event?.startDateKey)
    ? event.startDateKey
    : isDateKeyWithinRange(event?.dateKey)
      ? event.dateKey
      : "";
  const endDateKey =
    isDateKeyWithinRange(event?.endDateKey) && compareDateKeys(event.endDateKey, startDateKey) >= 0
      ? event.endDateKey
      : startDateKey;
  const multiDay = Boolean(startDateKey && endDateKey > startDateKey);
  const allDay = multiDay ? true : Boolean(event?.allDay);
  const startMinutes =
    !allDay && Number.isInteger(event?.startMinutes) ? event.startMinutes : null;
  const endMinutes =
    !allDay && Number.isInteger(event?.endMinutes) ? event.endMinutes : null;

  return {
    ...event,
    dateKey: startDateKey,
    startDateKey,
    endDateKey,
    allDay,
    colorKey: normalizeColorKey(event?.colorKey),
    startMinutes,
    endMinutes,
  };
};

const sortEvents = (events) =>
  [...events]
    .map(normalizeStoredEvent)
    .filter((event) => event.startDateKey)
    .sort((left, right) => {
      const startDelta = compareDateKeys(left.startDateKey, right.startDateKey);
      if (startDelta !== 0) return startDelta;
      const leftAllDayRank = left.allDay ? 0 : 1;
      const rightAllDayRank = right.allDay ? 0 : 1;
      if (leftAllDayRank !== rightAllDayRank) return leftAllDayRank - rightAllDayRank;
      const leftDuration = left.endDateKey ? left.endDateKey : left.startDateKey;
      const rightDuration = right.endDateKey ? right.endDateKey : right.startDateKey;
      if (leftDuration !== rightDuration) return rightDuration.localeCompare(leftDuration);
      const leftStart = Number.isInteger(left.startMinutes) ? left.startMinutes : Number.MAX_SAFE_INTEGER;
      const rightStart = Number.isInteger(right.startMinutes) ? right.startMinutes : Number.MAX_SAFE_INTEGER;
      if (leftStart !== rightStart) return leftStart - rightStart;
      return String(left.title || "").localeCompare(String(right.title || ""), "es", {
        sensitivity: "base",
      });
    });

const formatAgendaDateParts = (dateKey) => {
  const date = fromDateKey(dateKey);
  if (!date) {
    return {
      dayNumber: "--",
      weekday: dateKey,
      monthYear: "",
    };
  }

  return {
    dayNumber: String(date.getDate()),
    weekday: capitalize(WEEKDAY_FORMATTER.format(date)),
    monthYear: capitalize(MONTH_YEAR_FORMATTER.format(date)),
  };
};

const formatShortDate = (dateKey) => {
  const date = fromDateKey(dateKey);
  return date ? SHORT_DATE_FORMATTER.format(date) : dateKey;
};

const formatEventTime = (event) => {
  if (event.allDay || isMultiDayEvent(event)) return "Todo el día";
  const start = Number.isInteger(event.startMinutes) ? formatTime24h(event.startMinutes) : "";
  const end = Number.isInteger(event.endMinutes) ? formatTime24h(event.endMinutes) : "";
  if (start && end) return `${start} - ${end}`;
  if (start) return start;
  return "Sin horario";
};

const formatEventRangeMeta = (event) => {
  if (!isMultiDayEvent(event)) return "";
  return `Desde ${formatShortDate(event.startDateKey)} hasta ${formatShortDate(event.endDateKey)}`;
};

const formatRegistrantMeta = (event) => {
  const parts = [event?.createdByName ? `Registrado por ${event.createdByName}` : "Actividad del equipo"];
  const createdAtLabel = formatDateTime24h(event?.createdAt);
  if (createdAtLabel) {
    parts.push(createdAtLabel);
  }
  return parts.join(" · ");
};

const formatMonthChipLabel = (occurrence) => {
  const event = occurrence.event;
  const title = truncateText(event.title, isMultiDayEvent(event) || event.allDay ? 24 : 18);
  if (isMultiDayEvent(event) || event.allDay || !Number.isInteger(event.startMinutes)) return title;
  return `${formatTime24h(event.startMinutes)} · ${title}`;
};

const iterateDateKeys = (startDateKey, endDateKey) => {
  const keys = [];
  const start = fromDateKey(startDateKey);
  const end = fromDateKey(endDateKey);
  if (!start || !end || compareDateKeys(startDateKey, endDateKey) > 0) return keys;

  for (let cursor = new Date(start.getTime()); cursor <= end; cursor = addDays(cursor, 1)) {
    keys.push(toDateKey(cursor));
  }
  return keys;
};

const createOccurrence = (event, dateKey) => {
  const multiDay = isMultiDayEvent(event);
  let spanPosition = "single";
  if (multiDay) {
    if (dateKey === event.startDateKey) {
      spanPosition = "start";
    } else if (dateKey === event.endDateKey) {
      spanPosition = "end";
    } else {
      spanPosition = "middle";
    }
  }

  return {
    id: `${event.id}:${dateKey}`,
    dateKey,
    colorKey: normalizeColorKey(event.colorKey),
    eventId: event.id,
    event,
    isMultiDay: multiDay,
    spanPosition,
  };
};

const sortOccurrences = (occurrences) =>
  [...occurrences].sort((left, right) => {
    const leftAllDayRank = left.event.allDay ? 0 : 1;
    const rightAllDayRank = right.event.allDay ? 0 : 1;
    if (leftAllDayRank !== rightAllDayRank) return leftAllDayRank - rightAllDayRank;
    const leftSpanRank =
      left.spanPosition === "start"
        ? 0
        : left.spanPosition === "middle"
          ? 1
          : left.spanPosition === "end"
            ? 2
            : 3;
    const rightSpanRank =
      right.spanPosition === "start"
        ? 0
        : right.spanPosition === "middle"
          ? 1
          : right.spanPosition === "end"
            ? 2
            : 3;
    if (leftSpanRank !== rightSpanRank) return leftSpanRank - rightSpanRank;
    const leftStart = Number.isInteger(left.event.startMinutes)
      ? left.event.startMinutes
      : Number.MAX_SAFE_INTEGER;
    const rightStart = Number.isInteger(right.event.startMinutes)
      ? right.event.startMinutes
      : Number.MAX_SAFE_INTEGER;
    if (leftStart !== rightStart) return leftStart - rightStart;
    return String(left.event.title || "").localeCompare(String(right.event.title || ""), "es", {
      sensitivity: "base",
    });
  });

const buildOccurrencesByDate = (events, rangeStartKey, rangeEndKey) => {
  const grouped = new Map();

  sortEvents(events).forEach((event) => {
    const overlapStartKey =
      compareDateKeys(event.startDateKey, rangeStartKey) < 0 ? rangeStartKey : event.startDateKey;
    const overlapEndKey =
      compareDateKeys(event.endDateKey, rangeEndKey) > 0 ? rangeEndKey : event.endDateKey;

    if (compareDateKeys(overlapStartKey, overlapEndKey) > 0) return;

    iterateDateKeys(overlapStartKey, overlapEndKey).forEach((dateKey) => {
      const bucket = grouped.get(dateKey) || [];
      bucket.push(createOccurrence(event, dateKey));
      grouped.set(dateKey, bucket);
    });
  });

  grouped.forEach((bucket, dateKey) => {
    grouped.set(dateKey, sortOccurrences(bucket));
  });

  return grouped;
};

const eventOverlapsRange = (event, rangeStartKey, rangeEndKey) =>
  Boolean(
    event &&
      event.startDateKey &&
      event.endDateKey &&
      compareDateKeys(event.startDateKey, rangeEndKey) <= 0 &&
      compareDateKeys(event.endDateKey, rangeStartKey) >= 0,
  );

const getMonthGridStart = (monthDate) => addDays(monthDate, -getMondayFirstWeekdayIndex(monthDate));

const getMonthRangeKeys = (monthDate) => {
  const monthStartKey = toDateKey(monthDate);
  const monthEndKey = toDateKey(endOfMonth(monthDate));

  return {
    monthStartKey,
    monthEndKey,
    rangeKey: `${monthStartKey}:${monthEndKey}`,
  };
};

const getInitialCalendarDate = () => {
  const today = clampDate(new Date());
  return {
    today,
    visibleMonth: startOfMonth(today),
    selectedDateKey: toDateKey(today),
  };
};

const getInitialCalendarState = ({ pageVariant } = {}) => {
  const { visibleMonth, selectedDateKey } = getInitialCalendarDate();
  return {
    mode: HOME_PAGE_VARIANTS.has(pageVariant) ? MODE_MONTH : loadPersistedMode(),
    visibleMonth,
    selectedDateKey,
    currentUser: null,
    isAdmin: false,
    authReady: false,
    syncState: "idle",
    syncMessage: "",
    events: [],
    eventsRangeKey: "",
    unsubscribeMonth: null,
    unsubscribeAuth: null,
    modalContext: null,
    pending: false,
  };
};

const validateEventPayload = ({
  title,
  note,
  startDateKey,
  endDateKey,
  allDay,
  startTimeValue,
  endTimeValue,
  startTimeValid,
  endTimeValid,
  startMinutes,
  endMinutes,
  colorKey,
}) => {
  if (!title || title.length > 140) {
    return "Ingresá un título entre 1 y 140 caracteres.";
  }
  if (note.length > 4000) {
    return "La nota no puede superar los 4000 caracteres.";
  }
  if (!DATE_KEY_PATTERN.test(startDateKey) || !DATE_KEY_PATTERN.test(endDateKey)) {
    return "La fecha debe estar dentro del rango permitido.";
  }
  if (!isDateKeyWithinRange(startDateKey) || !isDateKeyWithinRange(endDateKey)) {
    return "La fecha debe estar dentro del rango permitido.";
  }
  if (compareDateKeys(endDateKey, startDateKey) < 0) {
    return "La fecha hasta debe ser igual o posterior a la fecha desde.";
  }
  if (!CALENDAR_COLOR_KEYS.includes(colorKey)) {
    return "Seleccioná un color válido para la actividad.";
  }
  if (compareDateKeys(endDateKey, startDateKey) > 0) {
    if (!allDay || startMinutes !== null || endMinutes !== null) {
      return "Las actividades de varios días se registran como todo el día.";
    }
    return null;
  }
  if (allDay) return null;
  if (startTimeValue && !startTimeValid) {
    return "Completá hora y minutos válidos para la hora de inicio.";
  }
  if (endTimeValue && !endTimeValid) {
    return "Completá hora y minutos válidos para la hora de fin.";
  }
  if (endMinutes !== null && startMinutes === null) {
    return "Indicá una hora de inicio antes de cargar la hora de fin.";
  }
  if (startMinutes !== null && (startMinutes < 0 || startMinutes > 1439)) {
    return "La hora de inicio no es válida.";
  }
  if (endMinutes !== null && (endMinutes < 1 || endMinutes > 1440)) {
    return "La hora de fin no es válida.";
  }
  if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
    return "La hora de fin debe ser posterior a la hora de inicio.";
  }
  return null;
};

const buildColorOptionsMarkup = () =>
  COLOR_OPTIONS.map(
    ({ key, label }) => `
      <label class="department-calendar-modal__color-option" data-color-key="${key}">
        <input
          type="radio"
          name="department-calendar-color"
          value="${key}"
          data-calendar-input="color"
        />
        <span class="department-calendar-modal__color-swatch" aria-hidden="true"></span>
        <span class="department-calendar-modal__color-label">${label}</span>
      </label>
    `,
  ).join("");

const buildShellMarkup = (pageVariant) => `
  <div class="department-calendar department-calendar--${pageVariant}">
    <div class="department-calendar__panel">
      <div class="department-calendar__toolbar">
        <div class="department-calendar__toolbar-left">
          <button type="button" class="department-calendar__nav-btn department-calendar__nav-btn--today" data-calendar-action="today">
            Hoy
          </button>
          <button type="button" class="department-calendar__nav-btn" data-calendar-action="prev" aria-label="Mes anterior">
            ‹
          </button>
          <button type="button" class="department-calendar__nav-btn" data-calendar-action="next" aria-label="Mes siguiente">
            ›
          </button>
        </div>
        <div class="department-calendar__toolbar-center">
          <p class="department-calendar__month-label" data-calendar-month-label></p>
          <p class="department-calendar__today-meta" data-calendar-today-meta></p>
        </div>
        <div class="department-calendar__toolbar-right">
          <div class="department-calendar__segment" role="group" aria-label="Vista del calendario">
            <button
              type="button"
              class="department-calendar__segment-btn is-active"
              data-calendar-mode="MONTH"
              aria-pressed="true"
            >
              Mes
            </button>
            <button
              type="button"
              class="department-calendar__segment-btn"
              data-calendar-mode="AGENDA"
              aria-pressed="false"
            >
              Agenda
            </button>
          </div>
          <button type="button" class="calendar-edit-btn department-calendar__add-btn" data-calendar-action="create">
            Nueva actividad
          </button>
        </div>
      </div>
      <p class="department-calendar__status" data-calendar-status aria-live="polite" hidden></p>
      <div class="department-calendar__content" data-calendar-content></div>
    </div>
  </div>
`;

const buildModalMarkup = () => `
  <div class="department-calendar-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="department-calendar-modal-title" tabindex="-1">
    <div class="department-calendar-modal__header">
      <div class="department-calendar-modal__header-copy">
        <h3 id="department-calendar-modal-title" class="department-calendar-modal__title">Nueva actividad</h3>
        <p class="department-calendar-modal__meta" data-calendar-modal-meta></p>
        <p class="department-calendar-modal__audit" data-calendar-modal-audit hidden></p>
      </div>
      <button type="button" class="department-calendar-modal__close" data-calendar-modal-close aria-label="Cerrar">
        Cerrar
      </button>
    </div>
    <form class="department-calendar-modal__form" data-calendar-form>
      <label class="department-calendar-modal__field">
        <span>Título</span>
        <input type="text" maxlength="140" required data-calendar-input="title" />
      </label>
      <label class="department-calendar-modal__field">
        <span>Nota</span>
        <textarea rows="4" maxlength="4000" data-calendar-input="note" placeholder="Contexto, recordatorio o descripción breve."></textarea>
      </label>
      <div class="department-calendar-modal__section department-calendar-modal__section--schedule">
        <div class="department-calendar-modal__section-head">
          <div>
            <p class="department-calendar-modal__section-label">Programación</p>
            <p class="department-calendar-modal__section-meta">
              Definí el rango de fechas y, si aplica, el horario del mismo día.
            </p>
          </div>
          <p class="department-calendar-modal__hint">
            Enero 2026 · Diciembre 2027
          </p>
        </div>
        <div class="department-calendar-modal__schedule">
          <label class="department-calendar-modal__field">
            <span>Desde</span>
            <input type="date" min="${MIN_DATE_KEY}" max="${MAX_DATE_KEY}" required data-calendar-input="startDate" />
          </label>
          <label class="department-calendar-modal__field">
            <span>Hasta</span>
            <input type="date" min="${MIN_DATE_KEY}" max="${MAX_DATE_KEY}" required data-calendar-input="endDate" />
          </label>
          <label class="department-calendar-modal__switch">
            <span class="department-calendar-modal__switch-copy">
              <strong>Todo el día</strong>
              <small>Los eventos de varios días se registran siempre sin horario.</small>
            </span>
            <span class="department-calendar-modal__switch-control">
              <input type="checkbox" data-calendar-input="allDay" />
              <span class="department-calendar-modal__switch-track">
                <span class="department-calendar-modal__switch-thumb"></span>
              </span>
            </span>
          </label>
          <label class="department-calendar-modal__field">
            <span>Hora inicio</span>
            <span class="department-calendar-modal__time-group">
              <input
                type="number"
                min="0"
                max="23"
                step="1"
                inputmode="numeric"
                autocomplete="off"
                placeholder="HH"
                class="department-calendar-modal__time-part"
                data-calendar-input="startHour"
                data-calendar-time-part="hours"
                aria-label="Hora de inicio"
              />
              <span class="department-calendar-modal__time-separator" aria-hidden="true">:</span>
              <input
                type="number"
                min="0"
                max="59"
                step="1"
                inputmode="numeric"
                autocomplete="off"
                placeholder="MM"
                class="department-calendar-modal__time-part"
                data-calendar-input="startMinute"
                data-calendar-time-part="minutes"
                aria-label="Minutos de inicio"
              />
            </span>
          </label>
          <label class="department-calendar-modal__field">
            <span>Hora fin</span>
            <span class="department-calendar-modal__time-group">
              <input
                type="number"
                min="0"
                max="23"
                step="1"
                inputmode="numeric"
                autocomplete="off"
                placeholder="HH"
                class="department-calendar-modal__time-part"
                data-calendar-input="endHour"
                data-calendar-time-part="hours"
                aria-label="Hora de fin"
              />
              <span class="department-calendar-modal__time-separator" aria-hidden="true">:</span>
              <input
                type="number"
                min="0"
                max="59"
                step="1"
                inputmode="numeric"
                autocomplete="off"
                placeholder="MM"
                class="department-calendar-modal__time-part"
                data-calendar-input="endMinute"
                data-calendar-time-part="minutes"
                aria-label="Minutos de fin"
              />
            </span>
          </label>
        </div>
        <p class="department-calendar-modal__multiday-hint" data-calendar-multiday-hint hidden>
          Las actividades de varios días se registran como todo el día.
        </p>
      </div>
      <div class="department-calendar-modal__section department-calendar-modal__section--color">
        <div class="department-calendar-modal__section-head">
          <div>
            <p class="department-calendar-modal__section-label">Color del sticker</p>
            <p class="department-calendar-modal__section-meta">
              Elegí un acento visual para el calendario y la agenda.
            </p>
          </div>
        </div>
        <div class="department-calendar-modal__color-grid" role="radiogroup" aria-label="Color del evento">
          ${buildColorOptionsMarkup()}
        </div>
      </div>
      <p class="department-calendar-modal__error" data-calendar-modal-error hidden></p>
      <div class="department-calendar-modal__actions">
        <div class="department-calendar-modal__actions-left">
          <button type="button" class="department-calendar-modal__btn department-calendar-modal__btn--danger" data-calendar-modal-delete hidden>
            Eliminar
          </button>
        </div>
        <div class="department-calendar-modal__actions-right">
          <button type="button" class="department-calendar-modal__btn department-calendar-modal__btn--ghost" data-calendar-modal-cancel>
            Cancelar
          </button>
          <button type="submit" class="department-calendar-modal__btn department-calendar-modal__btn--primary" data-calendar-modal-save>
            Guardar
          </button>
        </div>
      </div>
    </form>
  </div>
`;

function createState({ pageVariant } = {}) {
  return getInitialCalendarState({ pageVariant });
}

export function initDepartmentCalendar({
  auth,
  db,
  appId,
  rootSelector = "#department-calendar-root",
  pageVariant = "index",
} = {}) {
  const root = document.querySelector(rootSelector);
  if (!root) return null;

  if (typeof root.__departmentCalendarCleanup === "function") {
    root.__departmentCalendarCleanup();
  }

  const service = createDepartmentCalendarService({ db, auth, appId });
  const state = createState({ pageVariant });
  root.innerHTML = buildShellMarkup(pageVariant);

  const shell = root.querySelector(".department-calendar");
  const monthLabel = root.querySelector("[data-calendar-month-label]");
  const todayMeta = root.querySelector("[data-calendar-today-meta]");
  const status = root.querySelector("[data-calendar-status]");
  const content = root.querySelector("[data-calendar-content]");
  const addButton = root.querySelector('[data-calendar-action="create"]');
  const toggleButtons = Array.from(root.querySelectorAll("[data-calendar-mode]"));

  const modal = document.createElement("div");
  modal.className = "department-calendar-modal";
  modal.setAttribute("aria-hidden", "true");
  modal.hidden = true;
  modal.innerHTML = buildModalMarkup();
  document.body.appendChild(modal);

  const modalTitle = modal.querySelector(".department-calendar-modal__title");
  const modalMeta = modal.querySelector("[data-calendar-modal-meta]");
  const modalAudit = modal.querySelector("[data-calendar-modal-audit]");
  const modalClose = modal.querySelector("[data-calendar-modal-close]");
  const modalCancel = modal.querySelector("[data-calendar-modal-cancel]");
  const modalDelete = modal.querySelector("[data-calendar-modal-delete]");
  const modalSave = modal.querySelector("[data-calendar-modal-save]");
  const modalForm = modal.querySelector("[data-calendar-form]");
  const modalError = modal.querySelector("[data-calendar-modal-error]");
  const multidayHint = modal.querySelector("[data-calendar-multiday-hint]");
  const titleInput = modal.querySelector('[data-calendar-input="title"]');
  const noteInput = modal.querySelector('[data-calendar-input="note"]');
  const startDateInput = modal.querySelector('[data-calendar-input="startDate"]');
  const endDateInput = modal.querySelector('[data-calendar-input="endDate"]');
  const allDayInput = modal.querySelector('[data-calendar-input="allDay"]');
  const startHourInput = modal.querySelector('[data-calendar-input="startHour"]');
  const startMinuteInput = modal.querySelector('[data-calendar-input="startMinute"]');
  const endHourInput = modal.querySelector('[data-calendar-input="endHour"]');
  const endMinuteInput = modal.querySelector('[data-calendar-input="endMinute"]');
  const timeInputs = [startHourInput, startMinuteInput, endHourInput, endMinuteInput];
  const colorInputs = Array.from(modal.querySelectorAll('[data-calendar-input="color"]'));

  const setToggleState = () => {
    toggleButtons.forEach((button) => {
      const isActive = button.dataset.calendarMode === state.mode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  };

  const canEditEvent = (event) =>
    Boolean(
      state.currentUser &&
        event &&
        (state.isAdmin || event.createdByUid === state.currentUser.uid),
    );

  const hideModalError = () => {
    modalError.hidden = true;
    modalError.textContent = "";
  };

  const showModalError = (message) => {
    modalError.hidden = false;
    modalError.textContent = message;
  };

  const selectColor = (colorKey) => {
    const nextColorKey = normalizeColorKey(colorKey);
    colorInputs.forEach((input) => {
      input.checked = input.value === nextColorKey;
    });
    modal.dataset.colorKey = nextColorKey;
  };

  const readSelectedColor = () =>
    normalizeColorKey(colorInputs.find((input) => input.checked)?.value);

  const normalizeTimePartField = (input) => {
    if (!input) {
      return {
        raw: "",
        display: "",
        value: null,
        valid: true,
      };
    }
    const parsed = normalizeTimePartInput(input.value, input.dataset.calendarTimePart);
    input.value = parsed.valid ? parsed.display : parsed.raw;
    return parsed;
  };

  const setTimeParts = (group, minutes) => {
    const { hours, minutes: mins } = splitMinutesToTimeParts(minutes);
    if (group === "start") {
      startHourInput.value = hours;
      startMinuteInput.value = mins;
      return;
    }
    endHourInput.value = hours;
    endMinuteInput.value = mins;
  };

  const clearTimeParts = () => {
    setTimeParts("start", null);
    setTimeParts("end", null);
  };

  const readTimeParts = (group) => {
    if (group === "start") {
      return parseTimeParts(startHourInput.value, startMinuteInput.value);
    }
    return parseTimeParts(endHourInput.value, endMinuteInput.value);
  };

  const getCurrentVisibleRange = () => getMonthRangeKeys(state.visibleMonth);

  const setEventsForVisibleRange = (events) => {
    const { monthStartKey, monthEndKey, rangeKey } = getCurrentVisibleRange();
    state.events = sortEvents(events).filter((event) => eventOverlapsRange(event, monthStartKey, monthEndKey));
    state.eventsRangeKey = rangeKey;
  };

  const upsertLocalEvent = (event) => {
    if (!event?.id) return;
    const nextEvents = state.events.filter((item) => item.id !== event.id);
    nextEvents.push(normalizeStoredEvent(event));
    setEventsForVisibleRange(nextEvents);
    render();
  };

  const removeLocalEvent = (eventId) => {
    if (!eventId) return;
    setEventsForVisibleRange(state.events.filter((event) => event.id !== eventId));
    render();
  };

  const setPending = (pending) => {
    state.pending = pending;
    const readOnly = Boolean(state.modalContext?.readOnly);
    modalClose.disabled = pending;
    modalCancel.disabled = pending;
    modalDelete.disabled = pending || readOnly;
    modalSave.disabled = pending || readOnly;
    modalSave.textContent = pending
      ? state.modalContext?.mode === "create"
        ? "Guardando..."
        : "Actualizando..."
      : state.modalContext?.mode === "create"
        ? "Guardar actividad"
        : "Guardar cambios";
    modalDelete.textContent = pending ? "Eliminando..." : "Eliminar";
  };

  const syncScheduleInputs = () => {
    const readOnly = Boolean(state.modalContext?.readOnly);
    if (startDateInput.value && (!endDateInput.value || compareDateKeys(endDateInput.value, startDateInput.value) < 0)) {
      endDateInput.value = startDateInput.value;
    }
    const isMultiDay =
      Boolean(startDateInput.value && endDateInput.value) &&
      compareDateKeys(endDateInput.value, startDateInput.value) > 0;
    if (isMultiDay) {
      allDayInput.checked = true;
    }
    allDayInput.disabled = readOnly || isMultiDay;
    const disableTimes = readOnly || allDayInput.checked || isMultiDay;
    timeInputs.forEach((input) => {
      input.disabled = disableTimes;
    });
    multidayHint.hidden = !isMultiDay;
    modal.dataset.multiday = isMultiDay ? "true" : "false";
  };

  const closeModal = () => {
    if (state.pending) return;
    modal.hidden = true;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("dm-modal-open");
    titleInput.value = "";
    noteInput.value = "";
    startDateInput.value = "";
    endDateInput.value = "";
    allDayInput.checked = true;
    clearTimeParts();
    selectColor(DEFAULT_CALENDAR_COLOR_KEY);
    multidayHint.hidden = true;
    modal.dataset.multiday = "false";
    modalAudit.hidden = true;
    modalAudit.textContent = "";
    hideModalError();
    setPending(false);
    const trigger = state.modalContext?.trigger;
    state.modalContext = null;
    if (trigger && typeof trigger.focus === "function") {
      trigger.focus();
    }
  };

  const setModalInputsReadOnly = (readOnly) => {
    titleInput.readOnly = readOnly;
    noteInput.readOnly = readOnly;
    startDateInput.disabled = readOnly;
    endDateInput.disabled = readOnly;
    allDayInput.disabled = readOnly;
    timeInputs.forEach((input) => {
      input.disabled = readOnly;
    });
    colorInputs.forEach((input) => {
      input.disabled = readOnly;
    });
  };

  const openModal = ({ mode, event = null, dateKey = null, trigger = null }) => {
    const readOnly = mode === "view";
    const startDateKey = event?.startDateKey || event?.dateKey || dateKey || state.selectedDateKey;
    const endDateKey = event?.endDateKey || startDateKey;
    state.modalContext = {
      mode,
      eventId: event?.id || null,
      readOnly,
      trigger,
    };
    hideModalError();
    setPending(false);
    modalTitle.textContent =
      mode === "create" ? "Nueva actividad" : readOnly ? "Detalle de actividad" : "Editar actividad";
    modalMeta.textContent =
      mode === "create"
        ? "Nota, reunión o recordatorio interno del Departamento Médico."
        : isMultiDayEvent(event)
          ? "Actividad extendida visible en todos los días del rango."
          : "Actividad interna del Departamento Médico.";
    const auditMeta = event ? formatRegistrantMeta(event) : "";
    modalAudit.hidden = !auditMeta;
    modalAudit.textContent = auditMeta;
    titleInput.value = event?.title || "";
    noteInput.value = event?.note || "";
    startDateInput.value = startDateKey;
    endDateInput.value = endDateKey;
    allDayInput.checked = event ? Boolean(event.allDay || isMultiDayEvent(event)) : true;
    setTimeParts("start", Number.isInteger(event?.startMinutes) ? event.startMinutes : null);
    setTimeParts("end", Number.isInteger(event?.endMinutes) ? event.endMinutes : null);
    selectColor(event?.colorKey || DEFAULT_CALENDAR_COLOR_KEY);
    setModalInputsReadOnly(readOnly);
    syncScheduleInputs();

    modalDelete.hidden = mode === "create" || readOnly;
    modalSave.hidden = readOnly;
    modalCancel.textContent = readOnly ? "Cerrar" : "Cancelar";

    modal.hidden = false;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("dm-modal-open");

    window.requestAnimationFrame(() => {
      if (readOnly) {
        modalClose.focus();
      } else {
        titleInput.focus();
        titleInput.select();
      }
    });
  };

  const setMode = (mode) => {
    state.mode = mode === MODE_AGENDA ? MODE_AGENDA : MODE_MONTH;
    persistMode(state.mode);
    render();
  };

  const setVisibleMonth = (date, selectedDateKey = null) => {
    state.visibleMonth = clampMonth(date);
    state.selectedDateKey =
      selectedDateKey && isDateKeyWithinRange(selectedDateKey)
        ? selectedDateKey
        : toDateKey(state.visibleMonth);
    subscribeToVisibleMonth();
  };

  const resolveSelectedDateForToday = () => {
    const { visibleMonth, selectedDateKey } = getInitialCalendarDate();
    return {
      month: visibleMonth,
      dateKey: selectedDateKey,
    };
  };

  const findEventById = (eventId) => state.events.find((event) => event.id === eventId) || null;

  const createStateMessage = (variant, title, description) => {
    const wrapper = document.createElement("div");
    wrapper.className = `department-calendar__${variant}`;
    const heading = document.createElement("h3");
    heading.textContent = title;
    wrapper.appendChild(heading);
    const text = document.createElement("p");
    text.textContent = description;
    wrapper.appendChild(text);
    return wrapper;
  };

  const renderStatus = () => {
    let variant = "";
    let message = "";
    if (!state.authReady) {
      variant = "loading";
      message =
        "Preparando el calendario. La grilla mensual ya está visible mientras conectamos la sincronización.";
    } else if (!state.currentUser) {
      variant = "info";
      message =
        "Iniciá sesión para sincronizar actividades y registrar nuevas notas. La grilla mensual sigue disponible.";
    } else if (state.syncState === "loading") {
      variant = "loading";
      message = "Sincronizando actividades del período visible.";
    } else if (state.syncState === "error") {
      variant = "error";
      message =
        state.syncMessage ||
        "No pudimos sincronizar los eventos. Mostramos la grilla igualmente.";
    }

    status.className = "department-calendar__status";
    if (!message) {
      status.hidden = true;
      status.textContent = "";
      return;
    }

    status.classList.add(`department-calendar__status--${variant}`);
    status.hidden = false;
    status.textContent = message;
  };

  const renderMonthView = () => {
    const board = document.createElement("div");
    board.className = "department-calendar__month-board";
    const weekdays = document.createElement("div");
    weekdays.className = "department-calendar__weekdays";
    WEEKDAY_LABELS.forEach((label) => {
      const item = document.createElement("span");
      item.className = "department-calendar__weekday";
      item.textContent = label;
      weekdays.appendChild(item);
    });
    board.appendChild(weekdays);

    const grid = document.createElement("div");
    grid.className = "department-calendar__grid";
    const visibleEventLimit = window.matchMedia("(max-width: 640px)").matches ? 1 : 2;
    const gridStart = getMonthGridStart(state.visibleMonth);
    const gridEnd = addDays(gridStart, 41);
    const occurrencesByDate = buildOccurrencesByDate(
      state.events,
      toDateKey(gridStart),
      toDateKey(gridEnd),
    );
    const todayKey = toDateKey(clampDate(new Date()));

    for (let index = 0; index < 42; index += 1) {
      const currentDate = addDays(gridStart, index);
      const dateKey = toDateKey(currentDate);
      const dayOccurrences = occurrencesByDate.get(dateKey) || [];
      const isCurrentMonth = isSameMonth(currentDate, state.visibleMonth);
      const isToday = dateKey === todayKey;
      const isSelected = dateKey === state.selectedDateKey;
      const day = document.createElement("article");
      day.className = "department-calendar__day";
      if (dayOccurrences.length) day.classList.add("department-calendar__day--has-events");
      if (!isCurrentMonth) day.classList.add("department-calendar__day--outside");
      if (isToday) day.classList.add("department-calendar__day--today");
      if (isSelected) day.classList.add("department-calendar__day--selected");
      if (isDateKeyWithinRange(dateKey)) {
        day.tabIndex = 0;
        day.setAttribute("role", "button");
      } else {
        day.setAttribute("aria-disabled", "true");
      }
      day.dataset.calendarDayKey = dateKey;
      day.dataset.currentMonth = isCurrentMonth ? "true" : "false";

      const head = document.createElement("div");
      head.className = "department-calendar__day-head";
      const dayMeta = document.createElement("div");
      dayMeta.className = "department-calendar__day-meta";
      const number = document.createElement("span");
      number.className = "department-calendar__day-number";
      number.textContent = String(currentDate.getDate());
      dayMeta.appendChild(number);

      if (!isCurrentMonth) {
        const outsideLabel = document.createElement("span");
        outsideLabel.className = "department-calendar__day-month";
        outsideLabel.textContent = capitalize(SHORT_MONTH_FORMATTER.format(currentDate)).replace(".", "");
        dayMeta.appendChild(outsideLabel);
      }
      head.appendChild(dayMeta);

      const flags = document.createElement("div");
      flags.className = "department-calendar__day-flags";
      if (dayOccurrences.length) {
        const count = document.createElement("span");
        count.className = "department-calendar__event-count";
        count.textContent = String(dayOccurrences.length);
        flags.appendChild(count);
      }
      if (isToday) {
        const todayBadge = document.createElement("span");
        todayBadge.className = "department-calendar__today-pill";
        todayBadge.textContent = "Hoy";
        flags.appendChild(todayBadge);
      }
      head.appendChild(flags);
      day.appendChild(head);

      const list = document.createElement("div");
      list.className = "department-calendar__events";
      dayOccurrences.slice(0, visibleEventLimit).forEach((occurrence) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "department-calendar__event-chip";
        chip.dataset.calendarEventId = occurrence.eventId;
        chip.dataset.calendarOccurrenceDateKey = occurrence.dateKey;
        chip.dataset.colorKey = occurrence.colorKey;
        chip.dataset.spanPosition = occurrence.spanPosition;
        chip.textContent = formatMonthChipLabel(occurrence);
        list.appendChild(chip);
      });

      if (dayOccurrences.length > visibleEventLimit) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "department-calendar__more";
        more.dataset.calendarMoreKey = dateKey;
        more.textContent = `+${dayOccurrences.length - visibleEventLimit}`;
        list.appendChild(more);
      }

      day.appendChild(list);
      grid.appendChild(day);
    }

    board.appendChild(grid);
    content.replaceChildren(board);
  };

  const renderAgendaView = () => {
    const monthStartKey = toDateKey(state.visibleMonth);
    const monthEndKey = toDateKey(endOfMonth(state.visibleMonth));
    const grouped = buildOccurrencesByDate(state.events, monthStartKey, monthEndKey);

    if (!grouped.size) {
      let title = "Sin actividades en este mes";
      let description = "Podés registrar una nota o una actividad desde el botón principal.";
      let variant = "empty";
      if (!state.authReady) {
        title = "Preparando agenda";
        description =
          "La agenda se completa cuando termina la sincronización inicial del calendario.";
        variant = "loading";
      } else if (!state.currentUser) {
        title = "Iniciá sesión para ver la agenda";
        description =
          "La agenda compartida se sincroniza cuando ingresás con tu cuenta del equipo.";
      } else if (state.syncState === "loading") {
        title = "Sincronizando agenda";
        description =
          "Las actividades del mes visible todavía se están cargando. La vista Mes ya permanece disponible.";
        variant = "loading";
      } else if (state.syncState === "error") {
        title = "Sincronización pendiente";
        description =
          "No pudimos sincronizar los eventos. Mostramos la agenda sin actividades mientras reintentamos.";
      }
      content.replaceChildren(createStateMessage(variant, title, description));
      return;
    }

    const agenda = document.createElement("div");
    agenda.className = "department-calendar__agenda";

    Array.from(grouped.entries())
      .sort(([leftKey], [rightKey]) => compareDateKeys(leftKey, rightKey))
      .forEach(([dateKey, occurrences]) => {
        const dateParts = formatAgendaDateParts(dateKey);
        const group = document.createElement("section");
        group.className = "department-calendar__agenda-group";
        if (dateKey === state.selectedDateKey) {
          group.classList.add("department-calendar__agenda-group--selected");
        }

        const rail = document.createElement("div");
        rail.className = "department-calendar__date-rail";
        const number = document.createElement("span");
        number.className = "department-calendar__date-number";
        number.textContent = dateParts.dayNumber;
        rail.appendChild(number);

        const dateCopy = document.createElement("div");
        dateCopy.className = "department-calendar__date-copy";
        const weekday = document.createElement("span");
        weekday.className = "department-calendar__date-weekday";
        weekday.textContent = dateParts.weekday;
        dateCopy.appendChild(weekday);
        const month = document.createElement("span");
        month.className = "department-calendar__date-month";
        month.textContent = dateParts.monthYear;
        dateCopy.appendChild(month);
        rail.appendChild(dateCopy);

        if (dateKey === toDateKey(clampDate(new Date()))) {
          const todayBadge = document.createElement("span");
          todayBadge.className = "department-calendar__today-pill";
          todayBadge.textContent = "Hoy";
          rail.appendChild(todayBadge);
        }

        group.appendChild(rail);

        const list = document.createElement("div");
        list.className = "department-calendar__agenda-list";

        occurrences.forEach((occurrence) => {
          const event = occurrence.event;
          const item = document.createElement("button");
          item.type = "button";
          item.className = "department-calendar__agenda-item";
          item.dataset.calendarEventId = occurrence.eventId;
          item.dataset.calendarOccurrenceDateKey = occurrence.dateKey;
          item.dataset.colorKey = occurrence.colorKey;
          item.dataset.multiday = occurrence.isMultiDay ? "true" : "false";

          const timeBlock = document.createElement("div");
          timeBlock.className = "department-calendar__agenda-timeblock";
          const time = document.createElement("span");
          time.className = "department-calendar__agenda-time";
          time.textContent = formatEventTime(event);
          timeBlock.appendChild(time);
          item.appendChild(timeBlock);

          const body = document.createElement("div");
          body.className = "department-calendar__agenda-body";
          const topRow = document.createElement("div");
          topRow.className = "department-calendar__agenda-top";
          const title = document.createElement("strong");
          title.textContent = event.title;
          topRow.appendChild(title);
          body.appendChild(topRow);

          const rangeMeta = formatEventRangeMeta(event);
          if (rangeMeta) {
            const range = document.createElement("p");
            range.className = "department-calendar__agenda-range";
            range.textContent = rangeMeta;
            body.appendChild(range);
          }

          if (event.note) {
            const note = document.createElement("p");
            note.className = "department-calendar__agenda-note";
            note.textContent = truncateText(event.note, 180);
            body.appendChild(note);
          }

          const meta = document.createElement("p");
          meta.className = "department-calendar__agenda-meta";
          meta.textContent = formatRegistrantMeta(event);
          body.appendChild(meta);
          item.appendChild(body);
          list.appendChild(item);
        });

        group.appendChild(list);
        agenda.appendChild(group);
      });

    content.replaceChildren(agenda);
  };

  const render = () => {
    shell.classList.toggle("department-calendar--agenda", state.mode === MODE_AGENDA);
    shell.dataset.mode = state.mode.toLowerCase();
    monthLabel.textContent = formatMonthLabel(state.visibleMonth);
    todayMeta.textContent = formatTodayMeta(clampDate(new Date()));
    addButton.disabled = !state.currentUser;
    addButton.setAttribute("aria-disabled", !state.currentUser ? "true" : "false");
    const prevButton = root.querySelector('[data-calendar-action="prev"]');
    const nextButton = root.querySelector('[data-calendar-action="next"]');
    prevButton.disabled = state.visibleMonth.getTime() <= MIN_MONTH.getTime();
    nextButton.disabled = state.visibleMonth.getTime() >= MAX_MONTH.getTime();
    setToggleState();
    renderStatus();
    if (state.mode === MODE_AGENDA) {
      renderAgendaView();
      return;
    }
    renderMonthView();
  };

  const subscribeToVisibleMonth = () => {
    if (typeof state.unsubscribeMonth === "function") {
      state.unsubscribeMonth();
      state.unsubscribeMonth = null;
    }
    if (!state.currentUser || !db) {
      state.events = [];
      state.eventsRangeKey = "";
      state.syncState = "idle";
      state.syncMessage = "";
      render();
      return;
    }
    const { monthStartKey, monthEndKey, rangeKey: nextRangeKey } = getCurrentVisibleRange();
    if (state.eventsRangeKey !== nextRangeKey) {
      state.events = sortEvents(state.events).filter((event) =>
        eventOverlapsRange(event, monthStartKey, monthEndKey),
      );
      state.eventsRangeKey = nextRangeKey;
    }
    state.syncState = "loading";
    state.syncMessage = "";
    render();
    state.unsubscribeMonth = service.subscribeToMonthRange({
      monthStartKey,
      monthEndKey,
      onChange(events) {
        state.events = sortEvents(events);
        state.eventsRangeKey = nextRangeKey;
        state.syncState = "idle";
        state.syncMessage = "";
        render();
      },
      onError(error) {
        console.error("[Calendar] No se pudo cargar el rango visible.", error);
        state.syncState = "error";
        state.syncMessage =
          "No pudimos sincronizar los eventos. Mostramos la grilla igualmente y podés reintentar en unos segundos.";
        render();
      },
    });
  };

  const toggleButtonRemovers = toggleButtons.map((button) => {
    const handleClick = () => setMode(button.dataset.calendarMode);
    button.addEventListener("click", handleClick);
    return () => button.removeEventListener("click", handleClick);
  });

  const colorInputRemovers = colorInputs.map((input) => {
    const handleColorChange = () => {
      selectColor(input.value);
      hideModalError();
    };
    input.addEventListener("change", handleColorChange);
    return () => input.removeEventListener("change", handleColorChange);
  });

  const handleRootClick = (event) => {
    const actionButton = event.target.closest("[data-calendar-action]");
    if (actionButton) {
      const action = actionButton.dataset.calendarAction;
      if (action === "today") {
        const today = resolveSelectedDateForToday();
        setVisibleMonth(today.month, today.dateKey);
        return;
      }
      if (action === "prev" && state.visibleMonth.getTime() > MIN_MONTH.getTime()) {
        setVisibleMonth(addMonths(state.visibleMonth, -1));
        return;
      }
      if (action === "next" && state.visibleMonth.getTime() < MAX_MONTH.getTime()) {
        setVisibleMonth(addMonths(state.visibleMonth, 1));
        return;
      }
      if (action === "create" && state.currentUser) {
        openModal({
          mode: "create",
          dateKey: state.selectedDateKey,
          trigger: actionButton,
        });
      }
      return;
    }

    const chip = event.target.closest("[data-calendar-event-id]");
    if (chip) {
      const selectedEvent = findEventById(chip.dataset.calendarEventId);
      if (!selectedEvent) return;
      const occurrenceDateKey = chip.dataset.calendarOccurrenceDateKey || selectedEvent.startDateKey;
      state.selectedDateKey = occurrenceDateKey;
      openModal({
        mode: canEditEvent(selectedEvent) ? "edit" : "view",
        event: selectedEvent,
        trigger: chip,
      });
      return;
    }

    const moreButton = event.target.closest("[data-calendar-more-key]");
    if (moreButton) {
      state.selectedDateKey = moreButton.dataset.calendarMoreKey;
      setMode(MODE_AGENDA);
      return;
    }

    const day = event.target.closest("[data-calendar-day-key]");
    if (!day) return;
    const dateKey = day.dataset.calendarDayKey;
    if (!isDateKeyWithinRange(dateKey)) return;
    state.selectedDateKey = dateKey;
    if (day.dataset.currentMonth === "true") {
      if (state.currentUser) {
        openModal({ mode: "create", dateKey, trigger: day });
      } else {
        render();
      }
      return;
    }
    const nextDate = fromDateKey(dateKey);
    if (nextDate) {
      setVisibleMonth(nextDate, dateKey);
    }
  };

  const handleRootKeydown = (event) => {
    const day = event.target.closest("[data-calendar-day-key]");
    if (!day) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    day.click();
  };

  const handleModalBackdrop = (event) => {
    if (event.target === modal) {
      closeModal();
    }
  };

  const handleDocumentKeydown = (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  };

  const handleScheduleChange = () => {
    syncScheduleInputs();
    hideModalError();
  };

  const handleTimeInput = () => {
    hideModalError();
  };

  const handleTimeBlur = (event) => {
    normalizeTimePartField(event.target);
    hideModalError();
  };

  const parseFormPayload = () => {
    const title = titleInput.value.trim();
    const note = noteInput.value.trim();
    const startDateKey = startDateInput.value;
    const endDateKey = endDateInput.value || startDateKey;
    const isMultiDay = Boolean(startDateKey && endDateKey && compareDateKeys(endDateKey, startDateKey) > 0);
    const allDay = isMultiDay ? true : allDayInput.checked;
    const startTime = readTimeParts("start");
    const endTime = readTimeParts("end");
    const startMinutes = allDay ? null : startTime.minutes;
    const endMinutes = allDay ? null : endTime.minutes;
    const colorKey = readSelectedColor();
    return {
      title,
      note,
      dateKey: startDateKey,
      startDateKey,
      endDateKey,
      allDay,
      startTimeValue: startTime.display,
      endTimeValue: endTime.display,
      startTimeValid: startTime.valid,
      endTimeValid: endTime.valid,
      startMinutes,
      endMinutes,
      colorKey,
    };
  };

  const handleFormSubmit = async (event) => {
    event.preventDefault();
    if (!state.modalContext || state.modalContext.readOnly || state.pending) return;
    const existingEvent = state.modalContext.eventId ? findEventById(state.modalContext.eventId) : null;
    const payload = parseFormPayload();
    const validationError = validateEventPayload(payload);
    if (validationError) {
      showModalError(validationError);
      return;
    }

    try {
      setPending(true);
      hideModalError();
      let optimisticEvent = null;
      if (state.modalContext.mode === "create") {
        optimisticEvent = await service.createEvent(payload);
      } else if (state.modalContext.eventId) {
        const updatedEvent = await service.updateEvent(state.modalContext.eventId, payload);
        optimisticEvent = normalizeStoredEvent({
          ...existingEvent,
          ...updatedEvent,
          id: state.modalContext.eventId,
        });
      }
      const nextDate = fromDateKey(payload.startDateKey);
      if (nextDate) {
        state.selectedDateKey = payload.startDateKey;
        state.visibleMonth = clampMonth(nextDate);
      }
      const shouldResubscribe =
        typeof state.unsubscribeMonth !== "function" ||
        state.eventsRangeKey !== getCurrentVisibleRange().rangeKey ||
        state.syncState === "error";
      if (optimisticEvent) {
        upsertLocalEvent(optimisticEvent);
      }
      setPending(false);
      closeModal();
      if (shouldResubscribe) {
        subscribeToVisibleMonth();
      }
    } catch (error) {
      console.error("[Calendar] No se pudo guardar la actividad.", error);
      showModalError(
        humanizeMutationError(error, "No pudimos guardar los cambios. Volvé a intentarlo."),
      );
      setPending(false);
    }
  };

  const handleDelete = async () => {
    if (!state.modalContext?.eventId || state.pending) return;
    if (!window.confirm("¿Querés eliminar esta actividad del calendario?")) return;

    try {
      setPending(true);
      await service.deleteEvent(state.modalContext.eventId);
      removeLocalEvent(state.modalContext.eventId);
      setPending(false);
      closeModal();
      if (typeof state.unsubscribeMonth !== "function" || state.syncState === "error") {
        subscribeToVisibleMonth();
      }
    } catch (error) {
      console.error("[Calendar] No se pudo eliminar la actividad.", error);
      showModalError(
        humanizeMutationError(
          error,
          "No pudimos eliminar la actividad. Volvé a intentarlo.",
          "eliminar",
        ),
      );
      setPending(false);
    }
  };

  root.addEventListener("click", handleRootClick);
  root.addEventListener("keydown", handleRootKeydown);
  modal.addEventListener("click", handleModalBackdrop);
  modalClose.addEventListener("click", closeModal);
  modalCancel.addEventListener("click", closeModal);
  modalDelete.addEventListener("click", handleDelete);
  modalForm.addEventListener("submit", handleFormSubmit);
  startDateInput.addEventListener("change", handleScheduleChange);
  endDateInput.addEventListener("change", handleScheduleChange);
  allDayInput.addEventListener("change", handleScheduleChange);
  timeInputs.forEach((input) => {
    input.addEventListener("input", handleTimeInput);
    input.addEventListener("blur", handleTimeBlur);
  });
  document.addEventListener("keydown", handleDocumentKeydown);

  state.unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
    state.authReady = false;
    state.syncState = "idle";
    state.syncMessage = "";
    render();
    state.currentUser = user;
    state.isAdmin = false;
    state.events = [];
    state.eventsRangeKey = "";

    if (!user) {
      if (typeof state.unsubscribeMonth === "function") {
        state.unsubscribeMonth();
        state.unsubscribeMonth = null;
      }
      state.syncState = "idle";
      state.syncMessage = "";
      state.authReady = true;
      render();
      return;
    }

    try {
      state.isAdmin = await service.resolveAdminStatus(user);
    } catch (error) {
      console.warn("[Calendar] No se pudo resolver el estado admin.", error);
      state.isAdmin = false;
    }

    state.authReady = true;
    subscribeToVisibleMonth();
  });

  const cleanup = () => {
    if (typeof state.unsubscribeMonth === "function") {
      state.unsubscribeMonth();
    }
    if (typeof state.unsubscribeAuth === "function") {
      state.unsubscribeAuth();
    }
    toggleButtonRemovers.forEach((remove) => remove());
    root.removeEventListener("click", handleRootClick);
    root.removeEventListener("keydown", handleRootKeydown);
    modal.removeEventListener("click", handleModalBackdrop);
    modalClose.removeEventListener("click", closeModal);
    modalCancel.removeEventListener("click", closeModal);
    modalDelete.removeEventListener("click", handleDelete);
    modalForm.removeEventListener("submit", handleFormSubmit);
    startDateInput.removeEventListener("change", handleScheduleChange);
    endDateInput.removeEventListener("change", handleScheduleChange);
    allDayInput.removeEventListener("change", handleScheduleChange);
    timeInputs.forEach((input) => {
      input.removeEventListener("input", handleTimeInput);
      input.removeEventListener("blur", handleTimeBlur);
    });
    colorInputRemovers.forEach((remove) => remove());
    document.removeEventListener("keydown", handleDocumentKeydown);
    modal.remove();
    document.body.classList.remove("dm-modal-open");
    delete root.__departmentCalendarCleanup;
  };

  root.__departmentCalendarCleanup = cleanup;
  render();
  return { cleanup };
}
