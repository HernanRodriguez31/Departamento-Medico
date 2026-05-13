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

const committeeNotePayload = (uid, overrides = {}) => ({
  committeeId: "comite_bioetica",
  scope: "committee",
  projectId: null,
  projectTitle: "",
  text: "Nota sintética de comité",
  authorUid: uid,
  authorName: uid === "user-a" ? "Dr. Usuario A" : "Dr. Usuario B",
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  likedBy: {},
  ...overrides
});

const calendarEventPayload = (uid, overrides = {}) => ({
  title: "Actividad sintética",
  note: "Nota de prueba",
  dateKey: "2026-05-13",
  startDateKey: "2026-05-13",
  endDateKey: "2026-05-13",
  allDay: true,
  colorKey: "green",
  calendarScope: "home",
  createdByUid: uid,
  createdByName: uid === "user-a" ? "Dr. Usuario A" : "Dr. Usuario B",
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...overrides
});

const bitacoraUser = (uid) => ({
  uid,
  displayName: uid === "admin-a" ? "Admin A" : uid === "user-b" ? "Dr. Usuario B" : "Dr. Usuario A",
  email: `${uid}@example.test`
});

const bitacoraArticlePayload = (uid, overrides = {}) => ({
  title: "Artículo sintético",
  sourceName: "Fuente de prueba",
  journal: "Revista de prueba",
  authors: ["Equipo médico"],
  sourceDomain: "example.test",
  officialUrl: "https://example.test/article",
  studyType: "observacional",
  evidenceType: "síntesis",
  tags: ["salud"],
  status: "pending_review",
  extractionStatus: "manual",
  methodologyProfile: {},
  sourcePages: [],
  extractionWarnings: [],
  createdBy: bitacoraUser(uid),
  updatedBy: bitacoraUser(uid),
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...overrides
});

const bitacoraLikePayload = (uid) => ({
  ...bitacoraUser(uid),
  createdAt: Timestamp.now()
});

const bitacoraCommentPayload = (uid, overrides = {}) => ({
  text: "Comentario sintético",
  createdBy: bitacoraUser(uid),
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  status: "visible",
  deletedAt: null,
  deletedBy: "",
  ...overrides
});

const carouselArtPayload = (uid, overrides = {}) => ({
  type: "art_gallery",
  title: "Obra sintética",
  text: "Descripción breve",
  briefDescription: "Descripción breve",
  longDescription: "Descripción extendida",
  artAuthor: "Autor sintético",
  artYear: "2026",
  artWorkType: "Pintura",
  artLocation: "Sala de prueba",
  imageUrl: "https://example.test/art.jpg",
  imagePath: `dm_carousel/${uid}/art.jpg`,
  thumbUrl: "https://example.test/art-thumb.jpg",
  imageAspect: "landscape",
  imageWidth: 1200,
  imageHeight: 800,
  authorUid: uid,
  authorName: "Dr. Usuario A",
  createdByUid: uid,
  createdByName: "Dr. Usuario A",
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  likesCount: 0,
  likedBy: [],
  likedNames: [],
  commentCount: 0,
  ...overrides
});

const carouselHobbyPayload = (uid, overrides = {}) => ({
  ...carouselArtPayload(uid, {
    type: "team_hobbies",
    title: "Hobby sintético",
    artWorkType: "Foto del equipo",
    imagePath: `dm_carousel/${uid}/hobby.jpg`,
    imageCrop: {
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      frameAspect: 1
    },
    imageOriginalName: "hobby.jpg",
    imageColorPipeline: "original"
  }),
  ...overrides
});

const carouselCommentPayload = (uid, overrides = {}) => ({
  text: "Comentario sintético",
  authorUid: uid,
  authorName: uid === "user-b" ? "Dr. Usuario B" : "Dr. Usuario A",
  createdAt: Timestamp.now(),
  likedBy: {},
  parentCommentId: null,
  rootCommentId: overrides.rootCommentId || "",
  replyDepth: 0,
  replyToCommentId: null,
  replyToAuthorName: "",
  deleted: false,
  deletedAt: null,
  deletedBy: "",
  ...overrides
});

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
    await setDoc(doc(db, "usuarios", "user-a"), {
      nombre: "Dr. Usuario A",
      displayName: "Dr. Usuario A",
      email: "usuario.a@example.test",
      avatarUrl: "https://example.test/avatar-a.jpg",
      avatarUpdatedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
    await setDoc(doc(db, "dm_session_controls", "user-a"), {
      uid: "user-a",
      forcePasswordChange: true,
      updatedAt: Timestamp.now()
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
      doc(db, "artifacts", APP_ID, "public", "data", "committee_notes", "note-a"),
      committeeNotePayload("user-a", {
        likedBy: {
          "user-b": "Dr. Usuario B"
        }
      })
    );
    await setDoc(
      doc(db, "artifacts", APP_ID, "public", "data", "calendar_events", "event-a"),
      calendarEventPayload("user-a")
    );
    await setDoc(
      doc(db, "bitacoraArticles", "article-a"),
      bitacoraArticlePayload("user-a")
    );
    await setDoc(
      doc(db, "bitacoraArticles", "article-a", "comments", "comment-a"),
      bitacoraCommentPayload("user-a")
    );
  });
});

