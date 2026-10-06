#!/usr/bin/env bash
# Responde una sola pregunta en un `pull_request` `synchronize`: ¿lo único que
# trae el empujón son líneas base de Linux, y el commit anterior ya pasó en
# verde la suite del workflow que pregunta? Lo usan `checks.yml` y
# `migrations.yml` (#494).
#
# Al aceptar capturas, `visual-baselines.yml` sube a la rama del PR un commit
# del bot que solo trae PNG de `tests/ui.spec.ts-snapshots/`. Ese commit
# volvía a disparar la suite entera sobre un código idéntico al que se acababa
# de dejar en verde. Es la misma idea que `checks-already-green-on-pr.sh`
# aplica al push a main, llevada a los pull requests.
#
# Falla hacia el lado caro, igual que su hermano. Cualquier duda (un push
# forzado, un commit anterior sin corrida verde, una respuesta que no llega, un
# diff que no se puede leer entero) responde "no" y deja que la suite corra.
#
# Un salto de aquí deja una corrida de PR en `success`, y el push a main
# (`checks-already-green-on-pr.sh`) la acepta como prueba del árbol. Eso solo
# es seguro porque abajo se exige que el commit anterior corriera la suite de
# verdad: no relajes esa comprobación sin cambiar también aquel script.
#
# Usage: scripts/baselines-only-after-green.sh
# Requires: gh con lectura de contents y de actions, y jq.
# Entrada:  GH_REPO, BEFORE_SHA (`github.event.before`), HEAD_SHA (la cabeza
#           nueva del PR), WORKFLOW_FILE (el workflow cuya corrida verde se
#           busca) y HEAVY_JOB (el job que corre la suite en ese workflow).
# Salida:   `ya_verificado=true|false` en $GITHUB_OUTPUT, y el motivo en el
#           resumen del job ($GITHUB_STEP_SUMMARY).

set -uo pipefail

# Las únicas rutas que un salto admite: capturas de Linux en el directorio de
# líneas base, que son las que el commit del bot sube. Una de Windows o de
# macOS no la sube nadie a propósito, y su presencia ya es motivo de mirar.
readonly BASELINE_PATTERN='^tests/ui\.spec\.ts-snapshots/[^/]+-linux\.png$'

# La API de comparación devuelve como mucho 300 archivos. Con esa cifra no se
# puede saber si la lista está entera, así que no se puede afirmar nada de ella.
readonly COMPARE_FILES_LIMIT=300

readonly SHA_PATTERN='^[0-9a-f]{40}$'
readonly NULL_SHA='0000000000000000000000000000000000000000'

responde() {
  local veredicto="$1" motivo="$2"
  echo "$motivo"
  echo "$motivo" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  echo "ya_verificado=$veredicto" >> "${GITHUB_OUTPUT:-/dev/stdout}"
  exit 0
}

# `gh --jq` emite CRLF en Windows: sin quitarlo, ninguna comparación de texto
# encajaría fuera de CI.
consulta() {
  local respuesta
  respuesta=$(gh api "$1" --jq "$2" 2>/dev/null) || return 1
  printf '%s\n' "$respuesta" | tr -d '\r'
}

before="${BEFORE_SHA:-}"
head_sha="${HEAD_SHA:-}"

if ! [[ "$before" =~ $SHA_PATTERN ]] || [ "$before" = "$NULL_SHA" ] ||
  ! [[ "$head_sha" =~ $SHA_PATTERN ]]; then
  responde false "No hay un commit anterior con el que comparar: la suite corre entera."
fi

# Primera línea: el estado de la comparación. Segunda: cuántos archivos trae.
# El resto: cada ruta tocada, y la de origen de un rename, que también cambia
# el árbol aunque el nombre nuevo encaje.
comparacion=$(
  consulta "repos/$GH_REPO/compare/$before...$head_sha" \
    '.status, (.files | length), (.files[] | .filename, (.previous_filename // empty))'
) || responde false "No pude comparar $before con $head_sha: la suite corre entera."

estado=$(sed -n 1p <<< "$comparacion")
total_de_archivos=$(sed -n 2p <<< "$comparacion")
rutas=$(sed -n '3,$p' <<< "$comparacion")

# `ahead` es lo único que garantiza que el commit anterior es antepasado del
# nuevo. Un push forzado deja `diverged`, y entonces el árbol que pasó en verde
# no tiene nada que ver con el de ahora.
if [ "$estado" != "ahead" ]; then
  responde false "$before no es antepasado de $head_sha ($estado): la suite corre entera."
fi

if ! [ "$total_de_archivos" -gt 0 ] 2>/dev/null ||
  [ "$total_de_archivos" -ge "$COMPARE_FILES_LIMIT" ]; then
  responde false "No pude leer entera la lista de archivos del empujón ($total_de_archivos): la suite corre entera."
fi

if grep -Ev "$BASELINE_PATTERN" <<< "$rutas" | grep -q .; then
  responde false "El empujón toca algo más que líneas base de Linux: la suite corre entera."
fi

# `event=pull_request` deja fuera las corridas de main. `head_sha` es el commit
# anterior exacto: una corrida verde de otro commit no dice nada de este árbol.
corridas_verdes=$(
  consulta "repos/$GH_REPO/actions/workflows/$WORKFLOW_FILE/runs?event=pull_request&head_sha=$before" \
    '.workflow_runs[] | select(.conclusion == "success") | .id'
) || responde false "No pude leer las corridas de $WORKFLOW_FILE sobre $before: la suite corre entera."

# Un job saltado por `if:` deja el workflow en `success`, y eso es justo lo que
# este script produce cuando responde que sí. Por eso la prueba es la
# conclusión del job que corre la suite, no la del workflow: si no, dos
# aceptaciones seguidas encadenarían saltos sin que nadie corriera nunca la
# suite sobre el código.
for corrida in $corridas_verdes; do
  suites_verdes=$(
    consulta "repos/$GH_REPO/actions/runs/$corrida/jobs" \
      "[.jobs[] | select(.name == \"$HEAVY_JOB\" and .conclusion == \"success\")] | length"
  ) || responde false "No pude leer los jobs de la corrida $corrida: la suite corre entera."

  if [ "$suites_verdes" -gt 0 ] 2>/dev/null; then
    responde true "El empujón solo trae líneas base de Linux y el commit anterior $before ya pasó $WORKFLOW_FILE en verde: ${GITHUB_SERVER_URL:-https://github.com}/$GH_REPO/actions/runs/$corrida. La suite no se repite."
  fi
done

responde false "El commit anterior $before nunca pasó la suite de $WORKFLOW_FILE en verde: corre entera."
