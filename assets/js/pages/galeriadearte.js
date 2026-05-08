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
import { toggleCarouselLikeForCurrentUser } from "../services/interactions/FeedInteractionService.js";

const ART_TYPE = "art_gallery";
const PAGE_SIZE = 12;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const { POSTS: POSTS_COLLECTION, COMMENTS: COMMENTS_COLLECTION } = COLLECTIONS;
const { auth, db, storage } = getFirebase();

let currentUser = null;
let currentUserIsAdmin = false;
let lastDoc = null;
let isLoading = false;
let hasMore = true;
let commentUnsubs = new Map();
let postsById = new Map();
let commentsByKey = new Map();
let editPostId = "";
let editCommentRef = null;
let authActionState = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const els = {
  feed: $("#art-gallery-feed"),
  empty: $("#art-gallery-empty"),
  error: $("#art-gallery-error"),
  loadMore: $("#art-gallery-load-more"),
  uploadOpen: $("#art-gallery-upload"),
  modal: $("#art-gallery-modal"),
  form: $("#art-gallery-form"),
  cancel: $("#art-gallery-cancel"),
  close: $("#art-gallery-close"),
  file: $("#art-gallery-file"),
  preview: $("#art-gallery-preview"),
  formError: $("#art-gallery-form-error"),
  save: $("#art-gallery-save"),
  scrollUp: $("#scroll-up"),
  returnHome: $("#art-gallery-return-home"),
  editModal: $("#art-edit-modal"),
  editForm: $("#art-edit-form"),
  editClose: $("#art-edit-close"),
  editCancel: $("#art-edit-cancel"),
  editSave: $("#art-edit-save"),
  editError: $("#art-edit-form-error"),
  commentEditModal: $("#art-comment-edit-modal"),
  commentEditForm: $("#art-comment-edit-form"),
  commentEditClose: $("#art-comment-edit-close"),
  commentEditCancel: $("#art-comment-edit-cancel"),
  commentEditSave: $("#art-comment-edit-save"),
  commentEditError: $("#art-comment-edit-error"),
  authModal: $("#art-auth-modal"),
  authForm: $("#art-auth-form"),
  authClose: $("#art-auth-close"),
  authCancel: $("#art-auth-cancel"),
  authConfirm: $("#art-auth-confirm"),
  authPassword: $("#art-auth-password"),
  authError: $("#art-auth-error"),
  authTitle: $("#art-auth-title"),
  authMessage: $("#art-auth-message"),
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

const safeFileName = (name = "obra.jpg") => {
  const clean = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return clean || "obra.jpg";
};

const readImageMeta = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      URL.revokeObjectURL(url);
      if (!width || !height) {
        reject(new Error("No se pudo leer la imagen."));
        return;
      }
      const ratio = width / height;
      const imageAspect = ratio > 1.08 ? "landscape" : ratio < 0.92 ? "portrait" : "square";
      resolve({ width, height, imageAspect });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("El archivo no parece una imagen válida."));
    };
    img.src = url;
  });

const mapPost = (docSnap) => {
  const data = docSnap.data() || {};
  const likedBy = Array.isArray(data.likedBy) ? data.likedBy : [];
  const likedNames = Array.isArray(data.likedNames)
    ? data.likedNames.map((value) => cleanString(value, 120)).filter(Boolean)
    : [];
  const likesCount = likedBy.length || (Number.isFinite(data.likesCount) ? data.likesCount : 0);
  return {
    id: docSnap.id,
    title: cleanString(data.title, 160),
    briefDescription: cleanString(data.briefDescription || data.text, 900),
    longDescription: cleanString(data.longDescription, 5000),
    artAuthor: cleanString(data.artAuthor, 140),
    artYear: cleanString(data.artYear, 40),
    artWorkType: cleanString(data.artWorkType, 120),
    artLocation: cleanString(data.artLocation, 160),
    imageUrl: data.imageUrl || "",
    thumbUrl: data.thumbUrl || data.imageUrl || "",
    imagePath: data.imagePath || "",
    imageAspect: data.imageAspect || "landscape",
    imageWidth: Number(data.imageWidth) || 0,
    imageHeight: Number(data.imageHeight) || 0,
    createdByUid: data.createdByUid || data.authorUid || "",
    createdByName: data.createdByName || data.authorName || "Usuario",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    likedBy,
    likedNames,
    likesCount,
    commentCount: Number.isFinite(data.commentCount) ? data.commentCount : 0,
  };
};

