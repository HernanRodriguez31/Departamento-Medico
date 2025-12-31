const levelWeight = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const isDebugEnabled = () => {
  try {
    if (localStorage.getItem("DEBUG_APP") === "1") return true;
  } catch (e) {}
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
};

const getLevel = () => (isDebugEnabled() ? "debug" : "warn");

const shouldLog = (level) => {
  const current = levelWeight[getLevel()] ?? levelWeight.warn;
  return levelWeight[level] <= current;
};

const logger = {
  error: (...args) => {
    if (!shouldLog("error")) return;
    console.error(...args);
  },
  warn: (...args) => {
    if (!shouldLog("warn")) return;
    console.warn(...args);
  },
  info: (...args) => {
    if (!shouldLog("info")) return;
    console.info(...args);
  },
  debug: (...args) => {
    if (!shouldLog("debug")) return;
    console.debug(...args);
  }
};

const onceCache = new Set();
const throttleCache = new Map();

const once = (key, fn) => {
  if (!key || onceCache.has(key)) return;
  onceCache.add(key);
  fn();
};

const throttle = (key, ms, fn) => {
  if (!key) return;
  const now = Date.now();
  const last = throttleCache.get(key) || 0;
  if (now - last < ms) return;
  throttleCache.set(key, now);
  fn();
};

export { logger, once, throttle };
export default logger;
