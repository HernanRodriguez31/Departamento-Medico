# Auditoría — Creación de proyecto en los 7 comités

**Objetivo:** permitir que cualquier usuario autenticado pueda crear un proyecto nuevo en los 7 comités. Hoy la plataforma le informa al no-admin que la acción "debe realizarla un administrador". Es un bug de permisos. **No se modifica ningún otro permiso.**

- **Rama:** `fix/comites-crear-proyecto-todos-usuarios` (creada desde `main`).
- **Fecha:** 2026-06-17.
- **Método:** reconocimiento multiagéntico en paralelo (5 subagentes) + verificación directa por grep/lectura. Doble vía independiente, hallazgos consistentes.
- **Sin deploy.** Las instrucciones de despliegue quedan para el operador (al final).

---

## 1. Mapa de los 7 comités y dónde vive la lógica de creación

Un "proyecto" se modela como un **topic** en la colección Firestore `committee_topics`, en el path:

```
artifacts/{appId}/public/data/committee_topics/{topicId}
```

La creación es **escritura directa cliente → Firestore** (`addDoc`), sin backend intermedio.

| # | Comité | Archivo | Handler de creación |
|---|--------|---------|---------------------|
| 1 | Bioética | `pages/comites/comite-bioetica.html` | `#form-add-topic` submit (multilínea) |
| 2 | Farmacia y Terapéutica | `pages/comites/comite-farmacia-terapeutica.html` | `#form-add-topic` submit |
| 3 | Salud Digital | `pages/comites/comite-salud-digital.html` | `#form-add-topic` submit |
| 4 | Docencia e Investigación | `pages/comites/comite-docencia-investigacion.html` | `#form-add-topic` submit |
| 5 | Calidad y Seguridad | `pages/comites/comite-calidad-seguridad.html` | `#form-add-topic` submit |
| 6 | Ejecutivo / Emergencias | `pages/comites/comite-ejecutivo-emergencias.html` | `#form-add-topic` submit |
| 7 | Salud Ocupacional | `pages/comites/salud-ocupacional.html` | `#form-add-topic` submit |

**¿Compartido o duplicado?** → **DUPLICADO.** No existe un módulo/componente único que ejecute la creación: cada comité tiene su propio handler inline dentro de un `<script type="module">`. La única pieza compartida es la utilidad `js/committee-links.js` (`getNextProjectSlot`, numeración de slots/links), que **no** contiene gating por rol. Por eso el fix de frontend se aplicó de forma consistente a los 7 archivos. `pages/comites/template.html` es HTML estático y no contiene lógica de creación.

> Nota arquitectónica: 6 comités usan el mismo estilo condensado (con rama `else` mock); `comite-bioetica.html` está reformateado (multilínea, sin rama mock). El fix contempló ambas variantes.

---

## 2. Punto(s) exacto(s) donde se enforzaba la restricción admin-only

El bloqueo era **doble** (frontend + reglas Firestore). Estado **previo** al fix:

### 2.a — Reglas Firestore (barrera REAL de seguridad)

`firestore.rules` — bloque de `committee_topics` (antes):

```firestore
match /artifacts/{appId}/public/data/committee_topics/{topicId} {
  allow read: if signedIn();
  allow create, update, delete: if isAdmin();   // ← create restringido a admin
}
```

`isAdmin()` (`firestore.rules:12-18`) resuelve admin por **custom claim** `request.auth.token.admin == true` **o** por existencia del doc `admin_whitelist/{uid}` (esta colección es inmutable desde el cliente, `firestore.rules:698-701`). No falsificable por el cliente.

### 2.b — Frontend (early-return por rol, "cosmético" sobre la barrera real)

En cada uno de los 7 handlers `#form-add-topic` (antes):

```js
if (db) {
  const allowed = await ensureAdmin();
  if (!allowed) {
    Swal.fire('Acceso restringido', 'Solo administradores pueden agregar proyectos.', 'error');
    return;   // ← early-return por rol; mensaje de bloqueo al no-admin
  }
}
```

- Mecanismo: **(b) early-return por rol** antes de escribir. **No** se ocultaba/deshabilitaba el botón (el form siempre se renderiza) ni el bloqueo venía del `catch` (el `catch` solo hace `console.error`).
- El payload **no** registraba propietario (`createdByUid`), porque al ser admin-only no lo necesitaba.

---

## 3. Capa responsable

**Combinación: frontend + reglas Firestore (caso "c").**

