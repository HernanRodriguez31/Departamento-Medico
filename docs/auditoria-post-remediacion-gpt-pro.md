# Auditoría Post-Remediación y Brief Para GPT Pro

## Resumen ejecutivo

La aplicación quedó significativamente más segura que el baseline inicial: reglas críticas cerradas, push migrado a backend, XSS principal de chat/foro/comités mitigado, service workers alineados, CDNs principales pinneados, caché corregida y tests mínimos agregados.

El riesgo residual más importante está en superficies que no fueron parte del alcance quirúrgico anterior: render HTML dinámico en feed/carousel/SPA, excepciones necesarias en reglas por limitaciones de schema, deuda estructural por duplicación desktop/mobile y ausencia de una suite E2E/visual.

El siguiente plan debe mantener el contrato de no regresión: no cambiar layout, ids, clases, rutas, hashes, funciones públicas ni UX visible salvo que se apruebe explícitamente. El enfoque recomendado es por fases pequeñas, verificables y con smoke manual después de cada fase.

## Hallazgos prioritarios

| Severidad | Hallazgo | Evidencia verificada | Mejora recomendada |
| --- | --- | --- | --- |
| Alta | XSS residual potencial fuera de chat/foro/comités | Persisten `innerHTML` en vistas de feed/carousel/SPA, especialmente en `assets/js/pages/index.js`, `assets/js/pages/app.js` y vistas bajo `assets/js/app/views/*`. | Auditar sink por sink; reemplazar datos de usuario por `textContent` o `escapeHTML`/`escapeAttribute`; validar URLs antes de `src`, `href`, `data-full`, `data-thumb`; no reescribir markup completo. |
| Alta | Feed/carousel interpolan campos de Firestore en HTML | `formatMeta(...)`, descripciones, títulos, `alt`, `src`, `data-*` aparecen en template strings. | Crear helpers de render seguro para feed/carousel; escapar texto visible y atributos; validar URL same-origin o `https:` antes de inyectarla. |
| Media/Alta | Reglas siguen teniendo excepciones por compatibilidad | `firestore.rules` conserva alias login no autenticado con `limit <= 1`, lectura amplia de `usuarios`, lectura amplia de comités y `dm_presence` para roster. | Migrar alias login, búsqueda de usuarios y membresías a callables/backend; luego cerrar lecturas amplias por owner/member. |
| Media | Integridad de contadores e interacciones no es fuerte | Likes, comentarios, `dm_meta/home_visits` y algunos contadores siguen aceptando updates acotados pero cliente-orchestrated. | Mover contadores a Cloud Functions o transacciones backend; dejar cliente solo como intención de acción. |
| Media | Storage tiene rutas legacy con ownership incompleto | `storage.rules` deja TODO para `dm_posts/*` y `dm_profiles/*`; `dm_carousel/{uid}` puede no mapear perfecto si se usa `postId` como segmento. | Migrar paths a `dm_carousel/{uid}/{postId}/...` o precrear doc con owner; después reforzar reglas por owner real. |
| Media | Arquitectura duplicada y difícil de asegurar | `index.html` supera 6000 líneas, `app/index.html` supera 4000 y `js/chat.js` supera 5000. | Extraer módulos por dominio sin cambiar APIs públicas; priorizar feed, router/hash, notificaciones y chat services. |
| Media | Falta cobertura E2E/visual | Tests actuales cubren sanitización, reglas Firestore y validación backend, pero no navegación real, SW/push, uploads ni regresión visual. | Agregar Playwright mínimo para login, navegación, chat, foro, push mockeado/offline y screenshots baseline. |
| Baja/Media | SW/cache mejorados pero sin prueba automatizada | Root y `/app/` están alineados, pero no hay test de registration/scope/click. | Agregar prueba browser que confirme un solo registro por scope, `getToken` con registration correcta y `notificationclick` con ruta. |
| Baja/Media | Documentación quedó parcialmente desfasada | `docs/security-access-matrix.md` y roadmap PWA antiguo aún pueden describir flujos previos de push/SW. | Actualizar docs operativos para reflejar callable `registerPushToken`, SW actual y reglas cerradas. |
| Baja | Diseño visual funcional pero con deuda de consistencia | CSS inline, Tailwind CDN runtime, estilos dispersos, shells desktop/mobile separados. | Crear inventario de tokens visuales y componentes base; no rediseñar sin fase explícita de producto. |

