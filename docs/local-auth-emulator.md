# Auth Emulator local

El Firebase Auth Emulator usa una base de usuarios local separada de Firebase Auth productivo. Por eso una cuenta real de produccion, aunque funcione en el sitio publicado, no existe en `localhost` hasta que se cree en el emulador.

No conectes `localhost` a Auth productivo para probar credenciales reales. Para pruebas locales se usan usuarios sinteticos.

## Levantar emuladores

```bash
firebase emulators:start --only hosting,auth,firestore,functions,storage
```

Puertos esperados del proyecto:

- Hosting: `127.0.0.1:5002`
- Auth: `127.0.0.1:9099`
- Firestore: `127.0.0.1:8080`
- Functions: `127.0.0.1:5001`
- Storage: `127.0.0.1:9199`

## Seed de usuarios locales

En otra terminal:

```bash
cd functions && \
FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099" \
FIRESTORE_EMULATOR_HOST="127.0.0.1:8080" \
GCLOUD_PROJECT="departamento-medico-brisa" \
node scripts/seed-local-auth-emulator.js
```

Para dejar al usuario de reset con cambio obligatorio de contrasena activo:

```bash
cd functions && \
FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099" \
FIRESTORE_EMULATOR_HOST="127.0.0.1:8080" \
GCLOUD_PROJECT="departamento-medico-brisa" \
node scripts/seed-local-auth-emulator.js --force-reset-user
```

## Credenciales locales

Estas credenciales son solo para Auth Emulator. No tienen relacion con produccion y no deben reutilizarse fuera del entorno local.

SuperAdmin local:

- Email: `hrodriguez@pan-energy.com`
- Password local: `BrisaLocalAdmin-2026!`

Usuario comun local:

- Email: `usuario.local@brisa.test`
- Password local: `BrisaLocalUser-2026!`

Usuario reset local:

- Email: `reset.local@brisa.test`
- Password local: `BrisaReset-2026!`

## Prueba

Abrir:

```text
http://127.0.0.1:5002/login.html
```

En esa URL debe verse el aviso:

```text
Modo emulador local. Usa usuarios sinteticos; las credenciales productivas no aplican.
```

Si aparece un error con una cuenta productiva, el comportamiento esperado es que el login local indique que el usuario no existe o la contrasena no corresponde en el emulador.
