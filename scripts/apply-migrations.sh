#!/usr/bin/env bash
# Aplica las migraciones del repositorio sobre una base Postgres, en orden de
# nombre y parando en la primera que falle.
#
# Existe para que CI pueda comprobar en cada PR que el histórico completo
# sigue aplicando sobre un esquema limpio (RF-5 del PRD de E16a). Hasta hoy
# las migraciones se aplicaban a mano por MCP desde la sesión de quien
# trabajaba: con dos personas, el repositorio y la base se separan sin que
# nadie se entere.
#
# No crea los roles de la API de Supabase (anon, authenticated,
# service_role), a los que las migraciones hacen GRANT. Un Postgres recién
# creado no los tiene y quien lo levante debe aplicar antes
# `supabase/ci/roles.sql`. Se deja fuera a propósito: el mismo script tiene
# que servir para aplicar migraciones contra un Supabase de verdad, donde
# esos roles ya existen y crearlos sería otro trabajo distinto.
#
# Usage:
#   DATABASE_URL=postgresql://... scripts/apply-migrations.sh [--dir DIR]
#   scripts/apply-migrations.sh --list [--dir DIR]
#
# Requires: psql. Lee la conexión de DATABASE_URL, nunca de un argumento, para
# que no acabe en el log de nadie.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_MIGRATIONS_DIR="$(dirname "$SCRIPT_DIR")/supabase/migrations"

usage() {
  sed -n '/^# Usage:/,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# `find | sort` con LC_ALL=C: la colación por defecto ordena ignorando la caja
# y la puntuación, así que sin fijarlo el orden en que se aplican las
# migraciones lo decidiría el locale del runner. -maxdepth 1 deja fuera
# subdirectorios, y el nombre completo del archivo ordena igual que su prefijo
# de fecha cuando dos lo comparten.
list_migrations() {
  local dir="$1"
  find "$dir" -maxdepth 1 -type f -name '*.sql' | LC_ALL=C sort
}

apply_migration() {
  local database_url="$1" migration="$2"
  echo "==> $(basename "$migration")" >&2
  # ON_ERROR_STOP para que psql salga en rojo en vez de seguir tras el primer
  # error, y --single-transaction para que una migración que falla a la mitad
  # no deje puesto lo que alcanzó a correr.
  psql "$database_url" \
    --no-psqlrc \
    --quiet \
    --set ON_ERROR_STOP=1 \
    --single-transaction \
    --file "$migration"
}

main() {
  local migrations_dir="$DEFAULT_MIGRATIONS_DIR"
  local only_list=false

  while [ $# -gt 0 ]; do
    case "$1" in
      --dir)
        migrations_dir="${2:-}"
        if [ -z "$migrations_dir" ]; then
          echo "error: --dir necesita un directorio" >&2
          return 2
        fi
        shift 2
        ;;
      --list)
        only_list=true
        shift
        ;;
      -h | --help)
        usage
        return 0
        ;;
      *)
        echo "error: opción desconocida: $1" >&2
        usage >&2
        return 2
        ;;
    esac
  done

  if [ ! -d "$migrations_dir" ]; then
    echo "error: el directorio de migraciones no existe: $migrations_dir" >&2
    return 1
  fi

  # La tubería va dentro de una sustitución para que su fallo llegue al `if`:
  # `mapfile < <(...)` se traga el estado de salida y el script seguiría con
  # una lista vacía, que aquí se leería como "no hay nada que aplicar" (#83).
  local listing
  if ! listing="$(list_migrations "$migrations_dir")"; then
    echo "error: no se pudieron listar las migraciones de $migrations_dir" >&2
    return 1
  fi

  # Bucle en vez de `mapfile`, que no existe en bash 3.2 (el de macOS de
  # fábrica): ahí el script moriría con un 127 que no explica nada, y este
  # script tiene que poder correrse desde la máquina de alguien.
  local migrations=() line
  while IFS= read -r line; do
    if [ -n "$line" ]; then
      migrations+=("$line")
    fi
  done <<<"$listing"

  # Cero migraciones es casi siempre un --dir equivocado. Salir en verde sin
  # haber comprobado nada es el peor resultado posible para un check de CI.
  if [ "${#migrations[@]}" -eq 0 ]; then
    echo "error: no hay ninguna migración (*.sql) en $migrations_dir" >&2
    return 1
  fi

  if [ "$only_list" = true ]; then
    printf '%s\n' "${migrations[@]}"
    return 0
  fi

  local database_url="${DATABASE_URL:-}"
  if [ -z "$database_url" ]; then
    echo "error: falta DATABASE_URL con la conexión a la base destino" >&2
    return 1
  fi

  # Sin esto, un PATH sin psql se leería como "falló la migración 0001", que es
  # el motivo equivocado.
  if ! command -v psql > /dev/null 2>&1; then
    echo "error: falta psql en el PATH" >&2
    return 1
  fi

  local migration
  for migration in "${migrations[@]}"; do
    if ! apply_migration "$database_url" "$migration"; then
      echo "error: falló la migración $(basename "$migration")" >&2
      return 1
    fi
  done

  echo "==> ${#migrations[@]} migraciones aplicadas" >&2
}

main "$@"
