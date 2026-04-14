const DIGIT_PATTERN = /^\d{1,2}$/;

const normalizePart = (value, max) => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return {
      raw: "",
      display: "",
      value: null,
      valid: true,
    };
  }

  if (!DIGIT_PATTERN.test(raw)) {
    return {
      raw,
      display: raw,
      value: null,
      valid: false,
    };
  }

  const numericValue = Number(raw);
  if (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > max) {
    return {
      raw,
      display: raw,
      value: null,
      valid: false,
    };
  }

  return {
    raw,
    display: String(numericValue).padStart(2, "0"),
    value: numericValue,
    valid: true,
  };
};

export const formatTime24h = (minutes) => {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) return "";
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mins = String(minutes % 60).padStart(2, "0");
  return `${hours}:${mins}`;
};

export const splitMinutesToTimeParts = (minutes) => {
  const formatted = formatTime24h(minutes);
  if (!formatted) {
    return { hours: "", minutes: "" };
  }

  const [hours, mins] = formatted.split(":");
  return { hours, minutes: mins };
};

export const normalizeTimePartInput = (value, part) => {
  const max = part === "hours" ? 23 : 59;
  return normalizePart(value, max);
};

export const parseTimeParts = (hoursValue, minutesValue) => {
  const hours = normalizeTimePartInput(hoursValue, "hours");
  const minutes = normalizeTimePartInput(minutesValue, "minutes");
  const hasAnyValue = Boolean(hours.raw || minutes.raw);

  if (!hasAnyValue) {
    return {
      display: "",
      minutes: null,
      valid: true,
      complete: false,
    };
  }

  if (!hours.valid || !minutes.valid) {
    return {
      display: [hours.display, minutes.display].filter(Boolean).join(":"),
      minutes: null,
      valid: false,
      complete: false,
    };
  }

  if (hours.value === null || minutes.value === null) {
    return {
      display: [hours.display, minutes.display].filter(Boolean).join(":"),
      minutes: null,
      valid: false,
      complete: false,
    };
  }

  return {
    display: `${hours.display}:${minutes.display}`,
    minutes: hours.value * 60 + minutes.value,
    valid: true,
    complete: true,
  };
};
