#!/usr/bin/env bash
# Devuelve a la base local los datos que `npm run db:copy-dev` guardó antes de
# copiar (#448), en `.factory/db-backup/`.
#
# Usage (desde la raíz del proyecto, con el stack local arrancado):
#   npm run db:restore-backup            # dice qué haría y no toca nada
#   npm run db:restore-backup -- --yes   # vacía public y auth y restaura
#
# Como la copia, sólo escribe en la base local: SUPABASE_LOCAL_DB_URL puede
# decirla con `localhost`, y cualquier otro destino se rechaza.
#
# Requires: psql, y la CLI de Supabase del proyecto (`npm run` la pone en el
# PATH).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=scripts/lib/local-db.sh
. "$SCRIPT_DIR/lib/local-db.sh"

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

  local local_url="${SUPABASE_LOCAL_DB_URL:-$DEFAULT_LOCAL_DB_URL}"
  check_local_target_url "$local_url"
  if [ ! -f "$BACKUP_FILE" ]; then
    echo "error: no hay respaldo en $BACKUP_FILE. Se guarda uno cada vez que corres npm run db:copy-dev -- --yes. No se ha tocado nada." >&2
    return 1
  fi

  if [ "$confirmed" = false ]; then
    echo "Esto va a vaciar public y auth de la base local ($(url_host_and_port "$local_url"))"
    echo "y a restaurar ahí el respaldo de $BACKUP_FILE."
    echo "No se ha tocado nada. Para hacerlo: npm run db:restore-backup -- --yes"
    return 0
  fi

  check_psql_available
  check_local_stack_running
  restore_in_transaction "$local_url" "$BACKUP_FILE"
  echo "==> base local restaurada desde $BACKUP_FILE" >&2
}

main "$@"
