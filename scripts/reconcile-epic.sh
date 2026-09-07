#!/usr/bin/env bash
# Reconcilia UNA épica ya conocida contra el estado de sus sub-issues: la
# cierra si no le queda ninguno abierto, la reabre si le llega uno nuevo o
# reabierto a una épica ya cerrada. No hace nada si ya está al día.
#
# Usage: scripts/reconcile-epic.sh <epic-number>
#
# Requires: gh, jq.

set -euo pipefail

EPIC="${1:?usage: reconcile-epic.sh <epic-number>}"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib/reconcile-epic.sh"

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

reconcile_epic "$REPO" "$EPIC"
