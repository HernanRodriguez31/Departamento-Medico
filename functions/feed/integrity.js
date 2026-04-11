const HOME_VISIT_COOLDOWN_MS = 15 * 60 * 1000;

const cleanString = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeLikeName = (value, fallbackUid = "") =>
  cleanString(value) || cleanString(fallbackUid) || "Usuario";

const getLikeDocData = (entry) => {
  if (!entry) return {};
  if (typeof entry.data === "function") {
    return entry.data() || {};
  }
  if (typeof entry.data === "object") {
    return entry.data || {};
  }
  return {};
};

const getLikeDocUid = (entry) => {
  const directId = cleanString(entry?.id);
  if (directId) return directId;
  const data = getLikeDocData(entry);
  return cleanString(data.authorUid || data.uid);
};

const buildLikeEntriesMap = (entries = []) => {
  const likesMap = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const uid = getLikeDocUid(entry);
    if (!uid) return;
    const data = getLikeDocData(entry);
    likesMap.set(uid, normalizeLikeName(data.authorName, uid));
  });
  return likesMap;
};

const buildCarouselLikeAggregate = (entries = []) => {
  const likesMap = buildLikeEntriesMap(entries);
  const likedBy = Array.from(likesMap.keys());
  const likedNames = Array.from(likesMap.values()).filter(Boolean);
  const count = likedBy.length;
  return {
    likedBy,
    likedNames,
    likesCount: count,
    likeCount: count,
  };
};

const buildCarouselLikeAggregatePatch = ({
  likedBy = [],
  likedNames = [],
} = {}) => {
  const normalizedLikedBy = Array.isArray(likedBy)
    ? likedBy.map(cleanString).filter(Boolean)
    : [];
  const normalizedLikedNames = Array.isArray(likedNames)
    ? likedNames.map(cleanString).filter(Boolean)
    : [];
  const count = normalizedLikedBy.length;
  return {
    likedBy: normalizedLikedBy,
    likedNames: normalizedLikedNames,
    likesCount: count,
    likeCount: count,
  };
};

const buildCarouselLikeToggleResult = ({
  entries = [],
  actingUid = "",
  actingDisplayName = "",
} = {}) => {
  const uid = cleanString(actingUid);
  if (!uid) {
    return {
      liked: false,
      likedBy: [],
      likedNames: [],
      likesCount: 0,
      likeCount: 0,
      actorName: "Usuario",
    };
  }
  const likesMap = buildLikeEntriesMap(entries);
  const actorName = normalizeLikeName(actingDisplayName, uid);
  const alreadyLiked = likesMap.has(uid);
  if (alreadyLiked) {
    likesMap.delete(uid);
  } else {
    likesMap.set(uid, actorName);
  }
  const likedBy = Array.from(likesMap.keys());
  const likedNames = Array.from(likesMap.values()).filter(Boolean);
  const count = likedBy.length;
  return {
    liked: !alreadyLiked,
    likedBy,
    likedNames,
    likesCount: count,
    likeCount: count,
    actorName,
  };
};

const toggleCommentLikedByMap = ({
  likedBy = {},
  actingUid = "",
  actingDisplayName = "",
} = {}) => {
  const uid = cleanString(actingUid);
  const nextLikedBy =
    likedBy && typeof likedBy === "object" && !Array.isArray(likedBy)
      ? { ...likedBy }
      : {};
  if (!uid) {
    return {
      liked: false,
      likedBy: nextLikedBy,
      likesCount: Object.keys(nextLikedBy).length,
    };
  }
  if (nextLikedBy[uid]) {
    delete nextLikedBy[uid];
    return {
      liked: false,
      likedBy: nextLikedBy,
      likesCount: Object.keys(nextLikedBy).length,
    };
  }
  nextLikedBy[uid] = normalizeLikeName(actingDisplayName, uid);
  return {
    liked: true,
    likedBy: nextLikedBy,
    likesCount: Object.keys(nextLikedBy).length,
  };
};

const getTimestampMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === "object") {
    const seconds = Number(value.seconds);
    const nanos = Number(value.nanoseconds);
    if (Number.isFinite(seconds)) {
      return seconds * 1000 + Math.floor((Number.isFinite(nanos) ? nanos : 0) / 1e6);
    }
  }
  return 0;
};

const evaluateHomeVisitRegistration = ({
  lastRegisteredAt = null,
  nowMs = Date.now(),
  cooldownMs = HOME_VISIT_COOLDOWN_MS,
} = {}) => {
  const lastRegisteredMs = getTimestampMillis(lastRegisteredAt);
  if (!lastRegisteredMs) {
    return { counted: true, lastRegisteredMs: 0 };
  }
  return {
    counted: nowMs - lastRegisteredMs >= cooldownMs,
    lastRegisteredMs,
  };
};

const normalizeCounterValue = (count) =>
  Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;

module.exports = {
  HOME_VISIT_COOLDOWN_MS,
  buildCarouselLikeAggregate,
  buildCarouselLikeAggregatePatch,
  buildCarouselLikeToggleResult,
  toggleCommentLikedByMap,
  evaluateHomeVisitRegistration,
  normalizeCounterValue,
};
