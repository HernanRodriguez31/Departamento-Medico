import { getFirebase } from "../../common/firebaseClient.js";
import {
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  runTransaction,
  where,
  increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { COLLECTIONS } from "../../common/collections.js";

const { POSTS: POSTS_COLLECTION, USERS: USERS_COLLECTION, COMMENTS: COMMENTS_COLLECTION } = COLLECTIONS;

export const getNextCursor = (docs = []) => (docs.length ? docs[docs.length - 1] : null);
export const hasMoreResults = (docs = [], pageSize = 0) => docs.length === pageSize;

const sanitizeFilename = (name = "image") => {
  const safe = String(name || "image").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return safe || "image";
};

const supportsWebp = () => {
  try {
    const canvas = document.createElement("canvas");
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch (e) {
    return false;
  }
};

const loadImage = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    resolve(img);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error("IMAGE_LOAD_FAILED"));
  };
  img.src = url;
});

const compressImage = async (file, { maxWidth = 1600, quality = 0.82 } = {}) => {
  if (!file || typeof document === "undefined") {
    return {
      blob: file,
      type: file?.type || "image/jpeg",
      name: sanitizeFilename(file?.name || "image.jpg")
    };
  }

  const image = await loadImage(file);
  const scale = Math.min(1, maxWidth / (image.width || 1));
  const targetWidth = Math.max(1, Math.round((image.width || 1) * scale));
  const targetHeight = Math.max(1, Math.round((image.height || 1) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  const outputType = supportsWebp() ? "image/webp" : "image/jpeg";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputType, quality));
  if (!blob) {
    return {
      blob: file,
      type: file.type || "image/jpeg",
      name: sanitizeFilename(file.name || "image.jpg")
    };
  }

  const safeName = sanitizeFilename(file.name || "image");
  const baseName = safeName.replace(/\.[^.]+$/, "") || "image";
  const extension = outputType === "image/webp" ? "webp" : "jpg";

  return {
    blob,
    type: outputType,
    name: `${baseName}.${extension}`
  };
};

const formatPostDoc = (snapshot) => {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    ...data,
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
    updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : null,
    likeCount: Number.isFinite(data.likeCount) ? data.likeCount : 0,
    commentCount: Number.isFinite(data.commentCount) ? data.commentCount : 0
  };
};

const formatCommentDoc = (snapshot) => {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    ...data,
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null
  };
};

const resolveAuthorProfile = async (db, user) => {
  if (!db || !user) return null;
  try {
    const snap = await getDoc(doc(db, USERS_COLLECTION, user.uid));
    if (!snap.exists()) return null;
    return snap.data() || null;
  } catch (e) {
    return null;
  }
};

export async function listPosts({ committeeId = null, pageSize = 8, cursor = null } = {}) {
  const { db, auth } = getFirebase();
  if (!db) throw new Error("DB_UNAVAILABLE");

  const baseQuery = committeeId !== undefined
    ? query(
        collection(db, POSTS_COLLECTION),
        where("committeeId", "==", committeeId ?? null),
        orderBy("createdAt", "desc"),
        limit(pageSize)
      )
    : query(
        collection(db, POSTS_COLLECTION),
        orderBy("createdAt", "desc"),
        limit(pageSize)
      );

  const qWithCursor = cursor ? query(baseQuery, startAfter(cursor)) : baseQuery;

  const snap = await getDocs(qWithCursor);
  const docs = snap.docs;
  const posts = docs.map(formatPostDoc);

  const user = auth?.currentUser || null;
  if (user) {
    await Promise.all(
      posts.map(async (post) => {
        try {
          const likeSnap = await getDoc(doc(db, POSTS_COLLECTION, post.id, "likes", user.uid));
          post.likedByMe = likeSnap.exists();
        } catch (e) {
          post.likedByMe = false;
        }
      })
    );
  }

  return {
    posts,
    cursor: getNextCursor(docs),
    hasMore: hasMoreResults(docs, pageSize)
  };
}

export async function listComments({ postId, pageSize = 20 } = {}) {
  const { db } = getFirebase();
  if (!db) throw new Error("DB_UNAVAILABLE");
  if (!postId) throw new Error("MISSING_POST_ID");

  const q = query(
    collection(db, POSTS_COLLECTION, postId, COMMENTS_COLLECTION),
    orderBy("createdAt", "desc"),
    limit(pageSize)
  );

  const snap = await getDocs(q);
  return {
    comments: snap.docs.map(formatCommentDoc)
  };
}

