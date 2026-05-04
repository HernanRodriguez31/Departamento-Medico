import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const COLLECTION_NAME = "bitacoraArticles";

const STATUS_VALUES = new Set(["pending_review", "published", "draft"]);
const EXTRACTION_STATUS_VALUES = new Set(["manual", "ai_draft", "metadata_only", "failed", "not_configured"]);

const cleanString = (value = "") => String(value || "").trim();

const cleanStringList = (items = []) =>
  Array.from(
    new Set(
      (Array.isArray(items) ? items : String(items || "").split(","))
        .map((item) => cleanString(item))
        .filter(Boolean)
    )
  ).slice(0, 12);

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeStatus = (value) => (STATUS_VALUES.has(value) ? value : "pending_review");
const normalizeExtractionStatus = (value) =>
  EXTRACTION_STATUS_VALUES.has(value) ? value : "manual";

const buildCreatedBy = (user) => {
  const createdBy = {
    uid: user.uid,
    displayName: cleanString(user.displayName) || cleanString(user.email) || "Usuario",
    email: cleanString(user.email)
  };
  if (cleanString(user.photoURL)) {
    createdBy.photoURL = cleanString(user.photoURL);
  }
  return createdBy;
};

const buildPayload = (input = {}, user) => {
  const status = normalizeStatus(input.status);
  const extractionStatus = normalizeExtractionStatus(input.extractionStatus);
  const payload = {
    title: cleanString(input.title),
    sourceName: cleanString(input.sourceName),
    sourceDomain: cleanString(input.sourceDomain),
    officialUrl: cleanString(input.officialUrl),
    studyType: cleanString(input.studyType),
    evidenceType: cleanString(input.evidenceType),
    publicationDate: cleanString(input.publicationDate),
    studyLocation: cleanString(input.studyLocation),
    executiveSummary: cleanString(input.executiveSummary),
    clinicalQuestion: cleanString(input.clinicalQuestion),
    mainResult: cleanString(input.mainResult),
    tags: cleanStringList(input.tags),
    accessType: cleanString(input.accessType) || "Pendiente",
    userComment: cleanString(input.userComment),
    status,
    extractionStatus,
    extractionWarnings: cleanStringList(input.extractionWarnings),
    createdBy: buildCreatedBy(user),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const confidence = Number(input.extractionConfidence);
  if (Number.isFinite(confidence)) {
    payload.extractionConfidence = Math.max(0, Math.min(1, confidence));
  }

  return payload;
};

export const normalizeBitacoraArticle = (id, data = {}, meta = {}) => ({
  id,
  title: cleanString(data.title),
  sourceName: cleanString(data.sourceName),
  sourceDomain: cleanString(data.sourceDomain),
  officialUrl: cleanString(data.officialUrl),
  studyType: cleanString(data.studyType),
  evidenceType: cleanString(data.evidenceType),
  publicationDate: cleanString(data.publicationDate),
  studyLocation: cleanString(data.studyLocation),
  executiveSummary: cleanString(data.executiveSummary),
  clinicalQuestion: cleanString(data.clinicalQuestion),
  mainResult: cleanString(data.mainResult),
  tags: cleanStringList(data.tags),
  accessType: cleanString(data.accessType) || "Pendiente",
  userComment: cleanString(data.userComment),
  status: normalizeStatus(data.status),
  extractionStatus: normalizeExtractionStatus(data.extractionStatus),
  extractionConfidence: Number.isFinite(Number(data.extractionConfidence))
    ? Number(data.extractionConfidence)
    : null,
  extractionWarnings: cleanStringList(data.extractionWarnings),
  createdBy: {
    uid: cleanString(data.createdBy?.uid),
    displayName: cleanString(data.createdBy?.displayName) || cleanString(data.createdBy?.email) || "Usuario",
    email: cleanString(data.createdBy?.email),
    photoURL: cleanString(data.createdBy?.photoURL)
  },
  createdAt: toDate(data.createdAt),
  updatedAt: toDate(data.updatedAt),
  repositoryMode: meta.mode || "firestore",
  optimistic: Boolean(meta.optimistic)
});

export function createBitacoraArticleRepository({ db, auth } = {}) {
  let memoryArticles = [];
  let subscriber = null;
  let mode = db ? "firestore" : "memory";

  const emitMemory = () => {
    subscriber?.(memoryArticles, { mode: "memory" });
  };

  const subscribe = (onChange, onError) => {
    subscriber = typeof onChange === "function" ? onChange : null;
    if (!db) {
      mode = "memory";
      emitMemory();
      return () => {
        subscriber = null;
      };
    }

    const articlesQuery = query(collection(db, COLLECTION_NAME), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      articlesQuery,
      (snapshot) => {
        mode = "firestore";
        const articles = snapshot.docs.map((docSnap) =>
          normalizeBitacoraArticle(docSnap.id, docSnap.data(), { mode })
        );
        subscriber?.(articles, { mode });
      },
      (error) => {
        mode = "memory";
        onError?.(error);
        emitMemory();
      }
    );

    return () => {
      unsubscribe();
      subscriber = null;
    };
  };

  const createArticle = async (input = {}) => {
    const user = auth?.currentUser;
    if (!user) {
      throw new Error("AUTH_REQUIRED");
    }

    const optimisticDate = new Date();
    const payload = buildPayload(input, user);

    if (db) {
      try {
        const docRef = await addDoc(collection(db, COLLECTION_NAME), payload);
        return normalizeBitacoraArticle(
          docRef.id,
          {
            ...payload,
            createdAt: optimisticDate,
            updatedAt: optimisticDate
          },
          { mode: "firestore", optimistic: true }
        );
      } catch (error) {
        console.warn("[Bitácora] Firestore no disponible para guardar artículo. Se usa modo local.", error);
        mode = "memory";
      }
    }

    const localArticle = normalizeBitacoraArticle(
      `local-${Date.now()}`,
      {
        ...payload,
        createdAt: optimisticDate,
        updatedAt: optimisticDate
      },
      { mode: "memory" }
    );
    memoryArticles = [localArticle, ...memoryArticles];
    emitMemory();
    return localArticle;
  };

  const deleteArticle = async (articleId = "") => {
    const id = cleanString(articleId);
    if (!id) return;
    const user = auth?.currentUser;
    if (!user) {
      throw new Error("AUTH_REQUIRED");
    }

    if (db && mode === "firestore") {
      await deleteDoc(doc(db, COLLECTION_NAME, id));
      return;
    }

    memoryArticles = memoryArticles.filter((article) => article.id !== id);
    emitMemory();
  };

  return {
    subscribe,
    createArticle,
    deleteArticle,
    getMode: () => mode
  };
}
