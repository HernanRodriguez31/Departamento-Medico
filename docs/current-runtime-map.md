# Current Runtime Map

Mapa operativo del runtime actual, sin cambios de comportamiento.

## 1. Entrypoints reales

| Entrypoint | Rol actual | Observaciones |
| --- | --- | --- |
| `index.html` | home desktop + shell legacy | redirige a `/app/index.html` en mobile; concentra foro general, push desktop, lazy-load de chat y gran parte del runtime legacy |
| `app/index.html` | app shell mobile + base SPA `/app` | registra `/app/service-worker.js`, monta foro general, push app y carga `assets/js/app/app.js` |
| `login.html` | login real | usa Firebase Auth/Firestore; limpia service workers raiz y caches historicas al entrar |
| `app.html` | redirect shim | redirige a `/app/index.html` preservando `search` y `hash` |
| `open.html` | redirect para apertura desde notificaciones | decide `/index.html` o `/app/index.html` segun viewport y preserva query/hash |
| `offline.html` | fallback offline | referenciado por ambos service workers |
| `asistente-ia/index.html` | cliente del asistente IA en iframe | usa `fetch("/api/ai")` con bearer token tomado del host |
| `pages/comites/*.html` | paginas standalone con runtime Firebase propio | cada una embebe auth, foro del comite, miembros, topics y recursos; comparten patron de acceso a `artifacts/{appId}/public/data/*` |

## 2. Modulos criticos

| Modulo | Responsabilidad actual |
| --- | --- |
| `assets/js/common/firebaseClient.js` | init modular Firebase v10, cache de `app/auth/db/storage`, helper `ensureMessaging()` |
| `assets/js/common/notifications.js` | notificaciones in-app, toasts, subscription a `notifications`, `markRead`, `markAllRead`, `create/upsert` desde browser |
| `assets/js/shared/authGate.js` | espera auth y resuelve redirect a login preservando hash |
| `assets/js/shared/sessionGuard.js` | timeout de sesion, forced logout via Firestore, broadcast entre tabs, presencia offline |
| `assets/js/shared/assistant-shell.js` | shell del asistente, bridge `dmGetAuthToken`, iframes y eventos cross-frame |
| `assets/js/pages/index.js` | runtime principal de home legacy: muro/galeria, KPIs, feed, comites, visitas, assistant shell |
| `assets/js/pages/app.js` | runtime principal legacy dentro de `/app`: muro/galeria, feed, comites, assistant shell |
| `js/chat.js` | chat flotante/hub, presencia, directorio de usuarios, mensajes, unread, espejo al foro y upsert de notificaciones |
| `js/app.js` | shell hash legacy de home para mobile/PWA, menu, nav inferior, login modal legacy |
| `js/app-mobile.js` | shell mobile avanzado con pager, canonicalizacion de hashes, bottom nav, integracion con assistant shell |
| `assets/js/app/router.js` | router hash `#/feed`, `#/groups`, `#/messages`, `#/notifications` |
| `assets/js/app/app.js` | bootstrap SPA `/app`, lazy import de vistas y badges de notificaciones |
| `assets/js/app/views/feed.view.js` | UI del feed nuevo |
| `assets/js/app/views/groups.view.js` | listado y detalle de grupos/comites dentro de SPA |
| `assets/js/app/views/messages.view.js` | bandeja de conversaciones de SPA; integra `window.BrisaChat` |
| `assets/js/app/views/notifications.view.js` | lista de notificaciones SPA y navegacion hacia mensajes/grupos/feed |
| `assets/js/app/services/posts.service.js` | operaciones del feed nuevo sobre `dm_posts`, comentarios, likes y uploads |

## 3. Dependencias principales

- Firebase modular v10 desde `https://www.gstatic.com/firebasejs/10.12.0/...`
- Firebase compat en `app/service-worker.js` para Messaging background
- SweetAlert2 por CDN
- Tailwind CDN en `index.html` y `app/index.html`
- Lucide por CDN
- Font Awesome por CDN
- Google Fonts

## 4. Flujo actual de Firebase init

### Home / desktop

1. `index.html` importa `assets/js/common/firebaseClient.js`.
2. `firebaseClient.js` inicializa o reutiliza la app Firebase y expone `getFirebase()` / `ensureMessaging()`.
3. `index.html` copia referencias a globals:
   - `window.__FIREBASE_CONFIG__`
   - `window.__FIREBASE_APP__`
   - `window.__FIREBASE_AUTH__`
   - `window.__FIREBASE_DB__`
   - `window.__FIREBASE_STORAGE__`
4. Los bloques inline de `index.html`, `assets/js/common/notifications.js`, `assets/js/pages/index.js` y `js/chat.js` consumen el mismo singleton.
5. El desktop usa `ensureMessaging()` y luego intenta asociar `getToken()` al service worker raiz.

### App shell `/app`

