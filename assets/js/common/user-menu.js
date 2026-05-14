import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  updatePassword,
  updateProfile,
  verifyBeforeUpdateEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getFirebase } from "./firebaseClient.js";
import { logger, once as logOnce } from "./app-logger.js";
import { bindPasswordVisibility } from "../shared/passwordVisibility.js";
import { performManagedLogout } from "../shared/sessionGuard.js?v=20260305-session-1";
import {
  adminIssueTemporaryPassword,
  adminResolveUser,
  adminSendPasswordReset,
  recordEmailChangeRequested,
  recordMyPasswordChange,
  syncMyAuthEmail,
  updateMyProfile as updateMyProfileCallable
} from "../services/UserSecurityService.js";
import {
  buildInitials,
  resolveNameFromDoc,
  resolveAvatarUrlFromDoc,
  resolveAvatarUpdatedAtFromDoc,
  buildAvatarSrc,
  applyAvatarElement,
  setUserProfileCache
} from "./user-profiles.js?v=20260430-orgtree-avatars-1";

const warnOnce = (() => {
  const seen = new Set();
  return (key, message, err) => {
    if (seen.has(key)) return;
    seen.add(key);
    logOnce(key, () => {
      if (err) {
        logger.warn(message, err);
      } else {
        logger.warn(message);
      }
    });
  };
})();

const normalizeName = (value) => (value || "").trim();

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => reject(new Error("image-load"));
    img.src = url;
  });

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

const renderAvatarBlob = async (state, outputSize = 512) => {
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas-context");
  const { img, size, scale, offsetX, offsetY } = state;
  const srcSize = size / scale;
  const maxSrcX = img.naturalWidth - srcSize;
  const maxSrcY = img.naturalHeight - srcSize;
  const srcX = clampNumber(
    img.naturalWidth / 2 - (size / 2 + offsetX) / scale,
    0,
    Math.max(0, maxSrcX)
  );
  const srcY = clampNumber(
    img.naturalHeight / 2 - (size / 2 + offsetY) / scale,
    0,
    Math.max(0, maxSrcY)
  );
  ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, outputSize, outputSize);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("blob-create");
  return blob;
};

let avatarModal = null;

const ensureAvatarModal = () => {
  if (avatarModal) return avatarModal;
  const overlay = document.createElement("div");
  overlay.className = "dm-avatar-modal";
  overlay.setAttribute("hidden", "");
  overlay.innerHTML = `
    <div class="dm-avatar-modal__card" role="dialog" aria-modal="true" aria-labelledby="dm-avatar-title">
      <div class="dm-avatar-modal__header">
        <h3 id="dm-avatar-title" class="dm-avatar-modal__title">Ajustar imagen de perfil</h3>
        <p class="dm-avatar-modal__subtitle">Arrastra y ajusta el zoom para encuadrar.</p>
      </div>
      <div class="dm-avatar-preview" data-dm-avatar-preview>
        <img class="dm-avatar-preview__img" alt="Preview avatar" draggable="false" />
      </div>
      <label class="dm-avatar-zoom__label" for="dm-avatar-zoom">Zoom</label>
      <input id="dm-avatar-zoom" class="dm-avatar-zoom" type="range" min="1" max="3" step="0.01" value="1.2" />
      <div class="dm-avatar-modal__actions">
        <button type="button" class="dm-avatar-btn dm-avatar-btn--ghost" data-dm-avatar-cancel>Cancelar</button>
        <button type="button" class="dm-avatar-btn dm-avatar-btn--primary" data-dm-avatar-save>Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const preview = overlay.querySelector("[data-dm-avatar-preview]");
  const imgEl = overlay.querySelector(".dm-avatar-preview__img");
  imgEl?.setAttribute("draggable", "false");
  const slider = overlay.querySelector(".dm-avatar-zoom");
  const btnCancel = overlay.querySelector("[data-dm-avatar-cancel]");
  const btnSave = overlay.querySelector("[data-dm-avatar-save]");
  const card = overlay.querySelector(".dm-avatar-modal__card");
  avatarModal = {
    overlay,
    preview,
    imgEl,
    slider,
    btnCancel,
    btnSave,
    card,
    state: null,
    resolver: null,
    activeUrl: ""
  };

  const closeModal = (result) => {
    overlay.setAttribute("hidden", "");
    document.body.classList.remove("dm-modal-open");
    if (avatarModal?.activeUrl) {
      URL.revokeObjectURL(avatarModal.activeUrl);
      avatarModal.activeUrl = "";
    }
    avatarModal.state = null;
    if (typeof avatarModal.resolver === "function") {
      avatarModal.resolver(result || null);
    }
    avatarModal.resolver = null;
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal(null);
  });
  btnCancel?.addEventListener("click", () => closeModal(null));
  btnSave?.addEventListener("click", async () => {
    if (!avatarModal.state) {
      closeModal(null);
      return;
    }
    try {
      const blob = await renderAvatarBlob(avatarModal.state, 512);
      closeModal(blob);
    } catch (err) {
      logger.warn("No se pudo generar el avatar.", err);
      closeModal(null);
    }
  });

  slider?.addEventListener("input", () => {
    if (!avatarModal.state) return;
    const zoom = Number(slider.value || 1);
    avatarModal.state.zoom = zoom;
    avatarModal.state.scale = avatarModal.state.baseScale * zoom;
    clampOffsets(avatarModal.state);
    updatePreviewTransform(avatarModal);
  });

  let dragActive = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let startOffsetX = 0;
  let startOffsetY = 0;

  const onPointerMove = (event) => {
    if (!dragActive || !avatarModal.state) return;
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    avatarModal.state.offsetX = startOffsetX + dx;
    avatarModal.state.offsetY = startOffsetY + dy;
    clampOffsets(avatarModal.state);
    updatePreviewTransform(avatarModal);
  };

  const endDrag = (event) => {
    if (!dragActive) return;
    dragActive = false;
    avatarModal.preview?.releasePointerCapture?.(event.pointerId);
  };

  preview?.addEventListener("pointerdown", (event) => {
    if (!avatarModal.state) return;
    dragActive = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    startOffsetX = avatarModal.state.offsetX;
    startOffsetY = avatarModal.state.offsetY;
    avatarModal.preview?.setPointerCapture?.(event.pointerId);
  });
  preview?.addEventListener("pointermove", onPointerMove);
  preview?.addEventListener("pointerup", endDrag);
  preview?.addEventListener("pointercancel", endDrag);

  avatarModal.close = closeModal;
  return avatarModal;
};

const clampOffsets = (state) => {
  const { img, size, scale } = state;
  const maxX = Math.max(0, (img.naturalWidth * scale - size) / 2);
  const maxY = Math.max(0, (img.naturalHeight * scale - size) / 2);
  state.offsetX = clampNumber(state.offsetX, -maxX, maxX);
  state.offsetY = clampNumber(state.offsetY, -maxY, maxY);
};

const updatePreviewTransform = (modal) => {
  if (!modal?.state || !modal.imgEl) return;
  const { img, scale, offsetX, offsetY } = modal.state;
  modal.imgEl.style.width = `${img.naturalWidth}px`;
  modal.imgEl.style.height = `${img.naturalHeight}px`;
  modal.imgEl.style.transform = `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
};

