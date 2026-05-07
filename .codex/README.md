# Codex Config Example

Este directorio contiene una configuracion ejemplo para este repo. No reemplaza la configuracion global del usuario.

## Cuando usar xhigh
- Auditorias iniciales amplias.
- Cambios multiarchivo con Firebase, reglas, seguridad o CI.
- Reviews de riesgo antes de merge.
- Planes donde una mala decision pueda afectar datos, permisos o deploy.

## Cuando bajar a medium
- Cambios chicos de copy, CSS localizado o docs.
- Explicaciones puntuales.
- Tareas repetitivas con bajo riesgo.

## Sandbox y aprobaciones
- `workspace-write` permite trabajar dentro del repo sin acceso amplio al sistema.
- `approval_policy = "on-request"` obliga a pedir permiso para red, instalaciones, deploys o acciones fuera del sandbox.
- No usar modos tipo danger/full access para este repo salvo sesion aislada y motivo muy especifico.

## Red y busqueda
- `network_access = false` es el default seguro.
- Usar web search live solo para docs oficiales actuales, cambios de APIs, vulnerabilidades o informacion temporal.
- Permitir red solo para instalar dependencias aprobadas, consultar MCPs o ejecutar comandos que realmente la necesiten.

## Comandos que requieren aprobacion humana
- `npm install`, `npm update`, `npm audit fix` y equivalentes pnpm/yarn/bun.
- `firebase deploy`, `vercel deploy`, `netlify deploy` o cualquier deploy.
- `git push`, creacion de tags y publicacion de releases.
- Comandos destructivos como `rm`, `git reset --hard`, `git clean` o cambios de permisos amplios.
- Lectura o modificacion de secretos, certificados, service accounts o `.env`.
