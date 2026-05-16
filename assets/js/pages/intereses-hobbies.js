import {
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getFirebase } from "../common/firebaseClient.js";
import { COLLECTIONS } from "../common/collections.js";
import { initUserMenu } from "../common/user-menu.js?v=20260430-orgtree-avatars-1";
import { hydrateAvatars } from "../common/user-profiles.js?v=20260430-orgtree-avatars-1";
import { requireAuth } from "../shared/authGate.js";
import { initSessionGuard } from "../shared/sessionGuard.js?v=20260305-session-1";
import {
  toggleCarouselCommentLikeForCurrentUser,
  toggleCarouselLikeForCurrentUser,
} from "../services/interactions/FeedInteractionService.js";

const HOBBIES_TYPE = "team_hobbies";
const PAGE_SIZE = 12;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PROCESSED_IMAGE_SIDE = 1920;
const PROCESSED_IMAGE_QUALITY = 0.9;
const MIN_CROP_ZOOM = 1;
const MAX_CROP_ZOOM = 3;
const DEFAULT_IMAGE_CROP = Object.freeze({
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  frameAspect: 0,
});
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const { POSTS: POSTS_COLLECTION, COMMENTS: COMMENTS_COLLECTION } = COLLECTIONS;
const { auth, db, storage } = getFirebase();

let currentUser = null;
let currentUserIsAdmin = false;
let lastDoc = null;
let isLoading = false;
let hasMore = true;
let postsById = new Map();
let commentsByKey = new Map();
let commentUnsubs = new Map();
let activeReplyDrafts = new Map();
let editPostId = "";
let editCommentRef = null;
let authActionState = null;
let activeLightboxTrigger = null;
let uploadCropState = null;
let editCropState = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const els = {
  feed: $("#team-hobbies-feed"),
  empty: $("#team-hobbies-empty"),
  error: $("#team-hobbies-error"),
  loadMore: $("#team-hobbies-load-more"),
  uploadOpen: $("#team-hobbies-upload"),
  modal: $("#team-hobbies-modal"),
  form: $("#team-hobbies-form"),
  cancel: $("#team-hobbies-cancel"),
  close: $("#team-hobbies-close"),
  file: $("#team-hobbies-file"),
  preview: $("#team-hobbies-preview"),
  formError: $("#team-hobbies-form-error"),
  save: $("#team-hobbies-save"),
  scrollUp: $("#scroll-up"),
  returnHome: $("#team-hobbies-return-home"),
  editModal: $("#team-hobbies-edit-modal"),
  editForm: $("#team-hobbies-edit-form"),
  editClose: $("#team-hobbies-edit-close"),
  editCancel: $("#team-hobbies-edit-cancel"),
  editSave: $("#team-hobbies-edit-save"),
  editError: $("#team-hobbies-edit-error"),
  editFile: $("#team-hobbies-edit-file"),
  editPreview: $("#team-hobbies-edit-preview"),
  commentEditModal: $("#team-hobbies-comment-edit-modal"),
  commentEditForm: $("#team-hobbies-comment-edit-form"),
  commentEditClose: $("#team-hobbies-comment-edit-close"),
  commentEditCancel: $("#team-hobbies-comment-edit-cancel"),
  commentEditSave: $("#team-hobbies-comment-edit-save"),
  commentEditError: $("#team-hobbies-comment-edit-error"),
  authModal: $("#team-hobbies-auth-modal"),
  authForm: $("#team-hobbies-auth-form"),
  authClose: $("#team-hobbies-auth-close"),
  authCancel: $("#team-hobbies-auth-cancel"),
  authConfirm: $("#team-hobbies-auth-confirm"),
  authPassword: $("#team-hobbies-auth-password"),
  authError: $("#team-hobbies-auth-error"),
  authTitle: $("#team-hobbies-auth-title"),
  authMessage: $("#team-hobbies-auth-message"),
  lightbox: $("#team-hobbies-lightbox"),
  lightboxClose: $("#team-hobbies-lightbox-close"),
  lightboxImg: $("#team-hobbies-lightbox-img"),
  lightboxTitle: $("#team-hobbies-lightbox-title"),
  lightboxDescription: $("#team-hobbies-lightbox-description"),
  lightboxLikes: $("#team-hobbies-lightbox-likes"),
  lightboxComments: $("#team-hobbies-lightbox-comments"),
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const cleanString = (value, max = 5000) =>
  String(value || "")
    .trim()
    .slice(0, max);

const formatDisplayName = (user) => {
  const raw = cleanString(user?.displayName || user?.email?.split("@")[0] || "Usuario", 120);
  return raw || "Usuario";
};

const getTimestampDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return null;
};

const formatDateTime = (value) => {
  const date = getTimestampDate(value);
  if (!date) return "Hace instantes";
  return date.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const safeFileName = (name = "foto.jpg") => {
  const clean = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return clean || "foto.jpg";
};

const getStoredOriginalName = (name = "foto") => cleanString(name, 150) || "foto";

const getImageAspect = (width = 0, height = 0) => {
  const ratio = Number(width) / Number(height || 1);
  if (ratio > 1.08) return "landscape";
  if (ratio < 0.92) return "portrait";
  return "square";
};

const normalizeImageCrop = (value = {}) => {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    zoom: clamp(Number(raw.zoom) || DEFAULT_IMAGE_CROP.zoom, MIN_CROP_ZOOM, MAX_CROP_ZOOM),
    offsetX: clamp(Number(raw.offsetX) || 0, -0.48, 0.48),
    offsetY: clamp(Number(raw.offsetY) || 0, -0.48, 0.48),
    frameAspect: Math.max(0, Number(raw.frameAspect) || 0),
  };
};

const getCropStyle = (cropValue = {}) => {
  const crop = normalizeImageCrop(cropValue);
  const x = Number((-crop.offsetX * 100).toFixed(3));
  const y = Number((-crop.offsetY * 100).toFixed(3));
  return [
    `--team-hobby-crop-zoom: ${crop.zoom.toFixed(3)}`,
    `--team-hobby-crop-x: ${x}%`,
    `--team-hobby-crop-y: ${y}%`,
  ].join("; ");
};

const getCropperFrameRatio = ({ width = 0, height = 0, imageAspect = "" } = {}) => {
  const naturalRatio = Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : 1;
  if (imageAspect === "portrait") return clamp(naturalRatio, 0.58, 0.82);
  if (imageAspect === "square") return 1;
  return clamp(naturalRatio, 1.18, 1.9);
};

const getCropperOrientationClass = (imageAspect = "") => {
  if (imageAspect === "portrait") return "team-hobbies-cropper--portrait";
  if (imageAspect === "square") return "team-hobbies-cropper--square";
  return "team-hobbies-cropper--landscape";
};

const getCropFromState = (state) => {
  if (!state) return { ...DEFAULT_IMAGE_CROP };
  const crop = {
    zoom: clamp(Number(state.zoom) || MIN_CROP_ZOOM, MIN_CROP_ZOOM, MAX_CROP_ZOOM),
    offsetX: (Number(state.centerX) - Number(state.width) / 2) / Math.max(Number(state.width), 1),
    offsetY: (Number(state.centerY) - Number(state.height) / 2) / Math.max(Number(state.height), 1),
    frameAspect: Number(state.width) > 0 && Number(state.height) > 0 ? Number(state.width) / Number(state.height) : 0,
  };
  return {
    zoom: Number(crop.zoom.toFixed(3)),
    offsetX: Number(clamp(crop.offsetX, -0.48, 0.48).toFixed(5)),
    offsetY: Number(clamp(crop.offsetY, -0.48, 0.48).toFixed(5)),
    frameAspect: Number(crop.frameAspect.toFixed(5)),
  };
};

const loadImageFile = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      if (!width || !height) {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo leer la imagen."));
        return;
      }
      resolve({ image: img, objectUrl: url, width, height, imageAspect: getImageAspect(width, height) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("El archivo no parece una imagen válida."));
    };
    img.src = url;
  });

const loadImageUrlForCrop = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      if (!width || !height) {
        reject(new Error("No se pudo leer la imagen actual."));
        return;
      }
      resolve({ image: img, objectUrl: url, width, height, imageAspect: getImageAspect(width, height) });
    };
    img.onerror = () => reject(new Error("No se pudo cargar la imagen actual."));
    img.src = url;
  });

const normalizeLikedByMap = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const getInitials = (name = "") => {
  const parts = cleanString(name, 80).split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return initials || "DM";
};

const mapPost = (docSnap) => {
  const data = docSnap.data() || {};
  const likedBy = Array.isArray(data.likedBy) ? data.likedBy : [];
  const likedNames = Array.isArray(data.likedNames)
    ? data.likedNames.map((value) => cleanString(value, 120)).filter(Boolean)
    : [];
  return {
    id: docSnap.id,
    title: cleanString(data.title, 160),
    description: cleanString(data.briefDescription || data.text || data.longDescription, 1200),
    imageUrl: data.imageUrl || "",
    thumbUrl: data.thumbUrl || data.imageUrl || "",
    imagePath: data.imagePath || "",
    imageAspect: data.imageAspect || "landscape",
    imageWidth: Number(data.imageWidth) || 0,
    imageHeight: Number(data.imageHeight) || 0,
    imageCrop: normalizeImageCrop(data.imageCrop),
    imageOriginalName: cleanString(data.imageOriginalName, 160),
    imageColorPipeline: cleanString(data.imageColorPipeline, 40),
    createdByUid: data.createdByUid || data.authorUid || "",
    createdByName: data.createdByName || data.authorName || "Usuario",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    likedBy,
    likedNames,
    likesCount: likedBy.length || (Number.isFinite(data.likesCount) ? data.likesCount : 0),
    commentCount: Number.isFinite(data.commentCount) ? data.commentCount : 0,
  };
};

