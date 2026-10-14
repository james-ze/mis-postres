#!/usr/bin/env bash
# Corre las pruebas contra una copia local de Firebase (no toca los datos reales).
# Usa exactamente las mismas reglas (firestore.rules) que la base de datos real.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/build.mjs
npx firebase emulators:exec --project demo-postres --only auth,firestore "npx playwright test $*"
