import { getFirebase } from "../common/firebaseClient.js";

const DEFAULT_SRC = "/asistente-ia/index.html?embed=1";
const FRAME_SOURCES = {
  gemini: `${DEFAULT_SRC}&model=gemini`,
  gpt: `${DEFAULT_SRC}&model=gpt`
};
const MODEL_STORAGE_KEY = "dm_ai_model";
const DEFAULT_MODEL = "gemini";

const OPENAI_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
    />
  </svg>
`;

const GEMINI_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <defs>
      <linearGradient id="dmGeminiGradient" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#4285f4" />
        <stop offset="45%" stop-color="#7b61ff" />
        <stop offset="100%" stop-color="#db4437" />
      </linearGradient>
    </defs>
    <path
      fill="url(#dmGeminiGradient)"
      d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"
    />
  </svg>
`;

const buildSelectorMarkup = () => `
  <button class="dm-ai-selector__btn dm-avatar-ring" type="button" data-dm-ai-model="gpt" aria-label="ChatGPT">
    <span class="dm-ai-selector__icon">${OPENAI_ICON}</span>
  </button>
  <button class="dm-ai-selector__btn dm-avatar-ring" type="button" data-dm-ai-model="gemini" aria-label="Gemini">
    <span class="dm-ai-selector__icon">${GEMINI_ICON}</span>
  </button>
`;

const buildShellMarkup = () => `
  <div class="dm-ai-backdrop" data-dm-ai-backdrop aria-hidden="true"></div>
  <section class="dm-ai-panel" role="dialog" aria-modal="true" aria-label="Asistente IA">
    <div class="dm-ai-body">
      <iframe class="dm-ai-iframe" data-dm-ai-frame="gemini" title="Asistente IA Gemini" loading="lazy" data-src="${FRAME_SOURCES.gemini}" aria-hidden="true"></iframe>
      <iframe class="dm-ai-iframe" data-dm-ai-frame="gpt" title="Asistente IA ChatGPT" loading="lazy" data-src="${FRAME_SOURCES.gpt}" aria-hidden="true"></iframe>
    </div>
  </section>
`;

const createSelector = () => {
  const selector = document.createElement("div");
  selector.className = "dm-ai-selector";
  selector.dataset.dmAiSelector = "true";
  selector.setAttribute("role", "menu");
  selector.setAttribute("aria-label", "Seleccionar modelo");
  selector.innerHTML = buildSelectorMarkup();
  document.body.appendChild(selector);
  return selector;
};

const createShell = (variant) => {
  const shell = document.createElement("div");
  shell.className = `dm-ai-shell dm-ai-shell--${variant}`;
  shell.dataset.dmAiShell = "true";
  shell.setAttribute("aria-hidden", "true");
  shell.innerHTML = buildShellMarkup();
  document.body.appendChild(shell);
  return shell;
};

const setupAuthBridge = () => {
  if (typeof window === "undefined" || window.dmGetAuthToken) return;
  window.dmGetAuthToken = async () => {
    try {
      const { auth } = getFirebase();
      const user = auth.currentUser;
      if (!user) return null;
      return await user.getIdToken();
    } catch (error) {
      return null;
    }
  };
};

