import { expect, test } from "@playwright/test";

const QA_EMAIL = process.env.MOBILE_QA_EMAIL || "mobile.qa@departamento-medico.test";
const QA_PASSWORD = process.env.MOBILE_QA_PASSWORD || "MobileQa!12345";
const EXPECTED_NAMES = [
  "Juliana Mociulsky",
  "Florencia Rolandi",
  "Lorena Provenzano",
  "Alberto Lambierto",
  "Alberto Marty",
  "Alejandro García",
  "Luis Caro"
];
const EXPECTED_INITIALS = ["JM", "FR", "LP", "AL", "AM", "AG", "LC"];

const maxMetricSpread = (items, key) => {
  const values = items.map((item) => item[key]).filter(Number.isFinite);
  return Math.max(...values) - Math.min(...values);
};

const maxAbsMetric = (items, key) =>
  Math.max(...items.map((item) => Math.abs(item[key])).filter(Number.isFinite));

const login = async (page, next) => {
  await page.goto(`/login.html?dmEmulators=1&next=${encodeURIComponent(next)}`);
  await expect(page.locator("#login-form")).toBeVisible();
  await page.locator("#email").fill(QA_EMAIL);
  await page.locator("#password").fill(QA_PASSWORD);
  await page.locator("#login-form").evaluate((form) => form.requestSubmit());
};

const ensureStructureOpen = async (page) => {
  await page.locator("#estructura-funcional").scrollIntoViewIfNeeded();
  const toggle = page.locator("#structure-main-toggle");
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(page.locator("#structure-groups-container .group-card")).toHaveCount(4);
};

const openSpecialistsGroup = async (page) => {
  const group = page.locator('[data-group-id="specialists"]');
  await expect(group).toBeVisible();
  const header = group.locator(".group-header-btn");
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
  }
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(group.locator(".direct-staff-grid")).toBeVisible();
  return { group, header };
};

