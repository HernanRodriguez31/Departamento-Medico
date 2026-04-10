import test from "node:test";
import assert from "node:assert/strict";

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
