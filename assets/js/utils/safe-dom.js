export const safeText = (value) => (value == null ? "" : String(value));

export const escapeHTML = (value) =>
  safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const escapeAttribute = (value) =>
  escapeHTML(safeText(value).replace(/[\u0000-\u001F\u007F]/g, " "));

const hasExplicitScheme = (value) => /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);

const isLocalHttpHost = (hostname) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "::1" ||
  hostname === "[::1]";

export const sanitizeURL = (
  value,
  {
    allowRelative = true,
    allowedProtocols = ["https:"],
    allowLocalHttp = true
  } = {}
) => {
  const raw = safeText(value).trim();
  if (!raw) return "";

  const base =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://dm.brisasaludybienestar.com";
  let parsed;
  try {
    parsed = new URL(raw, base);
  } catch (e) {
    return "";
  }

  const relative = !hasExplicitScheme(raw) && !raw.startsWith("//");
  if (relative && allowRelative) return raw;
  if (allowedProtocols.includes(parsed.protocol)) return parsed.href;
  if (allowLocalHttp && parsed.protocol === "http:" && isLocalHttpHost(parsed.hostname)) {
    return parsed.href;
  }
  return "";
};
