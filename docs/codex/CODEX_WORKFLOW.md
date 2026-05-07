# Codex Workflow

## Feature Nueva
1. Auditar archivos afectados y confirmar stack real.
2. Planificar comportamiento, estados, datos, seguridad y validacion.
3. Implementar cambios pequenos y coherentes con patrones existentes.
4. Validar UI en navegador o Playwright si afecta pantallas.
5. Ejecutar tests disponibles y reportar resultados.

## Bug
1. Reproducir o aislar causa con logs no sensibles y lectura de codigo.
2. Hacer el fix minimo.
3. Agregar test si el bug es testeable.
4. Revalidar el caso y buscar regresiones cercanas.

## Refactor
1. Definir comportamiento que no debe cambiar.
2. Evitar cambios funcionales mezclados.
3. Ejecutar tests antes y despues si es posible.
4. Reportar riesgos residuales.

## Review
1. Revisar diff completo.
2. Priorizar bugs, seguridad, performance, accesibilidad y regresiones.
3. Dar hallazgos con archivo, linea, impacto y fix minimo.

## Release
1. Preparar resumen tecnico y funcional.
2. Confirmar validaciones.
3. Revisar Firebase, reglas, indices, costos y rollback si aplica.
4. No desplegar sin aprobacion humana.

## Plan Mode
Usar Plan Mode para auditorias amplias, cambios multiarchivo, seguridad, Firebase, CI/CD o decisiones con tradeoffs. El plan debe dejar decisiones cerradas antes de ejecutar.

## Cierre De Tarea
La respuesta final debe incluir cambios, validacion, fallos, riesgos pendientes y aprobaciones requeridas.