- El frontend mostraba el mensaje "Solo administradores pueden agregar proyectos." y hacía early-return → el usuario nunca llegaba a escribir.
- **Aunque** se quitara solo el frontend, las reglas Firestore habrían rechazado el `create` de un no-admin (`PERMISSION_DENIED`). Por eso **el fix ataca la capa que realmente bloquea: las reglas**, y además limpia el frontend para que el flujo funcione y registre ownership.
- **Backend:** no interviene. No hay Cloud Function ni Apps Script en la creación de proyectos (las functions existentes son de feed/chat/push y de seguridad de cuentas, no de comités).

---

## 4. Diagnóstico (causa raíz)

> La creación de proyecto estaba bloqueada en **dos capas**: (1) **reglas Firestore** con `allow create … : if isAdmin()` sobre `committee_topics` — bloqueo **real** server-side; y (2) **frontend** con un early-return `ensureAdmin()` en los 7 handlers `#form-add-topic` que mostraba "Solo administradores pueden agregar proyectos." La causa raíz del bug de permisos es que **`create` fue agrupado junto a `update`/`delete` bajo `isAdmin()`**, cuando la intención de producto es que la creación esté abierta a todo usuario autenticado (y solo la edición/borrado y la gestión de roles sean admin-only).

---

## 5. Solución aplicada (mínima e incremental)

### 5.a — Reglas Firestore (`firestore.rules`)

Se **separó** `create` de `update`/`delete` y se agregó un validador de forma + ownership (estilo consistente con `validCommitteeMemberSelfJoin`, `validCommitteeNoteCreate`, etc.):

```firestore
function validCommitteeTopicCreate() {        // firestore.rules:432
  return signedIn()
    && onlyKeys([
      "title","startDate","proposedBy","committeeId",
      "projectNumber","docLinks","stage","createdAt","createdByUid"
    ])
    && request.resource.data.createdByUid == request.auth.uid   // anti-spoofing
    && request.resource.data.title is string
    && request.resource.data.title.size() > 0
    && request.resource.data.title.size() <= 300
    && request.resource.data.committeeId is string;
}

match /artifacts/{appId}/public/data/committee_topics/{topicId} {   // firestore.rules:906
  allow read: if signedIn();
  allow create: if isAdmin() || validCommitteeTopicCreate();        // ← autenticado + ownership
  allow update, delete: if isAdmin();                               // ← editar/borrar ajeno: admin-only
}
```

- **Ownership:** el documento debe registrar `createdByUid == request.auth.uid` (evita suplantación). Campo alineado con el helper existente `isOwnedByCurrentUser`.
- **Forma:** `onlyKeys(...)` impide inyectar campos arbitrarios; `title`/`committeeId` validados.
- **`isAdmin() ||`** se conserva para no romper ningún flujo admin existente.
- **No se tocaron** `update`/`delete` (siguen admin-only) ni la gestión de roles (`admin_whitelist`, claims, colección `usuarios`).

### 5.b — Frontend (los 7 comités)

En cada `#form-add-topic` se reemplazó el early-return por rol con un guard mínimo de sesión y se agregó el campo de ownership al payload:

```js
const currentUser = auth?.currentUser;
if (db && !currentUser) {
  Swal.fire('Sesión requerida', 'Iniciá sesión para crear un proyecto.', 'error');
  return;
}
// …
await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'committee_topics'), {
  title, startDate: date, proposedBy, committeeId: COMMITTEE_ID,
  projectNumber, docLinks, stage: 1,
  createdByUid: currentUser.uid,   // ← ownership
  createdAt: serverTimestamp()
});
```

Líneas del nuevo guard / del `createdByUid` por archivo:

| Comité | guard sesión | `createdByUid` |
|--------|:---:|:---:|
| bioética | 1749 | 1790 |
| farmacia-terapéutica | 1443 | 1468 |
| salud-digital | 1436 | 1461 |
| docencia-investigación | 1460 | 1485 |
| calidad-seguridad | 1460 | 1485 |
| ejecutivo-emergencias | 1473 | 1498 |
| salud-ocupacional | 1430 | 1455 |

- **No se modificó** el handler `#form-add-member` (alta de integrantes), que sigue mostrando "Solo administradores pueden agregar integrantes." → **admin-only intacto**, como pide el alcance.
- **No se tocó** HTML/estructura ni CSS: el botón "Agregar nuevo proyecto" ya se renderizaba para todos los usuarios (solo el submit estaba gateado), por lo que accesibilidad/responsive del control quedan **sin cambios**.
- La rama `else` (mock, sin Firebase) no se modificó.

### Archivos afectados (8)

