#!/usr/bin/env bash
# One-time install of the user-level part of the kit into ~/.claude/.
# Run this ONCE per machine (not per project). Safe to re-run: it backs up
# an existing settings.json instead of overwriting it silently.

set -euo pipefail
KIT_DIR="$(cd "$(dirname "$0")/../user-level" && pwd)"

mkdir -p ~/.claude/agents

if [ -f ~/.claude/settings.json ]; then
  BAK=~/.claude/settings.json.bak.$(date +%Y%m%d%H%M%S)
  cp ~/.claude/settings.json "$BAK"
  echo "⚠ ~/.claude/settings.json already exists, backed up to $BAK."
  echo "  Merge $KIT_DIR/settings.json into it manually (defaultMode + allow/deny)."
else
  cp "$KIT_DIR/settings.json" ~/.claude/settings.json
  echo "✓ Installed ~/.claude/settings.json (permission mode: auto)"
fi

cp "$KIT_DIR/agents/"*.md ~/.claude/agents/
echo "✓ Installed agents: code-reviewer, ui-reviewer → ~/.claude/agents/"
echo "Done. The user-level/ folder in this repo is reference material: your app never imports it."
