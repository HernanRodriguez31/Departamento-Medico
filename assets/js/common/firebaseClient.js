import { getMessaging, isSupported } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import {
  getFirebaseServices,
  resolveFirebaseConfig
} from "./firebase-bootstrap.js";

let messaging = null;

export const getFirebaseConfig = () => resolveFirebaseConfig();

export const getFirebase = () => getFirebaseServices();

export const ensureMessaging = async () => {
  if (messaging) return messaging;
  const supported = await isSupported();
  if (!supported) return null;
  messaging = getMessaging(getFirebase().app);
  return messaging;
};

const { app, auth, db, storage } = getFirebase();

export { app, auth, db, storage, messaging };
