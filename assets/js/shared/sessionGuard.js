import { onAuthStateChanged, signOut, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { buildLoginRedirectUrl } from "./authGate.js";
import { bindPasswordVisibility } from "./passwordVisibility.js";
import { isLocalRealBackend } from "../common/firebase-bootstrap.js";
import {
  completeForcedPasswordChange,
  getMySessionControl
} from "../services/UserSecurityService.js";

const SESSION_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const NOISY_ACTIVITY_THROTTLE_MS = 15 * 1000;
const PRESENCE_COLLECTION = "dm_presence";
const SESSION_CONTROL_COLLECTION = "dm_session_controls";
const CHANNEL_NAME = "dm_session";
const ACTIVITY_KEY_PREFIX = "dm_session_activity_v1";
const LOGOUT_KEY_PREFIX = "dm_session_logout_v1";

const state = {
  auth: null,
  db: null,
  fallbackHash: "",
  loginPath: "/login.html",
  currentUser: null,
  authTimeMs: 0,
  timerId: null,
  forcedLogoutUnsub: null,
  authUnsub: null,
  storageBound: false,
  activityBound: false,
  channel: null,
  lastActivityAt: 0,
  lastNoisyActivityAt: 0,
  lastHandledLogoutTs: 0,
  logoutInProgress: false,
  forcePasswordChangeActive: false,
  forcePasswordChangePromise: null,
  forcePasswordChangeModal: null
};

const toMs = (value) => {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value instanceof Date) return value.getTime();
  return 0;
};

const safeRead = (key) => {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return "";
  }
};

const safeWrite = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // Ignore storage failures.
  }
};

const activityKey = (uid) => `${ACTIVITY_KEY_PREFIX}:${uid || "anon"}`;
const logoutKey = (uid) => `${LOGOUT_KEY_PREFIX}:${uid || "anon"}`;

const resolveRedirectUrl = ({ redirectUrl = "", fallbackHash = "", loginPath = "/login.html" } = {}) => {
  if (redirectUrl) return redirectUrl;
  if (loginPath && loginPath !== "/login.html") return loginPath;
  return buildLoginRedirectUrl(window.location.hash || fallbackHash);
};

const clearLogoutTimer = () => {
  if (!state.timerId) return;
  clearTimeout(state.timerId);
  state.timerId = null;
};

const clearSessionFlags = () => {
  try {
    sessionStorage.removeItem("isLoggedIn");
  } catch (e) {
    // Ignore session storage errors.
  }
  try {
    localStorage.removeItem("user_nombre");
  } catch (e) {
    // Ignore local storage errors.
  }
};

const postChannelMessage = (payload) => {
  if (!state.channel) return;
  try {
    state.channel.postMessage(payload);
  } catch (e) {
    // Ignore BroadcastChannel errors.
  }
};

const getCurrentUid = () => state.currentUser?.uid || state.auth?.currentUser?.uid || "";

