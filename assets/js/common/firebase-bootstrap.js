import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

export const FIREBASE_APP_NAME = "AuthApp";

export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDabEuXGyD5muXCGrbQ1WB9j-CFmVnxudU",
  authDomain: "departamento-medico-brisa.firebaseapp.com",
  projectId: "departamento-medico-brisa",
  storageBucket: "departamento-medico-brisa.firebasestorage.app",
  messagingSenderId: "830022654524",
  appId: "1:830022654524:web:45321f121e62d2815cc139"
};

const getWindow = () => (typeof window !== "undefined" ? window : null);

let cachedServices = null;

export const isLocalHost = () => {
  const host = getWindow()?.location?.hostname;
  return host === "localhost" || host === "127.0.0.1";
};

export const isLocalRealBackend = () => isLocalHost();

export const shouldUseFirebaseEmulators = () => false;

export const resolveFirebaseBackendMode = () => "real";

export const installBackendModeGlobals = (target = getWindow()) => {
  if (!target) return "real";
  target.__DM_BACKEND_MODE__ = "real";
  target.__DM_LOCAL_REAL_BACKEND__ = isLocalRealBackend();
  target.__DM_FIREBASE_EMULATORS_ENABLED__ = false;
  return "real";
};

export const resolveFirebaseConfig = () => {
  const target = getWindow();
  if (target?.__FIREBASE_CONFIG__) {
    return target.__FIREBASE_CONFIG__;
  }
  if (target) {
    target.__FIREBASE_CONFIG__ = DEFAULT_FIREBASE_CONFIG;
  }
  return DEFAULT_FIREBASE_CONFIG;
};

export const getFirebaseApp = () => {
  const apps = getApps();
  const named = apps.find((app) => app.name === FIREBASE_APP_NAME);
  if (named) return named;
  if (apps.length) return apps[0];
  return initializeApp(resolveFirebaseConfig(), FIREBASE_APP_NAME);
};

export const getFirebaseServices = () => {
  if (cachedServices) return cachedServices;
  installBackendModeGlobals();
  const app = getFirebaseApp();
  cachedServices = {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    storage: getStorage(app)
  };
  return cachedServices;
};

export const installFirebaseGlobals = (target = getWindow()) => {
  const services = getFirebaseServices();
  if (!target) return services;
  installBackendModeGlobals(target);
  target.__FIREBASE_CONFIG__ = resolveFirebaseConfig();
  target.__FIREBASE_APP__ = services.app;
  target.__FIREBASE_AUTH__ = services.auth;
  target.__FIREBASE_DB__ = services.db;
  target.__FIREBASE_STORAGE__ = services.storage;
  return services;
};
