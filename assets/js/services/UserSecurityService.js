import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { getFirebase } from "../common/firebaseClient.js";

const FUNCTIONS_REGION = "us-central1";
const callableCache = new Map();

const getCallable = (name) => {
  if (callableCache.has(name)) return callableCache.get(name);
  const { app } = getFirebase();
  const functions = getFunctions(app, FUNCTIONS_REGION);
  const callable = httpsCallable(functions, name);
  callableCache.set(name, callable);
  return callable;
};

const callUserSecurity = async (name, payload = {}) => {
  const result = await getCallable(name)(payload);
  return result?.data || {};
};

export const updateMyProfile = (payload) => callUserSecurity("updateMyProfile", payload);

export const adminResolveUser = (payload) => callUserSecurity("adminResolveUser", payload);

export const adminSendPasswordReset = (payload) =>
  callUserSecurity("adminSendPasswordReset", payload);

export const adminIssueTemporaryPassword = (payload) =>
  callUserSecurity("adminIssueTemporaryPassword", payload);

export const getMySessionControl = () => callUserSecurity("getMySessionControl", {});

export const completeForcedPasswordChange = () =>
  callUserSecurity("completeForcedPasswordChange", {});

export const recordMyPasswordChange = () => callUserSecurity("recordMyPasswordChange", {});

export const recordEmailChangeRequested = (payload) =>
  callUserSecurity("recordEmailChangeRequested", payload);

export const syncMyAuthEmail = () => callUserSecurity("syncMyAuthEmail", {});
