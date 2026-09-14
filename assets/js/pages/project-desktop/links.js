// Enlaces del escritorio: detección del tipo de recurso a partir de la URL,
// metadatos visuales por tipo y fusión de los accesos Microsoft 365 del proyecto
// (enlaces por slot definidos en js/committee-links.js + enlaces manuales
// guardados en el documento del proyecto: docLinks).
import { getDocLinksForTopic } from "../../../../js/committee-links.js";
import { safeHttpsUrl, hostOf, text } from "./ui.js";

export const LINK_KINDS = Object.freeze({
  folder: { label: "Carpeta", color: "#7ab800", icon: "folder", badge: "" },
  spfolder: { label: "Carpeta en Teams / SharePoint", color: "#036c70", icon: "folder-open", badge: "S" },
  word: { label: "Documento Word", color: "#2b579a", icon: "file-text", badge: "W" },
  excel: { label: "Planilla Excel", color: "#217346", icon: "sheet", badge: "X" },
  ppt: { label: "Presentación PowerPoint", color: "#b7472a", icon: "presentation", badge: "P" },
  onenote: { label: "Bloc de notas OneNote", color: "#7719aa", icon: "notebook-text", badge: "N" },
  pdf: { label: "Documento PDF", color: "#d93025", icon: "file-text", badge: "PDF" },
  teams: { label: "Microsoft Teams", color: "#5059c9", icon: "users", badge: "T" },
  sharepoint: { label: "SharePoint", color: "#036c70", icon: "globe", badge: "S" },
  forms: { label: "Microsoft Forms", color: "#008272", icon: "clipboard-list", badge: "F" },
  gdoc: { label: "Documento de Google", color: "#4285f4", icon: "file-text", badge: "G" },
  gsheet: { label: "Hoja de cálculo de Google", color: "#0f9d58", icon: "sheet", badge: "G" },
  gslides: { label: "Presentación de Google", color: "#f4b400", icon: "presentation", badge: "G" },
  gform: { label: "Formulario de Google", color: "#673ab7", icon: "clipboard-list", badge: "G" },
  drive: { label: "Google Drive", color: "#1fa463", icon: "folder-open", badge: "D" },
  looker: { label: "Tablero Looker Studio", color: "#4285f4", icon: "chart-no-axes-column", badge: "L" },
  typeform: { label: "Formulario Typeform", color: "#262627", icon: "clipboard-check", badge: "T" },
  video: { label: "Video", color: "#e11d48", icon: "video", badge: "" },
  image: { label: "Imagen", color: "#0ea5e9", icon: "image", badge: "" },
  pubmed: { label: "PubMed", color: "#20558a", icon: "book-open", badge: "" },
  web: { label: "Enlace web", color: "#64748b", icon: "globe", badge: "" }
});

export function kindMeta(kind) {
  return LINK_KINDS[kind] || LINK_KINDS.web;
}