export const initAssistantShell = ({ variant = "mobile" } = {}) => {
  if (typeof window !== "undefined" && window.__dmAssistantShell) {
    return window.__dmAssistantShell;
  }

  const resolvedVariant = variant === "desktop" ? "desktop" : "mobile";
  const existing = document.querySelector("[data-dm-ai-shell]");

  setupAuthBridge();

  const shell = existing || createShell(resolvedVariant);
  shell.classList.remove("dm-ai-shell--mobile", "dm-ai-shell--desktop");
  shell.classList.add(`dm-ai-shell--${resolvedVariant}`);
  shell.dataset.variant = resolvedVariant;

  const backdrop = shell.querySelector("[data-dm-ai-backdrop]");
  const closeBtn = shell.querySelector("[data-dm-ai-close]");
  const selector = document.querySelector("[data-dm-ai-selector]") || createSelector();
  const modelButtons = selector ? Array.from(selector.querySelectorAll("[data-dm-ai-model]")) : [];
  const frames = {
    gemini: shell.querySelector('[data-dm-ai-frame="gemini"]'),
    gpt: shell.querySelector('[data-dm-ai-frame="gpt"]')
  };
  const panel = shell.querySelector(".dm-ai-panel");
  const triggers = [
    document.getElementById("aiFab"),
    document.getElementById("dmAssistantFab")
  ].filter(Boolean);
  let panelOutsideListenerActive = false;

  const storedModel = (() => {
    try {
      return localStorage.getItem(MODEL_STORAGE_KEY);
    } catch (error) {
      return null;
    }
  })();
  const normalizedModel =
    storedModel === "gpt" || storedModel === "gemini" ? storedModel : DEFAULT_MODEL;

  const state = {
    pickerOpen: false,
    panelOpen: false,
    activeModel: normalizedModel,
    framesLoaded: {
      gemini: false,
      gpt: false
    },
    scrollLocked: false,
    scrollY: 0,
    bodyStyles: {}
  };

  const isBodyLocked = () =>
    document.body.classList.contains("dm-ai-open") ||
    document.body.classList.contains("dm-scroll-locked") ||
    document.documentElement.classList.contains("dm-scroll-locked") ||
    document.body.style.position === "fixed";

  const getScrollYFromBody = () => {
    const top = document.body.style.top;
    const parsed = parseInt(top || "0", 10);
    return Number.isNaN(parsed) ? 0 : Math.abs(parsed);
  };

  const syncScrollLock = () => {
    if (state.panelOpen) {
      lockScroll();
      return;
    }
    if (state.scrollLocked || isBodyLocked()) {
      unlockScroll();
      document.body.classList.remove("dm-ai-open");
    }
  };

  const isDesktop = () =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

  const clamp = (value, min, max) => {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  };

  const updateAnchoredState = () => {
    const desktop = isDesktop();
    shell.classList.toggle("dm-ai-shell--anchored", desktop);
    selector?.classList.toggle("dm-ai-selector--anchored", desktop);
    if (!desktop) {
      if (selector) {
        selector.style.left = "";
        selector.style.top = "";
      }
      if (panel) {
        panel.style.left = "";
        panel.style.top = "";
      }
    }
    return desktop;
  };

  const positionPicker = () => {
    if (!selector || !updateAnchoredState()) return;
    const fab = document.getElementById("dmAssistantFab");
    if (!fab) return;
    const fabRect = fab.getBoundingClientRect();
    const pickerRect = selector.getBoundingClientRect();
    const pickerHeight = pickerRect.height || selector.offsetHeight || 0;
    const left = fabRect.right + 12;
    const top = fabRect.top + fabRect.height / 2 - pickerHeight / 2;
    const clampedTop = clamp(top, 12, window.innerHeight - pickerHeight - 12);
    selector.style.left = `${Math.round(left)}px`;
    selector.style.top = `${Math.round(clampedTop)}px`;
  };

  const positionChat = () => {
    if (!panel || !updateAnchoredState()) return;
    const fab = document.getElementById("dmAssistantFab");
    if (!fab) return;
    const fabRect = fab.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelHeight = panelRect.height || panel.offsetHeight || 0;
    const left = fabRect.right + 12;
    const top = fabRect.bottom - panelHeight;
    const clampedTop = clamp(top, 12, window.innerHeight - panelHeight - 12);
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(clampedTop)}px`;
  };

  const handleViewportChange = () => {
    if (!updateAnchoredState()) return;
    if (state.pickerOpen) positionPicker();
    if (state.panelOpen) positionChat();
  };

  const updateSelectorUI = () => {
    if (!modelButtons.length) return;
    modelButtons.forEach((btn) => {
      const isActive = btn.dataset.dmAiModel === state.activeModel;
      btn.classList.toggle("is-active", isActive);
    });
  };

  const setActiveModel = (model, { persist = true, notify = true } = {}) => {
    if (!model || model === state.activeModel) {
      updateSelectorUI();
      return;
    }
    state.activeModel = model;
    if (persist) {
      try {
        localStorage.setItem(MODEL_STORAGE_KEY, model);
      } catch (error) {
        // no-op
      }
    }
    updateSelectorUI();
    if (notify) {
      sendModelToIframe(model);
    }
  };

  // Keep one iframe per model so each conversation stays alive.
  const ensureFrameLoaded = (modelKey) => {
    const frame = frames[modelKey];
    if (!frame) return Promise.resolve();
    if (state.framesLoaded[modelKey]) return Promise.resolve();
    state.framesLoaded[modelKey] = true;
    return new Promise((resolve) => {
      frame.addEventListener(
        "load",
        () => {
          resolve();
        },
        { once: true }
      );
      frame.src = frame.dataset.src || FRAME_SOURCES[modelKey];
    });
  };

  const sendModelToIframe = (model) => {
    const frame = frames[model];
    if (!frame || !frame.contentWindow || !model) return;
    frame.contentWindow.postMessage(
      { type: "dm-ai-select-model", model },
      window.location.origin
    );
  };

  const setActiveFrame = (modelKey) => {
    Object.entries(frames).forEach(([key, frame]) => {
      if (!frame) return;
      const isActive = key === modelKey;
      frame.classList.toggle("is-active", isActive);
      frame.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
  };

  const lockScroll = () => {
    // Keep background scrollable to avoid layout shift when opening the assistant.
    state.scrollLocked = false;
  };

  const unlockScroll = () => {
    state.scrollLocked = false;
    document.documentElement.classList.remove("dm-scroll-locked");
    document.body.classList.remove("dm-scroll-locked");
  };

  const openPanel = async () => {
    if (state.panelOpen) return;
    await ensureFrameLoaded(state.activeModel);
    setActiveFrame(state.activeModel);
    state.panelOpen = true;
    document.body.classList.add("dm-ai-open");
    shell.classList.add("is-open");
    shell.setAttribute("aria-hidden", "false");
    lockScroll();
    sendModelToIframe(state.activeModel);
    closePicker();
    positionChat();
    syncScrollLock();
    if (isDesktop()) addPanelOutsideListener();
  };

  const closePanel = () => {
    if (!state.panelOpen) return;
    state.panelOpen = false;
    document.body.classList.remove("dm-ai-open");
    shell.classList.remove("is-open");
    shell.setAttribute("aria-hidden", "true");
    unlockScroll();
    closePicker();
    syncScrollLock();
    removePanelOutsideListener();
  };

  const openPicker = () => {
    if (state.pickerOpen) return;
    state.pickerOpen = true;
    selector?.classList.add("is-open");
    updateSelectorUI();
    positionPicker();
    syncScrollLock();
  };

  const closePicker = () => {
    if (!state.pickerOpen) return;
    state.pickerOpen = false;
    selector?.classList.remove("is-open");
    syncScrollLock();
  };

  const togglePicker = () => {
    if (state.pickerOpen) closePicker();
    else openPicker();
  };

  const openChat = async (model) => {
    if (!model) return;
    setActiveModel(model, { persist: true, notify: false });
    await ensureFrameLoaded(model);
    setActiveFrame(model);
    await openPanel();
    sendModelToIframe(model);
    closePicker();
    syncScrollLock();
  };

  const handleBackdropClick = () => {
    if (state.panelOpen) {
      closePanel();
      return;
    }
    if (state.pickerOpen) closePicker();
  };

  const handleKeydown = (event) => {
    if (event.key !== "Escape") return;
    if (state.pickerOpen) closePicker();
    if (state.panelOpen) closePanel();
  };

  const handleDocumentClick = (event) => {
    if (!state.pickerOpen) return;
    const target = event.target;
    const clickedSelector = selector && selector.contains(target);
    const clickedTrigger = triggers.some((trigger) => trigger.contains(target));
    if (!clickedSelector && !clickedTrigger) {
      closePicker();
    }
  };

  const handlePanelOutsidePointerDown = (event) => {
    if (!state.panelOpen) return;
    if (!isDesktop()) return;
    const target = event.target;
    if (panel && panel.contains(target)) return;
    const clickedTrigger = triggers.some((trigger) => trigger.contains(target));
    if (clickedTrigger) return;
    closePanel();
  };

  const addPanelOutsideListener = () => {
    if (panelOutsideListenerActive) return;
    document.addEventListener("pointerdown", handlePanelOutsidePointerDown, true);
    panelOutsideListenerActive = true;
  };

  const removePanelOutsideListener = () => {
    if (!panelOutsideListenerActive) return;
    document.removeEventListener("pointerdown", handlePanelOutsidePointerDown, true);
    panelOutsideListenerActive = false;
  };

  const handleSelectorClick = (event) => {
    event.stopPropagation();
    const btn = event.target.closest("[data-dm-ai-model]");
    if (!btn) return;
    const model = btn.dataset.dmAiModel;
    openChat(model);
  };

  const handleMessage = (event) => {
    if (event.origin !== window.location.origin) return;
    const payload = event.data || {};
    const allowedSources = [frames.gemini?.contentWindow, frames.gpt?.contentWindow].filter(Boolean);
    if (payload.type === "dm-ai-close") {
      if (!allowedSources.includes(event.source)) return;
      closePanel();
      return;
    }
    if (payload.type === "dm-ai-model" && payload.model) {
      const activeFrame = frames[state.activeModel];
      if (activeFrame && event.source !== activeFrame.contentWindow) return;
      setActiveModel(payload.model, { persist: true, notify: false });
    }
    if (payload.type === "dm-ai-ready") {
      const activeFrame = frames[state.activeModel];
      if (activeFrame && event.source !== activeFrame.contentWindow) return;
      sendModelToIframe(state.activeModel);
    }
  };

  const warmup = () => {
    ensureFrameLoaded("gemini");
    ensureFrameLoaded("gpt");
  };

  if (typeof window !== "undefined") {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(warmup, { timeout: 2000 });
    } else {
      window.setTimeout(warmup, 1400);
    }
  }

  // Guard: if a previous session left the body locked, release it.
  unlockScroll();
  updateSelectorUI();
  syncScrollLock();

  backdrop?.addEventListener("click", handleBackdropClick);
  closeBtn?.addEventListener("click", closePanel);
  selector?.addEventListener("click", handleSelectorClick);
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("click", handleDocumentClick);
  window.addEventListener("scroll", handleViewportChange, { passive: true });
  window.addEventListener("resize", handleViewportChange, { passive: true });
  window.addEventListener("message", handleMessage);

  const api = {
    openChat,
    closeChat: closePanel,
    togglePicker,
    openPicker,
    closePicker,
    get state() {
      return {
        pickerOpen: state.pickerOpen,
        panelOpen: state.panelOpen,
        activeModel: state.activeModel
      };
    }
  };

  if (typeof window !== "undefined") {
    window.__dmAssistantShell = api;
  }
  shell.__assistantShellApi = api;
  return api;
};
