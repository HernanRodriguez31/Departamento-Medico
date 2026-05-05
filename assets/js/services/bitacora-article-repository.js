import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  deleteObject,
  ref as storageRef
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const COLLECTION_NAME = "bitacoraArticles";

const STATUS_VALUES = new Set(["pending_review", "published", "draft"]);
const EXTRACTION_STATUS_VALUES = new Set(["manual", "ai_draft", "metadata_only", "failed", "not_configured"]);

const cleanString = (value = "") => String(value || "").trim();
const sanitizeCommentText = (value = "") => cleanString(value).replace(/[<>]/g, "").slice(0, 1000).trim();
const EXPANDED_DESCRIPTION_QUALITY_VALUES = new Set(["complete", "partial", "insufficient"]);

const cleanStringList = (items = []) =>
  Array.from(
    new Set(
      (Array.isArray(items) ? items : String(items || "").split(","))
        .map((item) => cleanString(item))
        .filter(Boolean)
    )
  ).slice(0, 12);

const cleanExpandedDescriptionQuality = (value = "") =>
  EXPANDED_DESCRIPTION_QUALITY_VALUES.has(cleanString(value)) ? cleanString(value) : "insufficient";

const cleanExpandedDescriptionSections = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((section) => ({
      heading: cleanString(section?.heading).replace(/[<>]/g, "").slice(0, 50),
      body: cleanString(section?.body).replace(/[<>]/g, "").slice(0, 1200)
    }))
    .filter((section) => section.heading && section.body)
    .slice(0, 6);

const METHODOLOGY_LIST_FIELDS = new Set([
  "countriesIncluded",
  "institutions",
  "secondaryOutcomes",
  "effectMeasures",
  "methodologicalStrengths",
  "methodologicalLimitations",
  "applicabilityNotes",
  "methodologyWarnings"
]);

const METHODOLOGY_PROFILE_KEYS = [
  "studyFamily",
  "studyFamilyEs",
  "specificDesign",
  "designCategoryEs",
  "temporalDirection",
  "centerScope",
  "isMulticenter",
  "multicenterRationale",
  "setting",
  "countryOrRegion",
  "countriesIncluded",
  "institutions",
  "studyPopulation",
  "sampleSize",
  "sampleDescription",
  "studyPeriod",
  "studyDuration",
  "recruitmentPeriod",
  "followUpDuration",
  "dataSource",
  "interventionOrExposure",
  "comparator",
  "primaryOutcome",
  "secondaryOutcomes",
  "statisticalApproach",
  "effectMeasures",
  "reportingGuideline",
  "methodologicalStrengths",
  "methodologicalLimitations",
  "applicabilityNotes",
  "classificationRationale",
  "classificationConfidence",
  "evidenceSupport",
  "methodologyWarnings"
];

const cleanMethodologyProfile = (input = {}) =>
  METHODOLOGY_PROFILE_KEYS.reduce((profile, key) => {
    const value = input && typeof input === "object" ? input[key] : "";
    if (METHODOLOGY_LIST_FIELDS.has(key)) {
      profile[key] = cleanStringList(value);
    } else if (key === "isMulticenter") {
      profile[key] = value === true || value === "true" || value === "sí" || value === "si";
    } else if (key === "evidenceSupport") {
      profile[key] = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } else {
      profile[key] = cleanString(value);
    }
    return profile;
  }, {});

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

const getRepositoryErrorCode = (error = {}) =>
  cleanString(error?.code || error?.name || error?.message);

const isPermissionError = (error = {}) => /permission-denied|missing or insufficient permissions|PERMISSION_DENIED/i.test(
  getRepositoryErrorCode(error)
);

const isSessionError = (error = {}) => /unauthenticated|auth|token|credential/i.test(getRepositoryErrorCode(error));

const buildRepositoryError = (code, originalError) => {
  const error = new Error(code);
  error.code = code;
  error.originalError = originalError;
  return error;
};

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

const buildUpdatedBy = (user) => buildCreatedBy(user);

