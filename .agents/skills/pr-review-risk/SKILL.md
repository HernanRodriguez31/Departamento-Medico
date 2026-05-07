---
name: pr-review-risk
description: Usar para revisar diffs con foco en bugs, seguridad, performance, accesibilidad y regresiones.
---

# PR Review Risk

1. Revisar `git diff` y entender intencion antes de comentar.
2. Priorizar hallazgos por severidad: seguridad, perdida de datos, regresiones funcionales, performance, accesibilidad y mantenibilidad.
3. Buscar bugs logicos, cambios de permisos, paths Firestore, queries costosas, listeners duplicados y uso inseguro de HTML.
4. Verificar que tests y docs reflejen el comportamiento real.
5. Proponer fixes minimos, no refactors amplios fuera de alcance.
6. Reportar hallazgos con archivo, linea, impacto y escenario reproducible.
7. Si no hay hallazgos, decirlo claramente e indicar riesgos residuales o tests faltantes.
