// Escritorio de proyecto — registro de comités y helpers de navegación.
// Compartido por las páginas de comités (tarjetas de proyecto) y por
// pages/comites/escritorio.html. Sin dependencias de Firebase.

export const COMMITTEE_REGISTRY = Object.freeze({
  comite_bioetica: {
    id: "comite_bioetica",
    name: "Comité de Bioética",
    page: "comite-bioetica.html",
    logo: "committee-bioetica-logo.png"
  },
  comite_farmacia_terapeutica: {
    id: "comite_farmacia_terapeutica",
    name: "Comité de Farmacia y Terapéutica",
    page: "comite-farmacia-terapeutica.html",
    logo: "committee-farmacia-terapeutica-logo.png"
  },
  comite_docencia_investigacion: {
    id: "comite_docencia_investigacion",
    name: "Comité de Docencia e Investigación",
    page: "comite-docencia-investigacion.html",
    logo: "committee-docencia-investigacion-logo.png"
  },
  comite_salud_digital: {
    id: "comite_salud_digital",
    name: "Comité de Salud Digital e Innovación",
    page: "comite-salud-digital.html",
    logo: "committee-salud-digital-innovacion-logo.png"
  },
  comite_calidad_seguridad: {
    id: "comite_calidad_seguridad",
    name: "Comité de Calidad y Seguridad",
    page: "comite-calidad-seguridad.html",
    logo: "committee-calidad-seguridad-logo.png"
  },
  comite_ejecutivo_emergencias: {
    id: "comite_ejecutivo_emergencias",
    name: "Comité Ejecutivo de Emergencias",
    page: "comite-ejecutivo-emergencias.html",
    logo: "committee-emergencias-logo.png"
  },
  comite_salud_ocupacional: {
    id: "comite_salud_ocupacional",
    name: "Comité de Salud Ocupacional",
    page: "salud-ocupacional.html",
    logo: "committee-salud-ocupacional-logo.png"
  }
});

export const DESKTOP_PAGE = "escritorio.html";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const isSafeId = (value) => SAFE_ID.test(String(value || ""));

export const getCommitteeInfo = (committeeId) =>
  COMMITTEE_REGISTRY[String(committeeId || "")] || null;

// URL relativa a /pages/comites/ (las páginas de comités y el escritorio viven ahí).
export function buildProjectDesktopUrl(committeeId, topicId) {
  if (!isSafeId(committeeId) || !isSafeId(topicId)) return "";
  const params = new URLSearchParams({ comite: committeeId, proyecto: topicId });
  return `${DESKTOP_PAGE}?${params.toString()}`;
}

export function buildCommitteePageUrl(committeeId) {
  const info = getCommitteeInfo(committeeId);
  return info ? info.page : "../../index.html";
}

export function openProjectDesktop(committeeId, topicId) {
  const url = buildProjectDesktopUrl(committeeId, topicId);
  if (!url) return false;
  window.location.href = url;
  return true;
}

const INTERACTIVE_SELECTOR =
  "a, button, input, select, textarea, label, [contenteditable], [role='button'], [data-no-desktop-link]";

// Delegación de clic sobre las tarjetas de proyecto: un clic en la tarjeta
// (fuera de sus controles interactivos) abre el escritorio del proyecto.
// Enter sobre la tarjeta enfocada hace lo mismo.
export function installProjectDesktopCardLinks({
  root = document,
  committeeId,
  cardSelector = "[data-project-desktop-id]"
} = {}) {
  if (!root || !committeeId) return () => {};
  const resolveCard = (target) =>
    target instanceof Element ? target.closest(cardSelector) : null;

  const onClick = (event) => {
    const card = resolveCard(event.target);
    if (!card) return;
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) return;
    const selection = window.getSelection?.();
    if (selection && String(selection).trim().length > 0) return;
    event.preventDefault();
    openProjectDesktop(committeeId, card.dataset.projectDesktopId);
  };

  const onKeydown = (event) => {
    if (event.key !== "Enter") return;
    const card = resolveCard(event.target);
    if (!card || event.target !== card) return;
    event.preventDefault();
    openProjectDesktop(committeeId, card.dataset.projectDesktopId);
  };

  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeydown);
  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKeydown);
  };
}
