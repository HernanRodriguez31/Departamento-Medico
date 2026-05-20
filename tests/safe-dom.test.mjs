import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { escapeAttribute, escapeHTML, safeText, sanitizeURL } from "../assets/js/utils/safe-dom.js";

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

test("sanitizeURL rejects executable and non-image-safe schemes", () => {
  assert.equal(sanitizeURL("javascript:alert(1)"), "");
  assert.equal(sanitizeURL("data:image/svg+xml,<svg onload=alert(1)>"), "");
  assert.equal(sanitizeURL("https://firebasestorage.googleapis.com/file.jpg"), "https://firebasestorage.googleapis.com/file.jpg");
  assert.equal(
    sanitizeURL("http://127.0.0.1:9199/v0/b/test/o/file.jpg"),
    "http://127.0.0.1:9199/v0/b/test/o/file.jpg"
  );
  assert.equal(sanitizeURL("/assets/images/logo-brisa-transparent.png"), "/assets/images/logo-brisa-transparent.png");
});

test("mobile feed renderer avoids dynamic innerHTML for Firestore post data", () => {
  const source = readFileSync("assets/js/pages/app.js", "utf8");
  assert.doesNotMatch(source, /wrapper\.innerHTML\s*=\s*buildFeedPostMarkup/);
  assert.doesNotMatch(source, /const buildFeedPostMarkup\s*=/);
  assert.match(source, /const createFeedPostElement\s*=\s*\(post,\s*idx\)\s*=>/);
  assert.match(source, /sanitizeFeedImageUrl\(post\?\.imageUrl\)/);
  assert.match(source, /desc\.textContent\s*=\s*description/);
  assert.match(source, /metaText\.textContent\s*=\s*formatPostMeta\(post\)/);
  assert.match(source, /img\.dataset\.full\s*=\s*fullUrl/);
});

test("mobile feed subscribes comments on demand instead of per rendered post", () => {
  const source = readFileSync("assets/js/pages/app.js", "utf8");
  const wireStart = source.indexOf("const wireFeedPostElement =");
  const wireEnd = source.indexOf("const renderFeedList =", wireStart);
  const wireSource = source.slice(wireStart, wireEnd);
  assert.doesNotMatch(wireSource, /subscribeCommentsForPost\(postId,\s*listEl,\s*countEl,\s*actionCountEl,\s*postEl\);\s*const formEl/);
  assert.match(wireSource, /subscribeCommentsForPost\(postId,\s*listEl,\s*countEl,\s*actionCountEl,\s*postEl\);/);
  assert.match(wireSource, /unsubscribeFeedCommentsForPost\(postId\)/);
});

test("mobile pwa keeps browser zoom available and avoids heavy ghost clones", () => {
  const html = readFileSync("app/index.html", "utf8");
  const mobileSource = readFileSync("js/app-mobile.js", "utf8");
  const ghostStart = mobileSource.indexOf("function createGhostPreview");
  const ghostEnd = mobileSource.indexOf("function syncAssistantPresentationMode", ghostStart);
  const ghostSource = mobileSource.slice(ghostStart, ghostEnd);

  assert.doesNotMatch(html, /user-scalable\s*=\s*no/);
  assert.doesNotMatch(html, /maximum-scale|minimum-scale/);
  assert.doesNotMatch(mobileSource, /disableZoomGestures|gesturestart|preventPinchMove/);
  assert.doesNotMatch(ghostSource, /cloneNode|new MutationObserver|subtree:\s*true/);
  assert.match(ghostSource, /createGhostPreview\(viewId\)/);
});