const mapComment = (docSnap) => {
  const data = docSnap.data() || {};
  const replyDepth = Math.min(Math.max(Number(data.replyDepth) || 0, 0), 2);
  return {
    id: docSnap.id,
    text: cleanString(data.text, 800),
    authorUid: data.authorUid || data.createdByUid || "",
    authorName: data.authorName || data.createdByName || "Usuario",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    likedBy: normalizeLikedByMap(data.likedBy),
    parentCommentId: cleanString(data.parentCommentId, 160),
    rootCommentId: cleanString(data.rootCommentId, 160),
    replyDepth,
    replyToCommentId: cleanString(data.replyToCommentId, 160),
    replyToAuthorName: cleanString(data.replyToAuthorName, 120),
    deleted: Boolean(data.deleted),
    deletedAt: data.deletedAt,
    deletedBy: cleanString(data.deletedBy, 160),
  };
};

const getImageRatioValue = (post) => {
  const width = Number(post?.imageWidth) || 0;
  const height = Number(post?.imageHeight) || 0;
  if (width > 0 && height > 0) return `${Math.round(width)} / ${Math.round(height)}`;
  if (post?.imageAspect === "portrait") return "4 / 5";
  if (post?.imageAspect === "square") return "1 / 1";
  return "4 / 3";
};

const getImageAspectClass = (post) => {
  if (post?.imageAspect === "portrait") return "team-hobby-media--portrait is-portrait";
  if (post?.imageAspect === "square") return "team-hobby-media--square is-square";
  return "team-hobby-media--landscape is-landscape";
};

const formatLikeNames = (names = []) => {
  const uniqueNames = [...new Set(names.map((name) => cleanString(name, 120)).filter(Boolean))];
  if (!uniqueNames.length) return "Sin me gusta todavía";
  if (uniqueNames.length === 1) return `Le gusta a ${uniqueNames[0]}`;
  if (uniqueNames.length === 2) return `Le gusta a ${uniqueNames[0]} y ${uniqueNames[1]}`;
  const visibleNames = uniqueNames.slice(0, 4);
  const extraCount = uniqueNames.length - visibleNames.length;
  const suffix = extraCount > 0 ? ` y ${extraCount} más` : "";
  return `Le gusta a ${visibleNames.join(", ")}${suffix}`;
};

const formatCommentLikeNames = (likedBy = {}) => {
  const names = Object.values(likedBy)
    .map((name) => cleanString(name, 120))
    .filter(Boolean);
  return formatLikeNames(names);
};

const getOwnerUid = (item) => item?.createdByUid || item?.authorUid || "";

const canManageItem = (item) =>
  Boolean(currentUser && (currentUserIsAdmin || getOwnerUid(item) === currentUser.uid));

const resolveAdminStatus = async (user) => {
  if (!user) return false;
  try {
    const token = await user.getIdTokenResult();
    if (token?.claims?.admin === true) return true;
  } catch (error) {
    console.warn("[Intereses y Hobbies] No se pudo leer custom claims.", error);
  }
  try {
    const snap = await getDoc(doc(db, "admin_whitelist", user.uid));
    return snap.exists();
  } catch (error) {
    console.warn("[Intereses y Hobbies] No se pudo leer admin_whitelist.", error);
    return false;
  }
};

const renderPostSeparator = () => {
  const separator = document.createElement("div");
  separator.className = "team-hobby-separator";
  separator.setAttribute("aria-hidden", "true");
  separator.innerHTML = `
    <span class="team-hobby-separator__mark">
      <img src="/assets/images/logo-brisa-heart.png" alt="" loading="lazy" decoding="async" />
    </span>
  `;
  return separator;
};

const renderLikeTooltip = (post) => `
  <span class="team-hobby-like-tooltip" id="team-hobby-like-tooltip-${escapeHtml(post.id)}" role="tooltip">
    ${escapeHtml(formatLikeNames(post.likedNames))}
  </span>
`;

const renderPost = (post, postIndex = 0) => {
  const liked = currentUser && post.likedBy.includes(currentUser.uid);
  const canManage = canManageItem(post);
  const isPriorityImage = postIndex < 2;
  const fetchPriority = isPriorityImage ? ' fetchpriority="high"' : "";
  const likeLabel = liked ? "Quitar me gusta de esta foto" : "Dar me gusta a esta foto";
  const article = document.createElement("article");
  article.className = "team-hobby-post";
  article.dataset.postId = post.id;
  article.innerHTML = `
    <header class="team-hobby-post__header">
      <span class="team-hobby-avatar" data-author-avatar data-author-uid="${escapeHtml(post.createdByUid)}" data-author-name="${escapeHtml(post.createdByName)}">
        <img class="team-hobby-avatar__img" data-avatar-img src="${TRANSPARENT_PIXEL}" alt="" hidden />
        <span data-avatar-fallback="initials">${escapeHtml(getInitials(post.createdByName))}</span>
      </span>
      <div class="team-hobby-post__identity">
        <p class="team-hobby-post__author">${escapeHtml(post.createdByName)}</p>
        <p class="team-hobby-post__date">${escapeHtml(formatDateTime(post.createdAt))}</p>
      </div>
      ${
        canManage
          ? `<div class="team-hobby-owner-actions" aria-label="Acciones de publicación">
              <button class="team-hobby-owner-action" type="button" data-post-action="edit" aria-label="Editar publicación" title="Editar publicación">
                <i data-lucide="pencil" aria-hidden="true"></i>
              </button>
              <button class="team-hobby-owner-action team-hobby-owner-action--delete" type="button" data-post-action="delete" aria-label="Eliminar publicación" title="Eliminar publicación">
                <i data-lucide="trash-2" aria-hidden="true"></i>
              </button>
            </div>`
          : ""
      }
    </header>
    <div class="team-hobby-post__layout">
      <div class="team-hobby-media-card">
        <button class="team-hobby-media ${getImageAspectClass(post)} is-loading" type="button" data-action="open-image" data-image-aspect="${escapeHtml(post.imageAspect || "landscape")}" style="--team-hobby-image-ratio: ${getImageRatioValue(post)}; ${getCropStyle(post.imageCrop)}" aria-label="Ver foto ${escapeHtml(post.title)}">
          <img src="${escapeHtml(post.thumbUrl)}" data-full="${escapeHtml(post.imageUrl)}" alt="${escapeHtml(post.title)}" loading="${isPriorityImage ? "eager" : "lazy"}"${fetchPriority} decoding="async" />
        </button>
        <footer class="team-hobby-actions">
          <button class="team-hobby-action team-hobby-action--like${liked ? " is-active" : ""}" type="button" data-action="like" aria-pressed="${liked ? "true" : "false"}" aria-label="${escapeHtml(likeLabel)}" aria-describedby="team-hobby-like-tooltip-${escapeHtml(post.id)}">
            <span class="team-hobby-heart" aria-hidden="true">♥</span>
            <span data-like-count>${post.likesCount}</span>
            ${renderLikeTooltip(post)}
          </button>
          <span class="team-hobby-action team-hobby-action--comments" aria-label="${post.commentCount || 0} comentarios">
            <i data-lucide="message-circle" aria-hidden="true"></i>
            <span data-comment-count>${post.commentCount || 0}</span>
          </span>
        </footer>
      </div>
      <aside class="team-hobby-comments" aria-label="Comentarios de ${escapeHtml(post.title)}">
        <div class="team-hobby-post__content team-hobby-post__content--aside">
          <h2 class="team-hobby-post__title">${escapeHtml(post.title)}</h2>
          ${post.description ? `<p class="team-hobby-post__description">${escapeHtml(post.description)}</p>` : ""}
        </div>
        <header class="team-hobby-comments__header">
          <h3 class="team-hobby-comments__title">Comentarios</h3>
          <span class="team-hobby-comments__count" data-comment-count>${post.commentCount || 0}</span>
        </header>
        <div class="team-hobby-comments__list" data-comments-list>
          <div class="art-empty">Cargando comentarios...</div>
        </div>
        <form class="team-hobby-comment-form" data-comment-form>
          <textarea class="team-hobby-comment-input" rows="2" maxlength="800" placeholder="Escribe un comentario..." aria-label="Comentar foto"></textarea>
          <div class="team-hobby-comment-error" role="alert" hidden></div>
          <button class="team-hobby-comment-submit" type="submit">Enviar comentario</button>
        </form>
      </aside>
    </div>
  `;
  hydrateAvatars(article).catch(() => {});
  hydratePostImage(article);
  return article;
};

const renderComment = (comment, nestedHtml = "", level = 0) => {
  const isDeleted = Boolean(comment.deleted);
  const canManage = !isDeleted && canManageItem(comment);
  const likedBy = normalizeLikedByMap(comment.likedBy);
  const likesCount = Object.keys(likedBy).length;
  const liked = currentUser?.uid ? Boolean(likedBy[currentUser.uid]) : false;
  const edited = Boolean(comment.updatedAt) && !isDeleted;
  const safeLevel = Math.min(Math.max(Number(level) || 0, 0), 2);
  const canReply = !isDeleted && safeLevel < 2;
  const replyTo = safeLevel > 0 && comment.replyToAuthorName
    ? `<span class="team-hobby-comment__reply-to">Responder a ${escapeHtml(comment.replyToAuthorName)}</span>`
    : "";
  const text = comment.text || "";
  return `
    <article class="team-hobby-comment${safeLevel > 0 ? " team-hobby-comment--reply" : ""}${isDeleted ? " is-deleted" : ""}" data-comment-id="${escapeHtml(comment.id)}" data-reply-depth="${safeLevel}" style="--reply-level: ${safeLevel};">
      <div class="team-hobby-comment__meta">
        <span>
          <span class="team-hobby-comment__author">${escapeHtml(comment.authorName || "Usuario")}</span>
          <span class="team-hobby-comment__date">${escapeHtml(formatDateTime(comment.createdAt))}</span>
          ${edited ? '<span class="team-hobby-comment__edited">Editado</span>' : ""}
        </span>
        ${
          canManage
            ? `<span class="team-hobby-comment__actions" aria-label="Acciones del comentario">
                <button class="team-hobby-comment-action" type="button" data-comment-action="edit" data-comment-id="${escapeHtml(comment.id)}" aria-label="Editar comentario" title="Editar comentario">
                  <i data-lucide="pencil" aria-hidden="true"></i>
                </button>
                <button class="team-hobby-comment-action team-hobby-comment-action--delete" type="button" data-comment-action="delete" data-comment-id="${escapeHtml(comment.id)}" aria-label="Eliminar comentario" title="Eliminar comentario">
                  <i data-lucide="trash-2" aria-hidden="true"></i>
                </button>
              </span>`
            : ""
        }
      </div>
      ${replyTo}
      <p class="team-hobby-comment__text">${escapeHtml(text)}</p>
      ${
        isDeleted
          ? ""
          : `<footer class="team-hobby-comment__footer">
              <button class="team-hobby-comment-like${liked ? " is-active" : ""}" type="button" data-comment-action="like" data-comment-id="${escapeHtml(comment.id)}" aria-pressed="${liked ? "true" : "false"}" aria-label="${liked ? "Quitar me gusta del comentario" : "Dar me gusta al comentario"}">
                <span class="team-hobby-heart" aria-hidden="true">♥</span>
                <span data-comment-like-count>${likesCount}</span>
                <span class="team-hobby-comment-like-tooltip" role="tooltip">${escapeHtml(formatCommentLikeNames(likedBy))}</span>
              </button>
              ${
                canReply
                  ? `<button class="team-hobby-comment-reply" type="button" data-comment-action="reply" data-comment-id="${escapeHtml(comment.id)}">
                      <i data-lucide="corner-down-right" aria-hidden="true"></i>
                      <span>Responder</span>
                    </button>`
                  : ""
              }
            </footer>`
      }
      <div class="team-hobby-comment__reply-slot" data-reply-slot></div>
      ${nestedHtml ? `<div class="team-hobby-comment__replies">${nestedHtml}</div>` : ""}
    </article>
  `;
};

