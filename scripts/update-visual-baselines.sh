#!/usr/bin/env bash
# Reconcilia la línea base visual de Linux con el estado actual de la rama,
# sin que ningún dev tenga que acordarse de disparar nada a mano (issue #58).
#
# Compara primero (sin --update-snapshots) para que una diferencia real de
# píxeles quede visible en el log/reporte de Playwright antes de tocar nada.
# Sólo si esa comparación falla se regenera. Deja los cambios en el índice de
# git (`git add`) listos para que quien llama decida si commitea y empuja;
# este script nunca hace commit ni push por sí mismo.
#
# Sale con 0 sólo cuando la línea base ya estaba al día. Cualquier otro
# desenlace (regenerada con cambios, o un fallo que no era de píxeles) sale
# con 1: la comparación "sigue fallando" a propósito, para forzar que alguien
# mire el diff antes de darlo por bueno.
#
# Usage: scripts/update-visual-baselines.sh

set -uo pipefail

if npx playwright test; then
  echo "update-visual-baselines: sin cambios, la línea base ya estaba al día."
  exit 0
fi

echo "update-visual-baselines: la comparación falló, regenerando desde esta rama." >&2
npx playwright test --update-snapshots
git add tests/

if git diff --cached --quiet; then
  echo "update-visual-baselines: la regeneración no cambió ninguna captura; el fallo no era de píxeles." >&2
  exit 1
fi

echo "update-visual-baselines: línea base regenerada, revisa el diff antes de aceptarlo." >&2
exit 1
