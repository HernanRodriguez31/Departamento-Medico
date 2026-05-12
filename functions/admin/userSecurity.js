const crypto = require("crypto");
const { FieldValue } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

const USERS_COLLECTION = "usuarios";
const USERNAMES_COLLECTION = "usernames";
const SESSION_CONTROLS_COLLECTION = "dm_session_controls";
const AUDIT_COLLECTION = "securityAuditLogs";

const RESERVED_USERNAMES = new Set([
  "admin",
  "root",
  "soporte",
  "system",
  "sistema",
  "brisa",
  "firebase",
  "undefined",
  "null",
  "superadmin",
  "super-admin",
  "administrador",
]);

const cleanString = (value) => (typeof value === "string" ? value.trim() : "");

function getAuthContext(request = {}) {
  const uid = cleanString(request.auth?.uid);
  const token = request.auth?.token && typeof request.auth.token === "object"
    ? request.auth.token
    : {};
  return { uid, token };
}

function assertAuthenticated(request) {
  const context = getAuthContext(request);
  if (!context.uid) {
    throw new HttpsError("unauthenticated", "auth_required");
  }
  return context;
}

function assertAdmin(request) {
  const context = assertAuthenticated(request);
  if (context.token.admin === true || context.token.superAdmin === true) {
    return context;
  }
  throw new HttpsError("permission-denied", "admin_required");
}

function assertSuperAdmin(request) {
  const context = assertAuthenticated(request);
  if (context.token.superAdmin === true) {
    return context;
  }
  throw new HttpsError("permission-denied", "super_admin_required");
}

function maskEmail(email = "") {
  const clean = cleanString(email).toLowerCase();
  const [local, domain] = clean.split("@");
  if (!local || !domain) return "";
  const visible = local.length <= 2
    ? `${local[0] || ""}*`
    : `${local.slice(0, 2)}${"*".repeat(Math.min(6, local.length - 2))}`;
  return `${visible}@${domain}`;
}

function normalizeUsername(value = "") {
  return cleanString(value).toLowerCase();
}

function validateUsername(value = "") {
  const username = normalizeUsername(value);
  if (!username) return { ok: true, username: "" };
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    return { ok: false, username, reason: "invalid_username" };
  }
  if (RESERVED_USERNAMES.has(username)) {
    return { ok: false, username, reason: "reserved_username" };
  }
  return { ok: true, username };
}

function validateDisplayName(value = "") {
  const displayName = cleanString(value).replace(/\s+/g, " ");
  if (displayName.length < 2 || displayName.length > 80) {
    throw new HttpsError("invalid-argument", "invalid_display_name");
  }
  return displayName;
}

function validateEmail(value = "") {
  const email = cleanString(value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new HttpsError("invalid-argument", "invalid_email");
  }
  return email;
}

