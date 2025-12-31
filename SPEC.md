# SPEC

## Objective
- Internal collaborative portal for Departamento Medico Brisa, described as an "Espacio de trabajo colaborativo para el crecimiento colectivo" in meta descriptions.
- README.md is missing at repo root, so objective is inferred from HTML metadata and on-page copy.

## Project Tree (main folders and key files)
```
.
|-- index.html
|-- app.html
|-- login.html
|-- open.html
|-- offline.html
|-- manifest.json
|-- service-worker.js
|-- firebase.json
|-- firestore.rules
|-- storage.rules
|-- app/
|   |-- index.html
|   |-- manifest.json
|   |-- manifest.webmanifest
|   |-- service-worker.js
|-- asistente-ia/
|   |-- index.html
|   |-- boti-brisa.jpg
|-- assets/
|   |-- css/
|   |   |-- pages/index.css
|   |   |-- pages/app.css
|   |   |-- pages/comite.css
|   |   |-- app/tokens.css
|   |   |-- app/app.css
|   |   |-- core-contrast.css
|   |-- js/
|   |   |-- pages/index.js
|   |   |-- pages/app.js
|   |   |-- shared/assistant-shell.js
|   |   |-- shared/authGate.js
|   |   |-- common/firebase.js
|   |   |-- common/notifications.js
|   |   |-- app/router.js
|   |   |-- app/views/*.js
|   |   |-- app/services/posts.service.js
|   |-- images/
|   |-- icons/
|   |-- sounds/
|-- css/
|   |-- variables.css
|   |-- style.css
|   |-- structure.css
|   |-- app.css
|-- js/
|   |-- app.js
|   |-- app-mobile.js
|   |-- chat.js
|   |-- committee-links.js
|-- pages/
|   |-- comites/*.html
|-- functions/
|   |-- index.js
|   |-- package.json
|-- carga - usuarios/
|   |-- subir_medicos.js
|   |-- package.json
|-- tools/
|   |-- pwa-icons/
|       |-- generate-icons.js
|       |-- package.json
|-- docs/
|   |-- ROADMAP_PWA_SOCIAL.md
```

## Stack and Architecture
- Frontend: static HTML/CSS/JS with ES modules from CDN.
- UI libs: Tailwind CDN (index, app, comites, asistente-ia), Lucide icons, Font Awesome.
- JS framework usage: React (only inside `asistente-ia/index.html` via esm.sh + Babel in browser).
- Backend: Firebase Auth, Firestore, Storage, Messaging; Firebase Functions.
- Hosting: Firebase Hosting (see `firebase.json`).
- Router: custom hash router for the app module (`assets/js/app/router.js`). Main site uses hash anchors and a mobile `data-view` switch.
- Build tooling: none at repo root. Node packages exist only for Functions, data import, and icon generation.

## IA/UX: Navigation and Sections
- Desktop (index.html):
  - Header with branding, notifications dropdown, user menu.
  - Left fixed sidebar of navigation cubes (KPI, Estructura, Registro/Carrete, Foro) that scroll to sections.
  - Sections: hero/estructura, referentes, estructura funcional (org chart), comites list, carousel/galeria (dm_carousel), foro general.
  - Floating chat bubble and chat panel (BrisaChat), plus AI assistant trigger.
- Mobile/PWA (app/index.html):
  - Bottom nav drives `data-view` sections (carrete, estructura, comites, foro).
  - Same content modules as desktop adapted to mobile layout, plus push integration and PWA shell.
- Committee pages (`pages/comites/*.html`):
  - Dedicated committee dashboards with activity, members, topics, and embedded links.
- AI assistant (`asistente-ia/index.html`):
  - Embedded React chat UI for Gemini/GPT model selection, loaded inside an iframe by `assistant-shell.js`.

## Design Rules (from CSS and inline styles)
- Colors:
  - Brisa green variants in `css/variables.css` and `assets/css/app/tokens.css` (ex: `--color-brisa-500: #7ab800`, `--brisa: #6abf4b`).
  - Tailwind config defines `brisa` color with `#7AB800`.
