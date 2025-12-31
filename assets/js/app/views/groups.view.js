import { getFirebase } from "../../common/firebaseClient.js";
import renderFeed from "./feed.view.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  where,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const APP_ID = window.__APP_ID__ || "departamento-medico-brisa";

const resolveRouteCommitteeId = () => {
  const hash = window.location.hash || "";
  const match = hash.match(/^#\/groups\/([^/?]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch (e) {
    return match[1];
  }
};

const normalize = (value) => String(value || "").toLowerCase();

const resolveValue = (obj, keys, fallback = "") => {
  for (const key of keys) {
    if (obj && obj[key]) return obj[key];
  }
  return fallback;
};

const formatCommitteeTitle = (meta, fallback = "Comite") =>
  meta?.title || meta?.nombre || meta?.name || meta?.committeeName || fallback;

const formatCommitteeSubtitle = (meta, fallback = "Comite de trabajo.") =>
  meta?.subtitle || meta?.descripcion || meta?.description || fallback;

const buildChips = (meta) => {
  const bu = resolveValue(meta, ["businessUnit", "unidadNegocio", "bu"], "");
  const mu = resolveValue(meta, ["managementUnit", "unidadGestion", "mu"], "");
  const chips = [];
  if (bu) chips.push(`<span class="group-chip">BU: ${bu}</span>`);
  if (mu) chips.push(`<span class="group-chip">MU: ${mu}</span>`);
  return chips.join("");
};

const setJoinButtonState = (btn, isMember) => {
  if (!btn) return;
  if (isMember) {
    btn.disabled = true;
    btn.classList.add("is-member");
    btn.textContent = "Ya sos integrante";
  } else {
    btn.disabled = false;
    btn.classList.remove("is-member");
    btn.textContent = "Unirme";
  }
};

const fetchMemberships = async (db, uid) => {
  const membersRef = collection(db, "artifacts", APP_ID, "public", "data", "committee_members");
  const snap = await getDocs(query(membersRef, where("userUid", "==", uid)));
  return new Set(snap.docs.map((docSnap) => docSnap.data()?.committeeId).filter(Boolean));
};

const joinCommittee = async ({ db, auth, committeeId, button, setStatus }) => {
  const user = auth?.currentUser;
  if (!user) {
    setStatus("Inicia sesion para unirte a un comite.", "warn");
    return false;
  }
  if (!committeeId) return false;
  if (!button) return false;

  button.disabled = true;
  button.textContent = "Uniendote...";

  try {
    const membersRef = collection(db, "artifacts", APP_ID, "public", "data", "committee_members");
    const existing = await getDocs(
      query(membersRef, where("committeeId", "==", committeeId), where("userUid", "==", user.uid))
    );
    if (!existing.empty) {
      setJoinButtonState(button, true);
      setStatus("Ya sos integrante de este comite.", "info");
      return true;
    }

    const profileSnap = await getDoc(doc(db, "usuarios", user.uid));
    if (!profileSnap.exists()) {
      setJoinButtonState(button, false);
      setStatus("No encontramos tu perfil. Volve a iniciar sesion.", "error");
      return false;
    }

    const profile = profileSnap.data() || {};
    const displayName =
      resolveValue(profile, ["displayName", "nombreCompleto", "apellidoNombre", "fullName", "name", "nombre"], "") ||
      `${resolveValue(profile, ["apellido", "lastName"], "")} ${resolveValue(profile, ["nombre"], "")}`.trim() ||
      user.displayName ||
      user.email ||
      "Usuario";
    const businessUnit = resolveValue(profile, ["businessUnit", "unidadNegocio", "bu", "business_unit"], "");
    const managementUnit = resolveValue(profile, ["managementUnit", "unidadGestion", "mu", "management_unit"], "");

    await addDoc(membersRef, {
      committeeId,
      userUid: user.uid,
      name: displayName,
      businessUnit,
      managementUnit,
      isLeader: false,
      createdAt: serverTimestamp()
    });

    setJoinButtonState(button, true);
    setStatus("Te sumaste al comite.", "success");
    return true;
  } catch (e) {
    setJoinButtonState(button, false);
    setStatus("No se pudo unir al comite. Intenta nuevamente.", "error");
    return false;
  }
};

