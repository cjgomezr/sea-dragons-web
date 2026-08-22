#!/usr/bin/env bash
# One-time per repo: discovers the GitHub Projects v2 IDs (project, Status field,
# status options) and caches them in .plan/project.json so the agent never has
# to touch GraphQL node IDs again.
#
# Usage:
#   bash scripts/project-setup.sh <owner> <project-number>          # user project
#   bash scripts/project-setup.sh <owner> <project-number> --org    # org project
#
# Requires: gh (with the 'project' scope!), jq.

set -euo pipefail

OWNER="${1:?usage: project-setup.sh <owner> <project-number> [--org]}"
NUMBER="${2:?usage: project-setup.sh <owner> <project-number> [--org]}"
SCOPE_TYPE="user"; [ "${3:-}" = "--org" ] && SCOPE_TYPE="organization"

# Classic 403 trap: the 'project' scope is separate and easy to miss.
if ! gh auth status 2>&1 | grep -qE "['\", ]project"; then
  echo "⚠ Your gh token seems to lack the 'project' scope. Run:" >&2
  echo "    gh auth refresh -s project,repo" >&2
  exit 1
fi

QUERY='query($owner:String!,$number:Int!){ '"$SCOPE_TYPE"'(login:$owner){ projectV2(number:$number){ id title fields(first:30){ nodes{ ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }'
JSON=$(gh api graphql -f query="$QUERY" -f owner="$OWNER" -F number="$NUMBER")

PROJECT_ID=$(echo "$JSON" | jq -r ".data.$SCOPE_TYPE.projectV2.id")
TITLE=$(echo "$JSON" | jq -r ".data.$SCOPE_TYPE.projectV2.title")
STATUS_FIELD=$(echo "$JSON" | jq ".data.$SCOPE_TYPE.projectV2.fields.nodes[] | select(.name==\"Status\")")

[ -n "$PROJECT_ID" ] && [ "$PROJECT_ID" != "null" ] || { echo "Project #$NUMBER not found for $SCOPE_TYPE '$OWNER'." >&2; exit 1; }
[ -n "$STATUS_FIELD" ] || { echo "No 'Status' single-select field found on the project." >&2; exit 1; }

mkdir -p .plan
jq -n \
  --arg owner "$OWNER" \
  --argjson number "$NUMBER" \
  --arg projectId "$PROJECT_ID" \
  --arg statusFieldId "$(echo "$STATUS_FIELD" | jq -r .id)" \
  --argjson statusOptions "$(echo "$STATUS_FIELD" | jq '[.options[] | {(.name): .id}] | add')" \
  '{owner:$owner, projectNumber:$number, projectId:$projectId, statusFieldId:$statusFieldId, statusOptions:$statusOptions}' \
  > .plan/project.json

echo "✓ Cached .plan/project.json for \"$TITLE\" (#$NUMBER, $OWNER)"
echo "  Statuses: $(jq -r '.statusOptions | keys | join(", ")' .plan/project.json)"
echo ""
echo "Now enable these built-in workflows ONCE in the Project UI (⚙ → Workflows):"
echo "  • Item added to project  → Todo"
echo "  • Item closed            → Done"
echo "  • Pull request merged    → Done"
echo "And group the board view by 'Parent issue' to see epics with rollup bars."
echo "With that, the agent only ever writes 'In Progress'. GitHub handles the rest."
