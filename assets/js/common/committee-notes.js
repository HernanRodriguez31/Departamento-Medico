import {
  addDoc,
  collection,
  deleteDoc,
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
  updatedByName: data.updatedByName || ""
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
  const els = {};

  const getTopicList = () => {
    const topics = typeof getTopics === "function" ? getTopics() : [];
    return Array.isArray(topics) ? topics : [];
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

  const syncElements = () => {
    els.toggle = document.getElementById("committee-board-toggle");
    els.panel = document.getElementById("committee-board-panel");
    els.close = document.querySelector("[data-committee-board-close]");
    els.form = document.getElementById("committee-note-form");
    els.scope = document.getElementById("committee-note-scope");
    els.text = document.getElementById("committee-note-text");
    els.list = document.getElementById("committee-board-notes");
    els.count = document.getElementById("committee-board-count");
    els.hint = document.getElementById("committee-note-context-hint");
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
    }
  };

  const renderScopeOptions = () => {
    if (!els.scope) return;
    const topics = getTopicList().filter((topic) => topic && topic.id);
    const projectOptions = topics
      .map((topic) => `<option value="${escapeAttribute(topic.id)}">${escapeHTML(topic.title || "Proyecto sin titulo")}</option>`)
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
      ? `La nota quedará asociada a ${topic.title || "este proyecto"}.`
      : "La nota quedará asociada al comité.";
  };

  const renderNotes = () => {
    if (!els.list) return;
    sortNotes();
    if (!notes.length) {
      els.list.innerHTML = `
        <div class="committee-board-empty">
          <i data-lucide="clipboard-list"></i>
          <span>No hay notas cargadas en el pizarrón.</span>
        </div>
      `;
      return;
    }
    els.list.innerHTML = notes.map((note) => {
      const topic = note.projectId ? getTopicById(note.projectId) : null;
      const scopeLabel = note.scope === NOTE_SCOPE_PROJECT
        ? (topic?.title || note.projectTitle || "Proyecto")
        : "Nota de comité";
      const editedLabel = note.updatedByName && toMillis(note.updatedAt) !== toMillis(note.createdAt)
        ? `<span>Editado por ${escapeHTML(note.updatedByName)}</span>`
        : "";
      const safeNoteId = escapeAttribute(JSON.stringify(note.id));
      return `
        <article class="committee-board-note" data-note-id="${escapeAttribute(note.id)}">
          <div class="committee-board-note__header">
            <span class="committee-board-note__scope">${escapeHTML(scopeLabel)}</span>
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
        </article>
      `;
    }).join("");
  };

  const render = () => {
    syncElements();
    if (els.count) els.count.textContent = String(notes.length);
    renderScopeOptions();
    renderNotes();
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
      updatedAt: db ? serverTimestamp() : nowIso
    };

    if (!db) {
      notes.unshift(normalizeNote(`${LOCAL_NOTE_PREFIX}${Date.now()}`, payload));
      render();
      onChange?.();
      return;
    }

    await addDoc(collection(db, "artifacts", appId, "public", "data", "committee_notes"), payload);
  };

  const editNote = async (noteId) => {
    const note = notes.find((item) => item.id === noteId);
    const user = auth?.currentUser;
    if (!note || !user || !canManageNote(note)) {
      if (window.Swal) {
        await window.Swal.fire("Acceso restringido", "Solo podés editar tus notas o moderar como administrador.", "error");
      }
      return;
    }

    const result = window.Swal
      ? await window.Swal.fire({
          title: "Editar nota",
          input: "textarea",
          inputValue: note.text || "",
          inputPlaceholder: "Escribí la nota",
          showCancelButton: true,
          confirmButtonText: "Guardar",
          cancelButtonText: "Cancelar",
          inputValidator: (value) => (!value || !value.trim() ? "Escribí una nota." : null)
        })
      : { isConfirmed: true, value: window.prompt("Editar nota", note.text || "") };

    if (!result.isConfirmed) return;
    const nextText = String(result.value || "").trim();
    if (!nextText || nextText === String(note.text || "").trim()) return;

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

  const open = (projectId = "") => {
    selectedProjectId = projectId || "";
    render();
    setOpenState(true);
    window.requestAnimationFrame(() => {
      if (els.scope && selectedProjectId) {
        els.scope.value = selectedProjectId;
        renderContextHint();
      }
      els.text?.focus();
    });
  };

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
    syncElements();
    els.toggle?.addEventListener("click", (event) => {
      event.preventDefault();
      const isOpen = els.panel && !els.panel.hasAttribute("hidden");
      if (isOpen) close();
      else open();
    });
    els.close?.addEventListener("click", (event) => {
      event.preventDefault();
      close();
    });
    els.scope?.addEventListener("change", () => {
      selectedProjectId = els.scope.value || "";
      renderContextHint();
    });
    els.form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const projectId = els.scope?.value || "";
      const text = els.text?.value || "";
      try {
        await saveNote({ projectId, text });
        if (els.text) els.text.value = "";
      } catch (error) {
        console.error("Error guardando nota del comité:", error);
        if (window.Swal) {
          window.Swal.fire("Error", "No se pudo guardar la nota.", "error");
        }
      }
    });
    document.addEventListener("click", (event) => {
      if (!els.panel || els.panel.hasAttribute("hidden")) return;
      const target = event.target;
      if (els.panel.contains(target) || els.toggle?.contains(target)) return;
      close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    window.openCommitteeBoard = open;
    window.openCommitteeProjectNote = open;
    window.editCommitteeNote = editNote;
    window.deleteCommitteeNote = deleteNote;
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
