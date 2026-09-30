#!/usr/bin/env bash
# Piezas comunes de `scripts/copy-dev-to-local.sh` y
# `scripts/restore-local-backup.sh` (#448): reconocer de qué proyecto es una
# conexión, negarse a escribir fuera de la base local, y restaurar un volcado
# de datos en una sola transacción.
#
# Se carga con `source` y no hace nada al cargarse. Ninguna función imprime
# una URL entera: las conexiones llevan la contraseña de la base, así que los
# mensajes nombran el host y el proyecto, nunca la cadena.

LOCAL_DB_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVIRONMENT_GUARD="$LOCAL_DB_LIB_DIR/../../src/lib/supabase/environment-guard.ts"

# El Supabase local que levanta `npm run db:start` (#447), con la base en el
# puerto de `supabase/config.toml`.
DEFAULT_LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
LOCAL_DB_PORT="54322"

# Donde queda el respaldo de la base local, relativo a la raíz del proyecto.
# Un solo archivo: el ticket pide un respaldo, no un historial.
BACKUP_DIR=".factory/db-backup"
BACKUP_FILE="$BACKUP_DIR/data.sql"

# Lee un ref de proyecto del guardia de entorno, que es donde el repositorio
# los declara. Copiarlos aquí dejaría dos verdades que pueden separarse.
read_project_ref() {
  local constant="$1" ref
  ref="$(sed -n "s/^export const $constant = \"\\([a-z0-9]*\\)\";.*/\\1/p" "$ENVIRONMENT_GUARD")"
  if [ -z "$ref" ]; then
    echo "error: no encuentro $constant en $ENVIRONMENT_GUARD" >&2
    return 1
  fi
  echo "$ref"
}

# Autoridad de una URL de Postgres (`usuario:clave@host:puerto`), sin esquema
# ni ruta. La clave va percent-encoded, como pide la CLI de Supabase, así que
# no trae `/` ni `@` sueltas.
url_authority() {
  local rest="${1#*://}"
  rest="${rest%%/*}"
  echo "${rest%%\?*}"
}

url_host_and_port() {
  local authority
  authority="$(url_authority "$1")"
  echo "${authority##*@}"
}

url_host() {
  local host_and_port
  host_and_port="$(url_host_and_port "$1")"
  echo "${host_and_port%%:*}"
}

url_port() {
  local host_and_port
  host_and_port="$(url_host_and_port "$1")"
  case "$host_and_port" in
    *:*) echo "${host_and_port##*:}" ;;
    *) echo "" ;;
  esac
}

url_user() {
  local authority
  authority="$(url_authority "$1")"
  case "$authority" in
    *@*)
      local userinfo="${authority%@*}"
      echo "${userinfo%%:*}"
      ;;
    *) echo "" ;;
  esac
}

# Ref del proyecto de Supabase al que apunta una conexión, o nada si no es de
# Supabase. El pooler lo lleva en el usuario (`postgres.<ref>`); la conexión
# directa, en el host (`db.<ref>.supabase.co`).
supabase_project_ref_of_url() {
  local user host
  user="$(url_user "$1")"
  host="$(url_host "$1")"
  case "$user" in
    postgres.*)
      echo "${user#postgres.}"
      return 0
      ;;
  esac
  case "$host" in
    db.*.supabase.co)
      local ref="${host#db.}"
      echo "${ref%.supabase.co}"
      ;;
  esac
}

# Falla, explicando por qué, cuando el origen de la copia no es seadragons-dev.
# Producción se nombra aparte: es el error más caro y el primero que hay que
# reconocer.
check_dev_source_url() {
  local url="$1" dev_ref prod_ref ref host
  dev_ref="$(read_project_ref DEVELOPMENT_SUPABASE_PROJECT_REF)" || return 1
  prod_ref="$(read_project_ref PRODUCTION_SUPABASE_PROJECT_REF)" || return 1
  ref="$(supabase_project_ref_of_url "$url")"
  host="$(url_host "$url")"

  if [ "$ref" = "$dev_ref" ]; then
    return 0
  fi
  if [ "$ref" = "$prod_ref" ]; then
    echo "error: SUPABASE_DEV_DB_URL apunta a PRODUCCIÓN (seadragons-prod, $prod_ref). Sólo se copia desde seadragons-dev ($dev_ref)." >&2
  elif [ -n "$ref" ]; then
    echo "error: SUPABASE_DEV_DB_URL apunta al proyecto $ref (host $host), no a seadragons-dev ($dev_ref)." >&2
  else
    echo "error: SUPABASE_DEV_DB_URL no apunta a ningún proyecto de Supabase (host $host). Sólo se copia desde seadragons-dev ($dev_ref)." >&2
  fi
  return 1
}

