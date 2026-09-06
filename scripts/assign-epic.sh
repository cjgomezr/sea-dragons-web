#!/usr/bin/env bash
# Assigns a user to every open sub-issue of an epic. Assigning the epic issue
# itself does nothing for the factory (next_issue() in process-backlog.sh
# reserves work by ticket, and sub-issues don't inherit the parent's
# assignee), so this is the command that actually reserves the epic's work.
#
# Usage: scripts/assign-epic.sh <epic-number> <user>
#
# Requires: gh, jq.

set -euo pipefail

EPIC="${1:?usage: assign-epic.sh <epic-number> <user>}"
USER="${2:?usage: assign-epic.sh <epic-number> <user>}"

EPIC_INFO=$(gh issue view "$EPIC" --json state,labels 2>/dev/null) || {
  echo "assign-epic.sh: la épica #$EPIC no existe" >&2
  exit 1
}

echo "$EPIC_INFO" | jq -e '.labels[] | select(.name=="epic")' >/dev/null || {
  echo "assign-epic.sh: #$EPIC no es una épica (le falta el label 'epic')" >&2
  exit 1
}

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
SUB_ISSUES=$(gh api "repos/$REPO/issues/$EPIC/sub_issues" --jq '.[].number')

for n in $SUB_ISSUES; do
  INFO=$(gh issue view "$n" --json state,assignees)
  STATE=$(echo "$INFO" | jq -r .state)

  if [ "$STATE" = "CLOSED" ]; then
    echo "↷ #$n está cerrado, se ignora" >&2
    continue
  fi

  OTHER_ASSIGNEES=$(echo "$INFO" | jq -r --arg u "$USER" '[.assignees[].login] | map(select(. != $u)) | join(", ")')
  if [ -n "$OTHER_ASSIGNEES" ]; then
    echo "⚠ #$n ya está asignado a $OTHER_ASSIGNEES, se salta (no se le quita el dueño)" >&2
    continue
  fi

  gh issue edit "$n" --add-assignee "$USER"
  echo "✓ #$n → $USER"
done