const renderCommentsTree = (comments = []) => {
  const byParent = new Map();
  const byId = new Map();
  comments.forEach((comment) => {
    byId.set(comment.id, comment);
    const parentId = comment.parentCommentId || "";
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(comment);
  });

  const renderBranch = (comment, level = 0) => {
    const effectiveLevel = Math.min(Math.max(Number(level) || Number(comment.replyDepth) || 0, Number(comment.replyDepth) || 0), 2);
    const childLevel = comment.deleted ? effectiveLevel : effectiveLevel + 1;
    const children = (byParent.get(comment.id) || []).map((child) => renderBranch(child, childLevel)).join("");
    if (comment.deleted) return children;
    return renderComment(comment, children, effectiveLevel);
  };

  return comments
    .filter((comment) => !comment.parentCommentId || !byId.has(comment.parentCommentId))
    .map((comment) => renderBranch(comment, 0))
    .join("");
};

const getCommentSortTime = (comment) => {
  const created = getTimestampDate(comment?.createdAt);
  if (created) return created.getTime();
  const updated = getTimestampDate(comment?.updatedAt);
  if (updated) return updated.getTime();
  return Number.POSITIVE_INFINITY;
};

const sortCommentsForRender = (comments = []) =>
  [...comments].sort((a, b) => {
    const aTime = getCommentSortTime(a);
    const bTime = getCommentSortTime(b);
    const aMissing = !Number.isFinite(aTime);
    const bMissing = !Number.isFinite(bTime);
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (!aMissing && aTime !== bTime) return aTime - bTime;
    return String(a.id || "").localeCompare(String(b.id || ""), "es");
  });

const hydratePostImage = (article) => {
  const image = $(".team-hobby-media img", article);
  const media = $(".team-hobby-media", article);
  if (!image || !media) return;
  let settled = false;
  const markLoaded = () => {
    if (settled) return;
    settled = true;
    const width = image.naturalWidth || 0;
    const height = image.naturalHeight || 0;
    if (width > 0 && height > 0) {
      const orientation = getImageAspect(width, height);
      media.style.setProperty("--team-hobby-image-ratio", `${width} / ${height}`);
      media.dataset.imageAspect = orientation;
      media.classList.toggle("team-hobby-media--portrait", orientation === "portrait");
      media.classList.toggle("team-hobby-media--square", orientation === "square");
      media.classList.toggle("team-hobby-media--landscape", orientation === "landscape");
      media.classList.toggle("is-portrait", orientation === "portrait");
      media.classList.toggle("is-square", orientation === "square");
      media.classList.toggle("is-landscape", orientation === "landscape");
    }
    media.classList.remove("is-loading");
    media.classList.remove("has-error");
    media.classList.add("is-loaded");
  };
  const markError = () => {
    if (settled) return;
    settled = true;
    media.classList.remove("is-loading");
    media.classList.remove("is-loaded");
    media.classList.add("has-error");
  };
  if (image.complete && image.naturalWidth) {
    markLoaded();
    return;
  }
  image.addEventListener("load", markLoaded, { once: true });
  image.addEventListener("error", markError, { once: true });
  if (typeof image.decode === "function") {
    image.decode().then(markLoaded).catch(() => {
      if (image.complete && !image.naturalWidth) markError();
    });
  }
  window.setTimeout(() => {
    if (!settled && image.complete && image.naturalWidth) markLoaded();
  }, 1200);
};

const showError = (message = "") => {
  if (!els.error) return;
  els.error.hidden = !message;
  els.error.textContent = message;
};

const getFirebaseErrorCode = (error) => String(error?.code || "").toLowerCase();

const getFirebaseErrorText = (error) =>
  `${String(error?.message || "")} ${String(error?.customData?.serverResponse || "")}`.toLowerCase();

const getWrappedFirebaseErrorCode = (error) =>
  String(error?.code || error?.originalError?.code || error?.cause?.code || "").toLowerCase();

const getWrappedFirebaseErrorText = (error) =>
  [
    error?.message,
    error?.customData?.serverResponse,
    error?.originalError?.message,
    error?.originalError?.customData?.serverResponse,
    error?.cause?.message,
    error?.cause?.customData?.serverResponse,
  ]
    .map((value) => String(value || ""))
    .join(" ")
    .toLowerCase();

const getLocalFirebaseHint = () => {
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  return isLocal ? " Estás probando en local conectado a Firebase real." : "";
};

const withFirebaseStage = (stage, error) => {
  const wrapped = new Error(error?.message || "Firebase rechazó la operación.");
  wrapped.stage = stage;
  wrapped.code = error?.code || "";
  wrapped.originalError = error;
  return wrapped;
};

const getLoadErrorMessage = (error) => {
  const code = getFirebaseErrorCode(error);
  const text = getFirebaseErrorText(error);
  if (code.includes("permission-denied")) {
    return "No pudimos cargar las publicaciones por permisos de Firebase.";
  }
  if (code.includes("failed-precondition") || text.includes("index")) {
    return "No pudimos cargar las publicaciones porque falta el índice de Firestore.";
  }
  if (code.includes("unavailable") || text.includes("network")) {
    return "No pudimos conectar con Firebase. Revisá la conexión e intentá nuevamente.";
  }
  return "No pudimos cargar las publicaciones. Reintentá en unos segundos.";
};

const getUploadErrorMessage = (error) => {
  const code = getWrappedFirebaseErrorCode(error);
  const text = getWrappedFirebaseErrorText(error);
  const hint = getLocalFirebaseHint();
  if (error?.stage === "storage-upload") {
    if (code.includes("storage/unauthorized")) {
      return `No pudimos subir la imagen a Storage porque Firebase rechazó el archivo o la sesión.${hint}`;
    }
    return `No pudimos subir la imagen a Storage. Verificá que sea una imagen válida menor a 25 MB.${hint}`;
  }
  if (error?.stage === "storage-url") {
    return `La imagen se subió, pero no pudimos obtener la URL pública desde Storage.${hint}`;
  }
  if (error?.stage === "firestore-create") {
    return `La imagen se subió, pero Firestore rechazó guardar la publicación.${hint}`;
  }
  if (error?.stage === "firestore-update") {
    return `La imagen se subió, pero Firestore rechazó actualizar la publicación.${hint}`;
  }
  if (code.includes("storage/unauthorized") || code.includes("permission-denied")) {
    return `No pudimos guardar la foto porque Firebase rechazó la operación.${hint}`;
  }
  if (code.includes("storage/quota-exceeded")) {
    return "No pudimos guardar la foto porque Storage alcanzó su cuota.";
  }
  if (code.includes("storage/retry-limit-exceeded") || code.includes("unavailable") || text.includes("network")) {
    return "No pudimos completar la carga por un problema de conexión.";
  }
  if (text.includes("imagen") || text.includes("image") || text.includes("file")) {
    return "No pudimos leer la imagen. Verificá que sea válida y no supere 25 MB.";
  }
  return `No pudimos guardar la foto. Revisá permisos, imagen e intentá nuevamente.${hint}`;
};

const getCommentErrorMessage = (error) => {
  const code = getWrappedFirebaseErrorCode(error);
  const text = getWrappedFirebaseErrorText(error);
  const hint = getLocalFirebaseHint();
  if (code.includes("permission-denied")) {
    return `Firebase rechazó guardar el comentario por permisos.${hint}`;
  }
  if (code.includes("failed-precondition") || text.includes("index")) {
    return "No pudimos cargar los comentarios porque falta un índice de Firestore.";
  }
  if (code.includes("unavailable") || text.includes("network")) {
    return "No pudimos conectar con Firebase. Revisá la conexión e intentá nuevamente.";
  }
  return `No pudimos guardar el comentario. Revisá permisos o conexión e intentá nuevamente.${hint}`;
};

const getCommentLoadErrorMessage = (error) => {
  const code = getWrappedFirebaseErrorCode(error);
  const text = getWrappedFirebaseErrorText(error);
  const hint = getLocalFirebaseHint();
  if (code.includes("permission-denied")) {
    return `No pudimos cargar los comentarios por permisos de Firebase.${hint}`;
  }
  if (code.includes("failed-precondition") || text.includes("index")) {
    return "No pudimos cargar los comentarios porque falta un índice de Firestore.";
  }
  if (code.includes("unavailable") || text.includes("network")) {
    return "No pudimos conectar con Firebase para cargar comentarios.";
  }
  return `No pudimos cargar los comentarios.${hint}`;
};

const setEmptyVisible = (visible) => {
  if (els.empty) els.empty.hidden = !visible;
};

const clearCommentSubscriptions = () => {
  commentUnsubs.forEach((unsubscribe) => unsubscribe());
  commentUnsubs.clear();
  commentsByKey.clear();
  activeReplyDrafts.clear();
};