const renderMeta = (post) => {
  const items = [
    ["Autor", post.artAuthor],
    ["Año", post.artYear],
    ["Tipo", post.artWorkType],
    ["Ubicación", post.artLocation],
  ].filter(([, value]) => value);
  if (!items.length) return "";
  return `
    <dl class="art-meta">
      ${items
        .map(
          ([label, value]) => `
            <div class="art-meta__item">
              <dt>${escapeHtml(label)}</dt>
              <dd>${escapeHtml(value)}</dd>
            </div>
          `,
        )
        .join("")}
    </dl>
  `;
};

const getImageRatioValue = (post) => {
  const width = Number(post?.imageWidth) || 0;
  const height = Number(post?.imageHeight) || 0;
  if (width > 0 && height > 0) return `${Math.round(width)} / ${Math.round(height)}`;
  if (post?.imageAspect === "portrait") return "4 / 5";
  if (post?.imageAspect === "square") return "1 / 1";
  return "4 / 3";
};

const formatLikeNames = (names = []) => {
  const uniqueNames = [...new Set(names.map((name) => cleanString(name, 120)).filter(Boolean))];
  if (!uniqueNames.length) return "";
  if (uniqueNames.length === 1) return `Le gusta a ${uniqueNames[0]}`;
  if (uniqueNames.length === 2) return `Le gusta a ${uniqueNames[0]} y ${uniqueNames[1]}`;
  const visibleNames = uniqueNames.slice(0, 4);
  const extraCount = uniqueNames.length - visibleNames.length;
  const suffix = extraCount > 0 ? ` y ${extraCount} más` : "";
  return `Le gusta a ${visibleNames.join(", ")}${suffix}`;
};

const renderLikeTooltip = (post) => {
  const text = formatLikeNames(post?.likedNames);
  if (!text) return "";
  return `<span class="art-like-tooltip" id="art-like-tooltip-${escapeHtml(post.id)}" role="tooltip">${escapeHtml(text)}</span>`;
};

const syncLikeTooltip = (button, names = []) => {
  if (!button) return;
  const text = formatLikeNames(names);
  let tooltip = $(".art-like-tooltip", button);
  button.removeAttribute("title");
  if (!text) {
    tooltip?.remove();
    button.removeAttribute("aria-describedby");
    return;
  }
  const postId = button.closest(".art-post")?.dataset?.postId || "current";
  const tooltipId = `art-like-tooltip-${postId}`;
  if (!tooltip) {
    tooltip = document.createElement("span");
    tooltip.className = "art-like-tooltip";
    tooltip.setAttribute("role", "tooltip");
    button.appendChild(tooltip);
  }
  tooltip.id = tooltipId;
  tooltip.textContent = text;
  button.setAttribute("aria-describedby", tooltipId);
};

const renderBrief = (post, canManage) => {
  if (!post.briefDescription) return "";
  return `
    <div class="art-post__brief-row">
      <p class="art-post__brief">${escapeHtml(post.briefDescription)}</p>
      ${
        canManage
          ? `<button class="art-brief-edit" type="button" data-post-action="edit-brief" aria-label="Editar descripción breve" title="Editar descripción breve">
              <i data-lucide="pencil" aria-hidden="true"></i>
            </button>`
          : ""
      }
    </div>
  `;
};

