# Manual Smoke Checklist

Checklist manual breve para ejecutar despues de cualquier paso futuro que toque seguridad, reglas, router, service workers o Firebase.

## 1. Login / acceso

1. Precondicion: sesion cerrada.
   Accion: abrir `/login.html`, iniciar sesion con un usuario valido.
   Esperado: login exitoso, sin error visible, redireccion a la vista pedida por `?next=` o al entrypoint esperado.
2. Precondicion: sesion cerrada.
   Accion: entrar a `/index.html` o `/app/index.html`.
   Esperado: si el gate exige sesion, redireccion limpia a login y luego retorno correcto.

## 2. Carga inicial

3. Precondicion: usuario autenticado, desktop.
   Accion: abrir `/index.html`.
   Esperado: carga de home sin pantalla rota, sin cambios de layout, sin errores criticos en consola.
4. Precondicion: usuario autenticado, mobile o viewport mobile.
   Accion: abrir `/app/index.html`.
   Esperado: app shell visible, bottom nav operativa, sin errores criticos en consola.

## 3. Navegacion por hash

5. Precondicion: home desktop cargada.
   Accion: navegar manualmente a `#carrete`, `#estructura`, `#comites`, `#evidencia`, `#foro`.
   Esperado: la vista activa cambia sin recarga inesperada y el hash se conserva/canoniza como hoy.
6. Precondicion: `/app/index.html` cargado.
   Accion: navegar a `#/feed`, `#/groups`, `#/messages`, `#/notifications` y a un detalle `#/groups/<committeeId>`.
   Esperado: cada vista monta y desmonta su contenido sin dejar la UI vacia ni duplicar listeners.

## 4. Chat

7. Precondicion: usuario autenticado con otro usuario disponible.
   Accion: abrir el chat desde hash, boton, badge o vista `#/messages`.
   Esperado: `js/chat.js` carga, aparece la bandeja o hub correcto y se puede abrir una conversacion.
8. Precondicion: dos usuarios o dos sesiones.
   Accion: enviar un mensaje directo y verificar recepcion en la otra sesion.
   Esperado: el mensaje sale, aparece en ambas sesiones, el unread se actualiza y no hay error critico en consola.
9. Precondicion: chat abierto.
   Accion: abrir "Chat grupal" y "Foro general" desde accesos rapidos.
   Esperado: ambas conversaciones especiales abren y mantienen el comportamiento actual.

## 5. Foro

10. Precondicion: usuario autenticado.
    Accion: abrir el foro general en home o app shell.
    Esperado: render correcto de mensajes, avatar, likes y scroll sin layout roto.
11. Precondicion: usuario autenticado con permiso normal.
    Accion: publicar un mensaje en foro, dar like y recargar.
    Esperado: el mensaje persiste, el like se refleja y el estado se conserva.
12. Precondicion: usuario autor o admin real.
    Accion: editar y borrar un mensaje propio desde el foro.
    Esperado: ambos flujos siguen funcionando y la UI muestra el resultado esperado.

## 6. Notificaciones

13. Precondicion: usuario autenticado con actividad previa.
    Accion: abrir campana de notificaciones o vista `#/notifications`.
    Esperado: lista visible, badge correcto, abrir una notificacion navega al recurso esperado.
14. Precondicion: notificaciones no leidas.
    Accion: marcar una como leida y luego "Marcar todo como leido".
    Esperado: badges y estado visual se actualizan sin errores.

## 7. Push

15. Precondicion: navegador compatible y permisos en estado default.
    Accion: habilitar push desde la UI actual.
    Esperado: aparece el prompt del navegador, la UI mantiene el mismo texto/estado visible y no hay error critico.
16. Precondicion: push habilitado y app abierta en foreground.
    Accion: generar un evento que hoy dispare push o al menos notificacion in-app.
    Esperado: se recibe foreground event o notificacion equivalente sin romper la vista.
17. Precondicion: push habilitado, navegador soportado, `/app/service-worker.js` activo.
    Accion: dejar la app en background y generar un evento que hoy dispare push.
    Esperado: si el flujo aplica, aparece la notificacion del sistema y el click vuelve a la app o `open.html` como hoy.

## 8. Uploads

18. Precondicion: usuario autenticado con permisos actuales.
    Accion: subir avatar desde el menu de usuario.
    Esperado: la imagen se guarda, el avatar visible se actualiza y persiste tras recarga.
19. Precondicion: home/app con muro habilitado.
    Accion: subir imagen al feed/galeria legacy.
    Esperado: upload exitoso, post visible, thumbnail si aplica, sin error critico.
20. Precondicion: `/app` con feed nuevo disponible.
    Accion: crear un post nuevo con texto e imagen.
    Esperado: progreso visible, post creado y renderizado en `#/feed`.

## 9. Offline / fallback

21. Precondicion: `/app` cargado una vez y service worker `/app/` instalado.
    Accion: cortar red y refrescar una ruta bajo `/app/`.
    Esperado: fallback offline o shell cacheado segun el comportamiento actual.
22. Precondicion: entorno desktop con cualquier SW previo.
    Accion: abrir `/login.html`.
    Esperado: no queda la app inutilizable por caches viejos; si habia SW raiz historico, el cleanup no rompe login.

## 10. Consola y errores visibles

23. Precondicion: ejecutar los flujos anteriores.
    Accion: revisar consola del navegador en home, app y login.
    Esperado: no aparecen errores criticos nuevos; warnings conocidos solo si ya existian antes del cambio.

## Notas

- Si un flujo depende de push real, usar dos sesiones o dos dispositivos cuando sea posible.
- Si un flujo no aplica en un navegador puntual, registrar "no aplica" en vez de asumir exito.
- Guardar capturas de hash activo, consola y badges antes/despues en pasos que toquen reglas o service workers.
