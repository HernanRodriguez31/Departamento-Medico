// Stub de firebase-auth: usuario de prueba definido en window.__PD_TEST_USER__.
const buildUser = () => {
  const raw = (typeof window !== "undefined" && window.__PD_TEST_USER__) || null;
  if (!raw) return null;
  return {
    uid: raw.uid,
    email: raw.email || "",
    displayName: raw.displayName || "",
    metadata: { lastSignInTime: new Date().toISOString() },
    getIdTokenResult: async () => ({ claims: (typeof window !== "undefined" && window.__PD_TEST_CLAIMS__) || {}, authTime: new Date().toISOString() }),
    getIdToken: async () => "stub-token"
  };
};
let authInstance = null;
export function getAuth() {
  if (!authInstance) authInstance = { currentUser: buildUser(), app: null };
  return authInstance;
}
export function onAuthStateChanged(auth, next) {
  setTimeout(() => next(auth.currentUser), 0);
  return () => {};
}
export async function signOut(auth) {
  auth.currentUser = null;
  if (typeof window !== "undefined") window.__PD_SIGNED_OUT__ = true;
}
export async function updatePassword() {}
export async function signInWithEmailAndPassword() {
  throw new Error("stub");
}
export class EmailAuthProvider {}
export async function reauthenticateWithCredential() {}
export async function updateProfile() {}
export async function updateEmail() {}
export async function verifyBeforeUpdateEmail() {}
export async function sendPasswordResetEmail() {}
export async function signInWithCustomToken() { throw new Error("stub"); }
export async function setPersistence() {}
export const browserLocalPersistence = {};
export const browserSessionPersistence = {};
export const inMemoryPersistence = {};
