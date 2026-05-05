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
const OTHER_EMAIL = process.env.ART_GALLERY_OTHER_EMAIL || "arte.otro@departamento-medico.test";
const OTHER_PASSWORD = process.env.ART_GALLERY_OTHER_PASSWORD || "OtherQa!12345";
const OTHER_DISPLAY_NAME = "Dr. Otro Arte";

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

const signInOrCreateUser = async ({
  email = QA_EMAIL,
  password = QA_PASSWORD,
  displayName = DISPLAY_NAME
} = {}) => {
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName });
    return credential.user;
  } catch (error) {
    if (error?.code !== "auth/email-already-in-use") throw error;
    const credential = await signInWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName }).catch(() => {});
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
      avatarUrl: "/assets/images/avatar-leila.png",
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

  const artPosts = [
    {
      title: "Horizonte Verde",
      briefDescription: "Paisaje horizontal sembrado para validar la Galería de Arte.",
      imageAspect: "landscape",
      imageWidth: 1200,
      imageHeight: 760
    },
    {
      title: "Retrato de Guardia",
      briefDescription: "Obra vertical sembrada para probar el marco adaptable.",
      imageAspect: "portrait",
      imageWidth: 760,
      imageHeight: 1200
    }
  ];

  for (const [index, post] of artPosts.entries()) {
    await addDoc(postsRef, {
      type: "art_gallery",
      title: post.title,
      text: post.briefDescription,
      briefDescription: post.briefDescription,
      longDescription: "Descripción ampliada de prueba para la auditoría visual y funcional.",
      artAuthor: index === 0 ? "Equipo QA" : "Dra. Mobile QA",
      artYear: "2026",
      artWorkType: index === 0 ? "Acrílico" : "Fotografía",
      artLocation: index === 0 ? "Buenos Aires" : "Neuquén",
      imageUrl: "/assets/images/og-dto-medico.jpg",
      thumbUrl: "/assets/images/og-dto-medico.jpg",
      imagePath: `dm_carousel/${user.uid}/art-qa-${index + 1}.jpg`,
      imageAspect: post.imageAspect,
      imageWidth: post.imageWidth,
      imageHeight: post.imageHeight,
      authorUid: user.uid,
      authorName: DISPLAY_NAME,
      createdByUid: user.uid,
      createdByName: DISPLAY_NAME,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      likedBy: [],
      likedNames: [],
      likesCount: 0,
      commentCount: 0
    });
  }

  await addDoc(postsRef, {
    type: "team_hobbies",
    title: "Caminata de integración QA",
    text: "Registro compartido para validar el muro de intereses y hobbies del equipo.",
    briefDescription: "Registro compartido para validar el muro de intereses y hobbies del equipo.",
    longDescription:
      "Una publicación de prueba con título y descripción para confirmar persistencia, comentarios y separadores.",
    artAuthor: DISPLAY_NAME,
    artYear: "2026",
    artWorkType: "Foto del equipo",
    artLocation: "Departamento Médico",
    imageUrl: "/assets/images/og-dto-medico.jpg",
    thumbUrl: "/assets/images/og-dto-medico.jpg",
    imagePath: `dm_carousel/${user.uid}/team-hobby-qa-1.jpg`,
    imageAspect: "landscape",
    imageWidth: 1200,
    imageHeight: 760,
    authorUid: user.uid,
    authorName: DISPLAY_NAME,
    createdByUid: user.uid,
    createdByName: DISPLAY_NAME,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    likedBy: [],
    likedNames: [],
    likesCount: 0,
    commentCount: 0
  });

  const otherUser = await signInOrCreateUser({
    email: OTHER_EMAIL,
    password: OTHER_PASSWORD,
    displayName: OTHER_DISPLAY_NAME
  });
  await setDoc(
    doc(db, "usuarios", otherUser.uid),
    {
      nombre: OTHER_DISPLAY_NAME,
      email: OTHER_EMAIL,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  await addDoc(postsRef, {
    type: "art_gallery",
    title: "Obra Ajena QA",
    text: "Publicación de otro usuario para validar acciones de propietario.",
    briefDescription: "Publicación de otro usuario para validar acciones de propietario.",
    longDescription: "Esta obra no debe mostrar acciones de edición ni borrado al usuario QA principal.",
    artAuthor: "Equipo QA Externo",
    artYear: "2026",
    artWorkType: "Collage",
    artLocation: "Comodoro Rivadavia",
    imageUrl: "/assets/images/og-dto-medico.jpg",
    thumbUrl: "/assets/images/og-dto-medico.jpg",
    imagePath: `dm_carousel/${otherUser.uid}/art-other-qa.jpg`,
    imageAspect: "square",
    imageWidth: 900,
    imageHeight: 900,
    authorUid: otherUser.uid,
    authorName: OTHER_DISPLAY_NAME,
    createdByUid: otherUser.uid,
    createdByName: OTHER_DISPLAY_NAME,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    likedBy: [],
    likedNames: [],
    likesCount: 0,
    commentCount: 0
  });
  await addDoc(postsRef, {
    type: "team_hobbies",
    title: "Hobby Ajeno QA",
    text: "Publicación de otro usuario para validar permisos de edición y eliminación.",
    briefDescription: "Publicación de otro usuario para validar permisos de edición y eliminación.",
    longDescription: "Esta foto no debe mostrar acciones de edición ni borrado al usuario QA principal.",
    artAuthor: OTHER_DISPLAY_NAME,
    artYear: "2026",
    artWorkType: "Foto personal",
    artLocation: "Departamento Médico",
    imageUrl: "/assets/images/og-dto-medico.jpg",
    thumbUrl: "/assets/images/og-dto-medico.jpg",
    imagePath: `dm_carousel/${otherUser.uid}/team-hobby-other-qa.jpg`,
    imageAspect: "square",
    imageWidth: 900,
    imageHeight: 900,
    authorUid: otherUser.uid,
    authorName: OTHER_DISPLAY_NAME,
    createdByUid: otherUser.uid,
    createdByName: OTHER_DISPLAY_NAME,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    likedBy: [],
    likedNames: [],
    likesCount: 0,
    commentCount: 0
  });
  await signInWithEmailAndPassword(auth, QA_EMAIL, QA_PASSWORD);

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
