#!/usr/bin/env bash
# Copia los datos de `seadragons-dev` a la base local de Docker (#448), y antes
# guarda lo que hubiera en la local para poder devolverlo con
# `npm run db:restore-backup`.
#
# Usage (desde la raíz del proyecto, con el stack local arrancado):
#   npm run db:copy-dev            # dice qué haría y no toca nada
#   npm run db:copy-dev -- --yes   # respalda, vacía y copia
#
# Sólo copia los esquemas public y auth, y sólo datos: el esquema lo ponen las
# migraciones. Nunca escribe en desarrollo, y se niega a leer de cualquier otro
# proyecto (producción incluida) o a escribir en otra base que no sea la local.
#
# El origen es SUPABASE_DEV_DB_URL (del entorno, o de `.env.local`). El destino
# es la base local, y SUPABASE_LOCAL_DB_URL sólo existe para decirlo con
# `localhost` en vez de `127.0.0.1`: cualquier otro destino se rechaza.
#
# Requires: Docker con el stack local arrancado, y la CLI de Supabase del
# proyecto (`npm run` la pone en el PATH). Los volcados los hace esa CLI y
# `psql` corre dentro del contenedor de la base local, los dos con la versión
# correcta: no depende de tener pg_dump ni psql instalados.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNAPSHOT_QUERY="$SCRIPT_DIR/../supabase/ci/schema-snapshot.sql"

# shellcheck source=scripts/lib/local-db.sh
. "$SCRIPT_DIR/lib/local-db.sh"
# shellcheck source=scripts/lib/schema-drift.sh
. "$SCRIPT_DIR/lib/schema-drift.sh"

# La variable del entorno gana; si no está, la de `.env.local`. Se lee sólo
# esa línea en vez de cargar el archivo entero con `source`, que ejecutaría
# lo que hubiera en él.
read_dev_db_url() {
  if [ -n "${SUPABASE_DEV_DB_URL:-}" ]; then
    echo "$SUPABASE_DEV_DB_URL"
    return 0
  fi
  if [ -f .env.local ]; then
    sed -n 's/^SUPABASE_DEV_DB_URL=//p' .env.local | tail -n 1 | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
  fi
}

report_missing_dev_db_url() {
  {
    echo "error: falta SUPABASE_DEV_DB_URL en .env.local."
    echo "Es la cadena de conexión de seadragons-dev: en su panel, Connect → Session pooler,"
    echo "con la contraseña de la base puesta en lugar de [YOUR-PASSWORD]. Si no la tienes,"
    echo "pídesela a quien administra el proyecto."
  } >&2
}

print_plan() {
  local dev_url="$1" local_url="$2"
  echo "Esto va a:"
  echo "  1. guardar los datos de public y auth de la base local en $BACKUP_FILE,"
  echo "     reemplazando el respaldo anterior;"
  echo "  2. vaciar public y auth de la base local ($(url_host_and_port "$local_url"));"
  echo "  3. copiar ahí los datos de seadragons-dev ($(url_host_and_port "$dev_url"))."
  echo "No se ha tocado nada. Para hacerlo: npm run db:copy-dev -- --yes"
}

# Misma lectura del catálogo que `scripts/check-schema-snapshot.sh`. El psql
# del contenedor es de Linux y no escribe CRLF; el `tr -d '\r'` se queda como
# defensa, porque una sola `\r` haría que los dos esquemas nunca coincidieran.
describe_schema() {
  run_psql "$1" \
    --no-psqlrc \
    --quiet \
    --set ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --file=- < "$SNAPSHOT_QUERY" | tr -d '\r'
}

# Objetos que Supabase crea por su cuenta en los proyectos alojados y que
# ninguna migración declara. `rls_auto_enable()` es la función del event
# trigger `ensure_rls`, la opción de activar RLS sola en cada tabla nueva: la
# base local no la tiene ni la necesita para recibir los datos, y contarla
# haría que desarrollo saliera siempre por delante.
PLATFORM_INSTALLED_OBJECTS="funcion rls_auto_enable()"

# Filtro de stdin a stdout. `grep` sale con 1 cuando no deja ninguna línea,
# que aquí es un resultado válido; sólo un 2 es un fallo.
without_platform_objects() {
  local status=0
  grep -v -x -F "$PLATFORM_INSTALLED_OBJECTS" || status=$?
  [ "$status" -le 1 ]
}

