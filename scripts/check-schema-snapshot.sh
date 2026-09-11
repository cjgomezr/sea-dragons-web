#!/usr/bin/env bash
# Compara el esquema de la base que apunte DATABASE_URL contra el que declara
# el repositorio en `supabase/ci/schema-expected.txt`, y falla si difieren.
#
# Es la otra mitad de la comprobación del PR (RF-5 del PRD de E16a): que las
# migraciones apliquen no garantiza que dejen el esquema que el repositorio
# dice tener. Una migración que alguien editó después de haberla aplicado a
# mano por MCP aplica limpia en una base vacía y deja otro esquema.
#
# La descripción se lee del catálogo con `supabase/ci/schema-snapshot.sql`, no
# con pg_dump: pg_dump se niega a hablar con un servidor más nuevo que él, y el
# runner no trae necesariamente el cliente de la versión de la imagen. Eso no
# hace al catálogo inmune a la versión (`pg_get_constraintdef` ha cambiado de
# formato entre mayores), así que el archivo se regenera contra la misma mayor
# que usa el job.
#
# Usage:
#   DATABASE_URL=postgresql://... scripts/check-schema-snapshot.sh
#   DATABASE_URL=postgresql://... scripts/check-schema-snapshot.sh --write
#
# --write regenera el archivo esperado en vez de comparar. Es lo que se corre
# al añadir una migración. Quien no tenga Postgres a mano puede copiar la
# descripción que el fallo imprime: el job la deja completa en el log.
#
# Es también la comprobación de divergencia entre el repositorio y una base
# cualquiera, producción incluida: escribe en stdout una de las cuatro palabras
# que define `scripts/lib/schema-drift.sh` (`iguales`,
# `repositorio-por-delante`, `base-por-delante`, `divergieron`) y sale en verde
# sólo con la primera.
#
# Requires: psql, diff.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SNAPSHOT_QUERY="$REPO_ROOT/supabase/ci/schema-snapshot.sql"
EXPECTED_SCHEMA="$REPO_ROOT/supabase/ci/schema-expected.txt"

# shellcheck source=scripts/lib/schema-drift.sh
. "$SCRIPT_DIR/lib/schema-drift.sh"

describe_schema() {
  local database_url="$1"
  # El `tr -d '\r'` no es cosmético: psql en Windows termina las líneas con
  # CRLF y el archivo commiteado se normaliza a LF (.gitattributes), así que
  # sin esto la comparación fallaría según el sistema de quien la corre, no
  # según el esquema. Con `pipefail` el fallo de psql sigue ganando.
  psql "$database_url" \
    --no-psqlrc \
    --quiet \
    --set ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --file "$SNAPSHOT_QUERY" | tr -d '\r'
}

# Qué hay que hacer con cada estado. El diff dice qué líneas difieren; esto
# dice de quién es el trabajo de arreglarlo.
explain_drift_state() {
  case "$1" in
    repositorio-por-delante)
      echo "A la base le faltan objetos que el repositorio declara: le faltan migraciones por aplicar."
      ;;
    base-por-delante)
      echo "La base tiene objetos que el repositorio no declara: o se añadió una migración sin regenerar la descripción, o alguien tocó la base por fuera de una migración."
      ;;
    divergieron)
      echo "Cada lado tiene algo que el otro no."
      ;;
    *)
      echo "error: estado de divergencia desconocido: $1" >&2
      return 1
      ;;
  esac
}

schema_difference() {
  local actual_file="$1"
  # `diff` sale con 1 cuando los archivos difieren, que aquí es lo esperado:
  # el estado ya lo decidió `classify_schema_drift`. Un fallo de verdad (2) sí
  # se propaga, en vez de leerse como "no hay diferencias".
  local output status=0
  output="$(diff -u \
    --label "$EXPECTED_SCHEMA" \
    --label "esquema de la base" \
    "$EXPECTED_SCHEMA" "$actual_file")" || status=$?
  if [ "$status" -gt 1 ]; then
    echo "error: diff no pudo comparar las dos descripciones" >&2
    return "$status"
  fi
  printf '%s\n' "$output"
}

report_difference() {
  local state="$1" actual_file="$2"
  {
    echo "error: el esquema de la base no es el que declara el repositorio: $state"
    # Red de seguridad de `set -e`, no un caso esperado: este bloque es el
    # informe de un fallo, y dejar que un error aquí lo propague cortaría el
    # informe justo antes de las líneas que dicen cómo salir del paso. Quien
    # decide el veredicto es el `return 1` de `main`, no estas dos.
    explain_drift_state "$state" || echo "(estado inesperado: $state)"
    schema_difference "$actual_file" || echo "(no se pudo calcular el diff)"
    echo
    echo "Si el cambio es esperado (vienes de añadir una migración), regenera el"
    echo "archivo con: DATABASE_URL=... bash scripts/check-schema-snapshot.sh --write"
    # El log completo es la vía de escape de quien no tiene Postgres a mano:
    # copiar estas líneas al archivo equivale a haber corrido --write.
    echo "Sin Postgres a mano, copia tal cual estas líneas:"
    cat "$actual_file"
  } >&2
}

main() {
  local write=false
  if [ $# -gt 0 ]; then
    case "$1" in
      --write) write=true ;;
      *)
        echo "error: opción desconocida: $1" >&2
        return 2
        ;;
    esac
  fi

  local database_url="${DATABASE_URL:-}"
  if [ -z "$database_url" ]; then
    echo "error: falta DATABASE_URL con la conexión a la base a describir" >&2
    return 1
  fi
  if ! command -v psql > /dev/null 2>&1; then
    echo "error: falta psql en el PATH" >&2
    return 1
  fi

  # La descripción se guarda en un archivo en vez de en una variable para que
  # `diff` pueda leerla sin sustituciones de proceso, que no existen en todos
  # los shells. El fallo de psql llega al `if` porque la sustitución es el
  # único comando de la asignación.
  local actual_file
  actual_file="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '$actual_file'" EXIT

  local description
  if ! description="$(describe_schema "$database_url")"; then
    echo "error: no se pudo describir el esquema de la base" >&2
    return 1
  fi
  printf '%s\n' "$description" > "$actual_file"

  if [ "$write" = true ]; then
    # Una base sin migraciones describe un esquema vacío, y guardarlo dejaría
    # la comparación pasando contra cualquier base vacía para siempre.
    if [ -z "$description" ]; then
      echo "error: la base no tiene ningún objeto en public. ¿Aplicaste las migraciones?" >&2
      return 1
    fi
    cp "$actual_file" "$EXPECTED_SCHEMA"
    echo "==> $EXPECTED_SCHEMA regenerado" >&2
    return 0
  fi

  if [ ! -f "$EXPECTED_SCHEMA" ]; then
    echo "error: falta $EXPECTED_SCHEMA; genéralo con --write" >&2
    return 1
  fi

  # La respuesta va a stdout en una palabra, para que sirva de comprobación de
  # divergencia y no sólo de check de CI: el resto del ruido vive en stderr.
  local state
  if ! state="$(classify_schema_drift "$EXPECTED_SCHEMA" "$actual_file")"; then
    echo "error: no se pudieron comparar las dos descripciones del esquema" >&2
    return 1
  fi
  echo "$state"

  if [ "$state" = "iguales" ]; then
    echo "==> el esquema coincide con el declarado en el repositorio" >&2
    return 0
  fi

  report_difference "$state" "$actual_file"
  return 1
}

main "$@"