```
firestore.rules
pages/comites/comite-bioetica.html
pages/comites/comite-farmacia-terapeutica.html
pages/comites/comite-salud-digital.html
pages/comites/comite-docencia-investigacion.html
pages/comites/comite-calidad-seguridad.html
pages/comites/comite-ejecutivo-emergencias.html
pages/comites/salud-ocupacional.html
tests/firestore-rules.test.mjs   (test actualizado a la nueva política)
```

---

## 6. Riesgos de seguridad de abrir la creación y mitigaciones

| Riesgo | Mitigación aplicada |
|--------|---------------------|
| Suplantación de autor (spoofing de `createdByUid`) | Regla exige `createdByUid == request.auth.uid`. |
| Inyección de campos arbitrarios en el documento | `onlyKeys([...])` acota la forma a 9 campos. |
| Escalada vía edición/borrado de proyectos ajenos | `update`/`delete` siguen **admin-only** (sin cambios). |
| Auto-promoción a admin | Sin cambios: `admin_whitelist` inmutable desde cliente y claims solo por Admin SDK. |
| Títulos/contenido abusivos | `title` validado (string no vacío, ≤ 300 chars). |
| **Spam de proyectos** (cualquier autenticado puede crear) | Aceptado por diseño del feature. Las reglas Firestore no permiten rate-limiting; si se requiere, mitigar con una Cloud Function `onDocumentCreated` o cuota por usuario (fuera de alcance). **Riesgo residual conocido.** |
| Exposición de PII | `createdByUid` es el uid opaco de Firebase Auth (no es PII). No se agregó email/nombre nuevo al payload. |

---

## 7. Validación realizada

- **Reglas (emulador Firestore):** `npm run test:rules` → **22/22 PASS, 0 fallos**. Casos cubiertos para `committee_topics`:
  - ✅ usuario autenticado **crea** su propio proyecto (con `createdByUid` propio).
  - ✅ se **deniega** crear con `createdByUid` ajeno (anti-spoofing).
  - ✅ se **deniega** crear sin `createdByUid`.
  - ✅ se **deniega** crear con campos extra (forma).
  - ✅ **admin** conserva la capacidad de crear.
  - ✅ no-admin **no puede** `update`/`delete` (admin-only); **admin sí**.
  - ✅ usuario no autenticado **no puede** crear (cubierto por test de rutas).
- **Sintaxis de reglas:** compilan correctamente (cargadas por el emulador sin error).
- **Frontend:** handlers de los 7 comités revisados; JS sintácticamente correcto y consistente. `ensureAdmin`/`resolveAdminStatus` siguen definidos y en uso (alta de integrantes).
- **PII:** sin exposición nueva en payload ni en UI.
- **Accesibilidad/responsive:** sin cambios de HTML/CSS → postura del control sin alteración.

### Pendiente para el operador (no ejecutable sin entorno real)

- **Smoke test funcional** del flujo de creación en los 7 comités con un usuario **no-admin** real (login → "Agregar nuevo proyecto" → guardar → aparece). Requiere reglas desplegadas (ver §9).

---

## 8. Checklist final

- [x] `create` de `committee_topics` habilitado para todo usuario autenticado.
- [x] Ownership registrado (`createdByUid == auth.uid`) en reglas y payload.
- [x] `update`/`delete` siguen **admin-only** (proyectos ajenos protegidos).
- [x] Gestión de roles (`admin_whitelist`, claims, `usuarios`) **sin cambios**.
- [x] Alta de **integrantes** sigue **admin-only** (no se tocó).
- [x] Fix aplicado a los **7** comités de forma consistente.
- [x] Frontend: quitado el early-return por rol y el mensaje "Solo administradores pueden agregar proyectos." en el camino de creación.
- [x] Test de reglas actualizado y verde (22/22).
- [x] Sin cambios en HTML/estructura ni CSS.
- [x] `login.html` (cambio preexistente sin commitear) **no** tocado.
- [x] Sin deploy.

---

## 9. Qué debe desplegar el operador (NO ejecutado aquí)

> Revisar el diff de la rama antes de desplegar. El despliegue lo decide y ejecuta el operador.

1. **Reglas Firestore** (imprescindible — es la capa que realmente bloquea):
   ```bash
   firebase deploy --only firestore:rules
   ```
2. **Hosting** (frontend de los 7 comités):
   ```bash
   firebase deploy --only hosting
   ```

Recomendado desplegar **primero las reglas** y luego el hosting, para que el frontend nuevo (que ya intenta `create` como no-admin) encuentre las reglas que lo permiten.
