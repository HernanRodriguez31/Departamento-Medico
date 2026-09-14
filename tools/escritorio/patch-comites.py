#!/usr/bin/env python3
"""Integra el acceso al Escritorio de proyecto en las 7 páginas de comités.

Cambios (idempotentes, mínimos y consistentes en los 7 archivos):
  1. Import del módulo compartido assets/js/common/project-desktop-link.js.
  2. window.openProjectDesktop + delegación de clic sobre las tarjetas.
  3. La tarjeta lleva data-project-desktop-id y su título es un enlace al escritorio.
  4. Botón "Escritorio" (ícono layout-dashboard) en la fila de documentos
     (proyectos en proceso y trabajos finalizados).
  5. Título de los trabajos finalizados enlazado al escritorio.
  6. Versión de comite.css actualizada (cache-busting).

Uso: python3 tools/escritorio/patch-comites.py [--check]
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGES = [
    "comite-bioetica.html",
    "comite-calidad-seguridad.html",
    "comite-docencia-investigacion.html",
    "comite-ejecutivo-emergencias.html",
    "comite-farmacia-terapeutica.html",
    "comite-salud-digital.html",
    "salud-ocupacional.html",
]
VERSION = "20260914-escritorio-1"
MARKER = "project-desktop-link.js"


def replace_once(text, pattern, repl, label, count=1, flags=0):
    new, n = re.subn(pattern, repl, text, count=count, flags=flags)
    if n != count:
        raise SystemExit(f"  ✘ {label}: se esperaban {count} coincidencias, hubo {n}")
    return new


def patch(text):
    # 1. Import compartido (antes del import de sessionGuard, misma indentación).
    text = replace_once(
        text,
        r'^([ \t]*)import \{ initSessionGuard(?:, performManagedLogout)? \} from "\.\./\.\./assets/js/shared/sessionGuard\.js\?v=[^"]+";',
        lambda m: (
            f'{m.group(1)}import {{ buildProjectDesktopUrl, installProjectDesktopCardLinks }} '
            f'from "../../assets/js/common/{MARKER}?v={VERSION}";\n{m.group(0)}'
        ),
        "import project-desktop-link",
        flags=re.M,
    )
    # 2. Handlers globales después de initUserMenu.
    text = replace_once(
        text,
        r'^([ \t]*)initUserMenu\(\{ variant: "desktop" \}\);',
        lambda m: (
            f"{m.group(0)}\n"
            f"{m.group(1)}// Escritorio de proyecto: clic en la tarjeta o en el botón abre escritorio.html\n"
            f"{m.group(1)}window.openProjectDesktop = (topicId) => {{\n"
            f"{m.group(1)}    const url = buildProjectDesktopUrl(COMMITTEE_ID, topicId);\n"
            f"{m.group(1)}    if (url) window.location.href = url;\n"
            f"{m.group(1)}}};\n"
            f"{m.group(1)}installProjectDesktopCardLinks({{ root: document, committeeId: COMMITTEE_ID }});"
        ),
        "handlers globales",
        flags=re.M,
    )
    # 3. Tarjeta: data-project-desktop-id + título enlazado.
    text = replace_once(
        text,
        r'<article class="committee-project-card group">',
        '<article class="committee-project-card group committee-project-card--desktop" data-project-desktop-id="${escapeAttribute(topic.id)}">',
        "article de tarjeta",
    )
    text = replace_once(
        text,
        r'(<h4 class="committee-project-card__title" title="\$\{escapeAttribute\(topic\.title \|\| (?:\'\'|"")\)\}">)'
        r'(\$\{escapeHTML\(topic\.title \|\| (?:\'Sin título\'|"Sin título")\)\})(</h4>)',
        r'\1<a class="committee-project-card__title-link" href="${escapeAttribute(buildProjectDesktopUrl(COMMITTEE_ID, topic.id))}" title="Abrir escritorio del proyecto">\2</a>\3',
        "título de tarjeta",
    )
    # 4. Botón Escritorio antes del ícono de carpeta (una sola función compartida por ambas variantes).
    text = replace_once(
        text,
        r'^([ \t]*)<button type="button" class="doc-icon doc-icon-folder" data-topic-id="\$\{escapeAttribute\(topic\.id\)\}"',
        lambda m: (
            f'{m.group(1)}<button type="button" class="doc-icon doc-icon-desktop" onclick="event.stopPropagation(); window.openProjectDesktop?.(${{safeInlineJsString(topic.id)}})" title="Abrir escritorio del proyecto" aria-label="Abrir escritorio del proyecto">\n'
            f'{m.group(1)}    <i data-lucide="layout-dashboard"></i>\n'
            f'{m.group(1)}</button>\n'
            f'{m.group(0)}'
        ),
        "botón Escritorio",
        flags=re.M,
    )
    # 5. Trabajos finalizados: título enlazado.
    text = replace_once(
        text,
        r'(<span class="text-sm font-semibold text-gray-700 whitespace-normal break-words leading-tight" title="\$\{escapeAttribute\(topic\.title\)\}">)(\$\{escapeHTML\(topic\.title\)\})(</span>)',
        r'\1<a class="committee-project-card__title-link committee-project-card__title-link--finished" href="${escapeAttribute(buildProjectDesktopUrl(COMMITTEE_ID, topic.id))}" title="Abrir escritorio del proyecto">\2</a>\3',
        "título de finalizado",
    )
    # 6. Cache-busting de comite.css.
    text = replace_once(
        text,
        r'comite\.css\?v=[A-Za-z0-9._-]+',
        f"comite.css?v={VERSION}",
        "versión comite.css",
    )
    return text


def main():
    check = "--check" in sys.argv
    changed = 0
    for name in PAGES:
        path = ROOT / "pages" / "comites" / name
        text = path.read_text(encoding="utf-8")
        if MARKER in text:
            print(f"  = {name}: ya integrado")
            continue
        new_text = patch(text)
        if check:
            print(f"  ✔ {name}: se aplicaría")
        else:
            path.write_text(new_text, encoding="utf-8")
            print(f"  ✔ {name}: integrado")
        changed += 1
    print(f"{changed} archivo(s) {'a modificar' if check else 'modificados'}")


if __name__ == "__main__":
    main()
