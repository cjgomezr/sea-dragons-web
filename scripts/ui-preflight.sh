#!/usr/bin/env bash
# Guarantees the screenshots and the visual suite look at THIS project's app.
#
# The hazard it removes: another project's dev server answering on the same
# port. A screenshot of the wrong app is a perfectly valid PNG, so the review
# fails silently instead of loudly. This script only ever hands over a server
# it started itself, and refuses anything else.
#
# Usage:
#   bash scripts/ui-preflight.sh up     # starts the dev server, prints its URL
#   bash scripts/ui-preflight.sh down   # stops ONLY a server started by 'up'
#   bash scripts/ui-preflight.sh check  # just the verdict, starts nothing
#
# Env overrides: APP_URL, DEV_SERVER_CMD.
# FABRICA_TRUST_EXISTING_SERVER=1 accepts a server this script did not start
# (for a human who knows what is on that port; agents must not set it).

set -euo pipefail

DEFAULT_APP_URL='http://localhost:3417'
DEFAULT_DEV_SERVER_CMD='npm run dev'

APP_URL="${APP_URL:-$DEFAULT_APP_URL}"
DEV_SERVER_CMD="${DEV_SERVER_CMD:-$DEFAULT_DEV_SERVER_CMD}"

STATE_DIR=".factory"
PID_FILE="$STATE_DIR/ui-server.pid"
URL_FILE="$STATE_DIR/ui-url"
LOG_FILE="$STATE_DIR/ui-server.log"
BOOT_TIMEOUT="${FABRICA_SERVER_TIMEOUT:-60}"
STOP_TIMEOUT=10

die() { echo "ui-preflight: $1" >&2; exit 1; }

# Until /bootstrap fills the placeholders there is no app to point at.
case "$APP_URL$DEV_SERVER_CMD" in
  *'{{'*) die "this repo still has {{...}} placeholders. Run /bootstrap first, or export APP_URL and DEV_SERVER_CMD." ;;
esac

# Does anything answer at APP_URL? Any HTTP status counts as occupied.
responds() {
  if command -v curl >/dev/null 2>&1; then
    curl -sS -o /dev/null --max-time 3 "$APP_URL" >/dev/null 2>&1
  else
    node -e '
      const u = new URL(process.argv[1]);
      const req = require("http").get(
        { hostname: u.hostname, port: u.port || 80, path: "/", timeout: 3000 },
        () => process.exit(0)
      );
      req.on("error", () => process.exit(1));
      req.on("timeout", () => process.exit(1));
    ' "$APP_URL" >/dev/null 2>&1
  fi
}

# Ours = started by a previous 'up' in this repo and still alive. PID_FILE
# holds whoever actually ended up bound to the port (see the comment in
# 'up' about why that is not always the launched wrapper's own PID), so a
# plain liveness check is enough and, unlike trusting any process merely
# occupying the port, does not risk mistaking an unrelated later server for
# ours once the one we started is truly gone.
is_ours() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

port_of() {
  local hostport
  hostport=$(printf '%s' "$APP_URL" | sed -E 's|^[a-zA-Z]+://||; s|/.*$||')
  case "$hostport" in
    *:*) printf '%s' "${hostport##*:}" ;;
    *)   case "$APP_URL" in https://*) printf '443' ;; *) printf '80' ;; esac ;;
  esac
}

# Git Bash keeps its own PID numbering, separate from the native Windows PID
# that netstat/taskkill/tasklist use for the same process. ps -W is the
# Rosetta stone between the two; on non-Windows this simply finds nothing.
winpid_of() {
  local pid="$1" winpid
  winpid=$(ps -W 2>/dev/null | awk -v p="$pid" '$1 == p { print $4 }' | head -1)
  [ -n "$winpid" ] || winpid=$(ps 2>/dev/null | awk -v p="$pid" '$1 == p { print $4 }' | head -1)
  printf '%s' "$winpid"
}

# The reverse of winpid_of: a native Windows PID (as netstat reports it) back
# to the MSYS pid that Git Bash's own kill/kill -0 actually understand.
pid_for_winpid() {
  ps -W 2>/dev/null | awk -v w="$1" '$4 == w { print $1 }' | head -1
}

# Dev servers spawn children (next, vite, nodemon), and killing only the
# parent leaves the port taken, which is exactly what this script exists to
# prevent. Windows and POSIX kill trees differently.
kill_tree() {
  local pid="$1" winpid child
  if command -v taskkill >/dev/null 2>&1; then
    winpid=$(winpid_of "$pid")
    if [ -n "$winpid" ]; then
      MSYS_NO_PATHCONV=1 taskkill /T /F /PID "$winpid" >/dev/null 2>&1 || true
      return 0
    fi
  fi
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
  sleep 1
  kill -9 "$pid" 2>/dev/null || true
}

# Prints the native PID(s) (one per line) currently bound to our port, or
# nothing if it is free.
port_owner_pid() {
  local port
  port=$(port_of)
  if command -v netstat >/dev/null 2>&1 && command -v taskkill >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | grep -i listening | grep ":$port " | awk '{print $NF}' | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:$port" 2>/dev/null
  fi
}