1. `app/index.html` repite el bootstrap de Firebase y vuelve a exponer los mismos globals.
2. `assets/js/pages/app.js` consume `getFirebase()`.
3. `assets/js/app/app.js` y vistas `assets/js/app/views/*` consumen el mismo singleton para la SPA nueva.
4. `app/index.html` registra `/app/service-worker.js` y le envia `INIT_FIREBASE` con `window.__FIREBASE_CONFIG__`.
5. El app shell usa `ensureMessaging()` y asocia `getToken()` al SW scope `/app/`.

### Login

1. `login.html` importa `getFirebase()` directamente.
2. Resuelve alias `username -> email` via Firestore.
3. Tras login, asegura `usuarios/{uid}` con `setDoc(..., { merge: true })`.

## 5. Flujo actual de router y hash

### Home / shell legacy

- `index.html` usa hashes visibles:
  - `#carrete`
  - `#estructura`
  - `#comites`
  - `#evidencia`
  - `#foro`
- `js/app.js` canoniza alias mobile:
  - `muro -> carrete`
  - `estructura-funcional -> estructura`
  - `galeria-operativa -> carrete`
- Cualquier hash que contenga `"chat"` dispara lazy-load de `js/chat.js`.

### Mobile shell legacy

- `js/app-mobile.js` maneja vistas canonicas:
  - `muro`
  - `estructura`
  - `ia`
  - `comites`
  - `foro`
- Hashes canonicos expuestos:
  - `#carrete`
  - `#estructura`
  - `#ia`
  - `#comites`
  - `#foro`
- Alias soportados:
  - `#muro`
  - `#estructura-funcional`
  - `#evidencia`
  - `#investigacion`
  - `#galeria-operativa`
- Expone `window.__dmMobileShell.navigateToView/getCurrentViewId/getNextViewId/getPrevViewId`.

### SPA `/app`

- `assets/js/app/router.js` normaliza y monta solo:
  - `#/feed`
  - `#/groups`
  - `#/messages`
  - `#/notifications`
- `assets/js/app/views/groups.view.js` soporta detalle `#/groups/:committeeId`.
- `assets/js/app/views/notifications.view.js` puede navegar a:
  - `#/messages`
  - `#/groups`
  - `#/groups/:committeeId`
  - `#/feed`
  - `notif.route` si empieza con `#/`

### Redirect shims

- `app.html` redirige a `/app/index.html` preservando `search/hash`.
- `open.html` redirige a `/index.html` o `/app/index.html` segun viewport, preservando `search/hash`.
- `authGate.js` construye `/login.html?next=<hash>`.

## 6. Service workers activos y runtime offline

### `/app/service-worker.js`

- Registro detectado:
  - `app/index.html` registra `/app/service-worker.js` con scope `/app/`.
- Handshake:
  - recibe `INIT_FIREBASE` via `postMessage`.
- Capacidades activas:
  - precache de shell `/app`
  - `fetch` caching para `/app/` y `/assets/`
  - `firebase-messaging-compat` background
  - `notificationclick` que enfoca ventana existente o abre `open.html`
- Assets precacheados:
  - `/app/index.html`
  - `/offline.html`
  - `/css/app.css`
  - `/assets/css/pages/app.css?...`
  - `/assets/js/pages/app.js?...`
  - `/js/chat.js?...`
  - `/js/app-mobile.js`

### `/service-worker.js`

- Archivo existe y tiene precache/caching para la raiz.
- `index.html` no registra explicitamente este SW; solo intenta obtener `getRegistration("/service-worker.js")` y `navigator.serviceWorker.ready` para push.
- `login.html` busca y desregistra cualquier SW de scope raiz y limpia caches `dm-*`, `departamento-medico*`, `brisa-*`.
- Implicacion actual:
  - el SW raiz parece historico o condicional por instalacion previa, no claramente parte del bootstrap actual.

### Offline actual

- Ambos SWs usan `/offline.html` como fallback.
- El comportamiento offline real y consistente hoy depende de si el cliente tiene instalado el SW correspondiente al scope correcto.

## 7. Cloud Functions y backend consumido por el cliente

### Uso directo por cliente

- `POST /api/ai`
  - origen: `asistente-ia/index.html`
  - auth: bearer token via `window.parent.dmGetAuthToken()` o `window.dmGetAuthToken()`
  - rewrite Hosting: `firebase.json -> functions.aiChat`

### Uso indirecto por cliente a traves de Firestore writes

- `onChatMessageCreated_v2`
  - trigger: `dm_chats/{conversationId}/messages/{messageId}`
  - efecto: lee `pushTokens/{uid}` y envia push
- `onPostCommentCreated_v2`
  - trigger: `dm_posts/{postId}/comments/{commentId}`
  - efecto: crea `notifications` y push
- `onPostLikeCreated_v2`
  - trigger: `dm_posts/{postId}/likes/{uid}`
  - efecto: crea `notifications` y push

## 8. Funciones publicas expuestas en `window`

### `index.html`

