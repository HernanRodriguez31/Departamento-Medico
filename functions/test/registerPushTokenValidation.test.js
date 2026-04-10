const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getAuthenticatedUid,
  isValidPushToken,
  normalizePushToken,
} = require("../push/registerPushTokenValidation");

test("normalizePushToken trims strings and rejects non-strings", () => {
  assert.equal(normalizePushToken(`  ${"a".repeat(100)}  `), "a".repeat(100));
  assert.equal(normalizePushToken(null), "");
  assert.equal(normalizePushToken({ token: "x" }), "");
});

test("isValidPushToken enforces length and whitespace constraints", () => {
  assert.equal(isValidPushToken("a".repeat(99)), false);
  assert.equal(isValidPushToken("a".repeat(100)), true);
  assert.equal(isValidPushToken("a".repeat(4096)), true);
  assert.equal(isValidPushToken("a".repeat(4097)), false);
  assert.equal(isValidPushToken(`${"a".repeat(50)} ${"b".repeat(50)}`), false);
  assert.equal(isValidPushToken(`${"a".repeat(50)}\n${"b".repeat(50)}`), false);
});

test("getAuthenticatedUid only trusts server auth context", () => {
  assert.equal(getAuthenticatedUid({ auth: { uid: "user-a" }, data: { uid: "user-b" } }), "user-a");
  assert.equal(getAuthenticatedUid({ data: { uid: "user-b" } }), "");
  assert.equal(getAuthenticatedUid(null), "");
});