function generateStrongTemporaryPassword(length = 18) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%*-_=+?";
  const all = upper + lower + digits + symbols;
  const pick = (chars) => chars[crypto.randomInt(0, chars.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < Math.max(16, length)) {
    chars.push(pick(all));
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function safeProviderIds(userRecord = {}) {
  return Array.isArray(userRecord.providerData)
    ? userRecord.providerData
        .map((provider) => cleanString(provider?.providerId))
        .filter(Boolean)
    : [];
}

function timestamp(admin) {
  return admin?.firestore?.FieldValue?.serverTimestamp?.() || FieldValue.serverTimestamp();
}

function deleteField(admin) {
  return admin?.firestore?.FieldValue?.delete?.() || FieldValue.delete();
}

function sanitizeAuditMetadata(metadata = {}) {
  const blocked = /password|token|secret|link|credential/i;
  return Object.entries(metadata || {}).reduce((acc, [key, value]) => {
    if (key !== "forcePasswordChange" && blocked.test(key)) return acc;
    acc[key] = value;
    return acc;
  }, {});
}

async function writeSecurityAuditLog(db, admin, payload = {}) {
  const eventType = cleanString(payload.eventType);
  if (!eventType) return null;
  const entry = {
    eventType,
    actorUid: cleanString(payload.actorUid) || null,
    targetUid: cleanString(payload.targetUid) || null,
    targetEmailMasked: cleanString(payload.targetEmailMasked) || null,
    createdAt: timestamp(admin),
    metadata: sanitizeAuditMetadata(payload.metadata || {}),
  };
  await db.collection(AUDIT_COLLECTION).add(entry);
  return entry;
}

async function getSessionControl(db, uid) {
  const snap = await db.collection(SESSION_CONTROLS_COLLECTION).doc(uid).get();
  return snap.exists ? snap.data() || {} : {};
}

function resolveDisplayName(profile = {}, userRecord = {}) {
  return (
    cleanString(userRecord.displayName) ||
    cleanString(profile.displayName) ||
    cleanString(profile.nombreCompleto) ||
    cleanString(profile.apellidoNombre) ||
    cleanString(profile.fullName) ||
    cleanString(profile.name) ||
    cleanString(profile.nombre) ||
    cleanString(userRecord.email) ||
    "Usuario"
  );
}

async function getUserSafeProfile({ auth, db, uid }) {
  const userRecord = await auth.getUser(uid);
  const profileSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
  const profile = profileSnap.exists ? profileSnap.data() || {} : {};
  const sessionControl = await getSessionControl(db, uid);
  const username = cleanString(profile.username || profile.usernameLower);
  return {
    uid,
    displayName: resolveDisplayName(profile, userRecord),
    username,
    emailMasked: maskEmail(userRecord.email || profile.email || ""),
    providerIds: safeProviderIds(userRecord),
    active: userRecord.disabled !== true,
    forcePasswordChange: sessionControl.forcePasswordChange === true,
  };
}

function assertNotSelfReset(actorUid, targetUid) {
  if (actorUid && targetUid && actorUid === targetUid) {
    throw new HttpsError("permission-denied", "self_reset_not_allowed");
  }
}

function assertTargetIsNotSuperAdmin(userRecord = {}) {
  if (userRecord.customClaims?.superAdmin === true) {
    throw new HttpsError("permission-denied", "target_super_admin_reset_blocked");
  }
}

function normalizeQuery(value = "") {
  return cleanString(value).replace(/\s+/g, " ");
}

function createUserSecurityHandlers({ admin, db }) {
  const auth = admin.auth();

  const updateMyProfile = async (request) => {
    const { uid } = assertAuthenticated(request);
    const displayName = validateDisplayName(request.data?.displayName);
    const usernameInput = request.data?.username;
    const wantsUsernameChange = usernameInput !== undefined;
    const usernameValidation = wantsUsernameChange
      ? validateUsername(usernameInput)
      : { ok: true, username: "" };
    if (!usernameValidation.ok) {
      throw new HttpsError("invalid-argument", usernameValidation.reason);
    }

    const usersRef = db.collection(USERS_COLLECTION).doc(uid);
    let oldUsername = "";
    let usernameChanged = false;

    await db.runTransaction(async (trx) => {
      const profileSnap = await trx.get(usersRef);
      const profile = profileSnap.exists ? profileSnap.data() || {} : {};
      oldUsername = normalizeUsername(profile.usernameLower || profile.username || "");
      const nextUsername = wantsUsernameChange ? usernameValidation.username : oldUsername;
      usernameChanged = wantsUsernameChange && nextUsername !== oldUsername;

      if (usernameChanged && nextUsername) {
        const nextRef = db.collection(USERNAMES_COLLECTION).doc(nextUsername);
        const nextSnap = await trx.get(nextRef);
        if (nextSnap.exists && nextSnap.data()?.uid !== uid) {
          throw new HttpsError("already-exists", "username_unavailable");
        }
        trx.set(
          nextRef,
          {
            uid,
            displayName,
            createdAt: nextSnap.exists ? nextSnap.data()?.createdAt || timestamp(admin) : timestamp(admin),
            updatedAt: timestamp(admin),
          },
          { merge: true }
        );
      }

      if (usernameChanged && oldUsername) {
        const oldRef = db.collection(USERNAMES_COLLECTION).doc(oldUsername);
        const oldSnap = await trx.get(oldRef);
        if (oldSnap.exists && oldSnap.data()?.uid === uid) {
          trx.delete(oldRef);
        }
      }

      const patch = {
        uid,
        displayName,
        nombre: displayName,
        updatedAt: timestamp(admin),
        updatedBy: uid,
      };
      if (wantsUsernameChange) {
        if (nextUsername) {
          patch.username = nextUsername;
          patch.usernameLower = nextUsername;
        } else {
          patch.username = deleteField(admin);
          patch.usernameLower = deleteField(admin);
        }
      }
      trx.set(usersRef, patch, { merge: true });
    });

    await auth.updateUser(uid, { displayName });
    await writeSecurityAuditLog(db, admin, {
      eventType: usernameChanged ? "username_changed" : "profile_updated",
      actorUid: uid,
      targetUid: uid,
      metadata: { usernameChanged },
    });

    return {
      ok: true,
      profile: {
        uid,
        displayName,
        username: wantsUsernameChange ? usernameValidation.username : oldUsername,
      },
    };
  };

  const adminResolveUser = async (request) => {
    assertAdmin(request);
    const rawQuery = normalizeQuery(request.data?.query);
    if (rawQuery.length < 2) {
      throw new HttpsError("invalid-argument", "invalid_query");
    }

    const resolved = new Map();
    const addUid = (uid) => {
      const cleanUid = cleanString(uid);
      if (cleanUid) resolved.set(cleanUid, cleanUid);
    };

    try {
      const byUid = await auth.getUser(rawQuery);
      addUid(byUid.uid);
    } catch (error) {
      if (!["auth/user-not-found", "auth/invalid-uid"].includes(error.code)) throw error;
    }

    if (rawQuery.includes("@")) {
      try {
        const byEmail = await auth.getUserByEmail(rawQuery.toLowerCase());
        addUid(byEmail.uid);
      } catch (error) {
        if (!["auth/user-not-found", "auth/invalid-email"].includes(error.code)) throw error;
      }
    }

    const usernameCandidate = validateUsername(rawQuery);
    if (usernameCandidate.ok && usernameCandidate.username) {
      const usernameSnap = await db
        .collection(USERNAMES_COLLECTION)
        .doc(usernameCandidate.username)
        .get();
      if (usernameSnap.exists) addUid(usernameSnap.data()?.uid);
    }

    if (resolved.size === 0) {
      const usersRef = db.collection(USERS_COLLECTION);
      const fields = ["displayName", "nombre"];
      for (const field of fields) {
        const snap = await usersRef.where(field, "==", rawQuery).limit(5).get();
        snap.docs.forEach((docSnap) => addUid(docSnap.id));
      }
    }

    const profiles = [];
    for (const uid of resolved.keys()) {
      profiles.push(await getUserSafeProfile({ auth, db, uid }));
      if (profiles.length >= 5) break;
    }
    return { users: profiles };
  };

  const adminSendPasswordReset = async (request) => {
    const { uid: actorUid } = assertAdmin(request);
    const targetUid = cleanString(request.data?.uid);
    if (!targetUid) throw new HttpsError("invalid-argument", "invalid_uid");
    const target = await auth.getUser(targetUid);
    if (!target.email) {
      throw new HttpsError("failed-precondition", "target_email_missing");
    }
    await auth.generatePasswordResetLink(target.email);
    await writeSecurityAuditLog(db, admin, {
      eventType: "admin_password_reset_requested",
      actorUid,
      targetUid,
      targetEmailMasked: maskEmail(target.email),
      metadata: { method: "firebase_admin_reset_link" },
    });
    return { ok: true, emailMasked: maskEmail(target.email) };
  };

  const adminIssueTemporaryPassword = async (request) => {
    const { uid: actorUid } = assertSuperAdmin(request);
    const targetUid = cleanString(request.data?.uid);
    const confirmation = cleanString(request.data?.confirmation);
    if (!targetUid) throw new HttpsError("invalid-argument", "invalid_uid");
    if (confirmation !== "RESTABLECER") {
      throw new HttpsError("failed-precondition", "confirmation_required");
    }
    assertNotSelfReset(actorUid, targetUid);

    const target = await auth.getUser(targetUid);
    assertTargetIsNotSuperAdmin(target);
    const temporaryPassword = generateStrongTemporaryPassword(18);

    await auth.updateUser(targetUid, { password: temporaryPassword });
    await auth.revokeRefreshTokens(targetUid);
    await db.collection(SESSION_CONTROLS_COLLECTION).doc(targetUid).set(
      {
        uid: targetUid,
        forcePasswordChange: true,
        tempPasswordIssuedAt: timestamp(admin),
        tempPasswordIssuedBy: actorUid,
        updatedAt: timestamp(admin),
      },
      { merge: true }
    );
    await writeSecurityAuditLog(db, admin, {
      eventType: "admin_temp_password_issued",
      actorUid,
      targetUid,
      targetEmailMasked: maskEmail(target.email),
      metadata: {
        method: "temporary_password",
        forcePasswordChange: true,
      },
    });

    return {
      temporaryPassword,
      target: {
        uid: targetUid,
        displayName: target.displayName || target.email || targetUid,
        emailMasked: maskEmail(target.email),
      },
      forcePasswordChange: true,
    };
  };

  const getMySessionControl = async (request) => {
    const { uid } = assertAuthenticated(request);
    const data = await getSessionControl(db, uid);
    return { forcePasswordChange: data.forcePasswordChange === true };
  };

  const completeForcedPasswordChange = async (request) => {
    const { uid } = assertAuthenticated(request);
    const ref = db.collection(SESSION_CONTROLS_COLLECTION).doc(uid);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() || {} : {};
    if (data.forcePasswordChange !== true) {
      throw new HttpsError("failed-precondition", "force_password_change_not_active");
    }
    await ref.set(
      {
        forcePasswordChange: false,
        completedAt: timestamp(admin),
        updatedAt: timestamp(admin),
      },
      { merge: true }
    );
    await writeSecurityAuditLog(db, admin, {
      eventType: "force_password_change_completed",
      actorUid: uid,
      targetUid: uid,
    });
    return { ok: true, forcePasswordChange: false };
  };

  const recordMyPasswordChange = async (request) => {
    const { uid } = assertAuthenticated(request);
    await writeSecurityAuditLog(db, admin, {
      eventType: "password_changed_by_user",
      actorUid: uid,
      targetUid: uid,
    });
    return { ok: true };
  };

  const recordEmailChangeRequested = async (request) => {
    const { uid } = assertAuthenticated(request);
    const nextEmail = validateEmail(request.data?.newEmail);
    const userRecord = await auth.getUser(uid);
    await writeSecurityAuditLog(db, admin, {
      eventType: "email_change_requested",
      actorUid: uid,
      targetUid: uid,
      targetEmailMasked: maskEmail(userRecord.email),
      metadata: {
        currentEmailMasked: maskEmail(userRecord.email),
        newEmailMasked: maskEmail(nextEmail),
      },
    });
    return { ok: true, newEmailMasked: maskEmail(nextEmail) };
  };

  const syncMyAuthEmail = async (request) => {
    const { uid } = assertAuthenticated(request);
    const userRecord = await auth.getUser(uid);
    const authEmail = validateEmail(userRecord.email);
    const userRef = db.collection(USERS_COLLECTION).doc(uid);
    const snap = await userRef.get();
    const profile = snap.exists ? snap.data() || {} : {};
    const previousEmail = cleanString(profile.email).toLowerCase();
    if (previousEmail === authEmail) {
      return { ok: true, updated: false, email: authEmail, emailMasked: maskEmail(authEmail) };
    }
    await userRef.set(
      {
        uid,
        email: authEmail,
        updatedAt: timestamp(admin),
        updatedBy: uid,
      },
      { merge: true }
    );
    await writeSecurityAuditLog(db, admin, {
      eventType: "email_changed_by_user",
      actorUid: uid,
      targetUid: uid,
      targetEmailMasked: maskEmail(authEmail),
      metadata: {
        previousEmailMasked: maskEmail(previousEmail),
        currentEmailMasked: maskEmail(authEmail),
      },
    });
    return { ok: true, updated: true, email: authEmail, emailMasked: maskEmail(authEmail) };
  };

  return {
    updateMyProfile,
    adminResolveUser,
    adminSendPasswordReset,
    adminIssueTemporaryPassword,
    getMySessionControl,
    completeForcedPasswordChange,
    recordMyPasswordChange,
    recordEmailChangeRequested,
    syncMyAuthEmail,
  };
}

function createUserSecurityCallables(deps) {
  const handlers = createUserSecurityHandlers(deps);
  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [name, onCall(handler)])
  );
}

module.exports = {
  AUDIT_COLLECTION,
  SESSION_CONTROLS_COLLECTION,
  USERNAMES_COLLECTION,
  assertAdmin,
  assertAuthenticated,
  assertNotSelfReset,
  assertSuperAdmin,
  assertTargetIsNotSuperAdmin,
  createUserSecurityCallables,
  createUserSecurityHandlers,
  generateStrongTemporaryPassword,
  getAuthContext,
  getUserSafeProfile,
  maskEmail,
  normalizeUsername,
  sanitizeAuditMetadata,
  validateEmail,
  validateUsername,
  writeSecurityAuditLog,
};
