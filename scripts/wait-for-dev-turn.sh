#!/usr/bin/env bash
# Pide turno en `seadragons-dev` y espera hasta que le toque (#507).
#
# `checks.yml` y `visual-baselines.yml` usan la misma base de desarrollo. Con
# dos o tres PR a la vez, más una aceptación de capturas, llegaban a coincidir
# diez jobs contra ella y dev dejaba peticiones sin contestar: tests que se
# agotaban y rondas enteras que había que relanzar.
#
# Un grupo de `concurrency` de GitHub no sirve de cola: deja una corrida en
# marcha y una pendiente, y la siguiente que llega cancela a la pendiente. Por
# eso la cola vive aquí: la corrida espera mientras haya otra ANTERIOR (por
# hora de arranque) de esos workflows que siga abierta y necesite dev. Cada una
# mira sólo a las anteriores, así que la más vieja nunca espera y no hay ciclo.
#
# "Necesita dev" es tener el job `turno-dev` sin saltar. Si ese job aún no
# existe (espera a `arbol-ya-verificado`, o no le ha tocado runner), la corrida
# cuenta como que lo necesita: llegó antes, y dejarla atrás por unos segundos
# de diferencia es justo la coincidencia que esto quiere evitar. Una corrida
# ocupa dev hasta que termina entera, falle o se cancele: entonces deja de
# salir como abierta y la siguiente arranca.
#
# La corrida anterior del mismo PR en el mismo workflow no cuenta: la cancela
# el `cancel-in-progress` del propio workflow y su sitio queda libre.
#
# Usage: scripts/wait-for-dev-turn.sh
# Requires: gh con lectura de actions.
# Entrada:  GH_REPO, GITHUB_RUN_ID, GITHUB_STEP_SUMMARY, GITHUB_SERVER_URL.
# Salida:   0 cuando es su turno; 1 si se agota la espera o no puede leer su
#           propia corrida. Deja en el resumen detrás de quién esperó.

set -uo pipefail

# Una corrida de checks son unos 10 minutos y una visual otros tantos: una hora
# es una cola de varias por delante. Más que eso es que algo se ha quedado
# colgado, y es mejor un rojo que diga detrás de quién que esperar para siempre.
MAX_WAIT_MINUTES="${DEV_TURN_MAX_WAIT_MINUTES:-60}"
# Cada vuelta son dos consultas de la lista y, como mucho, una de jobs: unas
# 180 peticiones por hora por corrida que espera. El GITHUB_TOKEN tiene 1.000
# por hora para todo el repositorio, así que caben cuatro o cinco esperando a
# la vez. Si se pasa, la API deja de contestar y esto acaba fallando por
# tiempo, no arrancando a ciegas.
POLL_SECONDS=60
# El job que pide turno. Si se renombra en los workflows, hay que seguirlo
# aquí: una corrida sin ese job contaría siempre como que necesita dev.
TURN_JOB="turno-dev"
DEV_WORKFLOWS=(
  ".github/workflows/checks.yml"
  ".github/workflows/visual-baselines.yml"
)
# Los estados en los que una corrida ya pidió runner y no ha terminado.
# `action_required` (el push del bot, sin aprobar) y `waiting` quedan fuera:
# pueden pasarse horas así sin usar nada.
OPEN_STATUSES=(in_progress queued)
RUN_FIELDS='"\(.run_started_at) \(.event) \(.head_branch) \(.path)"'

declare -A final_turn_state=()

run_url() {
  echo "${GITHUB_SERVER_URL:-https://github.com}/$GH_REPO/actions/runs/$1"
}

report() {
  echo "$1"
  echo "$1" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
}

give_up() {
  report "$1"
  exit 1
}

is_dev_workflow() {
  local candidate
  for candidate in "${DEV_WORKFLOWS[@]}"; do
    [ "$1" = "$candidate" ] && return 0
  done
  return 1
}

# Imprime una corrida abierta por línea: id, arranque, evento, rama y workflow.
list_open_runs() {
  local status
  for status in "${OPEN_STATUSES[@]}"; do
    gh api "repos/$GH_REPO/actions/runs?status=$status&per_page=100&exclude_pull_requests=true" \
      --jq ".workflow_runs[] | \"\\(.id) \" + $RUN_FIELDS" || return 1
  done
}

