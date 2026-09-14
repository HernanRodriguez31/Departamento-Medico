# Escritorio de proyecto (comités)

Cada proyecto de cada comité tiene un **escritorio** propio: una pantalla tipo
escritorio (barra de menú, íconos, ventanas, barra de aplicaciones) donde el
equipo trabaja el proyecto en modo colaborativo con archivos en Teams /
SharePoint, calendario, tareas, actas, pizarra y equipo.

- Ruta: `pages/comites/escritorio.html?comite=<committeeId>&proyecto=<topicId>`
- Se abre desde la tarjeta del proyecto (clic en la tarjeta, en su título o en el
  botón verde "Escritorio" de la fila Documentos), también en Trabajos finalizados.
- Requiere sesión del portal (misma puerta única que el resto del sitio).

## Circuito para proyectos nuevos

No hay pasos manuales. Al crear un proyecto con "Agregar nuevo proyecto" en
cualquier comité, la tarjeta ya enlaza a su escritorio. La primera vez que
alguien lo abre, `store.ensureProvisioned()` crea `desktop_meta/config` y las
carpetas base (Documentos, Presentaciones, Planillas, Actas y minutas,
Bibliografía y evidencia) en un `writeBatch`, y registra la actividad
"Escritorio del proyecto creado". Los accesos Microsoft 365 salen de
`js/committee-links.js` (enlaces por slot del comité) y se pueden reemplazar
por enlaces propios desde *Microsoft 365 › Configurar accesos* (se guardan en
`docLinks` del proyecto, el mismo campo que edita la tarjeta).

## Estructura de archivos

| Archivo | Rol |
| --- | --- |
| `pages/comites/escritorio.html` | Página (cascarón: barra, escritorio, ventanas, dock, arranque) |
| `assets/css/pages/project-desktop.css` | Estilos (mobile-first; modo compacto < 760 px) |
| `assets/js/pages/project-desktop/main.js` | Arranque: auth, parámetros, suscripciones, escritorio, dock, ⌘K |
| `assets/js/pages/project-desktop/store.js` | Capa de datos Firestore + aprovisionamiento + actividad |
| `assets/js/pages/project-desktop/wm.js` | Gestor de ventanas (arrastrar, redimensionar, minimizar, ampliar) |
| `assets/js/pages/project-desktop/ui.js` | DOM seguro, diálogos, menús, avisos, fechas es-AR |
| `assets/js/pages/project-desktop/links.js` | Tipos de enlace (Word, Excel, PPT, Teams, Drive…) y accesos M365 |
| `assets/js/pages/project-desktop/icons.js` | Íconos Lucide embebidos (sin CDN) |
| `assets/js/pages/project-desktop/apps/*.js` | Apps: files, calendar, tasks, notes, board, team, progress, m365, misc |
| `assets/js/common/project-desktop-link.js` | Registro de comités + enlace desde las tarjetas (compartido) |
| `tools/escritorio/patch-comites.py` | Integración idempotente en las 7 páginas de comités |
| `tools/escritorio/comite-escritorio.css` | Bloque CSS agregado al final de `assets/css/pages/comite.css` |
| `tools/verificacion/escritorio/` | Verificación en Chromium headless con Firebase en memoria |

## Modelo de datos

Todo lo propio del escritorio vive en subcolecciones del proyecto
`artifacts/departamento-medico-brisa/public/data/committee_topics/{topicId}/`:

| Subcolección | Documento | Campos principales |
| --- | --- | --- |
| `desktop_meta` | `config` (único) | `committeeId`, `schemaVersion`, `description` (objetivo), `wallpaper`, `team[]` ({name, role, uid, unit}), `seeded` |
| `desktop_items` | carpetas y enlaces | `type` (folder/link), `name`, `parentId`, `url` (https), `kind`, `note`, `pinned`, `archived`, `order` |
| `desktop_tasks` | tareas | `title`, `details`, `status` (todo/doing/done), `priority` (alta/media/baja), `assignee`, `assigneeUid`, `dueDate`, `order`, `doneAt`, `archived` |
| `desktop_notes` | actas / notas / informes | `kind` (acta/nota/informe), `title`, `body` (≤ 20 000), `meetingDate`, `pinned`, `archived` |
| `desktop_activity` | registro | `action`, `entity`, `label`, `authorUid`, `authorName`, `createdAt` (inmutable) |

Sellos comunes: `createdByUid`, `createdByName`, `createdAt`, `updatedAt`,
`updatedByUid`, `updatedByName`.

Integración con colecciones existentes:

- **`calendar_events`**: los eventos del proyecto se guardan con
  `calendarScope: "committee"`, `committeeId`, `committeeName` y además
  `projectId`, `projectTitle`, `eventKind` (reunion/hito/plazo/recordatorio) y
  `link` (https, p. ej. reunión de Teams). Por eso aparecen también en el
  calendario del comité y del departamento. La primera reunión futura actualiza
  `nextMeeting` en el proyecto (la "Próxima reunión" de la tarjeta).
