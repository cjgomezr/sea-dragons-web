# reconcile_epic <owner/repo> <epic-number>
#
# Compara el estado de una épica con el de sus sub-issues y la deja donde
# corresponde: la cierra si ya no le queda ninguno abierto, la reabre si le
# llegó uno nuevo o reabierto. No hace nada si ya coincide, para que la
# barrida periódica (scripts/reconcile-all-epics.sh) no comente en cada
# pasada.
#
# Nunca se ejecuta sola: se hace `source` desde scripts/reconcile-epic.sh,
# scripts/sync-epic-status.sh, scripts/reconcile-all-epics.sh y
# scripts/file-incident.sh. Falla del lado seguro: si la consulta a `gh`
# falla, no cierra ni reabre nada.
#
# Requires: gh, jq.

reconcile_epic() {
  local repo="$1" epic="$2" owner name json state total completed

  owner="${repo%%/*}"
  name="${repo##*/}"

  json=$(gh api graphql -f query='
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        issue(number: $number) {
          state
          subIssuesSummary { total completed }
        }
      }
    }' -f owner="$owner" -f name="$name" -F number="$epic") || return 1

  state=$(jq -r '.data.repository.issue.state' <<<"$json")
  total=$(jq -r '.data.repository.issue.subIssuesSummary.total' <<<"$json")
  completed=$(jq -r '.data.repository.issue.subIssuesSummary.completed' <<<"$json")

  case "$total" in
    '' | null | *[!0-9]*) return 0 ;;
  esac
  [ "$total" -gt 0 ] || return 0

  if [ "$state" = "OPEN" ] && [ "$completed" -eq "$total" ]; then
    gh issue close "$epic" \
      --comment "Cierro esta épica: sus $total sub-issues están cerrados." \
      >/dev/null
    echo "✓ #$epic: épica cerrada ($total/$total sub-issues)"
  elif [ "$state" = "CLOSED" ] && [ "$completed" -lt "$total" ]; then
    gh issue reopen "$epic" >/dev/null
    echo "✓ #$epic: épica reabierta ($completed/$total sub-issues cerrados)"
  fi
}