## Propuestas de mejora para convertir en plan detallado

1. Fase 1, seguridad inmediata de render: auditar `innerHTML` residual en feed/carousel/SPA, clasificar cada sink como estático o dinámico, corregir solo datos de usuario/Firestore con `safe-dom`, `textContent` y validación de URL. Validar payloads `<img onerror>`, `<script>`, `<svg onload>` y `javascript:` en feed, carousel, grupos, mensajes y notificaciones.

2. Fase 2, backend para reducir reglas abiertas: crear callables pequeñas para alias login, búsqueda de usuarios, acciones de likes/contadores y doctor virtual. Mantener compatibilidad del cliente actual durante transición y cerrar reglas solo después de que el cliente deje de depender de lecturas/escrituras amplias.

3. Fase 3, membresías y comités: normalizar documentos de membresía por usuario/comité, cambiar consultas que hoy leen colecciones completas y filtran en cliente, agregar reglas member-scoped para `committee_messages`, `committee_members`, `committee_topics` y metadatos.

4. Fase 4, Storage consistente: migrar rutas legacy a paths con owner verificable o precrear documentos owner-scoped antes del upload. Mantener compatibilidad temporal con rutas existentes y documentar plan de migración/limpieza.

5. Fase 5, QA mínima real: agregar Playwright con smoke de desktop y `/app/`, screenshots para regresión visual básica, pruebas de service worker/offline y pruebas Storage rules. Integrar en CI local con comandos explícitos y sin infraestructura pesada.

6. Fase 6, arquitectura y diseño: extraer módulos de los HTML grandes por dominio, consolidar duplicación desktop/mobile, introducir tokens de diseño y componentes compartidos gradualmente. No cambiar apariencia hasta tener snapshots o validación visual.

7. Fase 7, entrega segura avanzada: preparar CSP `Report-Only` con inventario de inline scripts/CDNs, evaluar App Check para Firebase/Functions/Storage, y mover Tailwind runtime CDN a build local o CSS generado cuando exista pipeline.

## Prompt copiable para GPT Pro

Actúa como Staff Software Engineer, Security Engineer y Arquitecto Web senior sobre el proyecto “Departamento Médico”. Genera un plan de ejecución detallado, faseado y sin regresión para resolver los hallazgos residuales post-remediación. Mantén exactamente layout, ids, clases, rutas, hashes, textos visibles, funciones públicas e interacciones actuales. No migres framework ni reescribas archivos completos si basta con cambios quirúrgicos.

Usa estos hallazgos como fuente: XSS residual potencial en feed/carousel/SPA por `innerHTML` con datos de Firestore; reglas aún parcialmente abiertas por alias login, búsqueda global de `usuarios`, comités y `dm_presence`; contadores/likes/home visits con integridad cliente acotada; Storage legacy con ownership incompleto; deuda por HTML/scripts monolíticos; falta de tests E2E/visual/SW/Storage; documentación parcialmente desfasada.

Entrega un plan por fases con archivos probables, cambios exactos, validaciones automáticas, smoke manual y criterios de aceptación. Si una mejora requiere rediseño de schema o backend, no inventes un parche inseguro: especifica el campo/schema/callable necesario y el orden de migración backward-compatible. Prioriza primero seguridad de render y reglas respaldadas por backend, luego QA, luego arquitectura/diseño.

## Supuestos y validación base

Se asume que los cambios previos ya pasaron `npm test`, `npm --prefix functions test`, `git diff --check` y checks sintácticos relevantes.

Antes de ejecutar cualquier nueva fase, repetir búsqueda estática de `innerHTML`, `insertAdjacentHTML`, `allow read, write: if true`, `@latest`, escrituras directas a `pushTokens`, escrituras cliente a `notifications` y TODOs de reglas.

Después de cada fase, validar login, carga desktop, `/app/`, navegación por hash, chat, foro, comités, notificaciones foreground/background, click de push, uploads, offline y consola sin errores críticos.