after(async () => {
  await testEnv.cleanup();
});

const authedDb = (uid) => testEnv.authenticatedContext(uid).firestore();
const authedAdminDb = (uid) =>
  testEnv.authenticatedContext(uid, { admin: true }).firestore();
const unauthedDb = () => testEnv.unauthenticatedContext().firestore();

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

test("security audit, usernames and session controls block client writes", async () => {
  const db = authedDb("user-a");
  await assertFails(
    setDoc(doc(db, "securityAuditLogs", "log-a"), {
      eventType: "admin_temp_password_issued",
      createdAt: Timestamp.now()
    })
  );
  await assertFails(
    setDoc(doc(db, "usernames", "usuarioa"), {
      uid: "user-a",
      createdAt: Timestamp.now()
    })
  );
  await assertFails(
    setDoc(doc(db, "dm_session_controls", "user-a"), {
      uid: "user-a",
      forcePasswordChange: false,
      updatedAt: Timestamp.now()
    })
  );
});

test("owner can read own session control and others cannot", async () => {
  await assertSucceeds(getDoc(doc(authedDb("user-a"), "dm_session_controls", "user-a")));
  await assertFails(getDoc(doc(authedDb("user-b"), "dm_session_controls", "user-a")));
});

test("usuarios keeps sensitive fields blocked while avatar update remains allowed", async () => {
  const db = authedDb("user-a");
  await assertSucceeds(
    updateDoc(doc(db, "usuarios", "user-a"), {
      avatarUrl: "https://example.test/avatar-a-v2.jpg",
      avatarUpdatedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(
    updateDoc(doc(db, "usuarios", "user-a"), {
      role: "admin"
    })
  );
  await assertFails(
    updateDoc(doc(db, "usuarios", "user-a"), {
      security: { forcePasswordChange: false }
    })
  );
  await assertFails(
    updateDoc(doc(db, "usuarios", "user-a"), {
      superAdmin: true
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

test("committee_notes allows authenticated board use without anonymous or foreign writes", async () => {
  const ownerDb = authedDb("user-a");
  const otherDb = authedDb("user-b");
  const adminDb = authedAdminDb("admin-a");
  const notePath = ["artifacts", APP_ID, "public", "data", "committee_notes", "note-a"];

  await assertSucceeds(getDoc(doc(ownerDb, ...notePath)));
  await assertFails(getDoc(doc(unauthedDb(), ...notePath)));
  await assertSucceeds(
    setDoc(
      doc(ownerDb, "artifacts", APP_ID, "public", "data", "committee_notes", "note-new"),
      committeeNotePayload("user-a")
    )
  );
  await assertFails(
    setDoc(
      doc(ownerDb, "artifacts", APP_ID, "public", "data", "committee_notes", "note-spoofed"),
      committeeNotePayload("user-b")
    )
  );
  await assertSucceeds(
    updateDoc(doc(ownerDb, ...notePath), {
      text: "Nota actualizada por el autor",
      updatedAt: Timestamp.now(),
      updatedByUid: "user-a",
      updatedByName: "Dr. Usuario A"
    })
  );
  await assertSucceeds(
    updateDoc(doc(ownerDb, ...notePath), {
      likedBy: {
        "user-a": "Dr. Usuario A",
        "user-b": "Dr. Usuario B"
      }
    })
  );
  await assertFails(
    updateDoc(doc(otherDb, ...notePath), {
      text: "Cambio ajeno",
      updatedAt: Timestamp.now(),
      updatedByUid: "user-b",
      updatedByName: "Dr. Usuario B"
    })
  );
  await assertFails(
    updateDoc(doc(otherDb, ...notePath), {
      likedBy: {
        "user-b": "Dr. Usuario B"
      }
    })
  );
  await assertSucceeds(
    updateDoc(doc(adminDb, ...notePath), {
      text: "Nota moderada",
      updatedAt: Timestamp.now(),
      updatedByUid: "admin-a",
      updatedByName: "Admin A"
    })
  );
  await assertFails(deleteDoc(doc(otherDb, ...notePath)));
  await assertSucceeds(deleteDoc(doc(ownerDb, ...notePath)));
});

test("calendar_events allows authenticated owners and admins while blocking anonymous and foreign writes", async () => {
  const ownerDb = authedDb("user-a");
  const otherDb = authedDb("user-b");
  const adminDb = authedAdminDb("admin-a");
  const eventPath = ["artifacts", APP_ID, "public", "data", "calendar_events", "event-a"];

  await assertSucceeds(getDoc(doc(ownerDb, ...eventPath)));
  await assertFails(getDoc(doc(unauthedDb(), ...eventPath)));
  await assertSucceeds(
    setDoc(
      doc(ownerDb, "artifacts", APP_ID, "public", "data", "calendar_events", "event-new"),
      calendarEventPayload("user-a")
    )
  );
  await assertFails(
    setDoc(
      doc(ownerDb, "artifacts", APP_ID, "public", "data", "calendar_events", "event-spoofed"),
      calendarEventPayload("user-b")
    )
  );
  await assertSucceeds(
    updateDoc(doc(ownerDb, ...eventPath), {
      title: "Actividad actualizada",
      note: "Nota actualizada",
      dateKey: "2026-05-14",
      startDateKey: "2026-05-14",
      endDateKey: "2026-05-14",
      allDay: true,
      colorKey: "blue",
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(
    updateDoc(doc(otherDb, ...eventPath), {
      title: "Cambio ajeno",
      updatedAt: Timestamp.now()
    })
  );
  await assertSucceeds(
    updateDoc(doc(adminDb, ...eventPath), {
      title: "Actividad moderada",
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(deleteDoc(doc(otherDb, ...eventPath)));
  await assertSucceeds(deleteDoc(doc(ownerDb, ...eventPath)));
});

test("bitacoraArticles allows article owners admins likes and comments with scoped writes", async () => {
  const ownerDb = authedDb("user-a");
  const otherDb = authedDb("user-b");
  const adminDb = authedAdminDb("admin-a");
  const articleRef = doc(ownerDb, "bitacoraArticles", "article-a");

  await assertSucceeds(getDoc(articleRef));
  await assertFails(getDoc(doc(unauthedDb(), "bitacoraArticles", "article-a")));
  await assertSucceeds(
    setDoc(doc(ownerDb, "bitacoraArticles", "article-new"), bitacoraArticlePayload("user-a"))
  );
  await assertFails(
    setDoc(doc(ownerDb, "bitacoraArticles", "article-spoofed"), bitacoraArticlePayload("user-b"))
  );
  await assertSucceeds(
    updateDoc(articleRef, {
      title: "Artículo actualizado",
      updatedBy: bitacoraUser("user-a"),
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(
    updateDoc(doc(otherDb, "bitacoraArticles", "article-a"), {
      title: "Cambio ajeno",
      updatedBy: bitacoraUser("user-b"),
      updatedAt: Timestamp.now()
    })
  );
  await assertSucceeds(
    updateDoc(doc(adminDb, "bitacoraArticles", "article-a"), {
      status: "published",
      updatedBy: bitacoraUser("admin-a"),
      updatedAt: Timestamp.now()
    })
  );

  await assertSucceeds(
    setDoc(doc(ownerDb, "bitacoraArticles", "article-a", "likes", "user-a"), bitacoraLikePayload("user-a"))
  );
  await assertFails(
    setDoc(doc(ownerDb, "bitacoraArticles", "article-a", "likes", "user-b"), bitacoraLikePayload("user-b"))
  );
  await assertFails(
    updateDoc(doc(ownerDb, "bitacoraArticles", "article-a", "likes", "user-a"), {
      displayName: "Nombre alterado"
    })
  );
  await assertSucceeds(deleteDoc(doc(ownerDb, "bitacoraArticles", "article-a", "likes", "user-a")));

  await assertSucceeds(
    setDoc(
      doc(otherDb, "bitacoraArticles", "article-a", "comments", "comment-b"),
      bitacoraCommentPayload("user-b")
    )
  );
  await assertFails(
    setDoc(
      doc(unauthedDb(), "bitacoraArticles", "article-a", "comments", "comment-guest"),
      bitacoraCommentPayload("guest")
    )
  );
  await assertSucceeds(
    updateDoc(doc(ownerDb, "bitacoraArticles", "article-a", "comments", "comment-a"), {
      text: "Comentario editado",
      status: "visible",
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(
    updateDoc(doc(otherDb, "bitacoraArticles", "article-a", "comments", "comment-a"), {
      text: "Comentario ajeno",
      status: "visible",
      updatedAt: Timestamp.now()
    })
  );
  await assertSucceeds(
    updateDoc(doc(ownerDb, "bitacoraArticles", "article-a", "comments", "comment-a"), {
      text: "Comentario eliminado",
      status: "deleted",
      deletedAt: Timestamp.now(),
      deletedBy: "user-a",
      updatedAt: Timestamp.now()
    })
  );
  await assertSucceeds(
    setDoc(
      doc(otherDb, "bitacoraArticles", "article-a", "comments", "comment-a", "likes", "user-b"),
      bitacoraLikePayload("user-b")
    )
  );
  await assertFails(
    updateDoc(doc(otherDb, "bitacoraArticles", "article-a", "comments", "comment-a", "likes", "user-b"), {
      displayName: "Nombre alterado"
    })
  );
  await assertSucceeds(
    deleteDoc(doc(otherDb, "bitacoraArticles", "article-a", "comments", "comment-a", "likes", "user-b"))
  );
  await assertFails(deleteDoc(doc(otherDb, "bitacoraArticles", "article-a")));
  await assertSucceeds(deleteDoc(doc(ownerDb, "bitacoraArticles", "article-a")));
});

test("dm_carousel supports art gallery and hobbies fields while keeping like fields protected", async () => {
  const ownerDb = authedDb("user-a");
  const otherDb = authedDb("user-b");

  await assertSucceeds(
    setDoc(doc(ownerDb, "dm_carousel", "art-post"), carouselArtPayload("user-a"))
  );
  await assertSucceeds(
    updateDoc(doc(ownerDb, "dm_carousel", "art-post"), {
      briefDescription: "Descripción ajustada",
      longDescription: "Texto extendido ajustado",
      artAuthor: "Autor ajustado",
      artYear: "2027",
      artWorkType: "Fotografía",
      artLocation: "Hall central",
      updatedAt: Timestamp.now()
    })
  );
  await assertSucceeds(
    setDoc(doc(ownerDb, "dm_carousel", "hobby-post"), carouselHobbyPayload("user-a"))
  );
  await assertSucceeds(
    updateDoc(doc(ownerDb, "dm_carousel", "hobby-post"), {
      briefDescription: "Descripción del hobby ajustada",
      imageCrop: {
        zoom: 1.2,
        offsetX: 4,
        offsetY: -2,
        frameAspect: 1
      },
      imageAspect: "square",
      imageWidth: 900,
      imageHeight: 900,
      imageOriginalName: "hobby-editado.jpg",
      imageColorPipeline: "original",
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(
    updateDoc(doc(ownerDb, "dm_carousel", "hobby-post"), {
      likesCount: 99
    })
  );
  await assertFails(
    updateDoc(doc(otherDb, "dm_carousel", "hobby-post"), {
      briefDescription: "Cambio ajeno",
      updatedAt: Timestamp.now()
    })
  );
});

test("dm_carousel comments support hobbies replies and soft delete without direct like-map updates", async () => {
  const ownerDb = authedDb("user-a");
  const otherDb = authedDb("user-b");

  await assertSucceeds(
    setDoc(
      doc(otherDb, "dm_carousel", "post-a", "comments", "comment-b"),
      carouselCommentPayload("user-b", {
        rootCommentId: "comment-b"
      })
    )
  );
  await assertSucceeds(
    setDoc(
      doc(otherDb, "dm_carousel", "post-a", "comments", "reply-b"),
      carouselCommentPayload("user-b", {
        parentCommentId: "comment-a",
        rootCommentId: "comment-a",
        replyDepth: 1,
        replyToCommentId: "comment-a",
        replyToAuthorName: "Dr. Usuario A"
      })
    )
  );
  await assertSucceeds(
    updateDoc(doc(otherDb, "dm_carousel", "post-a", "comments", "comment-b"), {
      deleted: true,
      deletedAt: Timestamp.now(),
      deletedBy: "user-b",
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(
    updateDoc(doc(otherDb, "dm_carousel", "post-a", "comments", "comment-a"), {
      deleted: true,
      deletedAt: Timestamp.now(),
      deletedBy: "user-b",
      updatedAt: Timestamp.now()
    })
  );
  await assertFails(
    updateDoc(doc(ownerDb, "dm_carousel", "post-a", "comments", "comment-a"), {
      likedBy: {
        "user-a": "Dr. Usuario A"
      }
    })
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
    deleteDoc(doc(authedDb("user-a"), "dm_carousel", "post-a", "comments", "comment-a"))
  );
});
