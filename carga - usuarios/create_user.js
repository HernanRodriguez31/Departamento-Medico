const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const parseArg = (flag, fallback = "") => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return String(process.argv[idx + 1] || "").trim() || fallback;
};

const required = (value, label) => {
  if (!value) {
    throw new Error(`Falta ${label}.`);
  }
  return value;
};

const localKeyPath = path.join(__dirname, "serviceAccountKey.local.json");
const serviceAccountPath =
  process.env.SERVICE_ACCOUNT_PATH ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  localKeyPath;

if (!fs.existsSync(serviceAccountPath)) {
  throw new Error(`No se encontro la service account: ${serviceAccountPath}`);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();
const db = admin.firestore();

const uid = required(parseArg("--uid"), "--uid");
const email = required(parseArg("--email"), "--email");
const password = required(parseArg("--password"), "--password");
const displayName = required(parseArg("--display-name"), "--display-name");
const puesto = required(parseArg("--puesto"), "--puesto");
const unidadNegocio = parseArg("--unidad-negocio", "");
const unidadGestion = parseArg("--unidad-gestion", "");
const username = parseArg("--username", "").toLowerCase();
const rol = parseArg("--rol", "medico");
const estado = parseArg("--estado", "offline");

if (password.length < 6) {
  throw new Error(
    "La contraseña debe tener al menos 6 caracteres para Firebase Auth. Recibido: menos de 6."
  );
}

async function upsertAuthUser() {
  try {
    const existingByUid = await auth.getUser(uid);
    await auth.updateUser(uid, {
      email,
      password,
      displayName,
      disabled: false
    });
    return { action: "updated", record: existingByUid };
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw error;
    }
  }

  try {
    const existingByEmail = await auth.getUserByEmail(email);
    if (existingByEmail.uid !== uid) {
      throw new Error(
        `El email ${email} ya existe en Auth con otro uid (${existingByEmail.uid}).`
      );
    }
  } catch (error) {
    if (error.code && error.code !== "auth/user-not-found") {
      throw error;
    }
  }

  const created = await auth.createUser({
    uid,
    email,
    password,
    displayName
  });
  return { action: "created", record: created };
}

async function upsertFirestoreProfile() {
  const ref = db.collection("usuarios").doc(uid);
  const snap = await ref.get();
  const payload = {
    nombre: displayName,
    email,
    puesto,
    unidadNegocio,
    unidadGestion,
    username,
    rol,
    estado
  };

  if (!snap.exists) {
    payload.fechaCreacion = admin.firestore.FieldValue.serverTimestamp();
  }

  await ref.set(payload, { merge: true });
  return ref.get();
}

async function main() {
  const authResult = await upsertAuthUser();
  const profileSnap = await upsertFirestoreProfile();
  const profile = profileSnap.data() || {};

  console.log(`Auth ${authResult.action}: ${uid}`);
  console.log(`Email: ${email}`);
  console.log(`Display name: ${displayName}`);
  console.log("Perfil Firestore:");
  console.log(
    JSON.stringify(
      {
        nombre: profile.nombre,
        email: profile.email,
        puesto: profile.puesto,
        unidadNegocio: profile.unidadNegocio || "",
        unidadGestion: profile.unidadGestion || "",
        username: profile.username || "",
        rol: profile.rol,
        estado: profile.estado,
        fechaCreacion: profile.fechaCreacion ? "present" : "missing"
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("No se pudo crear/actualizar el usuario:", error);
    process.exit(1);
  });
