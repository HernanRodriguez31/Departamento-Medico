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
import {
  deleteObject,
  ref as storageRef
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

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
    journal: cleanString(input.journal),
    authors: cleanStringList(input.authors),
    sourceDomain: cleanString(input.sourceDomain),
    officialUrl: cleanString(input.officialUrl),
    doi: cleanString(input.doi),
    pmid: cleanString(input.pmid),
    pmcid: cleanString(input.pmcid),
    nctId: cleanString(input.nctId),
    pii: cleanString(input.pii),
    studyType: cleanString(input.studyType),
    evidenceType: cleanString(input.evidenceType),
    publicationDate: cleanString(input.publicationDate),
    originalLanguage: cleanString(input.originalLanguage),
    articleType: cleanString(input.articleType),
    studyLocation: cleanString(input.studyLocation),
    cardSummaryEs: cleanString(input.cardSummaryEs),
    executiveSummary: cleanString(input.executiveSummary),
    executiveSummaryEs: cleanString(input.executiveSummaryEs),
    abstractSummaryEs: cleanString(input.abstractSummaryEs),
    clinicalQuestion: cleanString(input.clinicalQuestion),
    clinicalQuestionEs: cleanString(input.clinicalQuestionEs),
    mainResult: cleanString(input.mainResult),
    mainResultEs: cleanString(input.mainResultEs),
    methodologyEs: cleanString(input.methodologyEs),
    keyPointsEs: cleanStringList(input.keyPointsEs),
    limitationsEs: cleanString(input.limitationsEs),
    localApplicabilityEs: cleanString(input.localApplicabilityEs),
    occupationalHealthRelevanceEs: cleanString(input.occupationalHealthRelevanceEs),
    tags: cleanStringList(input.tags),
    accessType: cleanString(input.accessType) || "Pendiente",
    userComment: cleanString(input.userComment),
    sourcePages: Array.isArray(input.sourcePages) ? input.sourcePages.slice(0, 20) : [],
    extractionSource: cleanString(input.extractionSource) || "manual",
    originalFileName: cleanString(input.originalFileName),
    storagePath: cleanString(input.storagePath),
    contentHash: cleanString(input.contentHash),
    pageCount: Number.isFinite(Number(input.pageCount)) ? Math.max(0, Number(input.pageCount)) : 0,
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
  journal: cleanString(data.journal),
  authors: cleanStringList(data.authors),
  sourceDomain: cleanString(data.sourceDomain),
  officialUrl: cleanString(data.officialUrl),
  doi: cleanString(data.doi),
  pmid: cleanString(data.pmid),
  pmcid: cleanString(data.pmcid),
  nctId: cleanString(data.nctId),
  pii: cleanString(data.pii),
  studyType: cleanString(data.studyType),
  evidenceType: cleanString(data.evidenceType),
  publicationDate: cleanString(data.publicationDate),
  originalLanguage: cleanString(data.originalLanguage),
  articleType: cleanString(data.articleType),
  studyLocation: cleanString(data.studyLocation),
  cardSummaryEs: cleanString(data.cardSummaryEs),
  executiveSummary: cleanString(data.executiveSummary),
  executiveSummaryEs: cleanString(data.executiveSummaryEs),
  abstractSummaryEs: cleanString(data.abstractSummaryEs),
  clinicalQuestion: cleanString(data.clinicalQuestion),
  clinicalQuestionEs: cleanString(data.clinicalQuestionEs),
  mainResult: cleanString(data.mainResult),
  mainResultEs: cleanString(data.mainResultEs),
  methodologyEs: cleanString(data.methodologyEs),
  keyPointsEs: cleanStringList(data.keyPointsEs),
  limitationsEs: cleanString(data.limitationsEs),
  localApplicabilityEs: cleanString(data.localApplicabilityEs),
  occupationalHealthRelevanceEs: cleanString(data.occupationalHealthRelevanceEs),
  tags: cleanStringList(data.tags),
  accessType: cleanString(data.accessType) || "Pendiente",
  userComment: cleanString(data.userComment),
  sourcePages: Array.isArray(data.sourcePages) ? data.sourcePages : [],
  extractionSource: cleanString(data.extractionSource) || "manual",
  originalFileName: cleanString(data.originalFileName),
  storagePath: cleanString(data.storagePath),
  contentHash: cleanString(data.contentHash),
  pageCount: Number.isFinite(Number(data.pageCount)) ? Number(data.pageCount) : 0,
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

export function createBitacoraArticleRepository({ db, auth, storage } = {}) {
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

  const deleteArticle = async (articleId = "", { storagePath = "" } = {}) => {
    const id = cleanString(articleId);
    if (!id) return;
    const user = auth?.currentUser;
    if (!user) {
      throw new Error("AUTH_REQUIRED");
    }

    if (db && mode === "firestore") {
      await deleteDoc(doc(db, COLLECTION_NAME, id));
      if (storage && cleanString(storagePath)) {
        try {
          await deleteObject(storageRef(storage, cleanString(storagePath)));
        } catch (error) {
          if (!String(error?.code || "").includes("object-not-found")) {
            console.warn("[Bitácora] No se pudo eliminar el PDF asociado.", error);
          }
        }
      }
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