const loadPosts = async ({ reset = false } = {}) => {
  if (!els.feed || isLoading || (!hasMore && !reset)) return;
  isLoading = true;
  showError("");
  if (els.loadMore) {
    els.loadMore.disabled = true;
    els.loadMore.textContent = reset ? "Cargando..." : "Cargando más...";
  }
  if (reset) {
    lastDoc = null;
    hasMore = true;
    postsById.clear();
    clearCommentSubscriptions();
    els.feed.innerHTML = "";
    setEmptyVisible(false);
  }
  try {
    const base = [
      collection(db, POSTS_COLLECTION),
      where("type", "==", HOBBIES_TYPE),
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE),
    ];
    const q = lastDoc ? query(...base, startAfter(lastDoc)) : query(...base);
    const snap = await getDocs(q);
    const posts = snap.docs.map(mapPost).filter((post) => post.imageUrl);
    posts.forEach((post) => {
      const currentPostCount = els.feed.querySelectorAll(".team-hobby-post").length;
      if (currentPostCount > 0) {
        els.feed.appendChild(renderPostSeparator());
      }
      postsById.set(post.id, post);
      const article = renderPost(post, currentPostCount);
      els.feed.appendChild(article);
      subscribeComments(post.id, article);
    });
    hydrateAvatars(els.feed).catch(() => {});
    if (snap.docs.length) lastDoc = snap.docs[snap.docs.length - 1];
    hasMore = snap.docs.length === PAGE_SIZE;
    setEmptyVisible(els.feed.querySelectorAll(".team-hobby-post").length === 0);
  } catch (error) {
    console.error("[Intereses y Hobbies] No se pudo cargar", error);
    showError(getLoadErrorMessage(error));
  } finally {
    isLoading = false;
    if (els.loadMore) {
      els.loadMore.hidden = !hasMore;
      els.loadMore.disabled = false;
      els.loadMore.textContent = "Cargar más publicaciones";
    }
    if (window.lucide) window.lucide.createIcons();
  }
};

function subscribeComments(postId, article) {
  if (commentUnsubs.has(postId)) return;
  const list = $("[data-comments-list]", article);
  const countEls = $$("[data-comment-count]", article);
  const commentsQuery = collection(db, POSTS_COLLECTION, postId, COMMENTS_COLLECTION);
  const unsubscribe = onSnapshot(
    commentsQuery,
    (snap) => {
      const comments = sortCommentsForRender(snap.docs.map(mapComment));
      const liveKeys = new Set(comments.map((comment) => `${postId}:${comment.id}`));
      commentsByKey.forEach((_, key) => {
        if (key.startsWith(`${postId}:`) && !liveKeys.has(key)) commentsByKey.delete(key);
      });
      comments.forEach((comment) => {
        commentsByKey.set(`${postId}:${comment.id}`, comment);
      });
      const activeCommentCount = comments.filter((comment) => !comment.deleted).length;
      if (list) {
        list.innerHTML = comments.length
          ? renderCommentsTree(comments)
          : '<div class="art-empty">Sin comentarios todavía.</div>';
        const activeReply = activeReplyDrafts.get(postId);
        if (activeReply?.parentCommentId && commentsByKey.has(`${postId}:${activeReply.parentCommentId}`)) {
          openReplyForm(article, activeReply.parentCommentId, {
            text: activeReply.text || "",
            focus: false,
            preserveDraft: true,
          });
        }
      }
      countEls.forEach((el) => {
        el.textContent = String(activeCommentCount);
      });
      const post = postsById.get(postId);
      if (post) {
        post.commentCount = activeCommentCount;
        postsById.set(postId, post);
      }
      if (window.lucide) window.lucide.createIcons();
    },
    (error) => {
      console.error("[Intereses y Hobbies] No se pudieron cargar comentarios", error);
      if (list) {
        list.innerHTML = `<div class="art-error">${escapeHtml(getCommentLoadErrorMessage(error))}</div>`;
      }
    },
  );
  commentUnsubs.set(postId, unsubscribe);
}

const handleLike = async (article) => {
  const postId = article?.dataset?.postId || "";
  const button = $('[data-action="like"]', article);
  const count = $("[data-like-count]", article);
  if (!postId || !button) return;
  button.disabled = true;
  try {
    const result = await toggleCarouselLikeForCurrentUser(postId);
    if (!result.ok) throw new Error(result.reason || "like_failed");
    const likedBy = Array.isArray(result.likedBy) ? result.likedBy : [];
    const likedNames = Array.isArray(result.likedNames) ? result.likedNames : [];
    const post = postsById.get(postId);
    if (post) {
      post.likedBy = likedBy;
      post.likedNames = likedNames;
      post.likesCount = result.likesCount || 0;
      postsById.set(postId, post);
    }
    button.classList.toggle("is-active", Boolean(result.liked));
    button.setAttribute("aria-pressed", String(Boolean(result.liked)));
    button.setAttribute("aria-label", result.liked ? "Quitar me gusta de esta foto" : "Dar me gusta a esta foto");
    if (count) count.textContent = String(result.likesCount || 0);
    const tooltip = $(".team-hobby-like-tooltip", button);
    if (tooltip) tooltip.textContent = formatLikeNames(likedNames);
  } catch (error) {
    console.error("[Intereses y Hobbies] No se pudo alternar like", error);
  } finally {
    button.disabled = false;
  }
};

const handleCommentLike = async (article, commentId) => {
  const postId = article?.dataset?.postId || "";
  const commentEl = $$(".team-hobby-comment", article).find(
    (node) => node.dataset.commentId === commentId
  );
  const button = $('[data-comment-action="like"]', commentEl);
  if (!postId || !commentId || !button) return;
  button.disabled = true;
  try {
    const result = await toggleCarouselCommentLikeForCurrentUser({ postId, commentId });
    if (!result.ok) throw new Error(result.reason || "comment_like_failed");
    const likedBy = normalizeLikedByMap(result.likedBy);
    const comment = commentsByKey.get(`${postId}:${commentId}`);
    if (comment) {
      comment.likedBy = likedBy;
      commentsByKey.set(`${postId}:${commentId}`, comment);
    }
    button.classList.toggle("is-active", Boolean(result.liked));
    button.setAttribute("aria-pressed", String(Boolean(result.liked)));
    const count = $("[data-comment-like-count]", button);
    if (count) count.textContent = String(result.likesCount || 0);
    const tooltip = $(".team-hobby-comment-like-tooltip", button);
    if (tooltip) tooltip.textContent = formatCommentLikeNames(likedBy);
  } catch (error) {
    console.error("[Intereses y Hobbies] No se pudo alternar like del comentario", error);
  } finally {
    button.disabled = false;
  }
};

const handleCommentSubmit = async (event, article) => {
  event.preventDefault();
  const postId = article?.dataset?.postId || "";
  const form = event.target.closest("[data-comment-form]");
  const input = $(".team-hobby-comment-input", article);
  const submit = $(".team-hobby-comment-submit", article);
  const errorBox = $(".team-hobby-comment-error", form || article);
  const text = cleanString(input?.value, 800);
  if (errorBox) {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }
  if (!postId || !currentUser) return;
  if (!text) {
    if (errorBox) {
      errorBox.textContent = "Escribí un comentario antes de enviarlo.";
      errorBox.hidden = false;
    }
    return;
  }
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Enviando...";
  }
  try {
    const commentRef = doc(collection(db, POSTS_COLLECTION, postId, COMMENTS_COLLECTION));
    await setDoc(commentRef, {
      text,
      authorUid: currentUser.uid,
      authorName: formatDisplayName(currentUser),
      createdAt: serverTimestamp(),
      likedBy: {},
      parentCommentId: null,
      rootCommentId: commentRef.id,
      replyDepth: 0,
      replyToCommentId: null,
      replyToAuthorName: "",
      deleted: false,
      deletedAt: null,
      deletedBy: "",
    });
    if (input) input.value = "";
    const list = $("[data-comments-list]", article);
    if (list) window.setTimeout(() => {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }, 80);
  } catch (error) {
    console.error("[Intereses y Hobbies] No se pudo comentar", error);
    if (errorBox) {
      errorBox.textContent = getCommentErrorMessage(error);
      errorBox.hidden = false;
    }
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = "Enviar comentario";
    }
  }
};

const closeReplyForms = (article) => {
  $$("[data-reply-form]", article).forEach((form) => form.remove());
};

const openReplyForm = (article, commentId, options = {}) => {
  const postId = article?.dataset?.postId || "";
  const comment = commentsByKey.get(`${postId}:${commentId}`);
  if (!comment || comment.deleted || !currentUser) return;
  const commentEl = $$(".team-hobby-comment", article).find((node) => node.dataset.commentId === commentId);
  const currentDepth = Math.min(Number(commentEl?.dataset?.replyDepth ?? comment.replyDepth) || 0, 2);
  if (currentDepth >= 2) return;
  const slot = $("[data-reply-slot]", commentEl);
  if (!slot) return;
  closeReplyForms(article);
  const form = document.createElement("form");
  form.className = "team-hobby-reply-form";
  form.dataset.replyForm = "true";
  form.dataset.parentCommentId = commentId;
  form.dataset.parentDepth = String(currentDepth);
  form.innerHTML = `
    <textarea class="team-hobby-reply-input" rows="2" maxlength="800" placeholder="Responder a ${escapeHtml(comment.authorName || "Usuario")}..." aria-label="Responder comentario"></textarea>
    <div class="team-hobby-reply-error" role="alert" hidden></div>
    <div class="team-hobby-reply-form__actions">
      <button class="team-hobby-reply-cancel" type="button" data-reply-cancel>Cancelar</button>
      <button class="team-hobby-reply-submit" type="submit">Responder</button>
    </div>
  `;
  slot.appendChild(form);
  const input = $(".team-hobby-reply-input", form);
  if (input && options.text) input.value = cleanString(options.text, 800);
  if (options.preserveDraft !== false) {
    activeReplyDrafts.set(postId, {
      parentCommentId: commentId,
      text: input?.value || "",
    });
  }
  if (input) {
    input.addEventListener("input", () => {
      activeReplyDrafts.set(postId, {
        parentCommentId: commentId,
        text: input.value || "",
      });
    });
  }
  if (options.focus !== false) input?.focus();
};

