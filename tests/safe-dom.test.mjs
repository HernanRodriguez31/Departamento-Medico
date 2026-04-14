import test from "node:test";
import assert from "node:assert/strict";

import {
  formatTime24h,
  normalizeTimePartInput,
  parseTimeParts,
  splitMinutesToTimeParts,
} from "../assets/js/common/calendar-time.js";
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
