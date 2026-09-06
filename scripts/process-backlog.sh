#!/usr/bin/env bash
# Autonomous backlog processor.
# Picks eligible `pending` issues one by one and runs Claude Code on each,
# in an isolated git worktree, until the backlog is empty or MAX_ISSUES is hit.
#
# Requirements: gh (authenticated), claude, jq. Run from the repo root.
# Safety: run this inside the devcontainer (see .devcontainer/) if you want
# to use full-bypass permissions; with --permission-mode auto it is safe to
# run on your machine but may occasionally pause on a dangerous action.

set -euo pipefail

# Everything below assumes the repo root (relative paths: factory-models.json,
# .plan/, scripts/, .claude/worktrees/). Fail loudly instead of degrading.
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$REPO_ROOT" ] || { echo "❌ No estás dentro de un repo git. Corre esto desde la carpeta del proyecto" >&2; exit 1; }
cd "$REPO_ROOT"
command -v gh >/dev/null || { echo "❌ Falta 'gh' (GitHub CLI). Instálalo y corre 'gh auth login'" >&2; exit 1; }
command -v jq >/dev/null || { echo "❌ Falta 'jq'. Instálalo (winget install jqlang.jq / brew install jq)" >&2; exit 1; }

MAX_ISSUES="${MAX_ISSUES:-10}"
# 200, no 80: el tope es un corte seco. Un worker que se queda sin turnos no
# alcanza ni a commitear lo que ya tenía verde, y el ticket se pierde entero.
MAX_TURNS="${MAX_TURNS:-200}"
PERMISSION_MODE="${PERMISSION_MODE:-auto}"   # auto | bypassPermissions (container only!)
WORKER_MODEL="${WORKER_MODEL:-$(jq -r '.models.worker // "sonnet"' factory-models.json 2>/dev/null || echo sonnet)}"
# Single source of truth for both this script and claude-backlog.yml (#60):
# tools that only make sense in an interactive session or a self-pacing
# /loop, which a one-ticket headless worker never has. `Agent` must never
# be added here: the lifecycle needs it to launch code-reviewer/ui-reviewer.
WORKER_DISALLOWED_TOOLS_FILE="${WORKER_DISALLOWED_TOOLS_FILE:-scripts/worker-disallowed-tools.txt}"
[ -f "$WORKER_DISALLOWED_TOOLS_FILE" ] || { echo "❌ Falta $WORKER_DISALLOWED_TOOLS_FILE: no se puede lanzar el worker sin saber qué herramientas negarle" >&2; exit 1; }
WORKER_DISALLOWED_TOOLS=$(grep -v '^[[:space:]]*#' "$WORKER_DISALLOWED_TOOLS_FILE" \
  | grep -v '^[[:space:]]*$' | tr -d ' \t' | tr '\n' ',' | sed 's/,$//' || true)
[ -n "$WORKER_DISALLOWED_TOOLS" ] || { echo "❌ $WORKER_DISALLOWED_TOOLS_FILE no lista ninguna herramienta" >&2; exit 1; }
ONLY_LABEL="${ONLY_LABEL:-}"   # opcional: partir el backlog por carril (ej. ONLY_LABEL=area:billing)
ONLY_MINE="${ONLY_MINE:-}"     # opcional: ONLY_MINE=1 → SOLO tickets asignados a mí (ignora el pozo común)
ME=$(gh api user --jq .login 2>/dev/null || echo "")
PROCESSED=0

echo "🏭 Worker model: $WORKER_MODEL (configurable en factory-models.json)"
[ -n "$ONLY_LABEL" ] && echo "🔀 Carril: solo issues con label '$ONLY_LABEL'"
[ -n "$ONLY_MINE" ] && echo "🎯 Modo estricto: solo tickets asignados a mí"
[ -n "$ME" ] && echo "👤 Corriendo como: $ME (reclamo por assignee activo)"

