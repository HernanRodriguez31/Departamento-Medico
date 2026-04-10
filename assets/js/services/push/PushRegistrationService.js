import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { getFirebase } from "/assets/js/common/firebaseClient.js";
import { waitForAuth } from "/assets/js/shared/authGate.js";

const FUNCTIONS_REGION = "us-central1";
const REGISTER_PUSH_TOKEN_FUNCTION = "registerPushToken";
const TOKEN_MIN_LENGTH = 100;
const TOKEN_MAX_LENGTH = 4096;
const CONTROL_OR_WHITESPACE_PATTERN = /[\s\x00-\x1F\x7F]/;

let registerPushTokenCallable = null;

const normalizePushToken = (token) =>
  typeof token === "string" ? token.trim() : "";

const isValidPushToken = (token) =>
  token.length >= TOKEN_MIN_LENGTH &&
  token.length <= TOKEN_MAX_LENGTH &&
  !CONTROL_OR_WHITESPACE_PATTERN.test(token);

const getRegisterPushTokenCallable = () => {
  if (registerPushTokenCallable) return registerPushTokenCallable;
  const { app } = getFirebase();
  const functions = getFunctions(app, FUNCTIONS_REGION);
  registerPushTokenCallable = httpsCallable(
    functions,
    REGISTER_PUSH_TOKEN_FUNCTION,
  );
  return registerPushTokenCallable;
};

const normalizeRegistrationError = (error) => {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code.endsWith("/unauthenticated") || code === "unauthenticated") {
    return "auth_required";
  }
  if (code.endsWith("/invalid-argument") || code === "invalid-argument") {
    return "invalid_token";
  }
  return "registration_failed";
};

export const registerPushTokenForCurrentUser = async (token) => {
  const normalizedToken = normalizePushToken(token);
  if (!isValidPushToken(normalizedToken)) {
    return { ok: false, reason: "invalid_token" };
  }

  const { auth } = getFirebase();
  const user = await waitForAuth(auth);
  const authenticatedUid = user?.uid || "";
  if (!authenticatedUid) {
    return { ok: false, reason: "auth_required" };
  }

  try {
    await getRegisterPushTokenCallable()({ token: normalizedToken });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: normalizeRegistrationError(error) };
  }
};
