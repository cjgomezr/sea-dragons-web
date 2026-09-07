#!/usr/bin/env bash
# Reconcilia la épica padre de un sub-issue justo después de que ese
# sub-issue se cierra o se reabre. No necesita saber cuál de los dos eventos
# fue: mira el estado actual de la épica y de sus sub-issues y actúa según lo
# que encuentra (reconcile_epic en lib/reconcile-epic.sh).
#
# Usage: scripts/sync-epic-status.sh <sub-issue-number>
#
# Sale en 0 sin hacer nada si el issue no cuelga de ninguna épica. Falla del
# lado seguro: si la consulta a `gh` falla, no cierra ni reabre nada.
#
# Requires: gh, jq.

set -euo pipefail

ISSUE="${1:?usage: sync-epic-status.sh <issue-number>}"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib/reconcile-epic.sh"

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER="${REPO%%/*}"
NAME="${REPO##*/}"

JSON=$(gh api graphql -f query='
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        parent { number }
      }
    }
  }' -f owner="$OWNER" -f name="$NAME" -F number="$ISSUE")

PARENT=$(jq -r '.data.repository.issue.parent.number // empty' <<<"$JSON")

[ -n "$PARENT" ] || exit 0

reconcile_epic "$REPO" "$PARENT"
