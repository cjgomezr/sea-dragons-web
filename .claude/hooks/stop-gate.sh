#!/usr/bin/env bash
# Stop gate: Claude cannot finish the session while these checks fail.
# Exit code 2 = block (Claude receives stderr and keeps iterating).
# Exit code 0 = allow finish.
#
# Cada check se ejecuta solo si su config existe. Si tu stack NO es npm/JS,
# reemplaza los comandos de abajo por los de tu stack (ver bootstrap, Fase 2).
# Keep the cheapest checks first so failures surface fast.

set -o pipefail

# Kill switch: sessions that only answer questions (e.g. @claude mentions that
# just reply in a thread) never produce code, so verifying them with lint,
# types and tests protects nothing, it only traps them. Exit before touching
# the retry counter file, so a worker session running in parallel keeps its
# own count untouched.
if [ "${FACTORY_GATE:-}" = "off" ]; then
  exit 0
fi

# Anti-infinite-loop guard: after MAX_GATE_RUNS blocked attempts, let Claude
# stop so it can label the issue needs-human instead of looping forever.
COUNTER_FILE="/tmp/claude-stop-gate-$(pwd | tr -c "[:alnum:]" "-" )"
MAX_GATE_RUNS="${MAX_GATE_RUNS:-6}"
COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)

# Pre-bootstrap guard: until /bootstrap fills the {{...}} placeholders, the
# project has no real test/lint commands, so the gate is unsatisfiable and
# would block every session in the template repo itself. Arm it only after
# bootstrap.
if grep -q '{{TEST_CMD}}' package.json 2>/dev/null; then
  rm -f "$COUNTER_FILE"
  exit 0
fi

# Review-only guard: if the session changed nothing beyond generated noise
# (clean tree modulo GENERATED_NOISE_FILES, no commits beyond upstream),
# there is nothing to verify. Don't run the full suite just to end a Q&A
# session. Any failure to determine "ahead" counts as ahead, so worker
# sessions with local commits always get checked. `next dev` rewrites
# tsconfig.json and the CLAUDE.md agent block on every run, and `npm install`
# rewrites package-lock.json, so without this allowance the first gate run in
# a session dirties the tree and the guard can never apply again.
GENERATED_NOISE_FILES=("tsconfig.json" "package-lock.json" "CLAUDE.md" "AGENTS.md")

is_generated_noise_file() {
  local candidate="$1"
  local noise_file
  for noise_file in "${GENERATED_NOISE_FILES[@]}"; do
    if [ "$candidate" = "$noise_file" ]; then
      return 0
    fi
  done
  return 1
}

# `git status --porcelain` lines are "XY path": 2 status chars + 1 space
# before the path.
readonly PORCELAIN_STATUS_PREFIX_LEN=3

only_generated_noise_is_dirty() {
  local status_line
  while IFS= read -r status_line; do
    [ -z "$status_line" ] && continue
    is_generated_noise_file "${status_line:$PORCELAIN_STATUS_PREFIX_LEN}" || return 1
  done <<<"$(git status --porcelain 2>/dev/null)"
  return 0
}

if only_generated_noise_is_dirty; then
  AHEAD=$(git rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo "?")
  if [ "$AHEAD" = "0" ]; then
    rm -f "$COUNTER_FILE"
    exit 0
  fi
fi

fail() {
  echo "$((COUNT + 1))" > "$COUNTER_FILE"
  if [ "$COUNT" -ge "$MAX_GATE_RUNS" ]; then
    echo "Stop gate has blocked $COUNT times. Giving up." >&2
    echo "MANDATORY before you stop: do NOT open or mark ready any PR; label the issue needs-human and comment what is still red." >&2
    mkdir -p .factory && date > .factory/gate-gave-up   # rastro para el orquestador
    rm -f "$COUNTER_FILE"
    exit 0
  fi
  echo "$1" >&2
  exit 2
}

# Cada check corre SOLO si el proyecto lo tiene configurado: en un repo recién
# creado (sin eslint.config, sin tsconfig, con "test" aún en TODO) el gate no
# debe bloquear por ausencia de herramientas, solo por trabajo mal hecho.
has_script() { [ -f package.json ] && jq -e --arg s "$1" '.scripts[$s] // empty' package.json >/dev/null 2>&1 \
               && ! jq -r --arg s "$1" '.scripts[$s]' package.json | grep -q "TODO"; }

# 1. Lint
if [ -f eslint.config.js ] || [ -f eslint.config.mjs ] || [ -f .eslintrc ] || [ -f .eslintrc.json ] || [ -f .eslintrc.cjs ]; then
  if ! LINT_OUT=$(npx eslint . --max-warnings 0 2>&1); then
    fail "❌ Lint failed. Fix before finishing:
$LINT_OUT"
  fi
fi

# 2. Types
if [ -f tsconfig.json ]; then
  if ! TSC_OUT=$(npx tsc --noEmit 2>&1); then
    fail "❌ Type check failed. Fix before finishing:
$TSC_OUT"
  fi
fi

# 3. Unit tests
if has_script test; then
  if ! TEST_OUT=$(npm test 2>&1); then
    fail "❌ Tests failed. Fix before finishing:
$TEST_OUT"
  fi
fi

# 4. Visual regression + accessibility (only if playwright config exists)
if [ -f "playwright.config.ts" ] || [ -f "playwright.config.js" ]; then
  if ! E2E_OUT=$(npx playwright test 2>&1); then
    fail "❌ Playwright (visual/a11y) failed. Fix before finishing:
$E2E_OUT"
  fi
fi

rm -f "$COUNTER_FILE"
exit 0
