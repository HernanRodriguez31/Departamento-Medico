const normalizePushToken = (value) =>
  typeof value === "string" ? value.trim() : "";

const isValidPushToken = (value) =>
  /^[^\s\u0000-\u001F\u007F]{100,4096}$/.test(normalizePushToken(value));

const getAuthenticatedUid = (request) =>
  typeof request?.auth?.uid === "string" ? request.auth.uid.trim() : "";

module.exports = {
  getAuthenticatedUid,
  isValidPushToken,
  normalizePushToken,
};
