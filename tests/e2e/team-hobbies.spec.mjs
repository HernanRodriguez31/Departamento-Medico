import { expect, test } from "@playwright/test";
import { getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { resolve } from "node:path";

const QA_EMAIL = process.env.MOBILE_QA_EMAIL || "mobile.qa@departamento-medico.test";
const QA_PASSWORD = process.env.MOBILE_QA_PASSWORD || "MobileQa!12345";
const PAGE_URL = "/intereses-hobbies.html?dmEmulators=1";
const LOGIN_URL = `/login.html?dmEmulators=1&next=${encodeURIComponent(PAGE_URL)}`;
const PROJECT_ID = "departamento-medico-brisa";

const getAdminDb = () => {
  const existing = getApps().find((app) => app.name === "team-hobbies-e2e");
  const app = existing || initializeAdminApp({ projectId: PROJECT_ID }, "team-hobbies-e2e");
  return getAdminFirestore(app);
};

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

const setCropZoom = async (page, value) => {
  await page.locator("#team-hobbies-crop-zoom").evaluate((input, zoomValue) => {
    input.value = String(zoomValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
};

const expectClearRenderedImage = async (media) => {
  await expect(media).toHaveClass(/is-loaded/);
  await expect
    .poll(async () =>
      media.evaluate((node) => {
        const img = node.querySelector("img");
        const imgStyle = getComputedStyle(img);
        const mediaAfter = getComputedStyle(node, "::after");
        return {
          mediaLoading: node.classList.contains("is-loading"),
          imgOpacity: imgStyle.opacity,
          imgFilter: imgStyle.filter,
          imgBlend: imgStyle.mixBlendMode,
          objectFit: imgStyle.objectFit,
          afterContent: mediaAfter.content,
        };
      })
    )
    .toEqual({
      mediaLoading: false,
      imgOpacity: "1",
      imgFilter: "none",
      imgBlend: "normal",
      objectFit: "contain",
      afterContent: "none",
    });
};

const seedBulkComments = async (page, { postId, count, prefix }) => {
  await page.evaluate(
    async ({ targetPostId, total, textPrefix }) => {
      const { doc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const db = window.__FIREBASE_DB__;
      const user = window.__FIREBASE_AUTH__?.currentUser;
      if (!db || !user) throw new Error("Firebase no disponible para seed E2E.");
      await Promise.all(
        Array.from({ length: total }, (_, index) => {
          const commentId = `${textPrefix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`;
          return setDoc(doc(db, "dm_carousel", targetPostId, "comments", commentId), {
            text: `${textPrefix} ${index + 1}`,
            authorUid: user.uid,
            authorName: user.displayName || "Dra. Mobile QA",
            createdAt: serverTimestamp(),
            likedBy: {},
            parentCommentId: null,
            rootCommentId: commentId,
            replyDepth: 0,
            replyToCommentId: null,
            replyToAuthorName: "",
            deleted: false,
            deletedAt: null,
            deletedBy: "",
          });
        })
      );
    },
    { targetPostId: postId, total: count, textPrefix: prefix }
  );
};

const seedLegacyCommentWithoutCreatedAt = async ({ postId, text }) => {
  const commentId = `legacy-${postId}`.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 120);
  await getAdminDb().doc(`dm_carousel/${postId}/comments/${commentId}`).set({
    text,
    authorUid: "legacy-user",
    authorName: "Legado QA",
    likedBy: {},
    parentCommentId: null,
    rootCommentId: commentId,
    replyDepth: 0,
    replyToCommentId: null,
    replyToAuthorName: "",
    deleted: false,
    deletedAt: null,
    deletedBy: "",
  });
  return commentId;
};

test("team hobbies page persists photos with likes comments and separators", async ({ page }, testInfo) => {
  const uploadTitle = `Hobby Playwright ${testInfo.project.name}`;
  const portraitTitle = `Hobby Portrait ${testInfo.project.name}`;
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
  await expect(page.locator("#team-hobbies-upload")).toContainText("Compartir");
  await expect(page.locator("#scroll-up")).toBeVisible();
  await expect(page.locator("#dmAssistantFab")).toHaveCount(0);
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
  await expect(page.locator(".team-hobbies-cropper")).toBeVisible();
  await expect(page.locator(".team-hobbies-cropper[data-orientation='landscape']")).toBeVisible();
  await setCropZoom(page, 1.18);
  await page.locator("#team-hobbies-crop-reset").click();
  await page.locator("#team-hobbies-crop-apply").click();
  await expect(page.locator("[data-crop-status]")).toContainText("Recorte confirmado");
  await page.locator("#team-hobbies-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#team-hobbies-modal")).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(uploadTitle)).toBeVisible({ timeout: 30_000 });
  await expectNoHorizontalOverflow(page);

  const uploadedPost = page.locator(".team-hobby-post").filter({ hasText: uploadTitle }).first();
  await expect(uploadedPost.locator(".team-hobby-post__author")).toContainText("Dra. Mobile QA");
  await expect(uploadedPost.locator(".team-hobby-post__date")).not.toBeEmpty();
  await expect(uploadedPost.locator(".team-hobby-media img")).toBeVisible({ timeout: 30_000 });
  await expectClearRenderedImage(uploadedPost.locator(".team-hobby-media"));
  await expect(uploadedPost.locator(".team-hobby-media-card .team-hobby-post__content")).toHaveCount(0);
  await expect(uploadedPost.locator(".team-hobby-comments .team-hobby-post__title")).toHaveText(uploadTitle);
  await expect(uploadedPost.locator(".team-hobby-comments .team-hobby-post__description")).toContainText(
    "Foto compartida desde Playwright"
  );
  await expect(uploadedPost.locator('[data-post-action="edit"]')).toBeVisible();
  await expect(uploadedPost.locator('[data-post-action="delete"]')).toBeVisible();

  const likeButton = uploadedPost.locator('[data-action="like"]');
  await likeButton.click();
  await expect(uploadedPost.locator("[data-like-count]")).toHaveText("1", { timeout: 30_000 });
  await expect(likeButton.locator(".team-hobby-like-tooltip")).toContainText("Dra. Mobile QA");
  await likeButton.hover();
  await expect(page.locator(".team-hobbies-floating-like-tooltip")).toContainText("Dra. Mobile QA");
  await expect
    .poll(async () =>
      page.locator(".team-hobbies-floating-like-tooltip").evaluate((tooltip) => {
        const rect = tooltip.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight;
      })
    )
    .toBe(true);

  const actionMetrics = await uploadedPost.locator(".team-hobby-actions .team-hobby-action").evaluateAll((actions) =>
    actions.map((action) => {
      const rect = action.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    })
  );
  expect(actionMetrics).toHaveLength(2);
  expect(Math.abs(actionMetrics[0].height - actionMetrics[1].height)).toBeLessThanOrEqual(1);
  expect(Math.abs(actionMetrics[0].width - actionMetrics[1].width)).toBeLessThanOrEqual(6);

  await uploadedPost.locator(".team-hobby-media").click();
  await expect(page.locator("#team-hobbies-lightbox")).toBeVisible();
  await expect(page.locator("#team-hobbies-lightbox-title")).toHaveText(uploadTitle);
  await expect(page.locator(".team-hobbies-lightbox__brand")).toBeVisible();
  await expect(page.locator("#team-hobbies-lightbox-likes")).toHaveText("1");
  await expect(page.locator("#team-hobbies-lightbox-comments")).toHaveText("0");
  await expect
    .poll(() =>
      page.locator("#team-hobbies-lightbox-img").evaluate((img) => {
        const style = getComputedStyle(img);
        return {
          opacity: style.opacity,
          filter: style.filter,
          objectFit: style.objectFit,
        };
      })
    )
    .toEqual({ opacity: "1", filter: "none", objectFit: "contain" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#team-hobbies-lightbox")).toBeHidden();

  await page.locator("#team-hobbies-upload").click();
  await page.locator("#team-hobbies-title").fill(portraitTitle);
  await page.locator("#team-hobbies-description").fill("Foto vertical procesada con el cropper.");
  await page.locator("#team-hobbies-file").setInputFiles(resolve("assets/images/logo-brisa-heart.png"));
  await expect(page.locator(".team-hobbies-cropper[data-orientation='portrait']")).toBeVisible();
  await page.locator("#team-hobbies-crop-apply").click();
  await page.locator("#team-hobbies-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#team-hobbies-modal")).toBeHidden({ timeout: 30_000 });
  const portraitPost = page.locator(".team-hobby-post").filter({ hasText: portraitTitle }).first();
  await expect(portraitPost).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => portraitPost.locator(".team-hobby-media img").getAttribute("src"))
    .toContain(".png");
  await expectClearRenderedImage(portraitPost.locator(".team-hobby-media"));
  await expect(portraitPost.locator(".team-hobby-media")).toHaveClass(/is-portrait/);
  await expect
    .poll(() =>
      portraitPost.locator(".team-hobby-media").evaluate((media) => {
        const img = media.querySelector("img");
        const mediaRect = media.getBoundingClientRect();
        const imgRect = img.getBoundingClientRect();
        const mediaCenter = mediaRect.left + mediaRect.width / 2;
        const imgCenter = imgRect.left + imgRect.width / 2;
        return (
          imgRect.height <= mediaRect.height + 1 &&
          imgRect.width <= mediaRect.width + 1 &&
          Math.abs(mediaCenter - imgCenter) <= 1
        );
      })
    )
    .toBe(true);

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
  await commentLike.hover();
  await expect(page.locator(".team-hobbies-floating-like-tooltip")).toContainText("Dra. Mobile QA");

  await ownComment.locator('[data-comment-action="reply"]').click();
  await ownComment.locator("[data-reply-form] textarea").fill("Respuesta QA en cascada.");
  await ownComment.locator("[data-reply-form]").evaluate((form) => form.requestSubmit());
  await expect(ownComment.locator(".team-hobby-comment__replies").getByText("Respuesta QA en cascada.")).toBeVisible({
    timeout: 30_000
  });
  await expect(uploadedPost.locator("[data-comment-count]").first()).toHaveText("2");

  const firstReply = ownComment.locator(".team-hobby-comment").filter({ hasText: "Respuesta QA en cascada." }).first();
  await expect(firstReply).toHaveAttribute("data-reply-depth", "1");
  await firstReply.locator('[data-comment-action="reply"]').click();
  await firstReply.locator("[data-reply-form] textarea").fill("Respuesta QA nivel dos.");
  await firstReply.locator("[data-reply-form]").evaluate((form) => form.requestSubmit());
  const secondReply = firstReply.locator(".team-hobby-comment").filter({ hasText: "Respuesta QA nivel dos." }).first();
  await expect(secondReply).toBeVisible({ timeout: 30_000 });
  await expect(secondReply).toHaveAttribute("data-reply-depth", "2");
  await expect(secondReply.locator('[data-comment-action="reply"]')).toHaveCount(0);
  await expect(uploadedPost.locator("[data-comment-count]").first()).toHaveText("3");

  const uploadedPostId = await uploadedPost.getAttribute("data-post-id");
  expect(uploadedPostId).toBeTruthy();
  const legacyCommentText = `Comentario legacy sin fecha ${testInfo.project.name}`;
  await seedLegacyCommentWithoutCreatedAt({
    postId: uploadedPostId,
    text: legacyCommentText,
  });
  await expect(uploadedPost.getByText(legacyCommentText)).toBeVisible({ timeout: 30_000 });
  await expect(uploadedPost.locator("[data-comment-count]").first()).toHaveText("4");

  await seedBulkComments(page, {
    postId: uploadedPostId,
    count: 82,
    prefix: `Comentario bulk ${testInfo.project.name}`,
  });
  await expect(uploadedPost.locator("[data-comment-count]").first()).toHaveText("86", { timeout: 30_000 });

  const lastBulkComment = uploadedPost
    .locator(".team-hobby-comment")
    .filter({ hasText: `Comentario bulk ${testInfo.project.name} 82` })
    .first();
  await expect(lastBulkComment).toBeVisible({ timeout: 30_000 });
  await lastBulkComment.locator('[data-comment-action="reply"]').click();
  await lastBulkComment.locator("[data-reply-form] textarea").fill("Respuesta QA posterior al comentario 85.");
  await lastBulkComment.locator("[data-reply-form]").evaluate((form) => form.requestSubmit());
  await expect(lastBulkComment.getByText("Respuesta QA posterior al comentario 85.")).toBeVisible({ timeout: 30_000 });
  await expect(uploadedPost.locator("[data-comment-count]").first()).toHaveText("87");

  const lateReply = lastBulkComment.locator(".team-hobby-comment").filter({ hasText: "Respuesta QA posterior al comentario 85." }).first();
  await lateReply.locator('[data-comment-action="reply"]').click();
  await lateReply.locator("[data-reply-form] textarea").fill("Respuesta QA nivel dos posterior al limite.");
  await lateReply.locator("[data-reply-form]").evaluate((form) => form.requestSubmit());
  await expect(lateReply.getByText("Respuesta QA nivel dos posterior al limite.")).toBeVisible({ timeout: 30_000 });
  await expect(uploadedPost.locator("[data-comment-count]").first()).toHaveText("88");
  await expect
    .poll(() =>
      uploadedPost.locator(".team-hobby-comments__list").evaluate((list) => list.scrollHeight > list.clientHeight)
    )
    .toBe(true);

  await page.reload();
  await expect(page.locator(".art-gallery-header")).toBeVisible();
  const reloadedPost = page.locator(".team-hobby-post").filter({ hasText: uploadTitle }).first();
  await expect(reloadedPost).toBeVisible({ timeout: 30_000 });
  await expect(reloadedPost.locator("[data-comment-count]").first()).toHaveText("88");
  await expect(reloadedPost.locator(".team-hobby-comment__text").filter({ hasText: "Comentario QA sobre hobbies." })).toHaveCount(1);
  await expect(reloadedPost.locator(".team-hobby-comment__text").filter({ hasText: legacyCommentText })).toHaveCount(1);
  await expect(reloadedPost.locator(".team-hobby-comment__text").filter({ hasText: "Respuesta QA en cascada." })).toHaveCount(1);
  await expect(reloadedPost.locator(".team-hobby-comment__text").filter({ hasText: "Respuesta QA posterior al comentario 85." })).toHaveCount(1);
  await expect(reloadedPost.locator(".team-hobby-comment__text").filter({ hasText: "Respuesta QA nivel dos posterior al limite." })).toHaveCount(1);
  const reloadedSecondText = reloadedPost.locator(".team-hobby-comment__text").filter({ hasText: "Respuesta QA nivel dos." });
  await expect(reloadedSecondText).toHaveCount(1);
  const reloadedSecondReply = reloadedSecondText.locator("xpath=ancestor::article[contains(@class, 'team-hobby-comment')][1]");
  await expect(reloadedSecondReply).toHaveAttribute("data-reply-depth", "2");
  await expect(reloadedSecondReply.locator('[data-comment-action="reply"]')).toHaveCount(0);

  await reloadedPost.locator('[data-post-action="edit"]').click();
  await expect(page.locator("#team-hobbies-auth-modal")).toBeVisible();
  await page.locator("#team-hobbies-auth-password").fill(QA_PASSWORD);
  await page.locator("#team-hobbies-auth-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#team-hobbies-edit-modal")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#team-hobbies-edit-preview .team-hobbies-cropper")).toBeVisible({ timeout: 30_000 });
  await setCropZoom(page, 1.32);
  await page.locator("#team-hobbies-crop-apply").click();
  await page.locator("#team-hobbies-edit-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#team-hobbies-edit-modal")).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator(".team-hobby-post")
        .filter({ hasText: uploadTitle })
        .first()
        .locator(".team-hobby-media img")
        .evaluate((img) => getComputedStyle(img).transform)
    )
    .not.toBe("none");

  await page.goto("/index.html?dmEmulators=1");
  await expect(page.getByText(uploadTitle)).toHaveCount(0);
  await expect(page.getByText(portraitTitle)).toHaveCount(0);

  await expectNoHorizontalOverflow(page);

  const criticalErrors = consoleErrors.filter(
    (text) =>
      !/favicon|ResizeObserver loop|net::ERR_ABORTED|Could not reach Cloud Firestore backend|Failed to load resource: the server responded with a status of 400 \(Bad Request\)/i.test(
        text
      ) &&
      !/Failed to load resource: the server responded with a status of 400 \(\)/i.test(text)
  );
  expect(criticalErrors).toEqual([]);
});