# Swaps the PID_FILE entry for whoever is actually bound to the port right
# now. 'up' calls this the instant the port answers, still inside the window
# where it alone could have claimed a port it just confirmed was free, so
# this is the one safe place to trust port_owner_pid: everywhere else
# (is_ours, called an unbounded time later, possibly by a different
# invocation) it would risk mistaking a later, unrelated server for ours.
# Fixes the wrapper-vs-listener PID mismatch at the source instead of
# working around it: 'npm run dev' hands off to a child before that child
# binds the port, so $! (the wrapper's PID) is never the right thing to
# track once the server is actually up.
#
# port_owner_pid reports the native Windows PID (that is what netstat and
# taskkill deal in), but is_ours signals it with Git Bash's own kill -0,
# which only recognizes Git Bash's PID numbering. Translate it back before
# storing it, or a perfectly alive server reads as dead on the next check.
# A native PID is never valid in Git Bash's own numbering (they are separate
# spaces), so if the translation can't find a match, leave PID_FILE alone
# rather than store a value kill -0 could never confirm, or coincidentally
# could confirm for a completely different process.
record_real_owner() {
  local native_pid pid attempt
  native_pid=$(port_owner_pid | head -1)
  [ -n "$native_pid" ] || return 0
  if ! command -v taskkill >/dev/null 2>&1; then
    echo "$native_pid" > "$PID_FILE"
    return 0
  fi
  for attempt in 1 2 3; do
    pid=$(pid_for_winpid "$native_pid")
    [ -n "$pid" ] && break
    sleep 0.2
  done
  [ -n "$pid" ] && echo "$pid" > "$PID_FILE"
  return 0
}

# Last resort: whoever still holds the port after kill_tree is our own dev
# server surviving in a stray child ('up' checked the port was free before
# starting it, so nothing else can have claimed it since).
kill_port_owner() {
  local pid
  for pid in $(port_owner_pid); do
    if command -v taskkill >/dev/null 2>&1; then
      MSYS_NO_PATHCONV=1 taskkill /T /F /PID "$pid" >/dev/null 2>&1 || true
    else
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

check() {
  if ! responds; then
    echo "ui-preflight: $APP_URL is free." >&2
    return 0
  fi
  if is_ours; then
    echo "ui-preflight: $APP_URL is served by this factory (pid $(cat "$PID_FILE"))." >&2
    return 0
  fi
  if [ -n "${FABRICA_TRUST_EXISTING_SERVER:-}" ]; then
    echo "ui-preflight: trusting the server already on $APP_URL (FABRICA_TRUST_EXISTING_SERVER is set)." >&2
    return 0
  fi
  die "something already answers at $APP_URL and this factory did not start it.
Screenshots taken now could be of a different project's app, so nothing will run.
Fix it one of these ways:
  - stop whatever is using that port, then retry
  - point this project elsewhere: export APP_URL=http://localhost:<free-port>
  - if you are sure that server IS this project: export FABRICA_TRUST_EXISTING_SERVER=1"
}

up() {
  check
  mkdir -p "$STATE_DIR"
  echo "$APP_URL" > "$URL_FILE"

  if is_ours; then
    echo "$APP_URL"
    return 0
  fi

  bash -c "exec $DEV_SERVER_CMD" > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  disown 2>/dev/null || true   # sin avisos de "Terminated" al matarlo

  # The server must come up on OUR url. Frameworks that silently fall back to
  # the next free port never answer here, so they fail loudly instead.
  #
  # There is no reliable early "it already died" check here: the wrapper
  # process can legitimately hand off to a child and exit before that child
  # ever binds the port (that hand-off, mistaken for death, is exactly the
  # bug this script used to have). A wrapper that is gone and a port that
  # is not bound yet look identical to a wrapper that is gone and a port
  # that never will be, so the only trustworthy verdict is whether the port
  # answers before BOOT_TIMEOUT runs out.
  local waited=0
  while [ "$waited" -lt "$BOOT_TIMEOUT" ]; do
    if responds; then
      record_real_owner
      echo "$APP_URL"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done

  down || true # down's own WARNING already covers a failed stop; this die is the more useful diagnostic either way.
  die "the dev server did not answer at $APP_URL after ${BOOT_TIMEOUT}s.
If it started on a different port, pin the port in the dev command (for
example 'vite --strictPort --port', 'next dev -p'). Last lines of $LOG_FILE:
$(tail -n 20 "$LOG_FILE" 2>/dev/null)"
}

down() {
  [ -f "$PID_FILE" ] || { echo "ui-preflight: nothing to stop." >&2; return 0; }
  local pid
  pid=$(cat "$PID_FILE")
  rm -f "$PID_FILE"

  # The port is the real subject here, not the pid: a survivor keeps the next
  # review blocked, since it will look like a foreign server. Only wait out a
  # grace period if we actually signalled something: a pid that was already
  # dead never got a chance to shut down on its own, so there is nothing to
  # wait for and kill_port_owner should run right away.
  if kill -0 "$pid" 2>/dev/null; then
    kill_tree "$pid"
    local waited=0
    while [ "$waited" -lt "$STOP_TIMEOUT" ] && responds; do
      sleep 1
      waited=$((waited + 1))
    done
  fi
  if responds; then
    kill_port_owner
    sleep 1
  fi
  if responds; then
    echo "ui-preflight: WARNING, something still answers at $APP_URL after stopping pid $pid.
Kill it by hand before the next review, or it will be refused as a foreign server." >&2
    return 1
  fi

  echo "ui-preflight: stopped the dev server (pid $pid)." >&2
}

case "${1:-}" in
  up)    up ;;
  down)  down ;;
  check) check ;;
  *)     die "usage: ui-preflight.sh up|down|check" ;;
esac
