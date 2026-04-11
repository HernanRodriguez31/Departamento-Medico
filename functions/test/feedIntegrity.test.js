const test = require("node:test");
const assert = require("node:assert/strict");

const {
  HOME_VISIT_COOLDOWN_MS,
  buildCarouselLikeAggregate,
  buildCarouselLikeAggregatePatch,
  buildCarouselLikeToggleResult,
  toggleCommentLikedByMap,
  evaluateHomeVisitRegistration,
  normalizeCounterValue,
} = require("../feed/integrity");

test("buildCarouselLikeToggleResult toggles a new like and returns synced arrays", () => {
  const result = buildCarouselLikeToggleResult({
    entries: [
      {
        id: "user-a",
        data: () => ({ authorUid: "user-a", authorName: "Dr. A" }),
      },
    ],
    actingUid: "user-b",
    actingDisplayName: "Dr. B",
  });

  assert.equal(result.liked, true);
  assert.deepEqual(result.likedBy, ["user-a", "user-b"]);
  assert.deepEqual(result.likedNames, ["Dr. A", "Dr. B"]);
  assert.equal(result.likesCount, 2);
  assert.equal(result.likeCount, 2);
});

test("buildCarouselLikeToggleResult removes an existing like without going negative", () => {
  const result = buildCarouselLikeToggleResult({
    entries: [
      {
        id: "user-a",
        data: () => ({ authorUid: "user-a", authorName: "Dr. A" }),
      },
    ],
    actingUid: "user-a",
    actingDisplayName: "Dr. A",
  });

  assert.equal(result.liked, false);
  assert.deepEqual(result.likedBy, []);
  assert.deepEqual(result.likedNames, []);
  assert.equal(result.likesCount, 0);
  assert.equal(result.likeCount, 0);
});

test("buildCarouselLikeAggregate derives arrays and both legacy counters from like docs", () => {
  const aggregate = buildCarouselLikeAggregate([
    {
      id: "user-a",
      data: () => ({ authorUid: "user-a", authorName: "Dr. A" }),
    },
    {
      id: "user-b",
      data: () => ({ authorUid: "user-b", authorName: "Dr. B" }),
    },
  ]);

  assert.deepEqual(aggregate.likedBy, ["user-a", "user-b"]);
  assert.deepEqual(aggregate.likedNames, ["Dr. A", "Dr. B"]);
  assert.equal(aggregate.likesCount, 2);
  assert.equal(aggregate.likeCount, 2);
});

test("buildCarouselLikeAggregatePatch returns a parent-doc payload with synced counters", () => {
  const patch = buildCarouselLikeAggregatePatch({
    likedBy: ["user-a", "user-b"],
    likedNames: ["Dr. A", "Dr. B"],
  });

  assert.deepEqual(patch, {
    likedBy: ["user-a", "user-b"],
    likedNames: ["Dr. A", "Dr. B"],
    likesCount: 2,
    likeCount: 2,
  });
});

test("buildCarouselLikeAggregatePatch clamps invalid arrays to a zeroed payload", () => {
  const patch = buildCarouselLikeAggregatePatch({
    likedBy: ["", "   "],
    likedNames: ["", null],
  });

  assert.deepEqual(patch, {
    likedBy: [],
    likedNames: [],
    likesCount: 0,
    likeCount: 0,
  });
});

test("toggleCommentLikedByMap toggles the current uid inside the existing map", () => {
  const added = toggleCommentLikedByMap({
    likedBy: { "user-a": "Dr. A" },
    actingUid: "user-b",
    actingDisplayName: "Dr. B",
  });
  assert.equal(added.liked, true);
  assert.deepEqual(added.likedBy, {
    "user-a": "Dr. A",
    "user-b": "Dr. B",
  });
  assert.equal(added.likesCount, 2);

  const removed = toggleCommentLikedByMap({
    likedBy: added.likedBy,
    actingUid: "user-a",
    actingDisplayName: "Dr. A",
  });
  assert.equal(removed.liked, false);
  assert.deepEqual(removed.likedBy, {
    "user-b": "Dr. B",
  });
  assert.equal(removed.likesCount, 1);
});

test("toggleCommentLikedByMap removes the only like and returns an empty map with zero count", () => {
  const removed = toggleCommentLikedByMap({
    likedBy: { "user-a": "Dr. A" },
    actingUid: "user-a",
    actingDisplayName: "Dr. A",
  });

  assert.equal(removed.liked, false);
  assert.deepEqual(removed.likedBy, {});
  assert.equal(removed.likesCount, 0);
});

test("evaluateHomeVisitRegistration applies the configured cooldown window", () => {
  const nowMs = Date.UTC(2026, 3, 11, 12, 0, 0);
  assert.deepEqual(
    evaluateHomeVisitRegistration({
      lastRegisteredAt: null,
      nowMs,
    }),
    { counted: true, lastRegisteredMs: 0 }
  );

  const withinCooldown = evaluateHomeVisitRegistration({
    lastRegisteredAt: {
      toMillis: () => nowMs - HOME_VISIT_COOLDOWN_MS + 1000,
    },
    nowMs,
  });
  assert.equal(withinCooldown.counted, false);

  const afterCooldown = evaluateHomeVisitRegistration({
    lastRegisteredAt: {
      toMillis: () => nowMs - HOME_VISIT_COOLDOWN_MS,
    },
    nowMs,
  });
  assert.equal(afterCooldown.counted, true);
});

test("normalizeCounterValue clamps invalid values to zero", () => {
  assert.equal(normalizeCounterValue(4), 4);
  assert.equal(normalizeCounterValue(-1), 0);
  assert.equal(normalizeCounterValue(NaN), 0);
});
