---
name: frontend-feature
description: Usar para implementar o modificar funcionalidades de UI en el portal, PWA o paginas de comites.
---

# Frontend Feature

1. Analizar primero el flujo afectado, archivos HTML/CSS/JS y dependencias Firebase usadas.
2. Proponer o aplicar un cambio pequeno, compatible con el estilo visual existente.
3. Mantener separacion entre UI, servicios, utilidades y tipos/documentacion cuando existan.
4. Evitar duplicar logica y evitar `innerHTML` con datos dinamicos sin sanitizacion.
5. Cubrir estados loading, error, empty, permisos y offline cuando aplique.
6. Cuidar accesibilidad: labels, foco, contraste, navegacion por teclado y ARIA util.
7. Cuidar responsive en mobile y desktop, especialmente PWA en `app/`.
8. No agregar dependencias sin justificacion y aprobacion.
9. Agregar o ajustar tests reales si hay superficie testeable.
10. Validar con navegador o Playwright/MCP si la UI cambia; revisar consola y layout.
11. Ejecutar comandos disponibles: `npm run test:safe-dom`, `npm --prefix functions test` y, si aplica, `npm run qa`.