const openAvatarCropModal = async (file) => {
  const modal = ensureAvatarModal();
  const { img, url } = await loadImage(file);
  try {
    if (typeof img.decode === "function") {
      await img.decode();
    }
  } catch (e) {}
  modal.activeUrl = url;
  modal.imgEl.src = url;
  modal.overlay.removeAttribute("hidden");
  document.body.classList.add("dm-modal-open");
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const previewRect = modal.preview?.getBoundingClientRect();
  const previewSize = previewRect ? Math.min(previewRect.width, previewRect.height) : 220;
  const baseScale = Math.max(previewSize / img.naturalWidth, previewSize / img.naturalHeight);
  const defaultZoom = 1.2;
  modal.state = {
    img,
    size: previewSize,
    baseScale,
    scale: baseScale * defaultZoom,
    zoom: defaultZoom,
    offsetX: 0,
    offsetY: 0
  };
  modal.slider.value = String(defaultZoom);
  clampOffsets(modal.state);
  updatePreviewTransform(modal);
  return new Promise((resolve) => {
    modal.resolver = resolve;
  });
};

const resolveDisplayName = (user, docData) => {
  const byAuth = normalizeName(user?.displayName);
  if (byAuth) return byAuth;
  let localValue = "";
  try {
    localValue = normalizeName(localStorage.getItem("user_nombre"));
  } catch (e) {}
  if (localValue) return localValue;
  const byDoc = normalizeName(resolveNameFromDoc(docData));
  if (byDoc) return byDoc;
  return normalizeName(user?.email) || "Invitado";
};

const resolveAvatarUrl = (user, docData, displayName) => {
  return resolveAvatarUrlFromDoc(
    {
      ...(docData || {}),
      photoURL: docData?.photoURL || user?.photoURL || ""
    },
    {
      uid: user?.uid || "",
      email: user?.email || docData?.email || "",
      name: displayName || ""
    }
  );
};

const resolveAvatarUpdatedAt = (docData, avatarUrl) => resolveAvatarUpdatedAtFromDoc(docData || {}, avatarUrl);

const applyAvatarUI = (menu, url, name, updatedAt = 0, forceBust = false) => {
  const initials = buildInitials(name);
  const slots = Array.isArray(menu.avatarSlots) ? menu.avatarSlots : [];
  slots.forEach((slot) => {
    if (slot.initialsEl) {
      slot.initialsEl.textContent = initials;
      slot.initialsEl.hidden = Boolean(url);
    }
    if (slot.img) {
      if (url) {
        slot.img.src = buildAvatarSrc(url, updatedAt, forceBust);
        slot.img.hidden = false;
      } else {
        slot.img.hidden = true;
      }
    }
    if (slot.wrap) {
      if (url) {
        slot.wrap.setAttribute("data-has-avatar", "1");
      } else {
        slot.wrap.removeAttribute("data-has-avatar");
      }
    }
  });
};

const updateCurrentAvatarSlots = (profile, displayName) => {
  const nodes = Array.from(document.querySelectorAll("[data-dm-avatar-current]"));
  nodes.forEach((node) => {
    applyAvatarElement(node, {
      displayName: profile?.displayName || displayName || "Usuario",
      avatarUrl: profile?.avatarUrl || "",
      avatarUpdatedAt: profile?.avatarUpdatedAt || 0,
      initials: buildInitials(profile?.displayName || displayName || "")
    });
  });
};

const getNoticeEl = (menu) => {
  if (menu.notice) return menu.notice;
  if (!menu.dropdown) return null;
  let notice = menu.dropdown.querySelector("[data-dm-user-avatar-notice]");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "user-menu__notice";
    notice.setAttribute("data-dm-user-avatar-notice", "1");
    notice.setAttribute("hidden", "");
    menu.dropdown.appendChild(notice);
  }
  menu.notice = notice;
  return notice;
};

const setNotice = (menu, message, variant = "warn") => {
  const notice = getNoticeEl(menu);
  if (!notice) return;
  if (!message) {
    notice.textContent = "";
    notice.setAttribute("hidden", "");
    notice.removeAttribute("data-variant");
    return;
  }
  notice.textContent = message;
  notice.removeAttribute("hidden");
  notice.setAttribute("data-variant", variant);
};

const isStorageAuthError = (err) => {
  const code = String(err?.code || "");
  return code === "storage/unauthorized" || code === "storage/unauthenticated";
};

const updateText = (el, value) => {
  if (!el) return;
  el.textContent = value || "";
};

const hasPasswordProvider = (user) =>
  Array.isArray(user?.providerData) &&
  user.providerData.some((provider) => provider?.providerId === "password");

const mapPasswordError = (error) => {
  const code = String(error?.code || "");
  if (code.includes("wrong-password") || code.includes("invalid-credential")) {
    return "La contraseña actual no es correcta.";
  }
  if (code.includes("weak-password")) return "La nueva contraseña es débil.";
  if (code.includes("requires-recent-login")) return "La sesión requiere reautenticación.";
  if (code.includes("too-many-requests")) return "Demasiados intentos. Reintentá más tarde.";
  return "No se pudo completar la operación.";
};

const mapEmailError = (error) => {
  const code = String(error?.code || "");
  if (code.includes("wrong-password") || code.includes("invalid-credential")) {
    return "La contraseña actual no es correcta.";
  }
  if (code.includes("invalid-email")) return "El correo ingresado no es válido.";
  if (code.includes("email-already-in-use")) return "Ese correo ya está registrado.";
  if (code.includes("requires-recent-login")) return "La sesión requiere reautenticación.";
  if (code.includes("too-many-requests")) return "Demasiados intentos. Reintentá más tarde.";
  return "No se pudo actualizar el correo.";
};

let userSecurityModal = null;

