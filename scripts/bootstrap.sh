#!/usr/bin/env bash
# One-shot mechanical bootstrap for a project created from the fabrica template.
# Called by the /bootstrap skill (or manually). Idempotent, safe to re-run.
set -euo pipefail

gh auth status >/dev/null 2>&1 || { echo "❌ gh no está autenticado. Corre 'gh auth login' primero" >&2; exit 1; }

echo "▶ Installing npm dependencies..."
npm install

echo "▶ Installing Playwright chromium (cached per machine)..."
npx playwright install chromium

echo "▶ Creating GitHub labels..."
for l in pending in-progress needs-human ready-for-dev auto-merge ui-review \
         "priority:high" "priority:medium" "priority:low" "size:S" "size:M" "size:L" epic; do
  if out=$(gh label create "$l" 2>&1); then
    echo "  + $l"
  else
    case "$out" in
      *already\ exists*) echo "  = $l" ;;
      *) echo "  ✗ $l: $out" >&2 ;;   # nunca silenciar un fallo real (sin permiso, sin remote…)
    esac
  fi
done

echo "✓ Mechanical bootstrap done."
