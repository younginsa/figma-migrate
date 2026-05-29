#!/usr/bin/env bash
# Usage: rule.sh "<label>" <status>
#   label  — human label (e.g. "DS sync"); slugified internally
#   status — running | done | idle
#
# Writes a tab-separated row to .claude/state/rule-status.tsv.
# Renderer reads the latest row per key.
set -euo pipefail

if [ "$#" -lt 2 ]; then
    echo "Usage: $0 \"<label>\" <running|done|idle>" >&2
    exit 1
fi

label="$1"
status="$2"

case "$status" in
    running|done|idle) ;;
    *) echo "status must be running|done|idle" >&2; exit 1 ;;
esac

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
STATE_DIR="$PROJECT_ROOT/.claude/state"
STATUS_FILE="$STATE_DIR/rule-status.tsv"

mkdir -p "$STATE_DIR"
touch "$STATUS_FILE"

key=$(printf '%s' "$label" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
ts=$(date +%s)

tmp=$(mktemp)
grep -v $'^'"$key"$'\t' "$STATUS_FILE" > "$tmp" 2>/dev/null || true
printf '%s\t%s\t%s\n' "$key" "$status" "$ts" >> "$tmp"
mv "$tmp" "$STATUS_FILE"
