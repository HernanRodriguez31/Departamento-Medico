# Playwright Setup

Playwright no esta configurado actualmente en este repo. No instalar sin aprobacion.

## Instalacion Recomendada
Cuando el equipo lo apruebe:

```bash
npm install --save-dev @playwright/test
npx playwright install
```

Agregar scripts posibles:

```json
{
  "scripts": {
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui"
  }
}
```

## Flujos Minimos Sugeridos
- Carga de `index.html` sin errores de consola.
- Login y redireccion de usuario no autenticado.
- PWA `/app/index.html` en mobile viewport.
- Pagina de comite.
- Foro y estados empty/error.
- Asistente IA sin exponer secretos.

## Artefactos
Mantener fuera de Git:

- `test-results/`
- `playwright-report/`
- `playwright-artifacts/`
- `blob-report/`

## Playwright MCP
Para QA interactiva con Codex, usar Playwright MCP o Browser plugin. Confirmar servidor local, URL y credenciales sinteticas antes de navegar.