# Falla cuando el destino no es la base local: escribir en cualquier otra
# sería vaciarla. Una URL con parámetros se rechaza entera, porque libpq deja
# que `?host=` y `?port=` pisen el host y el puerto que se acaban de comprobar.
check_local_target_url() {
  local url="$1" host port
  case "$url" in
    *\?*)
      echo "error: el destino lleva parámetros (?host=, ?port=...), y libpq podría usarlos para salir de la base local (127.0.0.1:$LOCAL_DB_PORT o localhost:$LOCAL_DB_PORT). No se escribe nada." >&2
      return 1
      ;;
  esac
  host="$(url_host "$url")"
  port="$(url_port "$url")"
  case "$host" in
    127.0.0.1 | localhost)
      if [ "$port" = "$LOCAL_DB_PORT" ]; then
        return 0
      fi
      ;;
  esac
  echo "error: el destino ($host:${port:-sin puerto}) no es la base local (127.0.0.1:$LOCAL_DB_PORT o localhost:$LOCAL_DB_PORT). No se escribe nada." >&2
  return 1
}

check_psql_available() {
  if command -v psql > /dev/null 2>&1; then
    return 0
  fi
  echo "error: falta psql en el PATH. Instala el cliente de PostgreSQL (en Windows, el instalador de postgresql.org con sólo 'Command Line Tools')." >&2
  return 1
}

check_local_stack_running() {
  if supabase status > /dev/null 2>&1; then
    return 0
  fi
  echo "error: el Supabase local no está arrancado. Abre Docker Desktop y corre: npm run db:start" >&2
  return 1
}

# Vacía las tablas de public y auth antes de insertar el volcado. Deja fuera
# `auth.schema_migrations`: es la historia de migraciones de GoTrue, el
# volcado no la trae, y vaciarla haría que Auth intentara migrarse de nuevo.
# `session_replication_role = replica` apaga los triggers y las claves
# foráneas, para que el orden de los inserts no importe.
emptying_sql() {
  cat << 'SQL'
set local session_replication_role = replica;
do $$
declare
  tables text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ')
    into tables
    from pg_tables
   where schemaname in ('public', 'auth')
     and not (schemaname = 'auth' and tablename = 'schema_migrations');
  if tables is not null then
    execute 'truncate table ' || tables || ' cascade';
  end if;
end
$$;
SQL
}

# Tabla calificada (`esquema.tabla`) de una línea `INSERT INTO "e"."t" ...`.
qualified_table_of_insert() {
  sed -n 's/.*INSERT INTO "\([^"]*\)"\."\([^"]*\)".*/\1.\2/p' | head -n 1
}

# Nombre de la tabla que hizo fallar la restauración. Lo más fiable es la
# línea de la entrada que psql cita (`psql:<stdin>:N:`): el volcado escribe un
# INSERT con muchas filas, una por línea, así que la tabla es la del último
# `INSERT INTO` hasta esa línea. Un error de tipo (`invalid input syntax`) no
# nombra ninguna relación, y el `LINE n:` que cita psql puede ser una fila
# suelta. Si no hay número de línea, se queda con lo que traiga el mensaje.
failed_table_from_psql_errors() {
  local errors="$1" input_file="$2" line table=""
  line="$(printf '%s\n' "$errors" | sed -n 's/^psql:<stdin>:\([0-9]*\): ERROR:.*/\1/p' | head -n 1)"
  if [ -n "$line" ]; then
    table="$(awk -v last="$line" 'NR <= last && /^INSERT INTO / { insert = $0 } END { print insert }' "$input_file" | qualified_table_of_insert)"
  fi
  if [ -z "$table" ]; then
    table="$(printf '%s\n' "$errors" | qualified_table_of_insert)"
  fi
  if [ -z "$table" ]; then
    table="$(printf '%s\n' "$errors" | sed -n 's/.*relation "\([^"]*\)".*/\1/p' | head -n 1)"
  fi
  echo "${table:-desconocida}"
}

# Vacía la base local y restaura el volcado, todo en una transacción: si algo
# falla, la base queda como estaba. `--single-transaction` envuelve la entrada
# entera, que llega por stdin para que el vaciado y el volcado vayan juntos.
# La entrada se guarda en un archivo para poder buscar en ella la línea que
# cite el error; lleva datos del volcado, así que se borra al terminar.
restore_in_transaction() {
  local target_url="$1" dump_file="$2" scratch status=0
  scratch="$(mktemp -d)"
  { emptying_sql; cat "$dump_file"; } > "$scratch/input.sql"
  psql "$target_url" \
    --no-psqlrc \
    --quiet \
    --set ON_ERROR_STOP=1 \
    --single-transaction \
    --file=- < "$scratch/input.sql" > /dev/null 2> "$scratch/errors.txt" || status=$?

  if [ "$status" -eq 0 ]; then
    rm -rf "$scratch"
    return 0
  fi

  local errors table
  errors="$(cat "$scratch/errors.txt")"
  table="$(failed_table_from_psql_errors "$errors" "$scratch/input.sql")"
  rm -rf "$scratch"
  {
    echo "error: falló la restauración en la tabla $table."
    printf '%s\n' "$errors" | grep 'ERROR:' || true
    echo "La transacción se deshizo: la base local quedó como estaba antes."
  } >&2
  return 1
}
