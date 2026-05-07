---
name: qa-playwright
description: Usar para validacion visual, smoke tests y flujos criticos con navegador o Playwright.
---

# QA Playwright

1. Confirmar si existe Playwright instalado. Si no existe, no instalar sin aprobacion.
2. Levantar la app con Firebase Hosting emulator o servidor local acordado.
3. Navegar flujos criticos: login, home, PWA, comites, foro, chat/notificaciones y asistente IA si aplica.
4. Revisar consola, network errors, assets faltantes, service workers y rutas.
5. Verificar UI en mobile y desktop, foco visible, textos sin solapamiento y estados vacios.
6. Documentar errores reproducibles con pasos, URL, viewport, resultado esperado y resultado observado.
7. No asumir que funciona sin abrir la pantalla afectada.
8. No commitear capturas, videos ni `test-results/`; esos artefactos deben quedar ignorados.