const readSharedLastActivity = (uid) => {
  const raw = safeRead(activityKey(uid));
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const writeSharedLastActivity = (uid, ts) => {
  if (!uid || !ts) return;
  safeWrite(activityKey(uid), String(ts));
  postChannelMessage({ type: "activity", uid, ts });
};

const broadcastLogout = (uid, reason, ts = Date.now()) => {
  if (!uid) return;
  safeWrite(logoutKey(uid), JSON.stringify({ uid, reason, ts }));
  postChannelMessage({ type: "logout", uid, reason, ts });
};

const resolveAuthTimeMs = async (user) => {
  if (!user) return 0;
  try {
    const token = await user.getIdTokenResult();
    const claimValue =
      typeof token?.claims?.auth_time === "number" ? token.claims.auth_time * 1000 : 0;
    return claimValue || toMs(token?.authTime);
  } catch (e) {
    return 0;
  }
};

const stopForcedLogoutListener = () => {
  if (typeof state.forcedLogoutUnsub === "function") {
    state.forcedLogoutUnsub();
  }
  state.forcedLogoutUnsub = null;
};

const markPresenceOffline = async (db, uid) => {
  if (!db || !uid) return;
  if (isLocalRealBackend()) return;
  try {
    await setDoc(
      doc(db, PRESENCE_COLLECTION, uid),
      { online: false, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (e) {
    // Ignore presence shutdown errors to avoid blocking logout.
  }
};

const hasPasswordProvider = (user) =>
  Array.isArray(user?.providerData) &&
  user.providerData.some((provider) => provider?.providerId === "password");

const setForcedChangeStatus = (modal, message = "", variant = "info") => {
  if (!modal?.status) return;
  modal.status.textContent = message;
  modal.status.dataset.variant = variant;
  modal.status.hidden = !message;
};

const ensureForcedChangeModal = () => {
  if (state.forcePasswordChangeModal) return state.forcePasswordChangeModal;
  const style = document.createElement("style");
  style.textContent = `
    .dm-force-password-modal {
      position: fixed;
      inset: 0;
      z-index: 10050;
      display: grid;
      place-items: center;
      padding: 18px;
      background: rgba(248, 250, 252, 0.78);
      -webkit-backdrop-filter: blur(18px) saturate(1.15);
      backdrop-filter: blur(18px) saturate(1.15);
    }
    .dm-force-password-modal[hidden] { display: none; }
    .dm-force-password-modal__dialog {
      width: min(100%, 480px);
      border: 1px solid rgba(122, 184, 0, 0.22);
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.88);
      box-shadow: 0 30px 90px rgba(15, 23, 42, 0.18);
      padding: clamp(22px, 4vw, 34px);
      color: #182033;
    }
    .dm-force-password-modal h2 {
      margin: 0 0 10px;
      font-size: clamp(1.35rem, 3vw, 1.8rem);
      line-height: 1.12;
      letter-spacing: 0;
    }
    .dm-force-password-modal p {
      margin: 0 0 18px;
      color: #516276;
      line-height: 1.5;
    }
    .dm-force-password-modal__form {
      display: grid;
      gap: 12px;
    }
    .dm-force-password-modal label {
      display: grid;
      gap: 6px;
      font-size: 0.82rem;
      font-weight: 800;
      color: #344256;
    }
    .dm-force-password-modal input {
      width: 100%;
      box-sizing: border-box;
      min-height: 48px;
      border: 1px solid rgba(148, 163, 184, 0.45);
      border-radius: 14px;
      padding: 11px 13px;
      font: inherit;
      background: rgba(255, 255, 255, 0.92);
    }
    .dm-force-password-modal input:focus {
      outline: none;
      border-color: #7ab800;
      box-shadow: 0 0 0 4px rgba(122, 184, 0, 0.16);
    }
    .dm-force-password-modal__password-wrap {
      position: relative;
      display: block;
    }
    .dm-force-password-modal__password-wrap input {
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
    .password-visibility-toggle svg {
      width: 19px;
      height: 19px;
      display: block;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .dm-force-password-modal__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 8px;
    }
    .dm-force-password-modal button {
      min-height: 44px;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.36);
      padding: 0 18px;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
      background: #fff;
      color: #334155;
    }
    .dm-force-password-modal button[data-primary] {
      border-color: #7ab800;
      background: #7ab800;
      color: #fff;
      box-shadow: 0 14px 28px rgba(122, 184, 0, 0.22);
    }
    .dm-force-password-modal__status {
      margin-top: 12px;
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 0.88rem;
      background: rgba(122, 184, 0, 0.12);
      color: #365314;
    }
    .dm-force-password-modal__status[data-variant="error"] {
      background: rgba(239, 68, 68, 0.12);
      color: #991b1b;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.className = "dm-force-password-modal";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="dm-force-password-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="dm-force-password-title">
      <h2 id="dm-force-password-title">Debés cambiar tu contraseña para continuar.</h2>
      <p data-force-password-description>Por seguridad, elegí una contraseña nueva antes de usar el portal.</p>
      <form class="dm-force-password-modal__form" data-force-password-form>
        <label>
          Nueva contraseña
          <span class="dm-force-password-modal__password-wrap" data-password-field>
            <input type="password" autocomplete="new-password" data-force-password-new />
            <button class="password-visibility-toggle" type="button" data-password-visibility></button>
          </span>
        </label>
        <label>
          Confirmar nueva contraseña
          <span class="dm-force-password-modal__password-wrap" data-password-field>
            <input type="password" autocomplete="new-password" data-force-password-confirm />
            <button class="password-visibility-toggle" type="button" data-password-visibility></button>
          </span>
        </label>
        <div class="dm-force-password-modal__actions">
          <button type="button" data-force-password-logout>Cerrar sesión</button>
          <button type="submit" data-primary>Cambiar contraseña</button>
        </div>
      </form>
      <div class="dm-force-password-modal__external" data-force-password-external hidden>
        <p>Tu cuenta usa un proveedor externo. La contraseña se administra desde ese proveedor.</p>
        <div class="dm-force-password-modal__actions">
          <button type="button" data-force-password-logout-external>Cerrar sesión</button>
        </div>
      </div>
      <p class="dm-force-password-modal__status" data-force-password-status hidden></p>
    </section>
  `;
  document.body.appendChild(overlay);
  bindPasswordVisibility(overlay);

  state.forcePasswordChangeModal = {
    overlay,
    form: overlay.querySelector("[data-force-password-form]"),
    external: overlay.querySelector("[data-force-password-external]"),
    newPassword: overlay.querySelector("[data-force-password-new]"),
    confirmPassword: overlay.querySelector("[data-force-password-confirm]"),
    status: overlay.querySelector("[data-force-password-status]"),
    logout: overlay.querySelector("[data-force-password-logout]"),
    logoutExternal: overlay.querySelector("[data-force-password-logout-external]"),
  };
  return state.forcePasswordChangeModal;
};

const showForcedChangeModal = async ({ auth, db, user }) => {
  if (!user) return false;
  if (state.forcePasswordChangePromise) return state.forcePasswordChangePromise;
  state.forcePasswordChangeActive = true;
  state.forcePasswordChangePromise = new Promise((resolve) => {
    const modal = ensureForcedChangeModal();
    const passwordUser = hasPasswordProvider(user);
    modal.form.hidden = !passwordUser;
    modal.external.hidden = passwordUser;
    modal.overlay.hidden = false;
    document.body.classList.add("dm-modal-open");
    setForcedChangeStatus(modal, "", "info");

    const finish = () => {
      modal.overlay.hidden = true;
      document.body.classList.remove("dm-modal-open");
      modal.newPassword.value = "";
      modal.confirmPassword.value = "";
      setForcedChangeStatus(modal, "", "info");
      state.forcePasswordChangeActive = false;
      state.forcePasswordChangePromise = null;
      resolve(true);
    };

    const logout = async () => {
      await performManagedLogout({
        auth,
        db,
        reason: "force_password_change_logout",
        redirectUrl: resolveRedirectUrl(state)
      });
    };

    modal.logout.onclick = logout;
    modal.logoutExternal.onclick = logout;
    modal.form.onsubmit = async (event) => {
      event.preventDefault();
      const nextPassword = modal.newPassword.value || "";
      const confirmPassword = modal.confirmPassword.value || "";
      if (nextPassword.length < 8) {
        setForcedChangeStatus(modal, "La nueva contraseña debe tener al menos 8 caracteres.", "error");
        return;
      }
      if (nextPassword !== confirmPassword) {
        setForcedChangeStatus(modal, "La confirmación no coincide.", "error");
        return;
      }
      try {
        setForcedChangeStatus(modal, "Actualizando contraseña...", "info");
        await updatePassword(user, nextPassword);
        await completeForcedPasswordChange();
        finish();
      } catch (error) {
        const code = String(error?.code || "");
        const message = code.includes("weak-password")
          ? "La nueva contraseña es débil."
          : code.includes("requires-recent-login")
          ? "La sesión necesita reautenticación. Cerrá sesión e ingresá con la contraseña temporal nuevamente."
          : "No se pudo cambiar la contraseña. Reintentá.";
        setForcedChangeStatus(modal, message, "error");
      }
    };
    window.setTimeout(() => modal.newPassword?.focus(), 0);
  });
  return state.forcePasswordChangePromise;
};

const resetSignedOutState = () => {
  clearLogoutTimer();
  stopForcedLogoutListener();
  state.currentUser = null;
  state.authTimeMs = 0;
  state.lastActivityAt = 0;
  state.lastNoisyActivityAt = 0;
  state.forcePasswordChangeActive = false;
  state.forcePasswordChangePromise = null;
};

const syncActivity = (ts) => {
  if (!state.currentUser || !ts) return;
  const nextTs = Math.max(ts, readSharedLastActivity(state.currentUser.uid));
  if (!nextTs) return;
  state.lastActivityAt = nextTs;
  scheduleLogoutTimer();
};

async function handleRemoteLogout(payload = {}) {
  const uid = getCurrentUid();
  if (!uid || payload.uid !== uid) return;
  const nextTs = Number(payload.ts) || Date.now();
  if (nextTs <= state.lastHandledLogoutTs || state.logoutInProgress) return;
  state.lastHandledLogoutTs = nextTs;
  await performManagedLogout({
    auth: state.auth,
    db: state.db,
    reason: payload.reason || "remote_logout",
    uidOverride: uid,
    suppressBroadcast: true,
    redirectUrl: resolveRedirectUrl(state)
  });
}

export async function enforceForcedPasswordChangeIfNeeded({
  auth = state.auth,
  db = state.db,
  user = auth?.currentUser || state.currentUser,
} = {}) {
  if (!user || state.logoutInProgress) return false;
  let sessionControl = null;
  try {
    sessionControl = await getMySessionControl();
  } catch (error) {
    return false;
  }
  if (sessionControl?.forcePasswordChange !== true) return false;
  await showForcedChangeModal({ auth, db, user });
  return true;
}

async function watchForcedLogout(user) {
  stopForcedLogoutListener();
  if (!state.db || !user?.uid) return;
  state.forcedLogoutUnsub = onSnapshot(
    doc(state.db, SESSION_CONTROL_COLLECTION, user.uid),
    async (snap) => {
      if (!snap.exists() || state.logoutInProgress) return;
      const data = snap.data() || {};
      if (data.forcePasswordChange === true) {
        await showForcedChangeModal({ auth: state.auth, db: state.db, user });
        return;
      }
      const forcedLogoutMs = toMs(data.forcedLogoutAt);
      if (!forcedLogoutMs) return;
      const authTimeMs = state.authTimeMs || (await resolveAuthTimeMs(user));
      if (!authTimeMs || forcedLogoutMs <= authTimeMs) return;
      await performManagedLogout({
        auth: state.auth,
        db: state.db,
        reason: data.reason || "forced_logout",
        uidOverride: user.uid,
        redirectUrl: resolveRedirectUrl(state)
      });
    },
    () => {}
  );
}

function scheduleLogoutTimer() {
  clearLogoutTimer();
  const uid = getCurrentUid();
  if (!uid) return;
  const lastActivity = Math.max(state.lastActivityAt, readSharedLastActivity(uid));
  const baseTs = lastActivity || Date.now();
  state.lastActivityAt = baseTs;
  const remaining = SESSION_TIMEOUT_MS - (Date.now() - baseTs);
  const nextDelay = Math.max(0, remaining);
  state.timerId = window.setTimeout(async () => {
    const latestTs = Math.max(state.lastActivityAt, readSharedLastActivity(uid));
    if (Date.now() - latestTs < SESSION_TIMEOUT_MS) {
      state.lastActivityAt = latestTs;
      scheduleLogoutTimer();
      return;
    }
    await performManagedLogout({
      auth: state.auth,
      db: state.db,
      reason: "inactivity_timeout",
      redirectUrl: resolveRedirectUrl(state)
    });
  }, nextDelay);
}

function recordActivity({ force = false } = {}) {
  const uid = getCurrentUid();
  if (!uid) return;
  if (document.hidden && !force) return;
  const now = Date.now();
  if (!force && now - state.lastNoisyActivityAt < NOISY_ACTIVITY_THROTTLE_MS) return;
  if (!force) {
    state.lastNoisyActivityAt = now;
  }
  state.lastActivityAt = now;
  writeSharedLastActivity(uid, now);
  scheduleLogoutTimer();
}

const bindGlobalListeners = () => {
  if (state.activityBound) return;
  state.activityBound = true;

  const recordActive = () => recordActivity();
  const recordNoisy = () => recordActivity();
  const recordImmediate = () => recordActivity({ force: true });

  window.addEventListener("pointerdown", recordActive, { passive: true, capture: true });
  window.addEventListener("keydown", recordActive, { capture: true });
  window.addEventListener("touchstart", recordActive, { passive: true, capture: true });
  window.addEventListener("focus", recordImmediate);
  window.addEventListener("mousemove", recordNoisy, { passive: true });
  window.addEventListener("scroll", recordNoisy, { passive: true });
  window.addEventListener("wheel", recordNoisy, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      recordActivity({ force: true });
      return;
    }
    scheduleLogoutTimer();
  });

  if (!state.storageBound) {
    state.storageBound = true;
    window.addEventListener("storage", (event) => {
      const uid = getCurrentUid();
      if (!uid || !event.key) return;
      if (event.key === activityKey(uid)) {
        syncActivity(Number(event.newValue || 0));
        return;
      }
      if (event.key === logoutKey(uid) && event.newValue) {
        try {
          const payload = JSON.parse(event.newValue);
          handleRemoteLogout(payload);
        } catch (e) {
          // Ignore malformed payloads.
        }
      }
    });
  }

  if (!state.channel && typeof BroadcastChannel !== "undefined") {
    try {
      state.channel = new BroadcastChannel(CHANNEL_NAME);
      state.channel.addEventListener("message", (event) => {
        const payload = event.data || {};
        if (payload.type === "activity") {
          syncActivity(Number(payload.ts || 0));
          return;
        }
        if (payload.type === "logout") {
          handleRemoteLogout(payload);
        }
      });
    } catch (e) {
      state.channel = null;
    }
  }
};

export async function performManagedLogout({
  auth,
  db,
  redirectUrl = "",
  fallbackHash = "",
  loginPath = "/login.html",
  reason = "manual_logout",
  uidOverride = "",
  suppressBroadcast = false
} = {}) {
  const resolvedAuth = auth || state.auth;
  const resolvedDb = db || state.db;
  const uid = uidOverride || resolvedAuth?.currentUser?.uid || getCurrentUid();
  if (state.logoutInProgress) return;
  state.logoutInProgress = true;
  clearLogoutTimer();
  clearSessionFlags();

  if (uid && !suppressBroadcast) {
    broadcastLogout(uid, reason);
  }

  await markPresenceOffline(resolvedDb, uid);

  try {
    if (resolvedAuth) {
      await signOut(resolvedAuth);
    }
  } catch (e) {
    // Ignore signOut failures to avoid trapping the user in an invalid state.
  }

  const nextUrl = resolveRedirectUrl({ redirectUrl, fallbackHash, loginPath });
  window.location.replace(nextUrl);
}

export function initSessionGuard({ auth, db, fallbackHash = "", loginPath = "/login.html" } = {}) {
  if (!auth || state.authUnsub) return;
  state.auth = auth;
  state.db = db || null;
  state.fallbackHash = fallbackHash;
  state.loginPath = loginPath;

  bindGlobalListeners();

  state.authUnsub = onAuthStateChanged(auth, async (user) => {
    if (!user) {
      resetSignedOutState();
      return;
    }

    state.currentUser = user;
    state.authTimeMs = await resolveAuthTimeMs(user);
    const sharedLastActivity = readSharedLastActivity(user.uid);
    state.lastActivityAt = Math.max(sharedLastActivity, state.authTimeMs || 0) || Date.now();
    if (!sharedLastActivity || state.lastActivityAt > sharedLastActivity) {
      writeSharedLastActivity(user.uid, state.lastActivityAt);
    }
    await watchForcedLogout(user);
    await enforceForcedPasswordChangeIfNeeded({ auth, db, user });
    if (Date.now() - state.lastActivityAt >= SESSION_TIMEOUT_MS) {
      await performManagedLogout({
        auth,
        db,
        reason: "inactivity_timeout",
        redirectUrl: resolveRedirectUrl(state)
      });
      return;
    }
    scheduleLogoutTimer();
  });
}

export { SESSION_TIMEOUT_MS };
