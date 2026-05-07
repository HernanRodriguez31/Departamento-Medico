# Departamento Medico Brisa

Portal interno colaborativo para el Departamento Medico Brisa. El repo contiene un sitio estatico desktop, una PWA mobile, paginas de comites, chat, notificaciones, foro, integracion Firebase y Cloud Functions.

## Stack
- Frontend: HTML, CSS y JavaScript vanilla con ES modules y librerias por CDN.
- PWA: manifests y service workers en raiz y `app/`.
- Backend: Firebase Hosting, Auth, Firestore, Storage, Messaging y Cloud Functions.
- Functions: Node.js 20 y CommonJS.
- Tests: `node:test` y reglas Firestore con Firebase Emulator.
- Package manager: npm.

## Estructura
- `index.html`, `login.html`, `app.html`, `open.html`, `offline.html`: entradas principales.
- `app/`: shell PWA mobile.
- `pages/comites/`: paginas de comites.
- `assets/`, `css/`, `js/`: estilos, imagenes y scripts cliente.
- `functions/`: Cloud Functions y tests backend.
- `tests/`: tests de utilidades y reglas Firestore.
- `docs/`: documentacion existente.
- `docs/codex/`: workflow operativo para Codex.

## Comandos
```bash
npm run test:safe-dom
npm --prefix functions test
npm run test:rules
npm test
npm run qa
```

`npm run test:rules` requiere Firebase CLI, emulador Firestore y Java disponibles localmente.

## Desarrollo Local
Ver `docs/LOCAL_DEV.md` para opciones con Firebase Emulator y Live Server. Para validar PWA, rewrites y Functions, preferir Firebase Hosting Emulator.

## Seguridad
- No versionar secretos, `.env`, service accounts, certificados ni tokens.
- No usar datos medicos, laborales o personales reales en pruebas.
- No hacer deploy, push o cambios destructivos sin aprobacion explicita.
- Revisar `docs/codex/CODEX_SECURITY.md` antes de cambios sensibles.

## Codex
- `AGENTS.md`: reglas persistentes para agentes.
- `.agents/skills/`: skills locales reutilizables.
- `.codex/config.example.toml`: configuracion recomendada de Codex para este repo.
- `docs/codex/CODEX_WORKFLOW.md`: flujo de trabajo.
- `docs/codex/CODEX_QA_CHECKLIST.md`: checklist de validacion.
- `docs/codex/CODEX_PROMPTS.md`: prompts reutilizables.
