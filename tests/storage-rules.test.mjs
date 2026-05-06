import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

const PROJECT_ID = "departamento-medico-brisa";
const BUCKET_URL = "gs://departamento-medico-brisa.firebasestorage.app";

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080
    },
    storage: {
      rules: readFileSync("storage.rules", "utf8"),
      host: "127.0.0.1",
      port: 9199
    }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "admin_whitelist", "admin-a"), {
      role: "admin"
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

const storageFor = (uid, claims = {}) =>
  testEnv.authenticatedContext(uid, claims).storage(BUCKET_URL);

const unauthedStorage = () => testEnv.unauthenticatedContext().storage(BUCKET_URL);

const pdfBytes = () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const imageBytes = () => new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);
const pngBytes = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

test("bitacora PDF storage allows authenticated reads and only owner PDF uploads", async () => {
  const owner = storageFor("user-a");
  const other = storageFor("user-b");
  const ownerRef = owner.ref("bitacora/article-documents/user-a/paper.pdf");

  await assertSucceeds(ownerRef.put(pdfBytes(), { contentType: "application/pdf" }));
  await assertSucceeds(ownerRef.getMetadata());
  await assertSucceeds(other.ref("bitacora/article-documents/user-a/paper.pdf").getMetadata());
  await assertFails(unauthedStorage().ref("bitacora/article-documents/user-a/paper.pdf").getMetadata());
  await assertFails(
    other.ref("bitacora/article-documents/user-a/other.pdf").put(pdfBytes(), { contentType: "application/pdf" })
  );
  await assertFails(unauthedStorage().ref("bitacora/article-documents/user-a/guest.pdf").put(pdfBytes(), { contentType: "application/pdf" }));
});

test("bitacora PDF storage blocks non-PDF and oversized files", async () => {
  const owner = storageFor("user-a");
  await assertFails(
    owner.ref("bitacora/article-documents/user-a/not-pdf.txt").put(new Uint8Array([1, 2, 3]), {
      contentType: "text/plain"
    })
  );
  await assertFails(
    owner.ref("bitacora/article-documents/user-a/big.pdf").put(new Uint8Array(20 * 1024 * 1024 + 1), {
      contentType: "application/pdf"
    })
  );
});

test("bitacora PDF storage allows owner delete and admin read/delete", async () => {
  const owner = storageFor("user-a");
  const admin = storageFor("admin-a", { admin: true });
  const ownerRef = owner.ref("bitacora/article-documents/user-a/delete-me.pdf");

  await assertSucceeds(ownerRef.put(pdfBytes(), { contentType: "application/pdf" }));
  await assertSucceeds(admin.ref("bitacora/article-documents/user-a/delete-me.pdf").getMetadata());
  await assertSucceeds(admin.ref("bitacora/article-documents/user-a/delete-me.pdf").delete());

  const secondRef = owner.ref("bitacora/article-documents/user-a/owner-delete.pdf");
  await assertSucceeds(secondRef.put(pdfBytes(), { contentType: "application/pdf" }));
  await assertFails(storageFor("user-b").ref("bitacora/article-documents/user-a/owner-delete.pdf").delete());
  await assertSucceeds(secondRef.delete());
});

test("dm_carousel storage allows authenticated reads and owner-only image writes", async () => {
  const owner = storageFor("user-a");
  const other = storageFor("user-b");
  const photoRef = owner.ref("dm_carousel/user-a/hobby.jpg");

  await assertSucceeds(photoRef.put(imageBytes(), { contentType: "image/jpeg" }));
  await assertSucceeds(photoRef.getMetadata());
  await assertSucceeds(other.ref("dm_carousel/user-a/hobby.jpg").getMetadata());
  await assertFails(unauthedStorage().ref("dm_carousel/user-a/hobby.jpg").getMetadata());
  await assertFails(
    other.ref("dm_carousel/user-a/other.jpg").put(imageBytes(), { contentType: "image/jpeg" })
  );
  await assertFails(
    owner.ref("dm_carousel/user-a/not-image.pdf").put(pdfBytes(), { contentType: "application/pdf" })
  );
  await assertFails(
    owner.ref("dm_carousel/user-a/big.jpg").put(new Uint8Array(25 * 1024 * 1024 + 1), {
      contentType: "image/jpeg"
    })
  );
  await assertFails(other.ref("dm_carousel/user-a/hobby.jpg").delete());
  await assertSucceeds(photoRef.delete());
});

test("dm_carousel storage accepts original PNG team-hobbies uploads with metadata", async () => {
  const owner = storageFor("user-a");
  const photoRef = owner.ref("dm_carousel/user-a/IMG_0678.png");

  await assertSucceeds(
    photoRef.put(pngBytes(), {
      contentType: "image/png",
      customMetadata: {
        type: "team_hobbies",
        source: "team_hobbies_original",
        imageColorPipeline: "original",
        imageOriginalName: "IMG_0678.png"
      }
    })
  );

  const metadata = await assertSucceeds(photoRef.getMetadata());
  assert.equal(metadata.contentType, "image/png");
  assert.equal(metadata.customMetadata?.type, "team_hobbies");
  assert.equal(metadata.customMetadata?.imageColorPipeline, "original");
});