# The human's control surface is the BOARD: any non-epic card sitting in
# "Todo" means "I want this worked". Reconcile that intent into the machine
# queue (labels + issue state) before picking work, so dragging a card to
# Todo genuinely re-queues it, with no manual commands needed.
reconcile_board() {
  [ -f .plan/project.json ] || return 0
  local owner number
  owner=$(jq -r .owner .plan/project.json)
  number=$(jq -r .projectNumber .plan/project.json)
  gh project item-list "$number" --owner "$owner" --format json --limit 500 2>/dev/null \
    | jq -r '.items[] | select(.status=="Todo") | select(.content.number != null) | .content.number' \
    | tr -d '\r' \
    | while read -r n; do
        local err
        err=$(mktemp)
        if ! info=$(gh issue view "$n" --json state,labels 2>"$err"); then
          echo "⚠ reconcile_board: no pude leer el issue #$n con 'gh issue view' ($(cat "$err")), lo salto" >&2
          rm -f "$err"
          continue
        fi
        rm -f "$err"
        echo "$info" | jq -e '.labels[] | select(.name=="epic")' >/dev/null && continue
        state=$(echo "$info" | jq -r .state)
        if [ "$state" = "CLOSED" ]; then
          echo "↻ Board dice Todo para #$n (cerrado): reabriendo y encolando"
          gh issue reopen "$n" 2>/dev/null || true
          gh issue edit "$n" --add-label "pending" --remove-label "in-progress" --remove-label "needs-human" 2>/dev/null || true
        elif echo "$info" | jq -e '.labels[] | select(.name=="needs-human")' >/dev/null; then
          echo "↻ Board dice Todo para #$n (estaba needs-human): reintentando"
          gh issue edit "$n" --add-label "pending" --remove-label "needs-human" --remove-label "in-progress" 2>/dev/null || true
        elif ! echo "$info" | jq -e '.labels[] | select(.name=="pending" or .name=="in-progress")' >/dev/null; then
          echo "↻ Board dice Todo para #$n (sin label de cola): encolando"
          gh issue edit "$n" --add-label "pending" 2>/dev/null || true
        fi
      done
}

is_blocked() {  # issue number -> 0 if blocked
  local n="$1"
  local blockers
  # POSIX sed (grep -oP is GNU-only: on macOS it would fail and, swallowed by
  # `|| true`, silently make every blocked issue look eligible).
  blockers=$(gh issue view "$n" --json labels -q '.labels[].name' \
             | sed -n 's/^blocked-by-\([0-9][0-9]*\)$/\1/p')
  for b in $blockers; do
    state=$(gh issue view "$b" --json state -q .state)
    [ "$state" != "CLOSED" ] && return 0
  done
  return 1
}

next_issue() {  # -> first eligible pending issue number, or empty
  # Skips issues already assigned to someone else (their claim is respected).
  local lane=()
  [ -n "$ONLY_LABEL" ] && lane=(--label "$ONLY_LABEL")
  for prio in "priority:high" "priority:medium" "priority:low" ""; do
    local pf=()
    [ -n "$prio" ] && pf=(--label "$prio")
    local jqsel=".[] | select((.assignees|length)==0 or ([.assignees[].login]|index(\"$ME\"))) | .number"
    [ -n "$ONLY_MINE" ] && jqsel=".[] | select([.assignees[].login]|index(\"$ME\")) | .number"
    for n in $(gh issue list --limit 500 --label pending "${lane[@]}" "${pf[@]}" --state open \
                 --json number,assignees \
                 --jq "$jqsel" \
               | sort -n); do
      if ! is_blocked "$n"; then echo "$n"; return; fi
    done
  done
}

# Leave no ghost state if the operator hits Ctrl+C mid-ticket.
cleanup() {
  [ -n "${CLAUDE_PID:-}" ] && kill "$CLAUDE_PID" 2>/dev/null || true
  if [ -n "${N:-}" ]; then
    echo "" >&2
    echo "⏹ Interrumpido en #$N: devolviéndolo a la cola" >&2
    gh issue edit "$N" --add-label pending --remove-label in-progress 2>/dev/null || true
    [ -n "${ME:-}" ] && gh issue edit "$N" --remove-assignee "@me" 2>/dev/null || true
    # A board that rejects the status (no Blocked option yet) must not stop
    # the rest of the cleanup: the label/assignee bookkeeping above already
    # returned the ticket to the queue.
    bash scripts/task-status.sh "$N" "Blocked" 2>/dev/null || true
  fi
  exit 130
}

# Labels an issue needs-human, unassigns it, moves its board card to Blocked
# and posts a comment. Shared by every path that gives up on a ticket, so the
# bookkeeping (label + assignee + board + comment) never drifts apart between
# them.
flag_needs_human() {  # issue number, comment body
  local n="$1" body="$2"
  gh issue edit "$n" --add-label "needs-human" --remove-label "in-progress" || true
  [ -n "${ME:-}" ] && gh issue edit "$n" --remove-assignee "@me" 2>/dev/null || true
  bash scripts/task-status.sh "$n" "Blocked" 2>/dev/null || true
  gh issue comment "$n" --body "$body" || true
}