const handleReplySubmit = async (event, article, form) => {
  event.preventDefault();
  const postId = article?.dataset?.postId || "";
  const parentCommentId = form?.dataset?.parentCommentId || "";
  const parentComment = commentsByKey.get(`${postId}:${parentCommentId}`);
  const input = $(".team-hobby-reply-input", form);
  const submit = $(".team-hobby-reply-submit", form);
  const cancel = $(".team-hobby-reply-cancel", form);
  const errorBox = $(".team-hobby-reply-error", form);
  const text = cleanString(input?.value, 800);
  if (errorBox) {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }
  if (!postId || !parentCommentId || !parentComment || parentComment.deleted || !text || !currentUser) return;
  const parentEl = $$(".team-hobby-comment", article).find((node) => node.dataset.commentId === parentCommentId);
  const parentDepth = Math.min(
    Number(parentEl?.dataset?.replyDepth ?? form?.dataset?.parentDepth ?? parentComment.replyDepth) || 0,
    2
  );
  if (parentDepth >= 2) return;
  if (submit) submit.disabled = true;
  if (cancel) cancel.disabled = true;
  try {
    const replyRef = doc(collection(db, POSTS_COLLECTION, postId, COMMENTS_COLLECTION));
    await setDoc(replyRef, {
      text,
      authorUid: currentUser.uid,
      authorName: formatDisplayName(currentUser),
      createdAt: serverTimestamp(),
      likedBy: {},
      parentCommentId,
      rootCommentId: parentDepth === 0 ? parentComment.id : parentComment.rootCommentId || parentComment.id,
      replyDepth: parentDepth + 1,
      replyToCommentId: parentCommentId,
      replyToAuthorName: parentComment.authorName || "Usuario",
      deleted: false,
      deletedAt: null,
      deletedBy: "",
    });
    activeReplyDrafts.delete(postId);
    form.remove();
    const list = $("[data-comments-list]", article);
    if (list) window.setTimeout(() => {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }, 80);
  } catch (error) {
    console.error("[Intereses y Hobbies] No se pudo responder el comentario", error);
    if (errorBox) {
      errorBox.textContent = getCommentErrorMessage(error);
      errorBox.hidden = false;
    }
  } finally {
    if (submit) submit.disabled = false;
    if (cancel) cancel.disabled = false;
  }
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

let floatingLikeTooltip = null;

const getFloatingLikeTooltip = () => {
  if (floatingLikeTooltip) return floatingLikeTooltip;
  floatingLikeTooltip = document.createElement("div");
  floatingLikeTooltip.className = "team-hobbies-floating-like-tooltip";
  floatingLikeTooltip.setAttribute("role", "tooltip");
  floatingLikeTooltip.hidden = true;
  document.body.appendChild(floatingLikeTooltip);
  return floatingLikeTooltip;
};

const clearFloatingLikeTooltips = () => {
  const tooltip = floatingLikeTooltip;
  if (tooltip) {
    tooltip.hidden = true;
    tooltip.classList.remove("is-open", "is-flipped");
    tooltip.textContent = "";
    tooltip.style.removeProperty("--team-hobby-like-arrow-left");
    tooltip.style.left = "";
    tooltip.style.top = "";
  }
  document.querySelectorAll(".team-hobby-action--like.is-open, .team-hobby-comment-like.is-open")
    .forEach((button) => button.classList.remove("is-open"));
};

const positionLikeTooltip = (button) => {
  if (!button) return;
  const sourceTooltip = $(".team-hobby-like-tooltip, .team-hobby-comment-like-tooltip", button);
  const text = cleanString(sourceTooltip?.textContent || "", 220);
  if (!text) return;
  const tooltip = getFloatingLikeTooltip();
  tooltip.textContent = text;
  tooltip.hidden = false;
  tooltip.classList.add("is-open");
  tooltip.classList.remove("is-flipped");
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";
  tooltip.style.setProperty("--team-hobby-like-arrow-left", "50%");
  const rect = button.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const width = tooltipRect.width || tooltip.offsetWidth || 180;
  const height = tooltipRect.height || tooltip.offsetHeight || 48;
  const gutter = 10;
  const fitsAbove = rect.top - height - gutter >= gutter;
  const top = fitsAbove ? rect.top - height - gutter : rect.bottom + gutter;
  const left = clamp(rect.left + rect.width / 2 - width / 2, gutter, window.innerWidth - width - gutter);
  const arrowLeft = clamp(rect.left + rect.width / 2 - left - 5, 12, width - 18);
  clearFloatingLikeTooltips();
  button.classList.add("is-open");
  tooltip.textContent = text;
  tooltip.hidden = false;
  tooltip.classList.add("is-open");
  tooltip.classList.toggle("is-flipped", !fitsAbove);
  tooltip.style.top = `${Math.round(top)}px`;
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.setProperty("--team-hobby-like-arrow-left", `${Math.round(arrowLeft)}px`);
};

const openLightbox = (article) => {
  const postId = article?.dataset?.postId || "";
  const post = postsById.get(postId);
  const image = $(".team-hobby-media img", article);
  const source = image?.dataset?.full || image?.src || post?.imageUrl || "";
  if (!source || !els.lightbox || !els.lightboxImg) return;
  activeLightboxTrigger = document.activeElement;
  els.lightboxImg.src = source;
  els.lightboxImg.alt = post?.title || image?.alt || "Foto compartida";
  if (els.lightboxTitle) els.lightboxTitle.textContent = post?.title || "";
  if (els.lightboxDescription) {
    els.lightboxDescription.textContent = post?.description || "";
    els.lightboxDescription.hidden = !post?.description;
  }
  if (els.lightboxLikes) els.lightboxLikes.textContent = String(post?.likesCount || 0);
  if (els.lightboxComments) els.lightboxComments.textContent = String(post?.commentCount || 0);
  els.lightbox.hidden = false;
  els.lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("team-hobbies-lightbox-open");
  if (window.lucide) window.lucide.createIcons();
  window.setTimeout(() => els.lightboxClose?.focus(), 0);
};

const closeLightbox = () => {
  if (!els.lightbox) return;
  els.lightbox.hidden = true;
  els.lightbox.setAttribute("aria-hidden", "true");
  if (els.lightboxImg) {
    els.lightboxImg.removeAttribute("src");
    els.lightboxImg.alt = "";
  }
  document.body.classList.remove("team-hobbies-lightbox-open");
  if (activeLightboxTrigger && typeof activeLightboxTrigger.focus === "function") {
    activeLightboxTrigger.focus();
  }
  activeLightboxTrigger = null;
};

const resetUploadCropState = ({ clearPreview = true } = {}) => {
  if (uploadCropState?.objectUrl) {
    URL.revokeObjectURL(uploadCropState.objectUrl);
  }
  uploadCropState = null;
  if (clearPreview && els.preview) {
    els.preview.innerHTML = "<span>Vista previa de la foto</span>";
    els.preview.classList.remove("has-cropper", "has-error", "is-loading");
  }
};

const resetEditCropState = ({ clearPreview = true } = {}) => {
  if (editCropState?.objectUrl && editCropState.revokeObjectUrl) {
    URL.revokeObjectURL(editCropState.objectUrl);
  }
  editCropState = null;
  if (clearPreview && els.editPreview) {
    els.editPreview.innerHTML = "<span>Preparando imagen actual...</span>";
    els.editPreview.classList.remove("has-cropper", "has-error", "is-loading");
  }
};

const clampCropCenter = (state = uploadCropState) => {
  if (!state) return;
  const cropWidth = state.width / state.zoom;
  const cropHeight = state.height / state.zoom;
  state.centerX = clamp(state.centerX, cropWidth / 2, state.width - cropWidth / 2);
  state.centerY = clamp(state.centerY, cropHeight / 2, state.height - cropHeight / 2);
};

const updateCropperView = (state = uploadCropState) => {
  if (!state?.viewport || !state?.previewImg) return;
  clampCropCenter(state);
  const rect = state.viewport.getBoundingClientRect();
  const cropWidth = state.width / state.zoom;
  const cropHeight = state.height / state.zoom;
  const translateX = -((state.centerX - state.width / 2) / cropWidth) * rect.width;
  const translateY = -((state.centerY - state.height / 2) / cropHeight) * rect.height;
  state.previewImg.style.setProperty("--crop-zoom", String(state.zoom));
  state.previewImg.style.setProperty("--crop-x", `${translateX}px`);
  state.previewImg.style.setProperty("--crop-y", `${translateY}px`);
  if (state.zoomInput) state.zoomInput.value = String(state.zoom);
  if (state.status) {
    state.status.textContent = state.applied
      ? "Recorte confirmado"
      : `${state.width} x ${state.height}px`;
  }
};

const resetCropperView = (state = uploadCropState) => {
  if (!state) return;
  state.zoom = MIN_CROP_ZOOM;
  state.centerX = state.width / 2;
  state.centerY = state.height / 2;
  state.applied = false;
  updateCropperView(state);
};

const processCropToBlob = () =>
  new Promise((resolve, reject) => {
    const state = uploadCropState;
    if (!state?.image) {
      reject(new Error("No hay una imagen seleccionada."));
      return;
    }
    clampCropCenter(state);
    const cropWidth = state.width / state.zoom;
    const cropHeight = state.height / state.zoom;
    const sourceX = clamp(state.centerX - cropWidth / 2, 0, state.width - cropWidth);
    const sourceY = clamp(state.centerY - cropHeight / 2, 0, state.height - cropHeight);
    const outputScale = Math.min(1, MAX_PROCESSED_IMAGE_SIDE / Math.max(cropWidth, cropHeight));
    const outputWidth = Math.max(1, Math.round(cropWidth * outputScale));
    const outputHeight = Math.max(1, Math.round(cropHeight * outputScale));
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      reject(new Error("No se pudo preparar la imagen."));
      return;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.drawImage(state.image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, outputWidth, outputHeight);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("No se pudo procesar la imagen."));
          return;
        }
        resolve({
          blob,
          meta: {
            width: outputWidth,
            height: outputHeight,
            imageAspect: getImageAspect(outputWidth, outputHeight),
          },
        });
      },
      "image/jpeg",
      PROCESSED_IMAGE_QUALITY,
    );
  });

