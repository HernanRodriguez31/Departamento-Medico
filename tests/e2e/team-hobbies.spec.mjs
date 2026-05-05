import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const QA_EMAIL = process.env.MOBILE_QA_EMAIL || "mobile.qa@departamento-medico.test";
const QA_PASSWORD = process.env.MOBILE_QA_PASSWORD || "MobileQa!12345";
const PAGE_URL = "/intereses-hobbies.html?dmEmulators=1";
const LOGIN_URL = `/login.html?dmEmulators=1&next=${encodeURIComponent(PAGE_URL)}`;

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

test("team hobbies page persists photos with likes comments and separators", async ({ page }, testInfo) => {
  const uploadTitle = `Hobby Playwright ${testInfo.project.name}`;
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(LOGIN_URL);
  await expect(page.locator("#login-form")).toBeVisible();
  await submitLogin(page);
  await page.waitForURL(/\/intereses-hobbies\.html\?dmEmulators=1$/, { timeout: 30_000 });

  await expect(page.locator(".art-gallery-header")).toBeVisible();
  await expect(page.locator(".art-gallery-header__logo img[alt='Brisa Salud y Bienestar']")).toBeVisible();
  await expect(page.locator(".art-gallery-header__brand")).toHaveText("Departamento Médico");
  await expect(page.locator("#team-hobbies-heading")).toHaveText("Intereses y Hobbies del Equipo");
  await expect(page.locator("#team-hobbies-upload")).toBeVisible();
  await expect(page.locator("#scroll-up")).toBeVisible();
  await expect(page.locator("#dmAssistantFab")).toBeVisible();
  await expect(page.locator("footer.footer")).toContainText("Brisa Salud y Bienestar");

  await expect.poll(() => page.locator(".team-hobby-post").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("Caminata de integración QA")).toBeVisible();
  await expect(page.getByText("Hobby Ajeno QA")).toBeVisible();
  await expect(page.locator(".team-hobby-separator")).toHaveCount(
    Math.max(0, (await page.locator(".team-hobby-post").count()) - 1)
  );
  expect(
    await page.locator("#team-hobbies-feed").evaluate((feed) =>
      feed.firstElementChild?.classList.contains("team-hobby-post")
    )
  ).toBe(true);

  const otherPost = page.locator(".team-hobby-post").filter({ hasText: "Hobby Ajeno QA" }).first();
  await expect(otherPost).toBeVisible();
  await expect(otherPost.locator("[data-post-action]")).toHaveCount(0);

  await page.locator("#team-hobbies-upload").click();
  await expect(page.locator("#team-hobbies-modal")).toBeVisible();
  await page.locator("#team-hobbies-title").fill(uploadTitle);
  await page.locator("#team-hobbies-description").fill("Foto compartida desde Playwright para validar intereses del equipo.");
  await page.locator("#team-hobbies-file").setInputFiles(resolve("assets/images/og-dto-medico.jpg"));
  await expect(page.locator("#team-hobbies-preview img")).toBeVisible();
  await page.locator("#team-hobbies-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#team-hobbies-modal")).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(uploadTitle)).toBeVisible({ timeout: 30_000 });
  await expectNoHorizontalOverflow(page);

  const uploadedPost = page.locator(".team-hobby-post").filter({ hasText: uploadTitle }).first();
  await expect(uploadedPost.locator(".team-hobby-post__author")).toContainText("Dra. Mobile QA");
  await expect(uploadedPost.locator(".team-hobby-post__date")).not.toBeEmpty();
  await expect(uploadedPost.locator(".team-hobby-media img")).toBeVisible({ timeout: 30_000 });
  await expect(uploadedPost.locator('[data-post-action="edit"]')).toBeVisible();
  await expect(uploadedPost.locator('[data-post-action="delete"]')).toBeVisible();

  const likeButton = uploadedPost.locator('[data-action="like"]');
  await likeButton.click();
  await expect(uploadedPost.locator("[data-like-count]")).toHaveText("1", { timeout: 30_000 });
  await expect(likeButton.locator(".team-hobby-like-tooltip")).toContainText("Dra. Mobile QA");

  await uploadedPost.locator(".team-hobby-comment-input").fill("Comentario QA sobre hobbies.");
  await uploadedPost.locator("[data-comment-form]").evaluate((form) => form.requestSubmit());
  await expect(uploadedPost.getByText("Comentario QA sobre hobbies.")).toBeVisible({ timeout: 30_000 });
  await expect(uploadedPost.locator("[data-comment-count]").first()).toHaveText("1");
  const ownComment = uploadedPost.locator(".team-hobby-comment").filter({ hasText: "Comentario QA sobre hobbies." }).first();
  await expect(ownComment.locator('[data-comment-action="edit"]')).toBeVisible();
  await expect(ownComment.locator('[data-comment-action="delete"]')).toBeVisible();

  const commentLike = ownComment.locator('[data-comment-action="like"]');
  await commentLike.click();
  await expect(commentLike.locator("[data-comment-like-count]")).toHaveText("1", { timeout: 30_000 });
  await expect(commentLike.locator(".team-hobby-comment-like-tooltip")).toContainText("Dra. Mobile QA");

  await expectNoHorizontalOverflow(page);

  const criticalErrors = consoleErrors.filter(
    (text) =>
      !/favicon|ResizeObserver loop|net::ERR_ABORTED|Could not reach Cloud Firestore backend|Failed to load resource: the server responded with a status of 400 \(Bad Request\)/i.test(
        text
      )
  );
  expect(criticalErrors).toEqual([]);
});
