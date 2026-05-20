const DEFAULT_VIDEO_TITLE = "Video";

const createVideoModal = (modalId) => {
  const existing = document.getElementById(modalId);
  if (existing) return existing;

  const modal = document.createElement("div");
  modal.id = modalId;
  modal.className = "dm-document-video";
  modal.setAttribute("aria-hidden", "true");
  modal.hidden = true;
  modal.innerHTML = `
    <div class="dm-document-video__dialog" role="dialog" aria-modal="true" aria-labelledby="dm-document-video-title" tabindex="-1">
      <div class="dm-document-video__header">
        <h3 id="dm-document-video-title" class="dm-document-video__title">Video</h3>
        <div class="dm-document-video__actions">
          <a class="dm-document-video__btn" data-document-video-open href="#" target="_blank" rel="noopener noreferrer">Abrir en nueva pestaña</a>
          <a class="dm-document-video__btn" data-document-video-download href="#" download>Descargar</a>
          <button class="dm-document-video__btn dm-document-video__btn--close" type="button" data-document-video-close aria-label="Cerrar visor de video">Cerrar</button>
        </div>
      </div>
      <div class="dm-document-video__body">
        <p class="dm-document-video__status" data-document-video-status role="status">Cargando video...</p>
        <video class="dm-document-video__player" data-document-video-player controls playsinline preload="metadata"></video>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
};

export function initDocumentVideoViewer({
  triggerSelector = "[data-document-video-trigger]",
  modalId = "dm-document-video-modal",
} = {}) {
  const triggers = Array.from(document.querySelectorAll(triggerSelector));
  if (!triggers.length) return;

  const modal = createVideoModal(modalId);
  const titleEl = modal.querySelector("#dm-document-video-title");
  const closeBtn = modal.querySelector("[data-document-video-close]");
  const openLink = modal.querySelector("[data-document-video-open]");
  const downloadLink = modal.querySelector("[data-document-video-download]");
  const video = modal.querySelector("[data-document-video-player]");
  const status = modal.querySelector("[data-document-video-status]");
  const dialog = modal.querySelector(".dm-document-video__dialog");

  if (!titleEl || !closeBtn || !openLink || !downloadLink || !video || !status || !dialog) {
    return;
  }

  let activeTrigger = null;
  let isOpen = false;
  let loadToken = 0;

  const setStatus = (message, visible = true) => {
    status.textContent = message;
    status.hidden = !visible;
  };

  const releaseVideo = () => {
    loadToken += 1;
    try {
      video.pause();
    } catch (error) {}
    video.removeAttribute("src");
    video.load();
    setStatus("", false);
  };

  const closeViewer = () => {
    if (!isOpen) return;
    isOpen = false;
    releaseVideo();
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    modal.hidden = true;
    document.body.classList.remove("dm-modal-open");
    const triggerToRestore = activeTrigger;
    activeTrigger = null;
    triggerToRestore?.focus?.({ preventScroll: true });
  };

  const openViewer = (trigger) => {
    const src = trigger.dataset.videoSrc || trigger.getAttribute("href");
    if (!src) return;

    const title = trigger.dataset.videoTitle || trigger.textContent.trim() || DEFAULT_VIDEO_TITLE;
    const downloadName = trigger.dataset.videoDownload || src.split("/").pop() || "video.mp4";
    const attemptId = loadToken + 1;
    loadToken = attemptId;
    activeTrigger = trigger;
    isOpen = true;

    titleEl.textContent = title;
    video.setAttribute("title", title);
    video.preload = "metadata";
    video.playsInline = true;
    openLink.href = src;
    openLink.setAttribute("aria-label", `Abrir ${title} en una pestaña nueva`);
    downloadLink.href = src;
    downloadLink.setAttribute("download", downloadName);
    downloadLink.setAttribute("aria-label", `Descargar ${title}`);
    setStatus("Cargando video...");

    modal.hidden = false;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("dm-modal-open");

    video.setAttribute("src", src);
    video.load();
    closeBtn.focus({ preventScroll: true });

    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        if (isOpen && loadToken === attemptId) {
          setStatus("Listo para reproducir.");
        }
      });
    }
  };

  video.addEventListener("loadedmetadata", () => {
    if (isOpen) setStatus("Video listo.", false);
  });
  video.addEventListener("waiting", () => {
    if (isOpen) setStatus("Cargando video...");
  });
  video.addEventListener("playing", () => {
    if (isOpen) setStatus("", false);
  });
  video.addEventListener("error", () => {
    if (isOpen) setStatus("No se pudo cargar el video.");
  });

  triggers.forEach((trigger) => {
    if (trigger.dataset.documentVideoBound === "1") return;
    trigger.dataset.documentVideoBound = "1";
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      openViewer(trigger);
    });
  });

  if (modal.dataset.documentVideoBound !== "1") {
    modal.dataset.documentVideoBound = "1";
    closeBtn.addEventListener("click", closeViewer);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeViewer();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen) closeViewer();
    });
  }
}
