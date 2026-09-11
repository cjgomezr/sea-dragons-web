#!/usr/bin/env bash
# Clasifica la diferencia entre el esquema que declara el repositorio y el que
# tiene una base, en una de cuatro palabras:
#
#   iguales                  la base tiene exactamente lo declarado
#   repositorio-por-delante  a la base le faltan objetos: faltan migraciones
#   base-por-delante         la base tiene objetos que el repositorio no declara
#   divergieron              cada lado tiene algo que el otro no
#
# Las tres últimas son respuestas distintas a la misma pregunta ("¿divergieron?")
# y piden arreglos distintos: aplicar las migraciones, regenerar la descripción
# del repositorio, o mirar quién tocó la base a mano. Un "no coinciden" a secas
# deja esa decisión a quien lea el diff.
#
# Se carga con `source` y no hace nada al cargarse; la usa
# `scripts/check-schema-snapshot.sh`. Vive aparte de ese script para poder
# probarla con descripciones de ejemplo, sin un Postgres delante.

# Nombra el estado a partir de las dos listas de diferencias. Separada de la
# comparación para que la tabla de decisiones se lea de un vistazo.
name_schema_drift() {
  local missing_in_database="$1" extra_in_database="$2"

  if [ -z "$missing_in_database" ] && [ -z "$extra_in_database" ]; then
    echo "iguales"
  elif [ -z "$extra_in_database" ]; then
    echo "repositorio-por-delante"
  elif [ -z "$missing_in_database" ]; then
    echo "base-por-delante"
  else
    echo "divergieron"
  fi
}

# Escribe en stdout el estado de las dos descripciones. Devuelve 0 en los
# cuatro: clasificar no es juzgar, y quien la llama bajo `set -e` necesita
# llegar vivo a la línea en la que explica la diferencia.
classify_schema_drift() {
  local expected_file="$1" actual_file="$2"

  local file
  for file in "$expected_file" "$actual_file"; do
    if [ ! -f "$file" ]; then
      echo "error: no se puede leer la descripción $file" >&2
      return 2
    fi
  done

  local missing_in_database extra_in_database
  missing_in_database="$(schema_lines_missing_from "$expected_file" "$actual_file")"
  extra_in_database="$(schema_lines_missing_from "$actual_file" "$expected_file")"

  name_schema_drift "$missing_in_database" "$extra_in_database"
}

# Líneas del primer archivo que no están en el segundo.
#
# `comm` exige entradas ordenadas y la colación por defecto es la del sistema,
# así que sin fijar LC_ALL la respuesta la decidiría el locale de quien corra
# esto. Es la misma razón por la que `supabase/ci/schema-snapshot.sql` ordena
# con `collate "C"`. Las dos entradas van por sustitución de proceso en vez de
# por archivos temporales: aquí el intérprete es bash (lo dice el shebang de
# los dos scripts que la cargan) y así no queda basura en /tmp cuando algo
# falla a mitad.
schema_lines_missing_from() {
  LC_ALL=C comm -23 <(LC_ALL=C sort "$1") <(LC_ALL=C sort "$2")
}
