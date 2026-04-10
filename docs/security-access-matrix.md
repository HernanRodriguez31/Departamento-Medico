# Security Access Matrix

Inventario manual del runtime actual. Fuente: codigo real del workspace al momento del relevamiento.

## Alcance y convenciones

- Tipos de runtime:
  - `browser runtime`: codigo ejecutado por la app en el navegador.
  - `service worker`: codigo ejecutado en `service-worker.js` o `app/service-worker.js`.
  - `Cloud Function`: codigo backend en `functions/index.js`.
  - `script auxiliar/operativo`: scripts fuera del runtime visible principal que tocan el mismo backend.
- Esta matriz no propone fixes. Solo documenta accesos, dependencias y riesgos actuales.
- Las paginas de comites con runtime propio son:
  - `pages/comites/comite-bioetica.html`
  - `pages/comites/comite-calidad-seguridad.html`
  - `pages/comites/comite-docencia-investigacion.html`
  - `pages/comites/comite-ejecutivo-emergencias.html`
  - `pages/comites/comite-farmacia-terapeutica.html`
  - `pages/comites/comite-salud-digital.html`
  - `pages/comites/salud-ocupacional.html`
- `pages/comites/template.html` es solo plantilla estatica; no se detecto runtime Firebase en ese archivo.

## Firestore: auth, perfiles y sesion

| Recurso | Tipo | Archivo(s) donde se usa | Operacion verificada | Actor esperado | Riesgo actual si esta abierto | Prioridad | Dependencias / flujos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `usuarios/{uid}` | browser runtime | `login.html`, `assets/js/common/user-menu.js`, `assets/js/common/user-profiles.js`, `assets/js/pages/index.js`, `assets/js/pages/app.js`, `assets/js/app/services/posts.service.js`, `assets/js/app/views/groups.view.js`, `assets/js/app/views/messages.view.js`, `js/chat.js`, `index.html`, `app/index.html`, `pages/comites/*.html` | `getDoc`, `setDoc`, `merge` profile bootstrap/avatar/profile meta | owner for own doc; authenticated user for constrained reads; system for bootstrap | exposicion de PII, perfilado interno, manipulacion de datos de display/avatar, soporte a escalacion por datos de perfil | P0 | login, menu de usuario, avatar, feed, foro, chat, unirse a comites |
| `usuarios` (query por alias y scans) | browser runtime | `login.html`, `assets/js/common/user-profiles.js`, `js/chat.js` | `getDocs`, `where("username" == alias)`, full scan para indice de nombres, full scan para directorio de chat | authenticated user con filtros minimos; idealmente servicio controlado | enumeracion completa de usuarios, fuga de directorio interno, impacto de privacidad y performance | P0 | login por alias, resolucion de autores, buscador de usuarios del chat |
| `admin_whitelist/{uid}` | browser runtime | `assets/js/pages/index.js`, `assets/js/pages/app.js`, `index.html`, `app/index.html`, `pages/comites/*.html` | `getDoc` | admin/system write, browser read solo si la regla lo permite de forma segura | auto-escalacion de privilegios si la coleccion es escribible o legible sin control | P0 | botones de moderacion, borrado/edicion en foro y comites |
| `dm_presence/{uid}` | browser runtime | `js/chat.js`, `assets/js/shared/sessionGuard.js` | `setDoc` own presence online/offline, `query` + `onSnapshot` de usuarios online | owner para su propia presencia; lectura restringida a usuarios autenticados | stalking interno, presencia falsa, directorio online completo, ruido operativo | P1 | chat, listado online, heartbeat, logout administrado |
| `dm_session_controls/{uid}` | browser runtime | `assets/js/shared/sessionGuard.js` | `onSnapshot` listener | system/admin write; owner read si aplica | forced logout remoto por escritura indebida, interrupcion de sesiones | P1 | cierre remoto de sesion, control de inactividad |

## Firestore: chat, push y notificaciones