const hydratePostImage = (article) => {
  const image = $(".art-frame__image", article);
  const media = $(".art-frame__media", article);
  if (!image || !media) return;
  const markLoaded = () => {
    const width = image.naturalWidth || 0;
    const height = image.naturalHeight || 0;
    if (width > 0 && height > 0) {
      media.style.setProperty("--art-image-ratio", `${width} / ${height}`);
    }
    media.classList.remove("is-loading");
    media.classList.add("is-loaded");
  };
  const markError = () => {
    media.classList.remove("is-loading");
    media.classList.add("has-error");
  };
  if (image.complete && image.naturalWidth) {
    markLoaded();
    return;
  }
  image.addEventListener("load", markLoaded, { once: true });
  image.addEventListener("error", markError, { once: true });
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
    console.warn("[Galería de Arte] No se pudo leer custom claims.", error);
  }
  try {
    const snap = await getDoc(doc(db, "admin_whitelist", user.uid));
    return snap.exists();
  } catch (error) {
    console.warn("[Galería de Arte] No se pudo leer admin_whitelist.", error);
    return false;
  }
};

const renderPost = (post, postIndex = 0) => {
  const liked = currentUser && post.likedBy.includes(currentUser.uid);
  const canManage = canManageItem(post);
  const isPriorityImage = postIndex < 2;
  const fetchPriority = isPriorityImage ? ' fetchpriority="high"' : "";
  const likeLabel = liked ? "Quitar me gusta" : "Dar me gusta";
  const likeTooltipText = formatLikeNames(post.likedNames);
  const article = document.createElement("article");
  article.className = "art-post";
  article.dataset.postId = post.id;
  article.innerHTML = `
    <header class="art-post__header">
      <span class="art-avatar" data-author-avatar data-author-uid="${escapeHtml(post.createdByUid)}" data-author-name="${escapeHtml(post.createdByName)}">
        <img class="art-avatar__img" data-avatar-img src="${TRANSPARENT_PIXEL}" alt="" hidden />
        <span data-avatar-fallback="initials">${escapeHtml(post.createdByName.slice(0, 2).toUpperCase())}</span>
      </span>
      <div class="art-post__identity">
        <p class="art-post__author">${escapeHtml(post.createdByName)}</p>
        <p class="art-post__date">${escapeHtml(formatDateTime(post.createdAt))}</p>
      </div>
      ${
        canManage
          ? `<div class="art-post__owner-actions" aria-label="Acciones de publicación">
              <button class="art-owner-action" type="button" data-post-action="edit" aria-label="Editar publicación" title="Editar publicación">
                <i data-lucide="pencil" aria-hidden="true"></i>
              </button>
              <button class="art-owner-action art-owner-action--delete" type="button" data-post-action="delete" aria-label="Eliminar publicación" title="Eliminar publicación">
                <i data-lucide="trash-2" aria-hidden="true"></i>
              </button>
            </div>`
          : ""
      }
    </header>
    <div class="art-frame-shell">
      <figure class="art-frame art-frame--${escapeHtml(post.imageAspect)}">
        <span class="art-frame__media is-loading" style="--art-image-ratio: ${getImageRatioValue(post)};">
          <img class="art-frame__image" src="${escapeHtml(post.thumbUrl)}" data-full="${escapeHtml(post.imageUrl)}" alt="${escapeHtml(post.title)}" loading="${isPriorityImage ? "eager" : "lazy"}"${fetchPriority} decoding="async" />
        </span>
      </figure>
    </div>
    <div class="art-post__content">
      <h2 class="art-post__title">${escapeHtml(post.title)}</h2>
      ${renderBrief(post, canManage)}
      ${renderMeta(post)}
      ${post.longDescription ? `<p class="art-post__long">${escapeHtml(post.longDescription)}</p>` : ""}
    </div>
    <footer class="art-actions">
      <button class="art-action art-action--like${liked ? " is-active" : ""}" type="button" data-action="like" aria-pressed="${liked ? "true" : "false"}" aria-label="${escapeHtml(likeLabel)}" ${likeTooltipText ? `aria-describedby="art-like-tooltip-${escapeHtml(post.id)}"` : ""}>
        <span class="art-heart" aria-hidden="true">♥</span>
        <span data-like-count>${post.likesCount}</span>
        ${renderLikeTooltip(post)}
      </button>
      <button class="art-action" type="button" data-action="comments" aria-expanded="false">
        <span aria-hidden="true">💬</span>
        <span>Comentarios</span>
        <span data-comment-count>${post.commentCount || 0}</span>
      </button>
    </footer>
    <section class="art-comments" data-comments hidden>
      <div class="art-comments__list" data-comments-list>
        <div class="art-empty">Cargando comentarios...</div>
      </div>
      <form class="art-comment-form" data-comment-form>
        <textarea class="art-comment-input" rows="1" maxlength="800" placeholder="Escribe un comentario..." aria-label="Comentar obra"></textarea>
        <button class="art-comment-submit" type="submit">Comentar</button>
      </form>
    </section>
  `;
  hydrateAvatars(article).catch(() => {});
  hydratePostImage(article);
  return article;
};

