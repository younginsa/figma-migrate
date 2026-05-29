#!/usr/bin/env bash
# Usage: migrate-mode.sh on|off|status
#   on     — flip flag to "on" so renderer also shows /figma-migrate workflow
#   off    — flip flag to "off" and clear all workflow rule statuses
#   status — print current flag value
set -euo pipefail

mode="${1:-status}"

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
STATE_DIR="$PROJECT_ROOT/.claude/state"
FLAG="$STATE_DIR/migrate-mode.flag"
STATUS_FILE="$STATE_DIR/rule-status.tsv"

mkdir -p "$STATE_DIR"

case "$mode" in
    on)
        printf 'on\n' > "$FLAG"
        echo "migrate mode: ON"
        ;;
    off)
        printf 'off\n' > "$FLAG"
        : > "$STATUS_FILE"
        echo "migrate mode: OFF (workflow statuses cleared)"
        ;;
    status)
        if [ -f "$FLAG" ]; then cat "$FLAG"; else echo off; fi
        ;;
    *)
        echo "Usage: $0 {on|off|status}" >&2
        exit 1
        ;;
esac
