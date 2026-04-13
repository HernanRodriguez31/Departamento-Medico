const DEFAULT_FALLBACK_DELAY_MS = 1800;

export function initPdfViewer({
  triggerSelector = "[data-pdf-viewer-trigger]",
  modalId = "dm-pdf-viewer-modal",
} = {}) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  const titleEl = modal.querySelector("#dm-pdf-viewer-title");
  const closeBtn = modal.querySelector("#dm-pdf-viewer-close");
  const openLink = modal.querySelector("#dm-pdf-viewer-open");
  const downloadLink = modal.querySelector("#dm-pdf-viewer-download");
  const frame = modal.querySelector("#dm-pdf-viewer-frame");
  const fallback = modal.querySelector("#dm-pdf-viewer-fallback");
  const fallbackOpenLink = modal.querySelector("[data-pdf-viewer-open-link]");
  const fallbackDownloadLink = modal.querySelector("[data-pdf-viewer-download-link]");
  const dialog = modal.querySelector(".dm-pdf-viewer__dialog");
  const triggers = Array.from(document.querySelectorAll(triggerSelector));

  if (!closeBtn || !openLink || !downloadLink || !frame || !fallback || !dialog || !triggers.length) {
    return;
  }

  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  let activeTrigger = null;
  let isOpen = false;
  let fallbackTimer = null;
  let loadAttempt = 0;

  const clearFallbackTimer = () => {
    if (fallbackTimer) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  };

  const setFallbackVisibility = (visible) => {
    fallback.hidden = !visible;
  };

  const setActionTargets = (src, downloadName, title) => {
    openLink.href = src;
    openLink.setAttribute("aria-label", `Abrir ${title} en una pestaña nueva`);
    downloadLink.href = src;
    downloadLink.setAttribute("download", downloadName || "");
    downloadLink.setAttribute("aria-label", `Descargar ${title}`);

    if (fallbackOpenLink) {
      fallbackOpenLink.href = src;
      fallbackOpenLink.setAttribute("aria-label", `Abrir ${title} en una pestaña nueva`);
    }
    if (fallbackDownloadLink) {
      fallbackDownloadLink.href = src;
      fallbackDownloadLink.setAttribute("download", downloadName || "");
      fallbackDownloadLink.setAttribute("aria-label", `Descargar ${title}`);
    }
  };

  const closeViewer = () => {
    if (!isOpen) return;
    isOpen = false;
    loadAttempt += 1;
    clearFallbackTimer();
    setFallbackVisibility(false);
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    modal.hidden = true;
    document.body.classList.remove("dm-modal-open");
    frame.setAttribute("src", "about:blank");

    const triggerToRestore = activeTrigger;
    activeTrigger = null;
    triggerToRestore?.focus?.({ preventScroll: true });
  };

  frame.addEventListener("load", () => {
    if (!isOpen) return;
    clearFallbackTimer();
    setFallbackVisibility(false);
  });

  const openViewer = (trigger) => {
    const src = trigger.dataset.pdfSrc || trigger.getAttribute("href");
    if (!src) return;

    const title = trigger.dataset.pdfTitle || trigger.textContent.trim() || "Documento";
    const downloadName = trigger.dataset.pdfDownload || src.split("/").pop() || "documento.pdf";
    activeTrigger = trigger;
    isOpen = true;
    loadAttempt += 1;

    titleEl.textContent = title;
    frame.setAttribute("title", title);
    setActionTargets(src, downloadName, title);
    setFallbackVisibility(false);
    modal.hidden = false;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("dm-modal-open");

    const attemptId = loadAttempt;
    clearFallbackTimer();
    fallbackTimer = window.setTimeout(() => {
      if (isOpen && attemptId === loadAttempt) {
        setFallbackVisibility(true);
      }
    }, DEFAULT_FALLBACK_DELAY_MS);

    frame.setAttribute("src", src);
    closeBtn.focus({ preventScroll: true });
  };

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      openViewer(trigger);
    });
  });

  closeBtn.addEventListener("click", closeViewer);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeViewer();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen) {
      closeViewer();
    }
  });
}
