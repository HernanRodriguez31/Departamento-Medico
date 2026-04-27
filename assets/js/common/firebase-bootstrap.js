import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  connectAuthEmulator,
  getAuth
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  connectFirestoreEmulator,
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  connectStorageEmulator,
  getStorage
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

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
const emulatorConnections = {
  auth: false,
  firestore: false,
  storage: false
};

const LOCAL_EMULATOR_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_EMULATORS = Object.freeze({
  host: "127.0.0.1",
  authPort: 9099,
  firestorePort: 8080,
  storagePort: 9199
});

export const shouldUseFirebaseEmulators = (target = getWindow()) => {
  if (!target?.location) return false;
  const host = target.location.hostname;
  if (!LOCAL_EMULATOR_HOSTS.has(host)) return false;
  const params = new URLSearchParams(target.location.search || "");
  return params.get("dmEmulators") === "1" || target.__DM_USE_FIREBASE_EMULATORS__ === true;
};

const getEmulatorConfig = (target = getWindow()) => ({
  ...DEFAULT_EMULATORS,
  ...(target?.__DM_FIREBASE_EMULATORS__ || {})
});

const connectServicesToEmulators = (services, target = getWindow()) => {
  if (!shouldUseFirebaseEmulators(target)) return services;
  const config = getEmulatorConfig(target);
  if (!emulatorConnections.auth) {
    connectAuthEmulator(services.auth, `http://${config.host}:${config.authPort}`, {
      disableWarnings: true
    });
    emulatorConnections.auth = true;
  }
  if (!emulatorConnections.firestore) {
    connectFirestoreEmulator(services.db, config.host, Number(config.firestorePort));
    emulatorConnections.firestore = true;
  }
  if (!emulatorConnections.storage) {
    connectStorageEmulator(services.storage, config.host, Number(config.storagePort));
    emulatorConnections.storage = true;
  }
  if (target) {
    target.__DM_FIREBASE_EMULATORS_ENABLED__ = true;
  }
  return services;
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
  const app = getFirebaseApp();
  cachedServices = {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    storage: getStorage(app)
  };
  connectServicesToEmulators(cachedServices);
  return cachedServices;
};

export const installFirebaseGlobals = (target = getWindow()) => {
  const services = getFirebaseServices();
  if (!target) return services;
  target.__FIREBASE_CONFIG__ = resolveFirebaseConfig();
  target.__FIREBASE_APP__ = services.app;
  target.__FIREBASE_AUTH__ = services.auth;
  target.__FIREBASE_DB__ = services.db;
  target.__FIREBASE_STORAGE__ = services.storage;
  return services;
};