test("app service worker precaches mobile shell assets and resolves hash routes inside app", () => {
  const source = readFileSync("app/service-worker.js", "utf8");

  assert.match(source, /const CACHE_VERSION = "v21"/);
  assert.match(source, /"\/css\/app\.css\?v=20260309-foro-spacing-7"/);
  assert.match(source, /"\/css\/variables\.css"/);
  assert.match(source, /"\/css\/structure\.css"/);
  assert.match(source, /"\/js\/chat\.js\?v=20260508-boti-header-2"/);
  assert.match(source, /return new URL\(`\/app\/index\.html\$\{route\}`/);
  assert.match(source, /url\.pathname\.startsWith\("\/css\/"\)/);
  assert.match(source, /url\.pathname\.startsWith\("\/js\/"\)/);
});

test("root mobile muro uses current user avatar without changing desktop title contract", () => {
  const html = readFileSync("index.html", "utf8");
  const css = readFileSync("assets/css/pages/index.css", "utf8");
  const source = readFileSync("js/app.js", "utf8");
  const userMenuSource = readFileSync("assets/js/common/user-menu.js", "utf8");
  const userProfilesSource = readFileSync("assets/js/common/user-profiles.js", "utf8");

  assert.match(html, /<div class="header__title-center">Departamento Médico<\/div>/);
  assert.match(html, /<span class="dm-title-line">Centro de Recursos Visuales en el Ámbito Laboral<\/span>/);
  assert.match(html, /<button[\s\S]*class="dm-muro-avatar"[\s\S]*data-dm-avatar-current[\s\S]*data-dm-muro-user-trigger/);
  assert.match(html, /data-dm-avatar-img[\s\S]*loading="eager"/);
  assert.match(html, /data-dm-avatar-fallback="initials"/);
  assert.match(html, /aria-label="Abrir menú de usuario"/);
  assert.match(html, /aria-controls="user-panel-dropdown"/);

  const mobileRulesStart = css.indexOf("@media (max-width: 768px), (display-mode: standalone)");
  assert.notEqual(mobileRulesStart, -1);
  const mobileRules = css.slice(mobileRulesStart);
  assert.match(mobileRules, /\.header__center\s*\{[\s\S]*display:\s*flex !important/);
  assert.match(mobileRules, /\.header__title-center\s*\{[\s\S]*text-align:\s*center/);
  assert.match(mobileRules, /body\[data-view="carrete"\] #header\.header\.reveal-on-scroll\s*\{[\s\S]*opacity:\s*1 !important[\s\S]*transform:\s*none !important/);
  assert.match(mobileRules, /body\[data-view="carrete"\] #header \.header__container\s*\{[\s\S]*align-items:\s*center !important/);
  assert.match(mobileRules, /body\[data-view="carrete"\] #header \.header__left,[\s\S]*body\[data-view="carrete"\] #header \.nav-notifications,[\s\S]*transform:\s*none !important/);
  assert.match(mobileRules, /body\[data-view="carrete"\] #header \.header__title-center\s*\{[\s\S]*opacity:\s*1 !important[\s\S]*visibility:\s*visible !important[\s\S]*transform:\s*none !important/);
  assert.match(mobileRules, /\.header \[data-dm-user-menu\] \[data-dm-user-trigger\]\.user-panel-trigger\s*\{[\s\S]*opacity:\s*0 !important/);
  assert.match(mobileRules, /\.dm-muro-composer\s*\{[\s\S]*top:\s*var\(--app-header-h,\s*64px\)/);
  assert.match(mobileRules, /body\[data-view="carrete"\]\s*\{[\s\S]*--dm-muro-feed-gap:\s*14px/);
  assert.match(mobileRules, /body\[data-view="carrete"\]\s*\{[\s\S]*--dm-muro-feed-anchor-compensation:\s*10px/);
  assert.match(mobileRules, /body\[data-view="carrete"\] #carrete\.dm-carousel-section\.is-feed-mode\s*\{[\s\S]*padding-top:\s*calc\(var\(--dm-muro-offset,\s*68px\) \+ var\(--dm-muro-feed-gap,\s*14px\) \+ var\(--dm-muro-feed-anchor-compensation,\s*10px\)\)/);
  assert.match(mobileRules, /body\[data-view="carrete"\] #investigacion\.scientific-log-section \+ #carrete\.dm-carousel-section\.is-feed-mode\s*\{[\s\S]*padding-top:\s*calc\(var\(--dm-muro-offset,\s*68px\) \+ var\(--dm-muro-feed-gap,\s*14px\) \+ var\(--dm-muro-feed-anchor-compensation,\s*10px\)\)/);
  assert.match(mobileRules, /body\.dm-muro-hidden\[data-view="carrete"\] #carrete\.dm-carousel-section\.is-feed-mode\s*\{[\s\S]*padding-top:\s*0\.3rem/);
  assert.match(mobileRules, /body\.dm-muro-hidden\[data-view="carrete"\] #investigacion\.scientific-log-section \+ #carrete\.dm-carousel-section\.is-feed-mode\s*\{[\s\S]*padding-top:\s*0\.3rem/);
  assert.match(mobileRules, /body\[data-view="carrete"\] #carrete\.reveal-on-scroll\s*\{[\s\S]*contain:\s*none !important[\s\S]*transform:\s*none !important[\s\S]*will-change:\s*auto !important/);
  assert.match(mobileRules, /body\[data-view="carrete"\] #carrete \.dm-carousel-header\s*\{[\s\S]*display:\s*none/);
  assert.ok(css.indexOf('body[data-view="carrete"] #carrete .dm-carousel-header') > mobileRulesStart);

  assert.match(source, /const syncMobileLayoutVars = \(\) =>/);
  assert.match(source, /rootStyle\.setProperty\('--app-header-h'/);
  assert.match(source, /rootStyle\.setProperty\('--dm-muro-offset'/);
  assert.match(source, /document\.querySelector\('\[data-dm-muro-user-trigger\]'\)/);
  assert.match(source, /userPanelTrigger\.click\(\)/);
  assert.match(userMenuSource, /const updateCurrentAvatarSlots = \(profile,\s*displayName\) =>/);
  assert.match(userMenuSource, /avatarUrl:\s*profile\?\.avatarUrl \|\| ""/);
  assert.match(userMenuSource, /photoURL:\s*docData\?\.photoURL \|\| user\?\.photoURL \|\| ""/);
  assert.match(userProfilesSource, /const isCurrentAvatarSlot =/);
  assert.match(userProfilesSource, /img\.loading = "eager"/);
  assert.match(userProfilesSource, /const probe = new Image\(\)/);
  assert.match(userProfilesSource, /probe\.onload = showLoadedImage/);
  assert.match(userProfilesSource, /probe\.onerror = \(\) => \{/);
  assert.match(userProfilesSource, /showFallback\(\);[\s\S]*const showLoadedImage = \(\) =>/);
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