- **`committee_notes`** (`scope: "project"`, `projectId`): la app Pizarra lee y
  escribe la misma columna del proyecto que la pizarra de comunicaciones del comité.
- **`committee_members`**: nómina del comité para sumar integrantes al proyecto.
- **`committee_topics`** (el proyecto): la app Avance edita `stage`,
  `finishedDate`, `title`, `proposedBy`, `startDate`, `nextMeeting` y
  `docLinks` (+ claves nuevas `xlsx`, `teams`, `onenote`) con la misma forma que
  la tarjeta; no se agregan campos de primer nivel al documento.
- **`committee_meta`**: título editable del comité (solo lectura acá).

## Reglas de seguridad (firestore.rules)

Bloque "Escritorio de proyecto" (aditivo; no cambia reglas existentes salvo
`calendar_events`, que suma claves opcionales y edición colaborativa de eventos
con `projectId`):

- Lectura: cualquier usuario autenticado del portal (`signedIn()`).
- Alta: el autor debe ser quien escribe (`createdByUid == auth.uid`); forma y
  tamaños validados por colección (`validDesktopConfig/Item/Task/Note/Activity`);
  URLs solo `https://`.
- Edición: colaborativa (cualquier autenticado) sin alterar `createdByUid` ni
  `createdAt`; `updatedByUid` debe ser quien escribe.
- Borrado definitivo: autor o admin. La papelera es un `archived: true`
  (edición) que cualquiera puede aplicar y revertir. `desktop_activity` es
  inmutable. `desktop_meta` solo admite el id `config`.
- Tests: `tests/firestore-rules.test.mjs` (bloque "escritorio" + "calendar_events
  … projectId"). Ejecutar `npm run test:rules` (requiere Firebase CLI, Java y
  descarga del emulador).

## Microsoft 365

- La carpeta del proyecto, el Word y el PowerPoint por defecto son los enlaces
  de SharePoint del equipo "Departamento Médico" definidos por slot en
  `js/committee-links.js`; cada proyecto puede sobreescribirlos y agregar
  Excel, canal de Teams y OneNote (`docLinks`).
- Los archivos siempre se abren en pestaña nueva: SharePoint Online envía
  `X-Frame-Options: SAMEORIGIN`, por lo que no puede incrustarse en un iframe
  desde este dominio (limitación de Microsoft, no del portal).
- "Crear un documento nuevo": se recomienda abrir la carpeta del proyecto y usar
  "+ Nuevo" para que el archivo quede dentro del proyecto; los atajos
  `word.new`, `excel.new` y `powerpoint.new` crean el documento en el OneDrive
  de la cuenta con sesión.
- Evolución posible: integración con Microsoft Graph (listar la carpeta y crear
  documentos dentro del proyecto sin pegar enlaces). Requiere registrar una app
  en Entra ID del tenant y consentimiento de administrador; el escritorio ya
  está preparado para reemplazar `resolveProjectLinks()` por datos de Graph.

## Verificación

```bash
node tools/verificacion/escritorio/run-escritorio.mjs --out test-results/escritorio
node tools/verificacion/escritorio/run-comites.mjs --out test-results/escritorio-comites
```

Ambos scripts sirven el repo en un puerto local, reemplazan Firebase por un
Firestore en memoria (`tools/verificacion/escritorio/stubs/`), bloquean las CDN
y recorren los flujos reales (aprovisionamiento, archivos, calendario y
sincronización de próxima reunión, tareas, actas con autoguardado, equipo,
pizarra, avance, M365, actividad, papelera, ajustes, ventanas, ⌘K, móvil 390 px,
rutas de error y redirección sin sesión). Dejan capturas y `resultado.json`.
Requieren `playwright` y Chromium (`npx playwright install chromium`).

## Despliegue

```bash
firebase deploy --only firestore:rules --project departamento-medico-brisa
firebase deploy --only hosting --project departamento-medico-brisa
```

Primero las reglas (sin ellas el escritorio muestra "Sin permiso para leer…"),
después el hosting. `tools/escritorio/desplegar-escritorio.command` hace ambos
pasos con doble clic en macOS.

## Ideas para la próxima iteración

- Subida directa de adjuntos livianos (PDF, imágenes) a Firebase Storage por proyecto.
- Aviso por correo/push al responsable cuando se le asigna una tarea o vence un plazo.
- Exportar actas a PDF con membrete institucional y numeración.
- Vista "Mis proyectos" en el inicio con tareas pendientes de cada persona.
- Plantillas de proyecto (carpetas y tareas iniciales por tipo de trabajo).
