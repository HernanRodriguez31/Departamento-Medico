---
name: firebase-firestore
description: Usar para cambios o revisiones de Firebase, Firestore, Storage, Functions, reglas, indices y queries.
---

# Firebase Firestore

1. Revisar `firebase.json`, `firestore.rules`, `storage.rules`, servicios cliente y Functions relevantes.
2. No modificar reglas productivas sin aprobacion explicita.
3. Validar reglas con emuladores y datos sinteticos; nunca usar PHI/PII real.
4. Revisar indices requeridos, filtros compuestos, ordenamientos y errores esperables de Firestore.
5. Evaluar costos de lectura, listeners vivos, fan-out y escrituras por interaccion.
6. Mantener secretos en entorno seguro, no en cliente ni en docs.
7. No relajar reglas para resolver fallos; corregir modelo de permisos o flujo.
8. Antes de deploy, exigir checklist de reglas, indices, emuladores, costos, rollback y aprobacion humana.
