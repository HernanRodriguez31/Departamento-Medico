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