const buildPayload = (input = {}, user) => {
  const status = normalizeStatus(input.status);
  const extractionStatus = normalizeExtractionStatus(input.extractionStatus);
  const objective = cleanString(input.objectiveEs || input.clinicalQuestionEs || input.clinicalQuestion);
  const mainMessage = cleanString(input.mainMessageEs || input.mainResultEs || input.mainResult);
  const briefDescription = cleanString(input.briefDescriptionEs || input.cardSummaryEs);
  const expandedDescription = cleanString(input.expandedDescriptionEs || input.executiveSummaryEs || input.executiveSummary);
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
    studyDesignEs: cleanString(input.studyDesignEs),
    studyContextEs: cleanString(input.studyContextEs),
    studyPopulationEs: cleanString(input.studyPopulationEs),
    studyLocationEs: cleanString(input.studyLocationEs),
    studyPeriodEs: cleanString(input.studyPeriodEs),
    briefDescriptionEs: briefDescription,
    expandedDescriptionEs: expandedDescription,
    expandedDescriptionSections: cleanExpandedDescriptionSections(input.expandedDescriptionSections),
    expandedDescriptionQuality: cleanExpandedDescriptionQuality(input.expandedDescriptionQuality),
    cardSummaryEs: cleanString(input.cardSummaryEs) || briefDescription,
    executiveSummary: cleanString(input.executiveSummary) || expandedDescription,
    executiveSummaryEs: cleanString(input.executiveSummaryEs) || expandedDescription,
    abstractSummaryEs: cleanString(input.abstractSummaryEs),
    objectiveEs: objective,
    clinicalQuestion: objective,
    clinicalQuestionEs: objective,
    mainMessageEs: mainMessage,
    mainResult: mainMessage,
    mainResultEs: mainMessage,
    methodologyEs: cleanString(input.methodologyEs || input.studyDesignEs),
    keyPointsEs: cleanStringList(input.keyPointsEs),
    limitationsEs: cleanString(input.limitationsEs),
    localApplicabilityEs: cleanString(input.localApplicabilityEs),
    occupationalHealthRelevanceEs: cleanString(input.occupationalHealthRelevanceEs),
    methodologyProfile: cleanMethodologyProfile(input.methodologyProfile),
    tags: cleanStringList(input.tags),
    accessType: cleanString(input.accessType) || "Pendiente",
    userComment: cleanString(input.userComment),
    sourcePages: Array.isArray(input.sourcePages) ? input.sourcePages.slice(0, 20) : [],
    extractionSource: cleanString(input.extractionSource) || "manual",
    originalFileName: cleanString(input.originalFileName),
    storagePath: cleanString(input.storagePath),
    fileSize: Number.isFinite(Number(input.fileSize)) ? Math.max(0, Number(input.fileSize)) : 0,
    documentContentType: cleanString(input.documentContentType),
    contentHash: cleanString(input.contentHash),
    pageCount: Number.isFinite(Number(input.pageCount)) ? Math.max(0, Number(input.pageCount)) : 0,
    status,
    extractionStatus,
    extractionWarnings: cleanStringList(input.extractionWarnings),
    createdBy: buildCreatedBy(user),
    updatedBy: buildUpdatedBy(user),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const confidence = Number(input.extractionConfidence);
  if (Number.isFinite(confidence)) {
    payload.extractionConfidence = Math.max(0, Math.min(1, confidence));
  }

  return payload;
};

const buildUpdatePayload = (input = {}, user) => {
  const payload = buildPayload(input, user);
  delete payload.createdBy;
  delete payload.createdAt;
  payload.updatedBy = buildUpdatedBy(user);
  payload.updatedAt = serverTimestamp();
  return payload;
};

