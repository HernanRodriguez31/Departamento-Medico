#!/bin/bash
# Despliega el Escritorio de proyecto a producción (reglas Firestore + hosting
# del sitio departamento-medico-brisa). Doble clic en Finder o:
#   bash tools/escritorio/desplegar-escritorio.command
# Requiere Firebase CLI con sesión iniciada en la cuenta del proyecto.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Terminal ejecuta los .command sin el PATH interactivo de zsh: sumar rutas
# habituales de Node/npm (Homebrew, npm global, nvm, Volta) para hallar firebase.
for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.npm-global/bin" "$HOME/.volta/bin" "$HOME"/.nvm/versions/node/*/bin; do
  [ -d "$dir" ] && PATH="$dir:$PATH"
done
export PATH
if ! command -v firebase >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

PROJECT="departamento-medico-brisa"
SITE="departamento-medico-brisa"
LOG="tools/escritorio/deploy-$(date +%Y%m%d-%H%M%S).log"

echo "== Escritorio de proyecto → producción ($PROJECT) ==" | tee "$LOG"
echo "Rama: $(git branch --show-current)  Commit: $(git rev-parse --short HEAD)" | tee -a "$LOG"

if ! command -v firebase >/dev/null 2>&1; then
  echo "No se encontró firebase-cli. Instalá con: npm install -g firebase-tools" | tee -a "$LOG"
  exit 1
fi

echo "-- 1/2 Reglas de Firestore" | tee -a "$LOG"
firebase deploy --only firestore:rules --project "$PROJECT" --non-interactive 2>&1 | tee -a "$LOG"

echo "-- 2/2 Hosting ($SITE)" | tee -a "$LOG"
firebase deploy --only hosting --project "$PROJECT" --non-interactive 2>&1 | tee -a "$LOG"

echo "== Listo. Verificá: https://dm.brisasaludybienestar.com/pages/comites/comite-docencia-investigacion.html" | tee -a "$LOG"
echo "Registro: $LOG"
