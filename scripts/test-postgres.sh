#!/usr/bin/env bash
# El Postgres desechable de un worker para los tests de migración
# (`tests/unit/supabase/`, `apply-migrations.test.ts`), uno por ticket.
#
#   bash scripts/test-postgres.sh start [N]   # crea si hace falta, arranca y
#                                             # escribe la URL para exportar
#   bash scripts/test-postgres.sh url [N]     # sólo la URL
#   bash scripts/test-postgres.sh stop [N]    # lo para y borra sus datos
#
# N es el número del ticket; sin él se lee de la rama `impl-N`. El puerto es
# 55000 más las tres últimas cifras del ticket, así dos workers no chocan.
#
# Existe porque cada worker lo improvisaba, y la improvisación de siempre
# (`pg_ctl ... start; sleep 100000` en un shell en segundo plano) dejaba a
# `claude -p` esperando a ese shell después de abrir el PR, y a la fábrica
# esperando a `claude -p`. `start` arranca el servidor y devuelve el control:
# no hace falta ningún shell que lo sostenga.

set -euo pipefail

BASE_PORT=55000

die() {
  echo "test-postgres: $*" >&2
  exit 1
}

usage() {
  die "uso: bash scripts/test-postgres.sh start|stop|url [N]"
}

ticket_from_branch() {
  git symbolic-ref --short HEAD 2>/dev/null \
    | sed -n 's/^impl-\([0-9][0-9]*\)$/\1/p' || true
}

# Los binarios del PATH, o los del instalador de Windows si no están en él.
find_pg_bin() {
  if [ -n "${PG_BIN:-}" ]; then
    echo "$PG_BIN"
    return
  fi
  local pg_ctl_path
  pg_ctl_path=$(command -v pg_ctl 2>/dev/null || true)
  if [ -n "$pg_ctl_path" ]; then
    dirname "$pg_ctl_path"
    return
  fi
  local installed
  installed=$(ls -d "/c/Program Files/PostgreSQL/"*/bin 2>/dev/null | sort -V | tail -1 || true)
  [ -n "$installed" ] || die "no encuentro pg_ctl: instala Postgres o pon su carpeta bin en PG_BIN"
  echo "$installed"
}

ACTION="${1:-}"
TICKET="${2:-$(ticket_from_branch)}"
case "$ACTION" in
  start | stop | url) ;;
  *) usage ;;
esac
[ -n "$TICKET" ] || die "falta el número del ticket: pásalo como segundo argumento o trabaja en una rama impl-N"
case "$TICKET" in
  *[!0-9]*) die "el ticket tiene que ser un número, no '$TICKET'" ;;
esac
# Base 10 siempre: con un cero delante, la aritmética lo leería en octal.
TICKET=$((10#$TICKET))

PORT=$((BASE_PORT + TICKET % 1000))
# Fuera de TMPDIR: el orquestador lo para al soltar a un worker colgado, y los
# dos tienen que encontrar el mismo directorio aunque su TMPDIR difiera.
DATA_DIR="${TEST_POSTGRES_ROOT:-$HOME/.cache/fabrica-pg}/$TICKET"
URL="postgresql://postgres@127.0.0.1:$PORT/postgres"

is_running() {
  [ -f "$DATA_DIR/PG_VERSION" ] && "$PG_BIN/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1
}

start() {
  if [ ! -f "$DATA_DIR/PG_VERSION" ]; then
    "$PG_BIN/initdb" -D "$DATA_DIR" -U postgres -A trust >/dev/null \
      || die "initdb falló en $DATA_DIR"
  fi
  if ! is_running; then
    # `-w` espera a que acepte conexiones, y el log en archivo suelta la
    # terminal: el comando vuelve en cuanto el servidor está listo.
    "$PG_BIN/pg_ctl" -D "$DATA_DIR" -o "-p $PORT" -l "$DATA_DIR/server.log" -w start \
      </dev/null >/dev/null || die "no arrancó; mira $DATA_DIR/server.log"
  fi
  echo "MIGRATIONS_TEST_DATABASE_URL=$URL"
}

stop() {
  if is_running; then
    "$PG_BIN/pg_ctl" -D "$DATA_DIR" stop -m fast -w >/dev/null
  fi
  rm -rf "$DATA_DIR"
}

case "$ACTION" in
  start)
    PG_BIN=$(find_pg_bin)
    start
    ;;
  stop)
    [ -d "$DATA_DIR" ] || exit 0
    PG_BIN=$(find_pg_bin)
    stop
    ;;
  url) echo "MIGRATIONS_TEST_DATABASE_URL=$URL" ;;
esac