export const normalizeBitacoraArticle = (id, data = {}, meta = {}) => {
  const objective = cleanString(data.objectiveEs || data.clinicalQuestionEs || data.clinicalQuestion);
  const mainMessage = cleanString(data.mainMessageEs || data.mainResultEs || data.mainResult);
  const briefDescription = cleanString(data.briefDescriptionEs || data.cardSummaryEs);
  const expandedDescription = cleanString(data.expandedDescriptionEs || data.executiveSummaryEs || data.executiveSummary);
  return {
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
  studyDesignEs: cleanString(data.studyDesignEs || data.methodologyEs),
  studyContextEs: cleanString(data.studyContextEs),
  studyPopulationEs: cleanString(data.studyPopulationEs),
  studyLocationEs: cleanString(data.studyLocationEs || data.studyLocation),
  studyPeriodEs: cleanString(data.studyPeriodEs),
  briefDescriptionEs: briefDescription,
  expandedDescriptionEs: expandedDescription,
  expandedDescriptionSections: cleanExpandedDescriptionSections(data.expandedDescriptionSections),
  expandedDescriptionQuality: cleanExpandedDescriptionQuality(data.expandedDescriptionQuality),
  cardSummaryEs: cleanString(data.cardSummaryEs) || briefDescription,
  executiveSummary: cleanString(data.executiveSummary) || expandedDescription,
  executiveSummaryEs: cleanString(data.executiveSummaryEs) || expandedDescription,
  abstractSummaryEs: cleanString(data.abstractSummaryEs),
  objectiveEs: objective,
  clinicalQuestion: objective,
  clinicalQuestionEs: objective,
  mainMessageEs: mainMessage,
  mainResult: mainMessage,
  mainResultEs: mainMessage,
  methodologyEs: cleanString(data.methodologyEs || data.studyDesignEs),
  keyPointsEs: cleanStringList(data.keyPointsEs),
  limitationsEs: cleanString(data.limitationsEs),
  localApplicabilityEs: cleanString(data.localApplicabilityEs),
  occupationalHealthRelevanceEs: cleanString(data.occupationalHealthRelevanceEs),
  methodologyProfile: cleanMethodologyProfile(data.methodologyProfile),
  tags: cleanStringList(data.tags),
  accessType: cleanString(data.accessType) || "Pendiente",
  userComment: cleanString(data.userComment),
  sourcePages: Array.isArray(data.sourcePages) ? data.sourcePages : [],
  extractionSource: cleanString(data.extractionSource) || "manual",
  originalFileName: cleanString(data.originalFileName),
  storagePath: cleanString(data.storagePath),
  documentStoragePath: cleanString(data.documentStoragePath),
  pdfStoragePath: cleanString(data.pdfStoragePath),
  documentPath: cleanString(data.documentPath),
  pdfPath: cleanString(data.pdfPath),
  storageRef: cleanString(data.storageRef),
  documentUrl: cleanString(data.documentUrl),
  pdfUrl: cleanString(data.pdfUrl),
  sourcePdfUrl: cleanString(data.sourcePdfUrl),
  fileSize: Number.isFinite(Number(data.fileSize)) ? Number(data.fileSize) : 0,
  documentContentType: cleanString(data.documentContentType),
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
  updatedBy: {
    uid: cleanString(data.updatedBy?.uid),
    displayName: cleanString(data.updatedBy?.displayName) || cleanString(data.updatedBy?.email),
    email: cleanString(data.updatedBy?.email),
    photoURL: cleanString(data.updatedBy?.photoURL)
  },
  createdAt: toDate(data.createdAt),
  updatedAt: toDate(data.updatedAt),
  repositoryMode: meta.mode || "firestore",
  optimistic: Boolean(meta.optimistic)
  };
};

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
        if (isPermissionError(error)) {
          throw buildRepositoryError("FIRESTORE_PERMISSION_DENIED", error);
        }
        if (isSessionError(error)) {
          throw buildRepositoryError("AUTH_REQUIRED", error);
        }
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

  const updateArticle = async (articleId = "", input = {}) => {
    const id = cleanString(articleId);
    if (!id) return null;
    const user = auth?.currentUser;
    if (!user) {
      throw new Error("AUTH_REQUIRED");
    }

    const optimisticDate = new Date();
    const updatedBy = buildUpdatedBy(user);
    const payload = buildUpdatePayload(input, user);

    if (db && mode === "firestore") {
      try {
        await updateDoc(doc(db, COLLECTION_NAME, id), payload);
      } catch (error) {
        if (isPermissionError(error)) {
          throw buildRepositoryError("FIRESTORE_PERMISSION_DENIED", error);
        }
        if (isSessionError(error)) {
          throw buildRepositoryError("AUTH_REQUIRED", error);
        }
        throw error;
      }
      return normalizeBitacoraArticle(
        id,
        {
          ...input,
          ...payload,
          createdBy: input.createdBy,
          createdAt: input.createdAt,
          updatedAt: optimisticDate,
          updatedBy
        },
        { mode: "firestore", optimistic: true }
      );
    }

    const index = memoryArticles.findIndex((article) => article.id === id);
    if (index === -1) return null;
    const nextArticle = normalizeBitacoraArticle(
      id,
      {
        ...memoryArticles[index],
        ...input,
        ...payload,
        createdBy: memoryArticles[index].createdBy,
        createdAt: memoryArticles[index].createdAt,
        updatedAt: optimisticDate,
        updatedBy
      },
      { mode: "memory" }
    );
    memoryArticles = memoryArticles.map((article) => (article.id === id ? nextArticle : article));
    emitMemory();
    return nextArticle;
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

  const articleSubcollection = (articleId = "", subcollection = "") => {
    const id = cleanString(articleId);
    if (!db || !id || !subcollection) return null;
    return collection(db, COLLECTION_NAME, id, subcollection);
  };

  const commentLikesCollection = (articleId = "", commentId = "") => {
    const article = cleanString(articleId);
    const comment = cleanString(commentId);
    if (!db || !article || !comment) return null;
    return collection(db, COLLECTION_NAME, article, "comments", comment, "likes");
  };

  const normalizeLike = (id = "", data = {}) => ({
    id,
    uid: cleanString(data.uid || id),
    displayName: cleanString(data.displayName) || cleanString(data.email) || "Usuario",
    email: cleanString(data.email),
    photoURL: cleanString(data.photoURL),
    createdAt: toDate(data.createdAt)
  });

  const normalizeComment = (id = "", data = {}) => ({
    id,
    text: cleanString(data.text),
    status: cleanString(data.status) || "visible",
    createdBy: {
      uid: cleanString(data.createdBy?.uid),
      displayName: cleanString(data.createdBy?.displayName) || cleanString(data.createdBy?.email) || "Usuario",
      email: cleanString(data.createdBy?.email),
      photoURL: cleanString(data.createdBy?.photoURL)
    },
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    deletedAt: toDate(data.deletedAt),
    deletedBy: cleanString(data.deletedBy)
  });

  const watchArticleLikes = (articleId = "", callback = () => {}) => {
    const likesRef = articleSubcollection(articleId, "likes");
    if (!likesRef) {
      callback({ count: 0, likedByCurrentUser: false, likes: [] });
      return () => {};
    }
    return onSnapshot(likesRef, (snapshot) => {
      const likes = snapshot.docs.map((docSnap) => normalizeLike(docSnap.id, docSnap.data()));
      const uid = auth?.currentUser?.uid || "";
      callback({
        count: likes.length,
        likedByCurrentUser: Boolean(uid && likes.some((like) => like.uid === uid)),
        likes
      });
    });
  };

  const hasCurrentUserLiked = async (articleId = "", uid = "") => {
    const userId = cleanString(uid || auth?.currentUser?.uid);
    const id = cleanString(articleId);
    if (!db || !id || !userId) return false;
    const snap = await getDoc(doc(db, COLLECTION_NAME, id, "likes", userId));
    return snap.exists();
  };

  const toggleArticleLike = async (articleId = "", currentUser = auth?.currentUser) => {
    const id = cleanString(articleId);
    const user = currentUser || auth?.currentUser;
    if (!db || !id || !user) throw new Error("AUTH_REQUIRED");
    const likeRef = doc(db, COLLECTION_NAME, id, "likes", user.uid);
    const snap = await getDoc(likeRef);
    if (snap.exists()) {
      await deleteDoc(likeRef);
      return { liked: false };
    }
    await setDoc(likeRef, {
      ...buildCreatedBy(user),
      uid: user.uid,
      createdAt: serverTimestamp()
    });
    return { liked: true };
  };

  const getArticleLikeUsers = async (articleId = "") => {
    const likesRef = articleSubcollection(articleId, "likes");
    if (!likesRef) return [];
    const snap = await getDocs(likesRef);
    return snap.docs.map((docSnap) => normalizeLike(docSnap.id, docSnap.data()));
  };

  const watchArticleComments = (articleId = "", callback = () => {}) => {
    const commentsRef = articleSubcollection(articleId, "comments");
    if (!commentsRef) {
      callback([]);
      return () => {};
    }
    return onSnapshot(query(commentsRef, orderBy("createdAt", "asc")), (snapshot) => {
      callback(
        snapshot.docs
          .map((docSnap) => normalizeComment(docSnap.id, docSnap.data()))
          .filter((comment) => comment.status !== "deleted")
      );
    });
  };

  const addArticleComment = async (articleId = "", text = "", currentUser = auth?.currentUser) => {
    const id = cleanString(articleId);
    const user = currentUser || auth?.currentUser;
    const safeText = sanitizeCommentText(text);
    if (!db || !id || !user) throw new Error("AUTH_REQUIRED");
    if (!safeText) throw new Error("COMMENT_REQUIRED");
    const docRef = await addDoc(collection(db, COLLECTION_NAME, id, "comments"), {
      text: safeText,
      createdBy: buildCreatedBy(user),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      status: "visible",
      deletedAt: null,
      deletedBy: ""
    });
    return docRef.id;
  };

  const updateArticleComment = async (articleId = "", commentId = "", text = "", currentUser = auth?.currentUser) => {
    const id = cleanString(articleId);
    const comment = cleanString(commentId);
    const user = currentUser || auth?.currentUser;
    const safeText = sanitizeCommentText(text);
    if (!db || !id || !comment || !user) throw new Error("AUTH_REQUIRED");
    if (!safeText) throw new Error("COMMENT_REQUIRED");
    await updateDoc(doc(db, COLLECTION_NAME, id, "comments", comment), {
      text: safeText,
      updatedAt: serverTimestamp(),
      status: "visible"
    });
  };

  const deleteArticleComment = async (articleId = "", commentId = "", currentUser = auth?.currentUser) => {
    const id = cleanString(articleId);
    const comment = cleanString(commentId);
    const user = currentUser || auth?.currentUser;
    if (!db || !id || !comment || !user) throw new Error("AUTH_REQUIRED");
    await updateDoc(doc(db, COLLECTION_NAME, id, "comments", comment), {
      text: "Comentario eliminado",
      updatedAt: serverTimestamp(),
      status: "deleted",
      deletedAt: serverTimestamp(),
      deletedBy: user.uid
    });
  };

  const watchCommentLikes = (articleId = "", commentId = "", callback = () => {}) => {
    const likesRef = commentLikesCollection(articleId, commentId);
    if (!likesRef) {
      callback({ count: 0, likedByCurrentUser: false, likes: [] });
      return () => {};
    }
    return onSnapshot(likesRef, (snapshot) => {
      const likes = snapshot.docs.map((docSnap) => normalizeLike(docSnap.id, docSnap.data()));
      const uid = auth?.currentUser?.uid || "";
      callback({
        count: likes.length,
        likedByCurrentUser: Boolean(uid && likes.some((like) => like.uid === uid)),
        likes
      });
    });
  };

  const toggleCommentLike = async (articleId = "", commentId = "", currentUser = auth?.currentUser) => {
    const article = cleanString(articleId);
    const comment = cleanString(commentId);
    const user = currentUser || auth?.currentUser;
    if (!db || !article || !comment || !user) throw new Error("AUTH_REQUIRED");
    const likeRef = doc(db, COLLECTION_NAME, article, "comments", comment, "likes", user.uid);
    const snap = await getDoc(likeRef);
    if (snap.exists()) {
      await deleteDoc(likeRef);
      return { liked: false };
    }
    await setDoc(likeRef, {
      ...buildCreatedBy(user),
      uid: user.uid,
      createdAt: serverTimestamp()
    });
    return { liked: true };
  };

  const getCommentLikeUsers = async (articleId = "", commentId = "") => {
    const likesRef = commentLikesCollection(articleId, commentId);
    if (!likesRef) return [];
    const snap = await getDocs(likesRef);
    return snap.docs.map((docSnap) => normalizeLike(docSnap.id, docSnap.data()));
  };

  const watchArticleSocialSummary = (articleId = "", callback = () => {}) => {
    const summary = {
      likeCount: 0,
      commentCount: 0,
      likedByCurrentUser: false,
      likes: [],
      comments: [],
      latestComments: []
    };
    const emit = () => callback({ ...summary, latestComments: [...summary.latestComments], likes: [...summary.likes] });
    const unsubscribers = [
      watchArticleLikes(articleId, (likesSummary) => {
        summary.likeCount = likesSummary.count || 0;
        summary.likedByCurrentUser = Boolean(likesSummary.likedByCurrentUser);
        summary.likes = likesSummary.likes || [];
        emit();
      }),
      watchArticleComments(articleId, (comments = []) => {
        summary.commentCount = comments.length;
        summary.comments = comments;
        summary.latestComments = comments.slice(-4).reverse();
        emit();
      })
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
  };

  const getArticleSocialSummary = async (articleId = "") => {
    const id = cleanString(articleId);
    if (!db || !id) return { likeCount: 0, commentCount: 0, likedByCurrentUser: false, likes: [], comments: [], latestComments: [] };
    const [likesSnap, commentsSnap] = await Promise.all([
      getDocs(collection(db, COLLECTION_NAME, id, "likes")),
      getDocs(collection(db, COLLECTION_NAME, id, "comments"))
    ]);
    const uid = auth?.currentUser?.uid || "";
    const comments = commentsSnap.docs
      .map((docSnap) => normalizeComment(docSnap.id, docSnap.data()))
      .filter((comment) => comment.status !== "deleted");
    const likes = likesSnap.docs.map((docSnap) => normalizeLike(docSnap.id, docSnap.data()));
    return {
      likeCount: likesSnap.size,
      commentCount: comments.length,
      likedByCurrentUser: Boolean(uid && likes.some((like) => like.uid === uid)),
      likes,
      comments,
      latestComments: comments.slice(-4).reverse()
    };
  };

  return {
    subscribe,
    createArticle,
    updateArticle,
    deleteArticle,
    watchArticleLikes,
    toggleArticleLike,
    hasCurrentUserLiked,
    getArticleLikeUsers,
    watchArticleSocialSummary,
    watchArticleComments,
    addArticleComment,
    updateArticleComment,
    deleteArticleComment,
    watchCommentLikes,
    toggleCommentLike,
    getCommentLikeUsers,
    getArticleSocialSummary,
    getMode: () => mode
  };
}