| Recurso | Tipo | Archivo(s) donde se usa | Operacion verificada | Actor esperado | Riesgo actual si esta abierto | Prioridad | Dependencias / flujos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dm_conversations/{conversationId}` | browser runtime | `js/chat.js`, `assets/js/app/views/messages.view.js` | `onSnapshot`, `updateDoc`, `setDoc`, `where("participants" array-contains uid)`, `orderBy("updatedAt")` | participantes de la conversacion; system para resumentes derivados | fuga de resumenes de mensajes, conteos unread manipulables, conversaciones ajenas visibles | P0 | bandeja de mensajes, unread, resumenes, notificaciones |
| `dm_chats/{conversationId}/messages/{messageId}` | browser runtime | `js/chat.js` | `addDoc`, `deleteDoc`, `setDoc` merge para `readBy`, `onSnapshot`, `collectionGroup(messages)` con `where("to" == uid)` | participantes de la conversacion; system para triggers | lectura/escritura cruzada de mensajes, spoofing, borrado ajeno, leakage transversal por `collectionGroup` | P0 | chat DM, chat grupal, watcher global, read receipts, push trigger |
| `pushTokens/{uid}` | browser runtime + Cloud Function | `index.html`, `app/index.html`, `functions/index.js` | `setDoc` desde cliente, lectura backend para enviar push | owner write own token; system read | token poisoning, mezcla de dispositivos, entrega de push a terceros | P0 | alta de push, FCM foreground/background, triggers de backend |
| `notifications/{id}` (lectura/listen) | browser runtime | `assets/js/common/notifications.js`, `assets/js/app/app.js`, `assets/js/app/views/notifications.view.js` | `onSnapshot`, `where("toUid" == uid)`, `orderBy("createdAt")`, `updateDoc` mark read, `writeBatch` mark all read | owner read/update; system create | leakage de eventos internos, spoofing si tambien es escribible, tracking de actividad | P0 | campana de notificaciones, badges, vista `#/notifications` |
| `notifications/{id}` (creacion/upsert desde cliente) | browser runtime | `assets/js/common/notifications.js`, `js/chat.js` | `addDoc`, `setDoc` deterministic id via `upsertNotification` | idealmente system/backend; hoy el browser tambien escribe | falsificacion de notificaciones, phishing interno, sobrescritura de estado read, documentos forjados | P0 | mensajes entrantes, notificaciones in-app, toasts |
| `functions.onChatMessageCreated_v2` | Cloud Function | `functions/index.js` | trigger sobre `dm_chats/{conversationId}/messages/{messageId}`; lee `pushTokens/{uid}` y envia push | system | si los docs origen o tokens estan abiertos, amplifica spoofing y fuga de mensajes por push | P0 | envio push de chat |

## Firestore: feed, muro y foro general