- `__FIREBASE_CONFIG__`
- `__FIREBASE_APP__`
- `__FIREBASE_AUTH__`
- `__FIREBASE_DB__`
- `__FIREBASE_STORAGE__`
- `__APP_ID__`
- `editForumMessage`
- `deleteForumMessage`
- `toggleForumLike`
- `toggleForumLikePopover`
- `__ensureChatLoaded`
- `enablePushNotifications`
- `__resetPushPrompt`

### `app/index.html`

- `__FIREBASE_CONFIG__`
- `__FIREBASE_APP__`
- `__FIREBASE_AUTH__`
- `__FIREBASE_DB__`
- `__FIREBASE_STORAGE__`
- `__APP_ID__`
- `editForumMessage`
- `deleteForumMessage`
- `toggleForumLike`
- `toggleForumLikePopover`
- `__ensureChatLoaded`
- `enablePushNotifications`
- `__resetPushPrompt`

### `login.html`

- `togglePassword`
- `openModal`
- `closeModal`
- `login`

### `js/app.js`

- `toggleTask`
- `deleteTask`
- `handleLogin`
- `handleForgotPassword`
- `togglePasswordVisibility`

### `js/app-mobile.js`

- `__DM_DEBUG_STANDALONE_SCROLL`
- `__dmMobileShell`
- `toggleTask`
- `deleteTask`
- `handleLogin`
- `handleForgotPassword`
- `togglePasswordVisibility`

### `assets/js/shared/assistant-shell.js`

- `dmGetAuthToken`
- `__dmAssistantShell`

### `js/chat.js`

- `__brisaChatIsConversationVisible`
- `__brisaChatTotalUnread`
- `BrisaChat`

### `assets/js/common/notifications.js`

- `BrisaNotifications`

### SPA `/app`

- `__brisaUpdateNotificationBadges`
- `__brisaOpenConversation` (estado puente)
- `__brisaFocusPostId` (estado puente)

### `pages/comites/*.html`

- `editForumMessage`
- `deleteForumMessage`
- `editProject` o `editProjectProposedBy` segun pagina
- `updateTopicStage`
- `updateTopicDate`
- `deleteTopic`
- `deleteMember`

## 9. Flujos visibles que hoy deben seguir funcionando sin cambios

- login real en `login.html`
- carga inicial desktop desde `index.html`
- carga inicial mobile/app shell desde `/app/index.html`
- navegacion por hash en home legacy
- navegacion por hash y detalle en SPA `/app`
- apertura de chat por hash, notificacion o vista `#/messages`
- envio y recepcion de mensajes DM, chat grupal y foro general espejo
- render del foro general y foros de comites
- notificaciones in-app y badges
- habilitacion de push desde UI actual
- push foreground en home/app
- push background de `/app` via `app/service-worker.js` si el entorno lo soporta
- upload de avatar
- upload de imagen al feed legacy (`dm_carousel/*`)
- upload de post en feed nuevo (`dm_posts/*`)
- fallback offline ligado a service workers

## 10. Puntos criticos de riesgo observados

- Firestore y tokens push estan acoplados a runtime browser legacy, SPA nueva, chat y paginas de comites; endurecer reglas sin secuencia puede romper muchos flujos a la vez.
- `notifications` hoy se lee desde varios puntos, pero tambien se crea/upsertea desde cliente; mover eso al backend exigira cambiar chat y notificaciones juntas.
- `pushTokens/{uid}` depende de UI actual de permisos, `getToken()` en dos entrypoints y Functions que leen esos tokens; cualquier endurecimiento requiere coordinar cliente + backend.
- `js/chat.js` es un punto de acoplamiento alto:
  - presencia
  - directorio de usuarios
  - mensajes
  - unread
  - notificaciones
  - espejo al foro
- Existen dos capas de navegacion en `/app`:
  - shell mobile/hash legacy (`js/app-mobile.js`)
  - SPA nueva `#/feed|groups|messages|notifications`
  endurecer rutas o guards sin separar estas capas tiene alto riesgo de regresion.
- El service worker raiz existe pero no tiene bootstrap visible actual; el login intenta limpiarlo. Antes de tocar offline/push desktop conviene verificar el estado real en clientes ya instalados.
- Las paginas `pages/comites/*.html` duplican bastante logica Firebase en runtime standalone; cualquier cambio de reglas afecta home, `/app` y esas paginas en paralelo.
- El asistente IA depende de:
  - `window.dmGetAuthToken`
  - rewrite `/api/ai`
  - iframe `asistente-ia/index.html`
  tocar auth bridge o headers puede romper el flujo completo.

## 11. TODOs de verificacion precisa para pasos posteriores

- Verificar en un navegador limpio si `index.html` llega a instalar algun SW raiz o solo consume uno historico.
- Confirmar si todas las paginas de comites deben seguir siendo entrypoints standalone o si algunas ya no estan enlazadas desde la UI principal.
- Verificar si `aiChat_v2` debe mantenerse publicado o puede eliminarse mas adelante sin consumidores.
