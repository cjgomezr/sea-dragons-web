#!/usr/bin/env bash
# Barrida periódica: reconcilia TODAS las épicas contra el estado actual de
# sus sub-issues. Cubre el enganche manual desde la interfaz de GitHub, que
# no dispara ningún evento de Actions y por eso el camino por evento
# (scripts/sync-epic-status.sh) nunca lo ve.
#
# Una épica que ya está al día no genera ningún comentario ni llamada de
# escritura: solo se toca la que de verdad cambió.
#
# Usage: scripts/reconcile-all-epics.sh
#
# Requires: gh, jq.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib/reconcile-epic.sh"

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# --limit explícito: gh trae 30 por defecto y dejaría épicas sin reconciliar
# en silencio, diciendo que terminó cuando quedaron algunas sin tocar.
EPICS=$(gh issue list --label epic --state all --limit 1000 --json number --jq '.[].number' | tr -d '\r')

failed=0
for epic in $EPICS; do
  if reconcile_epic "$REPO" "$epic"; then
    :
  else
    echo "✗ #$epic: no se pudo reconciliar" >&2
    failed=1
  fi
done

exit "$failed"
