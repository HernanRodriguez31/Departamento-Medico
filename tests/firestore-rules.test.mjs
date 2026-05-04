import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  Timestamp,
  updateDoc
} from "firebase/firestore";

const PROJECT_ID = "departamento-medico-brisa";
const APP_ID = "departamento-medico-brisa";

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080
    }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "notifications", "notif-owner"), {
      toUid: "user-a",
      title: "Nueva actividad",
      body: "Tienes una nueva notificación",
      read: false,
      readAt: null,
      createdAt: Timestamp.now()
    });
    await setDoc(doc(db, "dm_carousel", "post-a"), {
      type: "text",
      text: "Post visible",
      authorUid: "user-a",
      authorName: "Dr. Usuario A",
      createdByUid: "user-a",
      createdByName: "Dr. Usuario A",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      likesCount: 1,
      likedBy: ["user-b"],
      likedNames: ["Dr. Usuario B"],
      commentCount: 1
    });
    await setDoc(doc(db, "dm_carousel", "post-a", "comments", "comment-a"), {
      text: "Comentario visible",
      authorUid: "user-a",
      authorName: "Dr. Usuario A",
      createdAt: Timestamp.now(),
      likedBy: {
        "user-b": "Dr. Usuario B"
      }
    });
    await setDoc(
      doc(db, "artifacts", APP_ID, "public", "data", "committee_members", "flat-member-a"),
      {
        committeeId: "comite_bioetica",
        userUid: "user-a",
        name: "Dr. Usuario A",
        createdAt: Timestamp.now()
      }
    );
    await setDoc(
      doc(db, "artifacts", APP_ID, "public", "data", "committee_topics", "flat-topic-a"),
      {
        committeeId: "comite_bioetica",
        title: "Proyecto A",
        stage: 2,
        createdAt: Timestamp.now()
      }
    );
    await setDoc(
      doc(db, "artifacts", APP_ID, "public", "data", "committee_messages", "flat-msg-a"),
      {
        committeeId: "comite_bioetica",
        text: "Hola comité",
        author: "Dr. Usuario A",
        authorUid: "user-a",
        authorName: "Dr. Usuario A",
        businessUnit: "Upstream",
        managementUnit: "GSJ",
        createdAt: Timestamp.now(),
        likedBy: {}
      }
    );
    await setDoc(
      doc(db, "artifacts", APP_ID, "public", "data", "committee_messages", "flat-foro-msg"),
      {
        committeeId: "foro_general",
        text: "Hola foro",
        author: "Dr. Usuario A",
        authorUid: "user-a",
        authorName: "Dr. Usuario A",
        businessUnit: "Upstream",
        managementUnit: "GSJ",
        createdAt: Timestamp.now(),
        likedBy: {}
      }
    );
    await setDoc(
      doc(db, "artifacts", APP_ID, "public", "data", "calendar_events", "event-a"),
      {
        title: "Reunión de seguimiento",
        note: "Revisión del cronograma mensual.",
        dateKey: "2026-04-13",
        allDay: false,
        startMinutes: 540,
        endMinutes: 600,
        createdByUid: "user-a",
        createdByName: "Dr. Usuario A",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }
    );
    await setDoc(doc(db, "bitacoraArticles", "article-a"), {
      title: "Artículo sembrado",
      sourceName: "PubMed / MEDLINE",
      sourceDomain: "pubmed.ncbi.nlm.nih.gov",
      officialUrl: "https://pubmed.ncbi.nlm.nih.gov/123456/",
      doi: "",
      pmid: "123456",
      pmcid: "",
      nctId: "",
      pii: "",
      studyType: "Ensayo clínico",
      evidenceType: "Investigación clínica",
      publicationDate: "2026-05-03",
      studyLocation: "Contexto hospitalario",
      executiveSummary: "Resumen interno.",
      clinicalQuestion: "Pregunta clínica.",
      mainResult: "Resultado principal.",
      tags: ["QA", "PubMed"],
      accessType: "Resumen disponible",
      userComment: "Comentario interno.",
      status: "pending_review",
      extractionStatus: "manual",
      extractionWarnings: [],
      createdBy: {
        uid: "user-a",
        displayName: "Dr. Usuario A",
        email: "user-a@test.local"
      },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

const authedDb = (uid) => testEnv.authenticatedContext(uid).firestore();
const authedAdminDb = (uid) =>
  testEnv.authenticatedContext(uid, { admin: true }).firestore();
const unauthedDb = () => testEnv.unauthenticatedContext().firestore();

const validBitacoraPayload = (uid = "user-b") => ({
  title: "Artículo nuevo",
  sourceName: "PubMed / MEDLINE",
  journal: "Revista de prueba",
  authors: ["Dra. Prueba", "Dr. Revisión"],
  sourceDomain: "pubmed.ncbi.nlm.nih.gov",
  officialUrl: "https://pubmed.ncbi.nlm.nih.gov/789/",
  doi: "",
  pmid: "789",
  pmcid: "",
  nctId: "",
  pii: "",
  studyType: "Cohorte",
  evidenceType: "Investigación clínica",
  publicationDate: "2026-05-03",
  originalLanguage: "en",
  articleType: "Artículo científico",
  studyLocation: "Contexto laboral",
  cardSummaryEs: "Resumen breve de tarjeta para revisión institucional.",
  executiveSummary: "Resumen para revisión.",
  executiveSummaryEs: "Resumen ejecutivo en español para revisión.",
  abstractSummaryEs: "Abstract sintetizado en español.",
  objectiveEs: "Objetivo o pregunta del documento.",
  clinicalQuestion: "Pregunta de revisión.",
  clinicalQuestionEs: "Pregunta de revisión en español.",
  mainMessageEs: "Mensaje principal documentado.",
  mainResult: "Resultado documentado.",
  mainResultEs: "Resultado principal documentado.",
  methodologyEs: "Metodología resumida del documento.",
  keyPointsEs: ["Punto clave uno", "Punto clave dos"],
  limitationsEs: "Limitaciones indicadas por el documento.",
  localApplicabilityEs: "Aplicabilidad local a evaluar por el equipo.",
  occupationalHealthRelevanceEs: "Relevancia para salud ocupacional.",
  tags: ["QA", "Evidencia"],
  accessType: "Open access",
  userComment: "Comentario del usuario.",
  sourcePages: [],
  extractionSource: "pdf",
  originalFileName: "articulo.pdf",
  storagePath: `bitacora/article-documents/${uid}/articulo.pdf`,
  contentHash: "a".repeat(64),
  pageCount: 8,
  status: "pending_review",
  extractionStatus: "manual",
  extractionWarnings: [],
  createdBy: {
    uid,
    displayName: "Dr. Usuario B",
    email: "user-b@test.local"
  },
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now()
});

test("pushTokens blocks client writes", async () => {
  await assertFails(
    setDoc(doc(authedDb("user-a"), "pushTokens", "user-a"), {
      tokens: ["x".repeat(120)],
      updatedAt: Timestamp.now()
    })
  );
});

test("notifications are owner-readable and can only be marked read by owner", async () => {
  const owner = authedDb("user-a");
  const other = authedDb("user-b");
  const ref = doc(owner, "notifications", "notif-owner");

  await assertSucceeds(getDoc(ref));
  await assertFails(getDoc(doc(other, "notifications", "notif-owner")));
  await assertSucceeds(updateDoc(ref, { read: true, readAt: Timestamp.now() }));
  await assertFails(
    setDoc(doc(owner, "notifications", "client-created"), {
      toUid: "user-b",
      read: false
    })
  );
});

test("admin_whitelist blocks client writes", async () => {
  await assertFails(
    setDoc(doc(authedDb("user-a"), "admin_whitelist", "user-a"), {
      role: "admin"
    })
  );
});

test("dm_presence allows owner write and blocks foreign write", async () => {
  await assertSucceeds(
    setDoc(doc(authedDb("user-a"), "dm_presence", "user-a"), {
      uid: "user-a",
      online: true,
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(
    setDoc(doc(authedDb("user-a"), "dm_presence", "user-b"), {
      uid: "user-b",
      online: true,
      updatedAt: Timestamp.now()
    })
  );
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), "dm_presence", "user-a"));
  });
});