# Deja en `turn_state` cómo va el job de turno de una corrida: `skipped`,
# `success`, `in_progress`, `absent` si aún no existe... Un estado terminado no
# cambia mientras la corrida siga abierta, así que se guarda y no se vuelve a
# pedir. Variable global y no salida: en una subshell se perdería lo guardado.
# Si la API falla, `unknown` cuenta como que va delante, y el error queda en
# el log del job.
read_turn_state() {
  local id="$1" started="$2" key="$1@$2"
  turn_state="${final_turn_state[$key]:-}"
  [ -n "$turn_state" ] && return
  if ! turn_state=$(gh api "repos/$GH_REPO/actions/runs/$id/jobs?per_page=100" \
    --jq "[.jobs[] | select(.name == \"$TURN_JOB\") | .conclusion // .status] | .[0] // \"absent\""); then
    echo "No pude leer los jobs de la corrida $id: cuenta como que va delante." >&2
    turn_state="unknown"
  fi
  case "$turn_state" in
    success | failure | cancelled | skipped) final_turn_state[$key]="$turn_state" ;;
  esac
}

# ¿Llegó la primera antes que la segunda? Cada una es "arranque id".
arrived_earlier() {
  local first_started first_id second_started second_id
  read -r first_started first_id <<< "$1"
  read -r second_started second_id <<< "$2"
  [[ "$first_started" < "$second_started" ]] && return 0
  [ "$first_started" = "$second_started" ] && [ "$first_id" -lt "$second_id" ]
}

is_my_previous_run() {
  local event="$1" branch="$2" workflow="$3"
  [ "$my_event" = "pull_request" ] && [ "$event" = "pull_request" ] &&
    [ "$branch" = "$my_branch" ] && [ "$workflow" = "$my_workflow" ]
}

# Imprime "arranque id" de cada corrida abierta de un workflow de dev que
# llegó antes que ésta, sin contar su propia corrida anterior del mismo PR.
earlier_dev_runs() {
  local id started event branch workflow
  while read -r id started event branch workflow; do
    [ -z "$id" ] && continue
    is_dev_workflow "$workflow" || continue
    arrived_earlier "$started $id" "$my_started $GITHUB_RUN_ID" || continue
    is_my_previous_run "$event" "$branch" "$workflow" && continue
    echo "$started $id"
  done <<< "$1"
}

# Deja en `blocker` la corrida más vieja que va delante y necesita dev, o
# vacío si no hay ninguna. Se ordena a mano y no con `sort`: en Git Bash el
# PATH de Windows puede dar con el sort.exe de System32.
find_blocker() {
  local -a candidates
  local oldest index started id
  mapfile -t candidates < <(earlier_dev_runs "$1")
  blocker=""
  while [ "${#candidates[@]}" -gt 0 ]; do
    oldest=0
    for index in "${!candidates[@]}"; do
      arrived_earlier "${candidates[$index]}" "${candidates[$oldest]}" &&
        oldest="$index"
    done
    read -r started id <<< "${candidates[$oldest]}"
    candidates=("${candidates[@]:0:oldest}" "${candidates[@]:oldest+1}")
    read_turn_state "$id" "$started"
    [ "$turn_state" = "skipped" ] && continue
    blocker="$id"
    return
  done
}

my_run=$(gh api "repos/$GH_REPO/actions/runs/$GITHUB_RUN_ID" --jq "$RUN_FIELDS" 2>/dev/null)
read -r my_started my_event my_branch my_workflow <<< "$my_run"
if [ -z "${my_workflow:-}" ]; then
  give_up "No pude leer la corrida $GITHUB_RUN_ID en la API de Actions: sin saber cuándo llegó, no sé a quién tengo delante en seadragons-dev."
fi

waited_seconds=0
reported_blocker=""
while true; do
  if runs=$(list_open_runs); then
    find_blocker "$runs"
    if [ -z "$blocker" ]; then
      report "Turno en seadragons-dev tras $((waited_seconds / 60)) min de espera: nadie delante."
      exit 0
    fi
    waiting_for="la corrida $(run_url "$blocker")"
  else
    waiting_for="una respuesta de la API de Actions, que no contesta"
  fi

  if [ "$waited_seconds" -ge $((MAX_WAIT_MINUTES * 60)) ]; then
    give_up "Llevo $MAX_WAIT_MINUTES min esperando turno en seadragons-dev, detrás de $waiting_for. Me rindo: relanza cuando dev quede libre, o mira si esa corrida se quedó colgada."
  fi
  if [ "$waiting_for" != "$reported_blocker" ]; then
    report "Esperando turno en seadragons-dev, detrás de $waiting_for."
    reported_blocker="$waiting_for"
  fi

  sleep "$POLL_SECONDS"
  waited_seconds=$((waited_seconds + POLL_SECONDS))
done
