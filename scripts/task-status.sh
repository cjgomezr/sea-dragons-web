#!/usr/bin/env bash
# Sets the Projects v2 board Status for the item linked to an issue.
# Stateless: looks the item up from the issue side (adds it to the board if
# missing), so no task-map file is needed and re-runs are idempotent.
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

# One query per issue instead of listing the whole board: its cost does not
# grow with the board. Placeholders {owner}/{repo} are filled by gh from the
# local git remote, so no extra API call is spent resolving the repo.
ISSUE_QUERY='query ($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      url
      projectItems(first: 10) { nodes { id project { id } } }
    }
  }
}'

GH_STDERR=$(mktemp)
trap 'rm -f "$GH_STDERR"' EXIT

LOOKUP_STATUS=0
RESPONSE=$(gh api graphql -F owner='{owner}' -F repo='{repo}' -F number="$ISSUE" \
  -f query="$ISSUE_QUERY" 2>"$GH_STDERR") || LOOKUP_STATUS=$?

# gh api graphql sometimes exits 0 with the rate-limit error inside the body.
# Going on would read "no card" and add a duplicate, so the body decides.
if grep -qiE 'RATE_LIMIT|rate limit' <<<"$RESPONSE$(cat "$GH_STDERR")"; then
  echo "GitHub GraphQL rate limit hit while looking up #$ISSUE; board not updated. Retry once the limit resets (gh api rate_limit)." >&2
  exit 1
fi

LOOKUP_ERRORS=$(jq -r '.errors // [] | map(.message) | join("; ")' <<<"$RESPONSE" 2>/dev/null) \
  || LOOKUP_ERRORS="unreadable response: $RESPONSE"
if [ "$LOOKUP_STATUS" -ne 0 ] || [ -n "$LOOKUP_ERRORS" ]; then
  echo "Could not look up #$ISSUE on GitHub: ${LOOKUP_ERRORS:-$(cat "$GH_STDERR")}" >&2
  exit 1
fi

ISSUE_URL=$(jq -r '.data.repository.issue.url // empty' <<<"$RESPONSE")
[ -n "$ISSUE_URL" ] || {
  echo "Could not look up #$ISSUE on GitHub: unexpected response: ${RESPONSE:-<empty>}" >&2
  exit 1
}
ITEM_ID=$(jq -r --arg project "$PROJECT_ID" \
  '.data.repository.issue.projectItems.nodes[] | select(.project.id == $project) | .id' \
  <<<"$RESPONSE" | head -n1)

if [ -z "$ITEM_ID" ]; then
  ITEM_ID=$(gh project item-add "$NUMBER" --owner "$OWNER" --url "$ISSUE_URL" --format json | jq -r .id)
fi

gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_ID" --single-select-option-id "$OPTION_ID" > /dev/null

echo "✓ #$ISSUE → $STATUS"