const collectSpecialistsPayload = async (page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const groups = [...document.querySelectorAll("#structure-groups-container .group-card")];
    const group = document.querySelector('[data-group-id="specialists"]');
    const panel = group?.querySelector(".direct-staff-panel");
    const panelRect = panel?.getBoundingClientRect();
    const header = panel?.querySelector(".direct-staff-panel__header");
    const eyebrow = panel?.querySelector(".direct-staff-panel__eyebrow");
    const eyebrowRect = eyebrow?.getBoundingClientRect();
    const grid = group?.querySelector(".direct-staff-grid");
    const gridStyle = grid ? getComputedStyle(grid) : null;
    const columns = (gridStyle?.gridTemplateColumns || "").split(" ").filter(Boolean).length;
    const avatars = [...(grid?.querySelectorAll(".structure-avatar") || [])];
    const lastBadge = grid?.querySelector(".staff-badge:last-child");
    const gridRect = grid?.getBoundingClientRect();
    const lastRect = lastBadge?.getBoundingClientRect();
    const badgeMetrics = [...(grid?.querySelectorAll(".staff-badge") || [])].map((badge) => {
      const badgeRect = badge.getBoundingClientRect();
      const avatarRect = badge.querySelector(".structure-avatar")?.getBoundingClientRect();
      const infoRect = badge.querySelector(".staff-info")?.getBoundingClientRect();
      const name = badge.querySelector(".staff-name");
      const nameRect = name?.getBoundingClientRect();
      const groupLeft = Math.min(avatarRect?.left ?? badgeRect.left, infoRect?.left ?? badgeRect.left);
      const groupRight = Math.max(avatarRect?.right ?? badgeRect.right, infoRect?.right ?? badgeRect.right);

      return {
        avatarLeftOffset: avatarRect ? avatarRect.left - badgeRect.left : Infinity,
        nameLeftOffset: nameRect ? nameRect.left - badgeRect.left : Infinity,
        visualCenterDelta:
          Number.isFinite(groupLeft) && Number.isFinite(groupRight)
            ? (groupLeft + groupRight) / 2 - (badgeRect.left + badgeRect.right) / 2
            : Infinity,
        contentInsideBadge: groupLeft >= badgeRect.left - 1 && groupRight <= badgeRect.right + 1,
        noBadgeOverflow: badge.scrollWidth <= badge.clientWidth + 1,
        noNameOverflow: !name || name.scrollWidth <= name.clientWidth + 1
      };
    });
    const lastBadgeCenterDelta =
      gridRect && lastRect
        ? Math.abs((lastRect.left + lastRect.right) / 2 - (gridRect.left + gridRect.right) / 2)
        : Infinity;

    return {
      groupCount: groups.length,
      activeGroupCount: groups.filter((item) => item.classList.contains("active-group")).length,
      title: group?.querySelector(".group-title-text h2")?.textContent?.trim().replace(/\s+/g, " "),
      directStaffHeaderText: header?.textContent?.trim().replace(/\s+/g, " "),
      hasDirectStaffCount: Boolean(panel?.querySelector(".direct-staff-panel__count")),
      directStaffHeaderCenterDelta:
        panelRect && eyebrowRect
          ? Math.abs((eyebrowRect.left + eyebrowRect.right) / 2 - (panelRect.left + panelRect.right) / 2)
          : Infinity,
      hasLeaderBadge: Boolean(group?.querySelector(".group-leader-badge")),
      hasStethoscopeSvg: Boolean(group?.querySelector(".group-icon-circle svg circle")),
      ariaExpanded: group?.getAttribute("aria-expanded"),
      headerExpanded: group?.querySelector(".group-header-btn")?.getAttribute("aria-expanded"),
      staffCount: Number(grid?.dataset.staffCount || 0),
      columnCount: columns,
      names: [...(grid?.querySelectorAll(".staff-name") || [])].map((el) => el.textContent.trim()),
      initials: avatars.map((el) => el.querySelector(".structure-avatar__initials")?.textContent?.trim() || ""),
      avatars: avatars.map((el) => ({
        uid: el.getAttribute("data-dm-avatar-uid"),
        author: el.getAttribute("data-dm-author"),
        hideManagement: el.getAttribute("data-dm-avatar-hide-management"),
        hasAvatar: el.dataset.hasAvatar || ""
      })),
      badgeMetrics,
      lastBadgeCentered: lastBadgeCenterDelta <= 2,
      noHorizontalOverflow: root.scrollWidth <= root.clientWidth + 1
    };
  });

test.describe.configure({ mode: "serial" });

