import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { escapeAttribute, escapeHTML } from "../utils/safe-dom.js";

const LOCAL_NOTE_PREFIX = "local_note_";
const NOTE_SCOPE_COMMITTEE = "committee";
const NOTE_SCOPE_PROJECT = "project";
const ORPHAN_PROJECT_COLUMN = "__orphan_project_notes__";

const toMillis = (value) => {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
  }
  if (value) {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const formatNoteDate = (value) => {
  const millis = toMillis(value);
  if (!millis) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(millis));
};

const resolveUserName = (user) => {
  const raw = user?.displayName || user?.email || "Usuario";
  return String(raw).trim() || "Usuario";
};

const normalizeLikedBy = (likedBy) => {
  if (!likedBy || typeof likedBy !== "object" || Array.isArray(likedBy)) return {};
  return Object.fromEntries(
    Object.entries(likedBy)
      .filter(([uid]) => uid)
      .map(([uid, name]) => [uid, String(name || "Usuario").trim() || "Usuario"])
  );
};

const formatLikeNames = (likedBy = {}) => {
  const names = Object.values(normalizeLikedBy(likedBy)).filter(Boolean);
  if (!names.length) return "Sin likes";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} y ${names.length - 3} mas`;
};

const normalizeNote = (id, data = {}) => ({
  id,
  committeeId: data.committeeId || "",
  scope: data.scope === NOTE_SCOPE_PROJECT ? NOTE_SCOPE_PROJECT : NOTE_SCOPE_COMMITTEE,
  projectId: data.projectId || "",
  projectTitle: data.projectTitle || "",
  text: data.text || "",
  authorUid: data.authorUid || "",
  authorName: data.authorName || "Usuario",
  createdAt: data.createdAt || data.updatedAt || null,
  updatedAt: data.updatedAt || data.createdAt || null,
  updatedByUid: data.updatedByUid || "",
  updatedByName: data.updatedByName || "",
  likedBy: normalizeLikedBy(data.likedBy)
});

export function createCommitteeNotesController({
  db,
  auth,
  appId,
  committeeId,
  getTopics,
  getIsAdmin,
  onChange
} = {}) {
  let notes = [];
  let unsubscribe = null;
  let initialized = false;
  let selectedProjectId = "";
  let editingNoteId = "";
  const els = {};

  const getTopicList = () => {
    const topics = typeof getTopics === "function" ? getTopics() : [];
    return Array.isArray(topics) ? topics.filter((topic) => topic && topic.id) : [];
  };

  const getTopicById = (projectId) => getTopicList().find((topic) => topic.id === projectId) || null;

  const sortNotes = () => {
    notes.sort((a, b) => toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt));
  };

  const canManageNote = (note) => {
    const user = auth?.currentUser;
    if (!user) return false;
    return Boolean(getIsAdmin?.()) || note.authorUid === user.uid;
  };

  const userLikedNote = (note) => {
    const uid = auth?.currentUser?.uid;
    return Boolean(uid && normalizeLikedBy(note.likedBy)[uid]);
  };

  const syncElements = () => {
    els.toggle = document.getElementById("committee-board-toggle");
    els.panel = document.getElementById("committee-board-panel");
    els.close = document.querySelector("[data-committee-board-close]");
    els.add = document.getElementById("committee-note-add");
    els.columns = document.getElementById("committee-board-columns");
    els.modal = document.getElementById("committee-note-modal");
    els.modalClose = document.querySelector("[data-committee-note-modal-close]");
    els.form = document.getElementById("committee-note-form");
    els.scope = document.getElementById("committee-note-scope");
    els.text = document.getElementById("committee-note-text");
    els.count = document.getElementById("committee-board-count");
    els.hint = document.getElementById("committee-note-context-hint");
    els.formTitle = document.getElementById("committee-note-modal-title");
    els.submitLabel = document.getElementById("committee-note-submit-label");
  };

  const ensureBoardPortal = () => {
    syncElements();
    if (els.toggle && els.toggle.parentElement !== document.body) {
      document.body.appendChild(els.toggle);
    }
    if (els.panel && els.panel.parentElement !== document.body) {
      document.body.appendChild(els.panel);
    }
    syncElements();
  };

  const setOpenState = (open) => {
    syncElements();
    if (!els.panel || !els.toggle) return;
    if (open) {
      els.panel.removeAttribute("hidden");
      els.toggle.setAttribute("aria-expanded", "true");
    } else {
      els.panel.setAttribute("hidden", "");
      els.toggle.setAttribute("aria-expanded", "false");
      closeComposer();
    }
  };

  const setComposerOpen = (open) => {
    syncElements();
    if (!els.modal) return;
    if (open) {
      els.modal.removeAttribute("hidden");
    } else {
      els.modal.setAttribute("hidden", "");
      editingNoteId = "";
      if (els.text) els.text.value = "";
      if (els.scope) els.scope.disabled = false;
    }
  };

  const renderScopeOptions = () => {
    if (!els.scope) return;
    const topics = getTopicList();
    const projectOptions = topics
      .map((topic) => `<option value="${escapeAttribute(topic.id)}">Proyecto de ${escapeHTML(topic.title || "Proyecto sin titulo")}</option>`)
      .join("");
    els.scope.innerHTML = `
      <option value="">Nota de comité</option>
      ${projectOptions}
    `;
    if (selectedProjectId && topics.some((topic) => topic.id === selectedProjectId)) {
      els.scope.value = selectedProjectId;
    } else {
      selectedProjectId = "";
      els.scope.value = "";
    }
    renderContextHint();
  };

  const renderContextHint = () => {
    if (!els.hint || !els.scope) return;
    const projectId = els.scope.value || "";
    const topic = projectId ? getTopicById(projectId) : null;
    els.hint.textContent = topic
      ? `La nota quedara ubicada en la columna Proyecto de ${topic.title || "este proyecto"}.`
      : "La nota quedara ubicada en la columna Nota de comité.";
  };

  const getNotesForColumn = (column) => {
    if (column.kind === NOTE_SCOPE_COMMITTEE) {
      return notes.filter((note) => note.scope !== NOTE_SCOPE_PROJECT || !note.projectId);
    }
    if (column.id === ORPHAN_PROJECT_COLUMN) {
      return notes.filter((note) => note.scope === NOTE_SCOPE_PROJECT && note.projectId && !getTopicById(note.projectId));
    }
    return notes.filter((note) => note.scope === NOTE_SCOPE_PROJECT && note.projectId === column.id);
  };

  const buildColumns = () => {
    const topics = getTopicList();
    const columns = [
      {
        id: NOTE_SCOPE_COMMITTEE,
        kind: NOTE_SCOPE_COMMITTEE,
        title: "Nota de comité",
        subtitle: "Comentarios generales",
        icon: "clipboard-list"
      },
      ...topics.map((topic) => ({
        id: topic.id,
        kind: NOTE_SCOPE_PROJECT,
        title: topic.title || "Proyecto sin titulo",
        subtitle: "Proyecto",
        icon: "folder-kanban"
      }))
    ];
    const hasOrphans = notes.some((note) => note.scope === NOTE_SCOPE_PROJECT && note.projectId && !getTopicById(note.projectId));
    if (hasOrphans) {
      columns.push({
        id: ORPHAN_PROJECT_COLUMN,
        kind: NOTE_SCOPE_PROJECT,
        title: "Proyecto no disponible",
        subtitle: "Notas sin proyecto activo",
        icon: "folder-x"
      });
    }
    return columns;
  };

  const renderNoteCard = (note, column) => {
    const likedBy = normalizeLikedBy(note.likedBy);
    const likeCount = Object.keys(likedBy).length;
    const liked = userLikedNote(note);
    const likeNames = formatLikeNames(likedBy);
    const editedLabel = note.updatedByName && toMillis(note.updatedAt) !== toMillis(note.createdAt)
      ? `<span>Editado por ${escapeHTML(note.updatedByName)}</span>`
      : "";
    const safeNoteId = escapeAttribute(JSON.stringify(note.id));
    const destinationLabel = column.kind === NOTE_SCOPE_PROJECT
      ? `Proyecto de ${column.title}`
      : "Nota de comité";
    return `
      <article class="committee-board-note" data-note-id="${escapeAttribute(note.id)}">
        <div class="committee-board-note__header">
          <span class="committee-board-note__scope" title="${escapeAttribute(destinationLabel)}">${escapeHTML(destinationLabel)}</span>
          ${canManageNote(note) ? `
            <span class="committee-board-note__actions">
              <button type="button" onclick="window.editCommitteeNote(${safeNoteId})" title="Editar nota">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" onclick="window.deleteCommitteeNote(${safeNoteId})" title="Borrar nota">
                <i data-lucide="trash-2"></i>
              </button>
            </span>
          ` : ""}
        </div>
        <p class="committee-board-note__text">${escapeHTML(note.text)}</p>
        <div class="committee-board-note__meta">
          <span>${escapeHTML(note.authorName || "Usuario")}</span>
          <span>${escapeHTML(formatNoteDate(note.createdAt || note.updatedAt))}</span>
          ${editedLabel}
        </div>
        <div class="committee-board-note__footer">
          <button
            type="button"
            class="committee-board-note__like${liked ? " is-active" : ""}"
            onclick="window.toggleCommitteeNoteLike(${safeNoteId})"
            aria-pressed="${liked ? "true" : "false"}"
            title="${escapeAttribute(likeNames)}">
            <i data-lucide="thumbs-up"></i>
            <span>${likeCount}</span>
          </button>
          <span class="committee-board-note__like-names" title="${escapeAttribute(likeNames)}">${escapeHTML(likeNames)}</span>
        </div>
      </article>
    `;
  };

  const renderColumns = () => {
    if (!els.columns) return;
    const columns = buildColumns();
    els.columns.innerHTML = columns.map((column) => {
      const columnNotes = getNotesForColumn(column);
      return `
        <section class="committee-board-column" data-board-column="${escapeAttribute(column.id)}">
          <header class="committee-board-column__header">
            <span class="committee-board-column__icon"><i data-lucide="${escapeAttribute(column.icon)}"></i></span>
            <div>
              <p class="committee-board-column__eyebrow">${escapeHTML(column.subtitle)}</p>
              <h4 class="committee-board-column__title">${escapeHTML(column.title)}</h4>
            </div>
            <span class="committee-board-column__count">${columnNotes.length}</span>
          </header>
          <div class="committee-board-column__notes">
            ${columnNotes.length
              ? columnNotes.map((note) => renderNoteCard(note, column)).join("")
              : `
                <div class="committee-board-column__empty">
                  <i data-lucide="message-square-text"></i>
                  <span>Sin notas en esta columna.</span>
                </div>
              `}
          </div>
        </section>
      `;
    }).join("");
  };

  const render = () => {
    syncElements();
    if (els.count) els.count.textContent = String(notes.length);
    renderScopeOptions();
    renderColumns();
    if (window.lucide) window.lucide.createIcons();
  };

  const saveNote = async ({ projectId, text }) => {
    const cleanText = String(text || "").trim();
    if (!cleanText) return;
    const user = auth?.currentUser;
    if (!user) {
      if (window.Swal) {
        await window.Swal.fire("Acceso restringido", "Iniciá sesión para agregar una nota.", "warning");
      }
      return;
    }
    const topic = projectId ? getTopicById(projectId) : null;
    const nowIso = new Date().toISOString();
    const payload = {
      committeeId,
      scope: topic ? NOTE_SCOPE_PROJECT : NOTE_SCOPE_COMMITTEE,
      projectId: topic ? topic.id : null,
      projectTitle: topic ? String(topic.title || "") : "",
      text: cleanText,
      authorUid: user.uid,
      authorName: resolveUserName(user),
      createdAt: db ? serverTimestamp() : nowIso,
      updatedAt: db ? serverTimestamp() : nowIso,
      likedBy: {}
    };

    if (!db) {
      notes.unshift(normalizeNote(`${LOCAL_NOTE_PREFIX}${Date.now()}`, payload));
      render();
      onChange?.();
      return;
    }

    await addDoc(collection(db, "artifacts", appId, "public", "data", "committee_notes"), payload);
  };

  const updateNoteText = async ({ note, text }) => {
    const user = auth?.currentUser;
    const nextText = String(text || "").trim();
    if (!note || !user || !canManageNote(note) || !nextText || nextText === String(note.text || "").trim()) return;

    if (!db || note.id.startsWith(LOCAL_NOTE_PREFIX)) {
      notes = notes.map((item) => item.id === note.id
        ? {
            ...item,
            text: nextText,
            updatedAt: new Date().toISOString(),
            updatedByUid: user.uid,
            updatedByName: resolveUserName(user)
          }
        : item);
      render();
      onChange?.();
      return;
    }

    await updateDoc(doc(db, "artifacts", appId, "public", "data", "committee_notes", note.id), {
      text: nextText,
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
      updatedByName: resolveUserName(user)
    });
  };

  const openComposer = ({ projectId = "", note = null } = {}) => {
    syncElements();
    editingNoteId = note?.id || "";
    selectedProjectId = note ? (note.projectId || "") : (projectId || "");
    renderScopeOptions();
    if (els.scope) {
      els.scope.value = selectedProjectId || "";
      els.scope.disabled = Boolean(note);
    }
    if (els.text) els.text.value = note?.text || "";
    if (els.formTitle) els.formTitle.textContent = note ? "Editar nota" : "Agregar nota";
    if (els.submitLabel) els.submitLabel.textContent = note ? "Guardar nota" : "Agregar nota";
    renderContextHint();
    setComposerOpen(true);
    window.requestAnimationFrame(() => els.text?.focus());
  };

  function closeComposer() {
    setComposerOpen(false);
  }

  const editNote = (noteId) => {
    const note = notes.find((item) => item.id === noteId);
    if (!note || !canManageNote(note)) {
      if (window.Swal) {
        window.Swal.fire("Acceso restringido", "Solo podés editar tus notas o moderar como administrador.", "error");
      }
      return;
    }
    setOpenState(true);
    openComposer({ note });
  };

  const deleteNote = async (noteId) => {
    const note = notes.find((item) => item.id === noteId);
    if (!note || !canManageNote(note)) return;
    const result = window.Swal
      ? await window.Swal.fire({
          title: "Borrar nota",
          text: "Esta acción no se puede deshacer.",
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Borrar",
          cancelButtonText: "Cancelar",
          confirmButtonColor: "#dc2626"
        })
      : { isConfirmed: window.confirm("Borrar nota?") };
    if (!result.isConfirmed) return;

    if (!db || note.id.startsWith(LOCAL_NOTE_PREFIX)) {
      notes = notes.filter((item) => item.id !== note.id);
      render();
      onChange?.();
      return;
    }

    await deleteDoc(doc(db, "artifacts", appId, "public", "data", "committee_notes", note.id));
  };

  const toggleNoteLike = async (noteId) => {
    const note = notes.find((item) => item.id === noteId);
    const user = auth?.currentUser;
    if (!note || !user) {
      if (window.Swal) {
        await window.Swal.fire("Acceso restringido", "Iniciá sesión para indicar like.", "warning");
      }
      return;
    }
    const likedBy = normalizeLikedBy(note.likedBy);
    const liked = Boolean(likedBy[user.uid]);

    if (!db || note.id.startsWith(LOCAL_NOTE_PREFIX)) {
      const nextLikedBy = { ...likedBy };
      if (liked) delete nextLikedBy[user.uid];
      else nextLikedBy[user.uid] = resolveUserName(user);
      notes = notes.map((item) => item.id === note.id ? { ...item, likedBy: nextLikedBy } : item);
      render();
      onChange?.();
      return;
    }

    await updateDoc(doc(db, "artifacts", appId, "public", "data", "committee_notes", note.id), {
      [`likedBy.${user.uid}`]: liked ? deleteField() : resolveUserName(user)
    });
  };

  const open = (projectId = "", options = {}) => {
    selectedProjectId = projectId || "";
    render();
    setOpenState(true);
    if (options.openComposer) {
      window.requestAnimationFrame(() => openComposer({ projectId: selectedProjectId }));
    }
  };

  const openProjectNote = (projectId = "") => open(projectId, { openComposer: true });

  const close = () => setOpenState(false);

  const subscribe = () => {
    if (!db || !committeeId) {
      render();
      return;
    }
    if (typeof unsubscribe === "function") unsubscribe();
    const notesRef = query(
      collection(db, "artifacts", appId, "public", "data", "committee_notes"),
      where("committeeId", "==", committeeId)
    );
    unsubscribe = onSnapshot(notesRef, (snap) => {
      notes = snap.docs.map((item) => normalizeNote(item.id, item.data()));
      sortNotes();
      render();
      onChange?.();
    }, (error) => {
      console.error("Error suscribiendo notas del comité:", error);
    });
  };

  const stop = () => {
    if (typeof unsubscribe === "function") unsubscribe();
    unsubscribe = null;
    notes = [];
    render();
  };

  const init = () => {
    if (initialized) return;
    initialized = true;
    ensureBoardPortal();
    els.add?.addEventListener("click", (event) => {
      event.preventDefault();
      setOpenState(true);
      openComposer({ projectId: "" });
    });
    els.close?.addEventListener("click", (event) => {
      event.preventDefault();
      close();
    });
    els.modalClose?.addEventListener("click", (event) => {
      event.preventDefault();
      closeComposer();
    });
    els.modal?.addEventListener("click", (event) => {
      if (event.target === els.modal) closeComposer();
    });
    els.scope?.addEventListener("change", () => {
      selectedProjectId = els.scope.value || "";
      renderContextHint();
    });
    els.form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const note = editingNoteId ? notes.find((item) => item.id === editingNoteId) : null;
      const projectId = els.scope?.value || "";
      const text = els.text?.value || "";
      try {
        if (note) await updateNoteText({ note, text });
        else await saveNote({ projectId, text });
        closeComposer();
      } catch (error) {
        console.error("Error guardando nota del comité:", error);
        if (window.Swal) {
          window.Swal.fire("Error", "No se pudo guardar la nota.", "error");
        }
      }
    });
    document.addEventListener("click", (event) => {
      const toggleTarget = event.target?.closest?.("#committee-board-toggle");
      if (toggleTarget) {
        event.preventDefault();
        syncElements();
        const isOpen = els.panel && !els.panel.hasAttribute("hidden");
        if (isOpen) close();
        else open();
        return;
      }
      if (!els.panel || els.panel.hasAttribute("hidden")) return;
      const target = event.target;
      if (els.panel.contains(target) || els.toggle?.contains(target)) return;
      close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (els.modal && !els.modal.hasAttribute("hidden")) closeComposer();
      else close();
    });
    window.openCommitteeBoard = open;
    window.openCommitteeProjectNote = openProjectNote;
    window.editCommitteeNote = editNote;
    window.deleteCommitteeNote = deleteNote;
    window.toggleCommitteeNoteLike = toggleNoteLike;
    render();
  };

  return {
    init,
    render,
    subscribe,
    unsubscribe: stop,
    open,
    close,
    getNotes: () => [...notes]
  };
}
