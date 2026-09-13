/**
 * Funciones del hub "Departamento de Salud Brisa" (salud.brisasaludybienestar.com).
 *
 *  - hubHandoff : el hub ya autenticó al usuario contra ESTE proyecto y pide un
 *                 token de traspaso para que el portal (dm.brisasaludybienestar.com)
 *                 establezca su propia sesión sin volver a pedir la contraseña.
 *  - hubExchange: un usuario de Enfermería (otro proyecto Firebase) presenta su
 *                 ID token; se verifica contra el proyecto de Enfermería y se le
 *                 emite una identidad federada en este proyecto, limitada a la
 *                 pizarra (claims hubOnly + hubDept). Las reglas de Firestore
 *                 excluyen a estas identidades de todo lo que no sea la pizarra.
 *
 * Requisito operativo: la cuenta de servicio de runtime necesita el rol
 * "Service Account Token Creator" para firmar tokens personalizados
 * (ver docs/DESPLIEGUE.md del hub).
 */
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

const NURSING_PROJECT_ID = "departamento-enfermeria-brisa";
const NURSING_VERIFIER_APP = "nursing-verifier";
const SESSION_CONTROLS_COLLECTION = "dm_session_controls";
const HUB_ALLOWED_ORIGINS = [
  "https://salud.brisasaludybienestar.com",
  "https://departamento-salud-brisa.web.app",
  "https://departamento-salud-brisa.firebaseapp.com",
];
const LOCAL_ORIGINS = [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
const TOKEN_TTL_SECONDS = 3600;
const FEDERATED_UID_PREFIX = "enf_";

const cleanString = (value) => (typeof value === "string" ? value.trim() : "");

const isEmulator = () => process.env.FUNCTIONS_EMULATOR === "true";

const corsOrigins = () => (isEmulator() ? [...HUB_ALLOWED_ORIGINS, ...LOCAL_ORIGINS] : HUB_ALLOWED_ORIGINS);

const toSeconds = (value) => {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  if (typeof value.toMillis === "function") return Math.floor(value.toMillis() / 1000);
  if (typeof value.seconds === "number") return value.seconds;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
  }
  return 0;
};

function getNursingVerifierApp(admin) {
  const existing = (admin.apps || []).find((app) => app && app.name === NURSING_VERIFIER_APP);
  if (existing) return existing;
  // Sin credenciales propias: la verificación de ID tokens solo necesita el
  // projectId (audiencia/emisor) y las claves públicas de Google.
  return admin.initializeApp({ projectId: NURSING_PROJECT_ID }, NURSING_VERIFIER_APP);
}

function createHubHandlers({ admin, db, nursingProjectId = NURSING_PROJECT_ID, verifyNursingToken } = {}) {
  const verifyNursing = verifyNursingToken || ((idToken) => getNursingVerifierApp(admin).auth().verifyIdToken(idToken));

  const assertHubSession = (request) => {
    const uid = cleanString(request.auth?.uid);
    if (!uid) throw new HttpsError("unauthenticated", "Sesión requerida.");
    const token = request.auth?.token && typeof request.auth.token === "object" ? request.auth.token : {};
    if (token.hubOnly === true) {
      throw new HttpsError("permission-denied", "Esta identidad solo habilita la pizarra.");
    }
    return { uid, token };
  };

  /** Respeta los controles de sesión existentes (cierre forzado por un administrador). */
  const assertSessionAllowed = async (uid, token) => {
    const authTime = Number(token.auth_time) || 0;
    let control = null;
    try {
      const snap = await db.collection(SESSION_CONTROLS_COLLECTION).doc(uid).get();
      control = snap.exists ? snap.data() || {} : null;
    } catch (error) {
      logger.warn("hubHandoff: no se pudo leer el control de sesión", { uid, code: error?.code });
      control = null;
    }
    if (!control) return;
    const forcedLogout = toSeconds(control.forcedLogoutAt);
    const validAfter = toSeconds(control.sessionValidAfter);
    if ((forcedLogout && authTime && forcedLogout > authTime) || (validAfter && authTime && validAfter > authTime)) {
      throw new HttpsError("unauthenticated", "La sesión fue cerrada por un administrador. Ingresá nuevamente.");
    }
  };

  const hubHandoff = async (request) => {
    const { uid, token } = assertHubSession(request);
    let userRecord;
    try {
      userRecord = await admin.auth().getUser(uid);
    } catch (error) {
      throw new HttpsError("not-found", "No se encontró la cuenta.");
    }
    if (userRecord?.disabled) throw new HttpsError("permission-denied", "La cuenta está deshabilitada.");
    await assertSessionAllowed(uid, token);
    const handoffToken = await admin.auth().createCustomToken(uid, { hubHandoff: true });
    logger.info("hubHandoff emitido", { uid });
    return { token: handoffToken, expiresInSeconds: TOKEN_TTL_SECONDS };
  };

  const hubExchange = async (request) => {
    const idToken = cleanString(request.data?.idToken);
    const dept = cleanString(request.data?.dept) || "enfermeria";
    if (!idToken) throw new HttpsError("invalid-argument", "Falta el token de identidad.");
    if (dept !== "enfermeria") throw new HttpsError("invalid-argument", "Departamento no admitido.");

    let decoded;
    try {
      decoded = await verifyNursing(idToken);
    } catch (error) {
      logger.warn("hubExchange: token de Enfermería inválido", { code: error?.code });
      throw new HttpsError("unauthenticated", "Identidad de Enfermería inválida o vencida.");
    }
    const sourceUid = cleanString(decoded?.uid || decoded?.sub);
    if (!sourceUid) throw new HttpsError("unauthenticated", "Identidad de Enfermería inválida.");
    if (decoded.aud && decoded.aud !== nursingProjectId) {
      throw new HttpsError("unauthenticated", "Identidad de otro proyecto.");
    }
    const provider = cleanString(decoded?.firebase?.sign_in_provider);
    if (provider === "custom" || provider === "anonymous") {
      throw new HttpsError("permission-denied", "Proveedor de identidad no admitido.");
    }

    const hubUid = `${FEDERATED_UID_PREFIX}${sourceUid}`;
    const claims = {
      hubOnly: true,
      hubDept: "enfermeria",
      hubEmail: cleanString(decoded.email).toLowerCase(),
      hubName: cleanString(decoded.name),
      hubSourceUid: sourceUid,
    };
    const token = await admin.auth().createCustomToken(hubUid, claims);
    logger.info("hubExchange emitido", { hubUid });
    return { token, uid: hubUid, expiresInSeconds: TOKEN_TTL_SECONDS };
  };

  return { hubHandoff, hubExchange };
}

function createHubCallables(deps) {
  const handlers = createHubHandlers(deps);
  const options = { cors: corsOrigins() };
  return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, onCall(options, handler)]));
}

module.exports = {
  FEDERATED_UID_PREFIX,
  HUB_ALLOWED_ORIGINS,
  NURSING_PROJECT_ID,
  SESSION_CONTROLS_COLLECTION,
  TOKEN_TTL_SECONDS,
  createHubCallables,
  createHubHandlers,
  toSeconds,
};
