import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { getFirebase } from "/assets/js/common/firebaseClient.js";
import { waitForAuth } from "/assets/js/shared/authGate.js";

const FUNCTIONS_REGION = "us-central1";
const TOGGLE_CAROUSEL_LIKE_FUNCTION = "toggleCarouselLike";
const TOGGLE_CAROUSEL_COMMENT_LIKE_FUNCTION = "toggleCarouselCommentLike";
const REGISTER_HOME_VISIT_FUNCTION = "registerHomeVisit";

let toggleCarouselLikeCallable = null;
let toggleCarouselCommentLikeCallable = null;
let registerHomeVisitCallable = null;

const cleanString = (value) => (typeof value === "string" ? value.trim() : "");
const cleanCount = (value) =>
  Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;

const getFunctionsInstance = () => {
  const { app } = getFirebase();
  return getFunctions(app, FUNCTIONS_REGION);
};

const getToggleCarouselLikeCallable = () => {
  if (toggleCarouselLikeCallable) return toggleCarouselLikeCallable;
  toggleCarouselLikeCallable = httpsCallable(
    getFunctionsInstance(),
    TOGGLE_CAROUSEL_LIKE_FUNCTION,
  );
  return toggleCarouselLikeCallable;
};

const getToggleCarouselCommentLikeCallable = () => {
  if (toggleCarouselCommentLikeCallable) return toggleCarouselCommentLikeCallable;
  toggleCarouselCommentLikeCallable = httpsCallable(
    getFunctionsInstance(),
    TOGGLE_CAROUSEL_COMMENT_LIKE_FUNCTION,
  );
  return toggleCarouselCommentLikeCallable;
};

const getRegisterHomeVisitCallable = () => {
  if (registerHomeVisitCallable) return registerHomeVisitCallable;
  registerHomeVisitCallable = httpsCallable(
    getFunctionsInstance(),
    REGISTER_HOME_VISIT_FUNCTION,
  );
  return registerHomeVisitCallable;
};

const normalizeCallableCode = (error) =>
  typeof error?.code === "string" ? error.code : "";

const normalizeCommonReason = (error, fallback = "request_failed") => {
  const code = normalizeCallableCode(error);
  if (code.endsWith("/unauthenticated") || code === "unauthenticated") {
    return "auth_required";
  }
  if (code.endsWith("/invalid-argument") || code === "invalid-argument") {
    return "invalid_argument";
  }
  if (code.endsWith("/not-found") || code === "not-found") {
    return "not_found";
  }
  return fallback;
};

const waitForCurrentUser = async () => {
  const { auth } = getFirebase();
  const user = await waitForAuth(auth);
  return user?.uid ? user : null;
};

export const toggleCarouselLikeForCurrentUser = async (postId) => {
  const normalizedPostId = cleanString(postId);
  if (!normalizedPostId) {
    return { ok: false, reason: "invalid_argument" };
  }

  const user = await waitForCurrentUser();
  if (!user) {
    return { ok: false, reason: "auth_required" };
  }

  try {
    const response = await getToggleCarouselLikeCallable()({
      postId: normalizedPostId,
    });
    const data = response?.data || {};
    return {
      ok: true,
      liked: Boolean(data.liked),
      likedBy: Array.isArray(data.likedBy)
        ? data.likedBy.map(cleanString).filter(Boolean)
        : [],
      likedNames: Array.isArray(data.likedNames)
        ? data.likedNames.map(cleanString).filter(Boolean)
        : [],
      likesCount: cleanCount(data.likesCount),
      likeCount: cleanCount(data.likeCount),
    };
  } catch (error) {
    return { ok: false, reason: normalizeCommonReason(error, "toggle_failed") };
  }
};

export const toggleCarouselCommentLikeForCurrentUser = async ({
  postId,
  commentId,
} = {}) => {
  const normalizedPostId = cleanString(postId);
  const normalizedCommentId = cleanString(commentId);
  if (!normalizedPostId || !normalizedCommentId) {
    return { ok: false, reason: "invalid_argument" };
  }

  const user = await waitForCurrentUser();
  if (!user) {
    return { ok: false, reason: "auth_required" };
  }

  try {
    const response = await getToggleCarouselCommentLikeCallable()({
      postId: normalizedPostId,
      commentId: normalizedCommentId,
    });
    const data = response?.data || {};
    const likedBy =
      data.likedBy && typeof data.likedBy === "object" && !Array.isArray(data.likedBy)
        ? Object.fromEntries(
            Object.entries(data.likedBy)
              .map(([uid, name]) => [cleanString(uid), cleanString(name)])
              .filter(([uid]) => uid),
          )
        : {};
    return {
      ok: true,
      liked: Boolean(data.liked),
      likedBy,
      likesCount: cleanCount(data.likesCount),
    };
  } catch (error) {
    return {
      ok: false,
      reason: normalizeCommonReason(error, "toggle_failed"),
    };
  }
};

export const registerHomeVisitForCurrentUser = async () => {
  const user = await waitForCurrentUser();
  if (!user) {
    return { ok: false, reason: "auth_required" };
  }

  try {
    const response = await getRegisterHomeVisitCallable()();
    const data = response?.data || {};
    return {
      ok: true,
      counted: Boolean(data.counted),
      count: cleanCount(data.count),
    };
  } catch (error) {
    return {
      ok: false,
      reason: normalizeCommonReason(error, "visit_failed"),
    };
  }
};
