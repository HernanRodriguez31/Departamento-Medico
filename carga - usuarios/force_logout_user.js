const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const parseArg = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
};

const uid = parseArg("--uid");
const reason = parseArg("--reason") || "manual_admin_logout";

if (!uid) {
  console.error("Uso: node force_logout_user.js --uid <UID> [--reason <motivo>]");
  process.exit(1);
}

const localKeyPath = path.join(__dirname, "serviceAccountKey.local.json");
const serviceAccountPath =
  process.env.SERVICE_ACCOUNT_PATH ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  localKeyPath;

if (!fs.existsSync(serviceAccountPath)) {
  console.error(`No se encontro la service account: ${serviceAccountPath}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const auth = admin.auth();

async function main() {
  const user = await auth.getUser(uid);
  await auth.revokeRefreshTokens(uid);

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();

  batch.set(
    db.collection("dm_session_controls").doc(uid),
    {
      forcedLogoutAt: now,
      updatedAt: now,
      reason
    },
    { merge: true }
  );

  batch.set(
    db.collection("dm_presence").doc(uid),
    {
      uid,
      displayName: user.displayName || "",
      online: false,
      updatedAt: now
    },
    { merge: true }
  );

  await batch.commit();

  console.log(`Sesion invalidada para ${uid}.`);
  console.log(`Usuario: ${user.displayName || user.email || uid}`);
  console.log(`Motivo: ${reason}`);
  console.log(`Tokens validos desde: ${user.tokensValidAfterTime || "n/d"}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("No se pudo forzar el logout:", error);
    process.exit(1);
  });