# Copia sólo si todo lo que tiene desarrollo existe en la local. La local va
# como "repositorio" y desarrollo como "base": una rama con migraciones nuevas
# sale `repositorio-por-delante`, y sus tablas nuevas quedan vacías.
check_schema_compatible() {
  local dev_url="$1" local_url="$2" work_dir="$3"
  if ! describe_schema "$local_url" > "$work_dir/schema-local.txt"; then
    echo "error: no se pudo describir el esquema de la base local" >&2
    return 1
  fi
  if ! describe_schema "$dev_url" | without_platform_objects > "$work_dir/schema-dev.txt"; then
    echo "error: no se pudo describir el esquema de seadragons-dev ($(url_host "$dev_url"))" >&2
    return 1
  fi

  local state
  if ! state="$(classify_schema_drift "$work_dir/schema-local.txt" "$work_dir/schema-dev.txt")"; then
    echo "error: no se pudieron comparar los dos esquemas" >&2
    return 1
  fi
  case "$state" in
    iguales | repositorio-por-delante) return 0 ;;
  esac
  {
    echo "error: seadragons-dev tiene esquema que la base local no tiene ($state)."
    echo "No se ha tocado nada. Actualiza la rama con main y rehaz la base local:"
    echo "  git fetch origin && git rebase origin/main"
    echo "  npm run db:reset"
  } >&2
  return 1
}

# Se escribe primero al lado y se mueve al final: un volcado fallido no borra
# el respaldo anterior.
save_local_backup() {
  mkdir -p "$BACKUP_DIR"
  local partial="$BACKUP_FILE.partial"
  if ! supabase db dump --local --data-only --schema public,auth -f "$partial"; then
    rm -f "$partial"
    echo "error: no se pudo guardar el respaldo de la base local en $BACKUP_FILE. No se ha vaciado nada." >&2
    return 1
  fi
  mv "$partial" "$BACKUP_FILE"
  echo "==> respaldo de la base local guardado en $BACKUP_FILE" >&2
}

dump_dev_data() {
  local dev_url="$1" dump_file="$2"
  if ! supabase db dump --db-url "$dev_url" --data-only --schema public,auth -f "$dump_file"; then
    echo "error: no se pudo volcar seadragons-dev ($(url_host "$dev_url")). No se ha vaciado nada." >&2
    return 1
  fi
}

# En Git Bash, `/tmp/...` sólo existe para el propio bash: la CLI de Supabase
# es un programa de Windows y lo leería como `C:\tmp\...`. `cygpath -m` da la
# ruta de Windows con barras normales, que entienden los dos. Fuera de Windows
# no hay cygpath y la ruta ya es la buena.
native_path() {
  if command -v cygpath > /dev/null 2>&1; then
    cygpath -m "$1"
  else
    echo "$1"
  fi
}

main() {
  local confirmed=false
  if [ $# -gt 0 ]; then
    case "$1" in
      --yes) confirmed=true ;;
      *)
        echo "error: opción desconocida: $1" >&2
        return 2
        ;;
    esac
  fi

  local dev_url local_url="${SUPABASE_LOCAL_DB_URL:-$DEFAULT_LOCAL_DB_URL}"
  dev_url="$(read_dev_db_url)"
  if [ -z "$dev_url" ]; then
    report_missing_dev_db_url
    return 1
  fi
  check_dev_source_url "$dev_url"
  check_local_target_url "$local_url"

  if [ "$confirmed" = false ]; then
    print_plan "$dev_url" "$local_url"
    return 0
  fi

  check_local_stack_running

  # El volcado de desarrollo trae datos personales (NFR-011): vive fuera del
  # repositorio y se borra al salir, bien o mal.
  local work_dir
  work_dir="$(native_path "$(mktemp -d)")"
  # shellcheck disable=SC2064
  trap "rm -rf $(printf '%q' "$work_dir")" EXIT

  check_schema_compatible "$dev_url" "$local_url" "$work_dir"
  save_local_backup
  dump_dev_data "$dev_url" "$work_dir/dev-data.sql"
  restore_in_transaction "$local_url" "$work_dir/dev-data.sql" "$work_dir"
  echo "==> base local copiada de seadragons-dev. Para volver atrás: npm run db:restore-backup -- --yes" >&2
}

main "$@"
