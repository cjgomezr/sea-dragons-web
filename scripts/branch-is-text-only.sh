#!/usr/bin/env bash
# ¿Cambió esta rama, respecto a origin/main, solo archivos de texto? Sale 0 si
# sí y 1 si no. Lo usa `checks` en un pull request para no correr los tests de
# red cuando el PR solo cambia documentos, tickets o skills (#439).
#
# Solo cuenta lo commiteado: en CI no hay otra cosa. Si no se puede averiguar
# la diferencia (sin origin/main, clon superficial) o la rama no cambia nada,
# responde que no: ante la duda, todo corre.

set -o pipefail

PATHS_FILE="$(dirname "$0")/../.github/text-only-paths.txt"
readonly PATHS_FILE
readonly EXCLUSION_PREFIX="!"

# El glob de Actions en expresión regular: `**/` vale cero o más directorios,
# `**` cruza `/` y `*` no. Las marcas intermedias evitan que el último paso se
# coma la mitad de cada `**`.
glob_to_regex() {
  local regex
  regex=$(sed -e 's/[.+^$(){}|]/\\&/g' \
    -e 's/\*\*\//@@DIRECTORIOS@@/g' \
    -e 's/\*\*/@@DOBLE@@/g' \
    -e 's/\*/[^\/]*/g' \
    -e 's/@@DIRECTORIOS@@/(.*\/)?/g' \
    -e 's/@@DOBLE@@/.*/g' <<<"$1")
  echo "^${regex}$"
}

PATTERNS=()
while IFS= read -r line; do
  line="${line%$'\r'}"
  [ -z "$line" ] && continue
  [ "${line:0:1}" = "#" ] && continue
  PATTERNS+=("$line")
done <"$PATHS_FILE"
readonly PATTERNS

# Gana el último patrón que coincide, como en el `paths` de Actions.
is_text_file() {
  local file="$1" pattern is_text=1
  for pattern in "${PATTERNS[@]}"; do
    if [ "${pattern:0:1}" = "$EXCLUSION_PREFIX" ]; then
      [[ "$file" =~ $(glob_to_regex "${pattern:1}") ]] && is_text=1
    else
      [[ "$file" =~ $(glob_to_regex "$pattern") ]] && is_text=0
    fi
  done
  return "$is_text"
}

if ! CHANGED=$(git diff --name-only origin/main...HEAD 2>/dev/null); then
  exit 1
fi
[ -z "$CHANGED" ] && exit 1

while IFS= read -r file; do
  is_text_file "$file" || exit 1
done <<<"$CHANGED"
exit 0