test("authenticated users can read source committee collections", async () => {
  const db = authedDb("user-a");

  await assertSucceeds(
    getDoc(doc(db, "artifacts", APP_ID, "public", "data", "committee_members", "flat-member-a"))
  );
  await assertSucceeds(
    getDocs(query(collection(db, "artifacts", APP_ID, "public", "data", "committee_members"), limit(10)))
  );
  await assertSucceeds(
    getDoc(doc(db, "artifacts", APP_ID, "public", "data", "committee_topics", "flat-topic-a"))
  );
  await assertSucceeds(
    getDocs(query(collection(db, "artifacts", APP_ID, "public", "data", "committee_topics"), limit(10)))
  );
  await assertSucceeds(
    getDoc(doc(db, "artifacts", APP_ID, "public", "data", "committee_messages", "flat-msg-a"))
  );
  await assertSucceeds(
    getDocs(query(collection(db, "artifacts", APP_ID, "public", "data", "committee_messages"), limit(10)))
  );
});

test("authenticated non-admin can read foro_general source message", async () => {
  await assertSucceeds(
    getDoc(doc(authedDb("user-a"), "artifacts", APP_ID, "public", "data", "committee_messages", "flat-foro-msg"))
  );
});

test("authenticated user can create valid foro_general source message", async () => {
  await assertSucceeds(
    setDoc(
      doc(authedDb("user-a"), "artifacts", APP_ID, "public", "data", "committee_messages", "new-foro-msg"),
      {
        text: "Nuevo mensaje",
        author: "Dr. Usuario A",
        businessUnit: "Upstream",
        managementUnit: "GSJ",
        committeeId: "foro_general",
        authorUid: "user-a",
        authorName: "Dr. Usuario A",
        createdAt: Timestamp.now(),
        likedBy: {}
      }
    )
  );
});

