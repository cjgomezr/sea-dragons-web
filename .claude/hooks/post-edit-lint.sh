#!/usr/bin/env bash
# Deterministic clean-up after every Edit/Write: format + autofix lint.
# Non-blocking (exit 0 always): it fixes what it can and stays silent.
# The Stop gate is the blocking enforcement; this just keeps the diff clean.

INPUT=$(cat)
# jq (ya es requisito del kit): grep/sed no des-escapa rutas de Windows.
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .file_path // empty' 2>/dev/null)
[ -n "$FILE" ] && [ -f "$FILE" ] || exit 0

case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.css|*.md)
    npx prettier --write "$FILE" >/dev/null 2>&1
    ;;
esac

case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx)
    npx eslint --fix "$FILE" >/dev/null 2>&1
    ;;
esac

exit 0
