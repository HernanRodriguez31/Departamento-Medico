# Estado final de seguridad y operación

Este documento consolida el cierre de la remediación realizada hasta ahora. No reemplaza una prueba funcional en staging ni una revisión clínica/legal de privacidad, pero deja el estado operativo verificable y los pendientes que requieren fase separada.

## Qué quedó corregido

1. Firestore Rules críticas.
   - `pushTokens/{uid}` quedó sin acceso cliente directo; el alta de tokens pasa por callable backend.
   - `notifications/{id}` quedó owner-scoped para lectura y limitado a marcado como leída por el dueño; create/delete cliente bloqueados.
   - `admin_whitelist/{uid}` quedó con `get` propio autenticado y sin escrituras cliente.
   - `dm_session_controls/{uid}` quedó owner-scoped para lectura y sin escrituras cliente.
   - `dm_presence/{uid}` quedó con escritura owner-scoped y campos acotados.
   - El catch-all final de `firestore.rules` quedó cerrado con `allow read, write: if false`.

2. Storage Rules.
   - `dm_carousel/{uid}/{fileName}` exige autenticación, ownership, `image/*` y límites de tamaño.
   - `avatars/{uid}/{fileName}` exige owner, nombres permitidos y máximo 5 MB.
   - `dm_posts/*` y `dm_profiles/*` quedaron sin escrituras hasta verificar ownership real.
   - El catch-all de Storage quedó cerrado.

3. XSS en chat y foro principal.
   - `js/chat.js` dejó de interpolar `authorLabel` y `msg.text` como HTML ejecutable en `renderMessage()`.
   - `index.html` y `app/index.html` escapan autor, unidades, iniciales, texto del mensaje y nombres de likes en el foro.
   - Se agregó `assets/js/utils/safe-dom.js` con helpers de escape reutilizables.

4. Push y notificaciones.
   - El backend usa `getMessagingClient().sendEachForMulticast(...)`, sin depender de una instancia mutable potencialmente `undefined`.
   - `registerPushToken` registra tokens con UID obtenido desde `request.auth.uid`.
   - El cliente dejó de escribir directo en `pushTokens` y delega en `registerPushTokenForCurrentUser(...)`.
   - Los bodies push de chat/comentario/like quedaron genéricos para evitar snippets sensibles.
   - `assets/js/common/notifications.js` quedó como cliente de lectura/marcado; `createNotification` y `upsertNotification` son no-op compatibles.

5. Service workers y caché.
   - `/service-worker.js` y `/app/service-worker.js` inicializan Firebase Messaging y manejan `notificationclick`.
   - `getToken()` usa la registration del scope correcto: root en desktop y `/app/` en app shell.
   - El runtime cache evita cachear endpoints `/api/`, `__/`, requests no-GET y navegaciones dinámicas con query.
   - `firebase.json` ya no aplica `immutable` a JS/CSS no fingerprinted.

6. Bootstrap, rutas y deuda operativa.
   - Firebase bootstrap quedó centralizado en `assets/js/common/firebase-bootstrap.js` sin remover globals existentes.
   - Checks de hash usados por chat/foro quedaron encapsulados en `assets/js/common/routes.js`.
   - El chat desktop fue normalizado para que el panel flotante no abra fuera del viewport.
   - El flujo local quedó documentado con Hosting emulator en `5002` y Live Server en `5502`; Live Server ignora logs, docs, tests y Functions para reducir recargas aparentes durante evaluación.

7. CDNs y páginas secundarias.
   - `pages/comites/*.html` y `asistente-ia/index.html` tienen Tailwind fijado en `3.4.17`.
   - `pages/comites/*.html` tiene Lucide fijado en `1.8.0`, SweetAlert2 en `11.26.24` y Flatpickr en `4.6.13`.
   - `asistente-ia/index.html` tiene `@google/generative-ai` fijado en `0.24.1` y Babel standalone en `7.29.2`.

8. XSS en comités.
   - `pages/comites/*.html` importa `safe-dom.js` y escapa campos dinámicos de proyectos, integrantes y mensajes de comité antes de renderizarlos con `innerHTML`.
   - Se preservan los handlers inline existentes usando argumentos de string serializados y escapados para atributos.

9. Tests mínimos.
   - Se agregó test de sanitización para `safe-dom`.
   - Se agregó test mínimo de Firestore Rules para `pushTokens`, `notifications`, `admin_whitelist` y `dm_presence`.
   - Se agregó test backend puro para validación de registro de token push.

## Qué quedó mitigado parcialmente

1. `usuarios`.
   - La lectura amplia autenticada sigue permitida porque el chat/directorio y avatares legacy todavía dependen de búsqueda global.
   - Se redujo enumeración innecesaria con TTL y resolución targeted por nombre, pero no existe todavía índice server-side/callable de búsqueda.

2. Comités bajo `artifacts/...`.
   - Las reglas están más acotadas, pero las páginas actuales leen colecciones completas y filtran en cliente.
   - Falta migrar a queries por `committeeId` o a un backend/callable con membresía fuerte.

3. `dm_presence`.
   - Las escrituras están owner-scoped.
   - La lectura sigue disponible para usuarios autenticados porque el roster online actual consulta `dm_presence` globalmente.

