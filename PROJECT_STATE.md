# PROJECT_STATE

## Executive Summary
- The repo is a static HTML/CSS/JS portal backed by Firebase (Auth, Firestore, Storage, Messaging) with Firebase Functions for notifications and AI.
- There are multiple user entry points: desktop site (`index.html`), PWA mobile shell (`app/index.html`), committee microsites (`pages/comites/*.html`), and an AI assistant app (`asistente-ia/index.html`).
- Core features implemented: carousel/galeria, forum, chat with presence, notifications, AI assistant, and PWA support.

## Architecture Snapshot
- Frontend: no build pipeline; ES modules loaded from CDN; Tailwind CDN used on several pages.
- Backend: Firebase Hosting + Cloud Functions; Firestore and Storage rules included.
- Push: Firebase Messaging in `/app/` service worker and client scripts.

## Data and Services
- Firestore collections: usuarios, dm_carousel (+ comments), dm_posts (+ comments/likes), dm_chats, dm_conversations, dm_presence, notifications, pushTokens, admin_whitelist, dm_meta, committee_* under artifacts.
- Storage paths: dm_carousel, dm_posts, dm_profiles, avatars.
- Cloud Functions: onChatMessageCreated, onPostCommentCreated, onPostLikeCreated, aiChat.

## Current Gaps and Risks
- Missing root README and environment documentation.
- Mixed Firebase SDK versions and duplicated initialization paths across pages.
- Client-side exposure of VAPID public key; Gemini key removed but needs a backend proxy; service account key must remain local-only.
- Minimal offline strategy for the root site; root service worker unregisters caches.
- Unused app modules (`assets/js/app/*`, `assets/css/app/*`) appear orphaned.
- No lint/test tooling configured.

## Suggested Next Steps
1) Add a root README with setup, hosting, and Firebase project details.
2) Consolidate Firebase initialization and SDK versions.
3) Move sensitive keys out of client code; document secret management.
4) Decide whether the `assets/js/app` module is active or remove it.
5) Define a minimal test/lint strategy (even a basic ESLint/Prettier setup).

## Unknowns (DESCONOCIDO)
- Product ownership and target user roles.
  - Option A: internal-only staff portal with simple admin gating.
  - Option B: role-based access by committee and leadership.
- Compliance and data sensitivity requirements.
  - Option A: internal comms only, low compliance burden.
  - Option B: regulated data, requires audits and stricter controls.
- Environments (staging vs production).
  - Option A: single Firebase project.
  - Option B: separate projects with distinct configs.
