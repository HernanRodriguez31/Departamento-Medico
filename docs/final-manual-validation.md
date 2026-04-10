# Checklist final de validación manual

Ejecutar después de deploy en staging/preview y repetir en producción si el staging pasa sin errores. Registrar navegador, usuario, ruta, consola y timestamp de cada fallo.

## Login

1. Abrir `/login.html`.
2. Iniciar sesión con usuario válido.
3. Confirmar redirección al shell esperado y ausencia de errores críticos en consola.
4. Si el flujo de alias sigue activo, probar alias conocido y confirmar que no rompe la carga inicial.
5. Probar usuario no autorizado o credenciales inválidas y confirmar rechazo controlado.

## Carga inicial

1. Abrir `/index.html` en desktop con usuario autenticado.
2. Confirmar header, home, carrusel/feed, campana, chat FAB y estilos.
3. Abrir `/app/index.html` en viewport mobile o ruta `/app/`.
4. Confirmar app shell, navegación inferior/shell mobile y ausencia de errores críticos.
5. En Live Server `5502`, modificar un archivo de `docs/` o un log de Firebase y confirmar que no recarga la página.
6. En Live Server `5502`, modificar `index.html` o un CSS relevante y confirmar que la recarga esperada sigue ocurriendo.

## Navegación

1. Navegar a hashes principales visibles: `#chat`, `#foro`, `#estructura`, `#carrete` o equivalentes actualmente usados.
2. Confirmar que no cambia el contrato de rutas ni se pierde el hash al redireccionar a `/app/`.
3. Recargar con hash activo y confirmar que el módulo correspondiente inicializa.
4. Confirmar que `window.__ensureChatLoaded`, `window.enablePushNotifications`, `window.BrisaChat` y `window.BrisaNotifications` siguen existiendo cuando corresponde.

## Chat

1. Abrir el chat desde desktop y confirmar que el panel queda dentro del viewport.
2. Abrir una conversación desde búsqueda o usuario online.
3. Enviar mensaje normal y confirmar render, timestamp, estado y scroll.
4. Enviar payloads como texto literal: `<img src=x onerror=alert(1)>`, `<script>alert(1)</script>`, `<svg onload=alert(1)>`, `<a href="javascript:alert(1)">click</a>`.
5. Confirmar que se ven como texto inerte y no se ejecutan.
6. Borrar mensaje propio y confirmar modal/acción actual.
7. Validar minimizado a pills y reapertura.

## Foro

1. Abrir foro en `index.html`.
2. Publicar mensaje normal.
3. Publicar o editar con los payloads XSS de prueba y confirmar texto inerte.
4. Dar like, abrir popover de likes y confirmar nombres visibles sin HTML ejecutable.
5. Editar y borrar mensaje propio si aplica.
6. Repetir flujo equivalente en `/app/index.html`.

## Comités

1. Abrir cada página de `pages/comites/*.html` con usuario autenticado.
2. Confirmar que Tailwind, Lucide, SweetAlert2 y Flatpickr cargan sin errores.
3. Crear o editar un proyecto con payloads XSS en título o propuesto por; confirmar texto inerte y layout sin cambios.
4. Enviar mensaje de comité con payloads XSS y confirmar texto inerte.
5. Confirmar que avatares, integrantes, documentos, acciones admin y botones de unirse/opciones siguen funcionando.

## Notificaciones foreground

1. Con dos usuarios o datos de prueba, generar una notificación de chat/comentario/like.
2. Con la app en foreground, confirmar badge/campana/toast sin payload sensible.
3. Abrir campana, confirmar lista, título/body genéricos donde corresponda.
4. Marcar una notificación como leída.
5. Marcar todas como leídas.
6. Confirmar que no hay errores de permisos en consola.

## Notificaciones background

1. Habilitar notificaciones con usuario autenticado.
2. Confirmar que el token se registra vía callable backend y no hay token completo en consola.
3. Cerrar o mandar a background la pestaña.
4. Generar push de chat y confirmar notificación del sistema con body genérico.
5. Repetir en `/app/` para confirmar scope `/app/service-worker.js`.

## Click en notificación

1. Hacer click en una notificación background con una pestaña existente abierta.
2. Confirmar que enfoca la pestaña y navega/abre el destino esperado.
3. Repetir sin pestañas abiertas y confirmar apertura de `/open.html` o ruta permitida.
4. Probar payload con `conversationId` y confirmar que no queda cacheado como navegación dinámica persistente.

## Habilitación push autenticada y sin auth

1. Con usuario autenticado, activar push desde el botón/banner actual.
2. Confirmar misma UX visible y ausencia de logs de token completo/payload.
3. En sesión no autenticada o tras logout, intentar habilitar push.
4. Confirmar que no escribe datos y no rompe UI.

## Uploads

1. Subir imagen válida a carrusel/galería con usuario autenticado.
2. Confirmar preview/thumbnail/render posterior.
3. Subir/cambiar avatar con `avatar.jpg`, `avatar.jpeg` o `avatar.png`.
4. Intentar subir sin auth y confirmar rechazo.
5. Intentar subir archivo no imagen y confirmar rechazo.
6. Intentar subir avatar mayor a 5 MB y carrusel mayor a 25 MB; confirmar rechazo.
7. Confirmar que no hay errores nuevos para uploads válidos.

## Offline/fallback

1. Cargar `/index.html` online y esperar activación de `/service-worker.js`.
2. Cortar red y recargar; confirmar shell/fallback offline actual.
3. Repetir con `/app/index.html` y `/app/service-worker.js`.
4. Confirmar que endpoints `/api/`, Firebase/Functions y navegaciones con query dinámica no quedan cacheados como contenido privado.

## Reglas Firestore/Storage

1. Ejecutar `npm test`.
2. Ejecutar `npm --prefix functions test`.
3. Si Firebase CLI está disponible, ejecutar pruebas/emulador de reglas Firestore y Storage.
4. Probar negativo: escritura cliente a `pushTokens` debe fallar.
5. Probar negativo: creación cliente arbitraria en `notifications` debe fallar.
6. Probar negativo: escritura cliente en `admin_whitelist` debe fallar.
7. Probar positivo: owner puede marcar su notificación como leída.
8. Probar positivo: owner puede escribir su `dm_presence`.
9. Probar negativo: usuario no puede escribir `dm_presence` de otro UID.

## Consola y regresiones visuales

1. Revisar consola en login, home, `/app/`, chat, foro, notificaciones, uploads y offline.
2. Confirmar ausencia de errores críticos nuevos.
3. Confirmar que no aparecen tokens FCM completos, payloads push completos ni snippets sensibles en logs cliente.
4. Comparar visualmente desktop y mobile contra la versión funcional previa: header, menú, chat, foro, carrusel, campana, botones admin y navegación.
5. Confirmar que no se duplican listeners visibles: un click abre/cierra una sola vez, un push genera una sola notificación visible y un hashchange inicializa una sola instancia esperada.
