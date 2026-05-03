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
  await expect(page.locator("#art-gallery-upload")).toBeVisible();
  await expect.poll(() => page.locator(".art-post").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("Horizonte Verde")).toBeVisible();
  await expect(page.getByText("Retrato de Guardia")).toBeVisible();
  const otherPost = page.locator(".art-post").filter({ hasText: "Obra Ajena QA" }).first();
  await expect(otherPost).toBeVisible();
  await expect(otherPost.locator("[data-post-action]")).toHaveCount(0);
  await expect(page.getByText("Publicacion QA 1")).toHaveCount(0);
  await expect.poll(() => page.locator(".art-frame--landscape").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => page.locator(".art-frame--portrait").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
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

  await editedPost.locator('[data-action="like"]').click();
  await expect(editedPost.locator("[data-like-count]")).toHaveText("1", { timeout: 30_000 });
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