- Typography:
  - Google Fonts: Manrope and Inter (Manrope used as primary UI font).
  - `assets/css/app/tokens.css` defines font scale and tokens; `css/variables.css` defines base sizes.
- Spacing and radius:
  - Tokenized in `assets/css/app/tokens.css` (`--space-*`, `--radius-*`, `--shadow-*`).
- Breakpoints:
  - Common media queries at 640, 768, 900, 980, 1024, 1100px.
  - Desktop behavior at `min-width: 1024px`; mobile shell uses `max-width: 768px` and `display-mode: standalone`.

## Functional Requirements (derived from code)
- Authentication and access control
  - Firebase Auth login required for protected features; redirect to `/login.html` when unauthenticated.
- Content modules
  - Carousel/galeria (`dm_carousel`) with upload, likes, comments, and admin delete.
  - Foro general using `artifacts/{appId}/public/data/committee_messages` with posting and moderation.
  - Comites list and committee detail pages, including membership and project links.
- Communication
  - Chat (BrisaChat) with DM, group chat, presence, and conversation lists.
  - In-app notifications panel with read/unread states.
  - Push notifications via Firebase Messaging.
- AI assistant
  - Model picker (Gemini/GPT) and embedded assistant panel via iframe.
  - `/api/ai` endpoint on Functions for GPT via OpenAI.
- PWA support
  - Manifests, service workers, offline fallback page, and deep-link handler (`open.html`).

## Non-Functional Requirements (derived from code)
- Performance: static HTML and CDN-loaded modules; limited caching (app shell only).
- SEO: static pages include standard meta tags and Open Graph/Twitter cards.
- Accessibility: some ARIA attributes and keyboard handlers are present, but coverage is partial.
- Security: Firestore and Storage rules require authenticated users; admin checks via token claims or whitelist.
- Internationalization: Spanish UI strings; no i18n framework.

## APIs, Data Models, and Services
- Firebase Auth: sign-in, token-based access, user gating.
- Firestore collections (from rules and code):
  - `usuarios`, `admin_whitelist`, `dm_posts` (+ `comments`, `likes`), `dm_carousel` (+ `comments`),
    `dm_chats`, `dm_conversations`, `dm_presence`, `notifications`, `pushTokens`, `dm_meta`.
  - `artifacts/{appId}/public/data/committee_messages`, `committee_topics`, `committee_members`, `committee_meta`.
- Storage paths: `dm_carousel/{uid}`, `dm_posts/{postId}`, `dm_profiles/{uid}`, `avatars/{uid}`.
- Firebase Functions:
  - `onChatMessageCreated` (push for new messages).
  - `onPostCommentCreated` and `onPostLikeCreated` (notifications + push).
  - `aiChat` (HTTP endpoint for GPT, exposed at `/api/ai` via Hosting rewrite).
- External services:
  - OpenAI API (Functions, uses secret `OPENAI_API_KEY`).
  - Gemini API key embedded in `asistente-ia/index.html`.
  - SharePoint links for committee project slots (`js/committee-links.js`).

## Pending and Risks
- Missing top-level README and build docs, making onboarding and deployment assumptions unclear.
- Mixed Firebase SDK versions across pages (10.7.1 vs 10.12.0) and multiple initialization points.
- Sensitive keys in client code (VAPID public key; Gemini key removed but needs backend proxy); service account key must remain local-only.
- `assets/js/app/*` and `assets/css/app/*` appear unused (no HTML references found).
- No lint/test configuration at repo root.
- Root service worker is a cache cleanup/unregister stub; offline strategy is minimal outside `/app/`.
- Docs mention missing PWA icons and dual service workers; verify current assets and SW registration consistency.

## Unknowns (DESCONOCIDO)
- Target user roles and permission model beyond admin whitelist.
  - Option A: all authenticated staff users share same access.
  - Option B: role-based access (admin, committee leaders, standard members).
- Compliance requirements (health data, privacy, retention).
  - Option A: no patient data handled, standard internal data only.
  - Option B: regulated data, requires audit trails and stricter access controls.
- Deployment environments (staging vs production).
  - Option A: single Firebase project only.
  - Option B: separate projects/environments with distinct configs.