const attachCropperPointerHandlers = (viewport, state) => {
  if (!viewport) return;
  let drag = null;
  viewport.addEventListener("pointerdown", (event) => {
    if (!state || event.button !== 0) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      centerX: state.centerX,
      centerY: state.centerY,
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-dragging");
    state.applied = false;
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!drag || !state || drag.pointerId !== event.pointerId) return;
    const rect = viewport.getBoundingClientRect();
    const cropWidth = state.width / state.zoom;
    const cropHeight = state.height / state.zoom;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    state.centerX = drag.centerX - (dx / Math.max(rect.width, 1)) * cropWidth;
    state.centerY = drag.centerY - (dy / Math.max(rect.height, 1)) * cropHeight;
    updateCropperView(state);
  });
  const endDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    viewport.releasePointerCapture(event.pointerId);
    viewport.classList.remove("is-dragging");
    drag = null;
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);
};

const renderCropper = ({
  mode = "upload",
  container = els.preview,
  file = null,
  image,
  objectUrl,
  width,
  height,
  imageAspect,
  initialCrop = DEFAULT_IMAGE_CROP,
  label = "",
  revokeObjectUrl = true,
}) => {
  if (!container) return;
  if (mode === "edit") resetEditCropState({ clearPreview: false });
  else resetUploadCropState({ clearPreview: false });
  const fileLabel = escapeHtml(file?.name || "foto seleccionada");
  const displayLabel = escapeHtml(label || file?.name || "Foto actual");
  const frameRatio = getCropperFrameRatio({ width, height, imageAspect });
  const orientationClass = getCropperOrientationClass(imageAspect);
  container.classList.add("has-cropper");
  container.classList.remove("has-error", "is-loading");
  container.innerHTML = `
    <div class="team-hobbies-cropper ${orientationClass}" data-orientation="${escapeHtml(imageAspect)}">
      <div class="team-hobbies-cropper__viewport" data-crop-viewport tabindex="0" aria-label="Previsualización ajustable de la foto" style="--crop-ratio: ${frameRatio};">
        <img class="team-hobbies-cropper__image" src="${escapeHtml(objectUrl)}" alt="Vista previa de ${fileLabel}" draggable="false" />
      </div>
      <div class="team-hobbies-cropper__meta">
        <span>${displayLabel}</span>
        <span data-crop-status>${width} x ${height}px</span>
      </div>
      <div class="team-hobbies-cropper__controls">
        <label class="team-hobbies-cropper__zoom">
          <span>Zoom</span>
          <input id="team-hobbies-crop-zoom" type="range" min="${MIN_CROP_ZOOM}" max="${MAX_CROP_ZOOM}" step="0.01" value="${MIN_CROP_ZOOM}" aria-label="Zoom de recorte" />
        </label>
        <button id="team-hobbies-crop-reset" class="team-hobbies-cropper__button" type="button">Restaurar</button>
        <button id="team-hobbies-crop-apply" class="team-hobbies-cropper__button team-hobbies-cropper__button--primary" type="button">Confirmar recorte</button>
      </div>
    </div>
  `;
  const crop = normalizeImageCrop(initialCrop);
  const state = {
    mode,
    file,
    image,
    objectUrl,
    revokeObjectUrl,
    width,
    height,
    imageAspect,
    zoom: crop.zoom,
    centerX: width / 2 + crop.offsetX * width,
    centerY: height / 2 + crop.offsetY * height,
    applied: false,
    viewport: $("[data-crop-viewport]", container),
    previewImg: $(".team-hobbies-cropper__image", container),
    zoomInput: $("#team-hobbies-crop-zoom", container),
    status: $("[data-crop-status]", container),
  };
  if (mode === "edit") editCropState = state;
  else uploadCropState = state;
  state.zoomInput?.addEventListener("input", (event) => {
    state.zoom = clamp(Number(event.target.value) || MIN_CROP_ZOOM, MIN_CROP_ZOOM, MAX_CROP_ZOOM);
    state.applied = false;
    updateCropperView(state);
  });
  $("#team-hobbies-crop-reset", container)?.addEventListener("click", () => resetCropperView(state));
  $("#team-hobbies-crop-apply", container)?.addEventListener("click", () => {
    state.applied = true;
    updateCropperView(state);
  });
  attachCropperPointerHandlers(state.viewport, state);
  updateCropperView(state);
};

const openModal = () => {
  if (!els.modal) return;
  els.modal.hidden = false;
  els.modal.setAttribute("aria-hidden", "false");
  $("#team-hobbies-title")?.focus();
};

const closeModal = () => {
  if (!els.modal) return;
  els.modal.hidden = true;
  els.modal.setAttribute("aria-hidden", "true");
  els.form?.reset();
  resetUploadCropState();
  setFormError("");
};

const setFieldValue = (selector, value = "") => {
  const field = $(selector);
  if (field) field.value = value || "";
};

const renderEditImageCropper = async (post) => {
  if (!els.editPreview || !post?.imageUrl) return;
  resetEditCropState({ clearPreview: false });
  els.editPreview.classList.add("is-loading");
  els.editPreview.classList.remove("has-error", "has-cropper");
  els.editPreview.innerHTML = "<span>Preparando imagen actual...</span>";
  try {
    const meta = await loadImageUrlForCrop(post.imageUrl);
    if (editPostId !== post.id) return;
    renderCropper({
      mode: "edit",
      container: els.editPreview,
      file: null,
      label: post.imageOriginalName || "Foto actual",
      initialCrop: post.imageCrop,
      revokeObjectUrl: false,
      ...meta,
    });
  } catch (error) {
    console.warn("[Intereses y Hobbies] No se pudo preparar la imagen para editar", error);
    els.editPreview.classList.add("has-error");
    els.editPreview.classList.remove("is-loading", "has-cropper");
    els.editPreview.innerHTML = "<span>No pudimos preparar la imagen actual. Podés cambiar la foto o guardar solo texto.</span>";
  }
};

const openPostEditModal = (postId) => {
  const post = postsById.get(postId);
  if (!post || !canManageItem(post) || !els.editModal) return;
  editPostId = postId;
  setFieldValue("#team-hobbies-edit-title-input", post.title);
  setFieldValue("#team-hobbies-edit-description", post.description);
  if (els.editFile) els.editFile.value = "";
  setEditError("");
  els.editModal.hidden = false;
  els.editModal.setAttribute("aria-hidden", "false");
  renderEditImageCropper(post);
  window.setTimeout(() => $("#team-hobbies-edit-title-input")?.focus(), 0);
};

const closePostEditModal = () => {
  editPostId = "";
  if (!els.editModal) return;
  els.editModal.hidden = true;
  els.editModal.setAttribute("aria-hidden", "true");
  els.editForm?.reset();
  resetEditCropState();
  setEditError("");
  if (els.editSave) {
    els.editSave.disabled = false;
    els.editSave.textContent = "Guardar cambios";
  }
};

const requestPostEdit = async (postId) => {
  const post = postsById.get(postId);
  if (!post || !canManageItem(post)) return;
  const success = await confirmSensitiveAction({
    title: "Editar publicación",
    message: "Ingresá tu contraseña para editar esta publicación.",
    confirmText: "Continuar",
    run: async () => {},
  });
  if (success) openPostEditModal(postId);
};

const openCommentEditModal = (postId, commentId) => {
  const comment = commentsByKey.get(`${postId}:${commentId}`);
  if (!comment || comment.deleted || !canManageItem(comment) || !els.commentEditModal) return;
  editCommentRef = { postId, commentId };
  setFieldValue("#team-hobbies-comment-edit-text", comment.text);
  setCommentEditError("");
  els.commentEditModal.hidden = false;
  els.commentEditModal.setAttribute("aria-hidden", "false");
  $("#team-hobbies-comment-edit-text")?.focus();
};

const closeCommentEditModal = () => {
  editCommentRef = null;
  if (!els.commentEditModal) return;
  els.commentEditModal.hidden = true;
  els.commentEditModal.setAttribute("aria-hidden", "true");
  els.commentEditForm?.reset();
  setCommentEditError("");
  if (els.commentEditSave) {
    els.commentEditSave.disabled = false;
    els.commentEditSave.textContent = "Guardar comentario";
  }
};

const requestCommentEdit = async (postId, commentId) => {
  const comment = commentsByKey.get(`${postId}:${commentId}`);
  if (!comment || comment.deleted || !canManageItem(comment)) return;
  const success = await confirmSensitiveAction({
    title: "Editar comentario",
    message: "Ingresá tu contraseña para editar este comentario.",
    confirmText: "Continuar",
    run: async () => {},
  });
  if (success) openCommentEditModal(postId, commentId);
};

const setFormError = (message = "") => {
  if (!els.formError) return;
  els.formError.hidden = !message;
  els.formError.textContent = message;
};

const setEditError = (message = "") => {
  if (!els.editError) return;
  els.editError.hidden = !message;
  els.editError.textContent = message;
};

const setCommentEditError = (message = "") => {
  if (!els.commentEditError) return;
  els.commentEditError.hidden = !message;
  els.commentEditError.textContent = message;
};

const setAuthError = (message = "") => {
  if (!els.authError) return;
  els.authError.hidden = !message;
  els.authError.textContent = message;
};

const getActionErrorMessage = (error) => {
  const code = getFirebaseErrorCode(error);
  const text = getFirebaseErrorText(error);
  if (
    code.includes("auth/wrong-password") ||
    code.includes("auth/invalid-credential") ||
    code.includes("auth/invalid-login-credentials")
  ) {
    return "La contraseña ingresada no es correcta.";
  }
  if (code.includes("permission-denied")) return "No tenés permisos para realizar esta acción.";
  if (code.includes("not-found") || text.includes("not found")) return "El contenido ya no está disponible.";
  if (code.includes("unavailable") || text.includes("network")) {
    return "No pudimos conectar con Firebase. Revisá la conexión e intentá nuevamente.";
  }
  return "No pudimos completar la acción. Intentá nuevamente.";
};