const ensureUserMenuStyles = () => {
  if (document.getElementById("dm-user-menu-styles")) return;
  const style = document.createElement("style");
  style.id = "dm-user-menu-styles";
  style.textContent = `
    body [data-dm-user-menu] {
      position: relative;
      display: inline-flex;
      align-items: center;
      min-width: 0;
    }
    body [data-dm-user-menu] [data-dm-user-trigger].user-panel-trigger {
      -webkit-appearance: none;
      appearance: none;
      display: inline-flex;
      align-items: center;
      max-width: min(18rem, 42vw);
      min-height: 2.65rem;
      gap: 0.58rem;
      border: 1px solid rgba(226, 232, 240, 0.92);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.94);
      color: #1e293b;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.07);
      cursor: pointer;
      font: inherit;
      text-align: left;
      transition:
        background 0.18s ease,
        border-color 0.18s ease,
        box-shadow 0.18s ease,
        transform 0.18s ease;
    }
    body [data-dm-user-menu] [data-dm-user-trigger].user-panel-trigger:hover {
      background: #ffffff;
      border-color: rgba(203, 213, 225, 0.96);
      box-shadow: 0 16px 34px rgba(15, 23, 42, 0.1);
      transform: translateY(-1px);
    }
    body [data-dm-user-menu] [data-dm-user-trigger].user-panel-trigger:focus-visible,
    body [data-dm-user-menu] [data-dm-user-dropdown] :is(button, label, input):focus-visible {
      outline: 3px solid rgba(122, 184, 0, 0.28);
      outline-offset: 3px;
    }
    body [data-dm-user-menu] [data-dm-user-trigger-name] {
      min-width: 0;
      max-width: 11rem;
      overflow: hidden;
      color: #1e293b;
      font-size: 0.84rem;
      font-weight: 760;
      line-height: 1.15;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    body [data-dm-user-menu] [data-dm-user-avatar].user-panel-icon,
    body [data-dm-user-menu] [data-dm-user-avatar].user-menu__avatar {
      display: inline-grid;
      width: 2.25rem;
      height: 2.25rem;
      flex: 0 0 2.25rem;
      place-items: center;
      overflow: hidden;
      border: 1px solid rgba(122, 184, 0, 0.42);
      border-radius: 999px;
      background: rgba(122, 184, 0, 0.1);
      color: #6da927;
    }
    body [data-dm-user-menu] [data-dm-user-avatar] .user-avatar-img {
      width: 100%;
      height: 100%;
      border-radius: 999px;
      object-fit: cover;
    }
    body [data-dm-user-menu] [data-dm-user-avatar] .user-avatar-img[hidden] {
      display: none;
    }
    body [data-dm-user-menu] [data-dm-user-avatar] .user-avatar-initials {
      display: grid;
      width: 100%;
      height: 100%;
      place-items: center;
      color: #6da927;
      font-size: 0.76rem;
      font-weight: 850;
      line-height: 1;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown].user-panel-dropdown {
      position: absolute;
      top: calc(100% + 0.7rem);
      right: 0;
      z-index: 2400;
      display: grid;
      width: min(22.5rem, calc(100vw - 1.25rem));
      max-height: min(34rem, calc(100vh - 5.5rem));
      overflow: auto;
      gap: 0.18rem;
      box-sizing: border-box;
      padding: 0.5rem;
      border: 1px solid rgba(226, 232, 240, 0.96);
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow:
        0 24px 54px rgba(15, 23, 42, 0.16),
        0 3px 10px rgba(15, 23, 42, 0.06);
      color: #1e293b;
      -webkit-backdrop-filter: blur(16px) saturate(1.05);
      backdrop-filter: blur(16px) saturate(1.05);
      overscroll-behavior: contain;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown][hidden] {
      display: none !important;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      min-height: 3.1rem;
      gap: 0.72rem;
      box-sizing: border-box;
      width: 100%;
      margin: 0;
      padding: 0.72rem 0.78rem;
      border: 0;
      border-radius: 15px;
      background: transparent;
      color: #334155;
      font: inherit;
      text-align: left;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__row--primary {
      min-height: 3.35rem;
      margin-bottom: 0.18rem;
      background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
      box-shadow: inset 0 0 0 1px rgba(226, 232, 240, 0.82);
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__row--subtle {
      border-bottom: 0;
      transition:
        background 0.16s ease,
        color 0.16s ease,
        transform 0.16s ease;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__row--subtle:hover {
      background: #f8fafc;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__user,
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__label {
      min-width: 0;
      overflow-wrap: anywhere;
      color: #1e293b;
      font-size: 0.86rem;
      font-weight: 780;
      line-height: 1.25;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__label {
      color: #475569;
      font-size: 0.82rem;
      font-weight: 720;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__action,
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__security-action,
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__logout {
      -webkit-appearance: none;
      appearance: none;
      box-sizing: border-box;
      border: 0;
      font: inherit;
      text-decoration: none;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 2rem;
      padding: 0.42rem 0.72rem;
      border-radius: 999px;
      background: rgba(122, 184, 0, 0.1);
      color: #5f8f16;
      font-size: 0.78rem;
      font-weight: 820;
      cursor: pointer;
      transition:
        background 0.16s ease,
        color 0.16s ease,
        transform 0.16s ease;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__action:hover {
      background: rgba(122, 184, 0, 0.16);
      color: #47720c;
      transform: translateY(-1px);
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__security-action {
      width: 100%;
      min-height: 3.05rem;
      cursor: pointer;
      background: rgba(122, 184, 0, 0.07);
      color: #263449;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__security-action:hover {
      background: rgba(122, 184, 0, 0.13);
      color: #1f2a3d;
      transform: translateY(-1px);
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__security-icon {
      display: inline-flex;
      width: 1.15rem;
      height: 1.15rem;
      flex: 0 0 1.15rem;
      color: #7ab800;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__logout {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      width: 100%;
      min-height: 2.65rem;
      margin: 0.28rem 0 0;
      padding: 0.72rem 0.82rem;
      border-radius: 15px;
      background: #f8fafc;
      color: #475569;
      font-size: 0.83rem;
      font-weight: 780;
      cursor: pointer;
      text-align: left;
      transition:
        background 0.16s ease,
        color 0.16s ease,
        transform 0.16s ease;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .user-menu__logout:hover {
      background: rgba(220, 38, 38, 0.08);
      color: #b91c1c;
      text-decoration: none;
      transform: translateY(-1px);
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .push-toggle-hint {
      margin: 0.1rem 0.75rem 0.2rem;
      color: #64748b;
      font-size: 0.78rem;
      line-height: 1.35;
    }
    body [data-dm-user-menu] [data-dm-user-dropdown] .ui-info {
      width: 1.12rem;
      height: 1.12rem;
      border-radius: 999px;
      background: #e7f5dc;
      color: #2f8f31;
      font-size: 0.72rem;
      font-weight: 820;
    }
    @media (max-width: 640px) {
      body [data-dm-user-menu] [data-dm-user-trigger].user-panel-trigger {
        max-width: min(14.5rem, 52vw);
        padding-right: 0.72rem;
      }
      body [data-dm-user-menu] [data-dm-user-trigger-name] {
        max-width: 7rem;
      }
      body [data-dm-user-menu] [data-dm-user-dropdown].user-panel-dropdown {
        right: -0.35rem;
        width: min(21rem, calc(100vw - 1rem));
        max-height: calc(100vh - 4.5rem);
      }
    }
  `;
  document.head.appendChild(style);
};