4. Contadores e interacciones.
   - Likes, contadores y `dm_meta/home_visits` están acotados por campos/reglas, pero no son anti-abuso perfectos sin backend transaccional.

5. `configuracion`.
   - Se mantiene `allow read: if true` como lectura pública intencional del candado/configuración.
   - No hay `allow read, write: if true` en reglas críticas.

## Qué quedó pendiente y por qué

1. Revisión XSS restante fuera de chat/foro principal y comités.
   - La búsqueda estática aún muestra `innerHTML` en `assets/js/pages/index.js`, `assets/js/pages/app.js`, `assets/js/app/views/*`, `js/app.js` y `js/app-mobile.js`.
   - `pages/comites/*.html` conserva `innerHTML` para templates, pero los campos dinámicos principales de Firestore/usuario quedaron escapados. Los `innerHTML` restantes de esas páginas son shells estáticos, tooltips estáticos o templates ya protegidos.
   - Los sinks restantes requieren auditoría específica para no romper layout.

2. Login por alias.
   - Existe una excepción temporal de lectura no autenticada mínima para preservar alias login.
   - Debe migrarse a callable/backend para evitar enumeración por consultas repetidas.

3. Búsqueda global de usuarios.
   - El cliente todavía necesita lectura amplia autenticada para resultados equivalentes.
   - Para cerrarla se requiere índice denormalizado, búsqueda por prefijos o callable backend.

4. Membresías y conversaciones especiales.
   - Conversaciones grupales/especiales y comités no tienen siempre un campo de membresía verificable fuerte en el schema actual.
   - Cerrar más sin rediseño puede romper chat/comités.

5. Storage legacy.
   - `dm_carousel/{uid}/{fileName}` se endureció con ownership por segmento de path.
   - Donde el cliente use IDs legacy no equivalentes a UID, hay que migrar path o precrear documento con owner verificable antes de ampliar escrituras.

6. CSP.
   - No se agregó CSP bloqueante para no romper inline scripts y CDNs actuales.
   - Próximo paso recomendado: CSP `Report-Only` tras inventariar inline scripts, workers y CDNs restantes.

## Riesgo residual por área

| Área | Riesgo | Estado operativo |
| --- | --- | --- |
| CDNs en entrypoints auditados | Bajo | `index.html`, `app/index.html`, `pages/comites/*.html` y `asistente-ia/index.html` tienen las dependencias críticas fijadas; mantener vigilancia sobre nuevas páginas/CDNs. |
| XSS fuera de chat/foro principal/comités | Alto | Hay `innerHTML` en vistas no remediadas; requiere revisión por flujo antes de tocar markup. |
| Directorio `usuarios` | Medio | Lectura amplia autenticada preserva UX, pero mantiene enumeración interna. |
| Comités `artifacts/...` | Medio | Lectura amplia autenticada y filtrado cliente siguen por compatibilidad. |
| `dm_presence` | Bajo/Medio | Escritura restringida; lectura autenticada global sigue por roster. |
| Contadores/likes/home visits | Bajo/Medio | Campos acotados, pero integridad fuerte requiere backend transaccional. |
| Push/notificaciones | Bajo | Registro/payload/logs principales endurecidos; validar background/click en staging real. |
| Caché/SW | Bajo/Medio | Estrategia corregida; validar actualización de SW y ausencia de assets viejos post-deploy. |

## Recomendación de deploy por etapas

1. Preparar staging o preview channel.
   - Ejecutar `npm test`, `npm --prefix functions test`, `git diff --check`.
   - Cargar reglas en emulador Firestore/Storage si está disponible.

2. Deploy backend/reglas.
   - Desplegar Functions para `registerPushToken` y triggers push.
   - Desplegar Firestore Rules y Storage Rules.
   - Validar login, notificaciones y uploads en staging antes de Hosting.

3. Deploy Hosting.
   - Desplegar `index.html`, `/app/`, service workers, headers y assets.
   - Verificar que `/service-worker.js` y `/app/service-worker.js` se sirvan con `no-cache`.

4. Smoke manual completo.
   - Ejecutar el checklist de `docs/final-manual-validation.md`.
   - Revisar consola del navegador y logs de Functions.

5. Monitoreo inicial.
   - Vigilar errores de permisos Firestore/Storage, fallos de push callable, errores de service worker y errores de carga CDN.

## Recomendación de rollback si algo falla

1. Falla de UI, CDN, service worker o caché.
   - Revertir el deploy de Hosting o volver al release anterior.
   - Forzar actualización de service worker en clientes de prueba y limpiar Cache Storage si quedan assets viejos.

2. Falla de permisos legítimos.
   - Revertir solo `firestore.rules` o `storage.rules` al release anterior.
   - Mantener Functions si el problema no involucra callable/triggers.

3. Falla de push.
   - Revertir `functions/index.js` y helpers de push al release anterior.
   - Confirmar si el cliente queda con registro callable; si se revierte backend sin revertir cliente, el alta de tokens puede fallar.

4. Falla de tests o emulador.
   - No desplegar reglas nuevas hasta reproducir localmente el caso.
   - Capturar colección/ruta, usuario, operación y payload mínimo antes de corregir.