const closeAuthModal = (result = false) => {
  const state = authActionState;
  authActionState = null;
  if (els.authModal) {
    els.authModal.hidden = true;
    els.authModal.setAttribute("aria-hidden", "true");
  }
  els.authForm?.reset();
  setAuthError("");
  if (els.authConfirm) {
    els.authConfirm.disabled = false;
    els.authConfirm.textContent = "Confirmar";
  }
  if (typeof state?.resolve === "function") state.resolve(result);
};

const confirmSensitiveAction = ({ title, message, confirmText, run }) =>
  new Promise((resolve) => {
    if (!currentUser?.email) {
      showError("No pudimos confirmar la contraseña porque la sesión no tiene email disponible.");
      resolve(false);
      return;
    }
    const providerIds = (currentUser.providerData || []).map((provider) => provider.providerId);
    if (!providerIds.includes("password")) {
      showError("Tu método de ingreso no usa contraseña. Reautenticá desde tu proveedor para continuar.");
      resolve(false);
      return;
    }
    authActionState = { run, resolve, confirmText: confirmText || "Confirmar" };
    if (els.authTitle) els.authTitle.textContent = title || "Confirmar contraseña";
    if (els.authMessage) els.authMessage.textContent = message || "Ingresá tu contraseña para continuar.";
    if (els.authConfirm) els.authConfirm.textContent = confirmText || "Confirmar";
    setAuthError("");
    els.authForm?.reset();
    if (els.authModal) {
      els.authModal.hidden = false;
      els.authModal.setAttribute("aria-hidden", "false");
    }
    window.setTimeout(() => els.authPassword?.focus(), 0);
  });

const handleAuthSubmit = async (event) => {
  event.preventDefault();
  if (!authActionState?.run || !currentUser?.email) return;
  const password = els.authPassword?.value || "";
  if (!password) {
    setAuthError("Ingresá tu contraseña para continuar.");
    return;
  }
  if (els.authConfirm) {
    els.authConfirm.disabled = true;
    els.authConfirm.textContent = "Confirmando...";
  }
  try {
    const credential = EmailAuthProvider.credential(currentUser.email, password);
    await reauthenticateWithCredential(currentUser, credential);
    await authActionState.run();
    closeAuthModal(true);
  } catch (error) {
    console.warn("[Intereses y Hobbies] Acción protegida falló", error);
    setAuthError(getActionErrorMessage(error));
    if (els.authConfirm) {
      els.authConfirm.disabled = false;
      els.authConfirm.textContent = authActionState?.confirmText || "Confirmar";
    }
  }
};

const handleFilePreview = async () => {
  const file = els.file?.files?.[0];
  if (!els.preview) return;
  resetUploadCropState({ clearPreview: false });
  if (!file) {
    resetUploadCropState();
    return;
  }
  if (!file.type.startsWith("image/")) {
    els.preview.classList.add("has-error");
    els.preview.classList.remove("has-cropper", "is-loading");
    els.preview.innerHTML = "<span>Seleccioná un archivo de imagen válido.</span>";
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    els.preview.classList.add("has-error");
    els.preview.classList.remove("has-cropper", "is-loading");
    els.preview.innerHTML = "<span>La foto supera el tamaño permitido de 25 MB.</span>";
    return;
  }
  els.preview.classList.add("is-loading");
  els.preview.classList.remove("has-error", "has-cropper");
  els.preview.innerHTML = "<span>Preparando vista previa...</span>";
  try {
    const meta = await loadImageFile(file);
    if (els.file?.files?.[0] !== file) {
      URL.revokeObjectURL(meta.objectUrl);
      return;
    }
    renderCropper({
      mode: "upload",
      container: els.preview,
      file,
      label: file.name,
      revokeObjectUrl: true,
      ...meta,
    });
  } catch (error) {
    console.error("[Intereses y Hobbies] No se pudo previsualizar la imagen", error);
    els.preview.classList.add("has-error");
    els.preview.classList.remove("is-loading", "has-cropper");
    els.preview.innerHTML = "<span>No pudimos leer la imagen seleccionada.</span>";
  }
};

const handleEditFilePreview = async () => {
  const file = els.editFile?.files?.[0];
  if (!els.editPreview) return;
  if (!file) {
    const post = postsById.get(editPostId);
    if (post) renderEditImageCropper(post);
    return;
  }
  resetEditCropState({ clearPreview: false });
  if (!file.type.startsWith("image/")) {
    els.editPreview.classList.add("has-error");
    els.editPreview.classList.remove("has-cropper", "is-loading");
    els.editPreview.innerHTML = "<span>Seleccioná un archivo de imagen válido.</span>";
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    els.editPreview.classList.add("has-error");
    els.editPreview.classList.remove("has-cropper", "is-loading");
    els.editPreview.innerHTML = "<span>La foto supera el tamaño permitido de 25 MB.</span>";
    return;
  }
  els.editPreview.classList.add("is-loading");
  els.editPreview.classList.remove("has-error", "has-cropper");
  els.editPreview.innerHTML = "<span>Preparando nueva foto...</span>";
  try {
    const meta = await loadImageFile(file);
    if (els.editFile?.files?.[0] !== file) {
      URL.revokeObjectURL(meta.objectUrl);
      return;
    }
    renderCropper({
      mode: "edit",
      container: els.editPreview,
      file,
      label: file.name,
      revokeObjectUrl: true,
      ...meta,
    });
  } catch (error) {
    console.error("[Intereses y Hobbies] No se pudo previsualizar la nueva imagen", error);
    els.editPreview.classList.add("has-error");
    els.editPreview.classList.remove("is-loading", "has-cropper");
    els.editPreview.innerHTML = "<span>No pudimos leer la imagen seleccionada.</span>";
  }
};

const uploadOriginalTeamHobbyImage = async (file, { source = "team_hobbies_original" } = {}) => {
  const filePath = `${POSTS_COLLECTION}/${currentUser.uid}/${Date.now()}-${safeFileName(file.name)}`;
  const fileRef = storageRef(storage, filePath);
  try {
    await uploadBytes(fileRef, file, {
      contentType: file.type || "image/jpeg",
      customMetadata: {
        type: HOBBIES_TYPE,
        source,
        imageColorPipeline: "original",
        imageOriginalName: getStoredOriginalName(file.name),
      },
    });
  } catch (error) {
    throw withFirebaseStage("storage-upload", error);
  }

  try {
    const imageUrl = await getDownloadURL(fileRef);
    return { filePath, imageUrl };
  } catch (error) {
    throw withFirebaseStage("storage-url", error);
  }
};

const handleUpload = async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const file = els.file?.files?.[0];
  const title = cleanString($("#team-hobbies-title")?.value, 160);
  const description = cleanString($("#team-hobbies-description")?.value, 1200);
  if (!file || !file.type.startsWith("image/")) {
    setFormError("Seleccioná una foto.");
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    setFormError("La foto supera el tamaño permitido de 25 MB.");
    return;
  }
  if (!title) {
    setFormError("Indicá un título para la publicación.");
    return;
  }
  if (!uploadCropState || uploadCropState.file !== file) {
    setFormError("Esperá a que la vista previa termine de prepararse.");
    return;
  }

  setFormError("");
  if (els.save) {
    els.save.disabled = true;
    els.save.textContent = "Publicando...";
  }
  let uploadedFilePath = "";
  try {
    const meta = {
      width: uploadCropState.width,
      height: uploadCropState.height,
      imageAspect: uploadCropState.imageAspect,
    };
    const imageCrop = getCropFromState(uploadCropState);
    const { filePath, imageUrl } = await uploadOriginalTeamHobbyImage(file);
    uploadedFilePath = filePath;
    const displayName = formatDisplayName(currentUser);
    try {
      await addDoc(collection(db, POSTS_COLLECTION), {
        type: HOBBIES_TYPE,
        title,
        text: description,
        briefDescription: description,
        longDescription: "",
        artAuthor: "",
        artYear: "",
        artWorkType: "Foto del equipo",
        artLocation: "",
        imageUrl,
        imagePath: filePath,
        thumbUrl: imageUrl,
        imageAspect: meta.imageAspect,
        imageWidth: meta.width,
        imageHeight: meta.height,
        imageCrop,
        imageOriginalName: getStoredOriginalName(file.name),
        imageColorPipeline: "original",
        authorUid: currentUser.uid,
        authorName: displayName,
        createdByUid: currentUser.uid,
        createdByName: displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        likesCount: 0,
        likedBy: [],
        likedNames: [],
        commentCount: 0,
      });
    } catch (error) {
      await deletePostImageBestEffort({ imagePath: uploadedFilePath });
      throw withFirebaseStage("firestore-create", error);
    }
    closeModal();
    await loadPosts({ reset: true });
  } catch (error) {
    console.error("[Intereses y Hobbies] No se pudo guardar", error);
    setFormError(getUploadErrorMessage(error));
  } finally {
    if (els.save) {
      els.save.disabled = false;
      els.save.textContent = "Publicar foto";
    }
  }
};

const handlePostEditSubmit = async (event) => {
  event.preventDefault();
  const post = postsById.get(editPostId);
  if (!post || !canManageItem(post)) return;
  const title = cleanString($("#team-hobbies-edit-title-input")?.value, 160);
  const description = cleanString($("#team-hobbies-edit-description")?.value, 1200);
  if (!title) {
    setEditError("Indicá un título para la publicación.");
    return;
  }
  setEditError("");
  if (els.editSave) {
    els.editSave.disabled = true;
    els.editSave.textContent = "Guardando...";
  }
  let nextImagePath = "";
  let shouldDeletePreviousImage = false;
  try {
    const updates = {
      title,
      text: description,
      briefDescription: description,
      updatedAt: serverTimestamp(),
    };
    if (editCropState) {
      updates.imageCrop = getCropFromState(editCropState);
      if (editCropState.file) {
        const file = editCropState.file;
        const upload = await uploadOriginalTeamHobbyImage(file, {
          source: "team_hobbies_original_edit",
        });
        nextImagePath = upload.filePath;
        updates.imagePath = nextImagePath;
        updates.imageUrl = upload.imageUrl;
        updates.thumbUrl = upload.imageUrl;
        updates.imageAspect = editCropState.imageAspect;
        updates.imageWidth = editCropState.width;
        updates.imageHeight = editCropState.height;
        updates.imageOriginalName = getStoredOriginalName(file.name);
        updates.imageColorPipeline = "original";
        shouldDeletePreviousImage = Boolean(post.imagePath && post.imagePath !== nextImagePath);
      }
    }
    try {
      await updateDoc(doc(db, POSTS_COLLECTION, editPostId), updates);
    } catch (error) {
      throw withFirebaseStage("firestore-update", error);
    }
    if (shouldDeletePreviousImage) {
      await deletePostImageBestEffort(post);
    }
    closePostEditModal();
    await loadPosts({ reset: true });
  } catch (error) {
    console.error("[Intereses y Hobbies] No se pudo editar la publicación", error);
    setEditError(error?.stage ? getUploadErrorMessage(error) : getActionErrorMessage(error));
    if (nextImagePath) {
      await deletePostImageBestEffort({ imagePath: nextImagePath });
    }
  } finally {
    if (els.editSave) {
      els.editSave.disabled = false;
      els.editSave.textContent = "Guardar cambios";
    }
  }
};

