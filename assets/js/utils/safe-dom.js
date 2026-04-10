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
