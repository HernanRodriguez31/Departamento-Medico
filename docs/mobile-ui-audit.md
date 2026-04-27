# Mobile UI Audit - QA aislado

Fecha local: 2026-04-25, America/Argentina/Catamarca.

## Alcance

Se ejecuto QA movil aislado con Firebase Emulators y Playwright. No se uso la clave real provista ni se escribio contra datos reales. El usuario local sembrado fue `mobile.qa@departamento-medico.test` con datos minimos de Muro, Foro y Home Visits en emuladores.

Matriz validada:

- iPhone 13: `390x844`, mobile, touch, DPR 3.
- Android medio: `412x915`, mobile, touch, DPR 2.625.

El baseline visual se tomo despues de instalar el harness aislado y antes de las correcciones UI principales.

## Evidencia baseline

Capturas baseline:

- `test-results/mobile/before/iphone-13/01-login.png`
- `test-results/mobile/before/iphone-13/02-login-forgot-modal.png`
- `test-results/mobile/before/iphone-13/03-foro-after-login.png`
- `test-results/mobile/before/iphone-13/04-muro.png`
- `test-results/mobile/before/iphone-13/05-estructura.png`
- `test-results/mobile/before/iphone-13/06-comites.png`
- `test-results/mobile/before/iphone-13/07-foro.png`
- `test-results/mobile/before/iphone-13/08-user-menu.png`
- `test-results/mobile/before/iphone-13/09-ia.png`
- `test-results/mobile/before/android-412/01-login.png`
- `test-results/mobile/before/android-412/02-login-forgot-modal.png`
- `test-results/mobile/before/android-412/03-foro-after-login.png`
- `test-results/mobile/before/android-412/04-muro.png`
- `test-results/mobile/before/android-412/05-estructura.png`
- `test-results/mobile/before/android-412/06-comites.png`
- `test-results/mobile/before/android-412/07-foro.png`
- `test-results/mobile/before/android-412/08-user-menu.png`
- `test-results/mobile/before/android-412/09-ia.png`

Hallazgos principales:

- Foro en iPhone mostraba desplazamiento horizontal del pager: la vista activa quedaba corrida y se veia parte de otra pagina.
- Existian blancos de toque criticos por debajo de 44x44 px, especialmente acciones de Foro y controles del composer.
- El scroll del Foro podia saltar al final aunque el usuario estuviera leyendo mensajes anteriores.
- El guard global de zoom bloqueaba interacciones nativas de mobile.
- Las paginas fantasma del pager conservaban interacciones y carga de medios innecesaria.
- Habia reglas moviles duplicadas/conflictivas entre `css/app.css` y `assets/css/pages/app.css`.
- Algunos modales/paneles no tenian limite robusto a `100dvh` con safe areas.
- La redireccion de login no preservaba de forma consistente `next` y `dmEmulators=1`.

## Correcciones aplicadas

- `package.json` y `package-lock.json`: se agrego `@playwright/test` y scripts `test:e2e:mobile` y `qa:mobile`.
- `playwright.config.mjs`: matriz iPhone 13 y Android medio, artifacts y reporter HTML.
- `tests/e2e/seed-emulators.mjs`: seed local de Auth y Firestore para QA movil.
- `tests/e2e/mobile-ui.spec.mjs`: cobertura de login, redireccion, bottom nav, overflow, scroll, modales/paneles, targets tactiles, consola y screenshots antes/despues.
- `assets/js/common/firebase-bootstrap.js`: conexion a Auth, Firestore y Storage emulators solo en localhost con `?dmEmulators=1`.
- `assets/js/shared/authGate.js`: preserva `dmEmulators=1` al construir la URL de login.
- `login.html`: respeta `next`, redirige a mobile app con hash y conserva `dmEmulators=1`; la limpieza de caches ya no borra caches `brisa-app-*`.
- `js/app-mobile.js`: corrige ancho del pager, usa `#forum-messages-general` como scroller del Foro, desactiva interaccion en paginas fantasma, reduce clonacion pesada y deja el bloqueo de zoom solo como bandera legacy opt-in.
- `app/index.html`: evita auto-scroll forzado del Foro cuando el usuario no esta cerca del final; conserva posicion de lectura y solo baja al final en primer render o envio propio.
- `css/app.css`: refuerza `max-width`, elimina overflow horizontal, aplica safe areas a shell/nav, sube blancos tactiles a 44x44 px, y contiene Foro/composer/notificaciones.
- `assets/css/pages/app.css`: corrige safe area del composer de Muro, limita modales a viewport dinamico y evita que reglas tablet/pwa pisen el shell mobile de telefono.
- `app/service-worker.js`: version de cache subida a `v21` y precache CSS/JS actualizado.

