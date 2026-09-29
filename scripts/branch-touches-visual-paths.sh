#!/usr/bin/env bash
# ¿Cambió esta rama, respecto a origin/main, algún archivo que pueda mover una
# captura? Sale 0 si sí y 1 si no. Lo usa el Stop gate para no correr
# Playwright en una rama de documentos o de migraciones (#415): el PR lo corre
# igual en CI.
#
# Cuentan también los cambios sin commitear y los archivos nuevos: el gate
# corre al final del turno y el trabajo puede no estar commiteado todavía.
# Si no se puede averiguar la diferencia (sin origin/main), responde que sí:
# ante la duda, Playwright corre.

set -o pipefail

PATHS_FILE="$(dirname "$0")/../.github/visual-paths.txt"
readonly PATHS_FILE

# El glob de Actions en expresión regular: `**` cruza `/`, `*` no. La marca
# intermedia evita que el segundo paso se coma la mitad de cada `**`.
glob_to_regex() {
  sed -e 's/[.+^$(){}|]/\\&/g' \
    -e 's/\*\*/@@DOBLE@@/g' \
    -e 's/\*/[^\/]*/g' \
    -e 's/@@DOBLE@@/.*/g' <<<"$1"
}

visual_paths_regex() {
  local pattern
  local alternatives=()
  while IFS= read -r pattern; do
    pattern="${pattern%$'\r'}"
    [ -z "$pattern" ] && continue
    [ "${pattern:0:1}" = "#" ] && continue
    alternatives+=("$(glob_to_regex "$pattern")")
  done <"$PATHS_FILE"
  local IFS="|"
  echo "^(${alternatives[*]})$"
}

changed_files() {
  git diff --name-only origin/main...HEAD || return 1
  git diff --name-only HEAD || return 1
  git ls-files --others --exclude-standard
}

if ! CHANGED=$(changed_files 2>/dev/null); then
  exit 0
fi

grep -Eq "$(visual_paths_regex)" <<<"$CHANGED"
