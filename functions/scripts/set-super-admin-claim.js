#!/usr/bin/env node

const admin = require("firebase-admin");

const clean = (value) => (typeof value === "string" ? value.trim() : "");

function maskEmail(email = "") {
  const cleanEmail = clean(email).toLowerCase();
  const [local, domain] = cleanEmail.split("@");
  if (!local || !domain) return "";
  const visible = local.length <= 2
    ? `${local[0] || ""}*`
    : `${local.slice(0, 2)}${"*".repeat(Math.min(6, local.length - 2))}`;
  return `${visible}@${domain}`;
}

async function main() {
  const adminEmail = clean(process.env.ADMIN_EMAIL);
  const adminUid = clean(process.env.ADMIN_UID);

  if (!adminEmail && !adminUid) {
    throw new Error("Set ADMIN_EMAIL or ADMIN_UID.");
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });

  const auth = admin.auth();
  const user = adminUid
    ? await auth.getUser(adminUid)
    : await auth.getUserByEmail(adminEmail);

  const currentClaims = user.customClaims || {};
  const nextClaims = {
    ...currentClaims,
    admin: true,
    superAdmin: true,
    role: "superAdmin",
  };

  await auth.setCustomUserClaims(user.uid, nextClaims);

  console.log("super_admin_claim_set");
  console.log(`uid: ${user.uid}`);
  console.log(`email: ${maskEmail(user.email || adminEmail)}`);
  console.log("Hernan debe cerrar sesion y volver a iniciar sesion para refrescar el token.");
}

main().catch((error) => {
  console.error("No se pudo asignar el claim superAdmin:", error.message || error);
  process.exit(1);
});
