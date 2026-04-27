#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { getDefaultAvatarMigrationRows } from "../assets/js/common/default-avatars.js";

const DEFAULT_PROJECT_ID = "departamento-medico-brisa";

const args = new Set(process.argv.slice(2));
const commit = args.has("--commit");
const projectArg = process.argv.find((arg) => arg.startsWith("--project="));
const projectId = projectArg?.split("=")[1] || process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;

const loadAdminModules = async () => {
  try {
    const appModule = await import("firebase-admin/app");
    const firestoreModule = await import("firebase-admin/firestore");
    return { appModule, firestoreModule };
  } catch (error) {
    console.error(
      "No se encontro firebase-admin. Instala/ejecuta este script en un entorno admin antes de correr la migracion."
    );
    throw error;
  }
};

const readServiceAccount = async () => {
  const path = process.env.SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) return null;
  const content = await readFile(path, "utf8");
  return JSON.parse(content);
};

const initAdmin = async () => {
  const { appModule, firestoreModule } = await loadAdminModules();
  const { applicationDefault, cert, getApps, initializeApp } = appModule;
  const { FieldValue, getFirestore } = firestoreModule;
  const serviceAccount = await readServiceAccount();

  if (!getApps().length) {
    initializeApp({
      credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
      projectId
    });
  }

  return {
    db: getFirestore(),
    FieldValue
  };
};

const main = async () => {
  const rows = getDefaultAvatarMigrationRows();
  console.log(
    JSON.stringify(
      {
        mode: commit ? "commit" : "dry-run",
        projectId,
        total: rows.length,
        note: "Este script no toca avatarUrl; solo escribe defaultAvatarUrl por merge si se ejecuta con --commit."
      },
      null,
      2
    )
  );

  const { db, FieldValue } = await initAdmin();

  for (const row of rows) {
    const ref = db.collection("usuarios").doc(row.uid);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      console.log(`[skip] usuarios/${row.uid}: no existe el documento.`);
      continue;
    }

    const data = snapshot.data() || {};
    const hasUserAvatar = Boolean(data.avatarUrl);
    const payload = {
      defaultAvatarUrl: row.defaultAvatarUrl,
      defaultAvatarUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    if (commit) {
      await ref.set(payload, { merge: true });
    }

    console.log(
      `[${commit ? "merge" : "dry"}] usuarios/${row.uid}: ${row.defaultAvatarUrl}${
        hasUserAvatar ? " (avatarUrl existente preservado)" : ""
      }`
    );
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
