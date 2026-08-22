#!/usr/bin/env bash
# Propagates factory-models.json to the pieces that cannot read it at runtime:
# the reviewer agents' YAML frontmatter (project-level .claude/agents/).
# Run after every edit to factory-models.json, then commit both.
# process-backlog.sh and the GitHub workflows read the JSON directly, so no
# propagation needed for them.

set -euo pipefail
CFG="factory-models.json"
[ -f "$CFG" ] || { echo "❌ No $CFG in this directory (run from the repo root)." >&2; exit 1; }

CR=$(jq -r '.models.codeReviewer // "sonnet"' "$CFG")
UI=$(jq -r '.models.uiReviewer // "sonnet"' "$CFG")

update() { # file, model
  [ -f "$1" ] || { echo "⚠ $1 not found, skipped"; return; }
  sed -i "s/^model:.*$/model: $2/" "$1"
  echo "✓ $1 → model: $2"
}

# Ambas copias: .claude/agents es la que ejecuta Claude Code; user-level/ es la
# fuente del instalador de máquina. Divergir entre ellas causa sorpresas.
update .claude/agents/code-reviewer.md "$CR"
update .claude/agents/ui-reviewer.md "$UI"
update user-level/agents/code-reviewer.md "$CR"
update user-level/agents/ui-reviewer.md "$UI"

echo ""
echo "worker  → $(jq -r '.models.worker // "sonnet"' "$CFG") (leído directo por process-backlog.sh y los workflows)"
echo "planning → $(jq -r '.models.planning // "opus"' "$CFG") (elígelo con /model en tus sesiones de PRD)"

# Auto-commit + push, surgically scoped to the files this script owns.
# Skip with: bash scripts/apply-models.sh --no-commit
if [ "${1:-}" != "--no-commit" ]; then
  if git diff --quiet -- "$CFG" .claude/agents/ && git diff --cached --quiet -- "$CFG" .claude/agents/; then
    echo "✓ Sin cambios que commitear: ya estaba sincronizado."
  else
    FILES=("$CFG")
    for f in .claude/agents/code-reviewer.md .claude/agents/ui-reviewer.md \
             user-level/agents/code-reviewer.md user-level/agents/ui-reviewer.md; do
      [ -f "$f" ] && FILES+=("$f")
    done
    git add "${FILES[@]}"
    git commit --only "${FILES[@]}" -m "Config de modelos: worker=$(jq -r '.models.worker // "sonnet"' "$CFG"), codeReviewer=$CR, uiReviewer=$UI"
    if git push 2>/dev/null; then
      echo "✓ Commiteado y pusheado. Los workers de la nube ya ven la nueva configuración."
    else
      echo "↻ Push rechazado (la fábrica avanzó main mientras tanto). Intento rebase..."
      if git pull --rebase; then
        git push && echo "✓ Rebase + push OK, sincronizado con lo que la fábrica mergeó." \
                 || echo "⚠ El push sigue fallando. Revisa a mano: git status"
      else
        git rebase --abort 2>/dev/null || true
        echo "⚠ El rebase encontró conflictos, lo aborté y tu repo quedó limpio e intacto."
        echo "  Tu commit de modelos está hecho localmente. Resuelve cuando puedas:"
        echo "  git pull --rebase   (resolver conflictos)   git push"
      fi
    fi
  fi
fi