test("authenticated users can read calendar_events and unauthenticated users cannot", async () => {
  await assertSucceeds(
    getDoc(doc(authedDb("user-a"), "artifacts", APP_ID, "public", "data", "calendar_events", "event-a"))
  );
  await assertSucceeds(
    getDocs(query(collection(authedDb("user-b"), "artifacts", APP_ID, "public", "data", "calendar_events"), limit(10)))
  );
  await assertFails(
    getDoc(doc(unauthedDb(), "artifacts", APP_ID, "public", "data", "calendar_events", "event-a"))
  );
});

test("authenticated user can create valid own calendar event", async () => {
  await assertSucceeds(
    setDoc(
      doc(authedDb("user-b"), "artifacts", APP_ID, "public", "data", "calendar_events", "event-b"),
      {
        title: "Nota del equipo",
        note: "Actividad del día.",
        dateKey: "2026-06-05",
        startDateKey: "2026-06-05",
        endDateKey: "2026-06-05",
        allDay: false,
        startMinutes: 600,
        endMinutes: 660,
        colorKey: "blue",
        createdByUid: "user-b",
        createdByName: "Dr. Usuario B",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }
    )
  );
});

test("bitacoraArticles allow authenticated reads and valid own creates only", async () => {
  await assertSucceeds(getDoc(doc(authedDb("user-a"), "bitacoraArticles", "article-a")));
  await assertSucceeds(getDocs(query(collection(authedDb("user-b"), "bitacoraArticles"), limit(10))));
  await assertFails(getDoc(doc(unauthedDb(), "bitacoraArticles", "article-a")));

  await assertSucceeds(
    setDoc(doc(authedDb("user-b"), "bitacoraArticles", "article-b"), validBitacoraPayload("user-b"))
  );
  await assertSucceeds(
    setDoc(doc(authedDb("user-b"), "bitacoraArticles", "article-draft"), {
      ...validBitacoraPayload("user-b"),
      status: "draft"
    })
  );
  await assertSucceeds(
    setDoc(doc(authedDb("user-b"), "bitacoraArticles", "article-metadata-only"), {
      ...validBitacoraPayload("user-b"),
      extractionStatus: "metadata_only"
    })
  );
  await assertSucceeds(
    setDoc(doc(authedDb("user-b"), "bitacoraArticles", "article-document-no-url"), {
      ...validBitacoraPayload("user-b"),
      officialUrl: "",
      extractionSource: "pasted_text",
      storagePath: "",
      originalFileName: "",
      pageCount: 0
    })
  );
  await assertSucceeds(
    setDoc(doc(authedDb("user-b"), "bitacoraArticles", "article-incomplete-draft"), {
      ...validBitacoraPayload("user-b"),
      title: "Borrador científico sin título",
      sourceName: "",
      journal: "",
      cardSummaryEs: "",
      executiveSummary: "",
      executiveSummaryEs: "",
      objectiveEs: "",
      clinicalQuestion: "",
      clinicalQuestionEs: "",
      mainMessageEs: "",
      mainResult: "",
      mainResultEs: "",
      methodologyEs: "",
      evidenceType: "",
      studyType: "",
      status: "draft"
    })
  );
  await assertFails(
    setDoc(doc(authedDb("user-b"), "bitacoraArticles", "article-empty-final"), {
      ...validBitacoraPayload("user-b"),
      sourceName: "",
      journal: "",
      cardSummaryEs: "",
      executiveSummary: "",
      executiveSummaryEs: "",
      objectiveEs: "",
      clinicalQuestion: "",
      clinicalQuestionEs: "",
      mainMessageEs: "",
      mainResult: "",
      mainResultEs: "",
      methodologyEs: ""
    })
  );
  await assertFails(
    setDoc(doc(unauthedDb(), "bitacoraArticles", "article-guest"), validBitacoraPayload("guest"))
  );
  await assertFails(
    setDoc(doc(authedDb("user-b"), "bitacoraArticles", "article-forged"), validBitacoraPayload("user-a"))
  );
  await assertFails(
    setDoc(doc(authedDb("user-b"), "bitacoraArticles", "article-published"), {
      ...validBitacoraPayload("user-b"),
      status: "published"
    })
  );
  await assertFails(
    setDoc(doc(authedDb("user-b"), "bitacoraArticles", "article-extra"), {
      ...validBitacoraPayload("user-b"),
      unsafeHtml: "<script>"
    })
  );
});