const renderListView = async (container, { db, auth }) => {
  container.innerHTML = `
    <section class="view-header">
      <div class="view-header__top">
        <div>
          <h1 class="view-title">Comites</h1>
          <p class="view-subtitle">Explora comites y entra a sus publicaciones.</p>
        </div>
      </div>
    </section>
    <section class="groups-toolbar">
      <label class="groups-search">
        <span class="groups-search__label">Buscar comite</span>
        <input class="groups-search__input" type="search" placeholder="Buscar comite..." data-groups-search />
      </label>
      <div class="groups-status" data-groups-status></div>
    </section>
    <section class="groups-grid" data-groups-list></section>
  `;

  const listEl = container.querySelector("[data-groups-list]");
  const searchInput = container.querySelector("[data-groups-search]");
  const statusEl = container.querySelector("[data-groups-status]");

  const setStatus = (message = "", tone = "info") => {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  };

  setStatus("Cargando comites...", "info");

  let committees = [];
  try {
    const snap = await getDocs(
      collection(db, "artifacts", APP_ID, "public", "data", "committee_meta")
    );
    committees = snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
  } catch (e) {
    setStatus("No se pudieron cargar los comites.", "error");
    return;
  }

  committees.sort((a, b) => formatCommitteeTitle(a, a.id).localeCompare(formatCommitteeTitle(b, b.id)));

  const renderCards = (memberships = new Set()) => {
    if (!listEl) return;
    listEl.innerHTML = "";
    committees.forEach((committee) => {
      const title = formatCommitteeTitle(committee, committee.id);
      const subtitle = formatCommitteeSubtitle(committee);
      const chipMarkup = buildChips(committee);
      const card = document.createElement("article");
      card.className = "app-card group-card";
      card.dataset.committeeId = committee.id;
      card.dataset.search = normalize(`${title} ${subtitle} ${committee.id}`);
      card.innerHTML = `
        <div class="group-card__body">
          <h3 class="group-card__title">${title}</h3>
          <p class="group-card__subtitle">${subtitle}</p>
          ${chipMarkup ? `<div class="group-card__chips">${chipMarkup}</div>` : ""}
        </div>
        <div class="group-card__actions">
          <button class="group-join-btn" type="button" data-committee-join="${committee.id}">Unirme</button>
        </div>
      `;
      const joinBtn = card.querySelector("[data-committee-join]");
      setJoinButtonState(joinBtn, memberships.has(committee.id));

      joinBtn?.addEventListener("click", async (event) => {
        event.stopPropagation();
        await joinCommittee({
          db,
          auth,
          committeeId: committee.id,
          button: joinBtn,
          setStatus
        });
      });

      card.addEventListener("click", (event) => {
        if (event.target.closest("button, input, textarea, select, label")) return;
        window.location.hash = `#/groups/${encodeURIComponent(committee.id)}`;
      });

      listEl.appendChild(card);
    });
  };

  let memberships = new Set();
  if (auth?.currentUser) {
    try {
      memberships = await fetchMemberships(db, auth.currentUser.uid);
    } catch (e) {
      memberships = new Set();
    }
  }
  renderCards(memberships);
  setStatus("", "info");

  const applySearch = () => {
    if (!listEl || !searchInput) return;
    const queryValue = normalize(searchInput.value);
    const cards = Array.from(listEl.querySelectorAll(".group-card"));
    let visibleCount = 0;
    cards.forEach((card) => {
      const match = !queryValue || card.dataset.search.includes(queryValue);
      card.hidden = !match;
      if (match) visibleCount += 1;
    });
    if (!visibleCount) {
      setStatus("No hay comites con ese criterio.", "warn");
    } else {
      setStatus("", "info");
    }
  };

  searchInput?.addEventListener("input", applySearch);

  const previousAuthUnsub = container._groupsAuthUnsub;
  if (previousAuthUnsub) previousAuthUnsub();

  if (auth) {
    container._groupsAuthUnsub = onAuthStateChanged(auth, async (user) => {
      if (!container.isConnected) return;
      if (!user) {
        memberships = new Set();
        renderCards(memberships);
        applySearch();
        return;
      }
      try {
        memberships = await fetchMemberships(db, user.uid);
      } catch (e) {
        memberships = new Set();
      }
      renderCards(memberships);
      applySearch();
    });
  }
};