const renderComment = (comment) => {
  const canManage = canManageItem(comment);
  const edited = Boolean(comment.updatedAt);
  return `
    <article class="art-comment" data-comment-id="${escapeHtml(comment.id)}">
      <div class="art-comment__meta">
        <span class="art-comment__meta-main">
          <span class="art-comment__author">${escapeHtml(comment.authorName || "Usuario")}</span>
          <span>${escapeHtml(formatDateTime(comment.createdAt))}</span>
          ${edited ? '<span class="art-comment__edited">Editado</span>' : ""}
        </span>
        ${
          canManage
            ? `<span class="art-comment__actions" aria-label="Acciones del comentario">
                <button class="art-comment-action" type="button" data-comment-action="edit" aria-label="Editar comentario" title="Editar comentario">
                  <i data-lucide="pencil" aria-hidden="true"></i>
                </button>
                <button class="art-comment-action art-comment-action--delete" type="button" data-comment-action="delete" aria-label="Eliminar comentario" title="Eliminar comentario">
                  <i data-lucide="trash-2" aria-hidden="true"></i>
                </button>
              </span>`
            : ""
        }
      </div>
      <p class="art-comment__text">${escapeHtml(comment.text || "")}</p>
    </article>
  `;
};

const showError = (message = "") => {
  if (!els.error) return;
  els.error.hidden = !message;
  els.error.textContent = message;
};

const getFirebaseErrorCode = (error) => String(error?.code || "").toLowerCase();

const getFirebaseErrorText = (error) =>
  `${String(error?.message || "")} ${String(error?.customData?.serverResponse || "")}`.toLowerCase();

const getLoadErrorMessage = (error) => {
  const code = getFirebaseErrorCode(error);
  const text = getFirebaseErrorText(error);
  if (code.includes("permission-denied")) {
    return "No pudimos cargar la galería porque las reglas de Firestore no aceptaron la consulta. Verificá que las reglas estén desplegadas.";
  }
  if (code.includes("failed-precondition") || text.includes("index")) {
    return "No pudimos cargar la galería porque falta el índice de Firestore para obras de arte. Reintentá cuando termine de crearse.";
  }
  if (code.includes("unavailable") || text.includes("network")) {
    return "No pudimos conectar con Firebase. Revisá la conexión e intentá nuevamente.";
  }
  return "No pudimos cargar la galería. Reintentá en unos segundos.";
};

const getUploadErrorMessage = (error) => {
  const code = getFirebaseErrorCode(error);
  const text = getFirebaseErrorText(error);
  if (code.includes("storage/unauthorized") || code.includes("permission-denied")) {
    return "No pudimos guardar la obra porque los permisos de Firebase rechazaron la operación. Verificá reglas desplegadas e intentá nuevamente.";
  }
  if (code.includes("storage/quota-exceeded")) {
    return "No pudimos guardar la obra porque Storage alcanzó su cuota. Intentá más tarde.";
  }
  if (code.includes("storage/retry-limit-exceeded") || code.includes("unavailable") || text.includes("network")) {
    return "No pudimos completar la carga por un problema de conexión con Firebase. Intentá nuevamente.";
  }
  if (code.includes("failed-precondition") || text.includes("index")) {
    return "No pudimos guardar la obra porque falta terminar de publicar el índice de Firestore. Reintentá en unos minutos.";
  }
  if (text.includes("imagen") || text.includes("image") || text.includes("file")) {
    return "No pudimos leer la imagen. Verificá que sea un archivo válido y que no supere el tamaño permitido.";
  }
  return "No pudimos guardar la obra. Revisá la imagen, permisos e intentá nuevamente.";
};