const ensureUserSecurityStyles = () => {
  if (document.getElementById("dm-user-security-styles")) return;
  const style = document.createElement("style");
  style.id = "dm-user-security-styles";
  style.textContent = `
    .user-menu__security-action {
      width: 100%;
      border: 0;
      background: rgba(122, 184, 0, 0.06);
      font: inherit;
      cursor: pointer;
      text-align: left;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #263449;
      border-radius: 14px;
      transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease;
    }
    .user-menu__security-action:hover {
      background: rgba(122, 184, 0, 0.12);
      color: #1f2a3d;
      transform: translateY(-1px);
    }
    .user-menu__security-icon {
      width: 19px;
      height: 19px;
      color: #7ab800;
      flex: 0 0 auto;
    }
    .user-menu__security-icon svg,
    .password-visibility-toggle svg {
      width: 100%;
      height: 100%;
      display: block;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .user-menu__security-action .user-menu__label {
      font-weight: 800;
    }
    .user-security-modal {
      position: fixed;
      inset: 0;
      z-index: 10040;
      display: grid;
      place-items: center;
      padding: 18px;
      background: rgba(248, 250, 252, 0.74);
      -webkit-backdrop-filter: blur(18px) saturate(1.15);
      backdrop-filter: blur(18px) saturate(1.15);
    }
    .user-security-modal[hidden] { display: none; }
    .user-security-modal__dialog {
      width: min(100%, 820px);
      max-height: min(88vh, 820px);
      overflow: auto;
      border: 1px solid rgba(122, 184, 0, 0.24);
      border-radius: 24px;
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.94), rgba(248, 251, 255, 0.88));
      box-shadow: 0 32px 96px rgba(15, 23, 42, 0.18);
      color: #182033;
      scrollbar-gutter: stable;
    }
    .user-security-modal__header,
    .user-security-modal__section {
      padding: clamp(18px, 3vw, 26px);
      border-bottom: 1px solid rgba(148, 163, 184, 0.22);
    }
    .user-security-modal__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .user-security-modal__section {
      position: relative;
      background: rgba(255, 255, 255, 0.38);
    }
    .user-security-modal__section::before {
      content: "";
      position: absolute;
      top: 0;
      left: clamp(18px, 3vw, 26px);
      width: 72px;
      height: 3px;
      border-radius: 999px;
      background: linear-gradient(90deg, #7ab800, rgba(122, 184, 0, 0.2));
    }
    .user-security-modal__header h2,
    .user-security-modal__section h3 {
      margin: 0;
      line-height: 1.15;
      letter-spacing: 0;
      color: #111827;
    }
    .user-security-modal__header h2 { font-size: clamp(1.35rem, 3vw, 1.9rem); }
    .user-security-modal__section h3 { font-size: 1.08rem; }
    .user-security-modal__section-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 14px;
    }
    .user-security-modal__section-header p {
      margin-top: 5px;
      color: #66788f;
      font-size: 0.9rem;
    }
    .user-security-modal__section-kicker {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 7px;
      color: #5e9900;
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .user-security-modal__section-card {
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.58);
      padding: clamp(14px, 2.5vw, 18px);
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.06);
    }
    .user-security-modal__section-card h4 {
      margin: 0 0 6px;
      font-size: 1rem;
      line-height: 1.2;
      color: #111827;
    }
    .user-security-modal__section p {
      margin: 8px 0 0;
      color: #64748b;
      line-height: 1.5;
    }
    .user-security-modal__close {
      width: 40px;
      height: 40px;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: #fff;
      color: #334155;
      cursor: pointer;
      font-size: 1.4rem;
      line-height: 1;
    }
    .user-security-modal__grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 14px;
    }
    .user-security-modal__field {
      display: grid;
      gap: 6px;
      color: #344256;
      font-size: 0.82rem;
      font-weight: 800;
    }
    .user-security-modal__field--wide { grid-column: 1 / -1; }
    .user-security-modal input {
      width: 100%;
      box-sizing: border-box;
      min-height: 46px;
      border: 1px solid rgba(148, 163, 184, 0.45);
      border-radius: 14px;
      padding: 10px 12px;
      font: inherit;
      background: rgba(255, 255, 255, 0.94);
      color: #182033;
    }
    .user-security-modal input[readonly],
    .user-security-modal input:disabled {
      background: rgba(241, 245, 249, 0.84);
      color: #64748b;
    }
    .user-security-modal input:focus {
      outline: none;
      border-color: #7ab800;
      box-shadow: 0 0 0 4px rgba(122, 184, 0, 0.16);
    }
    .user-security-modal__email-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: end;
      margin-top: 14px;
    }
    .user-security-modal__email-panel {
      margin: 14px 0;
      border: 1px solid rgba(122, 184, 0, 0.2);
      border-radius: 18px;
      padding: 14px;
      background: rgba(240, 253, 244, 0.58);
    }
    .user-security-modal__password-wrap {
      position: relative;
      display: block;
    }
    .user-security-modal__password-wrap input {
      padding-right: 48px;
    }
    .password-visibility-toggle {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      width: 34px;
      height: 34px;
      display: inline-grid;
      place-items: center;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: #6b7b90;
      cursor: pointer;
    }
    .password-visibility-toggle:hover,
    .password-visibility-toggle:focus-visible {
      color: #5e9900;
      background: rgba(122, 184, 0, 0.12);
      outline: none;
    }
    .user-security-modal__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 14px;
    }
    .user-security-modal__button {
      min-height: 42px;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.36);
      padding: 0 16px;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
      background: #fff;
      color: #334155;
    }
    .user-security-modal__button--secondary {
      background: rgba(255, 255, 255, 0.66);
      color: #40516a;
    }
    .user-security-modal__button--primary {
      border-color: #7ab800;
      background: #7ab800;
      color: #fff;
      box-shadow: 0 14px 28px rgba(122, 184, 0, 0.2);
    }
    .user-security-modal__status {
      margin-top: 12px;
      border-radius: 12px;
      padding: 10px 12px;
      background: rgba(122, 184, 0, 0.12);
      color: #365314;
      font-size: 0.86rem;
      font-weight: 700;
    }
    .user-security-modal__status[data-variant="error"] {
      background: rgba(239, 68, 68, 0.12);
      color: #991b1b;
    }
    .user-security-modal__results {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }
    .user-security-modal__result {
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 14px;
      background: rgba(248, 250, 252, 0.74);
      padding: 12px;
      cursor: pointer;
      text-align: left;
      display: grid;
      gap: 8px;
    }
    .user-security-modal__result-title {
      font-weight: 900;
      color: #182033;
    }
    .user-security-modal__result-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 12px;
      color: #52647a;
      font-size: 0.84rem;
    }
    .user-security-modal__result-grid strong {
      color: #334155;
      font-weight: 900;
    }
    .user-security-modal__result[aria-selected="true"] {
      border-color: #7ab800;
      box-shadow: 0 0 0 3px rgba(122, 184, 0, 0.14);
    }
    .user-security-modal__temp {
      margin-top: 12px;
      border: 1px solid rgba(122, 184, 0, 0.24);
      border-radius: 16px;
      padding: 12px;
      background: rgba(240, 253, 244, 0.72);
    }
    .user-security-modal__temp code {
      display: block;
      padding: 10px;
      border-radius: 12px;
      background: #111827;
      color: #fff;
      font-size: 1rem;
      overflow-wrap: anywhere;
    }
    @media (max-width: 640px) {
      .user-security-modal__grid { grid-template-columns: 1fr; }
      .user-security-modal__email-row { grid-template-columns: 1fr; }
      .user-security-modal__result-grid { grid-template-columns: 1fr; }
      .user-security-modal__actions { justify-content: stretch; }
      .user-security-modal__button { width: 100%; }
    }
  `;
  document.head.appendChild(style);
};

const setModalStatus = (el, message = "", variant = "info") => {
  if (!el) return;
  el.textContent = message;
  el.dataset.variant = variant;
  el.hidden = !message;
};

