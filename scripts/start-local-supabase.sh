#!/usr/bin/env bash
# Levanta un Supabase local dentro del runner y deja su URL y sus llaves en el
# entorno del job (#535, E20).
#
# El CLI es el de `devDependencies`: así la versión que arranca en CI es la
# misma que usa el equipo con `npm run db:start`, y no hace falta bajar otro.
# El CLI aplica `supabase/migrations` al arrancar.
#
# Sólo se levanta lo que la app y las pruebas tocan: la base, Auth, la API
# REST, Storage y Kong, que es la puerta de los tres. Lo demás cuesta imágenes
# que bajar y memoria del runner sin que nadie lo use.
#
# Un arranque puede fallar por algo pasajero (una imagen que no baja, un
# contenedor que tarda en estar sano), así que se reintenta una vez desde
# cero. Si falla otra vez, el error dice qué migración o qué servicio fue.
# Nunca cae a `seadragons-dev`: este script no conoce ninguna llave de dev.
#
# Usage: bash scripts/start-local-supabase.sh
# Requires: Docker y `npm ci` hecho (trae el CLI).
# Entrada:  GITHUB_ENV; GITHUB_STEP_SUMMARY, si está, recibe el tiempo de
#           arranque. SUPABASE_CLI sólo para los tests, que fingen el CLI.
# Salida:   0 con NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
#           SUPABASE_SERVICE_ROLE_KEY escritas en GITHUB_ENV; 1 si no arranca
#           o si `supabase status` no da alguna de las tres.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPABASE_CLI="${SUPABASE_CLI:-$REPO_ROOT/node_modules/.bin/supabase}"

# Nombres de contenedor que acepta `supabase start -x` (ver `--help`).
# `postgres-meta` sólo lo usa Studio, `vector` sólo alimenta a la analítica
# (`logflare`), `imgproxy` sólo hace falta con las transformaciones de imágenes
# de Storage, que están apagadas, y `supavisor` es un pooler que nadie usa.
EXCLUDED_SERVICES="studio,postgres-meta,realtime,edge-runtime,logflare,vector,mailpit,imgproxy,supavisor"

MAX_ATTEMPTS=2

# Variable de `supabase status -o env` → variable que lee la app.
STATUS_TO_APP_ENV=(
  "API_URL:NEXT_PUBLIC_SUPABASE_URL"
  "ANON_KEY:NEXT_PUBLIC_SUPABASE_ANON_KEY"
  "SERVICE_ROLE_KEY:SUPABASE_SERVICE_ROLE_KEY"
)

: "${GITHUB_ENV:?falta GITHUB_ENV: este script escribe las llaves en el entorno de un job de Actions}"

# Lee la salida de un arranque fallido y dice por qué. Un `ERROR:` de Postgres
# es una migración: la culpable es la última que se estaba aplicando antes de
# él. Si no hay ninguno, la última migración aplicada no tiene la culpa y lo
# que importa es la primera línea que nombre un fallo, que suele decir qué
# contenedor no se puso sano.
describe_failure() {
  local log_file="$1"
  local postgres_error
  postgres_error=$(grep -m1 '^ERROR:' "$log_file")
  if [ -n "$postgres_error" ]; then
    local migration
    migration=$(sed -n '/^ERROR:/q; s/^Applying migration \(.*\)\.\.\.$/\1/p' "$log_file" | tail -n1)
    echo "falló la migración ${migration:-desconocida}: $postgres_error"
    return
  fi
  local failure
  failure=$(grep -i -m1 -E 'not ready|unhealthy|error|failed' "$log_file")
  echo "${failure:-$(grep -v '^[[:space:]]*$' "$log_file" | tail -n1)}"
}

# Arranca hasta MAX_ATTEMPTS veces. Entre intentos borra lo que quedó, para
# que el segundo no herede un volumen a medio migrar.
start_supabase() {
  local log_file attempt
  log_file=$(mktemp)
  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
    if "$SUPABASE_CLI" start -x "$EXCLUDED_SERVICES" 2>&1 | tee "$log_file"; then
      rm -f "$log_file"
      return 0
    fi
    echo "::warning title=Supabase local::el intento $attempt de $MAX_ATTEMPTS no arrancó: $(describe_failure "$log_file")"
    [ "$attempt" -lt "$MAX_ATTEMPTS" ] && "$SUPABASE_CLI" stop --no-backup
  done
  echo "::error title=Supabase local::no arrancó tras $MAX_ATTEMPTS intentos; $(describe_failure "$log_file")"
  rm -f "$log_file"
  return 1
}

# Traduce `supabase status -o env` a las variables de la app y las escribe
# todas o ninguna: un job con la URL pero sin la llave fallaría más tarde y
# más lejos de la causa.
export_app_env() {
  local status pair status_name app_name value
  local -a lines=()
  status=$("$SUPABASE_CLI" status -o env) || {
    echo "::error title=Supabase local::supabase status falló después de arrancar"
    return 1
  }
  for pair in "${STATUS_TO_APP_ENV[@]}"; do
    status_name="${pair%%:*}"
    app_name="${pair##*:}"
    value=$(sed -n "s/^${status_name}=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" <<<"$status")
    if [ -z "$value" ]; then
      echo "::error title=Supabase local::supabase status no dio $status_name"
      return 1
    fi
    lines+=("$app_name=$value")
  done
  printf '%s\n' "${lines[@]}" >>"$GITHUB_ENV"
}

start_supabase || exit 1
export_app_env || exit 1
ready_message="Supabase local listo en ${SECONDS} s."
echo "$ready_message"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "$ready_message" >>"$GITHUB_STEP_SUMMARY"
fi
