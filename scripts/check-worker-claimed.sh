#!/usr/bin/env bash
# ¿Dejó el worker algún rastro en este issue, o salió sin tocarlo?
#
# Existe por lo que pasó el 11 de septiembre de 2026. La primera corrida real
# de `claude-backlog.yml` terminó en verde sin hacer nada: 74 segundos, 18
# turnos, `permission_denials_count: 11`, y el issue #140 exactamente igual que
# antes. El único aviso del workflow colgaba de `failure()`, así que nadie se
# enteró y la cola parecía procesada.
#
# La pregunta NO es "¿sigue con la etiqueta `pending`?". Medir la ausencia de
# un marcador de entrada da las dos respuestas equivocadas:
#
#   - Falso negativo, el peor: el reintento que el propio workflow documenta
#     consiste en volver a poner `ready-for-dev`, y para entonces el issue lleva
#     `needs-human`, no `pending`. Justo en el segundo intento el guardia sería
#     ciego.
#   - Falso positivo: un issue cerrado por idempotencia conserva `pending` unos
#     segundos, porque quien la quita es `labels-cleanup.yml`, otro workflow que
#     tarda en encolarse.
#
# Así que se mide evidencia de trabajo, igual que `check_worker_left_no_pr` en
# `scripts/process-backlog.sh`, que es el precedente de este repositorio.
#
# Uso:  scripts/check-worker-claimed.sh <número de issue>
# Sale 0 si el worker dejó rastro (o si no se pudo comprobar), 1 si no lo dejó.

set -uo pipefail

NUM="${1:-}"
[ -n "$NUM" ] || { echo "uso: $0 <número de issue>" >&2; exit 2; }

# Sin `set -e`, un `jq` ausente dejaría las variables vacías, el script no se
# enteraría y acabaría acusando al worker de algo que no hizo. Es el mismo
# "no pude comprobar" que el resto del archivo trata con cuidado.
command -v jq >/dev/null || {
  echo "::warning title=Falta jq::no puedo comprobar #$NUM, así que no marco la corrida en rojo"
  exit 0
}

repo_args=()
[ -n "${GITHUB_REPOSITORY:-}" ] && repo_args=(--repo "$GITHUB_REPOSITORY")

# Un fallo de `gh` (rate limit, 502) no es culpa del worker. Marcar la corrida
# en rojo por no haber podido preguntar acaba pegándole `needs-human` a un
# ticket sano, y el repositorio ya decidió lo contrario en `pr_declares_closes`.
if ! info=$(gh issue view "$NUM" "${repo_args[@]}" --json state,labels 2>/dev/null); then
  echo "::warning title=No pude comprobar #$NUM::gh falló al consultarlo, así que no marco la corrida en rojo por eso"
  exit 0
fi

state=$(printf '%s' "$info" | jq -r .state)
if [ "$state" = "CLOSED" ]; then
  echo "✅ #$NUM quedó cerrado: el worker lo resolvió o lo encontró ya implementado"
  exit 0
fi

labels=$(printf '%s' "$info" | jq -r '.labels[].name')

# Los tres finales legítimos que dejan el issue abierto. `blocked-by-*` incluido
# a propósito: el ciclo de vida manda devolver el ticket a `pending` con esa
# etiqueta cuando main está roto, y añadirle `needs-human` encima contradiría el
# estado que el worker acaba de dejar queriendo.
#
# Esta exención mide estado absoluto, no lo que cambió durante la corrida, así
# que asume que quien reintenta deja el ticket como estaba: sin `needs-human` ni
# `in-progress`. Si se reintenta con esas etiquetas puestas, este guardia sale 0
# aunque el worker no toque nada. Por eso el comentario de reintento que deja
# `claude-backlog.yml` da los comandos exactos en vez de decir solo "vuelve a
# poner la etiqueta".
while read -r label; do
  case "$label" in
    in-progress|needs-human|blocked-by-*)
      echo "✅ #$NUM lleva '$label': el worker llegó a dejar rastro"
      exit 0
      ;;
  esac
done <<< "$labels"

# Último recurso, y el más caro, por eso va al final: un PR que declare cerrarlo
# significa que el trabajo existe aunque las etiquetas digan otra cosa. Buscar
# por rama no serviría, porque `impl-N` y `worktree-impl-N` conviven.
if prs=$(gh pr list "${repo_args[@]}" --state all --search "Closes #$NUM in:body" --json number --jq length 2>/dev/null); then
  if [ "${prs:-0}" != "0" ]; then
    echo "✅ #$NUM ya tiene un PR que declara cerrarlo"
    exit 0
  fi
else
  echo "::warning title=No pude buscar PRs de #$NUM::gh falló, así que no marco la corrida en rojo por eso"
  exit 0
fi

echo "::error title=El worker salió sin tocar el issue::#$NUM sigue abierto, sin 'in-progress', sin 'needs-human', sin bloqueo y sin ningún PR que declare cerrarlo"
exit 1