test("bitacoraArticles updates are admin-only and deletes allow owner or admin", async () => {
  const ownerDb = authedDb("user-a");
  const otherDb = authedDb("user-b");
  const adminDb = authedAdminDb("admin-a");

  await assertFails(
    updateDoc(doc(ownerDb, "bitacoraArticles", "article-a"), {
      status: "published",
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(deleteDoc(doc(otherDb, "bitacoraArticles", "article-a")));
  await assertSucceeds(deleteDoc(doc(ownerDb, "bitacoraArticles", "article-a")));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "bitacoraArticles", "article-admin-delete"), {
      ...validBitacoraPayload("user-b"),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
  });

  await assertSucceeds(
    updateDoc(doc(adminDb, "bitacoraArticles", "article-admin-delete"), {
      title: "Artículo aprobado",
      status: "published",
      updatedAt: Timestamp.now()
    })
  );
  await assertSucceeds(deleteDoc(doc(adminDb, "bitacoraArticles", "article-admin-delete")));
});

test("authenticated user can create valid own multi-day calendar event", async () => {
  await assertSucceeds(
    setDoc(
      doc(authedDb("user-b"), "artifacts", APP_ID, "public", "data", "calendar_events", "event-multiday"),
      {
        title: "Campaña anual",
        note: "Cobertura de varios días.",
        dateKey: "2026-06-10",
        startDateKey: "2026-06-10",
        endDateKey: "2026-06-12",
        allDay: true,
        colorKey: "violet",
        createdByUid: "user-b",
        createdByName: "Dr. Usuario B",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }
    )
  );
});

test("authenticated user can create multiple calendar events on the same day without collisions", async () => {
  const sameDayPayload = {
    dateKey: "2026-06-18",
    startDateKey: "2026-06-18",
    endDateKey: "2026-06-18",
    allDay: false,
    colorKey: "green",
    createdByUid: "user-b",
    createdByName: "Dr. Usuario B",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  };

  await assertSucceeds(
    setDoc(
      doc(authedDb("user-b"), "artifacts", APP_ID, "public", "data", "calendar_events", "same-day-a"),
      {
        ...sameDayPayload,
        title: "Control de botiquín",
        note: "Primera actividad del día.",
        startMinutes: 480,
        endMinutes: 540
      }
    )
  );

  await assertSucceeds(
    setDoc(
      doc(authedDb("user-b"), "artifacts", APP_ID, "public", "data", "calendar_events", "same-day-b"),
      {
        ...sameDayPayload,
        title: "Reunión operativa",
        note: "Segunda actividad del día.",
        startMinutes: 600,
        endMinutes: 660
      }
    )
  );
});

test("unauthenticated user cannot create calendar_events", async () => {
  await assertFails(
    setDoc(
      doc(unauthedDb(), "artifacts", APP_ID, "public", "data", "calendar_events", "event-unauth"),
      {
        title: "Intento sin sesión",
        note: "No debería persistirse.",
        dateKey: "2026-06-14",
        startDateKey: "2026-06-14",
        endDateKey: "2026-06-14",
        allDay: true,
        colorKey: "green",
        createdByUid: "user-b",
        createdByName: "Dr. Usuario B",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }
    )
  );
});

test("calendar_events blocks forged owner, invalid ranges, invalid colors and invalid minute windows", async () => {
  await assertFails(
    setDoc(
      doc(authedDb("user-b"), "artifacts", APP_ID, "public", "data", "calendar_events", "forged-owner"),
      {
        title: "Evento inválido",
        note: "Intento con owner ajeno.",
        dateKey: "2026-06-05",
        startDateKey: "2026-06-05",
        endDateKey: "2026-06-05",
        allDay: true,
        colorKey: "green",
        createdByUid: "user-a",
        createdByName: "Dr. Usuario A",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }
    )
  );
  await assertFails(
    setDoc(
      doc(authedDb("user-b"), "artifacts", APP_ID, "public", "data", "calendar_events", "out-of-range"),
      {
        title: "Evento fuera de rango",
        note: "Fecha inválida.",
        dateKey: "2028-01-05",
        startDateKey: "2028-01-05",
        endDateKey: "2028-01-05",
        allDay: true,
        colorKey: "green",
        createdByUid: "user-b",
        createdByName: "Dr. Usuario B",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }
    )
  );
  await assertFails(
    setDoc(
      doc(authedDb("user-b"), "artifacts", APP_ID, "public", "data", "calendar_events", "invalid-minutes"),
      {
        title: "Ventana inválida",
        note: "Fin menor que inicio.",
        dateKey: "2026-06-05",
        startDateKey: "2026-06-05",
        endDateKey: "2026-06-05",
        allDay: false,
        startMinutes: 600,
        endMinutes: 540,
        colorKey: "green",
        createdByUid: "user-b",
        createdByName: "Dr. Usuario B",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }
    )
  );
  await assertFails(
    setDoc(
      doc(authedDb("user-b"), "artifacts", APP_ID, "public", "data", "calendar_events", "invalid-range"),
      {
        title: "Rango inválido",
        note: "Hasta anterior a desde.",
        dateKey: "2026-06-12",
        startDateKey: "2026-06-12",
        endDateKey: "2026-06-10",
        allDay: true,
        colorKey: "green",
        createdByUid: "user-b",
        createdByName: "Dr. Usuario B",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }
    )
  );
  await assertFails(
    setDoc(
      doc(authedDb("user-b"), "artifacts", APP_ID, "public", "data", "calendar_events", "invalid-color"),
      {
        title: "Color inválido",
        note: "Palette incorrecta.",
        dateKey: "2026-06-05",
        startDateKey: "2026-06-05",
        endDateKey: "2026-06-05",
        allDay: true,
        colorKey: "pink",
        createdByUid: "user-b",
        createdByName: "Dr. Usuario B",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }
    )
  );
  await assertFails(
    setDoc(
      doc(authedDb("user-b"), "artifacts", APP_ID, "public", "data", "calendar_events", "multiday-with-time"),
      {
        title: "Multiday con horario",
        note: "No debería pasar.",
        dateKey: "2026-06-10",
        startDateKey: "2026-06-10",
        endDateKey: "2026-06-12",
        allDay: false,
        startMinutes: 600,
        endMinutes: 660,
        colorKey: "amber",
        createdByUid: "user-b",
        createdByName: "Dr. Usuario B",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }
    )
  );
});

test("calendar_events owner and admin can update/delete while foreign non-admin cannot", async () => {
  const ownerDb = authedDb("user-a");
  const otherDb = authedDb("user-b");
  const adminDb = authedAdminDb("admin-a");
  const ownerRef = doc(ownerDb, "artifacts", APP_ID, "public", "data", "calendar_events", "event-a");

  await assertSucceeds(
    updateDoc(ownerRef, {
      dateKey: "2026-04-13",
      startDateKey: "2026-04-13",
      endDateKey: "2026-04-13",
      colorKey: "green",
      note: "Revisión del cronograma actualizada.",
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(
    updateDoc(doc(otherDb, "artifacts", APP_ID, "public", "data", "calendar_events", "event-a"), {
      dateKey: "2026-04-13",
      startDateKey: "2026-04-13",
      endDateKey: "2026-04-13",
      colorKey: "green",
      note: "Cambio ajeno",
      updatedAt: Timestamp.now()
    })
  );
  await assertSucceeds(
    updateDoc(doc(adminDb, "artifacts", APP_ID, "public", "data", "calendar_events", "event-a"), {
      dateKey: "2026-04-13",
      startDateKey: "2026-04-13",
      endDateKey: "2026-04-13",
      colorKey: "slate",
      title: "Reunión administrada",
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(
    deleteDoc(doc(otherDb, "artifacts", APP_ID, "public", "data", "calendar_events", "event-a"))
  );
  await assertSucceeds(
    setDoc(doc(ownerDb, "artifacts", APP_ID, "public", "data", "calendar_events", "event-owner-delete"), {
      title: "Evento borrable",
      note: "El owner debe poder eliminarlo.",
      dateKey: "2026-07-12",
      startDateKey: "2026-07-12",
      endDateKey: "2026-07-12",
      allDay: true,
      colorKey: "red",
      createdByUid: "user-a",
      createdByName: "Dr. Usuario A",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    })
  );
  await assertSucceeds(
    deleteDoc(doc(ownerDb, "artifacts", APP_ID, "public", "data", "calendar_events", "event-owner-delete"))
  );
  await assertSucceeds(
    deleteDoc(doc(adminDb, "artifacts", APP_ID, "public", "data", "calendar_events", "event-a"))
  );
});

test("authenticated user can self-join committee_members when userUid matches auth.uid", async () => {
  await assertSucceeds(
    setDoc(
      doc(authedDb("user-b"), "artifacts", APP_ID, "public", "data", "committee_members", "self-join-b"),
      {
        committeeId: "comite_bioetica",
        userUid: "user-b",
        name: "Dr. Usuario B",
        businessUnit: "Upstream",
        managementUnit: "GSJ",
        committeeRole: "vocal",
        isLeader: false,
        createdAt: Timestamp.now()
      }
    )
  );
});

test("authenticated user legacy self-join still works without committeeRole", async () => {
  await assertSucceeds(
    setDoc(
      doc(authedDb("user-c"), "artifacts", APP_ID, "public", "data", "committee_members", "self-join-c"),
      {
        committeeId: "comite_bioetica",
        userUid: "user-c",
        name: "Dra. Usuario C",
        businessUnit: "Downstream",
        managementUnit: "CORS",
        isLeader: false,
        createdAt: Timestamp.now()
      }
    )
  );
});

test("authenticated user cannot self-join committee_members as referente", async () => {
  await assertFails(
    setDoc(
      doc(authedDb("user-d"), "artifacts", APP_ID, "public", "data", "committee_members", "self-join-d"),
      {
        committeeId: "comite_bioetica",
        userUid: "user-d",
        name: "Dr. Usuario D",
        businessUnit: "Upstream",
        managementUnit: "GSJ",
        committeeRole: "referente",
        isLeader: false,
        createdAt: Timestamp.now()
      }
    )
  );
});

test("non-admin cannot create committee_topics and admin can create them", async () => {
  await assertFails(
    setDoc(
      doc(authedDb("user-a"), "artifacts", APP_ID, "public", "data", "committee_topics", "topic-no-admin"),
      {
        committeeId: "comite_bioetica",
        title: "Proyecto restringido",
        createdAt: Timestamp.now()
      }
    )
  );
  await assertSucceeds(
    setDoc(
      doc(authedAdminDb("admin-a"), "artifacts", APP_ID, "public", "data", "committee_topics", "topic-admin"),
      {
        committeeId: "comite_bioetica",
        title: "Proyecto admin",
        createdAt: Timestamp.now()
      }
    )
  );
});

test("unauthenticated user cannot read or write source committee routes", async () => {
  await assertFails(
    getDoc(doc(unauthedDb(), "artifacts", APP_ID, "public", "data", "committee_messages", "flat-foro-msg"))
  );
  await assertFails(
    getDoc(doc(unauthedDb(), "artifacts", APP_ID, "public", "data", "committee_topics", "flat-topic-a"))
  );
  await assertFails(
    getDoc(doc(unauthedDb(), "artifacts", APP_ID, "public", "data", "committee_members", "flat-member-a"))
  );
  await assertFails(
    setDoc(
      doc(unauthedDb(), "artifacts", APP_ID, "public", "data", "committee_messages", "new-foro-msg"),
      {
        text: "Nuevo mensaje",
        author: "Invitado",
        businessUnit: "Upstream",
        managementUnit: "GSJ",
        committeeId: "foro_general",
        authorUid: "guest",
        authorName: "Invitado",
        createdAt: Timestamp.now(),
        likedBy: {}
      }
    )
  );
  await assertFails(
    setDoc(
      doc(unauthedDb(), "artifacts", APP_ID, "public", "data", "committee_members", "self-join-guest"),
      {
        committeeId: "comite_bioetica",
        userUid: "guest",
        name: "Invitado",
        businessUnit: "Upstream",
        managementUnit: "GSJ",
        committeeRole: "vocal",
        isLeader: false,
        createdAt: Timestamp.now()
      }
    )
  );
  await assertFails(
    setDoc(
      doc(unauthedDb(), "artifacts", APP_ID, "public", "data", "committee_topics", "topic-guest"),
      {
        committeeId: "comite_bioetica",
        title: "Proyecto invitado",
        createdAt: Timestamp.now()
      }
    )
  );
});

test("dm_carousel blocks direct updates to derived like fields while preserving owner content edits", async () => {
  const ownerDb = authedDb("user-a");
  const otherDb = authedDb("user-b");

  await assertSucceeds(
    updateDoc(doc(ownerDb, "dm_carousel", "post-a"), {
      text: "Post visible actualizado",
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(
    updateDoc(doc(ownerDb, "dm_carousel", "post-a"), {
      likesCount: 99
    })
  );
  await assertFails(
    updateDoc(doc(ownerDb, "dm_carousel", "post-a"), {
      likedBy: ["user-a"]
    })
  );
  await assertFails(
    updateDoc(doc(otherDb, "dm_carousel", "post-a"), {
      text: "Cambio ajeno"
    })
  );
  await assertFails(
    setDoc(doc(ownerDb, "dm_carousel", "post-a", "likes", "user-a"), {
      authorUid: "user-a",
      authorName: "Dr. Usuario A",
      createdAt: Timestamp.now()
    })
  );
});

test("dm_carousel allows authenticated art gallery posts with scoped metadata", async () => {
  const ownerDb = authedDb("user-a");

  await assertSucceeds(
    setDoc(doc(ownerDb, "dm_carousel", "art-post-a"), {
      type: "art_gallery",
      title: "Obra QA",
      text: "Descripción breve",
      briefDescription: "Descripción breve",
      longDescription: "Descripción ampliada de la obra.",
      artAuthor: "Autora QA",
      artYear: "2026",
      artWorkType: "Óleo",
      artLocation: "Neuquén",
      imageUrl: "https://example.test/obra.jpg",
      imagePath: "dm_carousel/user-a/obra.jpg",
      thumbUrl: "https://example.test/obra.jpg",
      imageAspect: "landscape",
      imageWidth: 1200,
      imageHeight: 800,
      authorUid: "user-a",
      authorName: "Dr. Usuario A",
      createdByUid: "user-a",
      createdByName: "Dr. Usuario A",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      likesCount: 0,
      likedBy: [],
      likedNames: [],
      commentCount: 0
    })
  );

  await assertFails(
    setDoc(doc(unauthedDb(), "dm_carousel", "art-post-guest"), {
      type: "art_gallery",
      title: "Obra invitada",
      imageUrl: "https://example.test/obra.jpg",
      authorUid: "guest",
      createdAt: Timestamp.now()
    })
  );

  await assertFails(
    setDoc(doc(ownerDb, "dm_carousel", "art-post-extra"), {
      type: "art_gallery",
      title: "Obra con campo no permitido",
      imageUrl: "https://example.test/obra.jpg",
      authorUid: "user-a",
      createdAt: Timestamp.now(),
      galleryType: "art"
    })
  );
});

test("dm_carousel comments still allow legit comment create delete and block direct like-map updates", async () => {
  const ownerDb = authedDb("user-a");
  const otherDb = authedDb("user-b");

  await assertSucceeds(
    setDoc(doc(otherDb, "dm_carousel", "post-a", "comments", "comment-b"), {
      text: "Nuevo comentario",
      authorUid: "user-b",
      authorName: "Dr. Usuario B",
      createdAt: Timestamp.now(),
      likedBy: {}
    })
  );
  await assertFails(
    updateDoc(doc(otherDb, "dm_carousel", "post-a", "comments", "comment-a"), {
      likedBy: {
        "user-b": "Dr. Usuario B",
        "user-a": "Dr. Usuario A"
      }
    })
  );
  await assertSucceeds(
    updateDoc(doc(authedDb("user-a"), "dm_carousel", "post-a", "comments", "comment-a"), {
      text: "Comentario editado",
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(
    updateDoc(doc(otherDb, "dm_carousel", "post-a", "comments", "comment-a"), {
      text: "Edición ajena",
      updatedAt: Timestamp.now()
    })
  );
  await assertSucceeds(
    deleteDoc(doc(authedDb("user-a"), "dm_carousel", "post-a", "comments", "comment-a"))
  );
});
