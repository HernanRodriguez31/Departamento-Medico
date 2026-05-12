#!/usr/bin/env node

const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "departamento-medico-brisa";
const AUTH_EMULATOR_ENV = "FIREBASE_AUTH_EMULATOR_HOST";
const FIRESTORE_EMULATOR_ENV = "FIRESTORE_EMULATOR_HOST";

const LOCAL_USERS = [
  {
    email: "hrodriguez@pan-energy.com",
    password: "BrisaLocalAdmin-2026!",
    displayName: "Hernán Rodríguez",
    username: "hernan",
    role: "superAdmin",
    claims: {
      admin: true,
      superAdmin: true,
      role: "superAdmin",
    },
  },
  {
    email: "usuario.local@brisa.test",
    password: "BrisaLocalUser-2026!",
    displayName: "Usuario Local",
    username: "usuario-local",
    role: "user",
    claims: {
      role: "user",
    },
  },
  {
    email: "reset.local@brisa.test",
    password: "BrisaReset-2026!",
    displayName: "Usuario Reset Local",
    username: "reset-local",
    role: "user",
    claims: {
      role: "user",
    },
  },
];

const clean = (value) => (typeof value === "string" ? value.trim() : "");

function assertLocalEmulatorHost(envName) {
  const value = clean(process.env[envName]);
  if (!value) {
    throw new Error(`${envName} is required. Refusing to seed outside Firebase emulators.`);
  }
  if (/^https?:\/\//i.test(value)) {
    throw new Error(`${envName} must be a host:port value, not a URL.`);
  }
  if (
    /firebaseio|googleapis|firebasestorage|appspot|cloudfunctions|firebaseapp/i.test(value)
  ) {
    throw new Error(`${envName} looks like a production host. Refusing to continue.`);
  }
  if (!/^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(value)) {
    throw new Error(`${envName} must point to localhost or 127.0.0.1. Received: ${value}`);
  }
  return value;
}

async function upsertAuthUser(auth, userConfig) {
  let userRecord = null;
  try {
    userRecord = await auth.getUserByEmail(userConfig.email);
    userRecord = await auth.updateUser(userRecord.uid, {
      email: userConfig.email,
      password: userConfig.password,
      displayName: userConfig.displayName,
      emailVerified: true,
      disabled: false,
    });
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    userRecord = await auth.createUser({
      email: userConfig.email,
      password: userConfig.password,
      displayName: userConfig.displayName,
      emailVerified: true,
      disabled: false,
    });
  }

  await auth.setCustomUserClaims(userRecord.uid, userConfig.claims);
  return userRecord;
}

async function upsertPublicProfile(db, userRecord, userConfig) {
  const usernameLower = userConfig.username.toLowerCase();
  const now = FieldValue.serverTimestamp();
  await db.collection("usuarios").doc(userRecord.uid).set(
    {
      uid: userRecord.uid,
      email: userConfig.email,
      displayName: userConfig.displayName,
      username: usernameLower,
      usernameLower,
      photoURL: userRecord.photoURL || "",
      active: true,
      role: userConfig.role,
      updatedAt: now,
    },
    { merge: true }
  );

  const usernameRef = db.collection("usernames").doc(usernameLower);
  const usernameSnap = await usernameRef.get();
  await usernameRef.set(
    {
      uid: userRecord.uid,
      displayName: userConfig.displayName,
      ...(usernameSnap.exists ? {} : { createdAt: now }),
      updatedAt: now,
    },
    { merge: true }
  );
}

async function markResetUserAsForced(db, uid) {
  await db.collection("dm_session_controls").doc(uid).set(
    {
      uid,
      forcePasswordChange: true,
      tempPasswordIssuedAt: FieldValue.serverTimestamp(),
      tempPasswordIssuedBy: "local-seed",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function main() {
  const authHost = assertLocalEmulatorHost(AUTH_EMULATOR_ENV);
  const firestoreHost = assertLocalEmulatorHost(FIRESTORE_EMULATOR_ENV);
  const forceResetUser = process.argv.includes("--force-reset-user");

  admin.initializeApp({ projectId: PROJECT_ID });
  const auth = admin.auth();
  const db = admin.firestore();

  const seeded = [];
  for (const userConfig of LOCAL_USERS) {
    const userRecord = await upsertAuthUser(auth, userConfig);
    await upsertPublicProfile(db, userRecord, userConfig);
    seeded.push({
      uid: userRecord.uid,
      email: userConfig.email,
      username: userConfig.username,
      role: userConfig.role,
    });
    if (forceResetUser && userConfig.email === "reset.local@brisa.test") {
      await markResetUserAsForced(db, userRecord.uid);
    }
  }

  console.log("local_auth_emulator_seed_completed");
  console.log(`projectId: ${PROJECT_ID}`);
  console.log(`authEmulator: ${authHost}`);
  console.log(`firestoreEmulator: ${firestoreHost}`);
  seeded.forEach((user) => {
    console.log(`user: ${user.email} | username: ${user.username} | role: ${user.role} | uid: ${user.uid}`);
  });
  if (forceResetUser) {
    console.log("reset.local@brisa.test marked with forcePasswordChange=true");
  }
  console.log("Local passwords are documented in docs/local-auth-emulator.md and are emulator-only.");
}

main().catch((error) => {
  console.error("local_auth_emulator_seed_failed:", error.message || error);
  process.exit(1);
});
