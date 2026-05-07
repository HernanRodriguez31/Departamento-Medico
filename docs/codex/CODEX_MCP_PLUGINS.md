# Codex MCP And Plugins

## Recomendados
- Playwright MCP: QA visual, consola, flujos criticos y capturas locales.
- Context7 MCP: documentacion actual de librerias cuando se agreguen o actualicen dependencias.
- GitHub: PRs, issues, checks y review de CI.
- Figma: util si el equipo trabaja con disenos fuente.
- Google Drive: util si los specs o minutas viven en Drive.
- Jira/Linear: util si el backlog vive alli.
- CI/CD: solo para revisar checks y logs; deploy requiere aprobacion.
- Sentry/Datadog: util si se incorpora observabilidad productiva.

## Comandos Sugeridos
No ejecutarlos automaticamente. Requieren aprobacion porque usan red e instalan/descargan paquetes.

```bash
codex mcp add playwright -- npx "@playwright/mcp@latest"
codex mcp add context7 -- npx -y @upstash/context7-mcp
```

## Plugins Codex Utiles
- Browser: validar UI local, consola y navegacion.
- GitHub: revisar PRs/checks si esta conectado.
- Google Drive: leer specs compartidos si aplica.
- Figma: implementar contra diseno si aplica.

## Uso Seguro
- Preferir MCPs para lectura y verificacion, no para deploy.
- No pasar secretos a MCPs.
- No conectar herramientas productivas sin definir permisos y alcance.