test("desktop structure renders direct specialists group", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "Desktop audit only.");

  await login(page, "/index.html?desktop=1&dmEmulators=1#estructura");
  await page.waitForURL(/\/index\.html\?desktop=1&dmEmulators=1#estructura$/, { timeout: 30_000 });
  await ensureStructureOpen(page);
  const { group, header } = await openSpecialistsGroup(page);

  const payload = await collectSpecialistsPayload(page);
  expect(payload.groupCount).toBe(4);
  expect(payload.title).toBe("Staff Médicos Especialistas Asociados");
  expect(payload.directStaffHeaderText).toBe("Staff médico");
  expect(payload.hasDirectStaffCount).toBe(false);
  expect(payload.directStaffHeaderCenterDelta).toBeLessThanOrEqual(4);
  expect(payload.hasLeaderBadge).toBe(false);
  expect(payload.hasStethoscopeSvg).toBe(true);
  expect(payload.ariaExpanded).toBe("true");
  expect(payload.headerExpanded).toBe("true");
  expect(payload.activeGroupCount).toBe(1);
  expect(payload.staffCount).toBe(7);
  expect(payload.columnCount).toBe(2);
  expect(payload.names).toEqual(EXPECTED_NAMES);
  expect(payload.initials).toEqual(EXPECTED_INITIALS);
  expect(payload.avatars.every((avatar) => !avatar.uid && !avatar.author && !avatar.hasAvatar)).toBeTruthy();
  expect(payload.avatars.every((avatar) => avatar.hideManagement === "1")).toBeTruthy();
  expect(payload.badgeMetrics.every((item) => item.contentInsideBadge && item.noBadgeOverflow && item.noNameOverflow))
    .toBeTruthy();
  expect(maxMetricSpread(payload.badgeMetrics, "avatarLeftOffset")).toBeLessThanOrEqual(4);
  expect(maxMetricSpread(payload.badgeMetrics, "nameLeftOffset")).toBeLessThanOrEqual(4);
  expect(maxAbsMetric(payload.badgeMetrics, "visualCenterDelta")).toBeLessThanOrEqual(12);
  expect(payload.lastBadgeCentered).toBe(true);
  expect(payload.noHorizontalOverflow).toBe(true);

  await group.locator(".direct-staff-grid .structure-avatar").first().click();
  await expect(page.locator(".structure-avatar-lightbox")).toBeVisible();
  const popup = await page.evaluate(() => {
    const caption = document.querySelector(".structure-avatar-lightbox__caption");
    return {
      text: caption?.textContent || "",
      labels: [...(caption?.querySelectorAll(".structure-avatar-lightbox__meta-row dt") || [])].map((el) =>
        el.textContent.trim()
      ),
      values: [...(caption?.querySelectorAll(".structure-avatar-lightbox__meta-row dd") || [])].map((el) =>
        el.textContent.trim()
      )
    };
  });
  expect(popup.text).toContain("Juliana Mociulsky");
  expect(popup.text).toContain("Médico especialista asociado");
  expect(popup.labels).toEqual(["Operaciones"]);
  expect(popup.values).toEqual(["Staff Médicos Especialistas Asociados"]);
  expect(popup.text).not.toContain("Unidad de gestión");
  expect(popup.values).not.toContain("Especialistas asociados");
  await page.keyboard.press("Escape");
  await expect(page.locator(".structure-avatar-lightbox")).toBeHidden();

  await header.focus();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-expanded", "true");
});

test("mobile structure keeps specialists direct staff readable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iphone-13", "Mobile audit runs on iPhone viewport.");

  await login(page, "#estructura");
  await page.waitForURL(/\/app\/index\.html\?dmEmulators=1#estructura$/, { timeout: 30_000 });
  await expect(page.locator(".dm-bottom-nav")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => document.body?.dataset?.view === "estructura");
  await page.locator("#app-splash").waitFor({ state: "detached", timeout: 6_000 }).catch(() => {});
  await ensureStructureOpen(page);
  await openSpecialistsGroup(page);

  const payload = await collectSpecialistsPayload(page);
  expect(payload.groupCount).toBe(4);
  expect(payload.staffCount).toBe(7);
  expect(payload.directStaffHeaderText).toBe("Staff médico");
  expect(payload.hasDirectStaffCount).toBe(false);
  expect(payload.directStaffHeaderCenterDelta).toBeLessThanOrEqual(5);
  expect(payload.columnCount).toBe(1);
  expect(payload.names).toEqual(EXPECTED_NAMES);
  expect(payload.initials).toEqual(EXPECTED_INITIALS);
  expect(payload.avatars.every((avatar) => !avatar.uid && !avatar.author && !avatar.hasAvatar)).toBeTruthy();
  expect(payload.avatars.every((avatar) => avatar.hideManagement === "1")).toBeTruthy();
  expect(payload.badgeMetrics.every((item) => item.contentInsideBadge && item.noBadgeOverflow && item.noNameOverflow))
    .toBeTruthy();
  expect(maxMetricSpread(payload.badgeMetrics, "avatarLeftOffset")).toBeLessThanOrEqual(5);
  expect(maxMetricSpread(payload.badgeMetrics, "nameLeftOffset")).toBeLessThanOrEqual(5);
  expect(maxAbsMetric(payload.badgeMetrics, "visualCenterDelta")).toBeLessThanOrEqual(8);
  expect(payload.noHorizontalOverflow).toBe(true);
});