# True if some PR (any state) declares "Closes #N" in its body, OR if `gh`
# itself could not be asked (rate limit, transient network error): a worker
# that already shipped a PR must never be flagged needs-human just because
# the check that would have proven it failed. Deliberately not keyed on
# branch name: `impl-N` and `worktree-impl-N` coexist (#62), so matching by
# head produces false negatives for work that is already sitting in an open
# PR.
pr_declares_closes() {  # issue number
  local n="$1" count
  if ! count=$(gh pr list --state all --search "Closes #$n in:body" --json number --jq length 2>/dev/null); then
    echo "⚠ no pude comprobar si #$n ya tiene PR (falla de gh); no lo marco needs-human por si acaso" >&2
    return 0
  fi
  [ "${count:-0}" != "0" ]
}

# Single source of truth for where a worker's branch/worktree lives, so the
# path template only needs to change in one place if the naming convention
# does (see #62, which is expected to touch it).
worktree_dir_for() {  # issue number
  echo ".claude/worktrees/impl-$1"
}

# Creates (or reuses) the worktree for a ticket, always on branch `impl-N`.
# `claude --worktree NAME` cannot be trusted for this: it prefixes whatever
# name it's given with `worktree-`, which is exactly how #62 happened
# (`impl-N` documented, `worktree-impl-N` pushed). Deciding the branch name
# here, with plain git, means the worker never has to get it right on its
# own. Idempotent: a worktree left over from a previous run of the same
# ticket is reused as-is, never given a second branch.
ensure_worker_worktree() {  # issue number
  local n="$1" wt_dir branch
  wt_dir=$(worktree_dir_for "$n")
  branch="impl-$n"
  [ -d "$wt_dir" ] && return 0
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git worktree add "$wt_dir" "$branch"
  else
    git worktree add -b "$branch" "$wt_dir"
  fi
}