La modificacion previa existente en `index.html` no fue alterada por esta auditoria.

## Evidencia despues

Capturas finales:

- `test-results/mobile/after/iphone-13/01-login.png`
- `test-results/mobile/after/iphone-13/02-login-forgot-modal.png`
- `test-results/mobile/after/iphone-13/03-foro-after-login.png`
- `test-results/mobile/after/iphone-13/04-muro.png`
- `test-results/mobile/after/iphone-13/05-estructura.png`
- `test-results/mobile/after/iphone-13/06-comites.png`
- `test-results/mobile/after/iphone-13/07-foro.png`
- `test-results/mobile/after/iphone-13/08-user-menu.png`
- `test-results/mobile/after/iphone-13/09-ia.png`
- `test-results/mobile/after/android-412/01-login.png`
- `test-results/mobile/after/android-412/02-login-forgot-modal.png`
- `test-results/mobile/after/android-412/03-foro-after-login.png`
- `test-results/mobile/after/android-412/04-muro.png`
- `test-results/mobile/after/android-412/05-estructura.png`
- `test-results/mobile/after/android-412/06-comites.png`
- `test-results/mobile/after/android-412/07-foro.png`
- `test-results/mobile/after/android-412/08-user-menu.png`
- `test-results/mobile/after/android-412/09-ia.png`

Reporte Playwright: `test-results/playwright-report/index.html`.

Validaciones automatizadas cubiertas:

- Login mobile redirige a `/app/index.html?dmEmulators=1#foro`.
- Bottom nav visible, usable y con estado activo correcto.
- `scrollWidth <= clientWidth + 1` en documento, body, shell y vista activa.
- Muro, Estructura, Comites y Foro tienen scroll vertical funcional.
- Foro conserva la posicion al leer mensajes anteriores.
- Forgot modal, user menu, IA/panel y composer quedan dentro del viewport.
- Targets criticos cumplen minimo 44x44 px.
- No hubo errores criticos de consola ni page errors durante el recorrido.

## Comandos ejecutados

- `MOBILE_QA_CAPTURE_PHASE=before npm run test:e2e:mobile` - passed, 2 proyectos.
- `node --check js/app-mobile.js && node --check tests/e2e/seed-emulators.mjs && node --check tests/e2e/mobile-ui.spec.mjs` - passed.
- `npm run test:safe-dom` - passed, 7 tests.
- `npm run test:e2e:mobile` - passed, 2 proyectos.
- `npm run qa:mobile` - passed, 2 proyectos, capturas `after`.
- `npm test` - passed, `test:safe-dom` 7 tests y `test:rules` 21 tests.

## Riesgos residuales

- El dataset de QA es intencionalmente minimo; contenido real con imagenes muy pesadas o textos extremos deberia revisarse con una pasada visual adicional.
- Firebase CLI consulta metadatos del proyecto para levantar emuladores, pero la app y el seed escriben en Auth/Firestore/Storage locales.
- `npm install` reporto 1 vulnerabilidad critica ya existente en el arbol de dependencias; no se ejecuto `npm audit fix` para evitar cambios no relacionados.
