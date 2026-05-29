#!/usr/bin/env bash
# Open the HiNAS Checklist window in macOS Terminal.app — idempotent.
# Skips opening if a window with the matching title is already present.
set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
RENDERER="$PROJECT_ROOT/.claude/scripts/checklist-render.py"
WINDOW_TITLE="HiNAS Checklist"

if [ ! -f "$RENDERER" ]; then
    echo "renderer not found: $RENDERER" >&2
    exit 1
fi

# Check if a Terminal window with our custom title already exists.
existing=$(/usr/bin/osascript <<APPLESCRIPT 2>/dev/null || echo false
tell application "Terminal"
    set found to "false"
    repeat with w in windows
        try
            if (custom title of w) is "$WINDOW_TITLE" then
                set found to "true"
                exit repeat
            end if
        end try
    end repeat
    return found
end tell
APPLESCRIPT
)

if [ "$existing" = "true" ]; then
    exit 0
fi

# Open a new window running the renderer; tag it with a custom title so we can
# detect it next time.
/usr/bin/osascript <<APPLESCRIPT >/dev/null
tell application "Terminal"
    activate
    do script "CLAUDE_PROJECT_DIR='$PROJECT_ROOT' /usr/bin/env python3 '$RENDERER'"
    delay 0.3
    set custom title of front window to "$WINDOW_TITLE"
end tell
APPLESCRIPT
