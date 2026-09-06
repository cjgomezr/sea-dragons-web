#!/usr/bin/env bash
# Quita la etiqueta blocked-by-N de todo issue ABIERTO que la tenga, una vez
# que el issue N cerró. labels-cleanup.yml limpia las etiquetas de cola del
# issue que se cierra pero nunca tocaba a sus dependientes: las blocked-by-N
# se acumulaban apuntando a issues ya cerrados y hacían ver atascado a un
# ticket que en realidad estaba libre (#44).
#
# Usage: scripts/clear-blockers.sh <issue-number>
#
# Requires: gh.

set -euo pipefail

N="${1:?usage: clear-blockers.sh <issue-number>}"
LABEL="blocked-by-$N"

# El jq externo en Windows emite CRLF: si el issue trae un \r pegado, el
# argumento de `gh issue edit` sale roto (mismo bug del #39).
DEPENDENTS=$(gh issue list --label "$LABEL" --state open --json number --jq '.[].number' | tr -d '\r')

for issue in $DEPENDENTS; do
  gh issue edit "$issue" --remove-label "$LABEL" >/dev/null
  echo "✓ #$issue: quitada $LABEL"
done
