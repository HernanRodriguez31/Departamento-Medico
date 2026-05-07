# Codex QA Checklist

## Validacion General
- `git status --short`
- `node -v`
- `npm -v`
- `npm run test:safe-dom`
- `npm --prefix functions test`
- `npm run test:rules` si Firebase CLI, Java y emuladores estan disponibles
- `npm run qa`

## Si Existieran Herramientas Futuras
- Typecheck
- Lint
- Format check
- Unit tests
- E2E
- Build

No documentar estas validaciones como ejecutadas si no existen o no corrieron.

## UI
- Desktop y mobile.
- PWA en `/app/`.
- Estados loading, error y empty.
- Navegacion por teclado y foco visible.
- Contraste y textos sin solapamiento.
- Consola del navegador sin errores nuevos.
- Assets y service workers cargando correctamente.

## Firebase Y Permisos
- Usuario autenticado.
- Usuario no autenticado.
- Usuario admin y no admin si aplica.
- Reglas Firestore y Storage.
- Indices requeridos por queries.
- Costos de lecturas y listeners.

## Regresiones
- Login.
- Home.
- Foro.
- Comites.
- Chat.
- Notificaciones.
- Asistente IA.
- PWA offline/deep links.
