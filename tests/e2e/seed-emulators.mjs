import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  updateProfile
} from "firebase/auth";
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  serverTimestamp,
  setDoc
} from "firebase/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "departamento-medico-brisa";
const QA_EMAIL = process.env.MOBILE_QA_EMAIL || "mobile.qa@departamento-medico.test";
const QA_PASSWORD = process.env.MOBILE_QA_PASSWORD || "MobileQa!12345";
const DISPLAY_NAME = "Dra. Mobile QA";

const app = initializeApp({
  apiKey: "fake-emulator-key",
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.appspot.com`,
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:mobileqa"
});

const auth = getAuth(app);
const db = getFirestore(app);

connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFirestoreEmulator(db, "127.0.0.1", 8080);

const signInOrCreateUser = async () => {
  try {
    const credential = await createUserWithEmailAndPassword(auth, QA_EMAIL, QA_PASSWORD);
    await updateProfile(credential.user, { displayName: DISPLAY_NAME });
    return credential.user;
  } catch (error) {
    if (error?.code !== "auth/email-already-in-use") throw error;
    const credential = await signInWithEmailAndPassword(auth, QA_EMAIL, QA_PASSWORD);
    return credential.user;
  }
};

const seed = async () => {
  const user = await signInOrCreateUser();
  const profileRef = doc(db, "usuarios", user.uid);
  await setDoc(
    profileRef,
    {
      nombre: DISPLAY_NAME,
      email: QA_EMAIL,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  const postsRef = collection(db, "dm_carousel");
  for (let index = 1; index <= 8; index += 1) {
    await addDoc(postsRef, {
      type: "image",
      title: `Publicacion QA ${index}`,
      text:
        index % 2 === 0
          ? "Mensaje de validacion mobile con texto suficiente para probar altura, scroll y lectura en tarjetas del muro."
          : "Actualizacion breve para validar el feed mobile.",
      imageUrl: "/assets/images/og-dto-medico.jpg",
      authorUid: user.uid,
      authorName: DISPLAY_NAME,
      createdByUid: user.uid,
      createdByName: DISPLAY_NAME,
      businessUnit: index % 2 === 0 ? "Upstream" : "Downstream",
      managementUnit: "QA Mobile",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      likedBy: [],
      likedNames: [],
      likesCount: 0
    });
  }

  const messagesRef = collection(
    db,
    "artifacts",
    "departamento-medico-brisa",
    "public",
    "data",
    "committee_messages"
  );
  for (let index = 1; index <= 18; index += 1) {
    await addDoc(messagesRef, {
      text: `Mensaje QA ${index}: validacion de foro mobile, scroll, acciones tactiles y conservacion de posicion.`,
      author: DISPLAY_NAME,
      authorUid: user.uid,
      authorName: DISPLAY_NAME,
      businessUnit: "QA",
      managementUnit: "Mobile",
      committeeId: "foro_general",
      createdAt: serverTimestamp(),
      likedBy: {}
    });
  }

  await setDoc(doc(db, "dm_meta", "home_visits"), {
    count: 1,
    updatedAt: serverTimestamp()
  });

  console.log(
    JSON.stringify({
      seeded: true,
      email: QA_EMAIL,
      uid: user.uid,
      projectId: PROJECT_ID
    })
  );
};

await seed();
await deleteApp(app);
