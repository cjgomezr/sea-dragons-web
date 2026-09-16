#!/usr/bin/env bash
# Responde una sola pregunta: ¿el árbol que este push deja en `main` es el
# mismo que ya pasó los checks en verde en su pull request?
#
# La fábrica mergea con squash un PR que se rebasó sobre main y salió verde, así
# que el commit que aterriza en main casi siempre tiene un SHA nuevo y un ÁRBOL
# idéntico al que se acaba de comprobar. Volver a correr la suite entera sobre
# ese mismo árbol cuesta ocho minutos de Actions y no puede descubrir nada.
#
# Se compara el árbol y no el SHA a propósito: el SHA cambia siempre (el squash
# reescribe el commit), y el árbol es lo único que los tests ven.
#
# Falla hacia el lado caro. Cualquier duda (un push directo sin PR, una
# respuesta que no llega, un PR que ya no está, un merge que no fue squash
# limpio) responde "no" y deja que los checks corran. Perder un minuto es
# recuperable; dar por comprobado un árbol que nadie comprobó, no.
#
# Usage: scripts/checks-already-green-on-pr.sh
# Requires: gh con lectura de pull-requests y de actions.
# Entrada:  GH_REPO, GITHUB_SHA, HEAD_COMMIT_MESSAGE (el mensaje del commit
#           empujado, que el workflow pasa desde el evento).
# Salida:   `ya_verificado=true|false` en $GITHUB_OUTPUT.

set -uo pipefail

# El workflow cuya corrida verde estamos buscando. Si se renombra el archivo,
# esto tiene que seguirlo: una consulta a un workflow inexistente devuelve cero
# corridas, y cero corridas es "no", que es seguro pero deja de ahorrar.
CHECKS_WORKFLOW="checks.yml"

responde() {
  local veredicto="$1" motivo="$2"
  echo "$motivo"
  echo "ya_verificado=$veredicto" >> "${GITHUB_OUTPUT:-/dev/stdout}"
  exit 0
}

# GitHub escribe el número del PR al final de la primera línea del mensaje de
# un squash: "Título (#176)". Los squash de esta fábrica arrastran además el
# `(#N)` del commit original ("Título (#174) (#176)"), así que hay que quedarse
# con el ÚLTIMO, que es el PR que se acaba de mergear.
numero_de_pr=$(
  printf '%s\n' "${HEAD_COMMIT_MESSAGE:-}" |
    head -1 |
    sed -n 's/.*(#\([0-9][0-9]*\))[[:space:]]*$/\1/p'
)

if [ -z "$numero_de_pr" ]; then
  responde false "El commit no viene del squash de un pull request: hay que comprobarlo entero."
fi

cabeza_del_pr=$(gh api "repos/$GH_REPO/pulls/$numero_de_pr" --jq '.head.sha' 2>/dev/null)

if [ -z "$cabeza_del_pr" ]; then
  responde false "No pude leer el PR #$numero_de_pr: no hay con qué comparar."
fi

arbol_de() {
  gh api "repos/$GH_REPO/commits/$1" --jq '.commit.tree.sha' 2>/dev/null
}

arbol_en_main=$(arbol_de "$GITHUB_SHA")
arbol_del_pr=$(arbol_de "$cabeza_del_pr")

if [ -z "$arbol_en_main" ] || [ -z "$arbol_del_pr" ]; then
  responde false "No pude leer los árboles de los dos commits: no hay con qué comparar."
fi

if [ "$arbol_en_main" != "$arbol_del_pr" ]; then
  responde false "El merge trae un árbol distinto al del PR #$numero_de_pr: hay que comprobarlo."
fi

# Que el árbol sea el mismo no basta: hace falta que ese árbol saliera verde.
# Sin branch protection (plan gratuito, repositorio privado) se puede mergear un
# PR con el check en rojo, o antes de que termine.
#
# `event=pull_request` no es adorno: una corrida cuyo único job quedó `skipped`
# también concluye `success`, y a partir de este cambio eso es justo lo que este
# workflow produce en `main`. Sin el filtro, una corrida saltada podría contar
# como prueba de que el árbol pasó, que es la única forma de que esto mienta.
corridas_verdes=$(
  gh api "repos/$GH_REPO/actions/workflows/$CHECKS_WORKFLOW/runs?event=pull_request&head_sha=$cabeza_del_pr" \
    --jq '[.workflow_runs[] | select(.conclusion == "success")] | length' 2>/dev/null
)

if [ "${corridas_verdes:-0}" -gt 0 ] 2>/dev/null; then
  responde true "Este árbol ya pasó los checks en verde en el PR #$numero_de_pr: no se repiten."
fi

responde false "El árbol del PR #$numero_de_pr nunca pasó los checks en verde: hay que comprobarlo."
