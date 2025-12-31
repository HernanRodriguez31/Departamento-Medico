const isDebugMode = () => {
  try {
    if (typeof window !== "undefined" && window.__DEBUG__ === true) return true;
    return localStorage.getItem("debug") === "true";
  } catch (e) {
    return false;
  }
};

export const debugLog = (...args) => {
  if (!isDebugMode()) return;
  console.log(...args);
};

const logCache = new Set();

export const logOnce = (key, ...args) => {
  if (!key || logCache.has(key)) return;
  logCache.add(key);
  if (!isDebugMode()) return;
  console.warn(...args);
};

export const handleFirebaseError = (error, context = {}) => {
  const {
    scope = "firebase",
    onPermissionDenied,
    onUnavailable,
    onDefault
  } = context;
  const code = error?.code || "";
  const message = error?.message || "";
  if (isDebugMode()) {
    console.error(`[${scope}]`, error);
  }
  if (code === "permission-denied") {
    onPermissionDenied?.(error);
    return { handled: true, code };
  }
  if (code === "unavailable" || (code === "failed-precondition" && /offline|unavailable/i.test(message))) {
    onUnavailable?.(error);
    return { handled: true, code };
  }
  onDefault?.(error);
  return { handled: false, code };
};