const setEmptyVisible = (visible) => {
  if (els.empty) els.empty.hidden = !visible;
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
    els.feed.innerHTML = "";
    setEmptyVisible(false);
  }
  try {
    const base = [
      collection(db, POSTS_COLLECTION),
      where("type", "==", ART_TYPE),
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE),
    ];
    const q = lastDoc ? query(...base, startAfter(lastDoc)) : query(...base);
    const snap = await getDocs(q);
    const posts = snap.docs.map(mapPost).filter((post) => post.imageUrl);
    const existingCount = els.feed.children.length;
    posts.forEach((post, index) => {
      postsById.set(post.id, post);
      els.feed.appendChild(renderPost(post, existingCount + index));
    });
    hydrateAvatars(els.feed).catch(() => {});
    if (snap.docs.length) lastDoc = snap.docs[snap.docs.length - 1];
    hasMore = snap.docs.length === PAGE_SIZE;
    setEmptyVisible(els.feed.children.length === 0);
  } catch (error) {
    console.error("[Galería de Arte] No se pudo cargar", error);
    showError(getLoadErrorMessage(error));
  } finally {
    isLoading = false;
    if (els.loadMore) {
      els.loadMore.hidden = !hasMore;
      els.loadMore.disabled = false;
      els.loadMore.textContent = "Cargar más obras";
    }
    if (window.lucide) window.lucide.createIcons();
  }
};

const subscribeComments = (postId, article) => {
  if (commentUnsubs.has(postId)) return;
  const list = $("[data-comments-list]", article);
  const countEls = $$("[data-comment-count]", article);
  const commentsQuery = query(
    collection(db, POSTS_COLLECTION, postId, COMMENTS_COLLECTION),
    orderBy("createdAt", "asc"),
    limit(80),
  );
  const unsub = onSnapshot(
    commentsQuery,
    (snap) => {
      const comments = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
      comments.forEach((comment) => {
        commentsByKey.set(`${postId}:${comment.id}`, comment);
      });
      if (list) {
        list.innerHTML = comments.length
          ? comments.map(renderComment).join("")
          : '<div class="art-empty">Sin comentarios todavía.</div>';
        if (window.lucide) window.lucide.createIcons();
      }
      countEls.forEach((el) => {
        el.textContent = String(comments.length);
      });
    },
    () => {
      if (list) list.innerHTML = '<div class="art-error">No pudimos cargar los comentarios.</div>';
    },
  );
  commentUnsubs.set(postId, unsub);
};

const toggleComments = (article) => {
  const postId = article?.dataset?.postId || "";
  const wrap = $("[data-comments]", article);
  const button = $('[data-action="comments"]', article);
  if (!postId || !wrap) return;
  const willOpen = wrap.hidden;
  wrap.hidden = !willOpen;
  button?.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) subscribeComments(postId, article);
};

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
    button.setAttribute("aria-label", result.liked ? "Quitar me gusta" : "Dar me gusta");
    if (count) count.textContent = String(result.likesCount || 0);
    syncLikeTooltip(button, likedNames);
  } catch (error) {
    console.error("[Galería de Arte] No se pudo alternar like", error);
  } finally {
    button.disabled = false;
  }
};

const handleCommentSubmit = async (event, article) => {
  event.preventDefault();
  const postId = article?.dataset?.postId || "";
  const input = $(".art-comment-input", article);
  const submit = $(".art-comment-submit", article);
  const text = cleanString(input?.value, 800);
  if (!postId || !text || !currentUser) return;
  if (submit) submit.disabled = true;
  try {
    await addDoc(collection(db, POSTS_COLLECTION, postId, COMMENTS_COLLECTION), {
      text,
      authorUid: currentUser.uid,
      authorName: formatDisplayName(currentUser),
      createdAt: serverTimestamp(),
      likedBy: {},
    });
    if (input) input.value = "";
  } catch (error) {
    console.error("[Galería de Arte] No se pudo comentar", error);
  } finally {
    if (submit) submit.disabled = false;
  }
};

