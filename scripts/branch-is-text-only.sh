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

# Cada patrón, ya en expresión regular, con su efecto al coincidir: 0 si
# incluye (es texto) y 1 si excluye.
REGEXES=()
EFFECTS=()
while IFS= read -r line; do
  line="${line%$'\r'}"
  [ -z "$line" ] && continue
  [ "${line:0:1}" = "#" ] && continue
  if [ "${line:0:1}" = "$EXCLUSION_PREFIX" ]; then
    REGEXES+=("$(glob_to_regex "${line:1}")")
    EFFECTS+=(1)
  else
    REGEXES+=("$(glob_to_regex "$line")")
    EFFECTS+=(0)
  fi
done <"$PATHS_FILE"
readonly REGEXES EFFECTS

# Gana el último patrón que coincide, como en el `paths` de Actions.
is_text_file() {
  local file="$1" index is_text=1
  for index in "${!REGEXES[@]}"; do
    [[ "$file" =~ ${REGEXES[$index]} ]] && is_text="${EFFECTS[$index]}"
  done
  return "$is_text"
}

# `--no-renames` porque un renombrado se listaría solo por su ruta nueva: mover
# src/a.ts a docs/ también borra código.
if ! CHANGED=$(git diff --no-renames --name-only origin/main...HEAD 2>/dev/null); then
  exit 1
fi
[ -z "$CHANGED" ] && exit 1

while IFS= read -r file; do
  is_text_file "$file" || exit 1
done <<<"$CHANGED"
exit 0
