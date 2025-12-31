import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getMessaging, isSupported } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

const APP_NAME = "AuthApp";
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDabEuXGyD5muXCGrbQ1WB9j-CFmVnxudU",
  authDomain: "departamento-medico-brisa.firebaseapp.com",
  projectId: "departamento-medico-brisa",
  storageBucket: "departamento-medico-brisa.firebasestorage.app",
  messagingSenderId: "830022654524",
  appId: "1:830022654524:web:45321f121e62d2815cc139"
};

const resolveConfig = () => {
  if (typeof window !== "undefined" && window.__FIREBASE_CONFIG__) {
    return window.__FIREBASE_CONFIG__;
  }
  if (typeof window !== "undefined") {
    window.__FIREBASE_CONFIG__ = DEFAULT_FIREBASE_CONFIG;
  }
  return DEFAULT_FIREBASE_CONFIG;
};

const getAppInstance = () => {
  const apps = getApps();
  const named = apps.find((app) => app.name === APP_NAME);
  if (named) return named;
  if (apps.length) return apps[0];
  return initializeApp(resolveConfig(), APP_NAME);
};

let cached = null;
let messaging = null;

export const getFirebaseConfig = () => resolveConfig();

export const getFirebase = () => {
  if (cached) return cached;
  const app = getAppInstance();
  cached = {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    storage: getStorage(app)
  };
  return cached;
};

export const ensureMessaging = async () => {
  if (messaging) return messaging;
  const supported = await isSupported();
  if (!supported) return null;
  messaging = getMessaging(getFirebase().app);
  return messaging;
};

const { app, auth, db, storage } = getFirebase();

export { app, auth, db, storage, messaging };
