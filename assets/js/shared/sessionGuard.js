import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { buildLoginRedirectUrl } from "./authGate.js";

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
  logoutInProgress: false
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

const resetSignedOutState = () => {
  clearLogoutTimer();
  stopForcedLogoutListener();
  state.currentUser = null;
  state.authTimeMs = 0;
  state.lastActivityAt = 0;
  state.lastNoisyActivityAt = 0;
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

async function watchForcedLogout(user) {
  stopForcedLogoutListener();
  if (!state.db || !user?.uid) return;
  state.forcedLogoutUnsub = onSnapshot(
    doc(state.db, SESSION_CONTROL_COLLECTION, user.uid),
    async (snap) => {
      if (!snap.exists() || state.logoutInProgress) return;
      const data = snap.data() || {};
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
