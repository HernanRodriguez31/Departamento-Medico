import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { escapeAttribute, escapeHTML, safeText } from "../assets/js/utils/safe-dom.js";

test("safeText normalizes nullish values", () => {
  assert.equal(safeText(null), "");
  assert.equal(safeText(undefined), "");
  assert.equal(safeText(42), "42");
});

test("escapeHTML renders XSS payloads inert", () => {
  const cases = [
    ['<img src=x onerror=alert(1)>', "&lt;img src=x onerror=alert(1)&gt;"],
    ["<script>alert(1)</script>", "&lt;script&gt;alert(1)&lt;/script&gt;"],
    ["<svg onload=alert(1)>", "&lt;svg onload=alert(1)&gt;"],
    ['<a href="javascript:alert(1)">click</a>', "&lt;a href=&quot;javascript:alert(1)&quot;&gt;click&lt;/a&gt;"],
    ["Tom & Jerry's", "Tom &amp; Jerry&#39;s"]
  ];

  cases.forEach(([input, expected]) => {
    assert.equal(escapeHTML(input), expected);
  });
});

test("escapeAttribute replaces ASCII control characters before escaping", () => {
  assert.equal(escapeAttribute('a\nb"c'), "a b&quot;c");
});

test("login forgot-password modal exposes administrator contact only", () => {
  const html = readFileSync("login.html", "utf8");
  assert.match(html, /Restablecer acceso/);
  assert.match(html, /HRodriguez@pan-energy\.com/);
  assert.match(html, /11 2454-2499/);
  assert.match(html, /wa\.me\/5491124542499/);
  assert.doesNotMatch(html, /data-local-emulator-notice/);
  assert.doesNotMatch(html, /Modo emulador local/);
  assert.doesNotMatch(html, /Usuario local no encontrado o contraseña incorrecta en el emulador/);
  assert.doesNotMatch(html, /contrase(?:ñ|n)a maestra/i);
  assert.doesNotMatch(html, /backdoor/i);
});

test("local auth emulator seed script is guarded against production use", () => {
  const source = readFileSync("functions/scripts/seed-local-auth-emulator.js", "utf8");
  assert.match(source, /FIREBASE_AUTH_EMULATOR_HOST/);
  assert.match(source, /FIRESTORE_EMULATOR_HOST/);
  assert.match(source, /Refusing to seed outside Firebase emulators/);
  assert.match(source, /looks like a production host/);
  assert.match(source, /firebaseio\|googleapis\|firebasestorage\|appspot\|cloudfunctions\|firebaseapp/);
  assert.match(source, /--force-reset-user/);
  assert.match(source, /hrodriguez@pan-energy\.com/);
  assert.match(source, /usuario\.local@brisa\.test/);
  assert.match(source, /reset\.local@brisa\.test/);
  assert.doesNotMatch(source, /credential\.applicationDefault/);
});

test("user security menu includes profile and superAdmin UI gates", () => {
  const source = readFileSync("assets/js/common/user-menu.js", "utf8");
  assert.match(source, /Mi perfil y seguridad/);
  assert.match(source, /user-menu__security-icon/);
  assert.match(source, /Cambiar correo/);
  assert.match(source, /data-password-visibility/);
  assert.match(source, /Restablecer usuario/);
  assert.match(source, /Generar contraseña temporal/);
  assert.match(source, /claims\.superAdmin === true/);
  assert.doesNotMatch(source, /console\.log\(\s*temporaryPassword\s*\)/);
  assert.doesNotMatch(source, /console\.(log|debug|info)\([^)]*password/i);
  assert.doesNotMatch(source, /contrase(?:ñ|n)a maestra/i);
  assert.doesNotMatch(source, /backdoor/i);
});

test("user menu dropdown styles are centralized and scoped", () => {
  const source = readFileSync("assets/js/common/user-menu.js", "utf8");
  assert.match(source, /dm-user-menu-styles/);
  assert.match(source, /body \[data-dm-user-menu\]/);
  assert.match(source, /\[data-dm-user-dropdown\]\.user-panel-dropdown/);
  assert.match(source, /display: none !important/);
  assert.match(source, /user-menu__security-action/);
  assert.match(source, /user-menu__logout/);
  assert.match(source, /focus-visible/);
});
