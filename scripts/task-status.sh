#!/usr/bin/env bash
# Sets the Projects v2 board Status for the item linked to an issue.
# Stateless: looks the item up by issue URL (adds it to the board if missing),
# so no task-map file is needed and re-runs are idempotent.
#
# Usage: bash scripts/task-status.sh <issue-number> "In Progress"
# No-op (exit 0) when .plan/project.json doesn't exist, so repos without a
# board can share the same CLAUDE.md lifecycle.
#
# Requires: gh (with 'project' scope), jq.

set -euo pipefail

ISSUE="${1:?usage: task-status.sh <issue-number> <status>}"
STATUS="${2:?usage: task-status.sh <issue-number> <status>}"
CFG=".plan/project.json"

[ -f "$CFG" ] || { echo "No $CFG, board update skipped (run scripts/project-setup.sh to enable)."; exit 0; }

OWNER=$(jq -r .owner "$CFG")
NUMBER=$(jq -r .projectNumber "$CFG")
PROJECT_ID=$(jq -r .projectId "$CFG")
FIELD_ID=$(jq -r .statusFieldId "$CFG")
OPTION_ID=$(jq -r --arg s "$STATUS" '.statusOptions[$s] // empty' "$CFG")

[ -n "$OPTION_ID" ] || {
  echo "Unknown status '$STATUS'. Known: $(jq -r '.statusOptions | keys | join(", ")' "$CFG")" >&2
  exit 1
}

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
ISSUE_URL="https://github.com/$REPO/issues/$ISSUE"

ITEM_ID=$(gh project item-list "$NUMBER" --owner "$OWNER" --format json --limit 500 \
  | jq -r --arg url "$ISSUE_URL" '.items[] | select(.content.url==$url) | .id' | head -n1)

if [ -z "$ITEM_ID" ]; then
  ITEM_ID=$(gh project item-add "$NUMBER" --owner "$OWNER" --url "$ISSUE_URL" --format json | jq -r .id)
fi

gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_ID" --single-select-option-id "$OPTION_ID" > /dev/null

echo "✓ #$ISSUE → $STATUS"
