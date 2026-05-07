# Codex Prompts

## Feature Premium
```text
Trabaja como ingeniero full stack senior. Primero audita el repo y los archivos afectados. Implementa una feature premium para [OBJETIVO]. No toques secretos, no instales dependencias sin aprobacion, no hagas deploy ni commit. Mantene el estilo existente, cubri loading/error/empty, responsive y accesibilidad. Valida con tests disponibles y navegador si afecta UI. Reporta archivos, comandos, resultados y riesgos.
```

## Bug Frontend
```text
Reproduce o aisla el bug: [BUG]. Busca la causa minima en HTML/CSS/JS. No hagas refactors amplios. Corregi el comportamiento con el menor diff seguro, agrega test si aplica y valida en mobile/desktop. Reporta causa probable, fix, comandos ejecutados y riesgos.
```

## Refactor Seguro
```text
Refactoriza [AREA] sin cambiar comportamiento. Primero enumera invariantes y tests disponibles. Evita tocar Firebase productivo y secretos. Aplica cambios chicos, ejecuta validaciones y reporta cualquier riesgo o falta de cobertura.
```

## Review Con Subagents
```text
Hace review del diff actual con foco en bugs, seguridad, performance, accesibilidad, Firebase y regresiones. Usa subagents solo para tareas paralelas independientes. Entrega hallazgos por severidad con archivo, linea, impacto y fix minimo. Si no hay hallazgos, indica riesgos residuales.
```

## Auditoria De Seguridad
```text
Audita seguridad del repo sin abrir secretos. Revisa reglas Firebase, Storage, uso de HTML dinamico, exposicion de claves, datos sensibles, headers, service workers y Functions. No modifiques reglas productivas sin aprobacion. Entrega hallazgos priorizados y recomendaciones.
```

## Creacion De Tests
```text
Agrega tests reales para [COMPORTAMIENTO]. Usa herramientas existentes, no instales dependencias sin aprobacion. Preferi node:test si aplica. No uses datos reales. Ejecuta los tests afectados y reporta resultados.
```

## Performance
```text
Analiza performance de [PANTALLA/FLUJO]. Revisa assets, listeners, Firestore reads, service workers, cache y trabajo en main thread. Propone o implementa mejoras seguras sin cambiar UX. Valida y reporta tradeoffs.
```

## Firestore
```text
Revisa cambio Firestore para [OBJETIVO]. No modifiques reglas productivas sin aprobacion. Evalua reglas, indices, queries, costos de lectura, listeners y datos sinteticos. Ejecuta emuladores si estan disponibles y reporta riesgos antes de deploy.
```

## Release Notes
```text
Prepara release notes para el diff actual. Inclui resumen funcional, resumen tecnico, impacto usuario, archivos modificados, validacion ejecutada, riesgos, aprobaciones requeridas y checklist antes de merge. No afirmes deploy ni QA no ejecutado.
```

## Deuda Tecnica Semanal
```text
Audita deuda tecnica semanal. Prioriza items accionables por impacto/riesgo/esfuerzo. Inclui seguridad, Firebase, QA, performance, documentacion y mantenibilidad. No ejecutes cambios; entrega backlog recomendado con criterios de aceptacion.
```
