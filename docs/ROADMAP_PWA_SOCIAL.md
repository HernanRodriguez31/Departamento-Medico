# ROADMAP PWA SOCIAL

## Diagnostico
- Firebase se inicializa en `index.html`, `login.html`, `assets/js/pages/index.js`, `js/chat.js`, `pages/comites/*.html` y `functions/index.js` (admin), con logica duplicada.
- Se mezclan SDKs Firebase 10.7.1 y 10.12.0 en el front (push usa 10.12.0).
- En `index.html` se registran dos service workers: `/firebase-messaging-sw.js` y `/service-worker.js`.
- Foro general en `index.html` usa `artifacts/{appId}/public/data/committee_messages` con `committeeId=foro_general`.
- Foro por comites en `pages/comites/*.html` usa la misma `committee_messages` filtrada por `committeeId`.
- Foro y comites consultan perfiles en `usuarios` para author/businessUnit/managementUnit.
- Galeria operativa usa `dm_carousel` y Storage `dm_carousel/{uid}/...` (alta de imagenes).
- Likes de galeria viven en `dm_carousel` (`likesCount`, `likedBy`, `likedNames`).
- Comentarios de galeria viven en `dm_carousel/{slideId}/comments`.
- Likes de comentarios usan `likedBy` en cada doc de `comments`.
- Chat usa `dm_chats/{conversationId}/messages` y presencia en `dm_presence`.
- Chat carga perfiles desde `usuarios` y refleja mensajes en `committee_messages` (foro_general).
- Notificaciones in-app usan `notifications` (create/read/mark).
- Push tokens se guardan en `pushTokens` desde `index.html`.
- Hay claves y passwords hardcodeadas en cliente (admin foro, admin delete carrusel, VAPID).
- Manifest y SW apuntan a iconos que no existen en `/assets/icons/`.
- `service-worker.js` es minimo y no aporta cache/offline real.

## Riesgos criticos
- Doble registro de service workers puede generar scope confuso y fallas en push/PWA.
- Iconos faltantes rompen instalacion PWA y notificaciones (badge/icon).
- Secrets en cliente (admin password, VAPID, keys) exponen acceso no autorizado.
- Multiples inicializaciones Firebase y SDKs mezclados -> apps duplicadas o estado auth incoherente.
- `firebase-messaging-sw.js` depende de postMessage para init; si falla, push queda mudo.
- Sin estrategia offline, la PWA se comporta como sitio online tradicional.

## Plan por fases (P0..P3)
### P0 - Stabilization
- Unificar bootstrap Firebase (una sola fuente de config + singleton app).
- Definir estrategia unica de service worker (PWA + messaging) y scopes.
- Agregar iconos faltantes y alinear manifest + SW.
- Remover secrets del cliente; mover borrados/roles a backend o reglas.
- Documentar modelos e indices minimos por coleccion.

### P1 - Social Core
- Estandarizar esquema de `committee_messages`, `dm_chats`, `notifications`.
- Moderacion basica (roles, delete server-side, rate limiting).
- Integrar notificaciones in-app con push (eventos unificados).
- Limpieza de `pushTokens` y control de duplicados.

### P2 - PWA UX
- Cache estrategico (shell, assets, gallery) + fallback offline.
- Cola offline para foro/comentarios y reintentos.
- UX de updates (skipWaiting/refresh) y banner de actualizacion.

### P3 - Growth
- Busqueda y filtros en foro/galeria.
- Analitica de engagement (likes, comentarios, mensajes).
- Segmentacion por comites/unidades y permisos finos.
