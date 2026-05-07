# Firebase Firestore Guide

## Estado Actual
El repo usa Firebase Hosting, Auth, Firestore, Storage, Messaging y Cloud Functions. Existen `firebase.json`, `firestore.rules` y `storage.rules`. No se detecto `firestore.indexes.json`.

## Reglas
- No modificar reglas productivas sin aprobacion explicita.
- Validar cambios con emuladores.
- Usar usuarios y datos sinteticos.
- Cubrir casos autenticado, no autenticado, owner, admin y no admin.

## Comandos
```bash
npm run test:rules
firebase emulators:start --only firestore,auth,storage,functions,hosting
```

`npm run test:rules` usa `FIREBASE_CLI_UPDATE_NOTIFIER=false` para evitar ruido del update checker.

## Indices Y Queries
- Revisar filtros compuestos y `orderBy`.
- Documentar cualquier indice requerido.
- Si falta un indice, preferir documentarlo o crear un ejemplo revisable antes de tocar produccion.

## Costos
- Evitar listeners duplicados.
- Revisar fan-out de notificaciones, likes, comentarios y chat.
- Confirmar limites y paginacion en feed, foro y mensajes.
- Medir impacto de lecturas antes de agregar nuevas consultas globales.

## Seguridad
- No guardar secretos en cliente.
- No guardar PHI/PII real en fixtures, logs ni docs.
- No relajar reglas para pasar tests.
- No usar service accounts locales en pruebas versionadas.

## Checklist Antes De Deploy
- Tests de reglas pasan.
- Storage rules revisadas si hay uploads.
- Indices documentados.
- Costos de lectura revisados.
- Datos de prueba sinteticos.
- Rollback o mitigacion definida.
- Aprobacion humana explicita.
