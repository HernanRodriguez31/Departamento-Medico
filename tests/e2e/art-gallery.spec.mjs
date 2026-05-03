import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const QA_EMAIL = process.env.MOBILE_QA_EMAIL || "mobile.qa@departamento-medico.test";
const QA_PASSWORD = process.env.MOBILE_QA_PASSWORD || "MobileQa!12345";
const LOGIN_URL = `/login.html?dmEmulators=1&next=${encodeURIComponent("/galeriadearte")}`;

const submitLogin = async (page) => {
  await page.locator("#email").fill(QA_EMAIL);
  await page.locator("#password").fill(QA_PASSWORD);
  await page.locator("#login-form").evaluate((form) => form.requestSubmit());
};

const expectNoHorizontalOverflow = async (page) => {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
  expect(overflow).toBeLessThanOrEqual(2);
};

const expectIconOnlyAction = async (locator, iconClass) => {
  await expect(locator.locator(`svg.${iconClass}`)).toHaveCount(1);
  const visibleText = await locator.evaluate((button) => button.textContent.trim());
  expect(visibleText).toBe("");
};

test("art gallery page lists, uploads, likes and comments on art posts", async ({ page }, testInfo) => {
  const uploadTitle = `Obra Playwright ${testInfo.project.name}`;
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(LOGIN_URL);
  await expect(page.locator("#login-form")).toBeVisible();
  await submitLogin(page);
  await page.waitForURL(/\/galeriadearte\?dmEmulators=1$/, { timeout: 30_000 });

  await expect(page.locator("#dmDesktopSidebar")).toHaveCount(0);
  await expect(page.locator(".art-gallery-header")).toBeVisible();
  await expect(page.locator(".art-gallery-header__logo img[alt='Brisa Salud y Bienestar']")).toBeVisible();
  await expect(page.locator(".art-gallery-header__brand")).toHaveText("Departamento Médico");
  await expect(page.locator(".art-gallery-header__brand")).toHaveCSS("color", "rgb(121, 184, 74)");
  await expect(page.locator(".art-gallery-header [data-dm-user-menu]")).toBeVisible();
  await expect(page.locator("#user-panel-dropdown")).toBeHidden();
  await expect(page.locator(".dm-avatar-modal")).toHaveCount(0);
  const headerGap = await page.evaluate(() => {
    const header = document.querySelector(".art-gallery-header")?.getBoundingClientRect();
    const hero = document.querySelector(".art-gallery-hero")?.getBoundingClientRect();
    if (!header || !hero) return 999;
    return Math.round(hero.top - header.bottom);
  });
  expect(headerGap).toBeGreaterThanOrEqual(20);
  await expect(page.locator("#art-gallery-return-home")).toHaveText("Regresar a Página de Inicio");
  await expect
    .poll(() =>
      page.locator("#art-gallery-return-home").evaluate((link) => {
        const url = new URL(link.href);
        return `${url.pathname}${url.search}`;
      }),
    )
    .toBe("/index.html?dmEmulators=1");

  await expect(page.locator("#art-gallery-heading")).toHaveText("Galería de Arte");
  const titleFont = await page.locator("#art-gallery-heading").evaluate((node) => {
    return window.getComputedStyle(node).fontFamily;
  });
  expect(titleFont).toMatch(/Cinzel Decorative|Cormorant Garamond|Georgia|serif/i);
  await expect(page.locator(".art-gallery-subtitle")).toHaveText(
    "Un muro colaborativo para compartir obras, registrar su contexto y conversar sobre la mirada artística de cada publicación."
  );
  if ((page.viewportSize()?.width || 0) >= 1000) {
    const subtitleLines = await page.locator(".art-gallery-subtitle").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const styles = window.getComputedStyle(node);
      return Math.round(rect.height / parseFloat(styles.lineHeight));
    });
    expect(subtitleLines).toBeLessThanOrEqual(1);
  }
  await expect(page.locator("#art-gallery-upload")).toBeVisible();
  await expect.poll(() => page.locator(".art-post").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("Horizonte Verde")).toBeVisible();
  await expect(page.getByText("Retrato de Guardia")).toBeVisible();
  const ownedSeedPost = page.locator(".art-post").filter({ hasText: "Horizonte Verde" }).first();
  const ownedSeedAvatar = ownedSeedPost.locator(".art-avatar").first();
  await expect(ownedSeedAvatar.locator(".art-avatar__img")).toBeVisible({ timeout: 30_000 });
  await expect(ownedSeedAvatar.locator(".art-avatar__img")).toHaveAttribute("src", /avatar-leila\.png/);
  await expect(ownedSeedAvatar.locator("[data-avatar-fallback='initials']")).toBeHidden();
  const otherPost = page.locator(".art-post").filter({ hasText: "Obra Ajena QA" }).first();
  await expect(otherPost).toBeVisible();
  await expect(otherPost.locator("[data-post-action]")).toHaveCount(0);
  await expect(page.getByText("Publicacion QA 1")).toHaveCount(0);
  await expect.poll(() => page.locator(".art-frame--landscape").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => page.locator(".art-frame--portrait").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect(page.locator(".art-frame__image").first()).toHaveAttribute("loading", "eager");
  await expect(page.locator(".art-frame__image").first()).toHaveAttribute("fetchpriority", "high");
  await expect(ownedSeedPost.locator(".art-frame__media").first()).toHaveClass(/is-loaded/, { timeout: 30_000 });
  const seededImageChrome = await ownedSeedPost.locator(".art-frame__image").first().evaluate((img) => {
    const styles = window.getComputedStyle(img);
    const imgBox = img.getBoundingClientRect();
    const mediaBox = img.closest(".art-frame__media")?.getBoundingClientRect();
    return {
      borderTopWidth: styles.borderTopWidth,
      widthDiff: mediaBox ? Math.abs(mediaBox.width - imgBox.width) : 999,
      heightDiff: mediaBox ? Math.abs(mediaBox.height - imgBox.height) : 999,
    };
  });
  expect(seededImageChrome.borderTopWidth).toBe("0px");
  expect(seededImageChrome.widthDiff).toBeLessThanOrEqual(1);
  expect(seededImageChrome.heightDiff).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page);

  await page.locator("#art-gallery-upload").click();
  await expect(page.locator("#art-gallery-modal")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.locator("#art-gallery-title").fill(uploadTitle);
  await page.locator("#art-gallery-brief").fill("Descripción breve desde auditoría.");
  await page.locator("#art-gallery-author").fill("QA Visual");
  await page.locator("#art-gallery-year").fill("2026");
  await page.locator("#art-gallery-type").fill("Fotografía");
  await page.locator("#art-gallery-location").fill("Cerro Dragón");
  await page.locator("#art-gallery-long").fill("Descripción ampliada para validar persistencia y renderizado del muro.");
  await page.locator("#art-gallery-file").setInputFiles(resolve("assets/images/og-dto-medico.jpg"));
  await expect(page.locator("#art-gallery-preview img")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.locator("#art-gallery-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#art-gallery-modal")).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(uploadTitle)).toBeVisible({ timeout: 30_000 });
  await expectNoHorizontalOverflow(page);

  const firstPost = page.locator(".art-post").filter({ hasText: uploadTitle }).first();
  await expect(firstPost.locator('[data-post-action="edit"]')).toBeVisible();
  await expect(firstPost.locator('[data-post-action="delete"]')).toBeVisible();
  await expect(firstPost.locator('[data-post-action="edit-brief"]')).toBeVisible();
  await expectIconOnlyAction(firstPost.locator('[data-post-action="edit"]'), "lucide-pencil");
  await expectIconOnlyAction(firstPost.locator('[data-post-action="delete"]'), "lucide-trash-2");
  await expectIconOnlyAction(firstPost.locator('[data-post-action="edit-brief"]'), "lucide-pencil");
  await expect(firstPost.locator(".art-avatar__img")).toBeVisible({ timeout: 30_000 });
  await expect(firstPost.locator(".art-avatar__img")).toHaveAttribute("src", /avatar-leila\.png/);
  await expect(firstPost.locator(".art-frame__media")).toHaveClass(/is-loaded/, { timeout: 30_000 });
  await expect(firstPost.locator(".art-frame__image")).toHaveCSS("border-top-width", "0px");

  await firstPost.locator('[data-post-action="edit-brief"]').click();
  await expect(page.locator("#art-edit-modal")).toBeVisible();
  await expect(page.locator("#art-edit-brief")).toBeFocused();
  await page.locator("#art-edit-close").click();
  await expect(page.locator("#art-edit-modal")).toBeHidden();

  const editedTitle = `${uploadTitle} editada`;
  await firstPost.locator('[data-post-action="edit"]').click();
  await expect(page.locator("#art-edit-modal")).toBeVisible();
  await page.locator("#art-edit-title").fill(editedTitle);
  await page.locator("#art-edit-brief").fill("Descripción breve editada desde auditoría.");
  await page.locator("#art-edit-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#art-auth-modal")).toBeVisible();
  await page.locator("#art-auth-password").fill("password-incorrecta");
  await page.locator("#art-auth-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#art-auth-error")).toContainText("contraseña", { timeout: 30_000 });
  await expect(page.locator("#art-edit-modal")).toBeVisible();
  await page.locator("#art-auth-password").fill(QA_PASSWORD);
  await page.locator("#art-auth-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#art-auth-modal")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#art-edit-modal")).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(editedTitle)).toBeVisible({ timeout: 30_000 });
  const editedPost = page.locator(".art-post").filter({ hasText: editedTitle }).first();

  const likeButton = editedPost.locator('[data-action="like"]');
  await likeButton.click();
  await expect(editedPost.locator("[data-like-count]")).toHaveText("1", { timeout: 30_000 });
  await expect(likeButton.locator(".art-like-tooltip")).toContainText("Dra. Mobile QA", { timeout: 30_000 });
  await expect(likeButton).toHaveAttribute("title", /Dra\. Mobile QA/);
  await likeButton.hover();
  await expect(likeButton.locator(".art-like-tooltip")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await editedPost.locator('[data-action="comments"]').click();
  await expect(editedPost.locator("[data-comments]")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await editedPost.locator(".art-comment-input").fill("Comentario QA sobre la obra.");
  await editedPost.locator("[data-comment-form]").evaluate((form) => form.requestSubmit());
  await expect(editedPost.getByText("Comentario QA sobre la obra.")).toBeVisible({ timeout: 30_000 });
  await expect(editedPost.locator("[data-comment-count]").first()).toHaveText("1");
  const ownComment = editedPost.locator(".art-comment").filter({ hasText: "Comentario QA sobre la obra." }).first();
  await expect(ownComment.locator('[data-comment-action="edit"]')).toBeVisible();
  await expect(ownComment.locator('[data-comment-action="delete"]')).toBeVisible();
  await expectIconOnlyAction(ownComment.locator('[data-comment-action="edit"]'), "lucide-pencil");
  await expectIconOnlyAction(ownComment.locator('[data-comment-action="delete"]'), "lucide-trash-2");

  await ownComment.locator('[data-comment-action="edit"]').click();
  await expect(page.locator("#art-comment-edit-modal")).toBeVisible();
  await page.locator("#art-comment-edit-text").fill("Comentario QA editado.");
  await page.locator("#art-comment-edit-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#art-auth-modal")).toBeVisible();
  await page.locator("#art-auth-password").fill(QA_PASSWORD);
  await page.locator("#art-auth-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#art-comment-edit-modal")).toBeHidden({ timeout: 30_000 });
  await expect(editedPost.getByText("Comentario QA editado.")).toBeVisible({ timeout: 30_000 });
  await expect(editedPost.locator(".art-comment__edited")).toHaveText("Editado");

  const editedComment = editedPost.locator(".art-comment").filter({ hasText: "Comentario QA editado." }).first();
  await editedComment.locator('[data-comment-action="delete"]').click();
  await expect(page.locator("#art-auth-modal")).toBeVisible();
  await page.locator("#art-auth-password").fill(QA_PASSWORD);
  await page.locator("#art-auth-form").evaluate((form) => form.requestSubmit());
  await expect(editedPost.getByText("Comentario QA editado.")).toHaveCount(0, { timeout: 30_000 });
  await expect(editedPost.locator("[data-comment-count]").first()).toHaveText("0");
  await editedPost.locator('[data-post-action="delete"]').click();
  await expect(page.locator("#art-auth-modal")).toBeVisible();
  await page.locator("#art-auth-password").fill(QA_PASSWORD);
  await page.locator("#art-auth-form").evaluate((form) => form.requestSubmit());
  await expect(page.getByText(editedTitle)).toHaveCount(0, { timeout: 30_000 });
  await expectNoHorizontalOverflow(page);

  const criticalErrors = consoleErrors.filter(
    (text) =>
      !/favicon|ResizeObserver loop|net::ERR_ABORTED|Could not reach Cloud Firestore backend|Failed to load resource: the server responded with a status of 400 \(Bad Request\)/i.test(
        text
      )
  );
  expect(criticalErrors).toEqual([]);

  await page.locator("#art-gallery-return-home").scrollIntoViewIfNeeded();
  await page.locator("#art-gallery-return-home").click();
  await page.waitForURL(/\/index\.html\?dmEmulators=1$/, { timeout: 30_000 });
});
