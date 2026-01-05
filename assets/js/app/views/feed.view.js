import {
  listPosts,
  listComments,
  createPost,
  toggleLike,
  addComment
} from "../services/posts.service.js";

const PAGE_SIZE = 6;

const formatDate = (date) => {
  if (!date) return "Recien";
  return date.toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const getInitials = (name = "") => {
  const parts = name.trim().split(" ").filter(Boolean);
  if (!parts.length) return "DM";
  return parts.slice(0, 2).map((p) => p[0]).join("").toUpperCase();
};

const buildMetaLine = (post) => {
  const parts = [];
  if (post.businessUnit) parts.push(post.businessUnit);
  if (post.managementUnit) parts.push(post.managementUnit);
  return parts.join(" - ");
};

const createSkeletonCard = () => {
  const card = document.createElement("article");
  card.className = "app-card feed-skeleton";
  card.innerHTML = `
    <div class="skeleton-line skeleton-line--title"></div>
    <div class="skeleton-line"></div>
    <div class="skeleton-line skeleton-line--short"></div>
  `;
  return card;
};

const createPostCard = (post, onAction, index = 0) => {
  const card = document.createElement("article");
  card.className = "app-card feed-card";
  card.dataset.postId = post.id;

  const header = document.createElement("div");
  header.className = "feed-card__header";

  const avatar = document.createElement("div");
  avatar.className = "feed-avatar";
  avatar.textContent = getInitials(post.authorName);

  const info = document.createElement("div");
  info.className = "feed-card__info";
  const name = document.createElement("div");
  name.className = "feed-card__name";
  name.textContent = post.authorName || "Equipo Medico";
  const meta = document.createElement("div");
  meta.className = "feed-card__meta";
  meta.textContent = buildMetaLine(post);
  info.append(name, meta);

  const time = document.createElement("div");
  time.className = "feed-card__time";
  time.textContent = formatDate(post.createdAt);

  header.append(avatar, info, time);

  const body = document.createElement("div");
  body.className = "feed-card__body";
  if (post.text) {
    const text = document.createElement("p");
    text.className = "feed-card__text";
    text.textContent = post.text;
    body.appendChild(text);
  }
  if (post.imageUrl) {
    const media = document.createElement("div");
    media.className = "feed-card__media";
    const img = document.createElement("img");
    const isPriority = index < 2;
    img.src = post.imageUrl;
    img.alt = "Imagen del post";
    img.loading = isPriority ? "eager" : "lazy";
    img.decoding = "async";
    img.fetchPriority = isPriority ? "high" : "low";
    img.classList.add("img-fade-in");
    const markLoaded = () => img.classList.add("is-loaded");
    img.addEventListener("load", markLoaded, { once: true });
    if (img.complete) markLoaded();
    media.appendChild(img);
    body.appendChild(media);
  }

  const actions = document.createElement("div");
  actions.className = "feed-card__actions";

  const likeBtn = document.createElement("button");
  likeBtn.type = "button";
  likeBtn.className = "feed-action-btn";
  likeBtn.dataset.action = "like";
  likeBtn.dataset.postId = post.id;
  likeBtn.setAttribute("aria-pressed", post.likedByMe ? "true" : "false");
  if (post.likedByMe) likeBtn.classList.add("is-active");
  likeBtn.innerHTML = `<span class="feed-action-icon">Like</span><span class="feed-action-count">${post.likeCount || 0}</span>`;

  const commentBtn = document.createElement("button");
  commentBtn.type = "button";
  commentBtn.className = "feed-action-btn";
  commentBtn.dataset.action = "comment";
  commentBtn.dataset.postId = post.id;
  commentBtn.innerHTML = `<span class="feed-action-icon">Comentar</span><span class="feed-action-count">${post.commentCount || 0}</span>`;

  actions.append(likeBtn, commentBtn);

  card.append(header, body, actions);

  likeBtn.addEventListener("click", () => onAction("like", post, likeBtn));
  commentBtn.addEventListener("click", () => onAction("comment", post, commentBtn));

  return card;
};

export default function renderFeed(container, options = {}) {
  if (!container) return;
  const {
    committeeId = null,
    title = "Feed",
    subtitle = "Historias y novedades del Departamento Medico.",
    headerActions = ""
  } = options;
  const headerActionsMarkup = headerActions
    ? `<div class="view-header__actions">${headerActions}</div>`
    : "";

  container.innerHTML = `
    <section class="view-header">
      <div class="view-header__top">
        <div>
          <h1 class="view-title">${title}</h1>
          <p class="view-subtitle">${subtitle}</p>
        </div>
        ${headerActionsMarkup}
      </div>
    </section>
    <section class="feed-shell">
      <div class="feed-layout">
        <div class="feed-main">
          <div class="app-card feed-composer">
            <form class="feed-composer__form" data-feed-form>
              <textarea class="feed-textarea" rows="3" placeholder="Comparti una novedad..." data-feed-text></textarea>
              <div class="feed-composer__actions">
                <label class="feed-btn feed-btn--ghost" for="feed-file">Foto</label>
                <input id="feed-file" class="feed-file" type="file" accept="image/*" data-feed-file />
                <button class="feed-btn feed-btn--primary" type="submit" data-feed-submit>Publicar</button>
              </div>
              <div class="feed-preview" data-feed-preview hidden></div>
            </form>
            <div class="feed-status" data-feed-status role="status" aria-live="polite">
              <div class="feed-status__text" data-feed-status-text></div>
              <div class="feed-progress" data-feed-progress hidden>
                <div class="feed-progress__bar" data-feed-progress-bar role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>
              </div>
              <button class="feed-retry" type="button" data-feed-retry hidden>Reintentar</button>
            </div>
          </div>
          <div class="feed-list" data-feed-list></div>
          <div class="feed-sentinel" data-feed-sentinel></div>
        </div>
        <aside class="feed-comments-panel" data-comments-panel aria-hidden="true">
          <div class="feed-comments-header">
            <div>
              <h2 class="feed-comments-title">Comentarios</h2>
              <p class="feed-comments-meta" data-comments-meta>Selecciona un post para ver comentarios.</p>
            </div>
            <button class="feed-comments-close" type="button" data-comments-close>Cerrar</button>
          </div>
          <div class="feed-comments-body">
            <div class="feed-comment-list" data-comments-list></div>
          </div>
          <form class="feed-comment-form" data-comments-form>
            <input class="feed-comment-input" type="text" placeholder="Escribi un comentario..." data-comments-input />
            <button class="feed-comment-btn" type="submit">Enviar</button>
          </form>
        </aside>
      </div>
      <div class="feed-comments-scrim" data-comments-scrim></div>
    </section>
  `;

  const listEl = container.querySelector("[data-feed-list]");
  const form = container.querySelector("[data-feed-form]");
  const textArea = container.querySelector("[data-feed-text]");
  const fileInput = container.querySelector("[data-feed-file]");
  const preview = container.querySelector("[data-feed-preview]");
  const status = container.querySelector("[data-feed-status]");
  const statusText = container.querySelector("[data-feed-status-text]");
  const progressWrap = container.querySelector("[data-feed-progress]");
  const progressBar = container.querySelector("[data-feed-progress-bar]");
  const retryButton = container.querySelector("[data-feed-retry]");
  const commentsPanel = container.querySelector("[data-comments-panel]");
  const commentsScrim = container.querySelector("[data-comments-scrim]");
  const commentsList = container.querySelector("[data-comments-list]");
  const commentsMeta = container.querySelector("[data-comments-meta]");
  const commentsForm = container.querySelector("[data-comments-form]");
  const commentsInput = container.querySelector("[data-comments-input]");
  const commentsClose = container.querySelector("[data-comments-close]");
  const sentinel = container.querySelector("[data-feed-sentinel]");

  let focusPostId = window.__brisaFocusPostId || "";
  if (focusPostId) window.__brisaFocusPostId = null;

  const state = {
    loading: false,
    cursor: null,
    hasMore: true
  };

  const activeCommitteeId = committeeId ?? null;
  let previewUrl = null;
  let queuedFile = null;
  let lastSubmission = null;
  let isSubmitting = false;
  let activePost = null;

  const setStatus = (message = "", tone = "info") => {
    if (!status) return;
    if (statusText) statusText.textContent = message;
    status.dataset.tone = tone;
  };

  const setProgress = (value = 0) => {
    if (!progressWrap || !progressBar) return;
    const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
    progressWrap.hidden = false;
    progressBar.style.width = `${percent}%`;
    progressBar.setAttribute("aria-valuenow", String(percent));
  };

  const resetProgress = () => {
    if (!progressWrap || !progressBar) return;
    progressWrap.hidden = true;
    progressBar.style.width = "0%";
    progressBar.setAttribute("aria-valuenow", "0");
  };

  const toggleRetry = (show) => {
    if (retryButton) retryButton.hidden = !show;
  };

  const clearPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    queuedFile = null;
    if (preview) {
      preview.innerHTML = "";
      preview.hidden = true;
    }
    if (fileInput) fileInput.value = "";
  };

  const renderPreview = (file) => {
    if (!preview || !file) return;
    previewUrl = URL.createObjectURL(file);
    queuedFile = file;
    preview.hidden = false;
    preview.innerHTML = `
      <div class="feed-preview__wrap">
        <img src="${previewUrl}" alt="Preview" />
        <button type="button" class="feed-preview__remove" data-preview-remove>Quitar</button>
      </div>
    `;
    preview.querySelector("[data-preview-remove]")?.addEventListener("click", clearPreview);
  };

  const setCommentsEmpty = (message) => {
    if (!commentsList) return;
    commentsList.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "feed-comments-empty";
    empty.textContent = message;
    commentsList.appendChild(empty);
  };

  const createCommentItem = (comment) => {
    const item = document.createElement("div");
    item.className = "feed-comment";
    const header = document.createElement("div");
    header.className = "feed-comment__header";
    const author = document.createElement("span");
    author.className = "feed-comment__author";
    author.textContent = comment.authorName || "Usuario";
    const time = document.createElement("span");
    time.className = "feed-comment__time";
    time.textContent = formatDate(comment.createdAt);
    header.append(author, time);
    const text = document.createElement("p");
    text.className = "feed-comment__text";
    text.textContent = comment.text || "";
    item.append(header, text);
    return item;
  };

  const renderComments = (comments = []) => {
    if (!commentsList) return;
    commentsList.innerHTML = "";
    if (!comments.length) {
      setCommentsEmpty("Sin comentarios aun.");
      return;
    }
    comments.forEach((comment) => {
      commentsList.appendChild(createCommentItem(comment));
    });
  };

  const loadCommentsForPost = async (postId) => {
    if (!postId) return;
    const currentId = postId;
    setCommentsEmpty("Cargando comentarios...");
    try {
      const result = await listComments({ postId, pageSize: 30 });
      if (!container.isConnected) return;
      if (activePost?.id !== currentId) return;
      renderComments(result.comments || []);
    } catch (e) {
      if (!container.isConnected) return;
      setCommentsEmpty("No se pudieron cargar los comentarios.");
    }
  };

  const openCommentsPanel = (post) => {
    if (!post || !commentsPanel) return;
    activePost = post;
    commentsPanel.classList.add("is-open");
    commentsPanel.setAttribute("aria-hidden", "false");
    if (commentsScrim) commentsScrim.classList.add("is-open");
    if (commentsMeta) {
      const snippet = post.text ? post.text.slice(0, 80) : "Sin texto";
      commentsMeta.textContent = snippet;
    }
    if (commentsInput) {
      commentsInput.disabled = false;
      commentsInput.value = "";
    }
    const submitBtn = commentsForm?.querySelector(".feed-comment-btn");
    if (submitBtn) submitBtn.disabled = false;
    loadCommentsForPost(post.id);
  };

  const closeCommentsPanel = () => {
    activePost = null;
    commentsPanel?.classList.remove("is-open");
    commentsPanel?.setAttribute("aria-hidden", "true");
    commentsScrim?.classList.remove("is-open");
    if (commentsMeta) {
      commentsMeta.textContent = "Selecciona un post para ver comentarios.";
    }
    if (commentsInput) {
      commentsInput.value = "";
      commentsInput.disabled = true;
    }
    const submitBtn = commentsForm?.querySelector(".feed-comment-btn");
    if (submitBtn) submitBtn.disabled = true;
    setCommentsEmpty("Selecciona un post para ver comentarios.");
  };

  const updateCommentCount = (postId, delta = 1) => {
    if (!listEl || !postId) return;
    const card = listEl.querySelector(`[data-post-id="${postId}"]`);
    const counter = card?.querySelector('[data-action="comment"] .feed-action-count');
    if (counter) {
      const next = Math.max(0, (Number(counter.textContent) || 0) + delta);
      counter.textContent = String(next);
    }
  };

  const tryFocusPost = () => {
    if (!focusPostId || !listEl) return;
    const card = listEl.querySelector(`[data-post-id="${focusPostId}"]`);
    if (!card) return;
    focusPostId = "";
    card.classList.add("feed-card--focus");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      card.classList.remove("feed-card--focus");
    }, 1800);
  };

  const appendPosts = (posts = []) => {
    if (!listEl) return;
    const startIndex = listEl.querySelectorAll(".feed-card").length;
    posts.forEach((post, idx) => {
      const card = createPostCard(post, handleAction, startIndex + idx);
      listEl.appendChild(card);
    });
    tryFocusPost();
  };

  const loadPosts = async (initial = false) => {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    const skeletons = [];
    if (listEl) {
      for (let i = 0; i < 3; i += 1) {
        const skeleton = createSkeletonCard();
        skeletons.push(skeleton);
        listEl.appendChild(skeleton);
      }
    }
    try {
      const result = await listPosts({
        committeeId: activeCommitteeId,
        pageSize: PAGE_SIZE,
        cursor: state.cursor
      });
      if (!container.isConnected) return;
      skeletons.forEach((s) => s.remove());
      appendPosts(result.posts);
      state.cursor = result.cursor;
      state.hasMore = result.hasMore;
      if (initial && result.posts.length === 0) {
        const emptyMessage = activeCommitteeId
          ? "No hay publicaciones en este comite."
          : "Todavia no hay publicaciones. Abri el feed.";
        setStatus(emptyMessage, "empty");
      } else {
        setStatus("");
      }
    } catch (e) {
      skeletons.forEach((s) => s.remove());
      setStatus("No se pudo cargar el feed. Intenta nuevamente.", "error");
    } finally {
      state.loading = false;
    }
  };

  const resetFeed = () => {
    if (listEl) listEl.innerHTML = "";
    state.cursor = null;
    state.hasMore = true;
    loadPosts(true);
  };

  const handleAction = async (action, post, target) => {
    if (action === "like") {
      target.disabled = true;
      try {
        const result = await toggleLike({ postId: post.id });
        if (!container.isConnected) return;
        const countEl = target.querySelector(".feed-action-count");
        if (countEl) countEl.textContent = String(result.likeCount);
        target.classList.toggle("is-active", result.liked);
        target.setAttribute("aria-pressed", result.liked ? "true" : "false");
      } catch (e) {
        setStatus("Inicia sesion para dar like.", "warn");
      } finally {
        target.disabled = false;
      }
    }

    if (action === "comment") {
      openCommentsPanel(post);
    }
  };

  const submitPost = async ({ text = "", imageFile = null, committeeId = null } = {}) => {
    if (!form || isSubmitting) return;
    const submitBtn = form.querySelector("[data-feed-submit]");
    if (!submitBtn) return;

    isSubmitting = true;
    submitBtn.disabled = true;
    toggleRetry(false);
    setStatus("");
    resetProgress();

    lastSubmission = { text, imageFile, committeeId };

    if (imageFile) {
      setStatus("Subiendo imagen...", "info");
      setProgress(0);
    }

    try {
      await createPost({
        text,
        imageFile,
        committeeId: activeCommitteeId,
        onProgress: (info) => {
          if (!imageFile) return;
          setProgress(info.progress || 0);
        }
      });
      if (!container.isConnected) return;
      textArea.value = "";
      clearPreview();
      resetProgress();
      setStatus("Publicacion creada.", "success");
      lastSubmission = null;
      resetFeed();
    } catch (e) {
      if (e.message === "EMPTY_POST") {
        resetProgress();
        setStatus("Escribi algo o adjunta una foto.", "warn");
      } else if (e.message === "AUTH_REQUIRED") {
        resetProgress();
        setStatus("Inicia sesion para publicar.", "warn");
      } else if (e.message === "UPLOAD_FAILED") {
        setStatus("No se pudo subir la imagen. Reintenta.", "error");
        toggleRetry(true);
      } else {
        resetProgress();
        setStatus("No se pudo publicar. Intenta nuevamente.", "error");
      }
    } finally {
      submitBtn.disabled = false;
      isSubmitting = false;
    }
  };

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!textArea) return;
    submitPost({
      text: textArea.value,
      imageFile: queuedFile,
      committeeId: null
    });
  });

  retryButton?.addEventListener("click", () => {
    if (!lastSubmission) return;
    submitPost(lastSubmission);
  });

  fileInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) {
      renderPreview(file);
    } else {
      clearPreview();
    }
  });

  commentsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activePost || !commentsInput) return;
    const text = commentsInput.value.trim();
    if (!text) return;
    const submitBtn = commentsForm.querySelector(".feed-comment-btn");
    if (!submitBtn) return;
    submitBtn.disabled = true;
    try {
      const result = await addComment({ postId: activePost.id, text });
      if (!container.isConnected) return;
      commentsInput.value = "";
      commentsList?.prepend(createCommentItem(result));
      updateCommentCount(activePost.id, 1);
      activePost.commentCount = (activePost.commentCount || 0) + 1;
    } catch (e) {
      setStatus("Inicia sesion para comentar.", "warn");
    } finally {
      submitBtn.disabled = false;
    }
  });

  commentsClose?.addEventListener("click", closeCommentsPanel);
  commentsScrim?.addEventListener("click", closeCommentsPanel);
  if (commentsInput) commentsInput.disabled = true;
  const commentsSubmit = commentsForm?.querySelector(".feed-comment-btn");
  if (commentsSubmit) commentsSubmit.disabled = true;
  setCommentsEmpty("Selecciona un post para ver comentarios.");

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadPosts(false);
      }
    },
    { rootMargin: "300px" }
  );

  if (sentinel) observer.observe(sentinel);
  loadPosts(true);
}