const EXT_KINDS = [
  [/\.(docx?|dotx?|rtf|odt)(\?|#|$)/i, "word"],
  [/\.(xlsx?|xlsm|csv|ods)(\?|#|$)/i, "excel"],
  [/\.(pptx?|ppsx?|odp)(\?|#|$)/i, "ppt"],
  [/\.pdf(\?|#|$)/i, "pdf"],
  [/\.(png|jpe?g|gif|webp|svg|heic)(\?|#|$)/i, "image"],
  [/\.(mp4|mov|m4v|webm)(\?|#|$)/i, "video"]
];

export function detectKind(rawUrl, name = "") {
  const url = text(rawUrl);
  const lower = url.toLowerCase();
  const host = hostOf(url);
  if (!url) return "web";
  if (host.endsWith("sharepoint.com") || host.endsWith("sharepoint-df.com") || host.includes("-my.sharepoint")) {
    if (/\/:w:\//.test(url) || /doc\.aspx/i.test(url)) return "word";
    if (/\/:x:\//.test(url) || /xlviewer|\/:x:/i.test(url)) return "excel";
    if (/\/:p:\//.test(url)) return "ppt";
    if (/\/:f:\//.test(url) || /allitems\.aspx|\/forms\/|\?id=/i.test(url)) return "spfolder";
    if (/\/:o:\//.test(url) || /onenote/i.test(url)) return "onenote";
    if (/\/:b:\//.test(url)) return "pdf";
    if (/\/:v:\//.test(url)) return "video";
    if (/\/:i:\//.test(url)) return "image";
    const byExt = EXT_KINDS.find(([re]) => re.test(lower));
    return byExt ? byExt[1] : "sharepoint";
  }
  if (host === "teams.microsoft.com" || host.endsWith(".teams.microsoft.com") || host === "teams.cloud.microsoft") return "teams";
  if (host.endsWith("forms.office.com") || host === "forms.microsoft.com" || host.endsWith("forms.cloud.microsoft")) return "forms";
  if (host.endsWith("onenote.com")) return "onenote";
  if (host === "docs.google.com") {
    if (lower.includes("/document/")) return "gdoc";
    if (lower.includes("/spreadsheets/")) return "gsheet";
    if (lower.includes("/presentation/")) return "gslides";
    if (lower.includes("/forms/")) return "gform";
    return "drive";
  }
  if (host === "drive.google.com") return "drive";
  if (host === "lookerstudio.google.com" || host === "datastudio.google.com") return "looker";
  if (host.endsWith("typeform.com")) return "typeform";
  if (host === "youtube.com" || host === "youtu.be" || host === "vimeo.com") return "video";
  if (host === "pubmed.ncbi.nlm.nih.gov") return "pubmed";
  const byExt = EXT_KINDS.find(([re]) => re.test(lower) || re.test(text(name).toLowerCase()));
  if (byExt) return byExt[1];
  return "web";
}

export const KIND_OPTIONS = Object.freeze([
  { value: "", label: "Detectar automáticamente" },
  { value: "word", label: "Documento Word" },
  { value: "excel", label: "Planilla Excel" },
  { value: "ppt", label: "Presentación PowerPoint" },
  { value: "pdf", label: "PDF" },
  { value: "spfolder", label: "Carpeta en Teams / SharePoint" },
  { value: "teams", label: "Microsoft Teams" },
  { value: "onenote", label: "OneNote" },
  { value: "forms", label: "Microsoft Forms" },
  { value: "gdoc", label: "Documento de Google" },
  { value: "gsheet", label: "Hoja de cálculo de Google" },
  { value: "gslides", label: "Presentación de Google" },
  { value: "drive", label: "Google Drive" },
  { value: "looker", label: "Looker Studio" },
  { value: "typeform", label: "Typeform" },
  { value: "video", label: "Video" },
  { value: "image", label: "Imagen" },
  { value: "web", label: "Enlace web" }
]);

// Accesos M365 del proyecto: enlaces por slot (js/committee-links.js) con
// prioridad para los enlaces manuales guardados en docLinks.
export function resolveProjectLinks(committeeId, topic) {
  const slot = topic ? getDocLinksForTopic(committeeId, topic) || {} : {};
  const manual = topic?.docLinks && typeof topic.docLinks === "object" ? topic.docLinks : {};
  const pick = (...values) => {
    for (const value of values) {
      const safe = safeHttpsUrl(value);
      if (safe) return safe;
    }
    return "";
  };
  return {
    folder: pick(manual.folder, slot.folder),
    doc: pick(manual.doc, manual.word, slot.doc),
    ppt: pick(manual.ppt, slot.ppt),
    xlsx: pick(manual.xlsx, manual.excel),
    teams: pick(manual.teams),
    onenote: pick(manual.onenote),
    manual: {
      folder: text(manual.folder),
      doc: text(manual.doc || manual.word),
      ppt: text(manual.ppt),
      xlsx: text(manual.xlsx || manual.excel),
      teams: text(manual.teams),
      onenote: text(manual.onenote)
    },
    slot: {
      folder: text(slot.folder),
      doc: text(slot.doc),
      ppt: text(slot.ppt)
    }
  };
}

export const M365_QUICK_LINKS = Object.freeze([
  { key: "folder", kind: "spfolder", title: "Carpeta del proyecto", subtitle: "Teams · SharePoint", icon: "folder-open" },
  { key: "doc", kind: "word", title: "Documento de trabajo", subtitle: "Word colaborativo", icon: "file-text" },
  { key: "ppt", kind: "ppt", title: "Presentación", subtitle: "PowerPoint colaborativo", icon: "presentation" },
  { key: "xlsx", kind: "excel", title: "Planilla", subtitle: "Excel colaborativo", icon: "sheet" },
  { key: "teams", kind: "teams", title: "Canal de Teams", subtitle: "Conversación del proyecto", icon: "users" },
  { key: "onenote", kind: "onenote", title: "Bloc de notas", subtitle: "OneNote compartido", icon: "notebook-text" }
]);

// Atajos oficiales de Microsoft para crear documentos nuevos en OneDrive
// (word.new / excel.new / powerpoint.new). El documento se crea en el OneDrive
// de la cuenta con sesión iniciada; luego se mueve o registra en la carpeta del proyecto.
export const NEW_DOCUMENT_SHORTCUTS = Object.freeze([
  { kind: "word", label: "Nuevo Word", url: "https://word.new" },
  { kind: "excel", label: "Nueva planilla Excel", url: "https://excel.new" },
  { kind: "ppt", label: "Nueva presentación", url: "https://powerpoint.new" }
]);

export function describeLink(url) {
  const kind = detectKind(url);
  return { kind, meta: kindMeta(kind), host: hostOf(url) };
}