const deletePostImageBestEffort = async (post) => {
  if (!post?.imagePath) return;
  try {
    await deleteObject(storageRef(storage, post.imagePath));
  } catch (error) {
    const code = getFirebaseErrorCode(error);
    if (!code.includes("storage/object-not-found")) {
      console.warn("[Intereses y Hobbies] No se pudo borrar la imagen asociada.", error);
    }
  }
};

const handlePostDelete = async (postId) => {
  const post = postsById.get(postId);
  if (!post || !canManageItem(post)) return;
  const success = await confirmSensitiveAction({
    title: "Eliminar publicación",
    message: "Esta acción no se puede deshacer. Ingresá tu contraseña para eliminar la publicación.",
    confirmText: "Eliminar",
    run: async () => {
      await deleteDoc(doc(db, POSTS_COLLECTION, postId));
      await deletePostImageBestEffort(post);
    },
  });
  if (success) {
    await loadPosts({ reset: true });
  }
};

const handleCommentEditSubmit = async (event) => {
  event.preventDefault();
  if (!editCommentRef) return;
  const { postId, commentId } = editCommentRef;
  const comment = commentsByKey.get(`${postId}:${commentId}`);
  if (!comment || comment.deleted || !canManageItem(comment)) return;
  const text = cleanString($("#team-hobbies-comment-edit-text")?.value, 800);
  if (!text) {
    setCommentEditError("El comentario no puede quedar vacío.");
    return;
  }
  setCommentEditError("");
  if (els.commentEditSave) {
    els.commentEditSave.disabled = true;
    els.commentEditSave.textContent = "Guardando...";
  }
  try {
    await updateDoc(doc(db, POSTS_COLLECTION, postId, COMMENTS_COLLECTION, commentId), {
      text,
      updatedAt: serverTimestamp(),
    });
    closeCommentEditModal();
  } catch (error) {
    console.error("[Intereses y Hobbies] No se pudo editar el comentario", error);
    setCommentEditError(getActionErrorMessage(error));
  } finally {
    if (els.commentEditSave) {
      els.commentEditSave.disabled = false;
      els.commentEditSave.textContent = "Guardar comentario";
    }
  }
};

const handleCommentDelete = async (postId, commentId) => {
  const comment = commentsByKey.get(`${postId}:${commentId}`);
  if (!comment || comment.deleted || !canManageItem(comment)) return;
  await confirmSensitiveAction({
    title: "Eliminar comentario",
    message: "Ingresá tu contraseña para eliminar este comentario.",
    confirmText: "Eliminar",
    run: async () => {
      await updateDoc(doc(db, POSTS_COLLECTION, postId, COMMENTS_COLLECTION, commentId), {
        deleted: true,
        deletedAt: serverTimestamp(),
        deletedBy: currentUser.uid,
        updatedAt: serverTimestamp(),
      });
    },
  });
};

const initReturnHomeLink = () => {
  const link = els.returnHome;
  if (!link) return;
  link.href = "/index.html";
};

const initScrollUp = () => {
  const btn = els.scrollUp;
  if (!btn) return;
  const sync = () => btn.classList.toggle("show-scroll", window.scrollY > 420);
  window.addEventListener("scroll", sync, { passive: true });
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  sync();
};

const bindEvents = () => {
  els.uploadOpen?.addEventListener("click", openModal);
  els.close?.addEventListener("click", closeModal);
  els.cancel?.addEventListener("click", closeModal);
  els.editClose?.addEventListener("click", closePostEditModal);
  els.editCancel?.addEventListener("click", closePostEditModal);
  els.commentEditClose?.addEventListener("click", closeCommentEditModal);
  els.commentEditCancel?.addEventListener("click", closeCommentEditModal);
  els.authClose?.addEventListener("click", () => closeAuthModal(false));
  els.authCancel?.addEventListener("click", () => closeAuthModal(false));
  els.lightboxClose?.addEventListener("click", closeLightbox);
  els.modal?.addEventListener("click", (event) => {
    if (event.target === els.modal) closeModal();
  });
  els.editModal?.addEventListener("click", (event) => {
    if (event.target === els.editModal) closePostEditModal();
  });
  els.commentEditModal?.addEventListener("click", (event) => {
    if (event.target === els.commentEditModal) closeCommentEditModal();
  });
  els.authModal?.addEventListener("click", (event) => {
    if (event.target === els.authModal) closeAuthModal(false);
  });
  els.lightbox?.addEventListener("click", (event) => {
    if (event.target === els.lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (els.lightbox && !els.lightbox.hidden) closeLightbox();
    else if (els.authModal && !els.authModal.hidden) closeAuthModal(false);
    else if (els.commentEditModal && !els.commentEditModal.hidden) closeCommentEditModal();
    else if (els.editModal && !els.editModal.hidden) closePostEditModal();
    else if (els.modal && !els.modal.hidden) closeModal();
  });
  document.addEventListener("scroll", clearFloatingLikeTooltips, true);
  els.file?.addEventListener("change", handleFilePreview);
  els.editFile?.addEventListener("change", handleEditFilePreview);
  els.form?.addEventListener("submit", handleUpload);
  els.editForm?.addEventListener("submit", handlePostEditSubmit);
  els.commentEditForm?.addEventListener("submit", handleCommentEditSubmit);
  els.authForm?.addEventListener("submit", handleAuthSubmit);
  els.loadMore?.addEventListener("click", () => loadPosts({ reset: false }));
  els.feed?.addEventListener("mouseover", (event) => {
    const button = event.target.closest(".team-hobby-action--like, .team-hobby-comment-like");
    if (!button || button.contains(event.relatedTarget)) return;
    positionLikeTooltip(button);
  });
  els.feed?.addEventListener("mousemove", (event) => {
    const button = event.target.closest(".team-hobby-action--like, .team-hobby-comment-like");
    if (!button) return;
    const tooltipText = cleanString($(".team-hobby-like-tooltip, .team-hobby-comment-like-tooltip", button)?.textContent || "", 220);
    if (!button.classList.contains("is-open") || floatingLikeTooltip?.textContent !== tooltipText) {
      positionLikeTooltip(button);
    }
  });
  els.feed?.addEventListener("mouseout", (event) => {
    const button = event.target.closest(".team-hobby-action--like, .team-hobby-comment-like");
    if (!button || button.contains(event.relatedTarget)) return;
    clearFloatingLikeTooltips();
  });
  els.feed?.addEventListener("focusin", (event) => {
    const button = event.target.closest(".team-hobby-action--like, .team-hobby-comment-like");
    if (button) positionLikeTooltip(button);
  });
  els.feed?.addEventListener("focusout", (event) => {
    const button = event.target.closest(".team-hobby-action--like, .team-hobby-comment-like");
    if (!button || button.contains(event.relatedTarget)) return;
    clearFloatingLikeTooltips();
  });
  els.feed?.addEventListener("click", (event) => {
    const article = event.target.closest(".team-hobby-post");
    if (!article) return;
    const postId = article.dataset.postId || "";
    const postAction = event.target.closest("[data-post-action]");
    if (postAction) {
      if (postAction.dataset.postAction === "edit") requestPostEdit(postId);
      if (postAction.dataset.postAction === "delete") handlePostDelete(postId);
      return;
    }
    const replyCancel = event.target.closest("[data-reply-cancel]");
    if (replyCancel) {
      const replyArticle = event.target.closest(".team-hobby-post");
      const replyPostId = replyArticle?.dataset?.postId || "";
      if (replyPostId) activeReplyDrafts.delete(replyPostId);
      replyCancel.closest("[data-reply-form]")?.remove();
      return;
    }
    const commentAction = event.target.closest("[data-comment-action]");
    if (commentAction) {
      const commentEl = event.target.closest(".team-hobby-comment");
      const commentId = commentAction.dataset.commentId || commentEl?.dataset?.commentId || "";
      if (commentAction.dataset.commentAction === "like") handleCommentLike(article, commentId);
      if (commentAction.dataset.commentAction === "edit") requestCommentEdit(postId, commentId);
      if (commentAction.dataset.commentAction === "delete") handleCommentDelete(postId, commentId);
      if (commentAction.dataset.commentAction === "reply") openReplyForm(article, commentId);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "like") handleLike(article);
    if (action.dataset.action === "open-image") openLightbox(article);
  });
  els.feed?.addEventListener("submit", (event) => {
    const replyForm = event.target.closest("[data-reply-form]");
    const replyArticle = event.target.closest(".team-hobby-post");
    if (replyForm && replyArticle) {
      handleReplySubmit(event, replyArticle, replyForm);
      return;
    }
    const form = event.target.closest("[data-comment-form]");
    const article = event.target.closest(".team-hobby-post");
    if (form && article) handleCommentSubmit(event, article);
  });
};

const boot = async () => {
  currentUser = await requireAuth(auth);
  if (!currentUser) return;
  currentUserIsAdmin = await resolveAdminStatus(currentUser);
  initSessionGuard({ auth, db });
  initUserMenu({ variant: "desktop" });
  initReturnHomeLink();
  initScrollUp();
  bindEvents();
  if (window.lucide) window.lucide.createIcons();
  await loadPosts({ reset: true });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