| Recurso | Tipo | Archivo(s) donde se usa | Operacion verificada | Actor esperado | Riesgo actual si esta abierto | Prioridad | Dependencias / flujos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dm_carousel/{postId}` | browser runtime | `assets/js/pages/index.js`, `assets/js/pages/app.js` | `getDocs` paginado, `addDoc`, `updateDoc`, `deleteDoc`, render feed/galeria | authenticated user con ownership para writes; reads segun politica de producto | posts falsos, borrado ajeno, metadatos alterados, fuga de actividad interna | P1 | home desktop, app shell legacy, muro/galeria |
| `dm_carousel/{postId}/comments/{commentId}` | browser runtime | `assets/js/pages/index.js`, `assets/js/pages/app.js` | `onSnapshot`, `addDoc`, `runTransaction`, `deleteDoc` | participantes autenticados; owner/admin delete segun reglas | comentarios falsos, borrado ajeno, manipulacion de likes embebidos | P1 | comentarios inline y modal en feed legacy |
| `dm_meta/home_visits` | browser runtime | `assets/js/pages/index.js`, `assets/js/pages/app.js` | `onSnapshot`, `setDoc` + `increment(1)` | system or anonymous-safe counter; browser write controlado | inflado de metricas, escritura arbitraria en metadatos | P2 | contador de visitas visible en home/muro |
| `artifacts/{appId}/public/data/committee_messages/{id}` (foro general) | browser runtime | `index.html`, `app/index.html`, `js/chat.js`, `pages/comites/*.html` | `onSnapshot`, `addDoc`, `updateDoc`, `deleteDoc`, `runTransaction`, espejo desde chat a foro general | authenticated user; owner/admin para edit/delete | XSS persistente, mensajes falsos, borrado ajeno, moderacion falseable, datos internos expuestos | P0 | foro general, likes del foro, espejo desde chat `dm_foro_general` |
| `functions.onPostCommentCreated_v2` | Cloud Function | `functions/index.js` | trigger sobre `dm_posts/{postId}/comments/{commentId}`; lee `dm_posts/{postId}` y crea `notifications`/push | system | si comentarios o post docs son abiertos, notificaciones y push se pueden disparar con contenido forjado | P1 | feed nuevo de `/app`, notificaciones post-comentario |
| `functions.onPostLikeCreated_v2` | Cloud Function | `functions/index.js` | trigger sobre `dm_posts/{postId}/likes/{uid}`; lee `dm_posts/{postId}` y crea `notifications`/push | system | mismo riesgo que comentarios, mas spam/rate limit bypass si el origen es abierto | P1 | feed nuevo de `/app`, notificaciones de likes |

## Firestore: feed nuevo de `/app`

| Recurso | Tipo | Archivo(s) donde se usa | Operacion verificada | Actor esperado | Riesgo actual si esta abierto | Prioridad | Dependencias / flujos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dm_posts/{postId}` | browser runtime + Cloud Function | `assets/js/app/services/posts.service.js`, `functions/index.js` | `getDocs`, `getDoc`, `setDoc`, `where("committeeId")`, `orderBy("createdAt")` | authenticated user con ownership para write/update/delete; system para triggers | posts falsos o alterados, fuga de contenido, abuso de comiteId, efectos colaterales en triggers | P1 | feed SPA `#/feed`, grupos, asistente de foco a post |
| `dm_posts/{postId}/comments/{commentId}` | browser runtime + Cloud Function | `assets/js/app/services/posts.service.js`, `functions/index.js` | `getDocs`, `runTransaction`, `setDoc`, `increment(commentCount)` via post update | authenticated user; owner/admin segun producto | comentarios falsos, conteos desalineados, abuso de triggers | P1 | feed SPA, notificaciones de comentarios |
| `dm_posts/{postId}/likes/{uid}` | browser runtime + Cloud Function | `assets/js/app/services/posts.service.js`, `functions/index.js` | `getDoc`, `runTransaction`, `trx.set`, `trx.delete` | participant authenticated user sobre su propio like | likes falsos, conteos alterados, spam de notificaciones | P1 | feed SPA, notificaciones de likes |

## Firestore: comites y grupos

| Recurso | Tipo | Archivo(s) donde se usa | Operacion verificada | Actor esperado | Riesgo actual si esta abierto | Prioridad | Dependencias / flujos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `artifacts/{appId}/public/data/committee_meta/{committeeId}` | browser runtime | `assets/js/pages/index.js`, `assets/js/app/views/groups.view.js`, `pages/comites/*.html` | `getDocs`, `getDoc`, `setDoc` en paginas de comites | system/admin write; browser read | metadata falsa, deep-links rotos, rutas de grupos inconsistentes | P1 | cards de comites, detalle `#/groups/:committeeId`, subpaginas standalone |
| `artifacts/{appId}/public/data/committee_members/{id}` | browser runtime | `assets/js/pages/index.js`, `assets/js/app/views/groups.view.js`, `pages/comites/*.html` | `getDocs`, `getCountFromServer`, `addDoc`, `deleteDoc`, `onSnapshot` | authenticated user para su propia membresia; admin/system para gestion | membresias falsas, conteos incorrectos, liderazgo manipulado, leakage de estructura interna | P1 | KPIs de comites, boton "Unirme", listados de miembros |
| `artifacts/{appId}/public/data/committee_topics/{id}` | browser runtime | `assets/js/pages/index.js`, `pages/comites/*.html` | `getCountFromServer`, `addDoc`, `updateDoc`, `deleteDoc`, `onSnapshot` | leader/admin/system para write; authenticated read segun politica | roadmap/proyectos falsos, cambios no autorizados, fuga de estrategia interna | P1 | KPIs de comites, paginas de comites, cronogramas/proyectos |
| `artifacts/{appId}/public/data/committee_messages/{id}` (mensajes por comite) | browser runtime | `pages/comites/*.html` | `addDoc`, `updateDoc`, `deleteDoc`, `onSnapshot` | miembros/autenticados para postear; owner/admin para moderar | mensajes falsos, borrado ajeno, XSS persistente si el render no escapa | P0 | foros de cada comite |

## Storage

| Ruta Storage | Tipo | Archivo(s) donde se usa | Operacion verificada | Actor esperado | Riesgo actual si esta abierto | Prioridad | Dependencias / flujos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dm_carousel/{uid}/{filename}` | browser runtime | `assets/js/pages/index.js`, `assets/js/pages/app.js` | `uploadBytes`, `getDownloadURL` | owner del upload | subida arbitraria de archivos, overwrite/abuso de bucket, consumo de cuota | P1 | carga de imagen legacy en home/app |
| `dm_carousel/{uid}/{thumbFilename}` | browser runtime | `assets/js/pages/index.js`, `assets/js/pages/app.js` | `uploadBytes`, `getDownloadURL` | owner del upload | mismos riesgos que el upload principal | P1 | thumbnails del muro/galeria legacy |
| `dm_posts/{postId}/{filename}` | browser runtime | `assets/js/app/services/posts.service.js` | `uploadBytesResumable`, `getDownloadURL` | autor del post o servicio mediado | si la ruta es abierta, cualquiera autenticado puede subir contenido no propio o abusivo | P1 | feed nuevo de `/app`, preview de progreso |
| `avatars/{uid}/avatar.jpg` | browser runtime | `assets/js/common/user-menu.js` | `uploadBytes`, `getDownloadURL` | owner del avatar | avatar spoofing o overwrite si falla ownership | P1 | menu de usuario, slots de avatar, cache busting |
| `dm_profiles/{uid}/{fileName}` | configurado en reglas, sin uso detectado | `storage.rules` solamente | no se detecto `ref()` ni uploads activos en runtime | TBD | ruta huérfana: puede confundir futuras reglas o auditorias | P3 | TODO: verificar si fue planificada para futuras fotos/documentos |

## Messaging, push y service workers

| Recurso / ruta | Tipo | Archivo(s) donde se usa | Operacion verificada | Actor esperado | Riesgo actual si esta abierto o desalineado | Prioridad | Dependencias / flujos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `getToken()` + `Notification.requestPermission()` desktop | browser runtime | `index.html`, `assets/js/common/firebaseClient.js` | pedir permiso, resolver messaging, pedir token FCM, escribir `pushTokens/{uid}` | authenticated user en desktop | uid hardcodeado actual, token poisoning, mezcla de dispositivos, logs sensibles | P0 | banner de push, foreground push en home |
| `getToken()` + `Notification.requestPermission()` app | browser runtime | `app/index.html`, `assets/js/common/firebaseClient.js` | mismo flujo que desktop, con SW scope `/app/` | authenticated user en app shell | mismos riesgos; depende del SW `/app/` | P0 | banner de push, app shell |
| `onMessage()` foreground | browser runtime | `index.html`, `app/index.html` | listener foreground de payload FCM | authenticated user con push habilitado | payload completo se loguea; posible fuga en consola/diagnostico | P1 | recepcion foreground |
| `/app/service-worker.js` | service worker + browser runtime | `app/index.html`, `app/service-worker.js` | `register(scope=/app/)`, `postMessage(INIT_FIREBASE)`, `onBackgroundMessage`, `showNotification`, `notificationclick`, precache, fetch offline para `/app/` | app shell | si falla o se desincroniza el init, push background y offline de `/app/` se degradan | P1 | push background, offline app, open via `open.html` |
| `/service-worker.js` | service worker + browser runtime | `service-worker.js`, `index.html`, `login.html` | SW raiz existe, `index.html` intenta `getRegistration("/service-worker.js")` pero no registra; `login.html` desregistra SW raiz y limpia caches | historico / no claramente activo en runtime actual | posible cache stale, confusion de scope, push desktop desalineado, comportamiento distinto segun cliente ya instalado | P1 | desktop push, offline raiz, cleanup de login |
| `/offline.html` | service worker | `service-worker.js`, `app/service-worker.js` | fallback offline | public/service worker | contenido desactualizado o no cubierto rompe fallback visible | P2 | navegacion offline |

## Cloud Functions, rewrites y backend consumido

| Recurso | Tipo | Archivo(s) donde se usa | Operacion verificada | Actor esperado | Riesgo actual si esta abierto | Prioridad | Dependencias / flujos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /api/ai` -> `functions.aiChat` | browser runtime + Cloud Function | `firebase.json`, `asistente-ia/index.html`, `assets/js/shared/assistant-shell.js`, `functions/index.js` | `fetch()` con `Authorization: Bearer <idToken>`; rewrite Hosting a HTTP Function | authenticated user | abuso del endpoint, prompt leakage, costo, dependencia de auth bridge y de headers CORS | P1 | asistente IA, iframes gemini/openai |
| `functions.aiChat_v2` | Cloud Function | `functions/index.js` | exportado, sin uso directo detectado en cliente | system / no usado por cliente actual | drift entre endpoints o confusion operativa si se publica sin routing claro | P3 | ninguno en runtime actual |
| `onChatMessageCreated_v2`, `onPostCommentCreated_v2`, `onPostLikeCreated_v2` | Cloud Function | `functions/index.js` | triggers Firestore por escritura en chat/feed | system | toda apertura de reglas en origen amplifica riesgo por notificaciones y push backend | P1 | chat, comentarios, likes, push |

## Scripts auxiliares / operativos

| Recurso | Tipo | Archivo(s) donde se usa | Operacion verificada | Actor esperado | Riesgo actual si esta abierto | Prioridad | Dependencias / flujos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auth/Firestore administrativo para usuarios | script auxiliar/operativo | `carga - usuarios/create_user.js`, `carga - usuarios/subir_medicos.js`, `carga - usuarios/force_logout_user.js` | creacion de usuarios y acciones operativas (no inspeccionadas en detalle en runtime visible) | operador autorizado | si se ejecutan sin controles o con credenciales compartidas, comprometen identidades y sesiones | P1 | onboarding/offboarding, soporte operativo |

## Rutas y hashes visibles relevantes

| Ruta / hash | Tipo | Archivo(s) donde se usa | Operacion verificada | Actor esperado | Riesgo actual si cambia o queda desalineado | Prioridad | Dependencias / flujos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/index.html` | browser runtime | `index.html`, `open.html` | entrypoint desktop, redireccion a `/app/index.html` en mobile | public/authenticated segun gate | deep-links desktop/mobile inconsistentes si cambia | P2 | carga inicial desktop |
| `/app/index.html` | browser runtime | `app/index.html`, `app.html`, `open.html` | app shell mobile/SPA, registra SW `/app/` | authenticated user | rompe chat, notificaciones, router SPA y offline app si cambia | P1 | carga inicial mobile/app |
| `/login.html?next=<hash>` | browser runtime | `login.html`, `assets/js/shared/authGate.js`, `assets/js/shared/sessionGuard.js` | login y redirect posterior segun hash previo | public -> authenticated | rompe retorno a la vista previa si cambia | P1 | login/acceso |
| `#carrete`, `#estructura`, `#comites`, `#evidencia`, `#foro` | browser runtime | `index.html`, `js/app.js` | navegacion hash home/app shell legacy | authenticated user | rompe navegacion visible y lazy-load del chat si cambia | P2 | home desktop/mobile |
| `#muro`, `#ia`, `#estructura-funcional`, `#galeria-operativa`, `#investigacion` | browser runtime | `js/app-mobile.js`, `app/index.html` | alias/canonicos mobile shell | authenticated user | rutas inconsistentes o canonicalizacion rota | P2 | mobile shell |
| `#/feed`, `#/groups`, `#/groups/:committeeId`, `#/messages`, `#/notifications` | browser runtime | `assets/js/app/router.js`, `assets/js/app/app.js`, `assets/js/app/views/*.js` | router SPA bajo `/app/` | authenticated user | rompe deep-link y limpieza de listeners por vista | P1 | SPA nueva de `/app` |
| hash que contiene `"chat"` | browser runtime | `index.html`, `app/index.html` | disparador de lazy-load de `js/chat.js` | authenticated user | dependencias implicitas con hashes no canonicos | P2 | apertura del chat desde hash/notificaciones |

## TODOs de verificacion puntual

- Confirmar si existe algun cliente historico con `/service-worker.js` raiz todavia instalado. El runtime actual no lo registra desde `index.html`, pero `login.html` lo desregistra.
- Confirmar si los scripts de `carga - usuarios/` tienen dependencias adicionales sobre colecciones no visibles desde la app principal.
- Confirmar si `dm_profiles/*` debe mantenerse en reglas o eliminarse mas adelante por no tener uso detectado en runtime actual.
