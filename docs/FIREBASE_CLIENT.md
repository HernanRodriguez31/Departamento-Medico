# FIREBASE_CLIENT

## Purpose
- Single Firebase initialization for the frontend.
- Single SDK version (10.12.0) across all pages and modules.

## Usage
Import the shared client from any module:

```js
import { getFirebase, auth, db, storage, ensureMessaging } from "/assets/js/common/firebaseClient.js";

const { app } = getFirebase();
// auth/db/storage are already initialized
```

For messaging (requires browser support):

```js
const messaging = await ensureMessaging();
if (messaging) {
  // use getToken/onMessage from firebase-messaging
}
```

## Config
- Default config is defined in `assets/js/common/firebaseClient.js`.
- Optional override: set `window.__FIREBASE_CONFIG__` before importing the module.

## Rules
- Do not call `initializeApp` anywhere else in the frontend.
- All Firebase SDK imports must use version `10.12.0`.
