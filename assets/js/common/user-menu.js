import { onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getFirebase } from "./firebaseClient.js";
import { logger, once as logOnce } from "./app-logger.js";
import {
  buildInitials,
  resolveNameFromDoc,
  resolveAvatarUrlFromDoc,
  normalizeUpdatedAt,
  buildAvatarSrc,
  applyAvatarElement,
  setUserProfileCache
} from "./user-profiles.js";

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
        <img class="dm-avatar-preview__img" alt="Preview avatar" />
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

const resolveAvatarUrl = (user, docData) => {
  return resolveAvatarUrlFromDoc(docData) || user?.photoURL || "";
};

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

const resolveAvatarUpdatedAt = (docData) => normalizeUpdatedAt(docData?.avatarUpdatedAt);

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

const initMenuInstance = (container, { auth, db, storage }) => {
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
      await signOut(auth);
    } catch (err) {
      warnOnce("logout", "No se pudo cerrar sesion.", err);
    }
    window.location.href = "/login.html";
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
  const updateFromUser = async (user) => {
    currentUser = user || null;
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

    const displayName = resolveDisplayName(user, docData);
    updateText(menu.triggerName, displayName);
    updateText(menu.fullname, displayName);
    const avatarProfile = {
      displayName,
      avatarUrl: resolveAvatarUrl(user, docData),
      avatarUpdatedAt: resolveAvatarUpdatedAt(docData),
      initials: buildInitials(displayName)
    };
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
  const firebase = getFirebase();
  const { auth, db, storage } = firebase || {};
  containers.forEach((container) => {
    if (variant && container.dataset.variant && container.dataset.variant !== variant) return;
    initMenuInstance(container, { auth, db, storage });
  });
};
