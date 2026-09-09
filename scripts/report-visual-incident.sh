#!/usr/bin/env bash
# Convierte un push a main con la línea base visual desajustada en algo que no
# se pueda pasar por alto: un issue en la cola, no sólo una corrida roja en la
# pestaña Actions que nadie va a mirar hasta que otro PR salga rojo por algo
# que no era suyo.
#
# Deduplica por título antes de crear nada: una racha de pushes rotos (por
# ejemplo mientras alguien está resolviendo el primero) no debe multiplicar
# incidentes. Si la búsqueda de duplicados falla, no crea nada: es preferible
# perder un incidente a duplicarlo, igual que pr_declares_closes() en
# scripts/process-backlog.sh.
#
# La épica se fija a mano: un desajuste del propio gate visual es
# infraestructura de la fábrica, no del código de producto que el push tocaba,
# y un detector automático no puede deducir qué epic rompió el push. El número
# es de cada proyecto, así que se resuelve como el puerto en ui-preflight.sh:
# un valor por defecto que la plantilla deja como placeholder para que lo
# rellene /bootstrap, y FACTORY_EPIC para pisarlo desde el entorno.
#
# Usage: scripts/report-visual-incident.sh
# Requires: gh (con permiso de escritura sobre issues), scripts/file-incident.sh.
# Usa las variables que Actions expone (GITHUB_SHA, GITHUB_SERVER_URL,
# GITHUB_REPOSITORY, GITHUB_RUN_ID) para enlazar la corrida; pensado para
# correr dentro de Actions, donde siempre están presentes.

set -uo pipefail

DEFAULT_FACTORY_EPIC=32

# En una sola expansión no funciona: con un placeholder por defecto, bash
# cierra en la primera llave de `{{...}}` y deja `}}` pegado al valor.
VISUAL_INCIDENT_EPIC="${FACTORY_EPIC:-$DEFAULT_FACTORY_EPIC}"

# Sin épica no hay de dónde colgar el incidente, y un número equivocado lo
# cuelga del issue ajeno que tenga ese número: nadie lo encontraría y de paso
# ensuciaría un issue que no tiene nada que ver. Mejor fallar diciéndolo que
# acertar por casualidad.
case "$VISUAL_INCIDENT_EPIC" in
  *'{{'*|"")
    echo "report-visual-incident: falta la épica de fábrica. Corre /bootstrap o exporta FACTORY_EPIC=<número del issue de la épica>." >&2
    exit 1
    ;;
esac
TITLE="main con la línea base visual desajustada"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

EXISTING=$(gh issue list --search "\"$TITLE\" in:title is:open" --json number --jq length 2>/dev/null)
if [ $? -ne 0 ]; then
  echo "report-visual-incident: no pude comprobar si ya hay un incidente abierto (falla de gh); no creo nada por si acaso." >&2
  exit 0
fi

if [ "${EXISTING:-0}" != "0" ]; then
  echo "report-visual-incident: ya hay un incidente abierto para esta causa, no creo otro." >&2
  exit 0
fi

RUN_URL="${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"
BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

cat >"$BODY_FILE" <<EOF
## Contexto

El gate visual comparó las capturas de Linux contra el código en \`main\`
(commit \`${GITHUB_SHA:-desconocido}\`) y no coinciden. Esto pasa cuando un PR
se mergea con el check \`compare\` en rojo, o cuando el job \`accept\` no
alcanza a empujar su commit de línea base antes de que el PR se mergee.

Corrida: $RUN_URL

## Qué revisar

Compara la línea base commiteada (\`tests/ui.spec.ts-snapshots/\`) contra lo
que el código en \`main\` renderiza hoy. Si el desajuste es real, acéptalo
corriendo el workflow a mano sobre \`main\` con la URL de esta corrida:

\`\`\`
gh workflow run visual-baselines.yml --ref main -f reviewed_run_url=$RUN_URL
\`\`\`
EOF

bash "$SCRIPT_DIR/file-incident.sh" "$VISUAL_INCIDENT_EPIC" "$TITLE" "$BODY_FILE"