# A worker that exits 0 without finishing the lifecycle (asks something and
# waits, commits and stops, loses a tool mid-session...) leaves no visible
# signal: the issue stays in-progress, assigned, with real work stranded on
# its branch. Detect that silent case instead of trusting exit 0 as success.
check_worker_left_no_pr() {  # issue number
  local n="$1" info state labels wt_dir last_commit dirty_count
  info=$(gh issue view "$n" --json state,labels 2>/dev/null) || return 0
  state=$(echo "$info" | jq -r .state)
  [ "$state" = "CLOSED" ] && return 0   # closed by idempotency: no PR is correct
  labels=$(echo "$info" | jq -r '.labels[].name')
  echo "$labels" | grep -qx "in-progress" || return 0
  pr_declares_closes "$n" && return 0

  wt_dir=$(worktree_dir_for "$n")
  last_commit=$(git -C "$wt_dir" log --oneline -1 2>/dev/null || echo "sin commits")
  dirty_count=$(git -C "$wt_dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ') || dirty_count=0

  echo "⚠ Claude salió 0 en #$n pero no dejó PR: labeling needs-human + comentario"
  flag_needs_human "$n" "🤖 **El worker terminó (código 0) sin completar el lifecycle**: no encontré ningún PR, abierto o cerrado, que declare \`Closes #$n\` en su cuerpo.

**Último commit en la rama**: \`$last_commit\`.
**Archivos sin commitear**: $dirty_count.

Revisa el worktree \`impl-$n\` antes de decidir cómo retomarlo: puede que el trabajo esté casi terminado y solo falte abrir el PR, o que se haya detenido a mitad de camino."
}

# Single decision point for what happens after the worker process ends, so a
# crash (exit != 0) and a silent success (exit 0, no PR) share the same
# needs-human path and never both fire for the same run.
handle_worker_exit() {  # issue number, wait's exit status
  local n="$1" exit_code="$2"
  if [ "$exit_code" -ne 0 ]; then
    echo "⚠ Claude exited non-zero on issue #$n: labeling needs-human + explanatory comment"
    local last_work
    last_work=$(git -C "$(worktree_dir_for "$n")" log --oneline -1 2>/dev/null || echo "sin commits")
    flag_needs_human "$n" "🤖 **El worker terminó de forma anormal** (salida ≠ 0). Causas probables: límite de cuota del plan, interrupción manual (Ctrl+C), o tope de turnos alcanzado.

**Trabajo parcial conservado** en el worktree \`impl-$n\`, último commit: \`$last_work\`. Nada se perdió.

**Para retomar** (cuando la causa esté resuelta, p. ej. la cuota repuesta):
\`\`\`
gh issue edit $n --remove-label needs-human --remove-label in-progress --add-label pending
bash scripts/process-backlog.sh
\`\`\`
El nuevo worker puede continuar desde la rama existente."
  else
    check_worker_left_no_pr "$n"
  fi
}

# Launches the worker for issue $1 in the background and sets CLAUDE_PID.
# Pulled out of main() so tests can drive it directly against a fake `claude`.
run_worker() {
  local n="$1" wt_dir
  wt_dir=$(worktree_dir_for "$n")
  ensure_worker_worktree "$n"
  # Runs from inside the worktree instead of passing `--worktree` to claude,
  # so the branch name stays the one `ensure_worker_worktree` decided. `exec`
  # keeps $CLAUDE_PID pointing at the actual claude process, not the subshell.
  (
    cd "$wt_dir"
    exec claude -p "Process GitHub issue #$n following the issue lifecycle in CLAUDE.md:
  read the issue with 'gh issue view $n', label it in-progress, work on branch impl-$n,
  TDD until the Definition of Done is met, run the code-reviewer (and the ui-reviewer
  only when the UI-review policy in factory-models.json applies to this issue) until
  APPROVED, then open a draft PR with 'Closes #$n'.
  Commit as you go: every time a piece is green (tests passing, lint and types clean),
  commit it before starting the next one. Your turn budget can run out without warning,
  and uncommitted work is lost work.
  If blocked after the max attempts, add label needs-human with an explanatory comment and stop." \
      --permission-mode "$PERMISSION_MODE" \
      --max-turns "$MAX_TURNS" \
      --model "$WORKER_MODEL" \
      --disallowedTools "$WORKER_DISALLOWED_TOOLS"
  ) &
  CLAUDE_PID=$!
}

main() {
  reconcile_board   # (must run after the function definitions above)

  trap cleanup INT TERM

  while [ "$PROCESSED" -lt "$MAX_ISSUES" ]; do
    N=$(next_issue)
    if [ -z "${N:-}" ]; then
      echo "✅ Backlog empty (no eligible pending issues). Processed: $PROCESSED"
      exit 0
    fi

    echo "▶ Processing issue #$N (attempt $((PROCESSED + 1))/$MAX_ISSUES)"

    # Claim-and-verify: grab the issue by assignee, re-read, and back off if
    # someone else (a teammate, the nightly cron) won the race.
    if [ -n "$ME" ]; then
      gh issue edit "$N" --add-assignee "@me" 2>/dev/null || true
      OTHERS=$(gh issue view "$N" --json assignees --jq "[.assignees[].login] | map(select(. != \"$ME\")) | length" 2>/dev/null || echo 0)
      if [ "${OTHERS:-0}" -gt 0 ]; then
        echo "⚔ #$N ya está reclamado por otra persona, lo salto"
        gh issue edit "$N" --remove-assignee "@me" 2>/dev/null || true
        SKIPPED="${SKIPPED:-} $N"
        PROCESSED=$((PROCESSED + 1))        # cuenta como intento: nunca bucle infinito
        sleep $((RANDOM % 8 + 3))           # jitter: rompe el ping-pong entre dos corredores
        continue
      fi
    fi

    # Deterministic bookkeeping: don't rely on the worker remembering to do it.
    gh issue edit "$N" --add-label "in-progress" --remove-label "pending" 2>/dev/null || true
    bash scripts/task-status.sh "$N" "In Progress" 2>/dev/null || true

    run_worker "$N"

    # Heartbeat: while the worker runs, print elapsed time + latest commit on its
    # branch every 60s, so a quiet terminal never looks like a hung one.
    START_TS=$(date +%s)
    LAST_COMMIT=""
    LAST_ERR=0
    WT_DIR=$(worktree_dir_for "$N")
    while kill -0 "$CLAUDE_PID" 2>/dev/null; do
      sleep 60
      kill -0 "$CLAUDE_PID" 2>/dev/null || break
      ELAPSED_MIN=$(( ($(date +%s) - START_TS) / 60 ))
      if [ -d "$WT_DIR" ]; then
        # Untracked files never travel to worktrees, so hand the worker every
        # local env file (gitignored, stays on this machine) so integration
        # tests and migrations can run against the real services.
        for envf in .env .env.*; do
          [ -f "$envf" ] || continue
          git ls-files --error-unmatch "$envf" >/dev/null 2>&1 && continue  # tracked (e.g. .env.example) travels on its own
          if [ ! -f "$WT_DIR/$envf" ]; then
            cp "$envf" "$WT_DIR/$envf"
            echo "  🔑 $envf copiado al worktree del worker"
          fi
        done
        # Read the worktree by its PATH, because workers name their branches freely.
        COMMIT=$(git -C "$WT_DIR" log --oneline -1 2>/dev/null || echo "(worktree sin commits aún)")
      else
        COMMIT="(worktree aún no creado)"
        if [ "$ELAPSED_MIN" -ge 5 ]; then
          COMMIT="$COMMIT ⚠ sin señales de arranque: posible límite de cuota o bloqueo. Considera Ctrl+C y procesar en modo interactivo"
        fi
      fi
      if [ "$COMMIT" != "$LAST_COMMIT" ]; then
        echo "  ⏱ ${ELAPSED_MIN}m · NUEVO: $COMMIT"
        LAST_COMMIT="$COMMIT"
      else
        # No new commit: mine every live signal available:
        # (a) what tool the worker is using right now (Claude Code session log)
        # (b) the most recently touched file and how long ago
        # (c) uncommitted work volume, and tool errors it is fighting through
        ACT=""; ERR=0
        # Anchor the end: without it, issue #1 matches ...impl-19 / ...impl-100.
        SESS_DIR=$(ls -dt "$HOME/.claude/projects/"*worktrees-impl-"$N" 2>/dev/null | head -1)
        if [ -n "$SESS_DIR" ]; then
          SESS_FILE=$(ls -t "$SESS_DIR"/*.jsonl 2>/dev/null | head -1)
          if [ -n "$SESS_FILE" ]; then
            ACT=$(tail -c 200000 "$SESS_FILE" 2>/dev/null \
              | jq -Rr 'fromjson? | select(.type=="assistant") | .message.content[]? | select(.type=="tool_use")
                        | "🔧 " + .name + ((.input.command // .input.file_path // "") | tostring | if . == "" then "" else ": " + .[0:55] end)' 2>/dev/null \
              | tail -1)
            ERR=$(tail -c 200000 "$SESS_FILE" 2>/dev/null \
              | jq -Rr 'fromjson? | select(.type=="user") | .message.content[]? | select(.type=="tool_result" and .is_error==true) | 1' 2>/dev/null \
              | wc -l | tr -d ' ')
          fi
        fi
        AGO=""; AGOTXT=""
        TOUCH=$(find "$WT_DIR" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -printf '%T@ %P\n' 2>/dev/null | sort -nr | head -1)
        if [ -n "$TOUCH" ]; then
          TSEC=${TOUCH%% *}; TFILE=${TOUCH#* }
          AGO=$(( $(date +%s) - ${TSEC%.*} ))
          AGOTXT="· ✍ ${TFILE:0:45} (hace ${AGO}s)"
        fi
        FILES=$(git -C "$WT_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
        LINES=$(git -C "$WT_DIR" diff --shortstat 2>/dev/null | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo 0)
        LINE="  ⏱ ${ELAPSED_MIN}m · ${ACT:-trabajando} · $FILES arch, +$LINES líneas $AGOTXT"
        if [ "${ERR:-0}" -gt "$LAST_ERR" ]; then
          LINE="$LINE · ⚠ $((ERR - LAST_ERR)) errores nuevos de herramienta (iterando contra fallos)"
        fi
        LAST_ERR=${ERR:-0}
        echo "$LINE"
        if [ -n "${AGO:-}" ] && [ "$AGO" -gt 240 ]; then
          echo "  ⚠ sin actividad de archivos hace $((AGO / 60))m. Si persiste otros 5m, considera Ctrl+C y procesar en modo interactivo"
        fi
      fi
    done

    # `set -e` would otherwise abort the whole script on a non-zero wait, so
    # the exit status is captured through the if/else instead of `!`.
    if wait "$CLAUDE_PID"; then
      WORKER_EXIT_CODE=0
    else
      WORKER_EXIT_CODE=$?
    fi
    handle_worker_exit "$N" "$WORKER_EXIT_CODE"

    PROCESSED=$((PROCESSED + 1))
  done

  echo "⏸ Reached MAX_ISSUES=$MAX_ISSUES. Remaining backlog stays for the next run."
}

# Sourced (e.g. from tests, to exercise cleanup()/reconcile_board() in
# isolation) vs executed directly: only the latter runs the backlog loop.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
