#!/usr/bin/env bash
# Files an incident so it is born visible and executable: queued (`pending`,
# `priority:high`), linked as a native sub-issue of the epic whose code
# broke, and on the board when there is one. Prints only the new issue
# number to stdout so callers can chain it.
#
# The board update is best-effort: a caller running under a token without
# 'project' scope (e.g. the default GITHUB_TOKEN in a GitHub Actions job,
# which cannot authenticate to the Projects v2 API at all) still gets its
# incident filed and linked to the epic, just without a board card.
#
# Usage: scripts/file-incident.sh <epic-number> <title> <body-file>
#
# Requires: gh, jq (via task-status.sh). 'project' scope is only needed for
# the board step, and its absence doesn't fail this script.

set -euo pipefail

EPIC="${1:?usage: file-incident.sh <epic-number> <title> <body-file>}"
TITLE="${2:?usage: file-incident.sh <epic-number> <title> <body-file>}"
BODY_FILE="${3:?usage: file-incident.sh <epic-number> <title> <body-file>}"

[ -f "$BODY_FILE" ] || {
  echo "file-incident.sh: no existe el archivo de cuerpo '$BODY_FILE'" >&2
  exit 1
}

gh issue view "$EPIC" >/dev/null 2>&1 || {
  echo "file-incident.sh: la épica #$EPIC no existe" >&2
  exit 1
}

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

ISSUE_URL=$(gh issue create --title "$TITLE" --body-file "$BODY_FILE" \
  --label "pending" --label "priority:high")
ISSUE_NUMBER="${ISSUE_URL##*/}"

DB_ID=$(gh api "repos/$REPO/issues/$ISSUE_NUMBER" --jq .id)
gh api --method POST "repos/$REPO/issues/$EPIC/sub_issues" -F "sub_issue_id=$DB_ID" >/dev/null

# Un incidente nuevo siempre es trabajo pendiente: si la épica estaba
# cerrada, engancharle uno la reabre en el mismo paso, no en la próxima
# barrida periódica. No aborta el resto del script si falla: el incidente ya
# quedó creado y enlazado, que es lo que no se puede perder.
source "$SCRIPT_DIR/lib/reconcile-epic.sh"
reconcile_epic "$REPO" "$EPIC" >/dev/null \
  || echo "⚠ file-incident.sh: no pude reconciliar el estado de la épica #$EPIC" >&2

bash "$SCRIPT_DIR/task-status.sh" "$ISSUE_NUMBER" "Todo" >/dev/null || \
  echo "file-incident.sh: no pude actualizar el tablero para #$ISSUE_NUMBER (¿token sin permiso 'project'?); el issue ya quedó creado y enlazado a la épica." >&2

echo "$ISSUE_NUMBER"
