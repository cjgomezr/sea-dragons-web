#!/usr/bin/env bash
# Quita la etiqueta blocked-by-N de todo issue ABIERTO que la tenga, una vez
# que el issue N cerró. labels-cleanup.yml limpia las etiquetas de cola del
# issue que se cierra pero nunca tocaba a sus dependientes: las blocked-by-N
# se acumulaban apuntando a issues ya cerrados y hacían ver atascado a un
# ticket que en realidad estaba libre (#44).
#
# Un dependiente que falla no cancela a los demás. Abortar a medias dejaría
# exactamente el estado que este script existe para evitar, y con menos
# pistas: unos limpios, otros no, y nadie volviendo a intentarlo. Se limpian
# todos los que se pueda y se sale con error si alguno falló, para que la
# corrida quede en rojo y un humano lo mire.
#
# Usage: scripts/clear-blockers.sh <issue-number>
#
# Requires: gh. Respeta GH_REPO si está definida; si no, infiere el
# repositorio del remoto del directorio actual.

set -euo pipefail

N="${1:?usage: clear-blockers.sh <issue-number>}"
LABEL="blocked-by-$N"

# --limit explícito: gh trae 30 por defecto y truncaría en silencio,
# diciendo que terminó cuando quedaron dependientes sin tocar.
#
# El `tr -d '\r'` es tolerancia, no un arreglo: el --jq interno de gh usa
# gojq y emite LF en todas las plataformas. Lo que sí rompía en Windows era
# pipear a un jq externo (#39). Se queda por si alguien reintroduce ese pipe.
DEPENDENTS=$(gh issue list --label "$LABEL" --state open --limit 1000 --json number --jq '.[].number' | tr -d '\r')

failed=0
for issue in $DEPENDENTS; do
  if gh issue edit "$issue" --remove-label "$LABEL" >/dev/null; then
    echo "✓ #$issue: quitada $LABEL"
  else
    echo "✗ #$issue: no se pudo quitar $LABEL" >&2
    failed=1
  fi
done

exit "$failed"