const openModal = () => {
  if (!els.modal) return;
  els.modal.hidden = false;
  els.modal.setAttribute("aria-hidden", "false");
  $("#art-gallery-title")?.focus();
};

const closeModal = () => {
  if (!els.modal) return;
  els.modal.hidden = true;
  els.modal.setAttribute("aria-hidden", "true");
  els.form?.reset();
  if (els.preview) els.preview.innerHTML = "<span>Vista previa de la obra</span>";
  if (els.formError) {
    els.formError.hidden = true;
    els.formError.textContent = "";
  }
};

const setEditFieldValue = (selector, value = "") => {
  const field = $(selector);
  if (field) field.value = value || "";
};

const openPostEditModal = (postId, options = {}) => {
  const post = postsById.get(postId);
  if (!post || !canManageItem(post) || !els.editModal) return;
  editPostId = postId;
  setEditFieldValue("#art-edit-title", post.title);
  setEditFieldValue("#art-edit-brief", post.briefDescription);
  setEditFieldValue("#art-edit-author", post.artAuthor);
  setEditFieldValue("#art-edit-year", post.artYear);
  setEditFieldValue("#art-edit-type", post.artWorkType);
  setEditFieldValue("#art-edit-location", post.artLocation);
  setEditFieldValue("#art-edit-long", post.longDescription);
  setEditError("");
  els.editModal.hidden = false;
  els.editModal.setAttribute("aria-hidden", "false");
  const focusTarget = options.focusBrief ? $("#art-edit-brief") : $("#art-edit-title");
  window.setTimeout(() => {
    focusTarget?.focus();
    if (options.focusBrief && typeof focusTarget?.select === "function") focusTarget.select();
  }, 0);
};

const closePostEditModal = () => {
  editPostId = "";
  if (!els.editModal) return;
  els.editModal.hidden = true;
  els.editModal.setAttribute("aria-hidden", "true");
  els.editForm?.reset();
  setEditError("");
  if (els.editSave) {
    els.editSave.disabled = false;
    els.editSave.textContent = "Guardar cambios";
  }
};

const openCommentEditModal = (postId, commentId) => {
  const comment = commentsByKey.get(`${postId}:${commentId}`);
  if (!comment || !canManageItem(comment) || !els.commentEditModal) return;
  editCommentRef = { postId, commentId };
  setEditFieldValue("#art-comment-edit-text", comment.text);
  setCommentEditError("");
  els.commentEditModal.hidden = false;
  els.commentEditModal.setAttribute("aria-hidden", "false");
  $("#art-comment-edit-text")?.focus();
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
  if (code.includes("auth/requires-recent-login")) {
    return "La sesión necesita confirmación. Ingresá la contraseña nuevamente.";
  }
  if (code.includes("permission-denied")) {
    return "No tenés permisos para realizar esta acción.";
  }
  if (code.includes("not-found") || text.includes("not found")) {
    return "El contenido ya no está disponible.";
  }
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
    console.warn("[Galería de Arte] Acción protegida falló", error);
    setAuthError(getActionErrorMessage(error));
    if (els.authConfirm) {
      els.authConfirm.disabled = false;
      els.authConfirm.textContent = authActionState?.confirmText || "Confirmar";
    }
  }
};

const handleFilePreview = () => {
  const file = els.file?.files?.[0];
  if (!els.preview) return;
  if (!file) {
    els.preview.innerHTML = "<span>Vista previa de la obra</span>";
    return;
  }
  const url = URL.createObjectURL(file);
  els.preview.innerHTML = `<img src="${url}" alt="Vista previa" />`;
  const img = $("img", els.preview);
  img?.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
};