const renderCommitteeDetail = async (container, { db, auth, committeeId }) => {
  let meta = {};
  try {
    const snap = await getDoc(
      doc(db, "artifacts", APP_ID, "public", "data", "committee_meta", committeeId)
    );
    if (snap.exists()) meta = snap.data() || {};
  } catch (e) {
    meta = {};
  }

  const title = formatCommitteeTitle(meta, committeeId);
  const subtitle = formatCommitteeSubtitle(meta, "Publicaciones del comite.");

  const headerActions = `
    <button class="groups-action-btn groups-action-btn--ghost" type="button" data-groups-back>Volver</button>
    <button class="groups-action-btn groups-action-btn--primary" type="button" data-groups-join>Unirme</button>
  `;

  renderFeed(container, {
    committeeId,
    title,
    subtitle,
    headerActions
  });

  const backBtn = container.querySelector("[data-groups-back]");
  const joinBtn = container.querySelector("[data-groups-join]");
  const statusBox = container.querySelector("[data-feed-status]");
  const statusText = container.querySelector("[data-feed-status-text]");

  const setStatus = (message = "", tone = "info") => {
    if (statusText) statusText.textContent = message;
    if (statusBox) statusBox.dataset.tone = tone;
  };

  backBtn?.addEventListener("click", () => {
    window.location.hash = "#/groups";
  });

  if (auth?.currentUser) {
    try {
      const memberships = await fetchMemberships(db, auth.currentUser.uid);
      setJoinButtonState(joinBtn, memberships.has(committeeId));
    } catch (e) {
      setJoinButtonState(joinBtn, false);
    }
  } else {
    setJoinButtonState(joinBtn, false);
  }

  joinBtn?.addEventListener("click", async () => {
    await joinCommittee({
      db,
      auth,
      committeeId,
      button: joinBtn,
      setStatus
    });
  });

  const previousAuthUnsub = container._groupsAuthUnsub;
  if (previousAuthUnsub) previousAuthUnsub();

  if (auth) {
    container._groupsAuthUnsub = onAuthStateChanged(auth, async (user) => {
      if (!container.isConnected) return;
      if (!user) {
        setJoinButtonState(joinBtn, false);
        return;
      }
      try {
        const memberships = await fetchMemberships(db, user.uid);
        setJoinButtonState(joinBtn, memberships.has(committeeId));
      } catch (e) {
        setJoinButtonState(joinBtn, false);
      }
    });
  }
};

export default function renderGroups(container) {
  if (!container) return;
  const { db, auth } = getFirebase();
  if (!db) {
    container.innerHTML = `
      <section class="view-header">
        <h1 class="view-title">Comites</h1>
        <p class="view-subtitle">No se pudo conectar con Firestore.</p>
      </section>
    `;
    return;
  }

  const renderCurrent = async () => {
    const committeeId = resolveRouteCommitteeId();
    if (committeeId) {
      await renderCommitteeDetail(container, { db, auth, committeeId });
      return;
    }
    await renderListView(container, { db, auth });
  };

  renderCurrent();

  const previousHandler = container._groupsHashHandler;
  if (previousHandler) {
    window.removeEventListener("hashchange", previousHandler);
  }

  const onHashChange = () => {
    if (!container.isConnected) {
      if (container._groupsAuthUnsub) {
        container._groupsAuthUnsub();
        container._groupsAuthUnsub = null;
      }
      window.removeEventListener("hashchange", onHashChange);
      return;
    }
    renderCurrent();
  };

  container._groupsHashHandler = onHashChange;
  window.addEventListener("hashchange", onHashChange);
}