export async function createPost({
  text = "",
  imageFile = null,
  committeeId = null,
  onProgress = null
} = {}) {
  const { db, auth, storage } = getFirebase();
  if (!db || !auth || !storage) throw new Error("FIREBASE_UNAVAILABLE");
  const user = auth.currentUser;
  if (!user) throw new Error("AUTH_REQUIRED");

  const cleanText = text.trim();
  if (!cleanText && !imageFile) throw new Error("EMPTY_POST");

  const postRef = doc(collection(db, POSTS_COLLECTION));
  const postId = postRef.id;

  let imageUrl = "";
  let imagePath = "";
  if (imageFile) {
    let compressed = null;
    try {
      compressed = await compressImage(imageFile, { maxWidth: 1600, quality: 0.82 });
    } catch (e) {
      compressed = {
        blob: imageFile,
        type: imageFile.type || "image/jpeg",
        name: sanitizeFilename(imageFile.name || "image.jpg")
      };
    }

    const timestamp = Date.now();
    const filename = `${timestamp}_${compressed.name || sanitizeFilename(imageFile.name || "image.jpg")}`;
    imagePath = `${POSTS_COLLECTION}/${postId}/${filename}`;
    const storageReference = storageRef(storage, imagePath);

    const uploadTask = uploadBytesResumable(storageReference, compressed.blob, {
      contentType: compressed.type || imageFile.type || "image/jpeg"
    });

    const uploadPromise = new Promise((resolve, reject) => {
      uploadTask.on(
        "state_changed",
        (snapshot) => {
          if (typeof onProgress !== "function") return;
          const total = snapshot.totalBytes || 0;
          const progress = total ? snapshot.bytesTransferred / total : 0;
          onProgress({
            progress,
            bytesTransferred: snapshot.bytesTransferred || 0,
            totalBytes: total,
            state: snapshot.state
          });
        },
        (error) => reject(error),
        () => resolve()
      );
    });

    try {
      if (typeof onProgress === "function") {
        onProgress({ progress: 0, bytesTransferred: 0, totalBytes: 0, state: "running" });
      }
      await uploadPromise;
      imageUrl = await getDownloadURL(uploadTask.snapshot.ref);
    } catch (e) {
      throw new Error("UPLOAD_FAILED");
    }
  }

  const profile = await resolveAuthorProfile(db, user);
  const authorName =
    profile?.displayName ||
    profile?.nombreCompleto ||
    profile?.apellidoNombre ||
    user.displayName ||
    user.email ||
    "Usuario";

  const payload = {
    type: imageFile ? "image" : "text",
    text: cleanText,
    imageUrl: imageUrl || null,
    imagePath: imagePath || null,
    authorUid: user.uid,
    authorName,
    businessUnit: profile?.businessUnit || profile?.unidadNegocio || null,
    managementUnit: profile?.managementUnit || profile?.unidadGestion || null,
    committeeId: committeeId ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    likeCount: 0,
    commentCount: 0
  };

  await setDoc(postRef, payload);
  return { id: postId, ...payload };
}

export async function toggleLike({ postId }) {
  const { db, auth } = getFirebase();
  if (!db || !auth) throw new Error("FIREBASE_UNAVAILABLE");
  const user = auth.currentUser;
  if (!user) throw new Error("AUTH_REQUIRED");
  if (!postId) throw new Error("MISSING_POST_ID");

  const postRef = doc(db, POSTS_COLLECTION, postId);
  const likeRef = doc(db, POSTS_COLLECTION, postId, "likes", user.uid);
  let result = { liked: false, likeCount: 0 };

  await runTransaction(db, async (trx) => {
    const postSnap = await trx.get(postRef);
    const likeSnap = await trx.get(likeRef);
    const data = postSnap.data() || {};
    const currentCount = Number.isFinite(data.likeCount) ? data.likeCount : 0;

    if (likeSnap.exists()) {
      trx.delete(likeRef);
      const nextCount = Math.max(0, currentCount - 1);
      trx.update(postRef, { likeCount: nextCount, updatedAt: serverTimestamp() });
      result = { liked: false, likeCount: nextCount };
    } else {
      trx.set(likeRef, { createdAt: serverTimestamp(), authorUid: user.uid });
      const nextCount = currentCount + 1;
      trx.update(postRef, { likeCount: nextCount, updatedAt: serverTimestamp() });
      result = { liked: true, likeCount: nextCount };
    }
  });

  return result;
}

export async function addComment({ postId, text }) {
  const { db, auth } = getFirebase();
  if (!db || !auth) throw new Error("FIREBASE_UNAVAILABLE");
  const user = auth.currentUser;
  if (!user) throw new Error("AUTH_REQUIRED");
  if (!postId) throw new Error("MISSING_POST_ID");
  const cleanText = String(text || "").trim();
  if (!cleanText) throw new Error("EMPTY_COMMENT");

  const profile = await resolveAuthorProfile(db, user);
  const authorName =
    profile?.displayName ||
    profile?.nombreCompleto ||
    profile?.apellidoNombre ||
    user.displayName ||
    user.email ||
    "Usuario";

  const commentPayload = {
    text: cleanText,
    authorUid: user.uid,
    authorName,
    createdAt: serverTimestamp()
  };

  const postRef = doc(db, POSTS_COLLECTION, postId);
  const commentRef = doc(collection(db, POSTS_COLLECTION, postId, COMMENTS_COLLECTION));
  const createdAt = new Date();

  await runTransaction(db, async (trx) => {
    trx.set(commentRef, commentPayload);
    trx.update(postRef, {
      commentCount: increment(1),
      updatedAt: serverTimestamp()
    });
  });

  return { id: commentRef.id, ...commentPayload, createdAt };
}
