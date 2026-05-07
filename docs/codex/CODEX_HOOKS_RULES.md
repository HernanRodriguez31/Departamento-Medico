# Codex Hooks Rules

Estas reglas son una guia para hooks o politicas locales. No estan activadas automaticamente por este archivo.

## Bloquear
- `rm -rf`
- `git reset --hard`
- `git clean`
- lectura de `.env*`
- lectura de `*serviceAccount*`, `*.pem`, `*.key`, `*.p12`
- comandos que impriman tokens o secretos

## Pedir Aprobacion
- `git push`
- `firebase deploy`
- cualquier deploy a Vercel, Netlify, Render u otro proveedor
- `npm install`, `npm update`, `npm audit fix`
- equivalentes `pnpm`, `yarn` o `bun`
- comandos con red
- comandos que escriban fuera del workspace
- cambios en `firestore.rules`, `storage.rules` o configuracion productiva

## Permitidos Normalmente
- `git status`
- `git diff`
- `git branch --show-current`
- `git rev-list --left-right --count main...HEAD`
- `rg`, `find`, `sed` sobre archivos no secretos
- `npm run test:safe-dom`
- `npm --prefix functions test`

## Reporte Esperado
Si un hook bloquea un comando, reportar:

- comando bloqueado
- regla aplicada
- alternativa segura
- aprobacion requerida si corresponde