const handleUpload = async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const file = els.file?.files?.[0];
  const title = cleanString($("#art-gallery-title")?.value, 160);
  const briefDescription = cleanString($("#art-gallery-brief")?.value, 900);
  const longDescription = cleanString($("#art-gallery-long")?.value, 5000);
  const artAuthor = cleanString($("#art-gallery-author")?.value, 140);
  const artYear = cleanString($("#art-gallery-year")?.value, 40);
  const artWorkType = cleanString($("#art-gallery-type")?.value, 120);
  const artLocation = cleanString($("#art-gallery-location")?.value, 160);

  if (!file || !file.type.startsWith("image/")) {
    setFormError("Seleccioná una imagen de la obra.");
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    setFormError("La imagen supera el tamaño permitido de 25 MB.");
    return;
  }
  if (!title) {
    setFormError("Indicá un título para la publicación.");
    return;
  }

  setFormError("");
  if (els.save) {
    els.save.disabled = true;
    els.save.textContent = "Guardando...";
  }
  try {
    const meta = await readImageMeta(file);
    const filePath = `${POSTS_COLLECTION}/${currentUser.uid}/${Date.now()}-${safeFileName(file.name)}`;
    const fileRef = storageRef(storage, filePath);
    await uploadBytes(fileRef, file, {
      contentType: file.type || "image/jpeg",
      customMetadata: {
        type: ART_TYPE,
      },
    });
    const imageUrl = await getDownloadURL(fileRef);
    const displayName = formatDisplayName(currentUser);
    await addDoc(collection(db, POSTS_COLLECTION), {
      type: ART_TYPE,
      title,
      text: briefDescription,
      briefDescription,
      longDescription,
      artAuthor,
      artYear,
      artWorkType,
      artLocation,
      imageUrl,
      imagePath: filePath,
      thumbUrl: imageUrl,
      imageAspect: meta.imageAspect,
      imageWidth: meta.width,
      imageHeight: meta.height,
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
    closeModal();
    await loadPosts({ reset: true });
  } catch (error) {
    console.error("[Galería de Arte] No se pudo guardar", error);
    setFormError(getUploadErrorMessage(error));
  } finally {
    if (els.save) {
      els.save.disabled = false;
      els.save.textContent = "Publicar obra";
    }
  }
};

const handlePostEditSubmit = async (event) => {
  event.preventDefault();
  const post = postsById.get(editPostId);
  if (!post || !canManageItem(post)) return;
  const title = cleanString($("#art-edit-title")?.value, 160);
  const briefDescription = cleanString($("#art-edit-brief")?.value, 900);
  const longDescription = cleanString($("#art-edit-long")?.value, 5000);
  const artAuthor = cleanString($("#art-edit-author")?.value, 140);
  const artYear = cleanString($("#art-edit-year")?.value, 40);
  const artWorkType = cleanString($("#art-edit-type")?.value, 120);
  const artLocation = cleanString($("#art-edit-location")?.value, 160);
  if (!title) {
    setEditError("Indicá un título para la publicación.");
    return;
  }
  setEditError("");
  const payload = {
    title,
    text: briefDescription,
    briefDescription,
    longDescription,
    artAuthor,
    artYear,
    artWorkType,
    artLocation,
    updatedAt: serverTimestamp(),
  };
  const success = await confirmSensitiveAction({
    title: "Guardar cambios",
    message: "Ingresá tu contraseña para editar esta publicación.",
    confirmText: "Guardar",
    run: async () => {
      await updateDoc(doc(db, POSTS_COLLECTION, editPostId), payload);
    },
  });
  if (success) {
    closePostEditModal();
    await loadPosts({ reset: true });
  } else if (els.editSave) {
    els.editSave.disabled = false;
    els.editSave.textContent = "Guardar cambios";
  }
};

const deletePostImageBestEffort = async (post) => {
  if (!post?.imagePath) return;
  try {
    await deleteObject(storageRef(storage, post.imagePath));
  } catch (error) {
    const code = getFirebaseErrorCode(error);
    if (!code.includes("storage/object-not-found")) {
      console.warn("[Galería de Arte] No se pudo borrar la imagen asociada.", error);
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
    const unsubscribe = commentUnsubs.get(postId);
    if (unsubscribe) unsubscribe();
    commentUnsubs.delete(postId);
    postsById.delete(postId);
    $$(".art-post", els.feed).find((node) => node.dataset.postId === postId)?.remove();
    setEmptyVisible(els.feed?.children.length === 0);
  }
};

const handleCommentEditSubmit = async (event) => {
  event.preventDefault();
  if (!editCommentRef) return;
  const { postId, commentId } = editCommentRef;
  const comment = commentsByKey.get(`${postId}:${commentId}`);
  if (!comment || !canManageItem(comment)) return;
  const text = cleanString($("#art-comment-edit-text")?.value, 800);
  if (!text) {
    setCommentEditError("El comentario no puede quedar vacío.");
    return;
  }
  setCommentEditError("");
  const success = await confirmSensitiveAction({
    title: "Guardar comentario",
    message: "Ingresá tu contraseña para editar este comentario.",
    confirmText: "Guardar",
    run: async () => {
      await updateDoc(doc(db, POSTS_COLLECTION, postId, COMMENTS_COLLECTION, commentId), {
        text,
        updatedAt: serverTimestamp(),
      });
    },
  });
  if (success) {
    closeCommentEditModal();
  } else if (els.commentEditSave) {
    els.commentEditSave.disabled = false;
    els.commentEditSave.textContent = "Guardar comentario";
  }
};

const handleCommentDelete = async (postId, commentId) => {
  const comment = commentsByKey.get(`${postId}:${commentId}`);
  if (!comment || !canManageItem(comment)) return;
  await confirmSensitiveAction({
    title: "Eliminar comentario",
    message: "Ingresá tu contraseña para eliminar este comentario.",
    confirmText: "Eliminar",
    run: async () => {
      await deleteDoc(doc(db, POSTS_COLLECTION, postId, COMMENTS_COLLECTION, commentId));
    },
  });
};

const initReturnHomeLink = () => {
  const link = els.returnHome;
  if (!link) return;
  const params = new URLSearchParams(window.location.search);
  link.href = params.get("dmEmulators") === "1" ? "/index.html?dmEmulators=1" : "/index.html";
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
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (els.authModal && !els.authModal.hidden) closeAuthModal(false);
    else if (els.commentEditModal && !els.commentEditModal.hidden) closeCommentEditModal();
    else if (els.editModal && !els.editModal.hidden) closePostEditModal();
    else if (els.modal && !els.modal.hidden) closeModal();
  });
  els.file?.addEventListener("change", handleFilePreview);
  els.form?.addEventListener("submit", handleUpload);
  els.editForm?.addEventListener("submit", handlePostEditSubmit);
  els.commentEditForm?.addEventListener("submit", handleCommentEditSubmit);
  els.authForm?.addEventListener("submit", handleAuthSubmit);
  els.loadMore?.addEventListener("click", () => loadPosts({ reset: false }));
  els.feed?.addEventListener("click", (event) => {
    const article = event.target.closest(".art-post");
    if (!article) return;
    const postId = article.dataset.postId || "";
    const postAction = event.target.closest("[data-post-action]");
    if (postAction) {
      if (postAction.dataset.postAction === "edit") openPostEditModal(postId);
      if (postAction.dataset.postAction === "edit-brief") openPostEditModal(postId, { focusBrief: true });
      if (postAction.dataset.postAction === "delete") handlePostDelete(postId);
      return;
    }
    const commentAction = event.target.closest("[data-comment-action]");
    if (commentAction) {
      const commentEl = event.target.closest(".art-comment");
      const commentId = commentEl?.dataset?.commentId || "";
      if (commentAction.dataset.commentAction === "edit") openCommentEditModal(postId, commentId);
      if (commentAction.dataset.commentAction === "delete") handleCommentDelete(postId, commentId);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "like") handleLike(article);
    if (action.dataset.action === "comments") toggleComments(article);
  });
  els.feed?.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-comment-form]");
    const article = event.target.closest(".art-post");
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