const ensureUserSecurityModal = () => {
  if (userSecurityModal) return userSecurityModal;
  ensureUserSecurityStyles();
  const overlay = document.createElement("div");
  overlay.className = "user-security-modal";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="user-security-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="user-security-title">
      <header class="user-security-modal__header">
        <div>
          <h2 id="user-security-title">Mi perfil y seguridad</h2>
          <p>Gestioná tus datos visibles y el acceso a tu cuenta.</p>
        </div>
        <button class="user-security-modal__close" type="button" data-security-close aria-label="Cerrar">×</button>
      </header>
      <section class="user-security-modal__section">
        <div class="user-security-modal__section-header">
          <div>
            <span class="user-security-modal__section-kicker">Perfil</span>
            <h3>Datos de cuenta</h3>
            <p>Actualizá tu nombre visible, usuario y datos de contacto verificados.</p>
          </div>
        </div>
        <div class="user-security-modal__section-card">
          <div class="user-security-modal__email-row">
            <label class="user-security-modal__field">
              Email
              <input data-profile-email type="email" readonly />
            </label>
            <button class="user-security-modal__button user-security-modal__button--secondary" type="button" data-email-change-toggle>Cambiar correo</button>
          </div>
          <div class="user-security-modal__email-panel" data-email-change-panel hidden>
            <p data-email-external hidden>Tu correo se administra desde el proveedor externo.</p>
            <form data-email-form>
              <div class="user-security-modal__grid">
                <label class="user-security-modal__field">
                  Nuevo correo
                  <input data-email-new type="email" autocomplete="email" />
                </label>
                <label class="user-security-modal__field" data-password-field>
                  Contraseña actual
                  <span class="user-security-modal__password-wrap">
                    <input data-email-current-password type="password" autocomplete="current-password" />
                    <button class="password-visibility-toggle" type="button" data-password-visibility></button>
                  </span>
                </label>
              </div>
              <p>Te enviaremos un correo de verificación. El email visible se actualizará cuando Firebase Auth confirme el cambio.</p>
              <div class="user-security-modal__actions">
                <button class="user-security-modal__button" type="button" data-email-cancel>Cancelar</button>
                <button class="user-security-modal__button user-security-modal__button--primary" type="submit">Actualizar correo</button>
              </div>
            </form>
            <p class="user-security-modal__status" data-email-status hidden></p>
          </div>
          <form data-profile-form>
            <div class="user-security-modal__grid">
              <label class="user-security-modal__field">
                Usuario / alias
                <input data-profile-username type="text" autocomplete="username" autocapitalize="off" spellcheck="false" />
              </label>
              <label class="user-security-modal__field">
                Nombre visible
                <input data-profile-display-name type="text" autocomplete="name" />
              </label>
            </div>
            <p>La imagen de perfil se gestiona desde “Cambiar imagen de perfil” en este mismo menú.</p>
            <div class="user-security-modal__actions">
              <button class="user-security-modal__button user-security-modal__button--primary" type="submit">Guardar perfil</button>
            </div>
            <p class="user-security-modal__status" data-profile-status hidden></p>
          </form>
        </div>
      </section>
      <section class="user-security-modal__section">
        <div class="user-security-modal__section-header">
          <div>
            <span class="user-security-modal__section-kicker">Seguridad</span>
            <h3>Contraseña y acceso</h3>
            <p>Gestioná la contraseña local de tu cuenta con reautenticación segura.</p>
          </div>
        </div>
        <div class="user-security-modal__section-card">
          <form data-password-form>
            <div class="user-security-modal__grid">
              <label class="user-security-modal__field user-security-modal__field--wide" data-password-field>
                Contraseña actual
                <span class="user-security-modal__password-wrap">
                  <input data-password-current type="password" autocomplete="current-password" />
                  <button class="password-visibility-toggle" type="button" data-password-visibility></button>
                </span>
              </label>
              <label class="user-security-modal__field" data-password-field>
                Nueva contraseña
                <span class="user-security-modal__password-wrap">
                  <input data-password-new type="password" autocomplete="new-password" />
                  <button class="password-visibility-toggle" type="button" data-password-visibility></button>
                </span>
              </label>
              <label class="user-security-modal__field" data-password-field>
                Confirmar nueva contraseña
                <span class="user-security-modal__password-wrap">
                  <input data-password-confirm type="password" autocomplete="new-password" />
                  <button class="password-visibility-toggle" type="button" data-password-visibility></button>
                </span>
              </label>
            </div>
            <p>Por seguridad, se solicitará reautenticación con tu contraseña actual.</p>
            <div class="user-security-modal__actions">
              <button class="user-security-modal__button user-security-modal__button--primary" type="submit">Cambiar contraseña</button>
            </div>
          </form>
          <div data-provider-external hidden>
            <p>Tu cuenta usa un proveedor externo. La contraseña se administra desde ese proveedor.</p>
          </div>
          <p class="user-security-modal__status" data-password-status hidden></p>
        </div>
      </section>
      <section class="user-security-modal__section user-security-modal__admin" data-admin-section hidden>
        <div class="user-security-modal__section-header">
          <div>
            <span class="user-security-modal__section-kicker">SuperAdmin</span>
            <h3>Administración de usuarios</h3>
            <p>Acciones restringidas a superAdmin. Todas las operaciones quedan auditadas.</p>
          </div>
        </div>
        <div class="user-security-modal__section-card admin-reset-user-panel">
          <h4>Restablecer usuario</h4>
          <p>Para ver esta sección tu usuario debe tener claim superAdmin y haber iniciado sesión nuevamente después de asignarlo.</p>
          <div class="user-security-modal__grid">
            <label class="user-security-modal__field user-security-modal__field--wide">
              Buscar por usuario, email o UID
              <input data-admin-query type="text" autocomplete="off" spellcheck="false" />
            </label>
          </div>
          <div class="user-security-modal__actions">
            <button class="user-security-modal__button" type="button" data-admin-search>Buscar usuario</button>
            <button class="user-security-modal__button" type="button" data-admin-reset-email>Enviar recuperación por email</button>
            <button class="user-security-modal__button user-security-modal__button--primary" type="button" data-admin-temp>Generar contraseña temporal</button>
          </div>
          <div class="user-security-modal__results" data-admin-results></div>
          <label class="user-security-modal__field user-security-modal__field--wide">
            Confirmación textual
            <input data-admin-confirm type="text" placeholder="Escribí RESTABLECER para continuar" autocomplete="off" />
          </label>
          <p>La acción quedará auditada. No se almacena la contraseña temporal.</p>
          <div class="user-security-modal__temp" data-admin-temp-result hidden>
            <p>Esta contraseña se muestra una sola vez. Entregala por un canal seguro. El usuario deberá cambiarla al ingresar.</p>
            <code data-admin-temp-password></code>
            <div class="user-security-modal__actions">
              <button class="user-security-modal__button" type="button" data-admin-copy-temp>Copiar</button>
            </div>
          </div>
          <p class="user-security-modal__status" data-admin-status hidden></p>
        </div>
      </section>
    </section>
  `;
  document.body.appendChild(overlay);
  bindPasswordVisibility(overlay);
  userSecurityModal = {
    overlay,
    dialog: overlay.querySelector(".user-security-modal__dialog"),
    close: overlay.querySelector("[data-security-close]"),
    profileForm: overlay.querySelector("[data-profile-form]"),
    profileEmail: overlay.querySelector("[data-profile-email]"),
    profileDisplayName: overlay.querySelector("[data-profile-display-name]"),
    profileUsername: overlay.querySelector("[data-profile-username]"),
    profileStatus: overlay.querySelector("[data-profile-status]"),
    emailToggle: overlay.querySelector("[data-email-change-toggle]"),
    emailPanel: overlay.querySelector("[data-email-change-panel]"),
    emailForm: overlay.querySelector("[data-email-form]"),
    emailExternal: overlay.querySelector("[data-email-external]"),
    emailNew: overlay.querySelector("[data-email-new]"),
    emailCurrentPassword: overlay.querySelector("[data-email-current-password]"),
    emailCancel: overlay.querySelector("[data-email-cancel]"),
    emailStatus: overlay.querySelector("[data-email-status]"),
    passwordForm: overlay.querySelector("[data-password-form]"),
    passwordCurrent: overlay.querySelector("[data-password-current]"),
    passwordNew: overlay.querySelector("[data-password-new]"),
    passwordConfirm: overlay.querySelector("[data-password-confirm]"),
    passwordStatus: overlay.querySelector("[data-password-status]"),
    providerExternal: overlay.querySelector("[data-provider-external]"),
    adminSection: overlay.querySelector("[data-admin-section]"),
    adminQuery: overlay.querySelector("[data-admin-query]"),
    adminSearch: overlay.querySelector("[data-admin-search]"),
    adminResetEmail: overlay.querySelector("[data-admin-reset-email]"),
    adminTemp: overlay.querySelector("[data-admin-temp]"),
    adminConfirm: overlay.querySelector("[data-admin-confirm]"),
    adminResults: overlay.querySelector("[data-admin-results]"),
    adminStatus: overlay.querySelector("[data-admin-status]"),
    adminTempResult: overlay.querySelector("[data-admin-temp-result]"),
    adminTempPassword: overlay.querySelector("[data-admin-temp-password]"),
    adminCopyTemp: overlay.querySelector("[data-admin-copy-temp]"),
    selectedUser: null,
    lastFocus: null
  };
  return userSecurityModal;
};

const clearTemporaryPassword = (modal) => {
  modal.adminTempPassword.textContent = "";
  modal.adminTempResult.hidden = true;
};

const closeUserSecurityModal = () => {
  const modal = ensureUserSecurityModal();
  clearTemporaryPassword(modal);
  modal.emailNew.value = "";
  modal.emailCurrentPassword.value = "";
  modal.emailPanel.hidden = true;
  modal.overlay.hidden = true;
  document.body.classList.remove("dm-modal-open");
  modal.lastFocus?.focus?.();
};

const renderAdminResults = (modal, users = []) => {
  modal.adminResults.textContent = "";
  modal.selectedUser = null;
  users.forEach((user) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "user-security-modal__result";
    button.setAttribute("aria-selected", "false");
    const title = document.createElement("span");
    title.className = "user-security-modal__result-title";
    title.textContent = user.displayName || "Usuario";
    const grid = document.createElement("span");
    grid.className = "user-security-modal__result-grid";
    [
      ["Nombre", user.displayName || "Usuario"],
      ["Usuario", user.username || "sin usuario"],
      ["Email", user.emailMasked || "sin email"],
      ["Provider", (user.providerIds || []).join(", ") || "sin proveedor"],
      ["Estado", user.active === false ? "inactivo" : "activo"],
      ["Acceso", user.forcePasswordChange ? "cambio obligatorio activo" : "sin bloqueo"],
    ].forEach(([label, value]) => {
      const item = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = `${label}: `;
      item.append(strong, document.createTextNode(value));
      grid.appendChild(item);
    });
    button.append(title, grid);
    button.addEventListener("click", () => {
      Array.from(modal.adminResults.children).forEach((child) =>
        child.setAttribute("aria-selected", "false")
      );
      button.setAttribute("aria-selected", "true");
      modal.selectedUser = user;
      setModalStatus(modal.adminStatus, `Seleccionado: ${user.displayName || user.uid}`, "info");
      clearTemporaryPassword(modal);
    });
    modal.adminResults.appendChild(button);
  });
  if (!users.length) {
    const empty = document.createElement("p");
    empty.textContent = "No se encontraron usuarios.";
    modal.adminResults.appendChild(empty);
  }
};

const bindUserSecurityModal = (modal) => {
  if (modal.bound) return;
  modal.bound = true;
  modal.close.addEventListener("click", closeUserSecurityModal);
  modal.overlay.addEventListener("click", (event) => {
    if (event.target === modal.overlay) closeUserSecurityModal();
  });
  document.addEventListener("keydown", (event) => {
    if (modal.overlay.hidden) return;
    if (event.key === "Escape") closeUserSecurityModal();
  });
};

const openUserSecurityModal = async ({ auth, db, user, docData, menu }) => {
  if (!user) return;
  const modal = ensureUserSecurityModal();
  bindUserSecurityModal(modal);
  modal.lastFocus = document.activeElement;
  modal.profileEmail.value = user.email || docData?.email || "";
  modal.profileDisplayName.value = resolveDisplayName(user, docData);
  modal.profileUsername.value = docData?.username || docData?.usernameLower || "";
  modal.emailNew.value = "";
  modal.emailCurrentPassword.value = "";
  modal.emailPanel.hidden = true;
  modal.passwordCurrent.value = "";
  modal.passwordNew.value = "";
  modal.passwordConfirm.value = "";
  modal.adminQuery.value = "";
  modal.adminConfirm.value = "";
  modal.adminResults.textContent = "";
  modal.selectedUser = null;
  clearTemporaryPassword(modal);
  setModalStatus(modal.profileStatus, "", "info");
  setModalStatus(modal.emailStatus, "", "info");
  setModalStatus(modal.passwordStatus, "", "info");
  setModalStatus(modal.adminStatus, "", "info");

  const passwordProvider = hasPasswordProvider(user);
  modal.passwordForm.hidden = !passwordProvider;
  modal.providerExternal.hidden = passwordProvider;
  modal.emailForm.hidden = !passwordProvider;
  modal.emailExternal.hidden = passwordProvider;

  try {
    const syncResult = await syncMyAuthEmail();
    if (syncResult?.email) modal.profileEmail.value = syncResult.email;
  } catch (error) {
    // Keep the modal usable if email sync is unavailable.
  }

  let isSuperAdmin = false;
  try {
    const token = await user.getIdTokenResult();
    const claims = token?.claims || {};
    isSuperAdmin = claims.superAdmin === true;
  } catch (error) {
    isSuperAdmin = false;
  }
  modal.adminSection.hidden = !isSuperAdmin;

  modal.profileForm.onsubmit = async (event) => {
    event.preventDefault();
    try {
      setModalStatus(modal.profileStatus, "Guardando perfil...", "info");
      const result = await updateMyProfileCallable({
        displayName: modal.profileDisplayName.value,
        username: modal.profileUsername.value,
      });
      const profile = result.profile || {};
      const nextName = profile.displayName || modal.profileDisplayName.value.trim();
      updateText(menu.triggerName, nextName);
      updateText(menu.fullname, nextName);
      try {
        localStorage.setItem("user_nombre", nextName);
      } catch (e) {}
      setUserProfileCache(user.uid, { displayName: nextName });
      setModalStatus(modal.profileStatus, "Perfil actualizado.", "info");
    } catch (error) {
      setModalStatus(modal.profileStatus, "No se pudo guardar el perfil.", "error");
    }
  };

  modal.emailToggle.onclick = () => {
    modal.emailPanel.hidden = !modal.emailPanel.hidden;
    setModalStatus(modal.emailStatus, "", "info");
    modal.emailNew.value = "";
    modal.emailCurrentPassword.value = "";
    if (!modal.emailPanel.hidden && passwordProvider) {
      window.setTimeout(() => modal.emailNew?.focus(), 0);
    }
  };

  modal.emailCancel.onclick = () => {
    modal.emailPanel.hidden = true;
    modal.emailNew.value = "";
    modal.emailCurrentPassword.value = "";
    setModalStatus(modal.emailStatus, "", "info");
  };

  modal.emailForm.onsubmit = async (event) => {
    event.preventDefault();
    if (!passwordProvider) {
      setModalStatus(modal.emailStatus, "Tu correo se administra desde el proveedor externo.", "error");
      return;
    }
    const nextEmail = (modal.emailNew.value || "").trim().toLowerCase();
    const currentPassword = modal.emailCurrentPassword.value || "";
    if (!nextEmail || !currentPassword) {
      setModalStatus(modal.emailStatus, "Completá el nuevo correo y tu contraseña actual.", "error");
      return;
    }
    try {
      setModalStatus(modal.emailStatus, "Enviando verificación de correo...", "info");
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await verifyBeforeUpdateEmail(user, nextEmail);
      await recordEmailChangeRequested({ newEmail: nextEmail });
      modal.emailNew.value = "";
      modal.emailCurrentPassword.value = "";
      setModalStatus(
        modal.emailStatus,
        "Te enviamos un correo de verificación. El cambio se aplicará cuando confirmes desde ese email.",
        "info"
      );
    } catch (error) {
      setModalStatus(modal.emailStatus, mapEmailError(error), "error");
    }
  };

  modal.passwordForm.onsubmit = async (event) => {
    event.preventDefault();
    const currentPassword = modal.passwordCurrent.value || "";
    const nextPassword = modal.passwordNew.value || "";
    const confirmPassword = modal.passwordConfirm.value || "";
    if (!currentPassword || !nextPassword) {
      setModalStatus(modal.passwordStatus, "Completá la contraseña actual y la nueva.", "error");
      return;
    }
    if (nextPassword !== confirmPassword) {
      setModalStatus(modal.passwordStatus, "La confirmación no coincide.", "error");
      return;
    }
    try {
      setModalStatus(modal.passwordStatus, "Actualizando contraseña...", "info");
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, nextPassword);
      try {
        await recordMyPasswordChange();
      } catch (e) {}
      modal.passwordCurrent.value = "";
      modal.passwordNew.value = "";
      modal.passwordConfirm.value = "";
      setModalStatus(modal.passwordStatus, "Contraseña actualizada.", "info");
    } catch (error) {
      setModalStatus(modal.passwordStatus, mapPasswordError(error), "error");
    }
  };

  modal.adminSearch.onclick = async () => {
    try {
      clearTemporaryPassword(modal);
      setModalStatus(modal.adminStatus, "Buscando usuario...", "info");
      const result = await adminResolveUser({ query: modal.adminQuery.value });
      renderAdminResults(modal, result.users || []);
      setModalStatus(modal.adminStatus, "", "info");
    } catch (error) {
      renderAdminResults(modal, []);
      setModalStatus(modal.adminStatus, "No se pudo buscar el usuario.", "error");
    }
  };

  modal.adminResetEmail.onclick = async () => {
    if (!modal.selectedUser?.uid) {
      setModalStatus(modal.adminStatus, "Seleccioná un usuario.", "error");
      return;
    }
    try {
      setModalStatus(modal.adminStatus, "Registrando recuperación por email...", "info");
      await adminSendPasswordReset({ uid: modal.selectedUser.uid });
      setModalStatus(modal.adminStatus, "Recuperación por email registrada. No se expuso ningún link.", "info");
    } catch (error) {
      setModalStatus(modal.adminStatus, "No se pudo generar la recuperación por email.", "error");
    }
  };

  modal.adminTemp.onclick = async () => {
    if (!modal.selectedUser?.uid) {
      setModalStatus(modal.adminStatus, "Seleccioná un usuario.", "error");
      return;
    }
    if (modal.adminConfirm.value.trim() !== "RESTABLECER") {
      setModalStatus(modal.adminStatus, "Escribí RESTABLECER para continuar.", "error");
      return;
    }
    try {
      clearTemporaryPassword(modal);
      setModalStatus(modal.adminStatus, "Generando contraseña temporal...", "info");
      const result = await adminIssueTemporaryPassword({
        uid: modal.selectedUser.uid,
        confirmation: modal.adminConfirm.value.trim(),
      });
      modal.adminTempPassword.textContent = result.temporaryPassword || "";
      modal.adminTempResult.hidden = false;
      modal.adminConfirm.value = "";
      setModalStatus(modal.adminStatus, "Contraseña temporal generada.", "info");
    } catch (error) {
      setModalStatus(modal.adminStatus, "No se pudo generar la contraseña temporal.", "error");
    }
  };

  modal.adminCopyTemp.onclick = async () => {
    const value = modal.adminTempPassword.textContent || "";
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setModalStatus(modal.adminStatus, "Contraseña temporal copiada.", "info");
    } catch (error) {
      setModalStatus(modal.adminStatus, "No se pudo copiar.", "error");
    }
  };

  modal.overlay.hidden = false;
  document.body.classList.add("dm-modal-open");
  window.setTimeout(() => modal.profileDisplayName?.focus(), 0);
};

const injectSecurityAction = (menu, onClick) => {
  if (!menu.dropdown || menu.dropdown.querySelector("[data-dm-user-security-open]")) return;
  const action = document.createElement("button");
  action.type = "button";
  action.className = "user-menu__row user-menu__row--subtle user-menu__security-action";
  action.setAttribute("data-dm-user-security-open", "1");
  action.innerHTML = `
    <span class="user-menu__security-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M12 3.2 19 6v5.2c0 4.4-2.8 8.3-7 9.7-4.2-1.4-7-5.3-7-9.7V6l7-2.8Z" />
        <path d="m9 12.1 2 2 4.1-4.4" />
      </svg>
    </span>
    <span class="user-menu__label">Mi perfil y seguridad</span>
  `;
  action.addEventListener("click", onClick);
  const avatarRow = menu.dropdown.querySelector("[data-dm-user-avatar-upload-row]");
  if (avatarRow?.nextSibling) {
    menu.dropdown.insertBefore(action, avatarRow.nextSibling);
    return;
  }
  if (menu.logoutBtn) {
    menu.dropdown.insertBefore(action, menu.logoutBtn);
    return;
  }
  menu.dropdown.appendChild(action);
};

const initMenuInstance = (container, { auth, db, storage }) => {
  if (container.dataset.dmUserMenuReady === "1") return;
  container.dataset.dmUserMenuReady = "1";
  const menu = {
    container,
    trigger: container.querySelector("[data-dm-user-trigger]"),
    triggerName: container.querySelector("[data-dm-user-trigger-name]"),
    dropdown: container.querySelector("[data-dm-user-dropdown]"),
    fullname: container.querySelector("[data-dm-user-fullname]"),
    logoutBtn: container.querySelector("[data-dm-user-logout]"),
    notifToggle: container.querySelector("[data-dm-user-notif-toggle]"),
    avatarInput: container.querySelector("[data-dm-user-avatar-input]"),
    notice: container.querySelector("[data-dm-user-avatar-notice]"),
    avatarSlots: Array.from(container.querySelectorAll("[data-dm-user-avatar]")).map((wrap) => ({
      wrap,
      img: wrap.querySelector("[data-dm-user-avatar-img]"),
      initialsEl: wrap.querySelector("[data-dm-user-avatar-initials]")
    }))
  };

  const closeDropdown = () => {
    if (menu.dropdown) menu.dropdown.setAttribute("hidden", "");
    menu.trigger?.setAttribute("aria-expanded", "false");
  };

  const toggleDropdown = () => {
    if (!menu.dropdown) return;
    const willOpen = menu.dropdown.hasAttribute("hidden");
    if (willOpen) {
      menu.dropdown.removeAttribute("hidden");
    } else {
      menu.dropdown.setAttribute("hidden", "");
    }
    menu.trigger?.setAttribute("aria-expanded", willOpen ? "true" : "false");
  };

  menu.trigger?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleDropdown();
  });

  document.addEventListener("click", (event) => {
    if (!menu.dropdown || menu.dropdown.hasAttribute("hidden")) return;
    if (!menu.container.contains(event.target)) {
      closeDropdown();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDropdown();
  });

  menu.logoutBtn?.addEventListener("click", async (event) => {
    event.preventDefault();
    closeDropdown();
    if (!auth) return;
    try {
      await performManagedLogout({
        auth,
        db,
        reason: "manual_logout"
      });
    } catch (err) {
      warnOnce("logout", "No se pudo cerrar sesion.", err);
    }
  });

  if (menu.notifToggle && !menu.notifToggle.hasAttribute("data-dm-user-notif-external")) {
    let stored = "1";
    try {
      stored = localStorage.getItem("dm_notif_enabled") || "1";
    } catch (e) {}
    menu.notifToggle.checked = stored !== "0";
    menu.notifToggle.addEventListener("change", () => {
      try {
        localStorage.setItem("dm_notif_enabled", menu.notifToggle.checked ? "1" : "0");
      } catch (e) {}
    });
  }

  let currentUser = null;
  let currentDocData = null;
  injectSecurityAction(menu, (event) => {
    event.preventDefault();
    closeDropdown();
    openUserSecurityModal({ auth, db, user: currentUser, docData: currentDocData, menu });
  });

  const updateFromUser = async (user) => {
    currentUser = user || null;
    currentDocData = null;
    if (!user) {
      updateText(menu.triggerName, "Invitado");
      updateText(menu.fullname, "Invitado");
      applyAvatarUI(menu, "", "Invitado");
      updateCurrentAvatarSlots(
        { displayName: "Invitado", avatarUrl: "", avatarUpdatedAt: 0, initials: "??" },
        "Invitado"
      );
      menu.container.setAttribute("data-dm-user-state", "guest");
      closeDropdown();
      return;
    }
    menu.container.removeAttribute("data-dm-user-state");
    let docData = null;
    try {
      if (db && user?.uid) {
        const snap = await getDoc(doc(db, "usuarios", user.uid));
        if (snap.exists()) docData = snap.data() || null;
      }
    } catch (err) {
      warnOnce("userdoc", "No se pudo leer el perfil del usuario.", err);
    }
    currentDocData = docData;

    const displayName = resolveDisplayName(user, docData);
    updateText(menu.triggerName, displayName);
    updateText(menu.fullname, displayName);
    const avatarProfile = {
      displayName,
      avatarUrl: resolveAvatarUrl(user, docData, displayName),
      avatarUpdatedAt: 0,
      initials: buildInitials(displayName)
    };
    avatarProfile.avatarUpdatedAt = resolveAvatarUpdatedAt(
      {
        ...(docData || {}),
        photoURL: docData?.photoURL || user?.photoURL || ""
      },
      avatarProfile.avatarUrl
    );
    if (user?.uid) setUserProfileCache(user.uid, avatarProfile);
    applyAvatarUI(menu, avatarProfile.avatarUrl, displayName, avatarProfile.avatarUpdatedAt);
    updateCurrentAvatarSlots(avatarProfile, displayName);
    setNotice(menu, "");
  };

  if (auth) {
    onAuthStateChanged(auth, updateFromUser);
  } else {
    updateFromUser(null);
  }

  menu.avatarInput?.addEventListener("change", async (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;
    const uid = auth?.currentUser?.uid;
    if (!uid) {
      warnOnce("upload-auth", "No hay usuario autenticado para subir avatar.");
      setNotice(menu, "Necesitas iniciar sesion para subir una foto.", "error");
      return;
    }
    if (!storage) {
      warnOnce("upload-storage", "Storage no disponible para subir avatar.");
      setNotice(menu, "No se pudo acceder al almacenamiento.", "error");
      return;
    }
    if (!file.type.startsWith("image/")) {
      warnOnce("upload-type", "Formato de imagen no valido.");
      setNotice(menu, "El archivo no es una imagen válida.", "error");
      return;
    }
    try {
      setNotice(menu, "");
      const blob = await openAvatarCropModal(file);
      if (!blob) return;
      const path = `avatars/${uid}/avatar.jpg`;
      const avatarRef = ref(storage, path);
      await uploadBytes(avatarRef, blob, { contentType: "image/jpeg" });
      const url = await getDownloadURL(avatarRef);
      const updatedAt = Date.now();
      if (db) {
        await setDoc(
          doc(db, "usuarios", uid),
          { avatarUrl: url, avatarUpdatedAt: serverTimestamp() },
          { merge: true }
        );
      }
      try {
        if (auth?.currentUser) {
          await updateProfile(auth.currentUser, { photoURL: url });
        }
      } catch (e) {}
      const displayName = resolveDisplayName(currentUser, null);
      const avatarProfile = {
        displayName,
        avatarUrl: url,
        avatarUpdatedAt: updatedAt,
        initials: buildInitials(displayName)
      };
      setUserProfileCache(uid, avatarProfile);
      applyAvatarUI(menu, url, displayName, updatedAt, true);
      updateCurrentAvatarSlots(avatarProfile, displayName);
      window.dispatchEvent(
        new CustomEvent("dm:avatar-updated", { detail: { uid, url, updatedAt, displayName } })
      );
      setNotice(menu, "");
    } catch (err) {
      if (isStorageAuthError(err)) {
        setNotice(menu, "No tenes permisos para subir la foto. Reintenta iniciar sesion.", "error");
        warnOnce("upload-authz", "Permisos insuficientes para subir avatar.", err);
      } else {
        setNotice(menu, "No se pudo subir la imagen. Reintenta.", "error");
        warnOnce("upload-fail", "No se pudo subir la imagen.", err);
      }
    } finally {
      event.target.value = "";
    }
  });
};

export const initUserMenu = ({ variant } = {}) => {
  const containers = Array.from(document.querySelectorAll("[data-dm-user-menu]"));
  if (!containers.length) return;
  ensureUserMenuStyles();
  const firebase = getFirebase();
  const { auth, db, storage } = firebase || {};
  containers.forEach((container) => {
    if (variant && container.dataset.variant && container.dataset.variant !== variant) return;
    initMenuInstance(container, { auth, db, storage });
  });
};
