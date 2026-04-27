import test from "node:test";
import assert from "node:assert/strict";

import {
  formatTime24h,
  normalizeTimePartInput,
  parseTimeParts,
  splitMinutesToTimeParts,
} from "../assets/js/common/calendar-time.js";
import {
  PROFILE_AVATAR_VERSION,
  getDefaultAvatarMigrationRows,
  resolveDefaultAvatarUrl,
} from "../assets/js/common/default-avatars.js";
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

test("formatTime24h always renders 24-hour values", () => {
  assert.equal(formatTime24h(420), "07:00");
  assert.equal(formatTime24h(495), "08:15");
  assert.equal(formatTime24h(1005), "16:45");
});

test("normalizeTimePartInput pads valid hour and minute segments on blur", () => {
  assert.deepEqual(normalizeTimePartInput("7", "hours"), {
    raw: "7",
    display: "07",
    value: 7,
    valid: true,
  });
  assert.deepEqual(normalizeTimePartInput("5", "minutes"), {
    raw: "5",
    display: "05",
    value: 5,
    valid: true,
  });
});

test("parseTimeParts validates and combines split hour/minute inputs", () => {
  assert.deepEqual(parseTimeParts("7", "5"), {
    display: "07:05",
    minutes: 425,
    valid: true,
    complete: true,
  });

  assert.deepEqual(parseTimeParts("", ""), {
    display: "",
    minutes: null,
    valid: true,
    complete: false,
  });

  assert.equal(parseTimeParts("07", "").valid, false);
  assert.equal(parseTimeParts("24", "00").valid, false);
  assert.equal(parseTimeParts("09", "67").valid, false);
});

test("splitMinutesToTimeParts supports round-trip editing without losing minutes", () => {
  assert.deepEqual(splitMinutesToTimeParts(495), {
    hours: "08",
    minutes: "15",
  });
  assert.deepEqual(splitMinutesToTimeParts(null), {
    hours: "",
    minutes: "",
  });
});

test("default profile avatars resolve by uid, email, and display name", () => {
  const version = `?v=${PROFILE_AVATAR_VERSION}`;
  const cases = [
    [{ uid: "HRodriguez" }, "coord-rodriguez-new.png"],
    [{ email: "HRodriguez@pan-energy.com" }, "coord-rodriguez-new.png"],
    [{ email: "hrodriguez@pan-energy.com" }, "coord-rodriguez-new.png"],
    [{ name: "Hernan Rodriguez" }, "coord-rodriguez-new.png"],
    [{ name: "Hernán Rodríguez" }, "coord-rodriguez-new.png"],
    [{ uid: "LCura" }, "avatar-leila-cura-featured-tight-20260411.png"],
    [{ email: "LCura@pan-energy.com" }, "avatar-leila-cura-featured-tight-20260411.png"],
    [{ name: "Leila Cura" }, "avatar-leila-cura-featured-tight-20260411.png"],
    [{ name: "Dra. Leila Cura" }, "avatar-leila-cura-featured-tight-20260411.png"],
    [{ uid: "GSilva" }, "avatar-silva-new.png"],
    [{ email: "GSilva@pan-energy.com" }, "avatar-silva-new.png"],
    [{ name: "Gustavo Silva" }, "avatar-silva-new.png"],
    [{ uid: "JAzcarate" }, "avatar-azcarate-new.png"],
    [{ email: "JAzcarate@pan-energy.com" }, "avatar-azcarate-new.png"],
    [{ name: "Juan Martin Azcarate" }, "avatar-azcarate-new.png"],
    [{ name: "Juan Martín Azcárate" }, "avatar-azcarate-new.png"],
    [{ uid: "MBianchi" }, "coord-bianchi-new.png"],
    [{ email: "MBianchi@pan-energy.com" }, "coord-bianchi-new.png"],
    [{ name: "Mario Bianchi" }, "coord-bianchi-new.png"],
    [{ uid: "JMaurino" }, "coord-maurino-new.png"],
    [{ email: "JMaurino@pan-energy.com" }, "coord-maurino-new.png"],
    [{ name: "Juan Maurino" }, "coord-maurino-new.png"],
    [{ uid: "SAciar" }, "coord-aciar-new.png"],
    [{ email: "SAciar@pan-energy.com" }, "coord-aciar-new.png"],
    [{ name: "Sergio Aciar" }, "coord-aciar-new.png"],
    [{ uid: "RSabha" }, "coord-sabha-new.png"],
    [{ email: "RSabha@pan-energy.com" }, "coord-sabha-new.png"],
    [{ name: "Roberto Sabha" }, "coord-sabha-new.png"],
  ];

  cases.forEach(([identity, file]) => {
    assert.equal(
      resolveDefaultAvatarUrl(identity),
      `/assets/images/${file}${version}`,
    );
  });
  assert.equal(resolveDefaultAvatarUrl({ uid: "unknown-user" }), "");
});

test("default avatar migration rows never write user-selected avatarUrl", () => {
  const rows = getDefaultAvatarMigrationRows();
  assert.equal(rows.length, 8);
  assert.equal(new Set(rows.map((row) => row.uid)).size, rows.length);
  rows.forEach((row) => {
    assert.ok(row.defaultAvatarUrl.includes(PROFILE_AVATAR_VERSION));
    assert.equal(Object.hasOwn(row, "avatarUrl"), false);
  });
});
